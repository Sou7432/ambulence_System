"""
AmbuSync – AI Ambulance Triage System
Patient request → Ambulance acceptance → Vitals & AI triage → Hospital routing
"""

import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO, emit, join_room

from ai_service import generate_summary_and_urgency, normalize_bp_from_form
from database import (
    accept_emergency_request,
    get_ambulance,
    insert_case,
    insert_emergency_request,
    list_ambulances,
    list_cases_recent,
    list_emergency_requests,
    get_emergency_request,
    mark_request_triaged,
    set_ambulance_status,
    init_db,
)
from hospital_selector import list_hospitals_public, select_hospital

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "ambusync-dev-change-me")

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

HOSPITAL_ROOM = "hospital"
AMBULANCE_ROOM = "ambulance_crew"


def _maps_key():
    return os.environ.get("GOOGLE_MAPS_API_KEY", "").strip() or None


@app.route("/")
def patient_home():
    return render_template("patient_request.html", maps_key=_maps_key())


@app.route("/ambulance")
def ambulance_page():
    return render_template("ambulance.html", maps_key=_maps_key())


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "AmbuSync"})


@app.get("/api/hospitals")
def api_hospitals():
    return jsonify({"hospitals": list_hospitals_public()})


@app.get("/api/ambulances")
def api_ambulances():
    return jsonify({"ambulances": list_ambulances()})


@app.get("/api/emergency-requests")
def api_emergency_requests():
    status = request.args.get("status")
    return jsonify({"requests": list_emergency_requests(status)})


@app.post("/api/emergency-request")
def api_create_emergency_request():
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
        "preferred_hospital_id": (data.get("preferred_hospital_id") or "").strip() or None,
    }
    rid = insert_emergency_request(row)
    req = get_emergency_request(rid)
    socketio.emit("new_emergency_request", req, room=AMBULANCE_ROOM)
    return jsonify({"ok": True, "request": req})


@app.post("/api/emergency-requests/<int:request_id>/accept")
def api_accept_request(request_id):
    data = request.get_json(force=True, silent=True) or {}
    ambulance_id = (data.get("ambulance_id") or "").strip()
    if not ambulance_id:
        return jsonify({"error": "ambulance_id is required"}), 400

    updated = accept_emergency_request(request_id, ambulance_id)
    if not updated:
        return jsonify(
            {"error": "Request not pending or ambulance unavailable"}
        ), 409

    amb = get_ambulance(ambulance_id)
    payload = {"request": updated, "ambulance": amb}
    socketio.emit("ambulance_assigned", payload, room=AMBULANCE_ROOM)
    return jsonify({"ok": True, **payload})


@app.post("/api/triage-submit")
def api_triage_submit():
    data = request.get_json(force=True, silent=True) or {}

    try:
        request_id = int(data.get("request_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "request_id is required"}), 400

    ambulance_id = (data.get("ambulance_id") or "").strip()
    if not ambulance_id:
        return jsonify({"error": "ambulance_id is required"}), 400

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
        latitude = float(lat) if lat not in (None, "") else req["latitude"]
        longitude = float(lng) if lng not in (None, "") else req["longitude"]
    except (TypeError, ValueError):
        latitude, longitude = req["latitude"], req["longitude"]

    address_hint = (data.get("address_hint") or "").strip() or (
        req.get("address_hint") or ""
    )

    crew_preferred = (data.get("preferred_hospital_id") or "").strip() or None
    preferred = crew_preferred or (
        (req.get("preferred_hospital_id") or "").strip() or None
    )
    if preferred == "":
        preferred = None

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

    hospital, reason = select_hospital(
        symptoms,
        urgency,
        req["latitude"],
        req["longitude"],
        preferred,
    )

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
        "hospital_id": hospital["id"],
        "hospital_name": hospital["name"],
        "hospital_selection_reason": reason,
    }
    case_id = insert_case(row)
    row["id"] = case_id
    row["created_at"] = datetime.now(timezone.utc).isoformat()

    mark_request_triaged(request_id)
    set_ambulance_status(ambulance_id, "Available")

    notify = {
        "case": row,
        "hospital": {
            "id": hospital["id"],
            "name": hospital["name"],
            "distance_km": hospital.get("distance_km"),
            "specializations": hospital.get("specializations", []),
        },
        "selection_reason": reason,
        "request_id": request_id,
    }
    socketio.emit("hospital_notified", notify, room=HOSPITAL_ROOM)

    return jsonify({"ok": True, **notify})


@app.get("/api/cases")
def api_cases():
    return jsonify({"cases": list_cases_recent(50)})


@socketio.on("connect")
def on_connect():
    pass


@socketio.on("join_hospital")
def on_join_hospital():
    join_room(HOSPITAL_ROOM)
    emit("cases_snapshot", {"cases": list_cases_recent(50)})


@socketio.on("join_ambulance")
def on_join_ambulance():
    join_room(AMBULANCE_ROOM)
    emit(
        "requests_snapshot",
        {"requests": list_emergency_requests("pending")},
    )
    emit("ambulances_snapshot", {"ambulances": list_ambulances()})


init_db()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=True, allow_unsafe_werkzeug=True)
