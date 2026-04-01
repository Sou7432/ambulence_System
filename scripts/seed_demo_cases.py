"""
Optional: insert demo patient_cases (historical handoffs) for the hospital dashboard.
Does not create emergency_requests — use the live UI for the full flow.

Run from project root: python scripts/seed_demo_cases.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ai_service import generate_summary_and_urgency  # noqa: E402
from database import init_db, insert_case  # noqa: E402
from hospital_selector import select_hospital  # noqa: E402


def main():
    init_db()
    sample_path = ROOT / "sample_test_data.json"
    data = json.loads(sample_path.read_text(encoding="utf-8"))
    for ex in data["examples"]:
        b = ex["body"]
        payload = {
            "patient_name": b["patient_name"],
            "age": b["age"],
            "sex": b.get("sex") or "",
            "symptoms": b["symptoms"],
            "bp_systolic": b["bp_systolic"],
            "bp_diastolic": b["bp_diastolic"],
            "pulse": b["pulse"],
            "spo2": b["spo2"],
            "consciousness": b["consciousness"],
        }
        summary, urgency = generate_summary_and_urgency(payload)
        lat = b.get("latitude")
        lng = b.get("longitude")
        hosp, reason = select_hospital(
            b["symptoms"],
            urgency,
            float(lat) if lat is not None else None,
            float(lng) if lng is not None else None,
            None,
        )
        row = {
            **payload,
            "request_id": None,
            "ambulance_id": "SEED-DEMO",
            "latitude": lat,
            "longitude": lng,
            "address_hint": b.get("address_hint") or "",
            "summary": summary,
            "urgency": urgency,
            "hospital_id": hosp["id"],
            "hospital_name": hosp["name"],
            "hospital_selection_reason": reason,
        }
        cid = insert_case(row)
        print(f"Inserted case {cid}: {ex['label']} -> {urgency} @ {hosp['name']}")


if __name__ == "__main__":
    main()
