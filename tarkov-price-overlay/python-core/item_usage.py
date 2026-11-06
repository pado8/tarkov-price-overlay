"""거래 불가 아이템 쓰임새 손글 표(data/item_usage.json) — 11-06.

시세 없음으로 끝난 조회 상위(호박·포스터·타르코인·허리 주머니·감마 변형·의약품 보관함)는 퀘스트·교환·제작·은신처
데이터에 거의 안 잡혀 카드가 '거래 불가' 한 줄로 끝났다. 공식 위키에서 확인한 용도를 네 언어로 적은 표를 읽어
카드 응답(LookupResponse.usage / is_event)에 싣는다. 언어는 앱이 화면 언어로 고르므로 네 언어를 다 보낸다.
표가 없거나 깨졌으면 빈 값 — 조회를 막지 않는다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_DOC: dict | None = None
LANGS = ("ko", "en", "ru", "zh")


def _path() -> Path:
    base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
    return base / "data" / "item_usage.json"


def _items() -> dict:
    global _DOC
    if _DOC is None:
        try:
            doc = json.loads(_path().read_text(encoding="utf-8"))
            _DOC = doc.get("items") if isinstance(doc.get("items"), dict) else {}
        except Exception as e:  # noqa: BLE001
            print(f"[usage] item_usage.json unavailable: {e!r}")
            _DOC = {}
    return _DOC


def usage_for(item_id: str | None) -> tuple[list[dict[str, str]], bool]:
    """([{ko,en,ru,zh}, ...], 이벤트 아이템인가). 표에 없으면 ([], False)."""
    if not item_id:
        return [], False
    ent = _items().get(item_id)
    if not isinstance(ent, dict):
        return [], False
    uses = []
    for u in ent.get("uses") or []:
        if isinstance(u, dict) and u.get("en"):
            uses.append({k: str(u.get(k) or u["en"]) for k in LANGS})
    return uses, bool(ent.get("event"))


def ids() -> list[str]:
    return sorted(_items().keys())
