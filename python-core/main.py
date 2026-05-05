import sys

DPI_STATUS = "not-windows"
if sys.platform == "win32":
    import ctypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        DPI_STATUS = "per-monitor-aware (shcore.SetProcessDpiAwareness=2)"
    except (AttributeError, OSError) as e1:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
            DPI_STATUS = "system-aware (user32.SetProcessDPIAware) — fallback"
        except Exception as e2:
            DPI_STATUS = f"FAILED: {e1!r} / {e2!r}"

print(f"[startup] DPI awareness: {DPI_STATUS}")

import mss
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from capture import capture_region
from ocr import recognize_text
from tarkov_api import get_item_price

app = FastAPI(title="Tarkov Price Overlay Core")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CaptureRequest(BaseModel):
    x: int
    y: int
    width: int
    height: int
    lang: str = "ko"  # "ko" | "en"


class LookupResponse(BaseModel):
    raw_text: str
    item_name: str | None
    flea_price: int | None
    trader_price: int | None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/debug/screen")
def debug_screen() -> dict:
    with mss.mss() as sct:
        monitors = sct.monitors
    return {"dpi_status": DPI_STATUS, "monitors": monitors}


@app.post("/lookup", response_model=LookupResponse)
def lookup(req: CaptureRequest) -> LookupResponse:
    print(f"[lookup] x={req.x} y={req.y} w={req.width} h={req.height} lang={req.lang}")
    image = capture_region(req.x, req.y, req.width, req.height)
    langs = (req.lang,) if req.lang in ("ko", "en") else ("ko", "en")
    text = recognize_text(image, langs=langs)
    print(f"[lookup] OCR: {text!r}")
    price = get_item_price(text, lang=req.lang if req.lang in ("ko", "en") else "ko")
    return LookupResponse(
        raw_text=text,
        item_name=price.get("name"),
        flea_price=price.get("flea"),
        trader_price=price.get("trader"),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
