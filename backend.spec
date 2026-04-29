# PyInstaller spec for the Lab Grader backend.
# Build with:   pyinstaller backend.spec
# Output:       backend_dist/server/  (one-folder bundle, faster startup than --onefile)

# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

# Hidden imports — modules dynamically imported by FastAPI / uvicorn / anthropic
hiddenimports = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("anthropic")
hiddenimports += collect_submodules("fitz")
hiddenimports += collect_submodules("reportlab")
hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "platformdirs",
    "pydantic",
    "fastapi",
    "anyio",
    "h11",
    "click",
]

# Data files: Anthropic ships some json schemas / cert bundles; reportlab fonts; etc.
datas = []
datas += collect_data_files("anthropic")
datas += collect_data_files("reportlab")
datas += collect_data_files("certifi")

# Bundle the frontend dist alongside the exe (server.py looks for it in _MEIPASS)
if os.path.isdir(os.path.join("frontend", "dist")):
    datas.append((os.path.join("frontend", "dist"), os.path.join("frontend", "dist")))


a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy.tests"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # No console window when launched by Electron
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="server",
)
