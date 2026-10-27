"""레이더(미니맵 1단계) — 게임 메모리를 읽지 않는다.

- 내 위치·방향: EFT가 스크린샷을 저장할 때 파일명에 적는 좌표와 회전값
  `2026-10-26[01-30]_30.24, 1.62, 21.55_0.00000, 0.97307, 0.00000, 0.23051_15.47 (0).png`
  (x, y, z / 쿼터니언 qx, qy, qz, qw / 속도). 그래서 위치는 사용자가 스크린샷을 찍을 때만 갱신된다.
- 현재 맵: 게임 application 로그의 `scene preset path:maps/<preset>.bundle` 줄(시각 포함).
- 표시할 대상: tarkov.dev 공개 데이터(MIT)의 탈출구·트랜짓 좌표 + 퀘스트 트래커가 아는
  '진행 중' 퀘스트의 목표 좌표(zones·possibleLocations).

방향은 '내가 바라보는 쪽 = 위'인 상대 각도로만 준다. 지도 북쪽 기준 방위는 맵마다 회전이 달라
잘못 알려 줄 위험이 있어 1단계에서는 쓰지 않는다.
"""
from __future__ import annotations

import logging
import math
import os
import re
import threading
import time
from pathlib import Path
from typing import Optional

import extract_conditions
import extract_current
import json
import sys

log = logging.getLogger("radar")

# ── 스크린샷 파일명 ───────────────────────────────────────────────
_NUM = r"-?\d+(?:\.\d+)?"
SHOT_RE = re.compile(
    rf"^(?P<date>\d{{4}}-\d{{2}}-\d{{2}})\[(?P<h>\d{{1,2}})-(?P<m>\d{{2}})\]_"
    rf"(?P<x>{_NUM}), (?P<y>{_NUM}), (?P<z>{_NUM})_"
    rf"(?P<qx>{_NUM}), (?P<qy>{_NUM}), (?P<qz>{_NUM}), (?P<qw>{_NUM})"
)
SHOT_EXT = (".png", ".jpg", ".jpeg", ".bmp")


def parse_shot_name(name: str) -> Optional[dict]:
    """파일명 → {x, y, z, qx, qy, qz, qw}. 좌표가 없는 스크린샷(메뉴 등)은 None."""
    m = SHOT_RE.match(name)
    if not m:
        return None
    try:
        return {k: float(m.group(k)) for k in ("x", "y", "z", "qx", "qy", "qz", "qw")}
    except ValueError:
        return None


def heading_deg(qx: float, qy: float, qz: float, qw: float) -> Optional[float]:
    """쿼터니언이 가리키는 앞 방향(+z 축 회전)을 수평면 각도로. 0 = +z, 90 = +x (Unity, y가 위).
    위아래를 거의 수직으로 보고 있으면 수평 방향이 정해지지 않아 None."""
    fx = 2.0 * (qx * qz + qw * qy)
    fz = 1.0 - 2.0 * (qx * qx + qy * qy)
    if math.hypot(fx, fz) < 1e-6:
        return None
    return (math.degrees(math.atan2(fx, fz)) + 360.0) % 360.0


def relative(px: float, pz: float, heading: Optional[float], tx: float, tz: float) -> tuple[float, Optional[float]]:
    """(수평 거리 m, 상대 각도). 상대 각도 0 = 정면, +90 = 오른쪽, -90 = 왼쪽, ±180 = 뒤.
    방향을 모르면 각도는 None."""
    dx, dz = tx - px, tz - pz
    dist = math.hypot(dx, dz)
    if heading is None:
        return dist, None
    bearing = math.degrees(math.atan2(dx, dz))
    rel = ((bearing - heading + 540.0) % 360.0) - 180.0
    return dist, rel


# ── 맵 판정 (게임 로그) ───────────────────────────────────────────
# 프리셋 이름 → tarkov.dev normalizedName. 원본 표는 karpitony/eft-where-am-i(MIT)의
# LogWatcherService를 참고했고, 이 PC 실로그(2026-10)로 city_preset·shopping_mall·
# customs_preset·factory_day_preset·sandbox_start_preset을 확인했다.
PRESET_MAP = {
    "customs_preset": "customs", "bigmap": "customs",
    "woods_preset": "woods", "woods": "woods",
    "shoreline_preset": "shoreline", "shoreline": "shoreline",
    "shopping_mall": "interchange", "interchange": "interchange",
    "rezerv_base_preset": "reserve", "rezervbase": "reserve",
    "lighthouse_preset": "lighthouse", "lighthouse": "lighthouse",
    "city_preset": "streets-of-tarkov", "tarkovstreets": "streets-of-tarkov",
    "factory_day_preset": "factory", "factory4_day": "factory",
    "factory_night_preset": "night-factory", "factory4_night": "night-factory",
    "sandbox_preset": "ground-zero", "sandbox_start_preset": "ground-zero", "sandbox": "ground-zero",
    "sandbox_high_preset": "ground-zero-21", "sandbox_high": "ground-zero-21",
    "laboratory_preset": "the-lab", "laboratory": "the-lab",
    "labyrinth_preset": "the-labyrinth", "labyrinth": "the-labyrinth",
}
# 처음 보는 프리셋은 이름에 든 단어로 추측한다(신규 맵·프리셋 이름 변경 대비).
_PRESET_HINTS = [("labyrinth", "the-labyrinth"), ("terminal", "terminal"), ("icebreaker", "icebreaker"),
                 ("laboratory", "the-lab"), ("lighthouse", "lighthouse"), ("shoreline", "shoreline"),
                 ("rezerv", "reserve"), ("woods", "woods"), ("customs", "customs"), ("city", "streets-of-tarkov"),
                 ("shopping", "interchange"), ("factory", "factory"), ("sandbox", "ground-zero")]
PRESET_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d+\|.*scene preset path:maps/([A-Za-z0-9_]+)\.bundle")


def map_from_preset(preset: str) -> Optional[str]:
    p = (preset or "").lower()
    if p in PRESET_MAP:
        return PRESET_MAP[p]
    for word, slug in _PRESET_HINTS:
        if word in p:
            return slug
    return None


def parse_preset_lines(text: str) -> list[tuple[float, str, str]]:
    """application 로그 본문 → [(epoch 초, 프리셋, 맵 slug 또는 '')]"""
    out = []
    for line in text.splitlines():
        if "scene preset path" not in line:
            continue
        m = PRESET_RE.match(line)
        if not m:
            continue
        try:
            ts = time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))  # 로그는 PC 현지 시각
        except ValueError:
            continue
        out.append((ts, m.group(2), map_from_preset(m.group(2)) or ""))
    return out


# 맵을 불러온 뒤 이보다 오래 지난 스크린샷은 다른 레이드일 수 있어 맵을 '모름'으로 둔다
MAX_RAID_AGE_SEC = 2 * 3600


def map_at(events: list[tuple[float, str, str]], shot_ts: float) -> tuple[Optional[str], Optional[str]]:
    """스크린샷 시각에 열려 있던 맵 (slug, preset). 스크린샷보다 늦은 로딩은 무시(5초 여유)."""
    best = None
    for ev in events:
        if ev[0] <= shot_ts + 5 and (best is None or ev[0] >= best[0]):
            best = ev
    if not best or shot_ts - best[0] > MAX_RAID_AGE_SEC:
        return None, None
    return (best[2] or None), best[1]


# ── 스크린샷 폴더 ─────────────────────────────────────────────────
def screenshots_dir() -> Optional[Path]:
    """문서 폴더는 OneDrive 등으로 옮겨져 있을 수 있어 셸 폴더 레지스트리부터 본다."""
    cands: list[Path] = []
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as k:
            val, _ = winreg.QueryValueEx(k, "Personal")
            cands.append(Path(os.path.expandvars(val)))
    except Exception:
        pass
    home = Path(os.path.expanduser("~"))
    cands.append(home / "Documents")
    if os.environ.get("OneDrive"):
        cands.append(Path(os.environ["OneDrive"]) / "Documents")
    for d in cands:
        p = d / "Escape from Tarkov" / "Screenshots"
        if p.is_dir():
            return p
    return None


class _ShotWatcher:
    """가장 최근 '좌표 스크린샷'. 폴더 수정 시각이 그대로면 다시 훑지 않는다(초당 폴링 대비)."""

    def __init__(self) -> None:
        self._dir_key = None
        self._latest: Optional[dict] = None

    def latest(self, folder: Path) -> Optional[dict]:
        try:
            st = folder.stat()
        except OSError:
            return None
        key = (str(folder), st.st_mtime_ns)
        if key == self._dir_key:
            return self._latest
        best = None
        try:
            with os.scandir(folder) as it:
                for ent in it:
                    n = ent.name
                    if not n.lower().endswith(SHOT_EXT) or "]_" not in n:
                        continue
                    try:
                        mt = ent.stat().st_mtime
                    except OSError:
                        continue
                    if best is None or mt > best[0]:
                        pose = parse_shot_name(n)
                        if pose:
                            best = (mt, n, pose)
        except OSError:
            return self._latest
        self._dir_key = key
        self._latest = None if best is None else {"ts": best[0], "name": best[1], **best[2]}
        return self._latest


class _LogMaps:
    """최근 로그 폴더들의 맵 로딩 기록. 파일 크기가 그대로면 다시 읽지 않는다."""

    def __init__(self) -> None:
        self._files: dict[str, tuple[int, list]] = {}

    def events(self, folders: list[Path]) -> list[tuple[float, str, str]]:
        out: list[tuple[float, str, str]] = []
        for f in folders:
            for lf in f.glob("*application*.log"):
                try:
                    size = lf.stat().st_size
                except OSError:
                    continue
                key = str(lf)
                hit = self._files.get(key)
                if hit and hit[0] == size:
                    out.extend(hit[1])
                    continue
                try:
                    evs = parse_preset_lines(lf.read_text(encoding="utf-8", errors="ignore"))
                except OSError:
                    evs = []
                self._files[key] = (size, evs)
                out.extend(evs)
        return sorted(out)


# ── tarkov.dev 데이터 ─────────────────────────────────────────────
_DATA_TTL = 6 * 3600
_data_lock = threading.Lock()
_data: dict[str, tuple[float, object]] = {}


def _doc(path: str):
    """json.tarkov.dev 문서(data 부분). 지도 문서가 9MB라 6시간 캐시."""
    now = time.time()
    with _data_lock:
        hit = _data.get(path)
        if hit and now - hit[0] < _DATA_TTL:
            return hit[1]
    import tarkov_json_fallback as tj  # 지연 import — 시험에서 네트워크 없이 모듈을 쓸 수 있게
    doc = (tj._get(path) or {}).get("data")
    with _data_lock:
        _data[path] = (now, doc)
    return doc


def _loc(table: dict, key, fallback=None):
    if key is None:
        return fallback
    v = (table or {}).get(key)
    return v.strip() if isinstance(v, str) and v.strip() else fallback


_HANGUL = re.compile(r"[가-힣]")


def _disp_name(loc_maps: dict, loc_en: Optional[dict], key) -> str:
    """탈출구 표시 이름. 한국어 로케일이 번역 없이 옛 영어 이름을 그대로 둔 경우('Warehouse 17'·'Scav checkpoint')가 있어,
    한글이 없는 문자열이면 영어 로케일(현재 이름)을 쓴다. 한글 번역('Klimov Street (조명탄 탈출구)')은 그대로."""
    ko = _loc(loc_maps, key, None)
    en = _loc(loc_en, key, None) if loc_en else None
    if ko and (_HANGUL.search(ko) or not en):
        return ko
    return en or ko or (key or "")


def _mode_doc(game_mode: str) -> str:
    """퀘스트 데이터를 받을 json 경로의 모드 — 시즌은 일반 퀘스트를 쓴다"""
    return "pve" if (game_mode or "").lower() == "pve" else "regular"


def build_targets(maps_doc: dict, map_slug: str, loc_maps: dict, tasks: dict, loc_tasks: dict,
                  active: set[str], pose: dict, loc_en: Optional[dict] = None) -> list[dict]:
    """맵의 탈출구·트랜짓·진행 중 퀘스트 목표 → 내 위치 기준 거리·상대 각도·높이 차."""
    maps = maps_doc or {}
    by_slug = {m.get("normalizedName"): (mid, m) for mid, m in maps.items()}
    if map_slug not in by_slug:
        return []
    mid, m = by_slug[map_slug]
    # 퀘스트 구역은 대표 맵 id로 적혀 있는 경우가 있다(야간 공장·21+ 등) → 같은 계열 id를 함께 본다
    base = {"night-factory": "factory", "ground-zero-21": "ground-zero"}.get(map_slug, map_slug)
    ids = {mid} | {i for i, mm in maps.items() if mm.get("normalizedName") in (base, map_slug)}
    px, py, pz = pose["x"], pose["y"], pose["z"]
    hd = pose.get("heading")
    out: list[dict] = []

    def add(kind, name, pos, **extra):
        if not isinstance(pos, dict) or pos.get("x") is None or pos.get("z") is None:
            return
        dist, rel = relative(px, pz, hd, float(pos["x"]), float(pos["z"]))
        dy = float(pos.get("y") or py) - py
        out.append({"kind": kind, "name": name, "dist": round(dist, 1),
                    "rel": None if rel is None else round(rel, 1), "dy": round(dy, 1),
                    # 전체 지도(2단계)가 같은 점을 찍을 수 있게 게임 좌표도 준다
                    "x": round(float(pos["x"]), 1), "y": round(float(pos.get("y") or py), 1), "z": round(float(pos["z"]), 1),
                    **extra})

    seen_ex: set[str] = set()
    for ex in m.get("extracts") or []:
        # 1.0 개편 때 없어진 탈출구는 tarkov.dev 문서에 그대로 남아 있다 → 위키 현재 표(extract_current)로 걸러내고 진영도 표 값으로.
        # PMC·스캐브 두 줄로 든 같은 탈출구(위키는 'All' 하나)는 하나만
        keep, wfac, wkey = extract_current.lookup(map_slug, _loc(loc_en, ex.get("name"), None)) if loc_en else (True, None, "")
        if not keep or (wkey and wkey in seen_ex):
            continue
        if wkey:
            seen_ex.add(wkey)
        fac = wfac or ex.get("faction") or "shared"
        # 조건은 위키 기준 표 — 데이터의 switches 는 맵 전체 스위치가 모든 탈출구에 붙어 있어 쓰면 틀린다
        tags, _text, _give = extract_conditions.conditions(map_slug, ex)
        add("extract", _disp_name(loc_maps, loc_en, ex.get("name")), ex.get("position"),
            faction=fac, switch="lever" in tags, paid="paid" in tags, cond=sorted(tags))
    for tr in m.get("transits") or []:
        dest = tr.get("map")
        dest_id = dest.get("id") if isinstance(dest, dict) else dest
        dest_name = _loc(loc_maps, (maps.get(dest_id) or {}).get("name"), None)
        add("transit", _loc(loc_maps, tr.get("description"), dest_name or "트랜짓"), tr.get("position"), dest=dest_name)

    for tid in active:
        t = tasks.get(tid)
        if not t:
            continue
        tname = _loc(loc_tasks, t.get("name"), t.get("name"))
        tname = re.sub(r"\s*\[(?:PVP|PVE) ZONE\]\s*$", "", tname or "")
        for o in t.get("objectives") or []:
            desc = _loc(loc_tasks, o.get("description"), None)
            if not desc or desc == o.get("description"):
                desc = ""
            pts = [z.get("position") for z in o.get("zones") or [] if z.get("map") in ids]
            for pl in o.get("possibleLocations") or []:
                if pl.get("map") in ids:
                    cand = [p for p in pl.get("positions") or [] if isinstance(p, dict)]
                    if cand:  # 후보 위치 여러 곳 → 가장 가까운 곳 하나
                        pts.append(min(cand, key=lambda p: math.hypot(p["x"] - px, p["z"] - pz)))
            seen = set()
            for p in pts:
                if not isinstance(p, dict):
                    continue
                k = (round(p.get("x", 0)), round(p.get("z", 0)))
                if k in seen:
                    continue
                seen.add(k)
                add("quest", tname, p, objective=desc, optional=bool(o.get("optional")), task=tid)
    out.sort(key=lambda r: r["dist"])
    return out


def compact_map_features(m: dict, loc_maps: dict, loc_en: Optional[dict] = None) -> dict:
    """맵 문서 하나 → 전체 지도(2단계)가 그릴 좌표만 추린 작은 문서.
    SVG 지도(CC BY-NC-SA·치트 금지 조항)는 쓰지 않고 tarkov.dev API 좌표(MIT 사이트 데이터)로만 그린다.
    점이 많은 것(상자·스폰)은 [x, y, z(, 종류)] 배열로 줄여 보낸다."""
    def pt(p):
        return [round(float(p["x"]), 1), round(float(p.get("y") or 0), 1), round(float(p["z"]), 1)]

    def ok(p):
        return isinstance(p, dict) and p.get("x") is not None and p.get("z") is not None

    def outline(o):
        return [[round(float(q["x"]), 1), round(float(q["z"]), 1)] for q in (o or []) if ok(q)]

    xs: list[float] = []
    zs: list[float] = []

    def note(p):
        xs.append(p[0]); zs.append(p[2]); return p

    extracts = []
    slug = m.get("normalizedName") or ""
    seen_ex: set[str] = set()
    for e in m.get("extracts") or []:
        if not ok(e.get("position")):
            continue
        keep, wfac, wkey = extract_current.lookup(slug, _loc(loc_en, e.get("name"), None)) if loc_en else (True, None, "")
        if not keep or (wkey and wkey in seen_ex):
            continue  # 개편 때 없어진 탈출구 · PMC/스캐브 중복
        if wkey:
            seen_ex.add(wkey)
        extracts.append({"name": _disp_name(loc_maps, loc_en, e.get("name")), "p": note(pt(e["position"])),
                         "faction": wfac or e.get("faction") or "shared",
                         "switch": "lever" in extract_conditions.conditions(m.get("normalizedName") or "", e)[0],
                         "outline": outline(e.get("outline"))})
    transits = []
    for t in m.get("transits") or []:
        if not ok(t.get("position")):
            continue
        transits.append({"name": _loc(loc_maps, t.get("description"), "transit"), "p": note(pt(t["position"])),
                         "outline": outline(t.get("outline"))})
    hazards = []
    for h in m.get("hazards") or []:
        ol = outline(h.get("outline"))
        if not ol and not ok(h.get("position")):
            continue
        hazards.append({"name": _loc(loc_maps, h.get("name"), h.get("hazardType") or "hazard"),
                        "type": h.get("hazardType") or "", "p": note(pt(h["position"])) if ok(h.get("position")) else None,
                        "outline": ol})
    locks = [{"p": note(pt(lk["position"])), "type": lk.get("lockType") or "door"}
             for lk in m.get("locks") or [] if ok(lk.get("position"))]
    containers = [note(pt(c["position"])) for c in m.get("lootContainers") or [] if ok(c.get("position"))]
    spawns = []
    for s in m.get("spawns") or []:
        if not ok(s.get("position")):
            continue
        cats = [str(c).lower() for c in (s.get("categories") or [])]
        sides = [str(c).lower() for c in (s.get("sides") or [])]
        code = "b" if "boss" in cats else "n" if "sniper" in cats else "p" if "pmc" in sides else "s" if "scav" in sides else "o"
        spawns.append(note(pt(s["position"])) + [code])
    weapons = [note(pt(w["position"])) for w in m.get("stationaryWeapons") or [] if ok(w.get("position"))]
    switches = [note(pt(w["position"])) for w in m.get("switches") or [] if ok(w.get("position"))]
    # 지도 그림(tarkov.dev SVG, CC BY-NC-SA 4.0) — 좌표 변환값은 data/td_maps.json(scripts/td_maps.py). bounds 는 좌표만의 경계(그림 경계는 img.bounds, '전체' 보기가 합친다)
    img = map_image_meta(slug)
    bounds = {"minx": min(xs), "maxx": max(xs), "minz": min(zs), "maxz": max(zs)} if xs else None
    return {"slug": m.get("normalizedName"), "name": _loc(loc_maps, m.get("name"), m.get("normalizedName")),
            "rot": m.get("coordinateToCardinalRotation"), "bounds": bounds, "img": img,
            "extracts": extracts, "transits": transits, "hazards": hazards, "locks": locks,
            "containers": containers, "spawns": spawns, "weapons": weapons, "switches": switches}


_TD_MAPS: Optional[dict] = None
_MAPIMG_TTL = 7 * 24 * 3600


def map_image_meta(slug: str) -> Optional[dict]:
    """맵의 지도 그림 메타 {url, rot, bounds, transform} — 그림 자체는 /radar/mapimg 가 사이드카 캐시로 준다."""
    global _TD_MAPS
    if _TD_MAPS is None:
        try:
            base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
            _TD_MAPS = (json.loads((base / "data" / "td_maps.json").read_text(encoding="utf-8")).get("maps") or {})
        except Exception:  # noqa: BLE001
            _TD_MAPS = {}
    x = _TD_MAPS.get(_IMG_ALIAS.get(slug, slug))
    if not x:
        return None
    return {"url": f"/radar/mapimg?map={slug}", "rot": x.get("rot") or 0, "bounds": x["bounds"], "transform": x["transform"],
            "credit": "tarkov.dev (CC BY-NC-SA 4.0)"}


# 같은 그림을 쓰는 맵 변형(tarkov.dev 사이트는 대표 slug 하나만 가진다)
_IMG_ALIAS = {"ground-zero-21": "ground-zero", "night-factory": "factory", "the-lab-dark": "the-lab"}


def map_image_file(slug: str) -> Optional[Path]:
    """지도 그림 SVG 파일(7일 캐시, %LOCALAPPDATA%\\TarkovPriceOverlay\\mapimg). 못 받으면 None."""
    meta = map_image_meta(slug)
    if not meta:
        return None
    from quest_tracker import _state_dir
    d = _state_dir() / "mapimg"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{slug}.svg"
    if f.exists() and f.stat().st_size > 1000 and time.time() - f.stat().st_mtime < _MAPIMG_TTL:
        return f
    try:
        import requests
        r = requests.get(_TD_MAPS[_IMG_ALIAS.get(slug, slug)]["svg"], timeout=60, headers={"User-Agent": "tarkov-price-overlay radar"})
        r.raise_for_status()
        if b"<svg" not in r.content[:4000]:
            raise ValueError("not svg")
        f.write_bytes(r.content)
        return f
    except Exception:  # noqa: BLE001 — 옛 캐시라도 있으면 그걸로
        return f if f.exists() and f.stat().st_size > 1000 else None


_map_cache: dict = {}


def map_features(slug: str, lang: str = "ko") -> Optional[dict]:
    """전체 지도용 정적 좌표 문서(맵·언어별 캐시). 없는 맵이면 None."""
    key = (slug, lang)
    with _data_lock:
        hit = _map_cache.get(key)
        if hit and time.time() - hit[0] < _DATA_TTL:
            return hit[1]
    maps = (_doc("regular/maps") or {}).get("maps") or {}
    m = next((x for x in maps.values() if x.get("normalizedName") == slug), None)
    if not m:
        return None
    loc_maps = _doc(f"regular/maps_{lang}") or _doc("regular/maps_en") or {}
    doc = compact_map_features(m, loc_maps, _doc("regular/maps_en") or {})
    with _data_lock:
        _map_cache[key] = (time.time(), doc)
    return doc


def _settings_path() -> Path:
    """사용자가 직접 고른 스크린샷 폴더 등 레이더 설정. 퀘스트 트래커와 같은 %LOCALAPPDATA%\\TarkovPriceOverlay."""
    from quest_tracker import _state_dir  # 순환 import 방지(quest_tracker는 radar를 모른다)
    return _state_dir() / "radar.json"


class RadarService:
    def __init__(self) -> None:
        self._shots = _ShotWatcher()
        self._logs = _LogMaps()
        self._lock = threading.Lock()
        self._folder_override: Optional[Path] = None
        self._load_settings()

    # ── 설정(스크린샷 폴더 직접 지정) ──
    def _load_settings(self) -> None:
        try:
            import json
            d = json.loads(_settings_path().read_text(encoding="utf-8"))
            f = d.get("folder")
            if f and Path(f).is_dir():
                self._folder_override = Path(f)
            elif f:
                log.warning(f"[radar] 저장된 스크린샷 폴더가 없어져 자동 탐색으로 돌아감: {f}")
        except FileNotFoundError:
            pass
        except Exception as e:
            log.warning(f"[radar] 설정 읽기 실패(무시): {e}")

    def _save_settings(self) -> None:
        try:
            import json
            _settings_path().write_text(
                json.dumps({"folder": str(self._folder_override) if self._folder_override else None}, ensure_ascii=False),
                encoding="utf-8")
        except Exception as e:
            log.warning(f"[radar] 설정 저장 실패: {e}")

    def folder_info(self) -> dict:
        """현재 쓰는 폴더와 출처. auto = 자동 탐색 결과(없으면 None)."""
        auto = screenshots_dir()
        cur = self._folder_override or auto
        return {"folder": str(cur) if cur else None,
                "source": "manual" if self._folder_override else "auto",
                "auto": str(auto) if auto else None,
                "ok": bool(cur and cur.is_dir())}

    def set_folder(self, path: str) -> dict:
        """빈 문자열이면 자동 탐색으로 되돌린다. 없는 폴더면 ValueError."""
        p = Path(path.strip().strip('"')).expanduser() if path and path.strip() else None
        if p is not None and not p.is_dir():
            raise ValueError(f"폴더가 없습니다: {p}")
        with self._lock:
            self._folder_override = p
            self._shots = _ShotWatcher()  # 폴더가 바뀌었으니 '마지막 샷' 캐시를 버린다
            self._save_settings()
        return self.folder_info()

    # 스크린샷이 이보다 오래됐으면(그리고 사용자가 레이더를 직접 연 게 아니면) 지도 데이터를 받지 않는다.
    # 앱이 1초마다 부르는데, 레이더를 안 쓰는 사용자까지 9MB 지도 문서를 받게 할 이유가 없다.
    FRESH_SEC = 15 * 60

    def state(self, lang: str = "ko", game_mode: str = "regular", map_override: Optional[str] = None,
              full: bool = False) -> dict:
        with self._lock:
            folder = self._folder_override or screenshots_dir()
            res: dict = {"folder": str(folder) if folder else None,
                         "folder_source": "manual" if self._folder_override else "auto",
                         "shot": None, "map": None,
                         "map_source": None, "preset": None, "targets": [], "maps": []}
            shot = self._shots.latest(folder) if folder else None
            if shot:
                shot = dict(shot)
                shot["heading"] = heading_deg(shot["qx"], shot["qy"], shot["qz"], shot["qw"])
                res["shot"] = {"id": shot["name"], "ts": shot["ts"], "age": round(time.time() - shot["ts"], 1),
                               "x": shot["x"], "y": shot["y"], "z": shot["z"], "heading": shot["heading"]}
            # 맵: 수동 선택 > 로그
            slug = map_override or None
            source = "manual" if slug else None
            if not slug and shot:
                try:
                    import quest_tracker as qt
                    tr = qt.get_tracker()
                    inst = tr._effective_install_path()
                    folders = qt._list_log_folders(inst)[-3:] if inst else []
                    slug, preset = map_at(self._logs.events(folders), shot["ts"])
                    res["preset"] = preset
                    source = "log" if slug else None
                except Exception as e:  # 로그를 못 읽어도 레이더는 수동 선택으로 쓸 수 있다
                    log.warning(f"[radar] 로그 맵 판정 실패: {e}")
            jmode = _mode_doc(game_mode)
            fresh = bool(shot) and (time.time() - shot["ts"]) < self.FRESH_SEC
            if not (full or fresh or map_override):
                res["light"] = True  # 가벼운 응답 — 새 스크린샷 감지용
                return res
            try:
                maps_doc = (_doc("regular/maps") or {}).get("maps") or {}
                loc_maps = _doc(f"regular/maps_{lang}") or _doc("regular/maps_en") or {}
            except Exception as e:
                res["error"] = f"지도 데이터를 받지 못했습니다: {e}"
                return res
            res["maps"] = sorted(
                ({"id": mm.get("normalizedName"), "name": _loc(loc_maps, mm.get("name"), mm.get("normalizedName"))}
                 for mm in maps_doc.values() if mm.get("normalizedName") != "ground-zero-tutorial"),
                key=lambda x: x["name"] or "")
            if slug:
                mm = next((x for x in maps_doc.values() if x.get("normalizedName") == slug), None)
                res["map"] = {"id": slug, "name": _loc(loc_maps, (mm or {}).get("name"), slug)}
                res["map_source"] = source
            if shot and slug:
                active: set[str] = set()
                try:
                    import quest_tracker as qt
                    st = qt.get_tracker().all_status(game_mode)  # 'regular'·'pve'·'pvp-season' 그대로 받는다
                    active = {qid for qid, s in st.items() if s == "started"}
                except Exception:
                    pass
                try:
                    tasks_doc = _doc(f"{jmode}/tasks") or {}
                    loc_tasks = _doc(f"{jmode}/tasks_{lang}") or {}
                except Exception:
                    tasks_doc, loc_tasks = {}, {}
                res["targets"] = build_targets(maps_doc, slug, loc_maps, tasks_doc.get("tasks") or {}, loc_tasks,
                                               active, shot, loc_en=_doc("regular/maps_en") or {})
                res["active_quests"] = len(active)
            return res


_service: Optional[RadarService] = None


def get_service() -> RadarService:
    global _service
    if _service is None:
        _service = RadarService()
    return _service
