"""건스미스 부품 표시 — 조회한 아이템이 기계공 건스미스 퀘스트(필수 부품 또는 위키 예시 조립)에 쓰이면 알려 준다.

데이터는 가이드 사이트가 빌드 때 만드는 정적 JSON(https://tarkov.aquapado.com/guide/gunsmith.json)을
하루 한 번 받아 %LOCALAPPDATA%\\TarkovPriceOverlay\\gunsmith.json 에 캐시한다. 앱을 새로 내지 않아도
가이드만 다시 빌드·배포하면 최신화된다. 받는 것만 하고 아무 사용자 데이터도 보내지 않는다.

JSON 형식(guide_static.gunsmith_page 가 만든다):
  {"updated": "2026-10-27", "items": {"<item id>": [{"q": "Gunsmith - MP-133", "k": "건스미스 - MP-133",
                                                     "t": "req"|"ex", "w": "MP-133"}]}}
  t=req 는 데이터상 반드시 포함할 부품, t=ex 는 공식 위키 예시 조립에 쓰인 부품.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import requests

URL = os.environ.get("TPO_GUNSMITH_URL") or "https://tarkov.aquapado.com/guide/gunsmith.json"
TTL_SEC = 24 * 3600
_HEADERS = {"User-Agent": "tarkov-price-overlay/gunsmith"}

_lock = threading.Lock()
_items: dict[str, list[dict]] | None = None
_loaded_at: float = 0.0
_updated: str = ""


def _cache_path() -> Path:
    from quest_tracker import _state_dir  # 같은 폴더(%LOCALAPPDATA%\TarkovPriceOverlay)

    return _state_dir() / "gunsmith.json"


def load_from_dict(doc: dict) -> int:
    """테스트·수동 주입용. 들어온 항목 수를 돌려준다."""
    global _items, _loaded_at, _updated
    items = doc.get("items") if isinstance(doc, dict) else None
    if not isinstance(items, dict):
        return 0
    with _lock:
        _items = {str(k): [x for x in v if isinstance(x, dict)] for k, v in items.items() if isinstance(v, list)}
        _loaded_at = time.time()
        _updated = str(doc.get("updated") or "")
    return len(_items)


def _read_disk() -> dict | None:
    try:
        p = _cache_path()
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — 캐시가 깨졌으면 없는 셈 친다
        return None


def _write_disk(doc: dict) -> None:
    try:
        p = _cache_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({**doc, "_fetched_at": time.time()}, ensure_ascii=False), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def refresh(force: bool = False) -> bool:
    """디스크 캐시가 하루 안이면 그걸 쓰고, 아니면 받아 온다. 성공 여부를 돌려준다(실패해도 기존 값 유지)."""
    disk = _read_disk()
    if disk and not force and (time.time() - float(disk.get("_fetched_at") or 0)) < TTL_SEC:
        return load_from_dict(disk) > 0
    try:
        r = requests.get(URL, headers=_HEADERS, timeout=10)
        r.raise_for_status()
        doc = r.json()
        n = load_from_dict(doc)
        if n:
            _write_disk(doc)
            print(f"[gunsmith] loaded {n} items (updated {doc.get('updated')})")
            return True
    except Exception as ex:  # noqa: BLE001
        print(f"[gunsmith] fetch failed: {ex}")
    if disk:  # 오래된 캐시라도 없는 것보단 낫다
        return load_from_dict(disk) > 0
    return False


def start_background_refresh() -> None:
    """앱 시작 때 한 번 — 첫 조회를 늦추지 않도록 스레드에서 받는다."""
    threading.Thread(target=refresh, name="gunsmith-refresh", daemon=True).start()


def for_item(item_id: str | None, lang: str = "ko") -> list[dict]:
    """[{quest, kind, weapon}] — 언어가 ko면 한국어 퀘스트 이름, 아니면 영어. 모르는 아이템이면 []."""
    if not item_id:
        return []
    with _lock:
        rows = (_items or {}).get(item_id) or []
    out = []
    seen = set()
    for r in rows:
        name = (r.get("k") if lang == "ko" else None) or r.get("q") or ""
        key = (name, r.get("t"), r.get("w"))
        if not name or key in seen:
            continue
        seen.add(key)
        out.append({"quest": name, "kind": "req" if r.get("t") == "req" else "ex", "weapon": r.get("w") or None})
    # 필수가 먼저, 그다음 예시
    out.sort(key=lambda x: (0 if x["kind"] == "req" else 1, x["quest"]))
    return out


def status() -> dict:
    with _lock:
        return {"loaded": _items is not None, "items": len(_items or {}), "updated": _updated, "loaded_at": _loaded_at}
