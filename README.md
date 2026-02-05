<<<<<<< HEAD
# cbt-exam-system
=======
﻿# CBT Exam System

This repository contains a Computer-Based Testing (CBT) system prototype:
- Backend: Node.js + Express + PostgreSQL
- Frontend: React + Vite
- DB: Postgres (docker-compose)
- CI: GitHub Actions workflow

Quick start (dev, Windows):
1. Ensure Docker Desktop is running (for PostgreSQL) or provide a DATABASE_URL to a Postgres instance.
2. In PowerShell:
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   cd cbt-exam-system
   # Install server deps
   cd server
   npm install
   # Install web deps
   cd ../web
   npm install

3. Start the DB and services with Docker (optional):
   docker-compose up -d

4. Initialize the database (server auto-creates schema & demo users on first run if DB is reachable), then start:
   cd server
   npm start

5. Frontend:
   cd ../web
   npm run dev

Demo accounts (seeded on first server start if DB empty):
- Admin: admin@example.com / adminpass
- Student: student@example.com / pass

See the README in the repo for full instructions and next steps.
>>>>>>> b6dff0a (Initial commit: CBT exam system scaffold)
