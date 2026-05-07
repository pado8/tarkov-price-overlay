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
            DPI_STATUS = "system-aware (user32.SetProcessDPIAware) - fallback"
        except Exception as e2:
            DPI_STATUS = f"FAILED: {e1!r} / {e2!r}"

print(f"[startup] DPI awareness: {DPI_STATUS}")

from contextlib import asynccontextmanager

import mss
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from capture import capture_region
from ocr import _get_reader, recognize_text
from tarkov_api import get_item_price, start_background_refresher


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print("[startup] warming up OCR reader (ko+en)…")
    _get_reader(("ko", "en"))  # loads models once so first /lookup is fast
    print("[startup] starting price-cache background refresher…")
    start_background_refresher()
    print("[startup] warmup complete")
    yield


app = FastAPI(title="Tarkov Price Overlay Core", lifespan=lifespan)

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
    game_mode: str = "regular"  # "regular" (PVP) | "pve"
    mirror_x: int | None = None  # alt capture x (mirrored side), tried if primary doesn't match
    cursor_x: int | None = None  # cursor pos, used to clamp capture to that monitor
    cursor_y: int | None = None
    # If set, skip capture/OCR entirely and look this name up directly.
    # Used by "직접 입력" / 최근 검색 재조회.
    override_text: str | None = None
    # User-trained OCR corrections. Keys are lowercased OCR text, values are
    # the canonical item name to query GraphQL with.
    corrections: dict[str, str] = {}


class TraderPrice(BaseModel):
    name: str
    price: int


class BarterRequiredItem(BaseModel):
    name: str
    short_name: str | None = None
    count: float = 1


class Barter(BaseModel):
    trader: str
    level: int = 1
    items: list[BarterRequiredItem] = []


class TaskRef(BaseModel):
    id: str | None = None
    name: str
    trader: str = ""
    min_level: int = 0


class HideoutCraft(BaseModel):
    station: str
    level: int = 1
    duration_sec: int = 0
    items: list[BarterRequiredItem] = []


class BarterUsing(BaseModel):
    trader: str
    level: int = 1
    rewards: list[BarterRequiredItem] = []


class BuyOffer(BaseModel):
    name: str  # trader name
    price: int  # RUB
    min_level: int = 1


class LookupResponse(BaseModel):
    raw_text: str
    item_name: str | None
    short_name: str | None = None
    width: int | None = None  # inventory grid units (1, 2, ...)
    height: int | None = None
    icon: str | None = None  # gridImageLink (webp URL)
    flea_price: int | None
    flea_low_24h: int | None = None
    flea_change_48h_pct: float | None = None
    trader_price: int | None
    sell_for: list[TraderPrice] = []  # all traders, sorted high to low (RUB)
    barters_for: list[Barter] = []  # ways to obtain this item via trader barter
    barters_using: list[BarterUsing] = []  # barters where this item is required
    buy_for: list[BuyOffer] = []  # trader cash offers (Flea excluded)
    used_in_tasks: list[TaskRef] = []  # quests that need this item
    crafts_for: list[HideoutCraft] = []  # hideout recipes producing this item
    matched_from: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/debug/screen")
def debug_screen() -> dict:
    with mss.mss() as sct:
        monitors = sct.monitors
    return {"dpi_status": DPI_STATUS, "monitors": monitors}


def _get_cursor_pos_winapi() -> tuple[int, int] | None:
    if sys.platform != "win32":
        return None
    import ctypes

    class POINT(ctypes.Structure):
        _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

    pt = POINT()
    if ctypes.windll.user32.GetCursorPos(ctypes.byref(pt)):
        return pt.x, pt.y
    return None


def _clamp_to_monitor(
    x: int, y: int, width: int, height: int, cursor_x: int, cursor_y: int
) -> tuple[int, int, int, int]:
    """Keep capture inside the monitor that contains the cursor - prevents
    bleeding into a second monitor (e.g. the dev console) at screen edges."""
    with mss.mss() as sct:
        monitors = sct.monitors[1:]  # index 0 is the virtual all-monitors bbox
        for i, m in enumerate(monitors, start=1):
            mx, my, mw, mh = m["left"], m["top"], m["width"], m["height"]
            if mx <= cursor_x < mx + mw and my <= cursor_y < my + mh:
                ox, oy, ow, oh = x, y, width, height
                width = min(width, mw)
                height = min(height, mh)
                x = max(mx, min(x, mx + mw - width))
                y = max(my, min(y, my + mh - height))
                print(
                    f"[clamp] cursor=({cursor_x},{cursor_y}) -> monitor#{i} "
                    f"[{mx},{my} {mw}x{mh}]; in=({ox},{oy} {ow}x{oh}) "
                    f"out=({x},{y} {width}x{height})"
                )
                return x, y, width, height
        print(
            f"[clamp] WARN: cursor=({cursor_x},{cursor_y}) is outside every "
            f"monitor in mss list. monitors={monitors}"
        )
    return x, y, width, height


def _capture_and_lookup(
    x: int,
    y: int,
    width: int,
    height: int,
    lang: str,
    game_mode: str,
    label: str,
    corrections: dict[str, str],
) -> tuple[str, dict]:
    import time

    t0 = time.perf_counter()
    image = capture_region(x, y, width, height)
    t1 = time.perf_counter()
    text = recognize_text(image, langs=("ko", "en"))
    t2 = time.perf_counter()
    print(f"[lookup] OCR({label}): {text!r}")
    price = get_item_price(text, lang=lang, game_mode=game_mode, corrections=corrections)
    t3 = time.perf_counter()
    print(
        f"[timing/{label}] capture={t1 - t0:.3f}s ocr={t2 - t1:.3f}s "
        f"price_lookup={t3 - t2:.3f}s total={t3 - t0:.3f}s"
    )
    return text, price


@app.post("/lookup", response_model=LookupResponse)
def lookup(req: CaptureRequest) -> LookupResponse:
    winapi_cursor = _get_cursor_pos_winapi()
    print(
        f"[lookup] x={req.x} y={req.y} w={req.width} h={req.height} "
        f"lang={req.lang} game_mode={req.game_mode} mirror_x={req.mirror_x} "
        f"front_cursor=({req.cursor_x},{req.cursor_y}) "
        f"winapi_cursor={winapi_cursor}"
    )
    lang = req.lang if req.lang in ("ko", "en") else "ko"
    game_mode = req.game_mode if req.game_mode in ("regular", "pve") else "regular"

    # Direct-name lookup path: skip capture+OCR, use the supplied text.
    # Triggered by 최근 검색 재조회 / 직접 입력 correction submit.
    if req.override_text:
        print(f"[lookup] override_text path - name={req.override_text!r}")
        price = get_item_price(
            req.override_text,
            lang=lang,
            game_mode=game_mode,
            corrections=req.corrections,
        )
        return LookupResponse(
            raw_text=req.override_text,
            item_name=price.get("name"),
            short_name=price.get("short_name"),
            width=price.get("width"),
            height=price.get("height"),
            flea_price=price.get("flea"),
            flea_low_24h=price.get("flea_low_24h"),
            flea_change_48h_pct=price.get("flea_change_48h_pct"),
            trader_price=price.get("trader"),
            sell_for=[
                TraderPrice(name=e["name"], price=e["price"])
                for e in price.get("sell_for", [])
            ],
            barters_for=[
                Barter(
                    trader=b["trader"],
                    level=b.get("level", 1),
                    items=[
                        BarterRequiredItem(
                            name=it["name"],
                            short_name=it.get("short_name"),
                            count=it.get("count", 1),
                        )
                        for it in b.get("items", [])
                    ],
                )
                for b in price.get("barters_for", [])
            ],
            used_in_tasks=[
                TaskRef(
                    id=t.get("id"),
                    name=t["name"],
                    trader=t.get("trader", ""),
                    min_level=t.get("min_level", 0),
                )
                for t in price.get("used_in_tasks", [])
            ],
            crafts_for=[
                HideoutCraft(
                    station=c["station"],
                    level=c.get("level", 1),
                    duration_sec=c.get("duration_sec", 0),
                    items=[
                        BarterRequiredItem(
                            name=it["name"],
                            short_name=it.get("short_name"),
                            count=it.get("count", 1),
                        )
                        for it in c.get("items", [])
                    ],
                )
                for c in price.get("crafts_for", [])
            ],
            barters_using=[
                BarterUsing(
                    trader=u["trader"],
                    level=u.get("level", 1),
                    rewards=[
                        BarterRequiredItem(
                            name=it["name"],
                            short_name=it.get("short_name"),
                            count=it.get("count", 1),
                        )
                        for it in u.get("rewards", [])
                    ],
                )
                for u in price.get("barters_using", [])
            ],
            buy_for=[
                BuyOffer(
                    name=b["name"],
                    price=b["price"],
                    min_level=b.get("min_level", 1),
                )
                for b in price.get("buy_for", [])
            ],
            icon=price.get("icon"),
            matched_from=price.get("matched_from"),
        )

    # Prefer the WinAPI-measured cursor (Python is per-monitor DPI aware,
    # so it shares a coordinate space with mss). Fall back to the value the
    # frontend sent if WinAPI fails for any reason.
    cursor_x = winapi_cursor[0] if winapi_cursor else req.cursor_x
    cursor_y = winapi_cursor[1] if winapi_cursor else req.cursor_y

    # Re-derive primary/mirror capture origins from the trusted cursor position
    # plus the offsets the frontend chose, so they match the same coord system
    # as mss.monitors. (Otherwise DPI mismatch can place us on the wrong screen.)
    if winapi_cursor and req.cursor_x is not None and req.cursor_y is not None:
        offset_x = req.x - req.cursor_x
        offset_y = req.y - req.cursor_y
        primary_x = winapi_cursor[0] + offset_x
        primary_y = winapi_cursor[1] + offset_y
        mirror_x_val = (
            winapi_cursor[0] - offset_x - req.width
            if req.mirror_x is not None
            else None
        )
    else:
        primary_x, primary_y = req.x, req.y
        mirror_x_val = req.mirror_x

    can_clamp = cursor_x is not None and cursor_y is not None
    px, py, pw, ph = primary_x, primary_y, req.width, req.height
    if can_clamp:
        px, py, pw, ph = _clamp_to_monitor(px, py, pw, ph, cursor_x, cursor_y)

    text, price = _capture_and_lookup(
        px, py, pw, ph, lang, game_mode, "primary", req.corrections
    )

    if price.get("name") is None and mirror_x_val is not None:
        mx, my, mw_, mh_ = mirror_x_val, primary_y, req.width, req.height
        if can_clamp:
            mx, my, mw_, mh_ = _clamp_to_monitor(
                mx, my, mw_, mh_, cursor_x, cursor_y
            )
        text2, price2 = _capture_and_lookup(
            mx, my, mw_, mh_, lang, game_mode, "mirror", req.corrections
        )
        if price2.get("name") is not None:
            text, price = text2, price2

    return LookupResponse(
        raw_text=text,
        item_name=price.get("name"),
        short_name=price.get("short_name"),
        width=price.get("width"),
        height=price.get("height"),
        flea_price=price.get("flea"),
        flea_low_24h=price.get("flea_low_24h"),
        flea_change_48h_pct=price.get("flea_change_48h_pct"),
        trader_price=price.get("trader"),
        sell_for=[
            TraderPrice(name=e["name"], price=e["price"])
            for e in price.get("sell_for", [])
        ],
        matched_from=price.get("matched_from"),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
