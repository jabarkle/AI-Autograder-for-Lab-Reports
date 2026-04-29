"""
pdf_cleaner.py

Strips Gradescope prefix pages from each lab report PDF, then organizes:
  - Report 17 (highest score, 97/100) → ground_truth/
  - All others → input/

Detection strategy: the actual lab report starts on the first page containing
"Thermal Fluids Experimentation", which only appears in the CMU report header.
"""

import os
import shutil
import fitz  # pymupdf
from dotenv import load_dotenv

load_dotenv()

SOURCE_DIR = "THRef Lab Reports 2025"
GROUND_TRUTH_FILE = "17.pdf"  # 97/100 — Isabella Kalinowski, Isha Tulsyan, Rosario Picone
INPUT_DIR = "input"
GROUND_TRUTH_DIR = "ground_truth"
OUTPUT_DIR = "output"

MARKER_TEXT = "assigned to the following page"


def find_report_start_page(doc: fitz.Document) -> int:
    """
    Returns the 0-based index of the first page that belongs to the actual
    lab report. Gradescope overlays every actual lab page with one of:
      - "No questions assigned to the following page."
      - "Questions assigned to the following page: X"
      - "Question assigned to the following page: X"
    The first occurrence of this overlay marks where the real report begins.
    Returns -1 if not found.
    """
    for i, page in enumerate(doc):
        text = page.get_text()
        if MARKER_TEXT in text:
            return i
    return -1


def clean_pdf(src_path: str, dst_path: str) -> dict:
    """
    Strips Gradescope prefix pages from src_path and saves the cleaned PDF
    to dst_path. Returns a dict with metadata about what was done.
    """
    doc = fitz.open(src_path)
    total_pages = len(doc)
    start_page = find_report_start_page(doc)

    if start_page == -1:
        doc.close()
        return {
            "file": os.path.basename(src_path),
            "status": "ERROR — marker text not found",
            "total_pages": total_pages,
            "stripped_pages": 0,
            "kept_pages": total_pages,
        }

    # Delete all pages before the actual report start
    if start_page > 0:
        doc.delete_pages(0, start_page - 1)

    doc.save(dst_path)
    doc.close()

    stripped = start_page
    kept = total_pages - stripped

    return {
        "file": os.path.basename(src_path),
        "status": "OK",
        "total_pages": total_pages,
        "stripped_pages": stripped,
        "kept_pages": kept,
    }


def main():
    source_files = sorted(
        [f for f in os.listdir(SOURCE_DIR) if f.endswith(".pdf")],
        key=lambda x: int(x.replace(".pdf", ""))
    )

    print(f"Found {len(source_files)} reports to process.\n")
    print(f"{'File':<12} {'Status':<40} {'Total':>6} {'Stripped':>9} {'Kept':>6} {'Destination'}")
    print("-" * 90)

    results = []
    for filename in source_files:
        src_path = os.path.join(SOURCE_DIR, filename)

        if filename == GROUND_TRUTH_FILE:
            dst_path = os.path.join(GROUND_TRUTH_DIR, filename)
        else:
            dst_path = os.path.join(INPUT_DIR, filename)

        result = clean_pdf(src_path, dst_path)
        result["destination"] = dst_path
        results.append(result)

        dest_label = "ground_truth/" if filename == GROUND_TRUTH_FILE else "input/"
        print(
            f"{result['file']:<12} {result['status']:<40} "
            f"{result['total_pages']:>6} {result['stripped_pages']:>9} "
            f"{result['kept_pages']:>6}   {dest_label}"
        )

    errors = [r for r in results if r["status"] != "OK"]
    print(f"\n{'='*90}")
    print(f"Completed: {len(results) - len(errors)}/{len(results)} successful.")
    if errors:
        print("ERRORS:")
        for e in errors:
            print(f"  {e['file']}: {e['status']}")
    else:
        print("All reports cleaned successfully. No errors.")


if __name__ == "__main__":
    main()
