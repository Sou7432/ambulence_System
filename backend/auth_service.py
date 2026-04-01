"""Password hashing and JWT creation/verification for admin, hospital, and ambulance roles."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET


def hash_password(plain: str) -> str:
    """Hash a password for storage (bcrypt)."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, password_hash: str) -> bool:
    """Check password against stored bcrypt hash."""
    try:
        return bcrypt.checkpw(
            plain.encode("utf-8"), password_hash.encode("utf-8")
        )
    except ValueError:
        return False


def create_token(
    subject_id: str, role: str, email: str, extra: dict | None = None
) -> str:
    """Build a signed JWT with role claim for access control."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject_id,
        "role": role,
        "email": email,
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Validate JWT and return claims."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def generate_idempotency_key() -> str:
    """Random token for patient session / report correlation."""
    return secrets.token_urlsafe(16)
