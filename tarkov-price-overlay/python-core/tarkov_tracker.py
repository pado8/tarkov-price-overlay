"""TarkovTracker 연동(11-08) — 사용자가 TarkovTracker 에 적어 둔 진행도에서 은신처 레벨을 가져온다.

게임 로그엔 은신처 업그레이드 기록이 없어(355 세션 확인) 앱은 지금까지 수동 입력(+/−)만 받았다. TarkovTracker 를
쓰는 사람은 거기 이미 적어 두므로, 읽기 토큰 하나로 그 값을 가져온다.

- API: https://api.tarkovtracker.org (2026-11 확인 — 예전 tarkovtracker.io·tarkovtracker.org/api/v2 는 폐지).
  GET /token(토큰 정보·모드), GET /progress(진행도, 약한 ETag → If-None-Match 로 304). 무료 하루 1,000회, 60초 이상 간격 권장.
- 토큰은 PVP_/PVE_/SZN_ 로 시작하고 모드가 토큰에 묶여 있다(GameMode pvp|pve|seasonal).
- hideoutModulesProgress[].id = tarkov.dev 은신처 '시설-레벨' id = '<시설 id>-<레벨>'(json.tarkov.dev 68개 전부 이 형식,
  PvP·PvE 같음). 시설마다 complete 인 가장 높은 레벨이 지금 레벨.
- 토큰은 이 PC 상태 폴더(tarkovtracker.json)에만 둔다. 우리 서버·익명 통계로 보내지 않고, 로그·응답엔 가린 값만.
- 다른 출처(예: 후속 서비스)가 생기면 ProgressSource 를 하나 더 만들면 된다.
"""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Optional

import requests

API_BASE = "https://api.tarkovtracker.org"
TOKEN_RE = re.compile(r"^(PVP|PVE|SZN)_[A-Za-z0-9_-]{8,200}$")  # 접두사만 엄격히(본문 문자 규칙은 문서에 없음)
MIN_INTERVAL_SEC = 60  # API 문서: 60초 이상 간격으로
TIMEOUT_SEC = 15
USER_AGENT = "TarkovPriceOverlay (+https://tarkov.aquapado.com)"
# 앱 모드(퀘스트 서버) ↔ TarkovTracker 모드
APP_TO_TT = {"pvp": "pvp", "regular": "pvp", "pve": "pve", "season": "seasonal", "pvp-season": "seasonal"}


def mask(token: Optional[str]) -> str:
    """로그·화면용 — 앞 접두사와 끝 4자만."""
    if not token:
        return ""
    head = token.split("_", 1)[0] + "_" if "_" in token else ""
    return f"{head}…{token[-4:]}"


def station_level(module_id: str) -> Optional[tuple[str, int]]:
    """'<시설 id>-<레벨>' → (시설 id, 레벨). 형식이 다르면 None."""
    m = re.match(r"^([0-9a-f]{24})-(\d{1,2})$", module_id or "")
    return (m.group(1), int(m.group(2))) if m else None


def hideout_levels(progress: dict) -> dict[str, int]:
    """진행도 응답(data) → {시설 id: 완료된 가장 높은 레벨}. 완료 기록이 없는 시설은 넣지 않는다."""
    out: dict[str, int] = {}
    for m in progress.get("hideoutModulesProgress") or []:
        if not isinstance(m, dict) or not m.get("complete"):
            continue
        sl = station_level(str(m.get("id") or ""))
        if sl:
            sid, lv = sl
            out[sid] = max(out.get(sid, 0), lv)
    return out


class TrackerError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


class ProgressSource:
    """진행도 출처 인터페이스 — 지금은 TarkovTracker 하나."""

    name = "?"

    def token_info(self) -> dict:
        raise NotImplementedError

    def progress(self) -> dict:
        raise NotImplementedError


class TarkovTrackerSource(ProgressSource):
    name = "tarkovtracker"

    def __init__(self, token: str, base: str = API_BASE):
        self.token = token
        self.base = base.rstrip("/")
        self._etag: Optional[str] = None
        self._last: Optional[dict] = None
        self._last_at = 0.0

    def _get(self, path: str, etag: Optional[str] = None) -> requests.Response:
        headers = {"Authorization": f"Bearer {self.token}", "User-Agent": USER_AGENT, "Accept": "application/json"}
        if etag:
            headers["If-None-Match"] = etag
        try:
            return requests.get(self.base + path, headers=headers, timeout=TIMEOUT_SEC)
        except requests.RequestException as e:
            raise TrackerError("network", type(e).__name__) from e

    @staticmethod
    def _check(r: requests.Response) -> dict:
        if r.status_code == 401:
            raise TrackerError("bad_token")
        if r.status_code == 403:
            raise TrackerError("no_permission")  # GP(읽기) 권한이 없는 토큰
        if r.status_code == 429:
            raise TrackerError("rate_limited", r.headers.get("Retry-After", ""))
        if r.status_code >= 500:
            raise TrackerError("server", str(r.status_code))
        if r.status_code != 200:
            raise TrackerError("http", str(r.status_code))
        try:
            return r.json()
        except ValueError as e:
            raise TrackerError("bad_response") from e

    def token_info(self) -> dict:
        d = self._check(self._get("/token"))
        return {"game_mode": d.get("gameMode"), "permissions": d.get("permissions") or [], "note": d.get("note") or ""}

    def progress(self, force: bool = False) -> dict:
        """진행도(data). 60초 안에 다시 부르면 지난 값. 바뀐 게 없으면(304) 지난 값."""
        now = time.time()
        if self._last is not None and not force and now - self._last_at < MIN_INTERVAL_SEC:
            return self._last
        r = self._get("/progress", self._etag if self._last is not None else None)
        self._last_at = now
        if r.status_code == 304 and self._last is not None:
            return self._last
        d = self._check(r)
        data = d.get("data") or {}
        data["_game_mode"] = (d.get("meta") or {}).get("gameMode")
        self._etag = r.headers.get("ETag")
        self._last = data
        return data


# ── 저장·상태 ─────────────────────────────────────────────────────────
_lock = threading.Lock()
_source: Optional[TarkovTrackerSource] = None
_state: dict = {}  # {"game_mode", "connected_at", "last_ok", "last_error"}


def _path():
    from quest_tracker import _state_dir  # 순환 import 방지

    return _state_dir() / "tarkovtracker.json"


def _load() -> None:
    global _source, _state
    if _source is not None or _state:
        return
    try:
        d = json.loads(_path().read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — 없거나 깨졌으면 연결 안 됨
        _state = {"_loaded": True}
        return
    tok = d.get("token") or ""
    if TOKEN_RE.match(tok):
        _source = TarkovTrackerSource(tok)
    _state = {k: d.get(k) for k in ("game_mode", "connected_at")}
    _state["_loaded"] = True


def _save(token: Optional[str]) -> None:
    p = _path()
    if not token:
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"token": token, "game_mode": _state.get("game_mode"), "connected_at": _state.get("connected_at")}),
                 encoding="utf-8")


def status() -> dict:
    with _lock:
        _load()
        return {"connected": _source is not None, "token": mask(_source.token) if _source else "",
                "game_mode": _state.get("game_mode"), "connected_at": _state.get("connected_at"),
                "last_ok": _state.get("last_ok"), "last_error": _state.get("last_error")}


def connect(token: str) -> dict:
    """토큰을 확인(GET /token)하고 저장. 빈 토큰이면 연결 끊기."""
    global _source
    token = (token or "").strip()
    with _lock:
        _load()
        if not token:
            _source = None
            _state.update(game_mode=None, connected_at=None, last_ok=None, last_error=None)
            _save(None)
            return {"connected": False}
        if not TOKEN_RE.match(token):
            raise TrackerError("bad_format")
        src = TarkovTrackerSource(token)
        info = src.token_info()
        if "GP" not in info["permissions"]:
            raise TrackerError("no_permission")
        _source = src
        _state.update(game_mode=info["game_mode"], connected_at=time.time(), last_ok=None, last_error=None)
        _save(token)
        print(f"[tracker] TarkovTracker connected {mask(token)} mode={info['game_mode']}")
    return status()


def fetch_hideout(app_mode: Optional[str] = None, force: bool = False) -> dict:
    """{game_mode, levels{시설 id: 레벨}, modules(완료 기록 수), mode_match, fetched_at}. 연결 안 됐으면 TrackerError('not_connected')."""
    with _lock:
        _load()
        src = _source
    if src is None:
        raise TrackerError("not_connected")
    try:
        data = src.progress(force=force)
    except TrackerError as e:
        with _lock:
            _state["last_error"] = e.code
        raise
    tt_mode = data.get("_game_mode") or _state.get("game_mode")
    levels = hideout_levels(data)
    want = APP_TO_TT.get(app_mode or "", None)
    with _lock:
        _state.update(last_ok=time.time(), last_error=None)
        if tt_mode and tt_mode != _state.get("game_mode"):
            _state["game_mode"] = tt_mode
    return {"game_mode": tt_mode, "levels": levels,
            "modules": sum(1 for m in data.get("hideoutModulesProgress") or [] if isinstance(m, dict) and m.get("complete")),
            "mode_match": (want is None or tt_mode is None or want == tt_mode), "fetched_at": time.time()}
