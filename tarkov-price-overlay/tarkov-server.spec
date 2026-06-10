# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for tarkov-price-overlay Python sidecar.
# Build with: pyinstaller tarkov-server.spec  (run from C:\project)

import os
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
    # Use SPECPATH so the path resolves against the .spec file's location
    # (C:\project\), not against `pathex` entries like python-core/.
    runtime_hooks=[os.path.join(SPECPATH, "runtime-hook-torch.py")],
    excludes=[],
    noarchive=False,
    optimize=0,
)

# ── Dead-weight strip ────────────────────────────────────────────────────
# collect_all("torch") drags in everything under torch/, including build-time
# artifacts the frozen runtime NEVER touches:
#   torch/lib/*.lib  — static import libraries for C++ linking (820MB!,
#                      dnnl.lib alone is 676MB; the runtime loads the .dlls)
#   torch/include/   — C++ headers, only used by torch.utils.cpp_extension
#                      JIT compilation, which EasyOCR never does (53MB)
#   torch/test, torch/share — test fixtures / cmake exports
# Stripping cuts the bundle ~55% (1.58GB → ~0.7GB): faster PyInstaller
# COLLECT, faster NSIS/zip compression, far smaller installer+portable
# download for every user update.
def _is_dead_weight(dest: str) -> bool:
    d = dest.replace("\\", "/").lower()
    if d.endswith((".lib", ".exp", ".pdb")):
        return True
    if d.startswith(("torch/include/", "torch/test/", "torch/share/")):
        return True
    return False

_n_bin, _n_dat = len(a.binaries), len(a.datas)
a.binaries = [e for e in a.binaries if not _is_dead_weight(e[0])]
a.datas = [e for e in a.datas if not _is_dead_weight(e[0])]
print(
    f"[spec] dead-weight strip: binaries {_n_bin}->{len(a.binaries)}, "
    f"datas {_n_dat}->{len(a.datas)}"
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
