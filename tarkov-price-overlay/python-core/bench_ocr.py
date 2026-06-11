"""One-off benchmark: EasyOCR detection params vs EFT-tooltip-like images.

Goal: the production failure data says 78% of nomatch is "empty" (zero usable
detections), so we tune DETECTION sensitivity (mag_ratio / low_text), not
recognition. Synthetic images approximate EFT tooltips: dark panel, small
light-grey text, ko/en real item names, some low-contrast / tiny-font cases.

Honest limit: synthetic fonts (Malgun Gothic / Arial) aren't EFT's font, so
absolute numbers don't transfer — only the RELATIVE effect of params does.

Run:  .venv\\Scripts\\python.exe bench_ocr.py
"""
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

NAMES = [
    # English catalog names (mixed lengths)
    "Salewa first aid kit",
    "Graphics card",
    "Physical Bitcoin",
    "Bolts",
    "Corrugated hose",
    "Military power filter",
    "9x19mm AP 6.3",
    "AK-74N 5.45x39 assault rifle",
    "Car battery",
    "LEDX Skin Transilluminator",
    # Korean catalog names
    "살레와 구급 키트",
    "그래픽 카드",
    "전투용 마체테",
    "군용 코르딕스 점화 플러그",
    "수리 키트",
    "비트코인",
    "야전 의료 키트",
    "전술 조끼",
    "산탄총 탄약",
    "방탄 헬멧",
]

# (font_px, fg_grey, bg_grey) — typical / small / low-contrast / tiny+low
VARIANTS = [
    (16, 200, 22),
    (13, 190, 24),
    (14, 120, 40),
    (11, 110, 35),
]

CONFIGS = {
    "current(defaults)": {},
    "mag1.5": {"mag_ratio": 1.5},
    "mag2.0": {"mag_ratio": 2.0},
    "mag1.5+low_text0.3": {"mag_ratio": 1.5, "low_text": 0.3},
    "mag2.0+low_text0.3": {"mag_ratio": 2.0, "low_text": 0.3},
}


def make_img(text: str, px: int, fg: int, bg: int) -> np.ndarray:
    w, h = 360, 64
    img = Image.new("L", (w, h), color=bg)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("malgun.ttf", px)  # covers ko + latin
    except OSError:
        font = ImageFont.load_default()
    d.text((10, (h - px) // 2), text, fill=fg, font=font)
    return np.array(img)


def norm(s: str) -> str:
    return "".join(s.lower().split())


def close_enough(got: str, want: str) -> bool:
    """Detection-oriented score: did we read MOST of the name? (matching
    layer downstream is fuzzy with cutoff 0.6 anyway)"""
    import difflib

    g, w = norm(got), norm(want)
    if not g:
        return False
    return difflib.SequenceMatcher(None, g, w).ratio() >= 0.6


def main() -> None:
    import easyocr

    reader = easyocr.Reader(["ko", "en"], gpu=False)
    cases = [(n, v) for n in NAMES for v in VARIANTS]
    print(f"cases: {len(cases)} (names {len(NAMES)} x variants {len(VARIANTS)})")
    print(f"{'config':<22} {'detected':>9} {'read-ok':>8} {'empty':>6} {'avg_ms':>7}")
    for cfg_name, kw in CONFIGS.items():
        detected = read_ok = empty = 0
        total_ms = 0.0
        for name, (px, fg, bg) in cases:
            img = make_img(name, px, fg, bg)
            t0 = time.perf_counter()
            res = reader.readtext(img, detail=0, paragraph=False, **kw)
            total_ms += (time.perf_counter() - t0) * 1000
            joined = " ".join(res).strip()
            if res:
                detected += 1
            else:
                empty += 1
            if close_enough(joined, name):
                read_ok += 1
        n = len(cases)
        print(
            f"{cfg_name:<22} {detected:>6}/{n} {read_ok:>5}/{n} {empty:>6} "
            f"{total_ms / n:>6.0f}"
        )


if __name__ == "__main__":
    main()
