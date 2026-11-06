"""가이드 연결 색인 — 조회한 아이템이 가이드 사이트의 어느 목록 페이지에 행으로 있는지(11-04).

오버레이 카드의 책 버튼은 위키 대신 우리 가이드(tarkov.aquapado.com/guide/)로 보낸다. 가이드엔 아이템별
페이지가 없어 목록 페이지(필요 아이템 /guide/items/, 열쇠 /guide/keys/)에 ?q= 로 검색칸을 채워 연다.
그런데 필요 아이템 페이지는 '그 아이템 하나만 내는 목표'만 모으고 택일 목표는 빼므로, 퀘스트에 쓰인다고
다 행이 있지 않다 → 가이드가 빌드 때 만드는 정적 JSON(https://tarkov.aquapado.com/guide/item-pages.json)을
하루 한 번 받아 %LOCALAPPDATA%\\TarkovPriceOverlay\\item-pages.json 에 캐시하고, 행이 있는 경우만 가이드로 보낸다.
가이드에 없는 아이템은 기존처럼 위키 링크를 쓴다. 받는 것만 하고 아무 사용자 데이터도 보내지 않는다.

JSON 형식(scripts/build_guide.py 가 만든다): {"updated": "2026-11-04", "items": ["<id>", ...], "keys": ["<id>", ...],
"usage": ["<id>", ...]}  ← 11-06 거래 불가 아이템 쓰임새 페이지(/guide/untradeable/)
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import requests

URL = os.environ.get("TPO_GUIDE_INDEX_URL") or "https://tarkov.aquapado.com/guide/item-pages.json"
TTL_SEC = 24 * 3600
_HEADERS = {"User-Agent": "tarkov-price-overlay/guide-index"}

_lock = threading.Lock()
_items: set[str] = set()
_keys: set[str] = set()
_usage: set[str] = set()  # 11-06 /guide/untradeable/ 행
_updated: str = ""


def _cache_path() -> Path:
    from quest_tracker import _state_dir  # 같은 폴더(%LOCALAPPDATA%\TarkovPriceOverlay)

    return _state_dir() / "item-pages.json"


def load_from_dict(doc: dict) -> int:
    """테스트·수동 주입용. 들어온 항목 수(필요 아이템 + 열쇠)를 돌려준다."""
    global _items, _keys, _usage, _updated
    if not isinstance(doc, dict):
        return 0
    items = {str(x) for x in doc.get("items") or [] if isinstance(x, str)}
    keys = {str(x) for x in doc.get("keys") or [] if isinstance(x, str)}
    usage = {str(x) for x in doc.get("usage") or [] if isinstance(x, str)}
    if not items and not keys and not usage:
        return 0
    with _lock:
        _items, _keys, _usage, _updated = items, keys, usage, str(doc.get("updated") or "")
    return len(items) + len(keys) + len(usage)


def _read_disk() -> dict | None:
    try:
        p = _cache_path()
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except Exception:  # noqa: BLE001 — 캐시가 깨졌으면 없는 셈
        return None


def refresh(force: bool = False) -> bool:
    """디스크 캐시가 하루 안이면 그걸 쓰고, 아니면 받아 온다. 실패해도 기존 값 유지."""
    disk = _read_disk()
    if disk and not force and (time.time() - float(disk.get("_fetched_at") or 0)) < TTL_SEC:
        return load_from_dict(disk) > 0
    try:
        r = requests.get(URL, headers=_HEADERS, timeout=10)
        r.raise_for_status()
        doc = r.json()
        if load_from_dict(doc):
            try:
                p = _cache_path()
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps({**doc, "_fetched_at": time.time()}, ensure_ascii=False), encoding="utf-8")
            except Exception:  # noqa: BLE001
                pass
            return True
    except Exception as e:  # noqa: BLE001
        print(f"[guide-index] fetch failed: {e!r}")
    return bool(disk and load_from_dict(disk))  # 네트워크가 안 되면 오래된 캐시라도


def start_background_refresh() -> None:
    threading.Thread(target=refresh, name="guide-index-refresh", daemon=True).start()


def page_for(item_id: str | None) -> str | None:
    """'keys' | 'items' | 'usage' | None. 열쇠 페이지를 우선한다(열쇠는 필요 아이템에도 있을 수 있음).
    usage(거래 불가 쓰임새 페이지)는 필요 아이템 페이지에 없을 때만 — 퀘스트에 쓰이면 그쪽이 더 쓸모 있다."""
    if not item_id:
        return None
    with _lock:
        if item_id in _keys:
            return "keys"
        if item_id in _items:
            return "items"
        if item_id in _usage:
            return "usage"
    return None


def status() -> dict:
    with _lock:
        return {"items": len(_items), "keys": len(_keys), "usage": len(_usage), "updated": _updated}
