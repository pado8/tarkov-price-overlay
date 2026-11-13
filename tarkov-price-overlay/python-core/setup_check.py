"""설치 점검(11-13): 처음 쓰는 사람이 막히는 곳을 앱이 먼저 알려 준다.

다른 도구들의 불만 대부분이 '안 됨·설정이 어려움'(스크린샷 키를 윈도우/스팀이 가로챔, 스팀판 경로·로그 폴더 못 찾음,
전체 화면이라 오버레이가 안 보임)이었다. 여기서는 이 PC 안의 폴더·파일·설정만 본다(밖으로 보내지 않음).
돌려주는 값: [{id, ok: True|False|None, n?, age_min?}] — ok None = 판단 못 함(참고만). 문구는 화면(i18n)이 붙인다.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

import radar

RECENT_OTHER_SEC = 24 * 3600  # 이 안에 좌표 없는 그림만 생겼으면 '다른 캡처 도구로 찍는 중'으로 본다


def _shots(folder: Optional[Path]) -> tuple[int, int, Optional[float], Optional[float]]:
    """(좌표가 붙은 스크린샷 수, 좌표 없는 그림 수, 가장 최근 좌표 스크린샷 시각, 가장 최근 좌표 없는 그림 시각)"""
    named = other = 0
    t_named: Optional[float] = None
    t_other: Optional[float] = None
    if not folder or not folder.is_dir():
        return 0, 0, None, None
    for p in folder.iterdir():
        if p.suffix.lower() not in radar.SHOT_EXT:
            continue
        try:
            ts = p.stat().st_mtime
        except OSError:
            continue
        if radar.SHOT_RE.match(p.name):
            named += 1
            t_named = ts if t_named is None or ts > t_named else t_named
        else:
            other += 1
            t_other = ts if t_other is None or ts > t_other else t_other
    return named, other, t_named, t_other


def check(folder_info: dict, now: Optional[float] = None) -> list[dict]:
    now = time.time() if now is None else now
    out: list[dict] = []
    folder = Path(folder_info["folder"]) if folder_info.get("folder") else None
    out.append({"id": "shots_folder", "ok": bool(folder and folder.is_dir())})
    named, other, t_named, t_other = _shots(folder)
    # 좌표 스크린샷이 하나도 없는데 좌표 없는 그림이 최근에 생겼으면 = 게임 스크린샷 키가 아닌 다른 도구로 찍고 있다
    wrong_tool = named == 0 and other > 0 and t_other is not None and now - t_other < RECENT_OTHER_SEC
    out.append({"id": "shots_named", "ok": named > 0, "n": named, "wrong_tool": wrong_tool,
                "age_min": None if t_named is None else int((now - t_named) / 60)})
    inst = None
    logs = 0
    try:
        import quest_tracker as qt
        inst = qt.detect_install_path()
        logs = len(qt._list_log_folders(inst)) if inst else 0
    except Exception:  # noqa: BLE001
        pass
    out.append({"id": "install", "ok": bool(inst), "steam": bool(inst and "steamapps" in str(inst).lower())})
    out.append({"id": "logs", "ok": logs > 0, "n": logs})
    mode = None
    try:
        p = Path(os.environ.get("APPDATA", "")) / "Battlestate Games" / "Escape from Tarkov" / "Settings" / "Graphics.ini"
        mode = ((json.loads(p.read_text(encoding="utf-8-sig")) or {}).get("DisplaySettings") or {}).get("FullScreenMode")
    except Exception:  # noqa: BLE001
        mode = None
    # FullScreenMode: 0 전체 화면(독점) · 1 테두리 없는 창 · 2 최대화 창 · 3 창 모드. 0 이면 오버레이가 게임 위에 안 보일 수 있다
    out.append({"id": "display", "ok": None if mode is None else mode != 0, "mode": mode})
    return out
