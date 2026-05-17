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
from pydantic import BaseModel, Field

from capture import capture_region
from ocr import _get_reader, recognize_text
from quest_tracker import get_tracker
from tarkov_api import get_item_price, get_station_list, start_background_refresher


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print("[startup] warming up OCR reader (ko+en)…")
    _get_reader(("ko", "en"))  # loads models once so first /lookup is fast
    print("[startup] starting price-cache background refresher…")
    start_background_refresher()
    print("[startup] starting quest log watcher…")
    get_tracker().start()
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
    # Ground-item capture region (small box under the crosshair shown when
    # hovering an item on the floor during a raid). Tried before primary so
    # raid pickups work without a separate hotkey. All four must be set to
    # enable; absolute coords like primary x/y.
    ground_x: int | None = None
    ground_y: int | None = None
    ground_width: int | None = None
    ground_height: int | None = None
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
    count: int | None = None  # how many of THIS item this task needs
    fir: bool = False  # whether the item must be Found in Raid
    # Whether this task is on the Kappa progression. Drives the loot-tier
    # badge — Kappa items get pushed up to at least A even when ₽/slot is low.
    kappa_required: bool = False
    # Quest progress for this player, derived from EFT log files when
    # the quest tracker is enabled. None means "we don't know" (no log
    # data, tracker disabled, or quest never seen).
    # `task_status` is the value for the lookup's game_mode (back-compat
    # for older overlay builds). `task_status_by_mode` has both servers so
    # the new frontend can switch the display without re-capturing.
    task_status: str | None = None  # "started" | "completed" | "failed" | None
    task_status_by_mode: dict[str, str | None] = Field(default_factory=dict)


class HideoutCraft(BaseModel):
    station: str
    level: int = 1
    duration_sec: int = 0
    items: list[BarterRequiredItem] = []


class HideoutNeed(BaseModel):
    station: str
    station_id: str = ""
    level: int = 1
    count: int = 1  # how many of this item the upgrade requires


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
    weight: float | None = None  # kg
    icon: str | None = None  # gridImageLink (webp URL)
    flea_price: int | None
    flea_low_24h: int | None = None
    flea_high_24h: int | None = None
    flea_last_low: int | None = None
    flea_last_offer_count: int | None = None
    flea_change_48h_pct: float | None = None
    trader_price: int | None
    sell_for: list[TraderPrice] = []  # all traders, sorted high to low (RUB)
    barters_for: list[Barter] = []  # ways to obtain this item via trader barter
    barters_using: list[BarterUsing] = []  # barters where this item is required
    buy_for: list[BuyOffer] = []  # trader cash offers (Flea excluded)
    used_in_tasks: list[TaskRef] = []  # quests that need this item
    crafts_for: list[HideoutCraft] = []  # hideout recipes producing this item
    needed_for_hideout: list[HideoutNeed] = []  # hideout upgrades that need this item
    # Caliber for ammo / weapons. Raw is the tarkov.dev id ("Caliber545x39");
    # display is the human-friendly form ("5.45x39"). Both None for non-
    # weapon, non-ammo items, which suppresses the ammo-matrix panel.
    caliber: str | None = None
    caliber_display: str | None = None
    matched_from: str | None = None


def _build_response(raw_text: str, price: dict, game_mode: str = "regular") -> LookupResponse:
    """Single source of truth that maps a get_item_price() dict into the
    Pydantic response. Both the F2-capture and override_text paths use it,
    so adding a field touches exactly one place going forward.

    `game_mode` is forwarded to the quest tracker so task_status reflects
    the user's current server (PVP/regular vs PVE) — quest progress is
    independent between the two."""
    return LookupResponse(
        raw_text=raw_text,
        item_name=price.get("name"),
        short_name=price.get("short_name"),
        width=price.get("width"),
        height=price.get("height"),
        weight=price.get("weight"),
        icon=price.get("icon"),
        flea_price=price.get("flea"),
        flea_low_24h=price.get("flea_low_24h"),
        flea_high_24h=price.get("flea_high_24h"),
        flea_last_low=price.get("flea_last_low"),
        flea_last_offer_count=price.get("flea_last_offer_count"),
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
        used_in_tasks=[
            TaskRef(
                id=t.get("id"),
                name=t["name"],
                trader=t.get("trader", ""),
                min_level=t.get("min_level", 0),
                count=t.get("count"),
                fir=t.get("fir", False),
                kappa_required=t.get("kappa_required", False),
                task_status=get_tracker().quest_status_for(t.get("id") or "", game_mode),
                task_status_by_mode={
                    "pvp": get_tracker().quest_status_for(t.get("id") or "", "regular"),
                    "pve": get_tracker().quest_status_for(t.get("id") or "", "pve"),
                },
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
        needed_for_hideout=[
            HideoutNeed(
                station=n["station"],
                level=n.get("level", 1),
                count=n.get("count", 1),
            )
            for n in price.get("needed_for_hideout", [])
        ],
        caliber=price.get("caliber"),
        caliber_display=price.get("caliber_display"),
        matched_from=price.get("matched_from"),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ammo")
def ammo(lang: str = "en") -> dict:
    """All ammo grouped by caliber, with the matrix-panel stats. Frontend
    fetches once on mount and filters client-side — payload is ~30KB."""
    from tarkov_api import get_ammo
    return get_ammo(lang)


@app.get("/diagnostics")
def diagnostics() -> dict:
    """One-shot environment probe for the React side. Today this only
    answers "are we admin?" so the UI can warn users that F2 won't reach
    Tarkov when EFT runs as administrator (BattlEye) and we don't.

    Add new keys here (don't break existing ones) as we surface more
    self-diagnosis hints — UAC settings, Borderless vs Exclusive Fullscreen
    detection, antivirus quarantine, etc.
    """
    is_admin: bool | None = None
    if sys.platform == "win32":
        try:
            import ctypes

            # IsUserAnAdmin returns 0 / nonzero. Wrap in try because some
            # locked-down environments raise rather than return 0.
            is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception as e:
            print(f"[diagnostics] elevation probe failed: {e!r}")
            is_admin = None
    return {"is_admin": is_admin, "platform": sys.platform}


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
        return _build_response(req.override_text, price, game_mode)

    # Prefer the WinAPI-measured cursor (Python is per-monitor DPI aware,
    # so it shares a coordinate space with mss). Fall back to the value the
    # frontend sent if WinAPI fails for any reason.
    cursor_x = winapi_cursor[0] if winapi_cursor else req.cursor_x
    cursor_y = winapi_cursor[1] if winapi_cursor else req.cursor_y

    # Re-derive primary/mirror/ground capture origins from the trusted cursor
    # position plus the offsets the frontend chose, so they match the same coord
    # system as mss.monitors. (Otherwise DPI mismatch can place us on the wrong
    # screen.)
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
        if req.ground_x is not None and req.ground_y is not None:
            g_offset_x = req.ground_x - req.cursor_x
            g_offset_y = req.ground_y - req.cursor_y
            ground_x_val = winapi_cursor[0] + g_offset_x
            ground_y_val = winapi_cursor[1] + g_offset_y
        else:
            ground_x_val = ground_y_val = None
    else:
        primary_x, primary_y = req.x, req.y
        mirror_x_val = req.mirror_x
        ground_x_val = req.ground_x
        ground_y_val = req.ground_y

    can_clamp = cursor_x is not None and cursor_y is not None

    # Build the ordered list of capture attempts. Primary (inventory hover,
    # right of cursor) → mirror (left of cursor, opposite-side UI) → ground
    # (small box under crosshair for raid floor items). Inventory hover is
    # the most common case so it's first; ground is the rarer fallback.
    # First attempt that returns a matched item wins.
    attempts: list[tuple[str, int, int, int, int]] = []

    px, py, pw, ph = primary_x, primary_y, req.width, req.height
    if can_clamp:
        px, py, pw, ph = _clamp_to_monitor(px, py, pw, ph, cursor_x, cursor_y)
    attempts.append(("primary", px, py, pw, ph))

    if mirror_x_val is not None:
        mx, my, mw_, mh_ = mirror_x_val, primary_y, req.width, req.height
        if can_clamp:
            mx, my, mw_, mh_ = _clamp_to_monitor(mx, my, mw_, mh_, cursor_x, cursor_y)
        attempts.append(("mirror", mx, my, mw_, mh_))

    if (
        ground_x_val is not None
        and ground_y_val is not None
        and req.ground_width
        and req.ground_height
    ):
        gx, gy, gw, gh = ground_x_val, ground_y_val, req.ground_width, req.ground_height
        if can_clamp:
            gx, gy, gw, gh = _clamp_to_monitor(gx, gy, gw, gh, cursor_x, cursor_y)
        attempts.append(("ground", gx, gy, gw, gh))

    text, price = "", {"name": None}
    for label, ax, ay, aw, ah in attempts:
        text, price = _capture_and_lookup(
            ax, ay, aw, ah, lang, game_mode, label, req.corrections
        )
        if price.get("name") is not None:
            break

    return _build_response(text, price, game_mode)


# ─── Quest tracker endpoints ─────────────────────────────────────────
# All localhost-only (FastAPI binds to 127.0.0.1), no auth needed.

class QuestPathRequest(BaseModel):
    path: str = ""  # empty string clears the override → back to auto-detect


class QuestEnabledRequest(BaseModel):
    enabled: bool


class QuestResetRequest(BaseModel):
    # None  -> wipe both modes (post-wipe / pre-1.0.10 migration cleanup)
    # "pvp" -> wipe only PVP state, keep PVE intact
    # "pve" -> wipe only PVE state, keep PVP intact
    # Practical use: users who only played one mode before the per-mode
    # tracker landed; legacy state was copied into BOTH modes during migration
    # and the unused mode needs to be cleared to remove fake progress.
    game_mode: str | None = None


@app.get("/hideout/stations")
def hideout_stations(lang: str = "en") -> list:
    """Return [{id, name, maxLevel}] for all hideout stations.
    Used by the frontend settings panel so users can set their current
    upgrade level per station (to dim already-completed rows on the card)."""
    return get_station_list(lang)


@app.get("/quests/status")
def quests_status() -> dict:
    """Current state of the quest log watcher: install path validity,
    how many quests we've seen, etc. The frontend polls this so it can
    surface "X quests synced" or warn that the install path is wrong."""
    return get_tracker().get_status()


@app.post("/quests/path")
def quests_set_path(req: QuestPathRequest) -> dict:
    """Override the auto-detected EFT install path. Pass an empty string
    to revert to auto-detection."""
    return get_tracker().set_install_path(req.path)


@app.post("/quests/enabled")
def quests_set_enabled(req: QuestEnabledRequest) -> dict:
    """Toggle the watcher on/off. When off, /lookup responses leave
    `task_status` as null and no log files are read."""
    get_tracker().set_enabled(req.enabled)
    return get_tracker().get_status()


@app.post("/quests/reset")
def quests_reset(req: QuestResetRequest | None = None) -> dict:
    """Wipe known quest state and re-scan from scratch. Pass `game_mode`
    to wipe only one server's state — used after migration when a
    single-mode player has fake progress copied into the unused mode."""
    mode = req.game_mode if req is not None else None
    get_tracker().reset(mode)
    return get_tracker().get_status()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
