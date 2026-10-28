import sys

# Frozen exe on Korean Windows inherits a cp949 stdout/stderr. Any print()
# whose text contains a non-cp949 character (em-dash in a log literal, some
# item names) then raises UnicodeEncodeError *inside the request handler* and
# 500s the lookup — a real production bug we hit. Force utf-8 with
# replacement so logging can never crash a request again.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass  # very old runtimes / detached streams: keep going

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

import json
import os
import re
import threading
from contextlib import asynccontextmanager

import mss
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from capture import capture_region
from ocr import (
    _get_reader,
    is_price_or_status_line,
    recognize_text_fragments,
    unwrap_nospace_item,
)
from quest_tracker import _normalize_request_mode, get_tracker
import gunsmith
from tarkov_api import catalog_age as _catalog_age
from radar import get_service as get_radar
from tarkov_api import (
    get_item_price,
    get_station_list,
    has_price_cache,
    start_background_refresher,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print("[startup] warming up OCR reader (ko+en)...")
    _get_reader(("ko", "en"))  # loads models once so first /lookup is fast
    print("[startup] starting price-cache background refresher...")
    start_background_refresher()
    print("[startup] starting quest log watcher...")
    get_tracker().start()
    gunsmith.start_background_refresh()  # 건스미스 부품 표(가이드 사이트 JSON) — 실패해도 조회엔 영향 없음
    print("[startup] warmup complete")
    yield


app = FastAPI(title="Tarkov Price Overlay Core", lifespan=lifespan)

# Only the app's own webview may read responses. The sidecar binds to
# 127.0.0.1, but *any* web page the user has open in a browser can still POST
# to http://127.0.0.1:8765 — with the old allow_origins=["*"], such a page
# could fire /lookup at arbitrary coordinates and READ BACK the OCR'd contents
# of the user's screen (ACAO:* makes the response cross-origin-readable).
# Restricting to the Tauri webview origin makes /lookup (a JSON POST, always
# preflighted) un-sendable from a foreign origin. Windows Tauri 2 serves the
# app from http://tauri.localhost; `npm run dev` serves from localhost:1420.
_ALLOWED_ORIGIN_RE = r"^(https?://(tauri\.localhost|localhost)(:\d+)?|tauri://localhost)$"
_allowed_origin = re.compile(_ALLOWED_ORIGIN_RE)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_ALLOWED_ORIGIN_RE,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 가이드 사이트 연동(/progress 한 경로만) ─────────────────────────────────────
# tarkov.aquapado.com 가이드가 같은 PC의 오버레이에서 퀘스트 진행도를 읽어 "깬 퀘스트·필요 없어진 아이템"을
# 자동으로 걸러 준다. 전역 CORS를 넓히면 /lookup(화면 OCR 결과)까지 사이트가 읽을 수 있게 되므로, 아래 미들웨어가
# /progress 경로의 GET·OPTIONS 에만 사이트 출처 헤더를 붙인다(브라우저 로컬 네트워크 접근 프리플라이트 포함).
# 사용자 데이터는 받는 쪽(사이트 JS)이 브라우저 안에서만 쓰고 어디에도 보내지 않는다.
_SITE_ORIGIN_RE = re.compile(r"^(https://tarkov\.aquapado\.com|http://127\.0\.0\.1:8099)$")


class _ProgressCORS:
    """CORSMiddleware 바깥에서 /progress 의 프리플라이트를 가로채고 응답에 출처 헤더를 더한다."""

    def __init__(self, app):  # noqa: D107
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") != "/progress":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers") or []}
        origin = headers.get("origin", "")
        allowed = bool(_SITE_ORIGIN_RE.match(origin))
        cors = [
            (b"access-control-allow-origin", origin.encode()),
            (b"access-control-allow-methods", b"GET, OPTIONS"),
            (b"access-control-allow-headers", b"*"),
            (b"access-control-allow-private-network", b"true"),
            (b"access-control-max-age", b"600"),
            (b"vary", b"Origin"),
        ]
        if scope.get("method") == "OPTIONS":
            status = 204 if allowed or not origin else 403
            await send({"type": "http.response.start", "status": status, "headers": cors if allowed else []})
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message):
            if message["type"] == "http.response.start" and allowed:
                message = {**message, "headers": list(message.get("headers") or []) + cors}
            await send(message)

        return await self.app(scope, receive, send_with_cors)


app.add_middleware(_ProgressCORS)


def _reject_foreign_origin(request: Request) -> None:
    """CSRF guard for state-changing endpoints. CORS stops a foreign page from
    *reading* a response, but a *simple* POST (no custom headers, text/plain
    body) is sent without a preflight — so a malicious page the user has open
    could still wipe quest progress or repoint the EFT install path via
    /quests/*. Browsers always attach an Origin header to a cross-origin POST,
    so a present-but-foreign Origin is the CSRF tell. A missing Origin means a
    non-browser caller (our own E2E / curl) — allowed."""
    origin = request.headers.get("origin")
    if origin and not _allowed_origin.match(origin):
        raise HTTPException(status_code=403, detail="forbidden_origin")


class CaptureRequest(BaseModel):
    x: int
    y: int
    width: int
    height: int
    lang: str = "ko"  # "ko" | "en" | "ru"
    game_mode: str = "regular"  # "regular" (PVP) | "pve" | "pvp-season" (시즌 래더)
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
    # Monotonic per-press counter from the client (lookupSeqRef). The server
    # uses THIS — not a ticket it assigns after the variable cursor-query +
    # clamp work — to decide rapid-F2 supersession, so the decision reflects
    # true press order regardless of which worker thread runs first. None for
    # callers that don't send it (supersession is then disabled for them).
    client_seq: int | None = None


class TraderPrice(BaseModel):
    name: str
    price: int


class BarterRequiredItem(BaseModel):
    name: str
    short_name: str | None = None
    count: float = 1
    # 레프 GP코인처럼 판매가 환산 소수를 올림한 개수면 True (카드에 "×~N")
    approx: bool | None = None


class TaskUnlockRef(BaseModel):
    """Quest gate on a barter (tarkov.dev taskUnlock). `status` mirrors
    TaskRef.task_status semantics for the lookup's game_mode; status_by_mode
    carries both servers so the frontend can re-project on mode switch
    without a re-capture."""

    id: str
    name: str
    status: str | None = None  # "started" | "completed" | "failed" | None
    status_by_mode: dict[str, str | None] = Field(default_factory=dict)


class Barter(BaseModel):
    trader: str
    level: int = 1
    task_unlock: TaskUnlockRef | None = None
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
    station_id: str = ""  # hideout station id — matches get_station_list ids
    level: int = 1
    duration_sec: int = 0
    items: list[BarterRequiredItem] = []


class HideoutCraftUsing(BaseModel):
    """이 아이템을 재료로 쓰는 은신처 제작(피드백 #46 B)."""
    station: str
    station_id: str = ""
    level: int = 1
    duration_sec: int = 0
    # 이 제작에 조회한 아이템이 몇 개 필요한지. 제작 소수(물 필터 0.66 = 내구도
    # 소모)는 실제 값이라 float 그대로.
    need_count: float | None = None
    rewards: list[BarterRequiredItem] = []


class GunsmithRef(BaseModel):
    """조회한 아이템이 건스미스 퀘스트에 쓰임 — kind=req(반드시 포함) | ex(위키 예시 조립). 데이터: gunsmith.py"""
    quest: str
    kind: str = "req"
    weapon: str | None = None


class HideoutNeed(BaseModel):
    station: str
    station_id: str = ""
    level: int = 1
    count: int = 1  # how many of this item the upgrade requires
    fir: bool = False  # whether this upgrade requires the item Found-in-Raid


class BarterUsing(BaseModel):
    trader: str
    level: int = 1
    task_unlock: TaskUnlockRef | None = None
    rewards: list[BarterRequiredItem] = []
    # 이 교환에 조회한 아이템이 몇 개 필요한지(피드백 #46). 이 칸이 모델에 없어서
    # tarkov_api가 계산한 값이 응답에서 조용히 버려졌었다(2026-10-25 실행본 시험으로 발견).
    need_count: int | None = None
    need_approx: bool | None = None


class BuyOffer(BaseModel):
    name: str  # trader name
    price: int  # RUB
    min_level: int = 1


class LookupResponse(BaseModel):
    raw_text: str
    item_id: str | None = None  # tarkov.dev catalog id (public); used for telemetry
    item_name: str | None
    short_name: str | None = None
    width: int | None = None  # inventory grid units (1, 2, ...)
    height: int | None = None
    weight: float | None = None  # kg
    icon: str | None = None  # gridImageLink (webp URL)
    wiki: str | None = None  # Fandom wiki page (card link button)
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
    crafts_using: list[HideoutCraftUsing] = []  # hideout recipes consuming this item
    needed_for_hideout: list[HideoutNeed] = []  # hideout upgrades that need this item
    gunsmith: list[GunsmithRef] = []  # 건스미스 퀘스트에 쓰이는 부품이면(필수/위키 예시) — 가이드 사이트 JSON 기준
    # 이 응답의 시세가 몇 초 전 카탈로그인지와 출처(json/graphql/disk). 디스크 복원·오래된 캐시면 카드가 "N시간 전 시세" 를 단다.
    price_age_sec: int | None = None
    price_source: str | None = None
    # Caliber for ammo / weapons. Raw is the tarkov.dev id ("Caliber545x39");
    # display is the human-friendly form ("5.45x39"). Both None for non-
    # weapon, non-ammo items, which suppresses the ammo-matrix panel.
    caliber: str | None = None
    caliber_display: str | None = None
    # When the looked-up item is an ammo PACK, these identify the round
    # inside it so the matrix can highlight that row (id match first, name
    # as fallback). Both None for non-pack lookups.
    ammo_pack_round_id: str | None = None
    ammo_pack_round_name: str | None = None
    matched_from: str | None = None
    # Which capture attempt produced this response: "primary" / "mirror" /
    # "ground" / "wide" (zoom-out rescue), or None for override_text lookups.
    # The frontend prefixes its nomatch telemetry with "wide_" so the
    # dashboard can separate rescue-path reads from normal ones.
    attempt: str | None = None


def _build_response(
    raw_text: str,
    price: dict,
    game_mode: str = "regular",
    attempt: str | None = None,
    lang: str = "ko",
) -> LookupResponse:
    """Single source of truth that maps a get_item_price() dict into the
    Pydantic response. Both the F2-capture and override_text paths use it,
    so adding a field touches exactly one place going forward.

    `game_mode` is forwarded to the quest tracker so task_status reflects
    the user's current server (PVP/regular vs PVE) — quest progress is
    independent between the two."""
    # Snapshot the per-mode quest status dicts once per response. The naive
    # version called `quest_status_for(qid, mode)` three times per task
    # (current mode + pvp + pve), each acquiring the tracker lock — for an
    # item used in 30 tasks (e.g. wires), that's 90 lock acquisitions per
    # lookup. Two `all_status()` calls give us flat dicts we can index
    # without locking. When the tracker is disabled we skip the snapshot
    # entirely and serve empty dicts so the per-task .get() returns None
    # — preserves the legacy behavior where disable hides all sync data.
    tracker = get_tracker()
    if tracker.is_enabled():
        pvp_status = tracker.all_status("regular")
        pve_status = tracker.all_status("pve")
        # 시즌 래더 진행도 — quest_tracker가 "Session mode: PvpSeason" 세션을
        # season 버킷으로 따로 동기화한다. 카탈로그 모드명("pvp-season")과
        # 트래커 모드명("season")은 이름 체계가 다르며 변환은
        # _normalize_request_mode 한 곳이 흡수한다.
        season_status = tracker.all_status("season")
    else:
        pvp_status = {}
        pve_status = {}
        season_status = {}
    if game_mode == "pve":
        current_status = pve_status
    elif game_mode == "pvp-season":
        current_status = season_status
    else:
        current_status = pvp_status

    def _unlock_ref(b: dict) -> TaskUnlockRef | None:
        """Barter's quest gate + the player's progress on it. The quest id
        comes straight from tarkov.dev (no normalization) so it indexes the
        same status dicts used_in_tasks already uses."""
        tu = b.get("task_unlock")
        if not tu or not tu.get("id"):
            return None
        qid = tu["id"]
        return TaskUnlockRef(
            id=qid,
            name=tu.get("name") or "",
            status=current_status.get(qid),
            status_by_mode={
                "pvp": pvp_status.get(qid),
                "pve": pve_status.get(qid),
                "season": season_status.get(qid),
            },
        )

    return LookupResponse(
        raw_text=raw_text,
        item_id=price.get("id"),
        item_name=price.get("name"),
        short_name=price.get("short_name"),
        width=price.get("width"),
        height=price.get("height"),
        weight=price.get("weight"),
        icon=price.get("icon"),
        wiki=price.get("wiki"),
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
                task_unlock=_unlock_ref(b),
                items=[
                    BarterRequiredItem(
                        name=it["name"],
                        short_name=it.get("short_name"),
                        count=it.get("count", 1),
                        approx=it.get("approx"),
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
                task_unlock=_unlock_ref(u),
                need_count=u.get("need_count"),
                need_approx=u.get("need_approx"),
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
                task_status=current_status.get(t.get("id") or ""),
                task_status_by_mode={
                    "pvp": pvp_status.get(t.get("id") or ""),
                    "pve": pve_status.get(t.get("id") or ""),
                    "season": season_status.get(t.get("id") or ""),
                },
            )
            for t in price.get("used_in_tasks", [])
        ],
        crafts_for=[
            HideoutCraft(
                station=c["station"],
                station_id=c.get("station_id", ""),
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
        crafts_using=[
            HideoutCraftUsing(
                station=c["station"],
                station_id=c.get("station_id", ""),
                level=c.get("level", 1),
                duration_sec=c.get("duration_sec", 0),
                need_count=c.get("need_count"),
                rewards=[
                    BarterRequiredItem(
                        name=it["name"],
                        short_name=it.get("short_name"),
                        count=it.get("count", 1),
                    )
                    for it in c.get("rewards", [])
                ],
            )
            for c in price.get("crafts_using", [])
        ],
        needed_for_hideout=[
            HideoutNeed(
                station=n["station"],
                station_id=n.get("station_id", ""),
                level=n.get("level", 1),
                count=n.get("count", 1),
                fir=n.get("fir", False),
            )
            for n in price.get("needed_for_hideout", [])
        ],
        gunsmith=[GunsmithRef(**g) for g in gunsmith.for_item(price.get("id"), lang)],
        price_age_sec=_catalog_age(lang, game_mode)[0],
        price_source=_catalog_age(lang, game_mode)[1],
        caliber=price.get("caliber"),
        caliber_display=price.get("caliber_display"),
        ammo_pack_round_id=price.get("ammo_pack_round_id"),
        ammo_pack_round_name=price.get("ammo_pack_round_name"),
        matched_from=price.get("matched_from"),
        attempt=attempt,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/catalog/status")
def catalog_status_ep() -> dict:
    """시세 카탈로그 상태 — (언어/모드)별 항목 수·나이·출처(json/graphql/disk), 소스 순서, 스냅샷 폴더. 진단용."""
    from tarkov_api import catalog_status

    return catalog_status()


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


def _monitor_center_box(
    cursor_x: int, cursor_y: int, width: int, height: int
) -> tuple[int, int, int, int] | None:
    """A (width x height) box centered on the monitor that holds the cursor.

    For centered, cursor-independent UI notifications — specifically the
    inventory-full "공간 부족 (아이템)" / "No space (Item)" label EFT shows dead
    center when your bag is full and you look at a ground/container item. That
    text sits AT the crosshair (screen center), which falls in the gap between
    the primary capture box (above the cursor) and the ground box (below it),
    so no cursor-relative attempt ever catches it. Returns None if the cursor
    isn't on any known monitor."""
    with mss.mss() as sct:
        for m in sct.monitors[1:]:
            mx, my, mw, mh = m["left"], m["top"], m["width"], m["height"]
            if mx <= cursor_x < mx + mw and my <= cursor_y < my + mh:
                w = min(width, mw)
                h = min(height, mh)
                x = mx + mw // 2 - w // 2
                y = my + mh // 2 - h // 2
                return x, y, w, h
    return None


def _capture_and_lookup(
    x: int,
    y: int,
    width: int,
    height: int,
    lang: str,
    game_mode: str,
    label: str,
    corrections: dict[str, str],
    rescue_pool: list[str] | None = None,
) -> tuple[str, dict]:
    import time

    t0 = time.perf_counter()
    image = capture_region(x, y, width, height)
    t1 = time.perf_counter()
    # Ground labels sit on the game world, not a dark tooltip panel, so the
    # tooltip-background filter would wrongly drop them — skip it for ground.
    # OCR language set follows the game-client language. The Russian client
    # shows Cyrillic item names; EasyOCR can't mix Korean + Cyrillic in one
    # reader, so use ("ru","en") for the RU client and ("ko","en") otherwise
    # (English client names are Latin and read fine with the ko+en reader).
    ocr_langs = ("ru", "en") if lang == "ru" else ("ko", "en")
    fragments = recognize_text_fragments(
        image, langs=ocr_langs, skip_bg_filter=(label == "ground")
    )
    # Trade-menu noise: drop price labels ("98,000₽", "#####₽") and trader
    # status lines before joining, so they neither sink the fuzzy match nor
    # become retry candidates below. Applied on every path (not just trade)
    # — the patterns only fire on price/status shapes, so there's nothing
    # to false-positive on elsewhere. If EVERYTHING looks like price noise,
    # keep the original fragments: a failed lookup with honest raw_text
    # beats returning an empty capture.
    price_noise = [f for f in fragments if is_price_or_status_line(f)]
    if price_noise and len(price_noise) < len(fragments):
        print(f"[lookup] OCR({label}) dropped price/status fragments: {price_noise!r}")
        fragments = [f for f in fragments if not is_price_or_status_line(f)]
    t2 = time.perf_counter()
    text = " ".join(fragments).strip()
    print(f"[lookup] OCR({label}): {text!r} ({len(fragments)} fragments)")

    # Everything read here is a candidate for the end-of-request cold rescue
    # (single deferred network try for brand-new patch items — see
    # _cold_rescue). Collected BEFORE matching so no-match strings are kept.
    if rescue_pool is not None:
        if text:
            rescue_pool.append(text)
        rescue_pool.extend(f for f in fragments if f)

    # Primary attempt: fuzzy-match the joined OCR text. This works whenever
    # the capture box is tight around the tooltip — EasyOCR returns a few
    # lines, joining them produces a string very close to the catalog name.
    # allow_cold=False: cache-only — the many probes in this flow must not
    # each pay a GraphQL round trip (that multiplied into ~7s lookups).
    price = get_item_price(
        text, lang=lang, game_mode=game_mode, corrections=corrections,
        allow_cold=False,
    )

    # Inventory-full pickup tooltip: "공간 부족 (프로피탈)" / "No space (X)" /
    # "Нет места (X)" shows centered when the bag is full and you look at a
    # ground/container item. The name is wrapped in parens after a status
    # prefix, so the raw OCR fuzzy-fails. Recover the parenthesized name and
    # match that. Checked BEFORE the multi-fragment retry below because the
    # whole tooltip is usually one OCR fragment (that retry needs len>1), and
    # only adopted when the inner text resolves — so it can't hurt normal names.
    if price.get("name") is None:
        for src in (text, *fragments):
            inner = unwrap_nospace_item(src)
            if not inner:
                continue
            if rescue_pool is not None:
                rescue_pool.append(inner)
            inner_price = get_item_price(
                inner, lang=lang, game_mode=game_mode, corrections=corrections,
                allow_cold=False,
            )
            if inner_price.get("name"):
                print(
                    f"[lookup] OCR({label}) unwrapped inventory-full tooltip "
                    f"{src!r} -> {inner!r} -> {inner_price['name']!r}"
                )
                text, price = inner, inner_price
                break

    # Fallback: when the box catches extra non-tooltip UI (price label below
    # the tooltip, description text, an inventory icon with baked-in text
    # like "RatCola" next to the hovered item), the joined string drops
    # below the fuzzy cutoff and returns no name. Try each fragment
    # individually AND score-rank the candidates instead of returning the
    # first one that matches — otherwise a short noise fragment that
    # happens to be a real catalog item (e.g. "Cola") can win over the
    # actual long tooltip fragment.
    #
    # Scoring: PRIMARY by source fragment length (more OCR characters
    # = more confidence the fragment really represents an item name),
    # secondary by matched item name length (prefer specific matches).
    #
    # Earlier attempt used (item_name_len, frag_len) — that backfired on
    # ammo-trader columns where the OCR catches short labels like "M88z"
    # (4 chars) alongside the actual tooltip "9x19mm AP 6.3" (13 chars).
    # The short label fuzzy-mapped to "9x19mm FMJ M882 ammo pack (30 pcs)"
    # (34-char catalog name) via the shortName alias chain, winning the
    # score even though it was the noise column header, not the real
    # hovered item. Switching the primary to fragment length means the
    # longest source string wins — which is almost always the actual
    # tooltip text in EFT's layout.
    if price.get("name") is None and len(fragments) > 1:
        # Original detection order = EasyOCR top-to-bottom, left-to-right,
        # which mirrors EFT's layout (the hovered item's own name line comes
        # first). Used as the tiebreak below. First occurrence wins on dupes.
        order: dict[str, int] = {}
        for i, f in enumerate(fragments):
            order.setdefault(f, i)
        retry_candidates: list[str] = []
        seen = {text}
        for f in sorted(fragments, key=len, reverse=True):
            if f in seen or len(f) < 2:
                continue
            seen.add(f)
            retry_candidates.append(f)
            if len(retry_candidates) >= 6:
                break
        # Resolve each candidate to (fragment, price, source_len, order_idx,
        # matched_name_len).
        matches: list[tuple[str, dict, int, int, int]] = []
        for cand in retry_candidates:
            cand_price = get_item_price(
                cand, lang=lang, game_mode=game_mode, corrections=corrections,
                allow_cold=False,
            )
            cand_name = cand_price.get("name")
            if not cand_name:
                continue
            matches.append(
                (cand, cand_price, len(cand), order.get(cand, 10_000), len(cand_name))
            )
        best_cand: tuple[str, dict] | None = None
        if matches:
            # The longest source fragment is usually the real tooltip name —
            # this is what fixed the ammo-trader "M88z" short-noise case (a
            # 4-char column header losing to the 13-char tooltip). BUT when the
            # box catches a ROW OF INVENTORY ICONS, several fragments are
            # near-equal-length real short-names (CPU fan / Prokill / SAS /
            # Chainlet) and pure length picks a NEIGHBOR over the hovered item
            # (the 1.1.4 regression). So restrict to candidates within 2 chars
            # of the longest, then prefer the one that appeared FIRST in
            # detection order (top-left ≈ the item under the cursor), breaking
            # any remaining tie by the more specific (longer) catalog name.
            max_len = max(m[2] for m in matches)
            near = [m for m in matches if m[2] >= max_len - 2]
            winner = min(near, key=lambda m: (m[3], -m[4]))
            best_cand = (winner[0], winner[1])
        if best_cand is not None:
            cand, cand_price = best_cand
            print(
                f"[lookup] OCR({label}) matched via fragment "
                f"{cand!r} -> {cand_price['name']!r}"
            )
            # Replace the raw text with the winning fragment so the
            # advanced-mode "OCR" debug line shows what actually matched.
            text = cand
            price = cand_price

    t3 = time.perf_counter()
    print(
        f"[timing/{label}] capture={t1 - t0:.3f}s ocr={t2 - t1:.3f}s "
        f"price_lookup={t3 - t2:.3f}s total={t3 - t0:.3f}s"
    )
    return text, price


def _cold_rescue(
    rescue_pool: list[str],
    lang: str,
    game_mode: str,
    corrections: dict[str, str],
) -> tuple[str, dict] | None:
    """One deferred cold-path (network) try after ALL cache-only probes
    failed. This is what preserves brand-new patch items (in the ≤10min gap
    before the catalog cache refreshes) now that the in-flow probes are
    cache-only: pick the most promising read strings and let the server
    substring search / fuzzy have one shot. Capped at 2 candidates so the
    worst-case lookup pays ≤2 round trips instead of the old one-per-string
    (which multiplied into ~7s). Only runs when the cache is populated —
    on a true cold start the in-flow probes already went to the network."""
    if not has_price_cache(lang, game_mode):
        return None
    seen: set[str] = set()
    candidates: list[str] = []
    for s in sorted((s.strip() for s in rescue_pool), key=len, reverse=True):
        if len(s) < 3 or s in seen:
            continue
        seen.add(s)
        candidates.append(s)
        if len(candidates) >= 2:
            break
    for cand in candidates:
        price = get_item_price(
            cand, lang=lang, game_mode=game_mode, corrections=corrections,
            allow_cold=True,
        )
        if price.get("name") is not None:
            print(f"[lookup] cold rescue matched {cand!r} -> {price['name']!r}")
            return cand, price
    return None


# Server-side supersession for rapid F2. /lookup is a *sync* endpoint, so
# FastAPI runs each call in its own thread-pool worker — the client aborting a
# fetch only drops the HTTP wait, the worker thread still runs all 4 captures +
# the wide rescue to completion. Spamming F2 therefore stacked up to N full OCR
# passes in parallel (measured 383ms -> 1078ms under contention). A worker bails
# before its next capture once a newer press exists, so only the most recent
# lookup keeps doing OCR work. The client already discards superseded responses
# (lookupSeqRef + abort), so returning an empty body early is invisible.
#
# Ordering is keyed on the CLIENT's per-press counter (req.client_seq), NOT a
# server-assigned ticket: a ticket claimed *after* the variable cursor-query +
# clamp work (both GIL-releasing) could be handed out in the wrong order vs the
# true press order, letting the NEWEST press (the one the user wants) draw a
# lower number and falsely supersede itself. Keying on client_seq guarantees the
# newest press always holds the highest number and can never be superseded.
_lookup_seq = 0
_lookup_seq_lock = threading.Lock()


def _observe_client_seq(client_seq: int | None) -> None:
    """Record the newest press seq the client has sent so far."""
    global _lookup_seq
    if client_seq is None:
        return
    with _lookup_seq_lock:
        if client_seq > _lookup_seq:
            _lookup_seq = client_seq


def _lookup_superseded(client_seq: int | None) -> bool:
    """True iff a strictly newer press has since arrived. None (caller sent no
    seq) disables supersession for that request."""
    if client_seq is None:
        return False
    with _lookup_seq_lock:
        return client_seq < _lookup_seq


@app.post("/lookup", response_model=LookupResponse)
def lookup(req: CaptureRequest) -> LookupResponse:
    # Register this press as early as possible (before the blocking cursor
    # query) so an in-flight older lookup notices it on its next loop check.
    # Done even for the override_text fast-path below, so a manual lookup also
    # supersedes a still-running F2 capture.
    _observe_client_seq(req.client_seq)
    winapi_cursor = _get_cursor_pos_winapi()
    print(
        f"[lookup] x={req.x} y={req.y} w={req.width} h={req.height} "
        f"lang={req.lang} game_mode={req.game_mode} mirror_x={req.mirror_x} "
        f"front_cursor=({req.cursor_x},{req.cursor_y}) "
        f"winapi_cursor={winapi_cursor}"
    )
    lang = req.lang if req.lang in ("ko", "en", "ru") else "ko"
    game_mode = req.game_mode if req.game_mode in ("regular", "pve", "pvp-season") else "regular"

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
        return _build_response(req.override_text, price, game_mode, lang=req.lang)

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

    # Inventory-full "공간 부족 (아이템)" notification shows dead-center on screen
    # (at the crosshair), which none of the cursor-relative boxes above — nor
    # the zoom-out rescue below — reach. Add a monitor-center box as the LAST
    # attempt: the loop only gets here when every cursor-relative box missed, so
    # it costs nothing on normal lookups. _capture_and_lookup's
    # unwrap_nospace_item() then pulls the item name out of the "공간 부족 (X)"
    # wrapper read here. Sized generously (a wide line, tolerant of the text
    # sitting a bit above/below true center) — tune with in-game data if needed.
    if can_clamp:
        cbox = _monitor_center_box(cursor_x, cursor_y, 720, 160)
        if cbox is not None:
            attempts.append(("center", *cbox))

    text, price = "", {"name": None}
    # Longest text read across attempts. On a total no-match the response
    # must carry the most informative read — the loop overwrites `text`
    # each attempt, so without this a primary that READ text but didn't
    # match got masked by a blank last attempt (raw_text=""), which both
    # showed the user a false "read nothing" hint and over-counted the
    # "empty" telemetry class the zoom-out rescue was sized against.
    best_text = ""
    # Which attempt produced the reported text: on a match, the matching
    # attempt; on a no-match, the attempt whose text we ended up reporting
    # (best_text's source) — NOT a hardcoded "primary", which would mislabel
    # ground/mirror reads in telemetry.
    attempt_used = "primary"
    # Every string read across ALL attempts, for the single deferred cold-
    # rescue at the end (in-flow probes are cache-only — see _cold_rescue).
    rescue_pool: list[str] = []
    for label, ax, ay, aw, ah in attempts:
        if _lookup_superseded(req.client_seq):
            print(f"[lookup] superseded before {label} (seq {req.client_seq}) - aborting")
            return _build_response(best_text, {"name": None}, game_mode, attempt="superseded", lang=req.lang)
        text, price = _capture_and_lookup(
            ax, ay, aw, ah, lang, game_mode, label, req.corrections,
            rescue_pool=rescue_pool,
        )
        if len(text.strip()) > len(best_text):
            best_text = text.strip()
            attempt_used = label
        if price.get("name") is not None:
            attempt_used = label
            break

    # Zoom-out rescue: production telemetry says 78% of failed lookups read
    # NOTHING at all ("empty") — the capture box missed the tooltip entirely
    # (UI-scale / resolution offsets slightly off). When every attempt came
    # back blank, retry ONCE with a box grown around the primary region
    # (60% wider, 2x taller, re-centered) before giving up. Runs only on the
    # total-miss path, so the extra OCR pass costs nothing on normal lookups.
    if price.get("name") is None and not best_text and not _lookup_superseded(req.client_seq):
        ex = int(primary_x - req.width * 0.3)
        ey = int(primary_y - req.height * 0.5)
        ew = int(req.width * 1.6)
        eh = int(req.height * 2.0)
        if can_clamp:
            ex, ey, ew, eh = _clamp_to_monitor(ex, ey, ew, eh, cursor_x, cursor_y)
        wide_text, wide_price = _capture_and_lookup(
            ex, ey, ew, eh, lang, game_mode, "wide", req.corrections,
            rescue_pool=rescue_pool,
        )
        # Adopt the wide result if it found a name — or at least read SOME
        # text (better diagnostics for the user than a silent blank). Tag the
        # response so telemetry can tell "rescued/read-by-wide" apart from a
        # plain primary read — without the tag, wide adopting text silently
        # moves capture-miss events from the "empty" bucket into "no_match"
        # and the dashboard's misread-vs-misaligned split becomes garbage.
        if wide_price.get("name") is not None or wide_text.strip():
            if wide_price.get("name") is None:
                rescued = _cold_rescue(rescue_pool, lang, game_mode, req.corrections)
                if rescued is not None:
                    return _build_response(rescued[0], rescued[1], game_mode, attempt="wide", lang=req.lang)
            return _build_response(wide_text, wide_price, game_mode, attempt="wide", lang=req.lang)

    # Deferred cold-path: one network shot at the best-read strings, for
    # brand-new patch items the (≤10min-stale) catalog cache can't know yet.
    if price.get("name") is None and rescue_pool and not _lookup_superseded(req.client_seq):
        rescued = _cold_rescue(rescue_pool, lang, game_mode, req.corrections)
        if rescued is not None:
            return _build_response(rescued[0], rescued[1], game_mode, attempt=attempt_used, lang=req.lang)

    # No match: report the most informative text read across attempts.
    final_text = text if price.get("name") is not None else best_text
    return _build_response(final_text, price, game_mode, attempt=attempt_used, lang=req.lang)


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
    # True -> WIPE RESET: also ignore log events from before this moment, so
    # old logs can't resurrect pre-wipe progress. For EFT wipes/season resets.
    # A later plain reset (from_now=False) clears the watermark again (undo).
    from_now: bool = False


@app.get("/hideout/stations")
def hideout_stations(lang: str = "en") -> list:
    """Return [{id, name, maxLevel}] for all hideout stations.
    Used by the frontend settings panel so users can set their current
    upgrade level per station (to dim already-completed rows on the card)."""
    return get_station_list(lang)


@app.get("/radar")
def radar_state(lang: str = "ko", game_mode: str = "regular", map: str | None = None, full: bool = False) -> dict:
    """레이더(미니맵 1단계): 가장 최근 좌표 스크린샷 + 게임 로그로 판정한 맵 + 그 맵의 탈출구·트랜짓·
    진행 중 퀘스트 목표까지의 거리·상대 각도·높이 차. 게임 메모리는 읽지 않는다(radar.py 참고).
    앱이 1초마다 부르므로 지도 데이터는 스크린샷이 새로울 때나 사용자가 직접 열 때(full)만 받는다."""
    return get_radar().state(lang=lang, game_mode=game_mode, map_override=map or None, full=full)


@app.get("/radar/keylocks")
def radar_keylocks(item_id: str, lang: str = "ko", game_mode: str = "regular") -> dict:
    """시세로 조회한 아이템이 열쇠면 지금 맵에서 그 열쇠로 여는 잠긴 문·트렁크(거리·방향). 아니면 locks 빈 목록."""
    return get_radar().key_locks(item_id, lang, game_mode)


@app.get("/radar/map")
def radar_map(map: str, lang: str = "ko") -> dict:
    """전체 지도(2단계)용 정적 좌표: 탈출구·트랜짓·위험 구역(윤곽)·잠긴 문·상자·스폰·고정 무기·스위치.
    tarkov.dev API 좌표만 쓴다(SVG 지도 없음). 맵·언어별 캐시."""
    from radar import map_features
    doc = map_features(map, lang)
    if doc is None:
        raise HTTPException(status_code=404, detail="unknown_map")
    return doc


@app.get("/radar/mapimg")
def radar_map_image(map: str, layer: str | None = None):
    """전체 지도 배경 그림(tarkov.dev SVG, CC BY-NC-SA 4.0 · 비영리·출처 표기). 사이드카가 7일 캐시해 되돌려준다.
    layer = 층 그룹 id(td_maps.json layers[].g) — 그 층만 켜고 바탕은 흐리게. 없으면 바탕(지상)만."""
    from fastapi.responses import Response
    from radar import map_image_svg
    data = map_image_svg(map, layer or None)
    if data is None:
        raise HTTPException(status_code=404, detail="no_map_image")
    return Response(content=data, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})


class HideoutSyncRequest(BaseModel):
    """앱 프런트가 설정에서 고른 은신처 단계 {station_id: level}. 사이트 연동(/progress)에 같이 실어 준다."""
    levels: dict[str, int] = {}


_hideout_levels_cache: dict[str, int] | None = None


def _hideout_levels_path():
    from quest_tracker import _state_dir

    return _state_dir() / "hideout_levels.json"


def _load_hideout_levels() -> dict[str, int]:
    global _hideout_levels_cache
    if _hideout_levels_cache is None:
        try:
            _hideout_levels_cache = {str(k): int(v) for k, v in json.loads(_hideout_levels_path().read_text(encoding="utf-8")).items()}
        except Exception:  # noqa: BLE001 — 없거나 깨졌으면 빈 값
            _hideout_levels_cache = {}
    return _hideout_levels_cache


@app.post("/sync/hideout", dependencies=[Depends(_reject_foreign_origin)])
def sync_hideout(req: HideoutSyncRequest) -> dict:
    global _hideout_levels_cache
    levels = {str(k): int(v) for k, v in (req.levels or {}).items() if int(v) > 0}
    _hideout_levels_cache = levels
    try:
        p = _hideout_levels_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(levels), encoding="utf-8")
    except Exception as ex:  # noqa: BLE001
        print(f"[sync] hideout levels save failed: {ex}")
    return {"ok": True, "count": len(levels)}


@app.get("/progress")
def progress(game_mode: str = "regular") -> dict:
    """가이드 사이트용 진행도 요약 — 게임 로그에서 읽은 퀘스트 상태(모드별) + 앱 설정의 은신처 단계.
    읽기 전용이고 화면 내용은 전혀 들어 있지 않다. CORS 는 _ProgressCORS 가 이 경로에만 붙인다."""
    tracker = get_tracker()
    mode = _normalize_request_mode(game_mode)
    st = tracker.all_status(mode)
    by = {"completed": [], "started": [], "failed": []}
    for qid, status in st.items():
        if status in by:
            by[status].append(qid)
    return {
        "ok": True,
        "mode": mode,
        "enabled": tracker.is_enabled(),
        "quest_count": len(st),
        **by,
        "hideout": _load_hideout_levels(),
        "gunsmith": gunsmith.status().get("updated") or None,
    }


class RadarFolderRequest(BaseModel):
    path: str = ""  # 빈 문자열 = 자동 탐색으로 되돌리기


@app.get("/radar/folder")
def radar_folder() -> dict:
    """레이더가 보는 스크린샷 폴더: 현재 폴더·출처(auto/manual)·자동 탐색 결과."""
    return get_radar().folder_info()


@app.post("/radar/folder", dependencies=[Depends(_reject_foreign_origin)])
def radar_folder_set(req: RadarFolderRequest) -> dict:
    """사용자가 스크린샷 폴더를 직접 지정(문서 폴더를 옮긴 PC 등). 없는 폴더면 400."""
    try:
        return get_radar().set_folder(req.path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/radar/folder/open", dependencies=[Depends(_reject_foreign_origin)])
def radar_folder_open() -> dict:
    """레이더가 보는 스크린샷 폴더를 탐색기로 연다(설정 › 폴더 열기). 폴더가 없으면 404."""
    folder = get_radar().folder_info().get("folder")
    if not folder or not os.path.isdir(folder):
        raise HTTPException(status_code=404, detail="screenshot folder not found")
    try:
        os.startfile(folder)  # type: ignore[attr-defined]  # Windows 전용
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "folder": folder}


class RadarPruneRequest(BaseModel):
    keep: int = 0  # 0 = 자동 정리 끔, N = 좌표 스크린샷을 최신 N장만 남김(나머지는 휴지통)


@app.post("/radar/prune", dependencies=[Depends(_reject_foreign_origin)])
def radar_prune_set(req: RadarPruneRequest) -> dict:
    """레이더용 스크린샷 자동 정리 설정. 장당 5~7MB라 F2를 자주 누르면 하루 1GB를 넘긴다."""
    try:
        return get_radar().set_prune(req.keep)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/quests/status")
def quests_status() -> dict:
    """Current state of the quest log watcher: install path validity,
    how many quests we've seen, etc. The frontend polls this so it can
    surface "X quests synced" or warn that the install path is wrong."""
    return get_tracker().get_status()


@app.post("/quests/path", dependencies=[Depends(_reject_foreign_origin)])
def quests_set_path(req: QuestPathRequest) -> dict:
    """Override the auto-detected EFT install path. Pass an empty string
    to revert to auto-detection."""
    return get_tracker().set_install_path(req.path)


@app.post("/quests/enabled", dependencies=[Depends(_reject_foreign_origin)])
def quests_set_enabled(req: QuestEnabledRequest) -> dict:
    """Toggle the watcher on/off. When off, /lookup responses leave
    `task_status` as null and no log files are read."""
    get_tracker().set_enabled(req.enabled)
    return get_tracker().get_status()


@app.post("/quests/reset", dependencies=[Depends(_reject_foreign_origin)])
def quests_reset(req: QuestResetRequest | None = None) -> dict:
    """Wipe known quest state and re-scan from scratch. Pass `game_mode`
    to wipe only one server's state — used after migration when a
    single-mode player has fake progress copied into the unused mode.
    Pass `from_now=true` for a wipe reset (ignore pre-existing log events)."""
    mode = req.game_mode if req is not None else None
    from_now = req.from_now if req is not None else False
    get_tracker().reset(mode, from_now=from_now)
    return get_tracker().get_status()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
