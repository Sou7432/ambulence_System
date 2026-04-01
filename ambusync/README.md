# AmbuSync — Live health monitoring & verified emergency network

Full-stack demo: **React + Tailwind + Recharts** frontend, **Flask + Socket.IO + MongoDB** backend, **scikit-learn** vitals scoring, **JWT** auth for staff, **admin verification** for hospitals and ambulances, **patient ambulance requests without login**, and **PDF** health exports.

## Folder structure

```text
ambusync/
├── backend/                 # Python API + WebSockets + ML + PDF
│   ├── app.py               # Routes, Socket.IO, access control
│   ├── mongo_store.py       # MongoDB collections & seed data
│   ├── auth_service.py      # bcrypt + JWT
│   ├── ai_service.py        # Triage summary / urgency (optional Gemini)
│   ├── ml_service.py        # Threshold alerts + IsolationForest + trend
│   ├── pdf_service.py       # Reportlab-style PDF via fpdf2
│   ├── hospital_routing.py  # Verified-hospital selection
│   ├── vitals_simulator.py  # Synthetic vitals
│   ├── config.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/                # Vite + React + TypeScript
│   ├── src/
│   │   ├── pages/           # Landing, patient request, dashboards, signup
│   │   ├── api/client.ts
│   │   └── context/AuthContext.tsx
│   ├── package.json
│   └── vite.config.ts       # Dev proxy → backend :5000
├── docker-compose.yml       # Local MongoDB
├── API.md                   # REST reference
└── README.md
```

Legacy Jinja `app.py` / SQLite files at repo root are **not** used by this stack; run the app from **`backend/`**.

## Prerequisites

- Python **3.11+**
- **Node.js 18+** and npm (for the frontend)
- **MongoDB** (local via Docker or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))

## Run locally (step by step)

### 1. Start MongoDB

```bash
docker compose up -d mongo
```

Or set `MONGO_URI` to your Atlas connection string in `backend/.env`.

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env` and edit secrets.

Optional: set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env` to create the first admin on startup when the DB is empty.

Or create an admin via HTTP:

```bash
curl -X POST http://127.0.0.1:5000/api/auth/bootstrap-admin ^
  -H "Content-Type: application/json" ^
  -d "{\"setup_key\":\"hackathon-bootstrap\",\"email\":\"admin@example.com\",\"password\":\"YourLongPassword\",\"name\":\"Ops Admin\"}"
```

Run the server:

```bash
python app.py
```

API listens on **http://127.0.0.1:5000** (override with `PORT`).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` and `/socket.io` to the backend.

### 4. Demo accounts (after first seed)

If no approved hospitals exist, the backend inserts demo **verified** hospitals and ambulances (password for hospital emails / ambulance emails: **`Demo123!`**):

| Role       | Email                   | Password  |
|------------|-------------------------|-----------|
| Hospital   | `cardiac@hospital.demo` | `Demo123!`|
| Ambulance  | `crew.als01@amb.demo`   | `Demo123!`|

Create your own admin first (bootstrap or `SEED_ADMIN_*`), then use **Admin** dashboard to approve new registrations.

**Patient flow:** Home → **Request Ambulance** — no login.

## Features (checklist)

- Live vitals ingestion, charts, threshold alerts, sklearn anomaly + trend notes
- Socket.IO: `vitals_update`, `hospital_notified`, emergency queue snapshots
- Hospital & ambulance registration with `verification_status`: pending / approved / rejected
- Admin approve/reject; only **approved** hospitals receive cases and vitals streams; only **approved** ambulances can accept jobs
- Downloadable **PDF** reports (`/api/health/report.pdf`) for hospital/admin JWT
- Optional **Gemini** triage text if `GEMINI_API_KEY` is set
- **Note:** Uninstall legacy `PyFPDF` if `fpdf2` warns about conflicting `fpdf` namespace:  
  `pip uninstall pypdf PyFPDF` then `pip install -U fpdf2`

## Deployment

### Frontend — Vercel

1. Root directory: `frontend`
2. Build command: `npm run build`
3. Output directory: `dist`
4. Environment variable: `VITE_API_URL=https://your-backend.onrender.com` (no trailing slash)

### Backend — Render / Railway

1. Root directory: `backend`
2. Start command: `python app.py` (or `gunicorn` + eventlet worker for production Socket.IO — see Flask-SocketIO deployment docs)
3. Set env vars from `.env.example` and **production** `SECRET_KEY` / `JWT_SECRET`
4. Ensure MongoDB URI points to Atlas or managed Mongo

CORS is configured via `FRONTEND_ORIGIN` to match your Vercel URL.

## Documentation

See **[API.md](./API.md)** for REST endpoints and payloads.

## License / disclaimer

Educational and hackathon use. Not a medical device; do not use for real clinical decisions.
