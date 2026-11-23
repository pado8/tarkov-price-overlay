"""11-23 손으로 표시한 '진행 중' 퀘스트(사용자 결정 — 로그가 생기기 전에 받은 퀘스트는 게임 로그로 진행 중을 알 수 없다).

앱(localStorage tarkov.manualQuestStarted)이 원본이고 엔진은 메모리에만 들고 있다 — 앱이 시작 때·바뀔 때·몇 분마다
POST /quests/manual-started 로 모드별 목록을 넘긴다. 지도(radar.py)·카드(main.py)·가이드 사이트(/progress)가 이 목록을
게임 로그의 '진행 중'에 더한다. 로그에 그 퀘스트의 완료·실패가 오면 radar 응답 manual_resolved 로 알려 앱이 지운다.
모드 이름은 게임 로그 추적기와 같다(pvp·pve·season).
"""
from __future__ import annotations

import re
import threading

MODES = ("pvp", "pve", "season")
_MAX_PER_MODE = 400
_ID_RE = re.compile(r"^[0-9A-Za-z_-]{1,64}$")

_lock = threading.Lock()
_by_mode: dict[str, set[str]] = {m: set() for m in MODES}


def set_all(by_mode: dict) -> None:
    """앱이 넘긴 모드별 목록으로 통째로 바꾼다(형식이 틀린 값은 버림)."""
    clean: dict[str, set[str]] = {m: set() for m in MODES}
    if isinstance(by_mode, dict):
        for m in MODES:
            ids = by_mode.get(m)
            if isinstance(ids, list):
                clean[m] = {i for i in ids if isinstance(i, str) and _ID_RE.match(i)}
                if len(clean[m]) > _MAX_PER_MODE:
                    clean[m] = set(sorted(clean[m])[:_MAX_PER_MODE])
    with _lock:
        _by_mode.clear()
        _by_mode.update(clean)


def get(mode: str) -> set[str]:
    """모드(pvp·pve·season)의 손 표시 목록 사본."""
    with _lock:
        return set(_by_mode.get(mode) or ())
