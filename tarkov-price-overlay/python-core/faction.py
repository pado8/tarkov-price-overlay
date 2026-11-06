"""PMC 진영(BEAR/USEC) — 11-06.

퀘스트 503개 중 34개(BEAR 17·USEC 17)는 진영 전용이다(Textile·Drip-Out·Gunsmith 일부 등). 앱은 진영을 몰라서
카드에 같은 이름 퀘스트가 두 줄(BEAR 판·USEC 판) 나왔다. 게임 로그에는 내 진영이 직접 안 남는다(11-06 로그 10종 확인)
→ 로그에서 이미 읽는 퀘스트 상태로 추정한다: 진영 전용 퀘스트를 하나라도 받았거나(started) 끝냈으면(completed·failed)
그 진영. 표는 json.tarkov.dev 퀘스트 문서(factionName)에서 만든다 — 아이템과 상관없는 진영 퀘스트(A Big Loss 등)까지 다.
네트워크·문서 문제면 빈 표 → '모름'(None). 조회를 막지 않는다.
"""
from __future__ import annotations

import threading
import time
from collections import Counter

FACTIONS = ("BEAR", "USEC")
_TTL_SEC = 6 * 3600
_lock = threading.Lock()
_cache: tuple[float, dict[str, str]] | None = None


def _fetch() -> dict[str, str]:
    import tarkov_json_fallback as tj  # 지연 import — 시험에서 바꿔 끼우기 쉽게

    doc = tj._get_cached("regular/tasks")  # 진영 전용 여부는 모드와 무관(퀘스트 id 도 같다)
    tasks = ((doc.get("data") or {}).get("tasks")) or {}
    return {tid: t["factionName"] for tid, t in tasks.items() if isinstance(t, dict) and t.get("factionName") in FACTIONS}


def quest_factions() -> dict[str, str]:
    """{퀘스트 id: 'BEAR'|'USEC'} — 진영 전용 퀘스트만. 실패하면 빈 dict(다음 호출에 다시 시도)."""
    global _cache
    now = time.time()
    with _lock:
        if _cache and now - _cache[0] < _TTL_SEC:
            return _cache[1]
    try:
        m = _fetch()
    except Exception as e:  # noqa: BLE001
        print(f"[faction] quest faction table unavailable: {e!r}")
        return {}
    if m:
        with _lock:
            _cache = (now, m)
    return m


def detect(status: dict[str, str | None], qf: dict[str, str] | None = None) -> str | None:
    """퀘스트 상태 {id: started|completed|failed} 로 진영 추정. 근거가 없거나 두 진영이 같은 수로 섞이면 None."""
    qf = quest_factions() if qf is None else qf
    c = Counter(qf[q] for q, s in (status or {}).items() if s in ("started", "completed", "failed") and q in qf)
    if not c:
        return None
    (top, n), *rest = c.most_common()
    if rest and rest[0][1] == n:
        return None
    return top
