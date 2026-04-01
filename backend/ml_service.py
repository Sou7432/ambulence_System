"""
Lightweight health risk scoring using rule thresholds + IsolationForest anomaly detection.
Trained incrementally on recent window of readings (hackathon-friendly, no external model file).
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LinearRegression

from config import THRESHOLDS

logger = logging.getLogger(__name__)


def _features_row(reading: dict) -> list[float]:
    """Map one reading dict to a numeric feature vector."""
    return [
        float(reading.get("heart_rate") or 0),
        float(reading.get("bp_systolic") or 0),
        float(reading.get("bp_diastolic") or 0),
        float(reading.get("temperature_c") or 0),
        float(reading.get("glucose_mg_dl") or 0),
    ]


def threshold_alerts(reading: dict) -> list[str]:
    """Return human-readable alerts when vitals exceed demo thresholds."""
    alerts: list[str] = []
    hr = reading.get("heart_rate")
    if hr is not None:
        t = THRESHOLDS["heart_rate"]
        if hr < t["min"] or hr > t["max"]:
            alerts.append(f"Heart rate abnormal: {hr} bpm (expected {t['min']}-{t['max']})")
    sys_v = reading.get("bp_systolic")
    dia_v = reading.get("bp_diastolic")
    if sys_v is not None and dia_v is not None:
        ts, td = THRESHOLDS["bp_systolic"], THRESHOLDS["bp_diastolic"]
        if sys_v < ts["min"] or sys_v > ts["max"] or dia_v < td["min"] or dia_v > td["max"]:
            alerts.append(
                f"Blood pressure abnormal: {sys_v}/{dia_v} mmHg"
            )
    temp = reading.get("temperature_c")
    if temp is not None:
        tt = THRESHOLDS["temperature_c"]
        if temp < tt["min"] or temp > tt["max"]:
            alerts.append(f"Temperature abnormal: {temp} °C")
    glu = reading.get("glucose_mg_dl")
    if glu is not None:
        tg = THRESHOLDS["glucose_mg_dl"]
        if glu < tg["min"] or glu > tg["max"]:
            alerts.append(f"Glucose abnormal: {glu} mg/dL")
    return alerts


def predict_abnormal(
    current: dict, history: list[dict] | None = None
) -> dict[str, Any]:
    """
    Combine rule-based flags with a simple anomaly score.
    Returns dict: abnormal (bool), reasons (list), ml_score, regression_trend_note.
    """
    reasons = list(threshold_alerts(current))
    abnormal_rules = len(reasons) > 0

    hist = history or []
    X: list[list[float]] = [_features_row(r) for r in hist[-49:]]
    X.append(_features_row(current))
    X_arr = np.asarray(X, dtype=float)
    ml_score = 0.0
    iso_abnormal = False
    trend_note = ""

    if len(X_arr) >= 4:
        try:
            # IsolationForest: -1 = outlier in sklearn < 1.3 style prediction
            clf = IsolationForest(
                random_state=42, contamination=0.1, n_estimators=50
            )
            clf.fit(X_arr)
            pred = clf.predict(X_arr[-1].reshape(1, -1))[0]
            iso_abnormal = pred == -1
            # Decision function: lower = more anomalous
            raw = clf.decision_function(X_arr[-1].reshape(1, -1))[0]
            ml_score = float(raw)
        except Exception as e:
            logger.warning("IsolationForest skipped: %s", e)

    # Tiny linear regression on heart rate trend (last points)
    if len(X_arr) >= 3:
        try:
            y = X_arr[:, 0]  # heart rate
            t = np.arange(len(y)).reshape(-1, 1)
            reg = LinearRegression().fit(t, y)
            slope = float(reg.coef_[0])
            if slope > 2.0:
                trend_note = "Heart rate trending up (simple linear fit)."
            elif slope < -2.0:
                trend_note = "Heart rate trending down (simple linear fit)."
        except Exception as e:
            logger.warning("Linear trend skipped: %s", e)

    if iso_abnormal and not abnormal_rules:
        reasons.append("ML anomaly detector flagged this snapshot as unusual.")

    return {
        "abnormal": abnormal_rules or iso_abnormal,
        "reasons": reasons,
        "ml_score": ml_score,
        "isolation_anomaly": iso_abnormal,
        "trend_note": trend_note,
    }
