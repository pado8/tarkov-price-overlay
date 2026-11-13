"""지금 게임에 있는 탈출구만 남기기 — 레이더(radar.py)가 tarkov.dev 지도 문서의 탈출구를 걸러낼 때 쓴다.

tarkov.dev 지도 문서엔 1.0 개편 전 탈출구(세관 Old Road Gate·Sniper Roadblock·Factory Shacks…, 해안선 Rock Passage…)가
그대로 남아 있고 그라운드 제로는 진영이 None 이다. 우리 표(data/extracts_ours.json, scripts/extracts_ours.py 로 생성 —
tarkov.dev 목록 + 우리 규칙 + 근거 적은 예외. 11-10 전엔 위키 Extractions 표였는데 CC BY-NC-SA 라 갈아냄)와
영어 이름으로 맞춰 ① 표에 없는 탈출구는 버리고 ② 진영은 표 값으로 바꾸고
③ 같은 탈출구가 PMC·스캐브 두 줄로 들어 있으면(표는 '모두' 하나) 호출 쪽이 정규 키로 하나만 남긴다.
표에 없는 맵은 손대지 않는다(새 맵 대비). 좌표는 tarkov.dev 것을 그대로 쓴다(위치가 안 바뀐 것만 남으므로).
매칭은 정규화 뒤 정확 일치 · 별칭 · 앞의 'The' 제거만 — 접두/부분 일치는 'Trailer Park Workers' Shack'이 'Trailer Park'에 붙는 식으로 틀린다.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Optional

# 정규화 이름 별칭(표 이름 ↔ 다른 곳에서 읽힌 이름). 우리 표는 tarkov.dev 이름 그대로라 지금은 비어 있음
ALIASES: dict[str, str] = {}


def _data_path(name: str = "extracts_ours.json") -> Path:
    base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
    return base / "data" / name


_cache: Optional[dict] = None


def table() -> dict:
    """{slug: {정규화 이름: faction}} · 자료가 없으면 빈 dict(필터 안 함)."""
    global _cache
    if _cache is None:
        try:
            raw = json.loads(_data_path().read_text(encoding="utf-8"))
            _cache = {slug: {norm(r["name"]): r.get("faction") for r in rows} for slug, rows in (raw.get("maps") or {}).items()}
        except Exception:  # noqa: BLE001
            _cache = {}
    return _cache


def norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("co-op", "coop"))


def lookup(map_slug: str, en_name: Optional[str]) -> tuple[bool, Optional[str], str]:
    """(지금 있는 탈출구인가, 위키 기준 진영 또는 None, 정규 키). 맵이 표에 없으면 (True, None, '') — 걸러내지 않음."""
    rows = table().get(map_slug or "")
    if not rows:
        return True, None, ""
    k = norm(en_name)
    if not k:
        return False, None, ""
    for cand in (k, ALIASES.get(k, ""), k[3:] if k.startswith("the") else ""):
        if cand and cand in rows:
            return True, rows[cand], cand
    return False, None, ""
