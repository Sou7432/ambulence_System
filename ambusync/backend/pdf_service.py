"""Generate a simple health report PDF (no external binaries required)."""

from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from fpdf import FPDF


class _PDF(FPDF):
    def header(self) -> None:
        self.set_font("Helvetica", "B", 14)
        self.cell(0, 10, "AmbuSync — Health Monitoring Report", ln=True)

    def footer(self) -> None:
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")


def build_health_pdf(
    title: str,
    session_id: str,
    readings: list[dict],
    summary_lines: list[str],
    out_path: Path | None = None,
) -> bytes:
    """
    Build PDF bytes. If out_path is set, also write to disk.
    readings: list of dicts with timestamp, vitals, alerts.
    """
    pdf = _PDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", size=11)
    pdf.multi_cell(0, 6, f"Generated (UTC): {datetime.now(timezone.utc).isoformat()}")
    pdf.ln(2)
    pdf.multi_cell(0, 6, f"Report: {title}")
    pdf.multi_cell(0, 6, f"Session ID: {session_id}")
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Summary", ln=True)
    pdf.set_font("Helvetica", size=10)
    for line in summary_lines:
        pdf.multi_cell(0, 5, f"- {line}")
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Recent readings (latest first, up to 30)", ln=True)
    pdf.set_font("Helvetica", size=8)
    for r in readings[:30]:
        ts = r.get("timestamp", "")
        line = (
            f"{ts} | HR:{r.get('heart_rate')} "
            f"BP:{r.get('bp_systolic')}/{r.get('bp_diastolic')} "
            f"T:{r.get('temperature_c')} G:{r.get('glucose_mg_dl')} "
            f"ML abnormal:{r.get('ml_abnormal')} Alerts:{r.get('alerts')}"
        )
        pdf.multi_cell(0, 4, line)
    data = pdf.output(dest="S")
    if isinstance(data, str):
        raw = data.encode("latin-1")
    else:
        raw = bytes(data)
    if out_path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(raw)
    return raw


def pdf_bytes_to_buffer(content: bytes) -> BytesIO:
    buf = BytesIO(content)
    buf.seek(0)
    return buf
