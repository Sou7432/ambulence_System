"""Generate plausible synthetic vitals for demos when no hardware is connected."""

from __future__ import annotations

import random


def random_reading(bias_abnormal: bool = False) -> dict:
    """Return one snapshot of vitals; bias_abnormal nudges values out of range."""
    if bias_abnormal and random.random() < 0.35:
        hr = random.choice([random.randint(40, 48), random.randint(125, 145)])
        sys_v = random.choice([random.randint(80, 88), random.randint(150, 175)])
        dia_v = random.choice([random.randint(50, 55), random.randint(95, 105)])
        temp = random.choice([round(random.uniform(35.0, 35.8), 1), round(random.uniform(38.2, 39.5), 1)])
        glucose = random.choice([random.randint(55, 65), random.randint(190, 240)])
    else:
        hr = random.randint(62, 98)
        sys_v = random.randint(108, 132)
        dia_v = random.randint(68, 84)
        temp = round(random.uniform(36.2, 37.4), 1)
        glucose = random.randint(82, 118)
    return {
        "heart_rate": hr,
        "bp_systolic": sys_v,
        "bp_diastolic": dia_v,
        "temperature_c": temp,
        "glucose_mg_dl": glucose,
    }
