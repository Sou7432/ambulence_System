"""SQLite persistence: emergency requests, ambulances, patient cases."""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "ambusync.db"


def _ensure_dir():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _table_columns(conn, table: str) -> set[str]:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cur.fetchall()}


def _add_column_if_missing(conn, table: str, name: str, coltype: str):
    cols = _table_columns(conn, table)
    if name not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {coltype}")


def init_db():
    _ensure_dir()
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ambulances (
                ambulance_id TEXT PRIMARY KEY,
                ambulance_type TEXT NOT NULL,
                status TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS emergency_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL DEFAULT 'pending',
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                address_hint TEXT,
                brief_symptoms TEXT NOT NULL,
                patient_name TEXT,
                preferred_hospital_id TEXT,
                accepted_at TEXT,
                accepted_by_ambulance_id TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER,
                ambulance_id TEXT,
                patient_name TEXT NOT NULL,
                age INTEGER NOT NULL,
                sex TEXT,
                symptoms TEXT NOT NULL,
                bp_systolic INTEGER NOT NULL,
                bp_diastolic INTEGER NOT NULL,
                pulse INTEGER NOT NULL,
                spo2 INTEGER NOT NULL,
                consciousness TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                address_hint TEXT,
                summary TEXT NOT NULL,
                urgency TEXT NOT NULL,
                hospital_id TEXT,
                hospital_name TEXT,
                hospital_selection_reason TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (request_id) REFERENCES emergency_requests(id)
            )
            """
        )

        # Legacy DB: table "cases" existed without new columns
        cols = _table_columns(conn, "cases")
        if cols:
            _add_column_if_missing(conn, "cases", "request_id", "INTEGER")
            _add_column_if_missing(conn, "cases", "ambulance_id", "TEXT")
            _add_column_if_missing(conn, "cases", "hospital_id", "TEXT")
            _add_column_if_missing(conn, "cases", "hospital_name", "TEXT")
            _add_column_if_missing(
                conn, "cases", "hospital_selection_reason", "TEXT"
            )

        conn.commit()
        _seed_ambulances(conn)


def _seed_ambulances(conn):
    cur = conn.execute("SELECT COUNT(*) FROM ambulances")
    if cur.fetchone()[0] > 0:
        return
    rows = [
        ("AMB-ALS-01", "ALS", "Available"),
        ("AMB-ALS-02", "ALS", "Available"),
        ("AMB-BLS-01", "BLS", "Available"),
        ("AMB-BLS-02", "BLS", "Available"),
    ]
    conn.executemany(
        "INSERT INTO ambulances (ambulance_id, ambulance_type, status) VALUES (?,?,?)",
        rows,
    )
    conn.commit()


@contextmanager
def get_connection():
    _ensure_dir()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def list_ambulances():
    with get_connection() as conn:
        cur = conn.execute(
            "SELECT ambulance_id, ambulance_type, status FROM ambulances ORDER BY ambulance_id"
        )
        return [dict(r) for r in cur.fetchall()]


def get_ambulance(ambulance_id: str):
    with get_connection() as conn:
        cur = conn.execute(
            "SELECT * FROM ambulances WHERE ambulance_id = ?", (ambulance_id,)
        )
        row = cur.fetchone()
        return dict(row) if row else None


def set_ambulance_status(ambulance_id: str, status: str):
    with get_connection() as conn:
        conn.execute(
            "UPDATE ambulances SET status = ? WHERE ambulance_id = ?",
            (status, ambulance_id),
        )
        conn.commit()


def insert_emergency_request(row: dict) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO emergency_requests (
                status, latitude, longitude, address_hint, brief_symptoms,
                patient_name, preferred_hospital_id, created_at
            ) VALUES ('pending', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["latitude"],
                row["longitude"],
                row.get("address_hint") or "",
                row["brief_symptoms"],
                row.get("patient_name") or "",
                row.get("preferred_hospital_id") or None,
                now,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def get_emergency_request(req_id: int):
    with get_connection() as conn:
        cur = conn.execute(
            "SELECT * FROM emergency_requests WHERE id = ?", (req_id,)
        )
        row = cur.fetchone()
        return dict(row) if row else None


def list_emergency_requests(status: str | None = None):
    with get_connection() as conn:
        if status:
            cur = conn.execute(
                """
                SELECT * FROM emergency_requests
                WHERE status = ?
                ORDER BY datetime(created_at) DESC
                """,
                (status,),
            )
        else:
            cur = conn.execute(
                """
                SELECT * FROM emergency_requests
                ORDER BY datetime(created_at) DESC
                LIMIT 100
                """
            )
        return [dict(r) for r in cur.fetchall()]


def accept_emergency_request(request_id: int, ambulance_id: str) -> dict | None:
    """Returns merged request dict on success; None if invalid."""
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        cur = conn.execute(
            "SELECT * FROM emergency_requests WHERE id = ?",
            (request_id,),
        )
        req_row = cur.fetchone()
        if not req_row or req_row["status"] != "pending":
            return None
        cur = conn.execute(
            "SELECT * FROM ambulances WHERE ambulance_id = ?",
            (ambulance_id,),
        )
        amb_row = cur.fetchone()
        if not amb_row or amb_row["status"] != "Available":
            return None

        conn.execute(
            """
            UPDATE emergency_requests SET
                status = 'accepted',
                accepted_at = ?,
                accepted_by_ambulance_id = ?
            WHERE id = ? AND status = 'pending'
            """,
            (now, ambulance_id, request_id),
        )
        conn.execute(
            "UPDATE ambulances SET status = 'Busy' WHERE ambulance_id = ?",
            (ambulance_id,),
        )
        conn.commit()

    return get_emergency_request(request_id)


def mark_request_triaged(request_id: int):
    with get_connection() as conn:
        conn.execute(
            "UPDATE emergency_requests SET status = 'triaged' WHERE id = ?",
            (request_id,),
        )
        conn.commit()


def insert_case(row: dict) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO cases (
                request_id, ambulance_id, patient_name, age, sex, symptoms,
                bp_systolic, bp_diastolic, pulse, spo2, consciousness,
                latitude, longitude, address_hint, summary, urgency,
                hospital_id, hospital_name, hospital_selection_reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row.get("request_id"),
                row.get("ambulance_id"),
                row["patient_name"],
                row["age"],
                row.get("sex") or "",
                row["symptoms"],
                row["bp_systolic"],
                row["bp_diastolic"],
                row["pulse"],
                row["spo2"],
                row["consciousness"],
                row.get("latitude"),
                row.get("longitude"),
                row.get("address_hint") or "",
                row["summary"],
                row["urgency"],
                row.get("hospital_id"),
                row.get("hospital_name"),
                row.get("hospital_selection_reason") or "",
                now,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_cases_recent(limit: int = 50):
    with get_connection() as conn:
        cur = conn.execute(
            """
            SELECT * FROM cases
            ORDER BY datetime(created_at) DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_case(case_id: int):
    with get_connection() as conn:
        cur = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,))
        row = cur.fetchone()
        return dict(row) if row else None
