"""Demo hospital directory + routing by urgency, distance, and specialization."""

from __future__ import annotations

import math
from typing import Any

# Latitude/longitude roughly India demo region; adjust for your pitch
HOSPITALS: list[dict[str, Any]] = [
    {
        "id": "GH-GENERAL-01",
        "name": "City General Hospital",
        "latitude": 22.5726,
        "longitude": 88.3639,
        "specializations": ["general", "medical", "surgical"],
    },
    {
        "id": "TR-TRAUMA-01",
        "name": "Regional Trauma & Stroke Center",
        "latitude": 22.5958,
        "longitude": 88.3476,
        "specializations": ["trauma", "stroke", "neuro", "critical"],
    },
    {
        "id": "CV-CARDIAC-01",
        "name": "Institute of Cardiac Sciences",
        "latitude": 22.5448,
        "longitude": 88.3965,
        "specializations": ["cardiac", "chest", "pci", "critical"],
    },
]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _keyword_specialization_hints(symptoms: str) -> set[str]:
    s = (symptoms or "").lower()
    tags: set[str] = set()
    if any(
        w in s
        for w in (
            "chest pain",
            "heart",
            "cardiac",
            "crushing",
            "left arm",
            "palpitation",
        )
    ):
        tags.add("cardiac")
    if any(
        w in s
        for w in (
            "stroke",
            "facial droop",
            "slurred",
            "weakness one side",
            "neuro",
            "seizure",
        )
    ):
        tags.add("stroke")
        tags.add("neuro")
    if any(
        w in s
        for w in (
            "accident",
            "collision",
            "bleeding heavily",
            "gunshot",
            "stab",
            "trauma",
            "fall from height",
        )
    ):
        tags.add("trauma")
    return tags


def select_hospital(
    symptoms: str,
    urgency: str,
    request_lat: float | None,
    request_lon: float | None,
    preferred_hospital_id: str | None = None,
) -> tuple[dict[str, Any], str]:
    """
    Returns (hospital_record, human_readable_reason).
    """
    if preferred_hospital_id:
        for h in HOSPITALS:
            if h["id"] == preferred_hospital_id:
                dist = None
                if request_lat is not None and request_lon is not None:
                    dist = haversine_km(
                        request_lat, request_lon, h["latitude"], h["longitude"]
                    )
                reason = "Preferred hospital selected by patient/crew."
                if dist is not None:
                    reason += f" (~{dist:.1f} km from scene)."
                h_out = {
                    **h,
                    "distance_km": round(dist, 2) if dist is not None else None,
                }
                return h_out, reason
        # Unknown id — fall through to automatic routing

    u = (urgency or "").strip().lower()
    hints = _keyword_specialization_hints(symptoms)

    def score(h: dict) -> tuple[float, float]:
        specs = set(str(x).lower() for x in h["specializations"])
        spec_score = 0.0
        if hints & specs:
            spec_score = 100.0
        elif u == "critical" and ("critical" in specs or "trauma" in specs):
            spec_score = 80.0
        elif u == "critical" and "cardiac" in specs and "cardiac" in hints:
            spec_score = 90.0

        dist = 9999.0
        if request_lat is not None and request_lon is not None:
            dist = haversine_km(
                request_lat, request_lon, h["latitude"], h["longitude"]
            )
        dist_score = max(0.0, 50.0 - dist * 8.0)  # nearer is better

        urgency_boost = 0.0
        if u == "critical":
            if "trauma" in specs or "critical" in specs:
                urgency_boost += 40.0
            if "cardiac" in specs and "cardiac" in hints:
                urgency_boost += 35.0
            if "stroke" in specs and ("stroke" in hints or "neuro" in hints):
                urgency_boost += 35.0
        elif u == "moderate":
            urgency_boost += 10.0

        total = spec_score + dist_score + urgency_boost
        return total, -dist

    best = max(HOSPITALS, key=lambda h: score(h))
    dist_val = None
    if request_lat is not None and request_lon is not None:
        dist_val = haversine_km(
            request_lat, request_lon, best["latitude"], best["longitude"]
        )

    parts = [
        f"Urgency: {urgency or 'Unknown'}.",
    ]
    if hints:
        parts.append("Chief complaint cues: " + ", ".join(sorted(hints)) + ".")
    if dist_val is not None:
        parts.append(f"Nearest suitable match: ~{dist_val:.1f} km.")
    parts.append(f"Capabilities: {', '.join(best['specializations'])}.")

    h_out = {**best, "distance_km": round(dist_val, 2) if dist_val is not None else None}
    return h_out, " ".join(parts)


def list_hospitals_public() -> list[dict[str, Any]]:
    return [
        {
            "id": h["id"],
            "name": h["name"],
            "specializations": h["specializations"],
        }
        for h in HOSPITALS
    ]
