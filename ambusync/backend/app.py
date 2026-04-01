"""
AmbuSync API + Socket.IO server: verification workflows, live vitals, triage, and hospital routing.
Run from this directory:  python app.py
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from functools import wraps
from io import BytesIO

from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from pymongo.errors import DuplicateKeyError
from werkzeug.utils import secure_filename

from ai_service import generate_summary_and_urgency, normalize_bp_from_form
from auth_service import (
    create_token,
    decode_token,
    generate_idempotency_key,
    hash_password,
    verify_password,
)
from config import (
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_LOGIN_ID,
    DEFAULT_ADMIN_NAME,
    DEFAULT_ADMIN_PASSWORD,
    FRONTEND_ORIGIN,
    PORT,
    SECRET_KEY,
    UPLOAD_DIR,
)

_DEFAULT_CORS = [
    FRONTEND_ORIGIN,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
from hospital_routing import select_hospital_from_verified
from ml_service import predict_abnormal, threshold_alerts
from mongo_store import (
    accept_emergency_request,
    admin_count,
    create_admin_user,
    get_admin_by_login_identifier,
    get_ambulance_by_email,
    get_ambulance_raw_by_id,
    get_case,
    get_emergency_request,
    get_hospital_by_email,
    get_hospital_by_public_id,
    init_indexes,
    insert_case,
    insert_emergency_request,
    insert_health_reading,
    list_ambulances_by_status,
    list_ambulances_verified_active,
    list_cases_for_hospital,
    list_cases_recent,
    list_health_readings_by_case,
    list_emergency_requests,
    list_health_readings,
    list_hospitals_by_status,
    list_hospitals_public_directory,
    list_verified_hospitals_for_routing,
    mark_request_triaged,
    set_case_admitted,
    register_ambulance,
    register_hospital,
    ensure_builtin_admin,
    seed_verified_network,
    set_ambulance_active,
    set_ambulance_status,
    set_ambulance_verification,
    set_hospital_active,
    set_hospital_verification,
    update_ambulance_location,
)
from pdf_service import build_health_pdf
from vitals_simulator import random_reading

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ambusync")

HOSPITAL_ROOM = "hospital"
AMBULANCE_ROOM = "ambulance_crew"

# Loose email check (avoids overly strict HTML5-style rejection on the server).
_EMAIL_OK = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(raw: str) -> str | None:
    s = (raw or "").strip().lower()
    if not s or not _EMAIL_OK.match(s):
        return None
    return s

app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY
CORS(app, origins=list(dict.fromkeys(_DEFAULT_CORS)), supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Demo vitals stream control (in-memory)
_demo_stop = threading.Event()


def _auth_header_token() -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def require_roles(*roles: str):
    """JWT guard: set g.claims on success."""

    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            token = _auth_header_token()
            if not token:
                return jsonify({"error": "Authorization Bearer token required"}), 401
            try:
                claims = decode_token(token)
            except Exception:
                return jsonify({"error": "Invalid or expired token"}), 401
            if roles and claims.get("role") not in roles:
                return jsonify({"error": "Insufficient permissions"}), 403
            g.claims = claims
            return fn(*args, **kwargs)

        return wrapped

    return decorator


def _login_entity(email: str, password: str) -> tuple[dict, str, str] | None:
    """Returns (entity_profile, role, subject_id) or None."""
    raw = (email or "").strip()
    admin = get_admin_by_login_identifier(raw)
    if admin and verify_password(password, admin["password_hash"]):
        profile = {
            "name": admin.get("name"),
            "email": admin["email"],
            "login_id": admin.get("login_id"),
        }
        return profile, "admin", str(admin["_id"])

    email_l = raw.lower()
    hosp = get_hospital_by_email(email_l)
    if hosp and verify_password(password, hosp["password_hash"]):
        if hosp.get("verification_status") != "approved":
            return None  # pending/rejected cannot log in to dashboards
        if not hosp.get("is_active", True):
            return None
        hid = hosp["public_id"]
        profile = {
            "public_id": hid,
            "name": hosp["name"],
            "verification_status": hosp["verification_status"],
        }
        return profile, "hospital", hid

    amb = get_ambulance_by_email(email_l)
    if amb and verify_password(password, amb["password_hash"]):
        if amb.get("verification_status") != "approved" or not amb.get("is_active", True):
            return None
        aid = amb["ambulance_id"]
        profile = {
            "ambulance_id": aid,
            "driver_name": amb.get("driver_name"),
            "ambulance_type": amb.get("ambulance_type"),
        }
        return profile, "ambulance", aid
    return None


@app.post("/api/auth/login")
def api_login():
    data = request.get_json(force=True, silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "email and password required"}), 400
    found = _login_entity(email, password)
    if not found:
        return jsonify({"error": "Invalid credentials or account not verified"}), 401
    profile, role, subject_id = found
    token_email = (
        profile.get("email")
        if isinstance(profile, dict) and profile.get("email")
        else email.lower()
    )
    token = create_token(subject_id, role, str(token_email).lower().strip())
    return jsonify({"ok": True, "token": token, "role": role, "profile": profile})


@app.post("/api/auth/bootstrap-admin")
def api_bootstrap_admin():
    """
    One-time admin creation when database has zero admins.
    Disable in production by removing route or protecting with setup key.
    """
    setup_key = os.environ.get("BOOTSTRAP_SETUP_KEY", "hackathon-bootstrap")
    data = request.get_json(force=True, silent=True) or {}
    if (data.get("setup_key") or "") != setup_key:
        return jsonify({"error": "invalid setup key"}), 403
    if admin_count() > 0:
        return jsonify({"error": "admin already exists"}), 409
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "System").strip()
    login_id = (data.get("login_id") or data.get("admin_id") or "").strip() or None
    if login_id:
        login_id = login_id.lower()
    if not email or len(password) < 8:
        return jsonify({"error": "email and password (min 8 chars) required"}), 400
    create_admin_user(email, hash_password(password), name, login_id=login_id)
    return jsonify({"ok": True, "message": "admin created"})


@app.post("/api/hospitals/register")
def api_hospital_register():
    data = request.get_json(force=True, silent=True) or {}
    required = [
        "email",
        "password",
        "name",
        "address",
        "latitude",
        "longitude",
        "uhid",
        "hospital_type",
        "specialization",
        "contact_phone",
    ]
    for k in required:
        if data.get(k) in (None, ""):
            return jsonify({"error": f"missing field: {k}"}), 400
    if len(str(data.get("password"))) < 8:
        return jsonify({"error": "password min 8 characters"}), 400
    hem = _normalize_email(str(data.get("email", "")))
    if not hem:
        return jsonify({"error": "Enter a valid email address."}), 400
    data["email"] = hem
    if get_hospital_by_email(hem):
        return jsonify({"error": "email already registered"}), 409
    payload = dict(data)
    payload["password_hash"] = hash_password(str(payload.pop("password")))
    try:
        row = register_hospital(payload)
    except DuplicateKeyError:
        return jsonify({"error": "email already registered"}), 409
    except Exception as e:
        logger.exception("hospital register")
        return jsonify({"error": str(e)}), 400

    return jsonify({"ok": True, "hospital": row, "message": "Pending verification"})


@app.post("/api/ambulances/register")
def api_ambulance_register():
    data = request.form.to_dict()
    f = request.files.get("id_proof")
    id_path = None
    if f and f.filename:
        name = secure_filename(f.filename)
        dest = UPLOAD_DIR / f"proof_{generate_idempotency_key()}_{name}"
        f.save(dest)
        id_path = str(dest)

    required = [
        "email",
        "password",
        "driver_name",
        "ambulance_id",
        "vehicle_number",
        "license_number",
        "contact_phone",
        "ambulance_type",
    ]
    for k in required:
        if not (data.get(k) or "").strip():
            return jsonify({"error": f"missing field: {k}"}), 400
    em = _normalize_email(str(data.get("email", "")))
    if not em:
        return jsonify({"error": "Enter a valid email address (e.g. crew@example.com)."}), 400
    data["email"] = em
    if len(str(data.get("password"))) < 8:
        return jsonify({"error": "password min 8 characters"}), 400
    if get_ambulance_raw_by_id(data["ambulance_id"].strip()):
        return jsonify({"error": "ambulance_id already exists"}), 409
    if get_ambulance_by_email(em):
        return jsonify({"error": "email already registered"}), 409

    payload = dict(data)
    payload["password_hash"] = hash_password(str(payload.pop("password")))
    try:
        row = register_ambulance(payload, id_path)
    except DuplicateKeyError:
        return jsonify({"error": "duplicate email or ambulance_id"}), 409
    except Exception as e:
        logger.exception("ambulance register")
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True, "ambulance": row, "message": "Pending verification"})


@app.get("/api/hospitals/pending")
@require_roles("admin")
def api_hospitals_pending():
    rows = [h for h in list_hospitals_by_status("pending")]
    return jsonify({"hospitals": rows})


@app.get("/api/ambulances/pending")
@require_roles("admin")
def api_ambulances_pending():
    rows = list_ambulances_by_status("pending")
    return jsonify({"ambulances": rows})


@app.post("/api/admin/hospitals/<public_id>/verification")
@require_roles("admin")
def api_admin_hospital_verify(public_id):
    data = request.get_json(force=True, silent=True) or {}
    status = (data.get("status") or "").strip().lower()
    note = (data.get("note") or "").strip()
    if status not in ("approved", "rejected", "pending"):
        return jsonify({"error": "status must be approved|rejected|pending"}), 400
    row = set_hospital_verification(public_id, status, note)
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "hospital": row})


@app.post("/api/admin/hospitals/<public_id>/active")
@require_roles("admin")
def api_admin_hospital_active(public_id):
    data = request.get_json(force=True, silent=True) or {}
    active = bool(data.get("is_active", True))
    row = set_hospital_active(public_id, active)
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "hospital": row})


@app.post("/api/admin/ambulances/<ambulance_id>/verification")
@require_roles("admin")
def api_admin_ambulance_verify(ambulance_id):
    data = request.get_json(force=True, silent=True) or {}
    status = (data.get("status") or "").strip().lower()
    note = (data.get("note") or "").strip()
    if status not in ("approved", "rejected", "pending"):
        return jsonify({"error": "status must be approved|rejected|pending"}), 400
    row = set_ambulance_verification(ambulance_id, status, note)
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "ambulance": row})


@app.post("/api/admin/ambulances/<ambulance_id>/active")
@require_roles("admin")
def api_admin_ambulance_active(ambulance_id):
    data = request.get_json(force=True, silent=True) or {}
    active = bool(data.get("is_active", True))
    row = set_ambulance_active(ambulance_id, active)
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "ambulance": row})


@app.get("/api/hospitals")
def api_hospitals_public():
    return jsonify({"hospitals": list_hospitals_public_directory()})


@app.get("/api/ambulances")
def api_ambulances_public():
    """Only approved ambulances are visible to operational UI."""
    return jsonify({"ambulances": list_ambulances_verified_active()})


@app.get("/api/emergency-requests")
def api_emergency_requests():
    status = request.args.get("status")
    return jsonify({"requests": list_emergency_requests(status)})


@app.post("/api/emergency-request")
def api_create_emergency_request():
    """Patient-facing: no authentication."""
    data = request.get_json(force=True, silent=True) or {}
    try:
        lat = float(data.get("latitude"))
        lng = float(data.get("longitude"))
    except (TypeError, ValueError):
        return jsonify({"error": "latitude and longitude are required"}), 400
    brief = (data.get("brief_symptoms") or data.get("symptoms") or "").strip()
    if not brief:
        return jsonify({"error": "brief_symptoms is required"}), 400
    row = {
        "latitude": lat,
        "longitude": lng,
        "address_hint": (data.get("address_hint") or "").strip(),
        "brief_symptoms": brief,
        "patient_name": (data.get("patient_name") or "").strip(),
        "preferred_hospital_id": (data.get("preferred_hospital_id") or "").strip()
        or None,
    }
    rid = insert_emergency_request(row)
    req = get_emergency_request(rid)
    socketio.emit("new_emergency_request", req, room=AMBULANCE_ROOM)
    return jsonify({"ok": True, "request": req})


@app.post("/api/emergency-requests/<request_id>/accept")
@require_roles("ambulance")
def api_accept_request(request_id):
    data = request.get_json(force=True, silent=True) or {}
    ambulance_id = (data.get("ambulance_id") or "").strip()
    if not ambulance_id or ambulance_id != g.claims.get("sub"):
        return jsonify({"error": "ambulance_id must match authenticated crew"}), 403
    updated = accept_emergency_request(request_id, ambulance_id)
    if not updated:
        return jsonify({"error": "Request not pending or ambulance unavailable"}), 409
    amb = get_ambulance_raw_by_id(ambulance_id)
    amb_out = None
    if amb:
        amb_out = {k: v for k, v in amb.items() if k != "password_hash"}
        if "_id" in amb_out:
            amb_out["_id"] = str(amb_out["_id"])
    payload = {"request": updated, "ambulance": amb_out}
    socketio.emit("ambulance_assigned", payload, room=AMBULANCE_ROOM)
    return jsonify({"ok": True, **payload})


@app.post("/api/triage-submit")
@require_roles("ambulance")
def api_triage_submit():
    data = request.get_json(force=True, silent=True) or {}
    request_id = str(data.get("request_id") or "")
    if not request_id:
        return jsonify({"error": "request_id is required"}), 400
    ambulance_id = (data.get("ambulance_id") or "").strip()
    if ambulance_id != g.claims.get("sub"):
        return jsonify({"error": "ambulance_id must match authenticated crew"}), 403

    req = get_emergency_request(request_id)
    if not req:
        return jsonify({"error": "Unknown request"}), 404
    if req["status"] != "accepted":
        return jsonify({"error": "Request must be accepted before triage"}), 400
    if (req.get("accepted_by_ambulance_id") or "") != ambulance_id:
        return jsonify({"error": "This crew did not accept this request"}), 403

    patient_name = (data.get("patient_name") or "").strip()
    if not patient_name:
        return jsonify({"error": "patient_name is required"}), 400
    try:
        age = int(data.get("age"))
    except (TypeError, ValueError):
        return jsonify({"error": "age must be a number"}), 400
    symptoms = (data.get("symptoms") or "").strip()
    if not symptoms:
        return jsonify({"error": "symptoms are required"}), 400

    bp_sys_raw = data.get("bp_systolic")
    bp_dia_raw = data.get("bp_diastolic")
    if bp_sys_raw is not None and bp_dia_raw is not None:
        try:
            bp_sys, bp_dia = int(bp_sys_raw), int(bp_dia_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "bp systolic/diastolic must be numbers"}), 400
    else:
        bp_raw = data.get("blood_pressure") or data.get("bp") or ""
        try:
            bp_sys, bp_dia = normalize_bp_from_form(str(bp_raw))
        except Exception:
            return jsonify({"error": "invalid blood pressure"}), 400

    try:
        pulse = int(data.get("pulse"))
        spo2 = int(data.get("spo2"))
    except (TypeError, ValueError):
        return jsonify({"error": "pulse and spo2 must be numbers"}), 400

    consciousness = (data.get("consciousness") or "").strip() or "Alert"
    sex = (data.get("sex") or "").strip()

    lat = data.get("latitude")
    lng = data.get("longitude")
    try:
        latitude = float(lat) if lat not in (None, "") else float(req["latitude"])
        longitude = float(lng) if lng not in (None, "") else float(req["longitude"])
    except (TypeError, ValueError):
        latitude, longitude = float(req["latitude"]), float(req["longitude"])

    address_hint = (data.get("address_hint") or "").strip() or (
        req.get("address_hint") or ""
    )
    crew_preferred = (data.get("preferred_hospital_id") or "").strip() or None
    preferred = crew_preferred or (
        (req.get("preferred_hospital_id") or "").strip() or None
    )

    payload_ai = {
        "patient_name": patient_name,
        "age": age,
        "sex": sex,
        "symptoms": symptoms,
        "bp_systolic": bp_sys,
        "bp_diastolic": bp_dia,
        "pulse": pulse,
        "spo2": spo2,
        "consciousness": consciousness,
    }
    summary, urgency = generate_summary_and_urgency(payload_ai)

    verified = list_verified_hospitals_for_routing()
    if not verified:
        return jsonify({"error": "No verified hospitals available for routing"}), 503
    try:
        hospital, reason = select_hospital_from_verified(
            verified,
            symptoms,
            urgency,
            latitude,
            longitude,
            preferred,
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 503

    vitals_session_id = str(uuid.uuid4())
    row = {
        "request_id": request_id,
        "ambulance_id": ambulance_id,
        "patient_name": patient_name,
        "age": age,
        "sex": sex,
        "symptoms": symptoms,
        "bp_systolic": bp_sys,
        "bp_diastolic": bp_dia,
        "pulse": pulse,
        "spo2": spo2,
        "consciousness": consciousness,
        "latitude": latitude,
        "longitude": longitude,
        "address_hint": address_hint,
        "summary": summary,
        "urgency": urgency,
        "hospital_id": hospital["public_id"],
        "hospital_name": hospital["name"],
        "hospital_selection_reason": reason,
        "vitals_session_id": vitals_session_id,
    }
    case_id = insert_case(row)
    row["id"] = case_id
    row["vitals_session_id"] = vitals_session_id
    row["admission_status"] = "incoming"
    row["created_at"] = datetime.now(timezone.utc).isoformat()

    mark_request_triaged(request_id)
    # Crew stays busy until the receiving hospital marks the patient admitted (frees ambulance).

    notify = {
        "case": row,
        "hospital": {

            "id": hospital["public_id"],
            "name": hospital["name"],
            "distance_km": hospital.get("distance_km"),
            "specializations": hospital.get("specializations", []),
        },
        "selection_reason": reason,
        "request_id": request_id,
    }
    socketio.emit(
        "hospital_notified", notify, room=f"hospital_{hospital['public_id']}"
    )

    return jsonify({"ok": True, **notify})


@app.get("/api/cases")
@require_roles("hospital", "admin")
def api_cases():
    if g.claims.get("role") == "hospital":
        hid = g.claims.get("sub")
        return jsonify({"cases": list_cases_for_hospital(hid, 120)})
    return jsonify({"cases": list_cases_recent(120)})


@app.post("/api/cases/<case_id>/admit")
@require_roles("hospital")
def api_case_admit(case_id):
    hid = g.claims.get("sub")
    updated = set_case_admitted(case_id, hid)
    if not updated:
        return jsonify({"error": "case not found or not assigned to your hospital"}), 404
    socketio.emit("case_admitted", {"case": updated}, room=f"hospital_{hid}")
    return jsonify({"ok": True, "case": updated})


@app.post("/api/ambulances/me/location")
@require_roles("ambulance")
def api_ambulance_location():
    data = request.get_json(force=True, silent=True) or {}
    try:
        lat = float(data.get("latitude"))
        lng = float(data.get("longitude"))
    except (TypeError, ValueError):
        return jsonify({"error": "latitude and longitude required"}), 400
    aid = g.claims.get("sub")
    update_ambulance_location(aid, lat, lng)
    payload = {
        "ambulance_id": aid,
        "latitude": lat,
        "longitude": lng,
    }
    socketio.emit("ambulance_location", payload, room=HOSPITAL_ROOM)
    socketio.emit("ambulance_location", payload, room=AMBULANCE_ROOM)
    return jsonify({"ok": True, **payload})


# --- Live vitals + ML ---


@app.post("/api/health/vitals")
def api_post_vitals():
    """
    Ingest one reading (simulator or device). Stores history + broadcasts to verified hospitals.
    """
    data = request.get_json(force=True, silent=True) or {}
    session_id = (data.get("session_id") or "").strip() or generate_idempotency_key()
    case_id = (data.get("case_id") or "").strip() or None
    reading = {
        "heart_rate": data.get("heart_rate"),
        "bp_systolic": data.get("bp_systolic"),
        "bp_diastolic": data.get("bp_diastolic"),
        "temperature_c": data.get("temperature_c"),
        "glucose_mg_dl": data.get("glucose_mg_dl"),
    }
    hist = list_health_readings(session_id, limit=80)
    plain_hist = [
        {
            "heart_rate": h.get("heart_rate"),
            "bp_systolic": h.get("bp_systolic"),
            "bp_diastolic": h.get("bp_diastolic"),
            "temperature_c": h.get("temperature_c"),
            "glucose_mg_dl": h.get("glucose_mg_dl"),
        }
        for h in hist
    ]
    alerts = threshold_alerts(reading)
    ml = predict_abnormal(reading, plain_hist)
    stored = {
        **reading,
        "alerts": alerts + (ml.get("reasons") or []),
        "ml_abnormal": ml["abnormal"],
        "ml_details": ml,
    }
    doc = insert_health_reading(session_id, stored, case_id)
    socketio.emit("vitals_update", doc, room=HOSPITAL_ROOM)
    return jsonify({"ok": True, "session_id": session_id, "reading": doc})


@app.get("/api/health/vitals/history")
def api_vitals_history():
    sid = (request.args.get("session_id") or "").strip()
    cid = (request.args.get("case_id") or "").strip()
    if cid:
        return jsonify({"readings": list_health_readings_by_case(cid)})
    if not sid:
        return jsonify({"error": "session_id or case_id required"}), 400
    return jsonify({"readings": list_health_readings(sid)})


@app.post("/api/health/vitals/simulated")
def api_vitals_simulated():
    """Return one realistic random snapshot (client may POST it to /api/health/vitals)."""
    bias = bool(request.args.get("bias"))
    return jsonify({"ok": True, "reading": random_reading(bias_abnormal=bias)})


@app.post("/api/health/demo-stream/start")
def api_demo_stream_start():
    """Background demo publisher for hackathon booths (optional)."""
    global _demo_stop
    if _demo_stop.is_set():
        _demo_stop = threading.Event()

    def run():
        session = generate_idempotency_key()
        while not _demo_stop.is_set():
            reading = random_reading(bias_abnormal=False)
            hist = list_health_readings(session, limit=80)
            plain_hist = [
                {
                    "heart_rate": h.get("heart_rate"),
                    "bp_systolic": h.get("bp_systolic"),
                    "bp_diastolic": h.get("bp_diastolic"),
                    "temperature_c": h.get("temperature_c"),
                    "glucose_mg_dl": h.get("glucose_mg_dl"),
                }
                for h in hist
            ]
            alerts = threshold_alerts(reading)
            ml = predict_abnormal(reading, plain_hist)
            stored = {
                **reading,
                "alerts": alerts + (ml.get("reasons") or []),
                "ml_abnormal": ml["abnormal"],
                "ml_details": ml,
            }
            doc = insert_health_reading(session, stored, None)
            socketio.emit("vitals_update", doc, room=HOSPITAL_ROOM)
            time.sleep(3)

    threading.Thread(target=run, daemon=True).start()
    return jsonify(
        {"ok": True, "message": "Demo stream started (3s interval). Use /demo-stream/stop to halt flag for new threads only."}
    )


@app.post("/api/health/demo-stream/stop")
def api_demo_stream_stop():
    _demo_stop.set()
    return jsonify({"ok": True})


@app.get("/api/health/report.pdf")
@require_roles("hospital", "admin")
def api_health_pdf():
    sid = (request.args.get("session_id") or "").strip()
    if not sid:
        return jsonify({"error": "session_id required"}), 400
    readings = list(reversed(list_health_readings(sid, limit=120)))
    summary = [
        f"Total samples: {len(readings)}",
        "Threshold-based alerts and sklearn anomaly detection included in rows.",
    ]
    pdf_bytes = build_health_pdf(
        "Live monitoring session export", sid, readings, summary
    )
    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"ambusync-health-{sid[:8]}.pdf",
    )


@app.get("/")
def root():
    """
    This process is the REST + Socket.IO API. The React dashboard is served by Vite
    (see frontend/). Hitting / in the browser used to 404 — this explains what to open.
    """
    return jsonify({
        "service": "AmbuSync-API",
        "hint": "Web UI: run `npm run dev` in `frontend/` and open http://localhost:5173",
        "health": "/api/health",
    })


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "AmbuSync-API"})


def _socket_claims(data: dict) -> dict | None:
    token = (data or {}).get("token")
    if not token:
        return None
    try:
        return decode_token(token)
    except Exception:
        return None


@socketio.on("join_hospital")
def on_join_hospital(data):
    claims = _socket_claims(data or {})
    if not claims or claims.get("role") not in ("hospital", "admin"):
        emit("error", {"message": "hospital/admin token required"})
        return
    if claims.get("role") == "hospital":
        hosp = get_hospital_by_public_id(claims.get("sub"))
        if not hosp or hosp.get("verification_status") != "approved":
            emit("error", {"message": "hospital not verified"})
            return
        join_room(HOSPITAL_ROOM)
        join_room(f"hospital_{hosp['public_id']}")
        emit(
            "cases_snapshot",
            {"cases": list_cases_for_hospital(hosp["public_id"], 80)},
        )
    else:
        join_room(HOSPITAL_ROOM)
        emit("cases_snapshot", {"cases": list_cases_recent(50)})
    emit("vitals_snapshot", {"message": "Subscribed to live vitals"})


@socketio.on("join_ambulance")
def on_join_ambulance(data):
    claims = _socket_claims(data or {})
    if not claims or claims.get("role") != "ambulance":
        emit("error", {"message": "ambulance token required"})
        return
    amb = get_ambulance_raw_by_id(claims.get("sub"))
    if not amb or amb.get("verification_status") != "approved":
        emit("error", {"message": "ambulance not verified"})
        return
    join_room(AMBULANCE_ROOM)
    emit("requests_snapshot", {"requests": list_emergency_requests("pending")})
    emit(
        "ambulances_snapshot", {"ambulances": list_ambulances_verified_active()}
    )


def init_app():
    """
    Connect to MongoDB and ensure indexes / demo data.
    Warns instead of crashing if Mongo is not up yet (e.g. first local start).
    """
    try:
        init_indexes()
        seed_verified_network()
        adm = os.environ.get("SEED_ADMIN_EMAIL")
        pw = os.environ.get("SEED_ADMIN_PASSWORD")
        if adm and pw and admin_count() == 0:
            lid = (os.environ.get("SEED_ADMIN_LOGIN_ID") or "").strip().lower() or None
            create_admin_user(
                adm.lower().strip(), hash_password(pw), "Seed Admin", login_id=lid
            )
            logger.info("Seeded admin user %s", adm)
        ensure_builtin_admin(
            DEFAULT_ADMIN_EMAIL,
            DEFAULT_ADMIN_PASSWORD,
            DEFAULT_ADMIN_NAME,
            DEFAULT_ADMIN_LOGIN_ID,
        )
    except Exception as e:
        logger.warning(
            "MongoDB not ready — start Mongo (see README) and restart. %s", e
        )


init_app()


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=PORT,
        debug=os.environ.get("FLASK_DEBUG") == "1",
        allow_unsafe_werkzeug=True,
    )
