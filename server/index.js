/**
 * Simple Express backend that auto-creates tables and seeds demo users on startup.
 * Connects to Postgres via DATABASE_URL env var.
 */

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
require("dotenv").config();

const DATABASE_URL = process.env.DATABASE_URL || "postgres://cbt:cbt@localhost:5432/cbt";
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-me";

const pool = new Pool({ connectionString: DATABASE_URL });

async function initDb() {
  // Load schema and run
  const schema = fs.readFileSync(require("path").join(__dirname, "../db/schema.sql"), "utf8");
  await pool.query(schema);

  // Seed demo users if none exist
  const { rows } = await pool.query("SELECT COUNT(*)::int as c FROM users;");
  if (rows.length && Number(rows[0].c) === 0) {
    const adminPass = await bcrypt.hash("adminpass", 10);
    const studentPass = await bcrypt.hash("pass", 10);
    await pool.query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)",
      [uuidv4(), "admin@example.com", "Admin", "admin", adminPass]);
    await pool.query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)",
      [uuidv4(), "student@example.com", "Student", "student", studentPass]);
    console.log("Seeded demo users: admin@example.com/adminpass, student@example.com/pass");
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Auth
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const q = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
  const user = q.rows[0];
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  const ok = await bcrypt.compare(password, user.password_hash || "");
  if (!ok) return res.status(401).json({ error: "invalid credentials" });
  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: "6h" });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "missing token" });
  const token = auth.replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "invalid token" });
  }
}

// Admin: create exam
app.post("/api/admin/exams", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
  const { title, duration_minutes } = req.body;
  const id = uuidv4();
  await pool.query("INSERT INTO exams (id, title, duration_minutes, created_by) VALUES ($1,$2,$3,$4)",
    [id, title, duration_minutes, req.user.sub]);
  res.json({ id, title, duration_minutes });
});

// Admin: add question (simple MCQ)
app.post("/api/admin/exams/:examId/questions", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
  const { examId } = req.params;
  const { type, text, choices } = req.body;
  const qid = uuidv4();
  await pool.query("INSERT INTO questions (id, exam_id, type, text) VALUES ($1,$2,$3,$4)", [qid, examId, type, text]);
  if (Array.isArray(choices)) {
    for (const c of choices) {
      await pool.query("INSERT INTO choices (id, question_id, text, is_correct) VALUES ($1,$2,$3,$4)",
        [uuidv4(), qid, c.text, c.is_correct || false]);
    }
  }
  res.json({ id: qid });
});

// List exams
app.get("/api/exams", authMiddleware, async (req, res) => {
  const { rows } = await pool.query("SELECT id, title, duration_minutes, start_at, end_at FROM exams ORDER BY created_at DESC");
  res.json(rows);
});

// Start exam (create student_exams and return randomized questions without correct flags)
app.post("/api/exams/:examId/start", authMiddleware, async (req, res) => {
  const { examId } = req.params;
  const exq = await pool.query("SELECT * FROM exams WHERE id=$1", [examId]);
  if (!exq.rowCount) return res.status(404).json({ error: "exam not found" });
  const exam = exq.rows[0];
  const studentExamId = uuidv4();
  const started_at = new Date();
  const ends_at = new Date(started_at.getTime() + exam.duration_minutes * 60000);
  await pool.query("INSERT INTO student_exams (id, student_id, exam_id, started_at, ended_at, status) VALUES ($1,$2,$3,$4,$5,$6)",
    [studentExamId, req.user.sub, examId, started_at.toISOString(), ends_at.toISOString(), "in_progress"]);
  // Fetch questions
  const qs = await pool.query("SELECT q.id, q.type, q.text FROM questions q WHERE q.exam_id=$1", [examId]);
  const questions = [];
  for (const q of qs.rows) {
    const cs = await pool.query("SELECT id, text FROM choices WHERE question_id=$1", [q.id]);
    questions.push({ id: q.id, type: q.type, text: q.text, choices: cs.rows });
  }
  // randomize
  questions.sort(() => Math.random() - 0.5);
  res.json({ studentExamId, started_at: started_at.toISOString(), ends_at: ends_at.toISOString(), questions });
});

// Save answer (autosave)
app.post("/api/exams/:examId/answer", authMiddleware, async (req, res) => {
  const { studentExamId, questionId, answer } = req.body;
  const se = await pool.query("SELECT * FROM student_exams WHERE id=$1", [studentExamId]);
  if (!se.rowCount) return res.status(404).json({ error: "session not found" });
  if (se.rows[0].status !== "in_progress") return res.status(400).json({ error: "exam not active" });
  // Upsert student_answers
  const existing = await pool.query("SELECT id FROM student_answers WHERE student_exam_id=$1 AND question_id=$2", [studentExamId, questionId]);
  if (existing.rowCount) {
    await pool.query("UPDATE student_answers SET answer=$1 WHERE id=$2", [JSON.stringify(answer), existing.rows[0].id]);
  } else {
    await pool.query("INSERT INTO student_answers (id, student_exam_id, question_id, answer) VALUES ($1,$2,$3,$4)",
      [uuidv4(), studentExamId, questionId, JSON.stringify(answer)]);
  }
  res.json({ ok: true });
});

// Submit exam and auto-grade MCQs
app.post("/api/exams/:examId/submit", authMiddleware, async (req, res) => {
  const { studentExamId } = req.body;
  const seq = await pool.query("SELECT * FROM student_exams WHERE id=$1", [studentExamId]);
  if (!seq.rowCount) return res.status(404).json({ error: "session not found" });
  const seRow = seq.rows[0];
  if (seRow.status !== "in_progress") return res.status(400).json({ error: "already submitted" });
  await pool.query("UPDATE student_exams SET status='submitted', ended_at=$1 WHERE id=$2", [new Date().toISOString(), studentExamId]);
  // Grade
  const questions = await pool.query("SELECT id, type FROM questions WHERE exam_id=$1", [seRow.exam_id]);
  let total = 0, correct = 0;
  for (const q of questions.rows) {
    if (q.type === "mcq") {
      total += 1;
      const correctChoiceQ = await pool.query("SELECT id FROM choices WHERE question_id=$1 AND is_correct=true LIMIT 1", [q.id]);
      const studentAnsQ = await pool.query("SELECT answer FROM student_answers WHERE student_exam_id=$1 AND question_id=$2", [studentExamId, q.id]);
      if (correctChoiceQ.rowCount && studentAnsQ.rowCount) {
        const correctId = correctChoiceQ.rows[0].id;
        const studentAnswer = JSON.parse(studentAnsQ.rows[0].answer);
        if (studentAnswer === correctId) correct += 1;
      }
    }
  }
  const score = { correct, total, percent: total ? Math.round((correct / total) * 100) : 0 };
  await pool.query("UPDATE student_exams SET score=$1 WHERE id=$2", [score, studentExamId]);
  res.json({ score });
});

async function start() {
  try {
    await pool.connect();
    await initDb();
    app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
  } catch (e) {
    console.error("Failed to start server:", e);
    process.exit(1);
  }
}

start();
