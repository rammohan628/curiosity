# Curiosity

Curiosity is an AI-powered classroom platform that helps teachers create timed learning activities, attach PDF study material, and let students chat with a private AI tutor grounded in that document. The application is built with React, FastAPI, MySQL, and the OpenAI API.

## Why this project exists
Teachers can upload a PDF, create an activity, and assign it to students. Students then interact with a personalized AI tutor that uses the PDF as the primary source of truth while staying within tight prompt and time limits. Admins and teachers can manage accounts, review usage costs, and inspect student prompt quality across activities.

## Key features
- Role-based access for admin, teacher, and student users
- Teacher-created activities with duration limits and prompt caps
- Private AI chat session for each student per activity
- PDF upload support and AI grounding from the uploaded document
- Prompt analysis to evaluate relevance, depth, and focus
- AI usage tracking with token and cost reporting
- CSV student import and downloadable password generation
- Enforced first-login password changes for temporary accounts
- MySQL-backed persistence with automatic schema creation on startup
- Server-side authentication and session handling

## Tech stack
- Frontend: React + Vite
- Backend: FastAPI + SQLAlchemy
- Database: MySQL 8
- AI: OpenAI Responses and Files APIs
- Containerization: Docker Compose

## Project structure

```text
curiosity/
├── backend/
│   ├── .env.example
│   ├── main.py
│   ├── requirements.txt
│   ├── schema.sql
│   └── uploads/
├── frontend/
│   ├── package.json
│   ├── src/
│   ├── index.html
│   └── vite.config.js
├── docker-compose.yml
├── design_doc
├── README.md
└── .gitignore
```

## Prerequisites
- Python 3.10+
- Node.js 18+
- MySQL 8 or Docker Desktop / Docker Engine
- OpenAI API key

## Getting started

### 1) Clone the project

```bash
git clone <your-repo-url>
cd curiosity
```

### 2) Start the database

```bash
docker compose up -d
```

This starts the MySQL container defined in [docker-compose.yml](docker-compose.yml).

### 3) Configure the backend environment

```bash
cp backend/.env.example backend/.env
```

Then update the values in [backend/.env](backend/.env) with your actual OpenAI key and database settings.

### 4) Run the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.

### 5) Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in the browser.

## Default login
On first run, the app creates a default admin user if none exists:

- Username: `admin`
- Password: `Admin@12345`

You are required to change the password immediately after signing in.

## Admin and teacher workflow
- Admins can manage users and system settings.
- Teachers can create activities, manage their students, and review AI usage.
- Students can join activities and chat in a private, document-grounded session.

## Cost and AI reporting
Every major AI interaction stores model metadata, token usage, and cost. Teachers can review cost data per activity and per student, ideal for monitoring usage and learning quality.

## Important notes
- The app creates database tables automatically at startup.
- Passwords are hashed with PBKDF2-SHA256.
- Authentication tokens are stored server-side and expire after 12 hours.
- The uploads directory holds uploaded PDFs and should be backed up alongside the MySQL database.

## License
This project is provided as-is for educational and internal use.

## Contributor notes
The design and architecture notes live in [design_doc](design_doc).
