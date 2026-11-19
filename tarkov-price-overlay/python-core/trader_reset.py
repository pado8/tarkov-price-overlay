"""상인 재입고(초기화) 시각 — 설정의 '상인 재입고 알림'(2026-11-16, 1.3.5 공개).

자료 = json.tarkov.dev/<regular|pve>/traders 의 data.<상인 id>.resetTime(다음 초기화, UTC ISO). 우리 서버는 쓰지 않는다.
- 응답 헤더가 Cache-Control: max-age=691200(8일)이라 그대로 부르면 옛 값 → 주소 끝에 ?t=<2분 단위 숫자>를 붙인다(가이드 사이트와 같은 방식).
- 주기 폴링 금지: 받는 때는 ① 처음 ② 지켜보는 상인의 초기화 시각이 지난 지 1분 뒤 — 그것도 마지막으로 받은 지 2분이 지났을 때만.
  (tarkov.dev 수집이 늦어 값이 그대로면 앱이 간격을 늘려 다시 묻는다.) 켠 사람만 부른다.
- 값은 tarkov.dev 수집 기준이라 게임과 몇 분 어긋날 수 있다 → 알림 문구는 '약'.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Callable, Optional

MIN_REFETCH_SEC = 120      # 마지막으로 받은 뒤 이 안에는 다시 받지 않는다
STALE_AFTER_SEC = 60       # 초기화 시각이 이만큼 지나면 새 값을 받을 때
MAX_AGE_SEC = 6 * 3600     # 지켜보는 상인이 없어도 이보다 오래된 값은 버린다
BUCKET_SEC = 120           # 주소 끝 숫자 단위(캐시 피하기)
# 알림 기본 대상 — 물건을 사는 주요 상인(펜스·등대지기·BTR 등은 뺌)
DEFAULT_KEYS = ("prapor", "therapist", "skier", "peacekeeper", "mechanic", "ragman", "jaeger")


def parse_iso(s) -> Optional[float]:
    """'2026-11-16T07:53:30.000Z' → epoch 초. 못 읽으면 None."""
    if not isinstance(s, str) or not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except ValueError:
        return None


def parse_rows(doc: dict, names: Optional[dict] = None) -> list[dict]:
    """traders 문서(data 부분) → [{id, key(normalizedName), name, reset(epoch 초)}], 초기화 이른 순. 시각 없는 상인은 뺀다."""
    out = []
    for tid, v in (doc or {}).items():
        if not isinstance(v, dict):
            continue
        ts = parse_iso(v.get("resetTime"))
        key = v.get("normalizedName")
        if ts is None or not key:
            continue
        nm = (names or {}).get(v.get("name")) if isinstance(v.get("name"), str) else None
        out.append({"id": tid, "key": key, "name": (nm or key).strip() if isinstance(nm or key, str) else key, "reset": round(ts)})
    out.sort(key=lambda r: (r["reset"], r["key"]))
    return out


def need_fetch(cache: Optional[dict], now: float, keys: Optional[set] = None) -> bool:
    """cache = {"at": 받은 시각, "rows": [...]}. keys = 지켜보는 상인(없으면 전부)."""
    if not cache or not cache.get("rows"):
        return True
    age = now - float(cache.get("at") or 0)
    if age < MIN_REFETCH_SEC:
        return False
    if age > MAX_AGE_SEC:
        return True
    watched = [r for r in cache["rows"] if not keys or r["key"] in keys]
    return any(r["reset"] <= now - STALE_AFTER_SEC for r in watched)


def _default_fetch(mode: str) -> dict:
    import requests

    import tarkov_json_fallback as tj

    r = requests.get(f"{tj._JSON_BASE}/{mode}/traders", params={"t": int(time.time() // BUCKET_SEC)}, headers=tj._HEADERS, timeout=20)
    r.raise_for_status()
    return (r.json() or {}).get("data") or {}


def _default_names(mode: str, lang: str) -> dict:
    import tarkov_json_fallback as tj

    return tj._get_locale(f"{mode}/traders_{lang}") or tj._get_locale(f"{mode}/traders_en") or {}


class TraderResets:
    def __init__(self, fetch: Callable[[str], dict] = _default_fetch, names: Callable[[str, str], dict] = _default_names) -> None:
        self._fetch, self._names = fetch, names
        self._lock = threading.Lock()
        self._cache: dict[str, dict] = {}       # mode → {"at", "doc"}
        self._name_cache: dict[tuple, dict] = {}  # (mode, lang) → 번역표(이름은 안 바뀌므로 한 번만)
        self.fetches = 0  # 진단·시험용

    def get(self, mode: str = "regular", lang: str = "en", keys: Optional[set] = None, now: Optional[float] = None) -> dict:
        """{traders: [{key, name, reset}], fetched_at, stale, error} — stale = 지켜보는 상인 중 초기화 시각이 이미 지난 값이 있다
        (tarkov.dev 가 아직 새 값을 안 냄 → 앱이 간격을 늘려 다시 묻는다)."""
        mode = "pve" if mode == "pve" else "regular"
        now = time.time() if now is None else now
        err = None
        with self._lock:
            c = self._cache.get(mode)
            rows = parse_rows((c or {}).get("doc") or {})
            if need_fetch({"at": c["at"], "rows": rows} if c else None, now, keys):
                try:
                    doc = self._fetch(mode)
                    self.fetches += 1
                    if parse_rows(doc):
                        c = self._cache[mode] = {"at": now, "doc": doc}
                    elif c:
                        c["at"] = now  # 빈 응답 — 옛 값을 쓰되 2분 안에 다시 받지는 않는다
                except Exception as e:  # noqa: BLE001 — 네트워크 실패는 옛 값 + error
                    err = repr(e)[:200]
                    if c:
                        c["at"] = now
            nk = (mode, lang)
            if nk not in self._name_cache and c:
                try:
                    self._name_cache[nk] = self._names(mode, lang) or {}
                except Exception:  # noqa: BLE001
                    self._name_cache[nk] = {}
            rows = parse_rows((c or {}).get("doc") or {}, self._name_cache.get(nk))
        others = [r for r in rows if keys and r["key"] not in keys]
        rows = [r for r in rows if not keys or r["key"] in keys]
        return {"traders": [{"key": r["key"], "name": r["name"], "reset": r["reset"]} for r in rows],
                # 고르지 않은 상인(설정의 상인 고르기에 이름을 보이려고) — 다시 받기·stale 판정에는 안 쓴다
                "others": [{"key": r["key"], "name": r["name"], "reset": r["reset"]} for r in others],
                "fetched_at": round(c["at"]) if c else None,
                "stale": any(r["reset"] <= now for r in rows), "error": err}


_svc: Optional[TraderResets] = None


def get_service() -> TraderResets:
    global _svc
    if _svc is None:
        _svc = TraderResets()
    return _svc
