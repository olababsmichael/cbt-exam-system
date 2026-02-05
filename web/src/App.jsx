import React, { useState } from "react";
import axios from "axios";

const API = (import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL + "/api" : "http://localhost:5000/api";

export default function App() {
  const [token, setToken] = useState("");
  const [exams, setExams] = useState([]);
  const [session, setSession] = useState(null);
  const [answers, setAnswers] = useState({});

  async function loginDemo() {
    const r = await axios.post(API + "/auth/login", { email: "student@example.com", password: "pass" });
    setToken(r.data.token);
    axios.defaults.headers.common["Authorization"] = "Bearer " + r.data.token;
    loadExams();
  }

  async function loadExams() {
    const r = await axios.get(API + "/exams");
    setExams(r.data);
  }

  async function startExam(examId) {
    const r = await axios.post(API + `/exams/${examId}/start`);
    // attach examId to session for autosave endpoint
    setSession({ ...r.data, examId });
  }

  function choose(qid, choiceId) {
    setAnswers(a => ({ ...a, [qid]: choiceId }));
    // autosave
    axios.post(API + `/exams/${session.examId}/answer`, { studentExamId: session.studentExamId, questionId: qid, answer: choiceId });
  }

  async function submit() {
    const r = await axios.post(API + `/exams/${session.examId}/submit`, { studentExamId: session.studentExamId });
    alert("Score: " + JSON.stringify(r.data.score));
    setSession(null);
    loadExams();
  }

  if (!token) return <div style={{ padding: 20 }}><button onClick={loginDemo}>Demo Student Login</button></div>;
  if (!session) return (
    <div style={{ padding: 20 }}>
      <h2>Available Exams</h2>
      {exams.map(e => <div key={e.id}><b>{e.title}</b> <button onClick={() => startExam(e.id)}>Start</button></div>)}
    </div>
  );
  return (
    <div style={{ padding: 20 }}>
      <h2>Exam in progress</h2>
      {session.questions.map(q => (
        <div key={q.id}>
          <p>{q.text}</p>
          {q.choices.map(c => (
            <div key={c.id}>
              <label>
                <input type="radio" name={q.id} onChange={() => choose(q.id, c.id)} checked={answers[q.id] === c.id} />
                {c.text}
              </label>
            </div>
          ))}
        </div>
      ))}
      <button onClick={submit}>Submit</button>
    </div>
  );
}
