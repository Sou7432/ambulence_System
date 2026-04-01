"""
AmbuSync API + Socket.IO server (Render-ready)
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
    SECRET_KEY,
    UPLOAD_DIR,
)

from hospital_routing import select_hospital_from_verified
from ml_service import predict_abnormal, threshold_alerts
from mongo_store import *
from pdf_service import build_health_pdf
from vitals_simulator import random_reading

# ✅ IMPORTANT: use env PORT
PORT = int(os.environ.get("PORT", 5000))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ambusync")

HOSPITAL_ROOM = "hospital"
AMBULANCE_ROOM = "ambulance_crew"

_EMAIL_OK = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def _normalize_email(raw: str) -> str | None:
    s = (raw or "").strip().lower()
    if not s or not _EMAIL_OK.match(s):
        return None
    return s


# 🚀 Flask App
app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY

# ✅ CORS (important for Vercel)
CORS(app, origins=[FRONTEND_ORIGIN], supports_credentials=True)

# ✅ IMPORTANT: remove threading mode
socketio = SocketIO(app, cors_allowed_origins="*")


# ================= AUTH =================

def _auth_header_token():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def require_roles(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            token = _auth_header_token()
            if not token:
                return jsonify({"error": "Authorization required"}), 401
            try:
                claims = decode_token(token)
            except Exception:
                return jsonify({"error": "Invalid token"}), 401
            if roles and claims.get("role") not in roles:
                return jsonify({"error": "Forbidden"}), 403
            g.claims = claims
            return fn(*args, **kwargs)
        return wrapped
    return decorator


# ================= ROUTES =================

@app.get("/")
def root():
    return jsonify({
        "service": "AmbuSync API",
        "status": "running",
        "health": "/api/health"
    })


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


# ================= SOCKET =================

@socketio.on("connect")
def handle_connect():
    print("Client connected")


@socketio.on("disconnect")
def handle_disconnect():
    print("Client disconnected")


# ================= INIT =================

def init_app():
    try:
        init_indexes()
        seed_verified_network()
        ensure_builtin_admin(
            DEFAULT_ADMIN_EMAIL,
            DEFAULT_ADMIN_PASSWORD,
            DEFAULT_ADMIN_NAME,
            DEFAULT_ADMIN_LOGIN_ID,
        )
    except Exception as e:
        logger.warning("MongoDB not ready: %s", e)


init_app()


# ================= ENTRY =================

if __name__ == "__main__":
    # 👉 For LOCAL only
    socketio.run(
        app,
        host="0.0.0.0",
        port=PORT,
        debug=True
    )
