"""
server.py — FastAPI backend for the Lab Grader React GUI.

Run:  conda activate lab-grader && uvicorn server:app --reload --port 9090
"""

import io
import json
import os
import sys
import threading
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from grader import (
    GradingCancelled,
    LabPaths,
    build_output_pdf,
    make_paths,
    run_lab,
)

load_dotenv()


# ── Resolve user-writable lab data directory ──────────────────────────────────
# Priority:
#   1. LAB_GRADER_LABS_DIR env var (set by the desktop launcher)
#   2. ./labs (when run from a source checkout)
#   3. platformdirs user data dir (when packaged or no labs/ next to script)

def _resolve_labs_dir() -> Path:
    env = os.environ.get("LAB_GRADER_LABS_DIR")
    if env:
        p = Path(env).expanduser()
        p.mkdir(parents=True, exist_ok=True)
        return p

    local = Path.cwd() / "labs"
    if local.exists():
        return local

    try:
        from platformdirs import user_data_dir
        p = Path(user_data_dir("LabGrader", "CMU")) / "labs"
    except Exception:
        p = Path.home() / ".lab-grader" / "labs"
    p.mkdir(parents=True, exist_ok=True)
    return p


LABS_DIR = _resolve_labs_dir()

app = FastAPI(title="Lab Grader API")

# Permissive CORS — backend always binds to 127.0.0.1 only, so this is safe.
# Allows dev frontend (Vite 5173/4173), packaged Electron app (file:// origin
# becomes "null"), and direct access from the served bundle.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory grading job tracker
#   {lab_id: {status, current, total, current_file, results, error, cancel_event}}
_grading_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_lab_dir(lab_id: str) -> Path:
    p = LABS_DIR / lab_id
    if not p.exists():
        raise HTTPException(404, f"Lab '{lab_id}' not found")
    return p


def lab_meta(lab_dir: Path) -> dict:
    meta_file = lab_dir / "meta.json"
    if meta_file.exists():
        return json.loads(meta_file.read_text())
    return {"id": lab_dir.name, "name": lab_dir.name, "created_at": ""}


def save_meta(lab_dir: Path, meta: dict):
    (lab_dir / "meta.json").write_text(json.dumps(meta, indent=2))


def _sections_all_confirmed(grades: dict, schema: dict | None) -> bool:
    secs = grades.get("sections") or {}
    if schema:
        ids = [s["id"] for s in schema.get("sections", [])]
        if not ids:
            return False
        return all(secs.get(sid, {}).get("confirmed") for sid in ids)
    if not secs:
        return False
    return all(s.get("confirmed") for s in secs.values())


def _load_schema(paths: LabPaths) -> dict | None:
    if paths.schema_file.exists():
        try:
            return json.loads(paths.schema_file.read_text())
        except Exception:
            return None
    return None


def report_list(lab_dir: Path) -> list[dict]:
    paths = make_paths(lab_dir)
    schema = _load_schema(paths) or {}

    reports = []
    for pdf in sorted(paths.input_dir.glob("*.pdf"),
                      key=lambda p: (int(p.stem) if p.stem.isdigit() else p.stem)):
        grades_file = paths.output_dir / f"{pdf.stem}_grades.json"
        report: dict[str, Any] = {
            "id": pdf.stem, "filename": pdf.name,
            "graded": grades_file.exists(),
            "confirmed": False,
            "ai_score": None, "final_score": None,
            "sections": {},
            "section_confirmed_count": 0,
            "section_total_count": len(schema.get("sections", [])),
        }
        if grades_file.exists():
            g = json.loads(grades_file.read_text())
            report["ai_score"] = g.get("total_score")
            report["final_score"] = g.get("confirmed_score", g.get("total_score"))
            report["confirmed"] = bool(g.get("confirmed", False))
            report["sections"] = g.get("sections", {})
            secs = g.get("sections") or {}
            report["section_confirmed_count"] = sum(
                1 for s in secs.values() if s.get("confirmed")
            )
        reports.append(report)
    return reports


def lab_summary(lab_dir: Path) -> dict:
    meta = lab_meta(lab_dir)
    paths = make_paths(lab_dir)
    schema = _load_schema(paths) or {}
    reports = report_list(lab_dir)

    graded = [r for r in reports if r["graded"]]
    confirmed = [r for r in reports if r["confirmed"]]
    scores = [r["ai_score"] for r in graded if r["ai_score"] is not None]
    avg = round(sum(scores) / len(scores)) if scores else None

    return {
        **meta,
        "total_points":      schema.get("total_points", 100),
        "report_count":      len(reports),
        "graded_count":      len(graded),
        "confirmed_count":   len(confirmed),
        "avg_score":         avg,
        "has_ground_truth":  bool(list(paths.rubrics_dir.glob("*.pdf"))),
        "ground_truth_name": next((f.name for f in paths.rubrics_dir.glob("*.pdf")), None),
    }


def _client_from_header(x_anthropic_key: Optional[str]) -> anthropic.Anthropic:
    """Build an Anthropic client using the per-request key, falling back to env."""
    key = (x_anthropic_key or "").strip() or os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise HTTPException(401, "Anthropic API key required. Enter it on the main page.")
    return anthropic.Anthropic(api_key=key)


# ── Health / version ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "labs_dir": str(LABS_DIR)}


@app.post("/api/key/validate")
def validate_key(x_anthropic_key: Optional[str] = Header(None)):
    """Make a tiny Sonnet call to confirm the key works."""
    try:
        client = _client_from_header(x_anthropic_key)
        client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8,
            messages=[{"role": "user", "content": "hi"}],
        )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "authentication" in msg.lower() or "401" in msg or "invalid" in msg.lower():
            raise HTTPException(401, "Invalid API key")
        raise HTTPException(500, f"Validation failed: {msg}")


# ── Lab management ────────────────────────────────────────────────────────────

@app.get("/api/labs")
def list_labs():
    if not LABS_DIR.exists():
        return []
    labs = []
    for d in sorted(LABS_DIR.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            try:
                labs.append(lab_summary(d))
            except Exception:
                labs.append({"id": d.name, "name": d.name})
    return labs


class CreateLabBody(BaseModel):
    name: str


@app.post("/api/labs")
def create_lab(body: CreateLabBody):
    import re
    lab_id = re.sub(r"[^\w]+", "_", body.name.strip()).strip("_")
    if not lab_id:
        raise HTTPException(400, "Lab name must contain at least one alphanumeric character")
    lab_dir = LABS_DIR / lab_id
    if lab_dir.exists():
        raise HTTPException(409, f"Lab '{lab_id}' already exists")

    for sub in ("input", "ground_truth", "rubrics", "output", "cache"):
        (lab_dir / sub).mkdir(parents=True)

    meta = {"id": lab_id, "name": body.name.strip(),
            "created_at": datetime.now().isoformat()}
    save_meta(lab_dir, meta)
    return meta


class RenameLabBody(BaseModel):
    name: str


@app.patch("/api/labs/{lab_id}")
def rename_lab(lab_id: str, body: RenameLabBody):
    lab_dir = get_lab_dir(lab_id)
    meta = lab_meta(lab_dir)
    meta["name"] = body.name.strip()
    save_meta(lab_dir, meta)
    return meta


@app.delete("/api/labs/{lab_id}")
def delete_lab(lab_id: str):
    import shutil
    lab_dir = get_lab_dir(lab_id)
    shutil.rmtree(lab_dir)
    with _jobs_lock:
        _grading_jobs.pop(lab_id, None)
    return {"ok": True}


@app.get("/api/labs/{lab_id}")
def get_lab(lab_id: str):
    return lab_summary(get_lab_dir(lab_id))


@app.get("/api/labs/{lab_id}/schema")
def get_schema(lab_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    if not paths.schema_file.exists():
        raise HTTPException(404, "Schema not generated yet")
    return json.loads(paths.schema_file.read_text())


# ── File uploads ──────────────────────────────────────────────────────────────

@app.post("/api/labs/{lab_id}/upload/reports")
async def upload_reports(lab_id: str, file: UploadFile = File(...)):
    lab_dir = get_lab_dir(lab_id)
    input_dir = lab_dir / "input"
    input_dir.mkdir(exist_ok=True)

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Please upload a .zip file")

    content = await file.read()
    extracted = []
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for entry in zf.namelist():
            if "__MACOSX" in entry or not entry.lower().endswith(".pdf"):
                continue
            fname = Path(entry).name
            dest = input_dir / fname
            dest.write_bytes(zf.read(entry))
            extracted.append(fname)

    return {"ok": True, "extracted": sorted(extracted)}


@app.post("/api/labs/{lab_id}/upload/ground-truth")
async def upload_ground_truth(lab_id: str, file: UploadFile = File(...)):
    lab_dir = get_lab_dir(lab_id)
    gt_dir = lab_dir / "ground_truth"
    gt_dir.mkdir(exist_ok=True)

    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a .pdf file")

    for f in gt_dir.glob("*.pdf"):
        f.unlink()
    gt_map = lab_dir / "cache" / "gt_section_map.json"
    if gt_map.exists():
        gt_map.unlink()

    content = await file.read()
    (gt_dir / file.filename).write_bytes(content)
    return {"ok": True, "filename": file.filename}


@app.post("/api/labs/{lab_id}/upload/rubric")
async def upload_rubric(lab_id: str, file: UploadFile = File(...)):
    lab_dir = get_lab_dir(lab_id)
    rubrics_dir = lab_dir / "rubrics"
    rubrics_dir.mkdir(exist_ok=True)

    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a .pdf file")

    for f in rubrics_dir.glob("*.pdf"):
        f.unlink()
    schema_file = lab_dir / "cache" / "rubric_schema.json"
    if schema_file.exists():
        schema_file.unlink()

    content = await file.read()
    (rubrics_dir / file.filename).write_bytes(content)
    return {"ok": True, "filename": file.filename}


@app.delete("/api/labs/{lab_id}/reports-all")
def clear_all_reports(lab_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    count = 0
    for d in (paths.input_dir, paths.output_dir):
        if d.exists():
            for f in d.iterdir():
                if f.is_file():
                    f.unlink()
                    count += 1
    return {"ok": True, "deleted": count}


@app.delete("/api/labs/{lab_id}/ground-truth")
def clear_ground_truth(lab_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    count = 0
    for f in paths.rubrics_dir.glob("*.pdf"):
        f.unlink()
        count += 1
    if paths.schema_file.exists():
        paths.schema_file.unlink()
    return {"ok": True, "deleted": count}


# ── Reports ───────────────────────────────────────────────────────────────────

@app.get("/api/labs/{lab_id}/reports")
def get_reports(lab_id: str):
    return report_list(get_lab_dir(lab_id))


@app.delete("/api/labs/{lab_id}/reports/{report_id}")
def delete_report(lab_id: str, report_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    deleted = []
    for candidate in [
        paths.input_dir  / f"{report_id}.pdf",
        paths.output_dir / f"{report_id}_grades.json",
        paths.output_dir / f"{report_id}_graded.pdf",
    ]:
        if candidate.exists():
            candidate.unlink()
            deleted.append(candidate.name)
    return {"ok": True, "deleted": deleted}


@app.get("/api/labs/{lab_id}/reports/{report_id}/grades")
def get_grades(lab_id: str, report_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    f = paths.output_dir / f"{report_id}_grades.json"
    if not f.exists():
        raise HTTPException(404, "No grades found")
    return json.loads(f.read_text())


class GradePatch(BaseModel):
    sections: dict[str, Any]


def _rebuild_pdf(paths: LabPaths, report_id: str, grades: dict):
    if not paths.schema_file.exists():
        return
    schema = json.loads(paths.schema_file.read_text())
    student_pdf = paths.input_dir / f"{report_id}.pdf"
    pdf_out = paths.output_dir / f"{report_id}_graded.pdf"
    if student_pdf.exists():
        confirmed = bool(grades.get("confirmed", False))
        build_output_pdf(student_pdf, grades, schema, pdf_out, confirmed=confirmed)


def _recompute_totals(grades: dict, schema: dict | None) -> dict:
    total = 0
    for sid, sec in grades.get("sections", {}).items():
        try:
            total += int(sec.get("score", 0) or 0)
        except (TypeError, ValueError):
            pass
    grades["total_score"] = total
    if grades.get("confirmed") and _sections_all_confirmed(grades, schema):
        grades["confirmed_score"] = total
    return grades


@app.patch("/api/labs/{lab_id}/reports/{report_id}/grades")
def update_grades(lab_id: str, report_id: str, patch: GradePatch):
    paths = make_paths(get_lab_dir(lab_id))
    f = paths.output_dir / f"{report_id}_grades.json"
    if not f.exists():
        raise HTTPException(404, "No grades found")

    grades = json.loads(f.read_text())
    schema = _load_schema(paths)
    secs = grades.setdefault("sections", {})

    for sid, data in patch.sections.items():
        existing = secs.setdefault(sid, {})
        # Detect a real edit (score or comment changed) → auto-unconfirm the section.
        score_changed = "score" in data and data.get("score") != existing.get("score")
        comment_changed = "comment" in data and data.get("comment") != existing.get("comment")
        sub_changed = "subsection_scores" in data and \
            data.get("subsection_scores") != existing.get("subsection_scores")
        existing.update(data)
        if score_changed or comment_changed or sub_changed:
            if existing.get("confirmed"):
                existing["confirmed"] = False
                existing.pop("confirmed_at", None)
            # Editing any section invalidates the overall confirm.
            if grades.get("confirmed"):
                grades["confirmed"] = False
                grades.pop("confirmed_score", None)
                grades.pop("confirmed_at", None)

    _recompute_totals(grades, schema)
    f.write_text(json.dumps(grades, indent=2))
    _rebuild_pdf(paths, report_id, grades)
    return {
        "ok": True,
        "total_score": grades["total_score"],
        "confirmed": grades.get("confirmed", False),
        "sections": grades.get("sections", {}),
    }


@app.post("/api/labs/{lab_id}/reports/{report_id}/sections/{section_id}/confirm")
def confirm_section(lab_id: str, report_id: str, section_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    f = paths.output_dir / f"{report_id}_grades.json"
    if not f.exists():
        raise HTTPException(404, "No grades found")
    grades = json.loads(f.read_text())
    sec = grades.setdefault("sections", {}).setdefault(section_id, {
        "score": 0, "comment": "", "subsection_scores": {}
    })
    sec["confirmed"] = True
    sec["confirmed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    f.write_text(json.dumps(grades, indent=2))
    _rebuild_pdf(paths, report_id, grades)
    return {"ok": True, "section": sec}


@app.post("/api/labs/{lab_id}/reports/{report_id}/sections/{section_id}/unconfirm")
def unconfirm_section(lab_id: str, report_id: str, section_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    f = paths.output_dir / f"{report_id}_grades.json"
    if not f.exists():
        raise HTTPException(404, "No grades found")
    grades = json.loads(f.read_text())
    sec = grades.get("sections", {}).get(section_id)
    if sec:
        sec["confirmed"] = False
        sec.pop("confirmed_at", None)
    if grades.get("confirmed"):
        grades["confirmed"] = False
        grades.pop("confirmed_score", None)
        grades.pop("confirmed_at", None)
    f.write_text(json.dumps(grades, indent=2))
    _rebuild_pdf(paths, report_id, grades)
    return {"ok": True}


@app.post("/api/labs/{lab_id}/reports/{report_id}/confirm")
def confirm_grades(lab_id: str, report_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    f = paths.output_dir / f"{report_id}_grades.json"
    if not f.exists():
        raise HTTPException(404, "No grades found")

    grades = json.loads(f.read_text())
    schema = _load_schema(paths)

    # Require every section to be individually confirmed first.
    if not _sections_all_confirmed(grades, schema):
        missing = []
        if schema:
            for s in schema.get("sections", []):
                if not grades.get("sections", {}).get(s["id"], {}).get("confirmed"):
                    missing.append(s["id"])
        raise HTTPException(409, {
            "error": "Confirm every section first.",
            "missing_sections": missing,
        })

    grades["confirmed"] = True
    grades["confirmed_score"] = grades["total_score"]
    grades["confirmed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    f.write_text(json.dumps(grades, indent=2))
    _rebuild_pdf(paths, report_id, grades)
    return {"ok": True, "confirmed_score": grades["confirmed_score"]}


@app.post("/api/labs/{lab_id}/reports/{report_id}/unconfirm")
def unconfirm_grades(lab_id: str, report_id: str):
    paths = make_paths(get_lab_dir(lab_id))
    f = paths.output_dir / f"{report_id}_grades.json"
    if not f.exists():
        raise HTTPException(404, "No grades found")
    grades = json.loads(f.read_text())
    grades["confirmed"] = False
    grades.pop("confirmed_score", None)
    grades.pop("confirmed_at", None)
    f.write_text(json.dumps(grades, indent=2))
    _rebuild_pdf(paths, report_id, grades)
    return {"ok": True}


@app.get("/api/labs/{lab_id}/reports/{report_id}/pdf/{kind}")
def get_pdf(lab_id: str, report_id: str, kind: str):
    paths = make_paths(get_lab_dir(lab_id))
    if kind == "original":
        p = paths.input_dir / f"{report_id}.pdf"
    elif kind == "graded":
        p = paths.output_dir / f"{report_id}_graded.pdf"
    else:
        raise HTTPException(400, "kind must be 'original' or 'graded'")
    if not p.exists():
        raise HTTPException(404, f"{kind} PDF not found")
    return FileResponse(str(p), media_type="application/pdf",
                        headers={"Content-Disposition": "inline"})


# ── Batch download (graded PDFs only, ZIP) ────────────────────────────────────

@app.get("/api/labs/{lab_id}/download")
def download_graded_zip(lab_id: str):
    lab_dir = get_lab_dir(lab_id)
    paths = make_paths(lab_dir)
    meta = lab_meta(lab_dir)

    graded_pdfs = sorted(paths.output_dir.glob("*_graded.pdf"))
    if not graded_pdfs:
        raise HTTPException(404, "No graded PDFs to download")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for pdf in graded_pdfs:
            zf.write(pdf, arcname=pdf.name)
    buf.seek(0)

    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in meta.get("name", lab_id))
    fname = f"{safe}_{datetime.now().strftime('%Y%m%d')}_graded.zip"
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Grading ───────────────────────────────────────────────────────────────────

class GradeRequest(BaseModel):
    report_ids: list[str] | None = None
    force_regen: bool = False


def _grading_thread(lab_id: str, lab_dir: Path,
                    report_ids: list[str] | None, force_regen: bool,
                    api_key: str, cancel_event: threading.Event):
    client = anthropic.Anthropic(api_key=api_key)

    def progress(current, total, filename):
        with _jobs_lock:
            job = _grading_jobs.get(lab_id)
            if job:
                job.update({"current": current, "total": total, "current_file": filename})

    def should_cancel():
        return cancel_event.is_set()

    try:
        results = run_lab(
            client, lab_dir,
            report_ids=report_ids,
            progress_callback=progress,
            force_regen=force_regen,
            should_cancel=should_cancel,
        )
        with _jobs_lock:
            job = _grading_jobs.get(lab_id, {})
            final_status = "cancelled" if cancel_event.is_set() else "done"
            job.update({"status": final_status, "results": results})
    except GradingCancelled:
        with _jobs_lock:
            _grading_jobs.setdefault(lab_id, {}).update(
                {"status": "cancelled", "results": []}
            )
    except Exception as e:
        with _jobs_lock:
            _grading_jobs.setdefault(lab_id, {}).update(
                {"status": "error", "error": str(e)}
            )


@app.post("/api/labs/{lab_id}/grade")
def start_grading(
    lab_id: str,
    body: GradeRequest,
    x_anthropic_key: Optional[str] = Header(None),
):
    with _jobs_lock:
        existing = _grading_jobs.get(lab_id, {})
        if existing.get("status") == "running":
            raise HTTPException(409, "Grading already running for this lab")

    # Resolve key now (so we fail fast with a 401 before the thread starts).
    key = (x_anthropic_key or "").strip() or os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise HTTPException(401, "Anthropic API key required. Enter it on the main page.")

    lab_dir = get_lab_dir(lab_id)
    cancel_event = threading.Event()
    with _jobs_lock:
        _grading_jobs[lab_id] = {
            "status": "running", "current": 0, "total": 0,
            "current_file": "", "results": [], "error": None,
            "cancel_event": cancel_event,
        }
    t = threading.Thread(
        target=_grading_thread,
        args=(lab_id, lab_dir, body.report_ids, body.force_regen, key, cancel_event),
        daemon=True,
    )
    t.start()
    return {"ok": True}


@app.get("/api/labs/{lab_id}/grade/status")
def grading_status(lab_id: str):
    with _jobs_lock:
        job = _grading_jobs.get(lab_id, {"status": "idle"})
        # Strip the cancel_event before returning (not JSON serialisable).
        return {k: v for k, v in job.items() if k != "cancel_event"}


@app.post("/api/labs/{lab_id}/grade/cancel")
def cancel_grading(lab_id: str):
    with _jobs_lock:
        job = _grading_jobs.get(lab_id, {})
        evt: threading.Event | None = job.get("cancel_event")
        if job.get("status") == "running" and evt is not None:
            evt.set()
            job["status"] = "cancelling"
    return {"ok": True}


# ── Serve React build in production ──────────────────────────────────────────

def _resolve_frontend_dir() -> Path | None:
    """Find frontend/dist whether we run from source, from PyInstaller, or Electron."""
    candidates = [
        Path.cwd() / "frontend" / "dist",
        Path(__file__).resolve().parent / "frontend" / "dist",
    ]
    if getattr(sys, "_MEIPASS", None):
        candidates.insert(0, Path(sys._MEIPASS) / "frontend" / "dist")
    env = os.environ.get("LAB_GRADER_FRONTEND_DIR")
    if env:
        candidates.insert(0, Path(env))
    for c in candidates:
        if c.exists() and (c / "index.html").exists():
            return c
    return None


_frontend = _resolve_frontend_dir()
if _frontend:
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="static")


# ── Entry point (used by the bundled desktop app) ────────────────────────────

def main():
    import uvicorn
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "9090"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
