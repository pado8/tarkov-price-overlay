import os
import shutil
import sys

import cv2
import easyocr
import numpy as np


def _resource_base() -> str:
    """Return the directory that holds bundled resources.
    - dev / source run: this file's directory (python-core/)
    - PyInstaller frozen: sys._MEIPASS (onedir => <app>/_internal)
    """
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


# Bundle EasyOCR models with the project rather than the user-global
# ~/.EasyOCR cache so the app is self-contained.
MODEL_DIR = os.path.join(_resource_base(), "models", "easyocr")
os.makedirs(MODEL_DIR, exist_ok=True)


def _migrate_legacy_models() -> None:
    """One-time copy from the user-global ~/.EasyOCR/model into the
    project-local MODEL_DIR so we don't re-download on first run."""
    legacy = os.path.expanduser("~/.EasyOCR/model")
    if not os.path.isdir(legacy):
        return
    moved = 0
    for fname in os.listdir(legacy):
        src = os.path.join(legacy, fname)
        dst = os.path.join(MODEL_DIR, fname)
        if os.path.isfile(src) and not os.path.exists(dst):
            shutil.copy2(src, dst)
            moved += 1
    if moved:
        print(f"[ocr] migrated {moved} EasyOCR model file(s) to {MODEL_DIR}")


_migrate_legacy_models()

_readers: dict[tuple[str, ...], easyocr.Reader] = {}


def _get_reader(langs: tuple[str, ...]) -> easyocr.Reader:
    if langs not in _readers:
        print(f"[ocr] loading reader langs={langs} from {MODEL_DIR}")
        _readers[langs] = easyocr.Reader(
            list(langs),
            gpu=False,
            model_storage_directory=MODEL_DIR,
        )
        print(f"[ocr] reader ready for langs={langs}")
    return _readers[langs]


def _to_gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    if image.shape[-1] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def recognize_text(image: np.ndarray, langs: tuple[str, ...] = ("ko", "en")) -> str:
    reader = _get_reader(langs)
    gray = _to_gray(image)
    # paragraph=False is faster (skips line-grouping postproc); item names are
    # typically a single line so we just join the fragments ourselves.
    results = reader.readtext(gray, detail=0, paragraph=False)
    return " ".join(results).strip()
