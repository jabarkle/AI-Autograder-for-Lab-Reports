"""
grader.py

AI-assisted lab report grading pipeline.

Can be used as a CLI:
    python grader.py --lab labs/THRef_Lab1 --file 1.pdf
    python grader.py --lab labs/THRef_Lab1
    python grader.py --lab labs/THRef_Lab1 --regen-schema

Or imported and called programmatically from server.py:
    from grader import run_lab
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
import json
import base64
import re
import io
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass

import fitz  # pymupdf
import anthropic
from dotenv import load_dotenv
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_CENTER

load_dotenv()

OPUS_MODEL   = "claude-opus-4-6"
SONNET_MODEL = "claude-sonnet-4-6"
RENDER_DPI   = 150


# ── Lab path helper ────────────────────────────────────────────────────────────

@dataclass
class LabPaths:
    root:        Path
    input_dir:   Path
    gt_dir:      Path
    output_dir:  Path
    rubrics_dir: Path
    cache_dir:   Path
    schema_file: Path
    gt_map_file: Path

def make_paths(lab_dir: Path) -> LabPaths:
    lab_dir = Path(lab_dir)
    cache = lab_dir / "cache"
    return LabPaths(
        root        = lab_dir,
        input_dir   = lab_dir / "input",
        gt_dir      = lab_dir / "ground_truth",
        output_dir  = lab_dir / "output",
        rubrics_dir = lab_dir / "rubrics",
        cache_dir   = cache,
        schema_file = cache / "rubric_schema.json",
        gt_map_file = cache / "gt_section_map.json",
    )


# ── PDF / Image utilities ──────────────────────────────────────────────────────

def render_page_b64(page: fitz.Page, dpi: int = RENDER_DPI) -> str:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    return base64.standard_b64encode(pix.tobytes("png")).decode("utf-8")

def img_block(b64: str) -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}}

def txt_block(text: str) -> dict:
    return {"type": "text", "text": text}

def extract_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Could not extract JSON:\n{text[:400]}")


def _coerce_int(value, default: int = 0) -> int:
    """Coerce arbitrary score values from the model into a clean int."""
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        m = re.search(r"-?\d+(?:\.\d+)?", value)
        if m:
            try:
                return int(float(m.group()))
            except ValueError:
                return default
    return default


class GradingCancelled(Exception):
    """Raised inside the grading loop when the caller requests cancellation."""

def extract_pdf_text(pdf_path: Path) -> str:
    doc = fitz.open(str(pdf_path))
    pages = [f"[Page {i+1}]\n{page.get_text()}" for i, page in enumerate(doc)]
    doc.close()
    return "\n\n".join(pages)


# ── Phase 0 — Schema generation ────────────────────────────────────────────────

SCHEMA_PROMPT = """
You are building a rubric schema for an AI grading system.

You have been given the full text of a TA-authored base lab document containing:
- Model answers for each section
- Explicit grading breakdowns with per-criterion point values
- Grading notes (full vs partial vs zero credit)
- Deduction rules

Output ONLY valid JSON in exactly this structure:

{
  "lab_title": "<lab title>",
  "total_points": 100,
  "sections": [
    {
      "id": "abstract",
      "rubric_name": "Abstract",
      "max_points": 5,
      "student_headers": ["Abstract"],
      "grading_criteria": "<copy the full grading breakdown text verbatim>",
      "model_answer_summary": "<1-2 sentence summary of what full credit requires>",
      "subsections": []
    },
    {
      "id": "scientific_theory",
      "rubric_name": "Scientific Theory",
      "max_points": 16,
      "student_headers": ["Scientific Theory", "A1. Scientific Theory", "1. Scientific Theory", "2 Scientific Theory"],
      "grading_criteria": "<full grading breakdown>",
      "model_answer_summary": "<summary>",
      "subsections": [
        {"id": "assumptions",   "name": "Assumptions",          "max_points": 3, "grading_criteria": "<breakdown>"},
        {"id": "relevant_eqs", "name": "Relevant Equations",   "max_points": 5, "grading_criteria": "<breakdown>"},
        {"id": "uncertainty",  "name": "Uncertainty Analysis", "max_points": 8, "grading_criteria": "<breakdown>"}
      ]
    },
    {
      "id": "results",
      "rubric_name": "Results and Data Analysis",
      "max_points": 50,
      "student_headers": ["Results and Data Analysis", "A2. Results and Data Analysis", "2. Results and Data Analysis", "3 Results and Data Analysis"],
      "grading_criteria": "<full grading breakdown>",
      "model_answer_summary": "<summary>",
      "subsections": [
        {"id": "graphs", "name": "Graphs", "max_points": 27, "grading_criteria": "<per-figure breakdown>"},
        {"id": "tables", "name": "Tables", "max_points": 23, "grading_criteria": "<per-table breakdown>"}
      ]
    },
    {
      "id": "discussion",
      "rubric_name": "Discussion",
      "max_points": 24,
      "student_headers": ["Discussion", "Questions", "Discussion Questions"],
      "grading_criteria": "<full grading breakdown>",
      "model_answer_summary": "<summary>",
      "subsections": [
        {"id": "q1", "name": "Question 1", "max_points": 4, "grading_criteria": "<Q1 breakdown>"},
        {"id": "q2", "name": "Question 2", "max_points": 4, "grading_criteria": "<Q2 breakdown>"},
        {"id": "q3", "name": "Question 3", "max_points": 4, "grading_criteria": "<Q3 breakdown>"},
        {"id": "q4", "name": "Question 4", "max_points": 4, "grading_criteria": "<Q4 breakdown>"},
        {"id": "q5", "name": "Question 5", "max_points": 4, "grading_criteria": "<Q5 breakdown>"},
        {"id": "q6", "name": "Question 6", "max_points": 4, "grading_criteria": "<Q6 breakdown>"}
      ]
    },
    {
      "id": "conclusions",
      "rubric_name": "Conclusions",
      "max_points": 5,
      "student_headers": ["Conclusions", "Conclusion"],
      "grading_criteria": "<full grading breakdown>",
      "model_answer_summary": "<summary>",
      "subsections": []
    }
  ]
}

Copy grading_criteria verbatim from the document. Output ONLY the JSON.
"""

def generate_schema(client: anthropic.Anthropic, paths: LabPaths, force: bool = False) -> dict:
    if paths.schema_file.exists() and not force:
        print("  [schema] Loaded cached rubric_schema.json")
        return json.loads(paths.schema_file.read_text())

    rubric_files = list(paths.rubrics_dir.glob("*.pdf"))
    if not rubric_files:
        raise FileNotFoundError(f"No rubric PDF in {paths.rubrics_dir}")

    print(f"  [schema] Generating from: {rubric_files[0].name}")
    rubric_text = extract_pdf_text(rubric_files[0])

    response = client.messages.create(
        model=OPUS_MODEL,
        max_tokens=8192,
        messages=[{"role": "user", "content":
            f"Here is the TA base lab document:\n\n{rubric_text}\n\n{SCHEMA_PROMPT}"}]
    )
    schema = extract_json(response.content[0].text)
    paths.cache_dir.mkdir(exist_ok=True)
    paths.schema_file.write_text(json.dumps(schema, indent=2))
    print(f"  [schema] Saved — {len(schema['sections'])} sections")
    return schema


# ── Phase 0b / 1 — Section mapping ────────────────────────────────────────────

def map_sections(client: anthropic.Anthropic, doc: fitz.Document,
                 schema: dict, label: str = "report") -> dict:
    section_lines = "\n".join(
        f'  "{s["id"]}": look for headers like {s["student_headers"]}'
        for s in schema["sections"]
    )
    section_ids = [s["id"] for s in schema["sections"]]

    content = [txt_block(f"""Map pages of a student lab report to rubric sections.

Sections (use these exact IDs as keys):
{section_lines}

Pages 0 and 1 are cover/rubric — do NOT assign them to content sections.
Return ONLY valid JSON (all section IDs present even if empty):
{{
  "abstract":          [],
  "scientific_theory": [],
  "results":           [],
  "discussion":        [],
  "conclusions":       []
}}
""")]
    for i in range(2, len(doc)):
        content.append(txt_block(f"\n[Page index {i}]"))
        content.append(img_block(render_page_b64(doc[i])))

    response = client.messages.create(
        model=SONNET_MODEL, max_tokens=1024,
        messages=[{"role": "user", "content": content}]
    )
    section_map = extract_json(response.content[0].text)
    for sid in section_ids:
        section_map.setdefault(sid, [])
    print(f"    Map ({label}): { {k: v for k, v in section_map.items() if v} }")
    return section_map


# ── Phase 2 — Section grading ──────────────────────────────────────────────────

GRADING_SYSTEM_PROMPT = """You are a fair, lenient TA grader for a CMU Mechanical Engineering lab course.

GRADING RULES — follow exactly:
1. ONLY deduct points for criteria explicitly listed in the rubric. Never invent requirements
   that are not in the rubric. If the rubric does not mention it, do not penalize for it.
2. NEVER penalize students for their numerical values, results, or data — each group has
   its own experimental data. Do not judge whether a value is "reasonable" or "unreasonable"
   unless the rubric explicitly provides an acceptable range. Only check whether the METHOD,
   FORMULA, and APPROACH are correct.
3. Default to awarding full points. Only deduct when something is clearly wrong, clearly
   missing, or explicitly violates a rubric criterion.
4. When in doubt, ALWAYS give the student the benefit of the doubt — award the points.
5. Reserve zero scores for genuinely missing sections only, never for imperfect attempts.
6. Equivalent correct reasoning earns full credit even if worded differently than the model.
7. Be lenient on formatting, presentation, and stylistic choices unless the rubric explicitly
   penalizes them.
8. Comments: specific, actionable, 1–3 sentences max. Focus on what is missing per the
   rubric, not on subjective quality judgments.
"""

def build_rubric_text(section: dict) -> str:
    lines = [
        f"SECTION: {section['rubric_name']}  (max {section['max_points']} pts)",
        "",
        "GRADING CRITERIA (from TA rubric):",
        section.get("grading_criteria", ""),
    ]
    if section.get("model_answer_summary"):
        lines += ["", f"MODEL ANSWER SUMMARY: {section['model_answer_summary']}"]
    if section["subsections"]:
        lines += ["", "SUBSECTIONS:"]
        for sub in section["subsections"]:
            lines.append(f"  • {sub['name']}: 0–{sub['max_points']} pts")
            if sub.get("grading_criteria"):
                lines.append(f"    {sub['grading_criteria']}")
    return "\n".join(lines)


def grade_section(client: anthropic.Anthropic, section: dict,
                  student_doc: fitz.Document,
                  student_pages: list,
                  gt_doc: fitz.Document | None = None,
                  gt_pages: list | None = None) -> dict:
    if not student_pages:
        return {"score": 0, "comment": "Section not found in submission.", "subsection_scores": {}}

    max_pts = section["max_points"]
    rubric  = build_rubric_text(section)

    if section["subsections"]:
        sub_shape = {
            sub["id"]: {"score": f"<0–{sub['max_points']}>", "comment": "<1–2 sentences>"}
            for sub in section["subsections"]
        }
        schema = (f'{{"score": <0–{max_pts}>, "comment": "<1–3 sentences>", '
                  f'"subsection_scores": {json.dumps(sub_shape)}}}')
    else:
        schema = f'{{"score": <0–{max_pts}>, "comment": "<1–3 sentences>", "subsection_scores": {{}}}}'

    has_gt = gt_doc is not None and gt_pages

    if has_gt:
        ref_instruction = ("The reference report is for structural context only — do not require\n"
                           "students to match it exactly. Different numbers are expected and never penalised.")
    else:
        ref_instruction = "Grade using the rubric criteria only."

    content = [txt_block(f"""{GRADING_SYSTEM_PROMPT}

---
{rubric}
---

Use the criteria above. {ref_instruction}
Respond with ONLY the JSON object (start with {{ end with }}).

{schema}
""")]

    if has_gt:
        content.append(txt_block("\n--- REFERENCE REPORT (context only) ---"))
        for i in gt_pages:
            content.append(txt_block(f"(ref p{i})"))
            content.append(img_block(render_page_b64(gt_doc[i])))

    content.append(txt_block("\n--- STUDENT SUBMISSION ---"))
    for i in student_pages:
        content.append(txt_block(f"(p{i})"))
        content.append(img_block(render_page_b64(student_doc[i])))

    response = client.messages.create(
        model=SONNET_MODEL, max_tokens=2048,
        messages=[{"role": "user", "content": content}]
    )
    result = extract_json(response.content[0].text)
    result["score"] = max(0, min(_coerce_int(result.get("score")), max_pts))
    result.setdefault("comment", "")
    subs = result.get("subsection_scores") or {}
    if isinstance(subs, dict):
        for sub in section.get("subsections", []):
            sub_max = sub["max_points"]
            entry = subs.get(sub["id"]) or {}
            if not isinstance(entry, dict):
                entry = {}
            entry["score"] = max(0, min(_coerce_int(entry.get("score")), sub_max))
            entry.setdefault("comment", "")
            subs[sub["id"]] = entry
    else:
        subs = {}
    result["subsection_scores"] = subs
    return result


# ── Output — Graded PDF ────────────────────────────────────────────────────────

def build_summary_page(grading_results: dict, schema: dict,
                       report_filename: str, confirmed: bool = False) -> bytes:
    buf    = io.BytesIO()
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("T",  parent=styles["Title"],    fontSize=15, spaceAfter=4)
    meta_style  = ParagraphStyle("M",  parent=styles["Normal"],   fontSize=9,  spaceAfter=2,
                                 textColor=colors.HexColor("#555555"))
    total_style = ParagraphStyle("S",  parent=styles["Heading1"], fontSize=20, spaceAfter=8,
                                 textColor=colors.HexColor("#1a5276"), alignment=TA_CENTER)
    note_style  = ParagraphStyle("N",  parent=styles["Normal"],   fontSize=7,
                                 textColor=colors.grey, fontName="Helvetica-Oblique")
    cell_style  = ParagraphStyle("C",  parent=styles["Normal"],   fontSize=8,  leading=10)
    sub_style   = ParagraphStyle("CS", parent=styles["Normal"],   fontSize=8,  leading=10,
                                 leftIndent=8, textColor=colors.HexColor("#333333"))
    hdr_style   = ParagraphStyle("H",  parent=styles["Normal"],   fontSize=9,
                                 textColor=colors.white, fontName="Helvetica-Bold")

    doc = SimpleDocTemplate(buf, pagesize=letter,
                            topMargin=0.5*inch, bottomMargin=0.5*inch,
                            leftMargin=0.75*inch, rightMargin=0.75*inch)
    story = []
    heading = "AI Grading Summary (TA Confirmed)" if confirmed else "AI Grading Summary"
    story.append(Paragraph(heading, title_style))
    story.append(Paragraph(f"Lab: {schema.get('lab_title', '')}", meta_style))
    story.append(Paragraph(f"File: {report_filename}", meta_style))
    if confirmed:
        ts = grading_results.get("confirmed_at") or datetime.now().strftime("%Y-%m-%d %H:%M")
        story.append(Paragraph(f"Confirmed: {ts}", meta_style))
    else:
        story.append(Paragraph(
            f"Graded: {datetime.now().strftime('%Y-%m-%d %H:%M')}", meta_style))
    story.append(Spacer(1, 0.1*inch))

    total   = grading_results.get("total_score", 0)
    max_tot = schema.get("total_points", 100)
    story.append(Paragraph(f"TOTAL: {total} / {max_tot}", total_style))
    story.append(Spacer(1, 0.1*inch))

    col_w = [1.55*inch, 0.40*inch, 0.52*inch, 4.53*inch]
    def hdr(t): return Paragraph(t, hdr_style)
    def cel(t): return Paragraph(str(t), cell_style)
    def sub(t): return Paragraph(str(t), sub_style)

    rows   = [[hdr("Section"), hdr("Max"), hdr("Score"), hdr("Comment")]]
    sec_res = grading_results.get("sections", {})

    for sec in schema["sections"]:
        sid   = sec["id"]
        res   = sec_res.get(sid, {})
        rows.append([cel(sec["rubric_name"]), cel(sec["max_points"]),
                     cel(res.get("score", "-")), cel(res.get("comment", ""))])
        for s in sec.get("subsections", []):
            sr = res.get("subsection_scores", {}).get(s["id"], {})
            rows.append([sub(f"  + {s['name']}"), sub(s["max_points"]),
                         sub(sr.get("score", "-")), sub(sr.get("comment", ""))])

    rows.append([cel("TOTAL"), cel(max_tot), cel(total), cel("")])

    tbl = Table(rows, colWidths=col_w, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",     (0,0),  (-1,0),  colors.HexColor("#1a5276")),
        ("FONTSIZE",       (0,0),  (-1,0),  9),
        ("ROWBACKGROUNDS", (0,1),  (-1,-2), [colors.white, colors.HexColor("#f4f6f7")]),
        ("BACKGROUND",     (0,-1), (-1,-1), colors.HexColor("#d5e8d4")),
        ("FONTNAME",       (0,-1), (-1,-1), "Helvetica-Bold"),
        ("ALIGN",          (1,0),  (2,-1),  "CENTER"),
        ("VALIGN",         (0,0),  (-1,-1), "TOP"),
        ("GRID",           (0,0),  (-1,-1), 0.4, colors.HexColor("#cccccc")),
        ("LEFTPADDING",    (0,0),  (-1,-1), 4),
        ("RIGHTPADDING",   (0,0),  (-1,-1), 4),
        ("TOPPADDING",     (0,0),  (-1,-1), 3),
        ("BOTTOMPADDING",  (0,0),  (-1,-1), 3),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 0.12*inch))
    note = ("TA-confirmed grade." if confirmed else
            "AI-generated grade. TA review required before finalisation.")
    story.append(Paragraph(note, note_style))
    doc.build(story)
    return buf.getvalue()


def build_output_pdf(student_pdf_path: Path, grading_results: dict,
                     schema: dict, output_path: Path, confirmed: bool = False):
    summary   = build_summary_page(grading_results, schema,
                                   student_pdf_path.name, confirmed=confirmed)
    sum_doc   = fitz.open("pdf", summary)
    stud_doc  = fitz.open(str(student_pdf_path))
    merged    = fitz.open()
    merged.insert_pdf(sum_doc)
    merged.insert_pdf(stud_doc)
    merged.save(str(output_path))
    sum_doc.close(); stud_doc.close(); merged.close()


# ── Per-report grading ─────────────────────────────────────────────────────────

def grade_report(client: anthropic.Anthropic,
                 student_pdf_path: Path,
                 schema: dict,
                 gt_doc: fitz.Document | None = None,
                 gt_section_map: dict | None = None,
                 should_cancel=None) -> dict:
    print(f"\n  > {student_pdf_path.name}")
    student_doc = fitz.open(str(student_pdf_path))
    gt_section_map = gt_section_map or {}

    if should_cancel and should_cancel():
        student_doc.close()
        raise GradingCancelled()

    print("    [phase 1] Mapping sections...")
    try:
        student_map = map_sections(client, student_doc, schema,
                                   label=student_pdf_path.stem)
    except Exception as e:
        print(f"    ERROR mapping: {e}")
        student_doc.close()
        return {}

    print("    [phase 2] Grading sections...")
    results = {"file": student_pdf_path.name, "sections": {}, "total_score": 0,
               "section_pages": student_map}

    for section in schema["sections"]:
        if should_cancel and should_cancel():
            student_doc.close()
            raise GradingCancelled()
        sid           = section["id"]
        student_pages = student_map.get(sid, [])
        gt_pages      = gt_section_map.get(sid, [])
        print(f"      {section['rubric_name']:30s} pp={student_pages}")
        try:
            res = grade_section(client, section, student_doc,
                                student_pages,
                                gt_doc=gt_doc, gt_pages=gt_pages)
        except Exception as e:
            print(f"        ERROR: {e}")
            res = {"score": 0, "comment": f"Error: {e}", "subsection_scores": {}}
        results["sections"][sid]  = res
        results["total_score"]   += _coerce_int(res.get("score"))

    student_doc.close()
    print(f"    → Total: {results['total_score']}/{schema.get('total_points',100)}")
    return results


# ── Lab-level orchestration (used by server.py) ────────────────────────────────

def run_lab(client: anthropic.Anthropic,
            lab_dir: Path,
            report_ids: list[str] | None = None,
            progress_callback=None,
            force_regen: bool = False,
            should_cancel=None) -> list[dict]:
    """
    Grade all or selected reports in a lab directory.
    progress_callback(current, total, filename) is called before each report is graded.
    should_cancel() is polled between reports/sections; raising GradingCancelled stops the run.
    Returns list of {id, score, error} dicts.
    """
    paths = make_paths(lab_dir)
    paths.output_dir.mkdir(exist_ok=True)
    paths.cache_dir.mkdir(exist_ok=True)

    # Phase 0: schema
    schema = generate_schema(client, paths, force=force_regen)

    # Phase 0b: ground truth map (optional — legacy student reference)
    gt_files = list(paths.gt_dir.glob("*.pdf"))
    gt_doc = None
    gt_section_map = {}

    if gt_files:
        gt_doc = fitz.open(str(gt_files[0]))
        if paths.gt_map_file.exists() and not force_regen:
            gt_section_map = json.loads(paths.gt_map_file.read_text())
            print("[Phase 0b] Loaded cached GT section map")
        else:
            print("[Phase 0b] Mapping ground truth sections...")
            gt_section_map = map_sections(client, gt_doc, schema, label="ground_truth")
            paths.gt_map_file.write_text(json.dumps(gt_section_map, indent=2))
    else:
        print("[Phase 0b] No student reference PDF — grading from rubric only")

    # Resolve which reports to grade
    all_pdfs = sorted(paths.input_dir.glob("*.pdf"),
                      key=lambda p: int(p.stem) if p.stem.isdigit() else p.stem)
    if report_ids:
        pdfs = [paths.input_dir / (r if r.endswith(".pdf") else f"{r}.pdf")
                for r in report_ids]
        pdfs = [p for p in pdfs if p.exists()]
    else:
        pdfs = all_pdfs

    results = []
    for i, pdf_path in enumerate(pdfs):
        if should_cancel and should_cancel():
            print(f"    Cancelled before {pdf_path.name}")
            break
        if progress_callback:
            progress_callback(i, len(pdfs), pdf_path.name)

        try:
            res = grade_report(client, pdf_path, schema,
                               gt_doc=gt_doc, gt_section_map=gt_section_map,
                               should_cancel=should_cancel)
            if not res:
                results.append({"id": pdf_path.stem, "score": None, "error": "Mapping failed"})
                continue

            # Save JSON
            json_out = paths.output_dir / f"{pdf_path.stem}_grades.json"
            json_out.write_text(json.dumps(res, indent=2))

            # Save graded PDF
            pdf_out = paths.output_dir / f"{pdf_path.stem}_graded.pdf"
            build_output_pdf(pdf_path, res, schema, pdf_out)

            results.append({"id": pdf_path.stem, "score": res["total_score"], "error": None})
        except GradingCancelled:
            print(f"    Cancelled mid-report {pdf_path.name}")
            results.append({"id": pdf_path.stem, "score": None, "error": "Cancelled"})
            break
        except Exception as e:
            print(f"    ERROR grading {pdf_path.name}: {e}")
            results.append({"id": pdf_path.stem, "score": None, "error": str(e)})

    if gt_doc:
        gt_doc.close()
    return results


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Lab Report Grader")
    parser.add_argument("--lab",  type=str, default="labs/THRef_Lab1",
                        help="Path to the lab directory")
    parser.add_argument("--file", type=str, default=None,
                        help="Grade a single PDF from input/ (e.g. --file 1.pdf)")
    parser.add_argument("--regen-schema", action="store_true",
                        help="Force regeneration of rubric_schema.json")
    args = parser.parse_args()

    lab_dir = Path(args.lab)
    if not lab_dir.exists():
        sys.exit(f"ERROR: lab directory not found: {lab_dir}")

    client     = anthropic.Anthropic()
    report_ids = [Path(args.file).stem] if args.file else None

    print(f"Lab Grader — {lab_dir}")
    print("=" * 60)

    results = run_lab(
        client, lab_dir,
        report_ids=report_ids,
        force_regen=args.regen_schema,
    )

    print("\n" + "=" * 60)
    print(f"{'File':<20} {'Score':>6}")
    print("-" * 60)
    for r in results:
        score = str(r["score"]) if r["score"] is not None else f"ERROR: {r['error']}"
        print(f"{r['id']:<20} {score:>6}")
    print("=" * 60)


if __name__ == "__main__":
    main()
