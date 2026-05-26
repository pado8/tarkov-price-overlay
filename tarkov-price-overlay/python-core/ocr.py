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


# EFT tooltip background envelope (HSV) — conservative pass-1 thresholds.
# Goal here is to drop ONLY obviously-not-tooltip pixels (highly saturated
# colored icons, bright UI), while keeping anything plausibly on the
# tooltip's dark-grey panel. The first attempt at this filter (S<50 and
# 15<=V<=110) inverted on real EFT captures — actual tooltip BG can be
# near-black (V<15) and tooltips often OVERLAP neighboring item icons
# (so "RatCola"-style icon text ends up over the tooltip BG too). Loose
# bounds + the multi-candidate retry by length (longest fragment wins)
# is the safer combo until we have a debug capture for precise tuning.
#   S (saturation): max 100 — drop only clearly colored backgrounds
#   V (value):      max 150 — drop bright UI elements
# Tighten these once we have a real debug PNG to sample EFT tooltip pixels
# against. Set TARKOV_DEBUG_CAPTURE=1 to write captures to _debug_captures/.
_TOOLTIP_S_MAX = 100
_TOOLTIP_V_MIN = 0
_TOOLTIP_V_MAX = 150


def _has_tooltip_background(hsv: np.ndarray, bbox) -> bool:
    """True when the pixels surrounding an OCR text bbox look like an EFT
    tooltip background (low-saturation dark grey). Used to drop OCR text
    that's actually painted onto an inventory item icon — e.g. "RatCola"
    on a green soda-can icon next to the hovered item.

    bbox is EasyOCR's 4-corner format: [[x0,y0],[x1,y1],[x2,y2],[x3,y3]].
    Samples 4 thin strips just outside the bbox (skipping the immediate
    1–2 pixel halo where text anti-aliasing bleeds into the background).
    """
    h, w = hsv.shape[:2]
    xs = [int(p[0]) for p in bbox]
    ys = [int(p[1]) for p in bbox]
    x0 = max(0, min(xs))
    x1 = min(w - 1, max(xs))
    y0 = max(0, min(ys))
    y1 = min(h - 1, max(ys))
    PAD = 4
    SKIP = 2
    strips = []
    if y0 - SKIP > 0:
        strips.append(hsv[max(0, y0 - SKIP - PAD):max(0, y0 - SKIP), x0:x1 + 1])
    if y1 + SKIP < h:
        strips.append(hsv[min(h, y1 + SKIP):min(h, y1 + SKIP + PAD), x0:x1 + 1])
    if x0 - SKIP > 0:
        strips.append(hsv[y0:y1 + 1, max(0, x0 - SKIP - PAD):max(0, x0 - SKIP)])
    if x1 + SKIP < w:
        strips.append(hsv[y0:y1 + 1, min(w, x1 + SKIP):min(w, x1 + SKIP + PAD)])
    pixels = [s.reshape(-1, 3) for s in strips if s.size > 0]
    if not pixels:
        # Bbox is flush with the image edge — no surroundings to sample.
        # Keep it conservatively (assume tooltip) so we don't drop edge
        # text that might legitimately be the item name.
        return True
    all_pixels = np.concatenate(pixels)
    median_s = float(np.median(all_pixels[:, 1]))
    median_v = float(np.median(all_pixels[:, 2]))
    return (
        median_s < _TOOLTIP_S_MAX
        and _TOOLTIP_V_MIN <= median_v <= _TOOLTIP_V_MAX
    )


def recognize_text_fragments(
    image: np.ndarray, langs: tuple[str, ...] = ("ko", "en")
) -> list[str]:
    """Return OCR text fragments, filtered to keep only text that sits on
    an EFT tooltip background. Drops text painted onto neighboring
    inventory item icons (RatCola, etc.) that polluted the joined OCR
    string and was causing false-positive matches.

    EasyOCR returns fragments in detection order (top-to-bottom, left-to-
    right), which matches EFT tooltip layout (item name at the top).
    Falls back to unfiltered fragments when the filter rejects everything
    so we never break tooltips with unusual backgrounds (e.g. raid menus,
    different game UI themes)."""
    reader = _get_reader(langs)
    gray = _to_gray(image)
    # detail=1 returns (bbox, text, confidence) so we can sample the
    # surrounding pixels per text region. paragraph=False keeps each
    # detection separate so we can filter individually.
    results = reader.readtext(gray, detail=1, paragraph=False)
    if not results:
        return []
    # Convert to HSV once for background sampling. mss captures BGRA; cv2
    # has no direct BGRA→HSV so we bridge through BGR first.
    hsv = None
    if image.ndim == 3:
        if image.shape[-1] == 4:
            bgr = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
        else:
            bgr = image
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    kept: list[str] = []
    rejected: list[str] = []
    for bbox, text, _conf in results:
        text = (text or "").strip()
        if not text:
            continue
        if hsv is not None and not _has_tooltip_background(hsv, bbox):
            rejected.append(text)
        else:
            kept.append(text)
    if rejected:
        print(f"[ocr] dropped non-tooltip fragments: {rejected!r}")
    if not kept and rejected:
        # Filter ate everything — fall back to unfiltered. Better to OCR
        # against possible noise than to return zero fragments.
        print("[ocr] filter rejected all fragments — falling back unfiltered")
        return rejected
    return kept


def recognize_text(image: np.ndarray, langs: tuple[str, ...] = ("ko", "en")) -> str:
    return " ".join(recognize_text_fragments(image, langs)).strip()
