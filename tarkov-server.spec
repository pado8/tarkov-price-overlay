# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for tarkov-price-overlay Python sidecar.
# Build with: pyinstaller tarkov-server.spec  (run from C:\project)

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = [
    "cv2",
    "uvicorn.workers",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
]

# Bundle dynamic modules / data of fragile deps
for pkg in ("easyocr", "torch", "torchvision"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        # torchvision is optional; ignore if not installed
        pass

# OCR model files (already migrated into python-core/models/easyocr/)
datas += [("python-core/models/easyocr", "models/easyocr")]


a = Analysis(
    ["python-core/main.py"],
    pathex=["python-core"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=["runtime-hook-torch.py"],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="tarkov-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # keep console while we beta-test; flip to False once stable
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="tarkov-server",
)
