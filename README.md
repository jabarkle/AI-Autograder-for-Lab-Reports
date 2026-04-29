# Lab Report Grader Agent
**CMU 24-321 Thermal Fluids Experimentation — AI-Assisted Grading System**
*Built for the CMU AI Fellow Program*

---

## ⬇️ Quick Install (TAs — start here)

> **One-line install:** download the file for your OS from [the latest release](https://github.com/jabarkle/AI-Autograder-for-Lab-Reports/releases/latest), double-click it, follow the prompts. No Python, Node, or terminal required.

### Windows

1. Open the [**latest release page**](https://github.com/jabarkle/AI-Autograder-for-Lab-Reports/releases/latest).
2. Under **Assets**, click **`LabGrader-Setup-1.0.0.exe`** (≈109 MB).
3. When the download finishes, double-click the file from your Downloads folder.
4. Windows will show **"Windows protected your PC"** — click **"More info"** → **"Run anyway"**. *(Only happens the first time.)*
5. The installer runs silently and Lab Grader auto-launches. A **Lab Grader** shortcut appears on your Desktop and Start Menu.
6. In the app, paste your Anthropic API key into the input box at the top of the main page. Done.

### macOS — Apple Silicon (M1 / M2 / M3 / M4)

1. Open the [**latest release page**](https://github.com/jabarkle/AI-Autograder-for-Lab-Reports/releases/latest).
2. Under **Assets**, click **`LabGrader-1.0.0-arm64.dmg`** (≈137 MB).
3. Open the downloaded `.dmg` file. A window appears with the **Lab Grader** icon and an **Applications** folder shortcut.
4. **Drag** the Lab Grader icon **onto** the Applications folder.
5. Open Launchpad (or Applications) → **right-click** Lab Grader → **Open** → click **Open** in the dialog. *(Only the first launch needs the right-click. After that just click normally.)*
6. Paste your Anthropic API key into the input box at the top of the main page. Done.

> Not sure if your Mac is Apple Silicon? Click the Apple menu → **About This Mac**. If the chip says "Apple M1/M2/M3/M4" use this file. If it says "Intel", use the Intel file below.

### macOS — Intel

Same steps as Apple Silicon, but in step 2 click **`LabGrader-1.0.0-x64.dmg`** (≈141 MB) instead.

### Linux

1. Open the [**latest release page**](https://github.com/jabarkle/AI-Autograder-for-Lab-Reports/releases/latest).
2. Under **Assets**, click **`LabGrader-1.0.0.AppImage`** (≈164 MB).
3. Make it executable and run:
   ```bash
   chmod +x ~/Downloads/LabGrader-1.0.0.AppImage
   ~/Downloads/LabGrader-1.0.0.AppImage
   ```
4. Paste your Anthropic API key into the input box at the top of the main page. Done.

### What to ignore in the Assets list

The release page lists a few extra files: `*.blockmap`, `*.yml`, `builder-debug.yml`, "Source code (zip)", "Source code (tar.gz)". **Skip all of these** — they're metadata for the auto-updater and source archives. You only need the one installer file for your OS.

### Where your data lives

- **Windows:** `%APPDATA%\LabGrader\labs\`
- **macOS:** `~/Library/Application Support/LabGrader/labs/`
- **Linux:** `~/.config/LabGrader/labs/`

Uninstalling the app does **not** delete your lab data.

---

## Vision

This system uses AI to assist TAs in grading student lab reports. The goal is not to replace TA judgment — it is to do the first-pass grading automatically so TAs spend their time reviewing and correcting AI grades rather than grading from scratch. The system works for **any lab report** that follows a standard section structure; the rubric schema is generated dynamically from the Ground Truth document.

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
