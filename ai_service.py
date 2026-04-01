"""
AI summary + urgency classification.
Uses Google Gemini when GEMINI_API_KEY is set; otherwise rule-based triage.
Urgency labels: Critical, Moderate, Stable (maps to dashboard colors).
"""

import os
import re
from typing import Any

# Lazy import of google.generativeai inside generate_summary_and_urgency to avoid startup noise


URGENCY_CRITICAL = "Critical"
URGENCY_MODERATE = "Moderate"
URGENCY_STABLE = "Stable"


def _parse_bp(bp_str: str) -> tuple[int, int]:
    """Parse '120/80' or '120 80' into systolic, diastolic."""
    s = (bp_str or "").strip().replace("mmHg", "").strip()
    nums = re.findall(r"\d+", s)
    if len(nums) >= 2:
        return int(nums[0]), int(nums[1])
    if len(nums) == 1:
        return int(nums[0]), 80
    return 120, 80


def rule_based_urgency(
    age: int,
    symptoms: str,
    bp_sys: int,
    bp_dia: int,
    pulse: int,
    spo2: int,
    consciousness: str,
) -> str:
    """Heuristic triage for demo / fallback when AI is unavailable."""
    c = (consciousness or "").lower()
    sym = (symptoms or "").lower()

    if c in ("unresponsive", "unconscious", "not responsive"):
        return URGENCY_CRITICAL
    if spo2 < 90:
        return URGENCY_CRITICAL
    if pulse < 40 or pulse > 150:
        return URGENCY_CRITICAL
    if bp_sys < 80 or bp_sys > 200 or bp_dia > 120:
        return URGENCY_CRITICAL
    if any(
        w in sym
        for w in (
            "chest pain",
            "can't breathe",
            "cannot breathe",
            "stroke",
            "unconscious",
            "severe bleeding",
            "anaphylaxis",
            "choking",
        )
    ):
        return URGENCY_CRITICAL

    if spo2 < 94 or pulse < 55 or pulse > 120:
        return URGENCY_MODERATE
    if c in ("verbal", "pain", "responds to pain", "confused"):
        return URGENCY_MODERATE
    if any(w in sym for w in ("shortness of breath", "sob", "dizzy", "fever", "abdominal pain")):
        return URGENCY_MODERATE
    if bp_sys >= 160 or bp_dia >= 100:
        return URGENCY_MODERATE

    return URGENCY_STABLE


def rule_based_summary(
    patient_name: str,
    age: int,
    sex: str,
    symptoms: str,
    bp_sys: int,
    bp_dia: int,
    pulse: int,
    spo2: int,
    consciousness: str,
) -> str:
    sex_bit = f"{sex} " if sex else ""
    return (
        f"Patient {patient_name} is a {age}-year-old {sex_bit.strip()}presenting with: {symptoms.strip()}. "
        f"Vitals: BP {bp_sys}/{bp_dia} mmHg, pulse {pulse} bpm, SpO₂ {spo2}%. "
        f"Consciousness: {consciousness}. "
        f"This is an automated field summary for hospital handoff."
    )


def _gemini_available() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def generate_summary_and_urgency(payload: dict[str, Any]) -> tuple[str, str]:
    """
    Returns (summary, urgency) where urgency is Critical | Moderate | Stable.
    """
    bp_sys = int(payload.get("bp_systolic") or 120)
    bp_dia = int(payload.get("bp_diastolic") or 80)
    age = int(payload.get("age") or 0)
    pulse = int(payload.get("pulse") or 72)
    spo2 = int(payload.get("spo2") or 98)
    consciousness = str(payload.get("consciousness") or "Alert")
    symptoms = str(payload.get("symptoms") or "")
    patient_name = str(payload.get("patient_name") or "Unknown")
    sex = str(payload.get("sex") or "").strip()

    rule_urgency = rule_based_urgency(
        age, symptoms, bp_sys, bp_dia, pulse, spo2, consciousness
    )
    rule_summary = rule_based_summary(
        patient_name, age, sex, symptoms, bp_sys, bp_dia, pulse, spo2, consciousness
    )

    if not _gemini_available():
        return rule_summary, rule_urgency

    try:
        import google.generativeai as genai  # type: ignore
    except ImportError:
        return rule_summary, rule_urgency

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model_name = os.environ.get("GEMINI_MODEL", "gemini-1.5-flash")
    model = genai.GenerativeModel(model_name)

    prompt = f"""You are a medical triage assistant for ambulance handoff. Be concise and professional.

Patient: {patient_name}
Age: {age}
Sex: {sex or "unspecified"}
Symptoms / chief complaint: {symptoms}
Vitals: BP {bp_sys}/{bp_dia} mmHg, Pulse {pulse} bpm, SpO2 {spo2}%
Consciousness (AVPU-style): {consciousness}

1) Write ONE short paragraph (3-5 sentences) structured summary suitable for ER staff. Start with age and chief complaint.

2) On a new line, output exactly one urgency label from this set ONLY: Critical | Moderate | Stable
   - Critical: life-threatening or needs immediate intervention
   - Moderate: needs prompt evaluation, not immediately life-threatening
   - Stable: lower acuity, routine evaluation

Format your answer EXACTLY as:
SUMMARY: <your paragraph>
URGENCY: <Critical|Moderate|Stable>
"""

    try:
        resp = model.generate_content(prompt)
        text = (resp.text or "").strip()
        summary = rule_summary
        urgency = rule_urgency

        if "SUMMARY:" in text:
            parts = text.split("URGENCY:", 1)
            summary = parts[0].replace("SUMMARY:", "").strip()
            if len(parts) > 1:
                u = parts[1].strip().split()[0] if parts[1].strip() else ""
                if u in (URGENCY_CRITICAL, URGENCY_MODERATE, URGENCY_STABLE):
                    urgency = u
        else:
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            if lines:
                summary = lines[0] if len(lines[0]) > 200 else text[:800]
            for token in (URGENCY_CRITICAL, URGENCY_MODERATE, URGENCY_STABLE):
                if token in text:
                    urgency = token
                    break

        if not summary:
            summary = rule_summary
        return summary, urgency
    except Exception:
        return rule_summary, rule_urgency


def normalize_bp_from_form(bp_raw: str) -> tuple[int, int]:
    return _parse_bp(bp_raw)
