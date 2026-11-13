"""지도 자료 보내기(선택·기본 꺼짐) — 스크린샷 파일 이름의 좌표를 지도 기능 개발·개선(자체 지도 그리기)용으로 보낸다.

사용자가 동의 창(처음 지도 열 때 한 번)이나 설정에서 직접 켠 경우에만 앱이 부른다. 목적은 설정 화면에 그대로 적는다.
보내는 것 = 줄마다 '맵 프리셋|x, y, z_qx, qy, qz, qw' 뿐 — 친구용 스크립트(dev/map-trace/share, v2)와 같은 형식.
날짜·시각·이미지·로그 내용·설치 ID 는 보내지 않는다. 맵 판정(저장 시각 ↔ 게임 로그의 맵 로딩 시각)은 이 PC 안에서 끝낸다.
보낸 사람 구분은 설치 ID 와 무관한 익명 ID(처음 한 번 무작위로 만듦). '보낸 자료 지우기'를 하면 서버에서 지우고 새 익명 ID 로 바꾼다.
이미 보낸 줄은 해시로 기억해 다시 보내지 않는다. 받는 곳 = Cloudflare Worker aquapado-mapshare.
11-11 닫힘: 서버가 받기를 멈추면(Worker vars.CLOSED) 보내기 응답에 closed:true — 상태 파일에 'closed'(받은 시각)를 남기고
그 줄은 '보냄'으로 적지 않는다(다시 열리면 그대로 보냄). 닫힌 동안 자동 보내기는 보내는 간격마다 GET /status 만 보고, 열리면 표시를 지우고 다시 보낸다.
시험용: TPO_MAPSHARE_URL(받는 주소).
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter
from pathlib import Path
from typing import Callable, Optional

import radar

SHARE_URL = os.environ.get("TPO_MAPSHARE_URL") or "https://aquapado-mapshare.aquapado.workers.dev/mapshare"
STATUS_URL = urllib.parse.urljoin(SHARE_URL, "/status")  # {ok, closed} — 5분 캐시(Worker)
MIN_INTERVAL_SEC = 12 * 3600  # 자동 보내기 최소 간격(직접 '지금 보내기'는 무시) — 11-10 사용자 12→3시간, 11-13 사용자 '자료 많이 쌓였다(4일 161명·2.7만 줄)' → 다시 12시간(서버는 익명 ID 당 하루 20묶음까지)
MAX_LINES = 5000  # 한 번에 보내는 최대 줄 수 — 넘으면 다음 번에 이어서
TIMEOUT_SEC = 15

_lock = threading.Lock()


def _state_dir() -> Path:
    from quest_tracker import _state_dir as sd

    return sd()


def _state_path() -> Path:
    return _state_dir() / "map_share.json"


def load_state() -> dict:
    try:
        s = json.loads(_state_path().read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        s = {}
    if not s.get("anon_id"):
        s["anon_id"] = str(uuid.uuid4())
    s.setdefault("sent", [])
    s.setdefault("last_send", 0)
    s.setdefault("last_result", None)
    return s


def save_state(s: dict) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def _hash(line: str) -> str:
    return hashlib.sha1(line.encode("utf-8")).hexdigest()[:16]


def _events() -> list[tuple[float, str, str]]:
    """모든 로그 폴더의 맵 로딩 기록 — 파일 크기가 같으면 캐시(map_share_events.json)에서."""
    import quest_tracker as qt

    inst = qt.detect_install_path()
    folders = qt._list_log_folders(inst) if inst else []
    cpath = _state_dir() / "map_share_events.json"
    try:
        cache = json.loads(cpath.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        cache = {}
    fresh: dict = {}
    out: list[tuple[float, str, str]] = []
    for d in folders:
        for lf in d.glob("*application*.log"):
            try:
                size = lf.stat().st_size
            except OSError:
                continue
            hit = cache.get(str(lf))
            if hit and hit[0] == size:
                evs = hit[1]
            else:
                try:
                    evs = [list(e) for e in radar.parse_preset_lines(lf.read_text(encoding="utf-8", errors="ignore"))]
                except OSError:
                    evs = []
            fresh[str(lf)] = [size, evs]
            out.extend((e[0], e[1], e[2]) for e in evs)
    try:
        cpath.write_text(json.dumps(fresh), encoding="utf-8")
    except OSError:
        pass
    return sorted(out)


def build_lines(shots_dir: Optional[Path] = None, events: Optional[list] = None) -> list[str]:
    """스크린샷 폴더 → 보낼 줄 목록(정렬·중복 없음). 맵을 모르는 스크린샷(앞선 맵 로딩 기록이 없거나 2시간 넘음)은 뺀다.
    11-10: 1.3.1 첫 받기 1,807줄 중 135줄(7.5%)이 프리셋 칸이 빈 줄 — 여러 맵 좌표가 섞여 서버에서 맵을 정할 수 없어 지도에 못 쓴다.
    프리셋 이름은 있는데 모르는 맵(새 맵·변형)은 그대로 보낸다."""
    shots_dir = shots_dir if shots_dir is not None else radar.screenshots_dir()
    if not shots_dir or not Path(shots_dir).is_dir():
        return []
    shots = []
    for p in Path(shots_dir).iterdir():
        if p.suffix.lower() not in radar.SHOT_EXT:
            continue
        m = radar.SHOT_RE.match(p.name)
        if not m:
            continue
        try:
            ts = p.stat().st_mtime
        except OSError:
            continue
        shots.append((ts, p.name[m.start("x"):m.end("qw")]))
    if not shots:
        return []
    evs = events if events is not None else _events()
    out = set()
    for ts, coords in shots:
        best = radar.map_event_at(evs, ts)
        if not best or not best[1]:
            continue
        out.add(f"{best[1]}|{coords}")
    return sorted(out)


def preview(lines: Optional[list[str]] = None) -> dict:
    """설정 화면 '보낼 내용 보기' — 새로 보낼 줄 수·맵별 수·앞 5줄·익명 ID."""
    with _lock:
        s = load_state()
        save_state(s)  # 익명 ID 를 처음 만들었으면 남겨 둔다
    lines = build_lines() if lines is None else lines
    sent = set(s["sent"])
    new = [l for l in lines if _hash(l) not in sent]
    maps = Counter((l.split("|", 1)[0] or "?") for l in new)
    return {"anon_id": s["anon_id"], "total": len(lines), "new": len(new), "maps": dict(maps.most_common()),
            "sample": new[:5], "last_send": s["last_send"], "last_result": s["last_result"], "closed": bool(s.get("closed"))}


Http = Callable[[str, str, Optional[bytes]], tuple[int, dict]]


def _http(method: str, url: str, body: Optional[bytes]) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=body, method=method, headers={"Content-Type": "application/json", "User-Agent": "tarkov-price-overlay"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:  # noqa: BLE001
            return e.code, {}


def send(force: bool = False, lines: Optional[list[str]] = None, http: Http = _http, now: Optional[float] = None) -> dict:
    """새 줄만 보낸다. force=False(자동)면 MIN_INTERVAL_SEC 안에는 건너뛴다.
    서버가 닫혀 있으면(closed) 자동은 GET /status 만 — 아직 닫힘이면 건너뛰고, 열렸으면 표시를 지우고 보낸다(reopened)."""
    now = time.time() if now is None else now
    with _lock:
        s = load_state()
        if not force and now - float(s["last_send"] or 0) < MIN_INTERVAL_SEC:
            return {"ok": True, "skipped": "interval", "sent": 0}
    reopened = False
    if s.get("closed") and not force:
        try:
            status, j = http("GET", STATUS_URL, None)
        except Exception:  # noqa: BLE001 — 확인 실패는 닫힘 그대로(다음 간격에 다시)
            status, j = 0, {}
        with _lock:
            s = load_state()
            if status == 200 and j.get("closed") is False:
                s.pop("closed", None)
                reopened = True
            else:
                s["last_send"] = now
            save_state(s)
        if not reopened:
            return {"ok": True, "skipped": "closed", "sent": 0, "closed": True}
    lines = build_lines() if lines is None else lines
    sent = set(s["sent"])
    new = [l for l in lines if _hash(l) not in sent][:MAX_LINES]
    if not new:
        with _lock:
            s["last_send"] = now
            s["last_result"] = {"at": now, "ok": True, "sent": 0}
            save_state(s)
        return {"ok": True, "sent": 0, **({"reopened": True} if reopened else {})}
    body = json.dumps({"v": 2, "id": s["anon_id"], "shots": new}, ensure_ascii=False).encode("utf-8")
    try:
        status, j = http("POST", SHARE_URL, body)
    except Exception as e:  # noqa: BLE001 — 네트워크 실패는 다음 번에 다시
        status, j = 0, {"error": repr(e)}
    ok = status == 200 and bool(j.get("ok"))
    if ok and j.get("closed"):
        # 서버가 받지 않음(저장 안 함) — 줄은 '보냄'으로 적지 않고 닫힘만 남긴다
        with _lock:
            s = load_state()
            first = not s.get("closed")
            s["closed"] = s.get("closed") or now
            s["last_send"] = now
            s["last_result"] = {"at": now, "ok": True, "sent": 0, "closed": True}
            save_state(s)
        return {"ok": True, "sent": 0, "closed": True, **({"closed_new": True} if first else {})}
    with _lock:
        s = load_state()
        if ok:
            s.pop("closed", None)
            s["sent"] = sorted(set(s["sent"]) | {_hash(l) for l in new})
            s["last_send"] = now
        s["last_result"] = {"at": now, "ok": ok, "sent": len(new) if ok else 0, **({} if ok else {"error": j.get("error") or status})}
        save_state(s)
    return {"ok": ok, "sent": len(new) if ok else 0, **({} if ok else {"error": j.get("error") or status}), **({"reopened": True} if reopened else {})}


def forget(http: Http = _http) -> dict:
    """서버에서 이 익명 ID 로 보낸 자료를 지우고, 새 익명 ID·빈 기록으로 바꾼다."""
    with _lock:
        s = load_state()
    url = f"{SHARE_URL}?{urllib.parse.urlencode({'id': s['anon_id']})}"
    try:
        status, j = http("DELETE", url, None)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": repr(e)}
    if status != 200 or not j.get("ok"):
        return {"ok": False, "error": j.get("error") or status}
    with _lock:
        save_state({"anon_id": str(uuid.uuid4()), "sent": [], "last_send": 0, "last_result": None})
    return {"ok": True, "deleted": j.get("deleted", 0)}
