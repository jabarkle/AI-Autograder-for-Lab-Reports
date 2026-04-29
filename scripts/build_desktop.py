"""
build_desktop.py — local helper to build the desktop app end-to-end.

Run from the repo root:
    python scripts/build_desktop.py

Steps:
    1. Build frontend (npm run build in frontend/)
    2. Build backend with PyInstaller into backend_dist/server/
    3. Run electron-builder in electron/ to produce installers in electron/dist/

Requires: Node 18+, Python 3.11+, all dependencies from requirements.txt + frontend/package.json.
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd, cwd=None):
    print(f"\n$ {' '.join(cmd)}  (cwd={cwd or ROOT})")
    subprocess.check_call(cmd, cwd=str(cwd or ROOT), shell=False)


def main():
    # 1. Frontend
    print("\n=== Building frontend ===")
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    run([npm, "ci"], cwd=ROOT / "frontend")
    run([npm, "run", "build"], cwd=ROOT / "frontend")

    # 2. Backend
    print("\n=== Building backend with PyInstaller ===")
    backend_dist = ROOT / "backend_dist"
    if backend_dist.exists():
        shutil.rmtree(backend_dist)
    run([
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--distpath", str(backend_dist),
        "--workpath", str(ROOT / "build" / "backend"),
        "backend.spec",
    ])

    # 3. Electron
    print("\n=== Building installers with electron-builder ===")
    electron_dir = ROOT / "electron"
    if (electron_dir / "package-lock.json").exists():
        run([npm, "ci"], cwd=electron_dir)
    else:
        run([npm, "install", "--no-audit", "--no-fund"], cwd=electron_dir)
    run([npm, "run", "dist"], cwd=electron_dir)

    print("\n✓ Done. Installers are in electron/dist/")


if __name__ == "__main__":
    main()
