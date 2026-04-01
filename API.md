# AmbuSync REST API

Base URL: `http://127.0.0.1:5000` (local) or your deployed backend.

Auth: send `Authorization: Bearer <JWT>` for protected routes.

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Liveness probe |

---

## Authentication

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | `{ "email", "password" }` | Returns `{ token, role, profile }`. Hospital/ambulance must be **approved**. |
| POST | `/api/auth/bootstrap-admin` | `{ "setup_key", "email", "password", "name" }` | One-time admin if `admin_users` empty. `setup_key` defaults to `hackathon-bootstrap` (override with `BOOTSTRAP_SETUP_KEY`). |

JWT payload claims: `sub` (entity id), `role` (`admin` \| `hospital` \| `ambulance`), `email`, `exp`.

---

## Hospital registration (public)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/hospitals/register` | JSON | Creates hospital with `verification_status: pending`. Fields: `email`, `password` (≥8), `name`, `address`, `latitude`, `longitude`, `uhid`, `hospital_type` (`government`\|`private`), `specialization`, `contact_phone`, optional `contact_email` / `specializations`. |

---

## Ambulance registration (public)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/ambulances/register` | **multipart/form-data** | Fields: `email`, `password`, `driver_name`, `ambulance_id`, `vehicle_number`, `license_number`, `ambulance_type` (`BLS`\|`ALS`), optional file `id_proof`. Status `pending` until admin approves. |

---

## Admin (JWT `role: admin`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hospitals/pending` | List hospitals with `verification_status: pending`. |
| GET | `/api/ambulances/pending` | List ambulances with `verification_status: pending`. |
| POST | `/api/admin/hospitals/<public_id>/verification` | JSON `{ "status": "approved"\|"rejected"\|"pending", "note"?: string }` |
| POST | `/api/admin/hospitals/<public_id>/active` | JSON `{ "is_active": boolean }` |
| POST | `/api/admin/ambulances/<ambulance_id>/verification` | Same status shape as hospitals. |
| POST | `/api/admin/ambulances/<ambulance_id>/active` | JSON `{ "is_active": boolean }` |

---

## Public directory (verified only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hospitals` | Verified hospitals for patient/crew dropdowns. |
| GET | `/api/ambulances` | Verified, active ambulances (operational list). |

---

## Patient emergency (no auth)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/emergency-request` | `{ latitude, longitude, brief_symptoms, address_hint?, patient_name?, preferred_hospital_id? }` | Creates request; broadcasts over Socket.IO to ambulance room. |
| GET | `/api/emergency-requests?status=pending` | — | List requests (used by dispatch UI; can be restricted in production). |

---

## Ambulance (JWT `role: ambulance`)

`sub` claim must match `ambulance_id`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/emergency-requests/<request_id>/accept` | `{ "ambulance_id" }` | Only **approved** + **Available** ambulances. |
| POST | `/api/triage-submit` | See `backend/app.py` `api_triage_submit` | Vitals + symptoms; routes to **verified** hospital; notifies hospital room. |

---

## Hospital / admin — cases

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/cases` | `hospital` or `admin` | Recent triage cases. |

---

## Live vitals & ML

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/health/vitals` | No | JSON: `session_id?`, `case_id?`, `heart_rate`, `bp_systolic`, `bp_diastolic`, `temperature_c`, `glucose_mg_dl`. Computes alerts + ML; emits `vitals_update` to **hospital** room. |
| GET | `/api/health/vitals/history?session_id=` | No | Time series for charts. |
| POST | `/api/health/vitals/simulated?bias=0` | No | One random realistic snapshot. |
| POST | `/api/health/demo-stream/start` | No | Starts background 3s demo emitter (thread); hackathon booths. |
| POST | `/api/health/demo-stream/stop` | No | Sets stop flag for new demo threads. |
| GET | `/api/health/report.pdf?session_id=` | `hospital` or `admin` | Downloads PDF report. |

---

## WebSocket (Socket.IO)

Connect to same host as API (path `/socket.io`).

| Event | Payload | Description |
|-------|---------|-------------|
| `join_hospital` | `{ "token": "<JWT>" }` | Requires `hospital` (verified) or `admin`. Joins hospital room. |
| `join_ambulance` | `{ "token": "<JWT>" }` | Requires **verified** `ambulance`. |

Server events include: `cases_snapshot`, `hospital_notified`, `vitals_update`, `requests_snapshot`, `new_emergency_request`, `ambulance_assigned`, `error`.

---

## MongoDB collections (conceptual)

- `admin_users` — platform operators  
- `hospitals` — includes `verification_status`, `public_id`, geo + UHID fields  
- `ambulances` — includes `verification_status`, `ambulance_id`, doc upload path  
- `emergency_requests`, `cases` — dispatch + triage  
- `health_readings` — timestamped vitals history  

---

## Environment variables

See `backend/.env.example` for `SECRET_KEY`, `JWT_SECRET`, `MONGO_URI`, `MONGO_DB_NAME`, `FRONTEND_ORIGIN`, `SEED_ADMIN_*`, `GEMINI_API_KEY`, `BOOTSTRAP_SETUP_KEY`.
