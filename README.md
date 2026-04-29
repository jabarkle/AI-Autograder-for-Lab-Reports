# Lab Report Grader Agent
**CMU 24-321 Thermal Fluids Experimentation — AI-Assisted Grading System**
*Built for the CMU AI Fellow Program*

---

## Vision

This system uses AI to assist TAs in grading student lab reports. The goal is not to replace TA judgment — it is to do the first-pass grading automatically so TAs spend their time reviewing and correcting AI grades rather than grading from scratch. The system works for **any lab report** that follows a standard section structure; the rubric schema is generated dynamically from the Ground Truth document.

---

## Install (TAs)

The easiest way to use the system is the prebuilt desktop app.

1. Go to the project's GitHub Releases page and download the file for your OS:
   - Windows: `LabGrader-Setup-<version>.exe`
   - macOS:   `LabGrader-<version>-x64.dmg` (Intel) or `-arm64.dmg` (Apple Silicon)
   - Linux:   `LabGrader-<version>.AppImage`
2. Double-click to install / open.
3. On first launch, paste your Anthropic API key in the input box on the main page. The key is stored only for the current session unless you check "Remember", in which case it's encrypted with the OS keychain.

### First-run security warnings (unsigned builds)

The current release is **not** code-signed, so the OS will warn you the first time you launch it.

- **Windows:** "Windows protected your PC" → click "More info" → "Run anyway".
- **macOS:** Right-click the app → "Open" → "Open" again. Or System Settings → Privacy & Security → "Open Anyway" after the first attempt.

After the first launch the warnings go away.

---

## Usage

1. **Enter your API key** in the header on the main page.
2. **Create a lab** (or open an existing one).
3. **Upload files** in the lab dashboard:
   - **Student Reports**: drop a `.zip` containing all student PDFs.
   - **Ground Truth**: drop the TA base lab document (PDF with grading criteria, model answers, point breakdowns).
4. **Grade**: click "Grade All" or select specific reports → "Grade Selected".
5. **Review**: click any graded report. You'll see the PDF on the left and section cards on the right.
6. **Confirm each section** as you review it. Editing any score or comment automatically un-confirms that section so you can re-review.
7. **Confirm the whole report** once every section is confirmed. The graded PDF is rebuilt with the AI summary cover page each time you save.
8. **Download all graded PDFs as a ZIP** with the "Download Graded" button on the lab dashboard. The ZIP saves to your Desktop by default. Use this to upload back to Gradescope.

---

## Develop

You only need this section if you want to run from source or build the desktop installer yourself.

### 1. Backend
```bash
conda create -n lab-grader python=3.11 -y
conda activate lab-grader
pip install -r requirements.txt
uvicorn server:app --reload --port 9090
```

### 2. Frontend (Vite dev server)
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173.

### 3. CLI grading (no GUI)
```bash
python grader.py --lab labs/THRef_Lab1 --file 1.pdf
python grader.py --lab labs/THRef_Lab1
python grader.py --lab labs/THRef_Lab1 --regen-schema
```

### 4. Build the desktop installer locally
```bash
pip install pyinstaller
python scripts/build_desktop.py
```
Outputs land in `electron/dist/`.

GitHub Actions does the same on every `git tag v*` push and attaches installers for all three OSes to the corresponding GitHub Release — see `.github/workflows/release.yml`.

---

## Architecture

```
Lab Grader Agent/
│
├── server.py              ← FastAPI backend (REST + grading orchestration)
├── grader.py              ← AI pipeline (schema gen, mapping, section grading)
├── pdf_cleaner.py         ← One-time helper for stripping Gradescope prefix pages
├── backend.spec           ← PyInstaller bundling spec
│
├── frontend/              ← React 19 + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts                 ← API client + per-session API key store
│   │   ├── GradingContext.tsx     ← Cross-page grading job state
│   │   ├── pages/                 ← LabsPage, LabDashboard, ReviewPage
│   │   └── components/            ← ApiKeyBar, DropZone
│   └── dist/              ← Production build (served by FastAPI)
│
├── electron/              ← Desktop app shell
│   ├── main.js                    ← Backend lifecycle, window, IPC
│   ├── preload.js                 ← Context-isolated bridge for safeStorage
│   └── package.json               ← electron-builder config
│
├── labs/                  ← Per-lab data (NEVER committed)
│   └── <lab_id>/
│       ├── meta.json
│       ├── input/         ← Student PDFs
│       ├── rubrics/       ← Ground Truth PDF
│       ├── output/        ← Graded PDFs and JSON grades
│       └── cache/         ← rubric_schema.json, gt_section_map.json
│
├── scripts/build_desktop.py   ← End-to-end local build helper
├── .github/workflows/release.yml ← GitHub Actions cross-OS release pipeline
├── requirements.txt           ← Python deps
└── .gitignore
```

In packaged installs, `labs/` lives in the OS user-data directory (not next to the exe), so reinstalling the app never deletes lab data.

---

## How It Works

### Phase 0 — Schema Generation (Claude Opus, runs once per lab)
Opus reads the full text of the Ground Truth PDF and produces `rubric_schema.json` — sections, subsections, point values, grading criteria copied verbatim, model-answer summaries. Cached per-lab; regenerated when the Ground Truth is replaced.

### Phase 1 — Section Mapping (Claude Sonnet, one call per report)
Sonnet receives images of every page and maps each page to a rubric section. The mapping is saved in the grades JSON for page-jump navigation.

### Phase 2 — Section Grading (Claude Sonnet, one call per section)
For each section, Sonnet receives the rubric criteria + that section's student page images and returns a score (clamped to max), an actionable comment, and per-subsection scores.

### Grading Philosophy
- Only deduct points for criteria explicitly listed in the rubric.
- Never penalise for numerical results — each group has its own data.
- Default to full points; deduct only when something is clearly wrong or missing.
- Give students the benefit of the doubt.

### Output
Per report:
- `{n}_grades.json` — scores, comments, subsection scores, page mapping, per-section confirm flags.
- `{n}_graded.pdf` — original report with an AI summary cover page prepended. Rebuilt every save/confirm.

### TA confirmation flow
- Each section has a **Confirm Section** button.
- Editing any score or comment in a section automatically un-confirms it.
- The overall **Confirm Grade** button stays disabled until every section is confirmed.
- Confirmed reports become the source of truth; unlock to re-edit.

### Batch download
The lab dashboard's **Download Graded** button streams a ZIP of every `_graded.pdf` for that lab. Filename: `{lab_name}_{YYYYMMDD}_graded.zip`. In the desktop app, the ZIP saves to the user's Desktop by default.

---

## Tech Stack

| Layer    | Tech                                                                |
|----------|---------------------------------------------------------------------|
| Backend  | Python 3.11+, FastAPI, Uvicorn                                      |
| AI       | Anthropic Claude (Opus for schema, Sonnet for grading)              |
| PDF      | PyMuPDF (rendering), ReportLab (summary cover)                      |
| Frontend | React 19, TypeScript, Vite, Tailwind, Lucide Icons                  |
| Desktop  | Electron + electron-builder + safeStorage; PyInstaller-bundled API  |
| CI       | GitHub Actions (matrix: windows / macOS / ubuntu)                   |

---

## API Cost Estimate (per batch of 16 reports)

| Phase             | Model  | Calls | Approx. cost |
|-------------------|--------|-------|--------------|
| Schema generation | Opus   |   1   | ~$0.15       |
| Section mapping   | Sonnet |  16   | ~$0.80       |
| Section grading   | Sonnet |  80   | ~$4.00       |
| **Total**         |        |       | **~$5.00**   |

Schema is cached and not re-billed on re-runs. Costs vary with report length and image resolution.
