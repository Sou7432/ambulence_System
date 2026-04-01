"""
AmbuSync API + Socket.IO server (Render-ready)
"""
import eventlet
eventlet.monkey_patch()

from __future__ import annotations
import logging
import os
import re
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO
from config import FRONTEND_ORIGIN, SECRET_KEY, UPLOAD_DIR
from mongo_store import init_indexes, seed_verified_network, ensure_builtin_admin

from auth_service import decode_token

# ✅ Render PORT
PORT = int(os.environ.get("PORT", 5000))
MONGO_URI = os.environ.get("MONGO_URI", None)
if not MONGO_URI:
    raise RuntimeError("MONGO_URI environment variable is required!")

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ambusync")

_EMAIL_OK = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def _normalize_email(raw: str) -> str | None:
    s = (raw or "").strip().lower()
    if not s or not _EMAIL_OK.match(s):
        return None
    return s

# 🚀 Flask App
app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY

# ✅ CORS
CORS(app, origins=[FRONTEND_ORIGIN], supports_credentials=True)

# ✅ SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# ================= AUTH =================
def _auth_header_token():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None

def require_roles(*roles):
    def decorator(fn):
        from functools import wraps
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
        # Initialize MongoDB connection
        from mongo_store import connect_mongo
        connect_mongo(MONGO_URI)

        init_indexes()
        seed_verified_network()

        # Admin credentials from ENV
        ensure_builtin_admin(
            os.environ.get("ADMIN_EMAIL"),
            os.environ.get("ADMIN_PASSWORD"),
            os.environ.get("ADMIN_NAME"),
            os.environ.get("ADMIN_LOGIN_ID"),
        )
        logger.info("Initialization complete!")
    except Exception as e:
        logger.warning("MongoDB not ready or init failed: %s", e)

init_app()

# ================= ENTRY =================
if __name__ == "__main__":
    # 👉 Local dev
    socketio.run(
        app,
        host="0.0.0.0",
        port=PORT,
        debug=True
    )
