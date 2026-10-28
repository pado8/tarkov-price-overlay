"""퀘스트 한국어 보정 — tarkov.dev 한국어 표(tasks_ko)에 없어 영어로 남은 퀘스트 이름·목표 문장을
data/quest_ko.json(2026-10-28, 공식 문체 기준으로 직접 번역)으로 채운다.

규칙: 공식 표에 한글이 있는 항목은 절대 덮지 않는다(공식 번역이 생기면 자동으로 공식 우선).
사이드카(레이더 목록)와 가이드 사이트 빌더가 같은 표를 쓴다. 파일이 없거나 깨져도 조용히 빈 표.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_HANGUL = re.compile(r"[가-힣]")
_cache: dict | None = None


def _path() -> Path:
    base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
    return base / "data" / "quest_ko.json"


def table() -> dict:
    """{로케일 키: 한국어} — 이름·목표를 한 표로"""
    global _cache
    if _cache is None:
        try:
            d = json.loads(_path().read_text(encoding="utf-8"))
            _cache = {**(d.get("names") or {}), **(d.get("objectives") or {})}
        except Exception:
            _cache = {}
    return _cache


def overlay(loc: dict | None) -> dict:
    """한국어 로케일 표 위에 보정 표를 얹은 새 dict. 공식 값이 비었거나 한글이 하나도 없을 때만 바꾼다."""
    out = dict(loc or {})
    for k, v in table().items():
        cur = out.get(k)
        if not (isinstance(cur, str) and _HANGUL.search(cur)):
            out[k] = v
    return out
