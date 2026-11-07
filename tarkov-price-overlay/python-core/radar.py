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
import quest_ko
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

# ── 레이드 진영(PMC/스캐브, 11-07) ────────────────────────────────
# 로그인 때 고른 본 캐릭터(PMC) 프로필이 'PrepareSelectedProfileLocally/CompleteSelectedProfile ProfileId:<id>'(옛 버전 'SelectProfile') 로,
# 레이드 시작이 'NetworkGameCreate profileStatus: 'Profileid: <id>' 로 남는다. 스캐브 레이드는 스캐브 프로필(다른 id)로
# 들어간다 → 같으면 PMC, 다르면 스캐브. 11-07 이 PC 로그로 확인: 사용자가 스캐브만 뛴 최근 레이드 4번 = 본 프로필과 다른 id,
# 2~7월 PVE 레이드 376번이 두 id(본 203·다른 173)로 갈림. 프로필 id 는 판정에만 쓰고 어디에도 내보내지 않는다.
SIDE_SEL_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)[^|]*\|.*?(?:PrepareSelectedProfileLocally|CompleteSelectedProfile|SelectProfile) ProfileId:([0-9a-f]{24})")
SIDE_RAID_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)[^|]*\|.*?NetworkGameCreate profileStatus: 'Profileid: ([0-9a-f]{24})")


def parse_side_lines(text: str) -> list[tuple[float, str, str]]:
    """application 로그 본문 → [(epoch 초, 'sel'|'raid', 프로필 id)]"""
    out = []
    for line in text.splitlines():
        if "ProfileId:" not in line and "profileStatus" not in line:
            continue
        m = SIDE_SEL_RE.match(line)
        kind = "sel"
        if not m:
            m = SIDE_RAID_RE.match(line)
            kind = "raid"
        if not m:
            continue
        try:
            ts = time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))
        except ValueError:
            continue
        out.append((ts, kind, m.group(2)))
    return out


def raid_side_at(evs: list[tuple[float, str, str]], shot_ts: float) -> Optional[str]:
    """스크린샷 시각의 레이드가 'pmc'|'scav'. 레이드 시작 기록·그 전 본 프로필 기록이 없거나 너무 오래됐으면 None."""
    raid = None
    for ev in evs:
        if ev[1] == "raid" and ev[0] <= shot_ts + 5 and (raid is None or ev[0] >= raid[0]):
            raid = ev
    if not raid or shot_ts - raid[0] > MAX_RAID_AGE_SEC:
        return None
    sel = None
    for ev in evs:
        if ev[1] == "sel" and ev[0] <= raid[0] and (sel is None or ev[0] >= sel[0]):
            sel = ev
    if not sel:
        return None
    return "pmc" if sel[2] == raid[2] else "scav"


def map_event_at(events: list[tuple[float, str, str]], shot_ts: float) -> Optional[tuple[float, str, str]]:
    """스크린샷 시각에 열려 있던 맵의 로딩 사건 (시각, preset, slug) — 시각 = 이번 레이드를 가르는 열쇠(내 탈출구 기억용)."""
    best = None
    for ev in events:
        if ev[0] <= shot_ts + 5 and (best is None or ev[0] >= best[0]):
            best = ev
    if not best or shot_ts - best[0] > MAX_RAID_AGE_SEC:
        return None
    return best


def map_at(events: list[tuple[float, str, str]], shot_ts: float) -> tuple[Optional[str], Optional[str]]:
    """스크린샷 시각에 열려 있던 맵 (slug, preset). 스크린샷보다 늦은 로딩은 무시(5초 여유)."""
    best = map_event_at(events, shot_ts)
    if not best:
        return None, None
    return (best[2] or None), best[1]


# ── 내 탈출구(11-06) ─────────────────────────────────────────────
# 사용자: '탈출구 목록(O)을 연 채 스크린샷을 찍으면 거기 있는 탈출구만 지도에'. 게임은 레이드마다 쓸 수 있는 탈출구가
# 정해져 있고 목록 창 오른쪽 위에 이름이 찍힌다(한국어 클라이언트도 탈출구 이름은 영어 원문 — 11-06 실사진 확인).
# 오른쪽 위의 라임 초록 띠(목록 머리·'탈출구에 머무르십시오')를 픽셀로 먼저 가려(실사진: 띠 있음 0.09+, 없음 ≤0.0013)
# 그 사진만 영어 OCR → 이 맵 탈출구 영어 이름과 맞춘다. 탈출구 안에 서 있을 때 띠는 탈출구 하나만 보이므로 2개 이상
# 맞았을 때만 목록으로 인정하고, 같은 레이드 안에서 여러 번 읽으면 합친다.
EXFIL_GREEN_MIN = 0.02


def exfil_banner(path: Path) -> bool:
    import numpy as np
    from PIL import Image

    im = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    h, w, _ = im.shape
    c = im[: int(h * 0.25), int(w * 0.55):]
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    m = (g > 150) & (g - r > 25) & (g - b > 70) & (r > 90)
    return float(m.mean()) >= EXFIL_GREEN_MIN


def read_exfil_lines(path: Path) -> list[str]:
    import numpy as np
    from PIL import Image

    import ocr

    im = Image.open(path).convert("RGB")
    w, h = im.size
    crop = np.asarray(im.crop((int(w * 0.55), 0, w, int(h * 0.5))))
    res = ocr._get_reader(("en",)).readtext(crop, detail=1, paragraph=False)
    return [t for _, t, conf in res if conf > 0.2]


def match_exfils(lines: list[str], names: list[str]) -> set[str]:
    """OCR 줄 → 맞는 탈출구 영어 이름들. 줄 앞의 번호('게임종료01' → 숫자 찌꺼기)는 무시하고 이름이 들어 있으면 맞춤,
    아니면 비슷한 이름(0.8 이상)."""
    import difflib

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

    keys = {norm(n): n for n in names if n and len(norm(n)) >= 4}
    out: set[str] = set()
    for ln in lines:
        l = norm(ln)
        hit = [n for k, n in keys.items() if k in l]
        if not hit:
            tail = re.sub(r"^[0-9 ]+", "", l)
            m = difflib.get_close_matches(tail, list(keys), n=1, cutoff=0.8)
            hit = [keys[m[0]]] if m else []
        out.update(hit)
    return out


def exfil_names(slug: str) -> list[str]:
    """이 맵 탈출구의 영어 원문 이름(지도 문서 extracts[].en 과 같은 값)."""
    maps_doc = (_doc("regular/maps") or {}).get("maps") or {}
    loc_en = _doc("regular/maps_en") or {}
    for m in maps_doc.values():
        if m.get("normalizedName") == slug:
            return [_loc(loc_en, ex.get("name"), ex.get("name")) for ex in m.get("extracts") or []]
    return []


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
        self._files: dict[str, tuple[int, list, list]] = {}

    def _read(self, folders: list[Path]) -> list[tuple[list, list]]:
        out = []
        for f in folders:
            for lf in f.glob("*application*.log"):
                try:
                    size = lf.stat().st_size
                except OSError:
                    continue
                key = str(lf)
                hit = self._files.get(key)
                if not (hit and hit[0] == size):
                    try:
                        text = lf.read_text(encoding="utf-8", errors="ignore")
                        hit = (size, parse_preset_lines(text), parse_side_lines(text))
                    except OSError:
                        hit = (size, [], [])
                    self._files[key] = hit
                out.append((hit[1], hit[2]))
        return out

    def events(self, folders: list[Path]) -> list[tuple[float, str, str]]:
        return sorted(e for evs, _ in self._read(folders) for e in evs)

    def sides(self, folders: list[Path]) -> list[tuple[float, str, str]]:
        """[(시각, 'sel'|'raid', 프로필 id)] — 레이드 진영 판정용(raid_side_at)"""
        return sorted(e for _, sd in self._read(folders) for e in sd)


# ── tarkov.dev 데이터 ─────────────────────────────────────────────
_DATA_TTL = 6 * 3600
_data_lock = threading.Lock()
_data: dict[str, tuple[float, object]] = {}


# 11-08: 메모리 캐시만 있어 앱을 켤 때마다 첫 지도가 문서(지도 9MB·퀘스트·로케일)를 다시 받느라 ~5초 걸렸다(실측 4.8초).
# 받은 문서를 상태 폴더 mapdata/ 에 gzip 으로 두고, 다음 실행부터는 7일 안의 디스크 사본을 바로 쓴다.
# 6시간(_DATA_TTL)이 지난 사본이면 그대로 쓰면서 뒤에서 새로 받는다(같은 문서는 한 번에 하나만).
_DOC_DISK_MAX_AGE = 7 * 24 * 3600
_doc_refreshing: set[str] = set()


def _doc_file(path: str) -> Path:
    from quest_tracker import _state_dir  # 순환 import 방지

    return _state_dir() / "mapdata" / (path.replace("/", "__") + ".json.gz")


def _doc_fetch(path: str):
    import gzip

    import tarkov_json_fallback as tj  # 지연 import — 시험에서 네트워크 없이 모듈을 쓸 수 있게

    doc = (tj._get(path) or {}).get("data")
    if doc is not None:
        try:
            f = _doc_file(path)
            f.parent.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix(".tmp")
            tmp.write_bytes(gzip.compress(json.dumps(doc, ensure_ascii=False).encode("utf-8"), 5))
            os.replace(tmp, f)
        except Exception as e:  # noqa: BLE001 — 디스크 사본은 덤
            log.warning("mapdata save failed (%s): %r", path, e)
    return doc


def _doc_refresh_bg(path: str) -> None:
    with _data_lock:
        if path in _doc_refreshing:
            return
        _doc_refreshing.add(path)

    def run():
        try:
            doc = _doc_fetch(path)
            if doc is not None:
                with _data_lock:
                    _data[path] = (time.time(), doc)
        except Exception as e:  # noqa: BLE001 — 실패하면 디스크 사본을 계속 쓴다
            log.warning("mapdata refresh failed (%s): %r", path, e)
        finally:
            with _data_lock:
                _doc_refreshing.discard(path)

    threading.Thread(target=run, daemon=True, name="mapdata-refresh").start()


def _doc(path: str):
    """json.tarkov.dev 문서(data 부분). 메모리 6시간 → 디스크 사본(7일 안, 6시간 넘었으면 뒤에서 새로 받기) → 네트워크."""
    now = time.time()
    with _data_lock:
        hit = _data.get(path)
        if hit and now - hit[0] < _DATA_TTL:
            return hit[1]
    try:
        f = _doc_file(path)
        age = now - f.stat().st_mtime if f.exists() else None
    except Exception:  # noqa: BLE001
        f, age = None, None
    if f is not None and age is not None and age < _DOC_DISK_MAX_AGE:
        try:
            import gzip

            doc = json.loads(gzip.decompress(f.read_bytes()).decode("utf-8"))
            with _data_lock:
                _data[path] = (now, doc)
            if age >= _DATA_TTL:
                _doc_refresh_bg(path)
            return doc
        except Exception as e:  # noqa: BLE001 — 깨진 사본이면 네트워크로
            log.warning("mapdata load failed (%s): %r", path, e)
    doc = _doc_fetch(path)
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


_key_names_cache: dict[tuple, tuple[float, dict]] = {}


def quest_key_names(jmode: str, lang: str, tasks: dict) -> dict:
    """퀘스트 목표의 requiredKeys 에 나오는 아이템 id → 표시 이름(현재 언어 표, 없으면 영어 표, 그래도 없으면 짧은 이름).
    items 문서(5천 종)는 한 번만 훑고 결과(열쇠 100여 개)만 (모드, 언어)별로 6시간 캐시. 문서를 못 받으면 빈 dict(열쇠 표시만 빠진다)."""
    key = (jmode, lang)
    with _data_lock:
        hit = _key_names_cache.get(key)
        if hit and time.time() - hit[0] < _DATA_TTL:
            return hit[1]
    ids: set[str] = set()
    for t in (tasks or {}).values():
        for o in t.get("objectives") or []:
            for grp in o.get("requiredKeys") or []:
                ids.update(i for i in grp if isinstance(i, str))
    out: dict = {}
    if ids:
        try:
            items = (_doc(f"{jmode}/items") or {}).get("items") or {}
            loc = _doc(f"{jmode}/items_{lang}") or {}
            loc_en = loc if lang == "en" else (_doc(f"{jmode}/items_en") or {})
        except Exception as e:
            log.warning(f"[radar] 열쇠 이름 문서 로드 실패: {e}")
            items, loc, loc_en = {}, {}, {}
        for i in ids:
            it = items.get(i) or {}
            nm = _loc(loc, it.get("name")) or _loc(loc_en, it.get("name")) or _loc(loc, it.get("shortName")) or _loc(loc_en, it.get("shortName"))
            if nm:
                out[i] = nm
    with _data_lock:
        _key_names_cache[key] = (time.time(), out)
    return out


# 같은 지형을 쓰는 맵 변형 → 대표 맵(퀘스트 구역·스토리 위치·지도 그림이 대표 맵 기준으로 적혀 있다).
# build_targets·story_targets·map_image_meta 가 전부 이 표를 쓴다(11-03 리뷰: 세 곳 표가 달라 the-lab-dark 에서 상인 퀘스트가 빠졌음).
MAP_BASE = {"night-factory": "factory", "infected-factory": "factory", "ground-zero-21": "ground-zero",
            "the-lab-dark": "the-lab", "infected-lab": "the-lab"}
# 이벤트 변형(오염된 공장·연구소): tarkov.dev 에 맵 항목만 있고 탈출구 등 데이터가 비어 있다(11-04 확인: 탈출구 0).
# 같은 맵을 쓰는 이벤트라 지도 선택 목록에서는 빼고, 로그·수동 선택으로 들어오면 일반 맵 데이터로 통째로 대신한다.
EVENT_MAPS = {"infected-factory": "factory", "infected-lab": "the-lab"}

_STORY: Optional[dict] = None


def story_doc() -> dict:
    """스토리(메인 퀘스트) 챕터 목록과 목표 위치 — data/story_marks.json.
    위치 출처 = szepiz/tarkov-quest-data firstparty story-marks(CC0, 손으로 찍고 게임에서 확인, 2026-08-26). tarkov.dev 는
    스토리 챕터 데이터를 운영에 내지 않고(11-03 확인), 게임도 스토리 단계 진행을 로그에 남기지 않아 자동 감지가 안 된다 →
    사용자가 '진행 중인 챕터'를 고르면 그 챕터 목표만 지도에 낸다. 표시 이름은 tarkov.dev 번역표(챕터 = '<questId> name',
    목표 = 목표 id 키)로, 없으면 파일의 영어 문구."""
    global _STORY
    if _STORY is None:
        try:
            base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
            _STORY = json.loads((base / "data" / "story_marks.json").read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log.warning(f"[radar] 스토리 데이터 로드 실패: {e}")
            _STORY = {"chapters": [], "marks": []}
    return _STORY


def story_chapters(loc_tasks: dict) -> list[dict]:
    """지도 패널의 챕터 선택 목록 [{id, name}] — 순서는 스토리 순."""
    out = []
    for c in sorted(story_doc().get("chapters") or [], key=lambda c: c.get("order") or 0):
        out.append({"id": c["id"], "name": _loc(loc_tasks, f"{c.get('questId')} name", c.get("name") or c["id"])})
    return out


def story_auto_quests(game_mode: str = "regular") -> dict[str, list[str]]:
    """'자동' 모드: 게임 출력 로그 경고로 추정한 (챕터 → 최근 받은 하위 퀘스트 id)(story_progress 참고). 로그를 못 읽으면 빈 dict."""
    try:
        import quest_tracker as qt
        import story_progress
        tr = qt.get_tracker()
        inst = tr._effective_install_path()
        folders = qt._list_log_folders(inst) if inst else []
        if not folders:
            return {}
        ids = {c["questId"]: c["id"] for c in story_doc().get("chapters") or [] if c.get("questId")}
        prog = story_progress.get_progress(folders[-60:], ids, qt._state_dir() / "story_progress.json")
        has_marks = {m.get("quest") for m in story_doc().get("marks") or [] if m.get("quest")}
        return story_progress.pick_auto(prog, has_marks=has_marks)
    except Exception as e:  # noqa: BLE001
        log.warning(f"[radar] 스토리 자동 추정 실패: {e}")
        return {}


def story_targets(chapter: str, map_slug: str, pose: dict, loc_tasks: dict, auto: Optional[dict] = None) -> list[dict]:
    """고른 챕터(또는 'all'·'auto')의 목표 위치 → 퀘스트 대상과 같은 모양(kind='quest', story=챕터 id).
    'auto' 는 auto={챕터: [하위 퀘스트 id…]} 에 든 하위 퀘스트의 목표만. 구역(area)은 윤곽 점들의 중심 하나로.
    높이는 모르므로 내 높이와 같다고 본다(dy 0)."""
    if not chapter:
        return []
    if chapter == "auto" and not auto:
        return []
    base = MAP_BASE.get(map_slug, map_slug)
    names = {c["id"]: c for c in story_doc().get("chapters") or []}
    px, py, pz = pose["x"], pose["y"], pose["z"]
    hd = pose.get("heading")
    out: list[dict] = []
    seen: dict[tuple, dict] = {}  # (챕터, 반올림 x, z) → 이미 낸 대상: 같은 자리 목표(예: 쇄빙선 엔진실 3개)는 한 점으로, 목표 문구는 ' / '
    for m in story_doc().get("marks") or []:
        if chapter == "auto":
            if m.get("quest") not in set((auto or {}).get(m.get("chapter") or "", [])):
                continue
        elif chapter != "all" and m.get("chapter") != chapter:
            continue
        ch = names.get(m.get("chapter") or "", {})
        cname = _loc(loc_tasks, f"{ch.get('questId')} name", ch.get("name") or m.get("chapter") or "")
        desc = _loc(loc_tasks, m["id"], None) or m.get("en") or ""
        for g in m.get("points") or []:
            if g.get("map") != base or not g.get("pts"):
                continue
            pts = g["pts"]
            tx = sum(p[0] for p in pts) / len(pts)
            tz = sum(p[1] for p in pts) / len(pts)
            key = (m.get("chapter"), round(tx), round(tz))
            if key in seen:
                prev = seen[key]
                if desc and desc not in prev["objective"]:
                    prev["objective"] = f"{prev['objective']} / {desc}" if prev["objective"] else desc
                continue
            dist, rel = relative(px, pz, hd, tx, tz)
            tgt = {"kind": "quest", "name": cname, "dist": round(dist, 1), "rel": None if rel is None else round(rel, 1),
                   "dy": 0.0, "x": round(tx, 1), "y": round(py, 1), "z": round(tz, 1),
                   "objective": desc, "optional": False, "task": m["id"], "slug": None, "keys": None,
                   "story": m.get("chapter")}
            seen[key] = tgt
            out.append(tgt)
    return out


def all_tasks(tasks_doc: dict) -> dict:
    """퀘스트 문서의 상인 퀘스트 + 메인(스토리) 퀘스트 → {id: 퀘스트}.
    tarkov.dev 는 스토리 챕터를 이미 같은 모양(챕터별 tasks = 상인 퀘스트와 같은 필드)으로 만들지만 운영 데이터에서는
    'not ready for prime time' 이라며 지운다(tarkov-data-manager update-quests.mjs, 2026-11 확인). 그래서 지금은 지도에
    메인 퀘스트가 안 나온다(11-03 사용자 요청). 공개되면 바로 뜨도록 'story' 목록이 생기면 함께 읽는다. 상인 퀘스트와 id 가
    겹치면 상인 퀘스트가 이긴다."""
    out = dict((tasks_doc or {}).get("tasks") or {})
    for ch in (tasks_doc or {}).get("story") or []:
        for t in (ch or {}).get("tasks") or []:
            if isinstance(t, dict) and t.get("id") and t["id"] not in out:
                out[t["id"]] = t
    return out


def build_targets(maps_doc: dict, map_slug: str, loc_maps: dict, tasks: dict, loc_tasks: dict,
                  active: set[str], pose: dict, loc_en: Optional[dict] = None,
                  key_names: Optional[dict] = None) -> list[dict]:
    """맵의 탈출구·트랜짓·진행 중 퀘스트 목표 → 내 위치 기준 거리·상대 각도·높이 차."""
    maps = maps_doc or {}
    by_slug = {m.get("normalizedName"): (mid, m) for mid, m in maps.items()}
    if map_slug not in by_slug:
        return []
    mid, m = by_slug[map_slug]
    # 퀘스트 구역은 대표 맵 id로 적혀 있는 경우가 있다(야간 공장·21+ 등) → 같은 계열 id를 함께 본다
    base = MAP_BASE.get(map_slug, map_slug)
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
            keys: list[str] = []
            for grp in o.get("requiredKeys") or []:
                alts = [(key_names or {}).get(i) for i in grp if isinstance(i, str)]
                alts = [a for a in alts if a]
                if alts:
                    keys.append(" / ".join(alts))
            pts = [z.get("position") for z in o.get("zones") or [] if z.get("map") in ids]
            # 탈출 목표('차량 탈출구 이용하기' 등)는 구역 좌표가 없다 → exitName(탈출구 내부 이름)이 이 맵 탈출구와 맞으면 그 자리에
            # (11-04 인게임: 그라운드 제로 '불타는 바퀴' = Sandbox_VExit 가 진행 중인데 지도에 안 보였다. 데이터에 앞 공백 섞인 이름도 있음)
            exit_name = (o.get("exitName") or "").strip() if o.get("type") == "extract" else ""
            if exit_name and (not o.get("maps") or ids & set(o.get("maps") or [])):
                pts += [ex.get("position") for ex in m.get("extracts") or [] if (ex.get("name") or "").strip() == exit_name]
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
                add("quest", tname, p, objective=desc, optional=bool(o.get("optional")), task=tid,
                    slug=t.get("normalizedName") or None,  # 가이드 상세(/guide/quest/<slug>/) 바로가기용
                    keys=keys or None)  # 목표에 필요한 열쇠 이름(대체 열쇠는 " / " 로)
    out.sort(key=lambda r: r["dist"])
    return out


def boss_zones(m: dict, loc_maps: dict, loc_en: Optional[dict] = None) -> list:
    """맵의 보스 스폰 구역(tarkov.dev bosses[].spawnLocations) → 구역별로 합친 목록.
    [{name: 구역 이름, pts: [[x, z]…], bosses: [{name, chance}]}]. PMC(pmcBEAR/pmcUSEC)는 보스가 아니라 뺀다.
    구역 좌표가 비어 있으면 spawns 에서 같은 zoneName 의 점들로 채운다(세관 기숙사·주유소). 그래도 없으면 그 구역은 생략."""
    def ok(p):
        return isinstance(p, dict) and p.get("x") is not None and p.get("z") is not None
    by_zone: dict = {}
    for s in m.get("spawns") or []:
        zn = s.get("zoneName")
        if zn and ok(s.get("position")):
            by_zone.setdefault(zn, []).append([round(float(s["position"]["x"]), 1), round(float(s["position"]["z"]), 1)])
    zones: dict = {}
    for b in m.get("bosses") or []:
        mob = b.get("mob") or ""
        if not mob or mob.startswith("pmc") or mob in NON_BOSS_MOBS:
            continue
        bname = _loc(loc_maps, mob) or _loc(loc_en, mob) or mob
        chance = float(b.get("spawnChance") or 0)
        for sl in b.get("spawnLocations") or []:
            key = sl.get("spawnKey") or sl.get("name")
            if not key:
                continue
            pts = ([[round(float(p["x"]), 1), round(float(p["z"]), 1)] for p in sl.get("positions") or [] if ok(p)]
                   or by_zone.get(key) or [list(p) for p in BOSS_ANCHORS.get(m.get("normalizedName") or "", {}).get(key, [])])
            if not pts:
                continue
            en_name = _loc(loc_en, sl.get("name")) or sl.get("name") or ""
            # '아무 스캐브 스폰'(BotZone·ZoneSandbox): 맵의 스캐브 스폰 전부가 후보 → 상자로 그리면 지도 전체를 덮는다(그라운드 제로 64점, 공장).
            # 점은 중심 하나만 두고 anywhere 표시 → 프런트가 상자 대신 '맵 전역' 표식으로 그린다.
            anywhere = en_name.lower() == "any scav spawn" or key in ("BotZone", "ZoneSandbox")
            zname = _loc(loc_maps, sl.get("name")) or en_name or key
            if re.search(r"\d", zname) and " " not in zname:
                zname = ""  # '2BDPort28' 같은 내부 코드(터미널·쇄빙선)는 이름으로 안 보여 준다 → 보스 이름만
            z = zones.setdefault(key, {"name": zname, "pts": pts, "bosses": [], "anywhere": anywhere})
            if not any(x["name"] == bname for x in z["bosses"]):
                z["bosses"].append({"name": bname, "chance": round(chance * float(sl.get("chance") or 1), 2)})
    for map_slug, mob, en_name, keys in BOSS_EXTRA:
        if m.get("normalizedName") != map_slug:
            continue
        b = next((x for x in m.get("bosses") or [] if x.get("mob") == mob), None)
        pts = [p for k in keys for p in by_zone.get(k, [])]
        if not b or not pts:
            continue
        bname = _loc(loc_maps, mob) or _loc(loc_en, mob) or mob
        z = zones.setdefault(f"extra:{mob}:{en_name}", {"name": en_name, "pts": pts, "bosses": [], "anywhere": False})
        if not any(x["name"] == bname for x in z["bosses"]):
            z["bosses"].append({"name": bname, "chance": round(float(b.get("spawnChance") or 0), 2)})
    # 한 구역 이름 아래 점들이 지도 양 끝의 여러 무리로 갈라져 있는 경우가 있다(해안선 '온실' = 별장 4점 + 600m 떨어진 2점,
    # '기상 관측소' = 1km 떨어진 2무리, 삼림 제재소·폐허 마을, 리저브 K 건물). 지도는 구역을 점 전체를 감싸는 사각형으로
    # 그리므로 무리가 갈라지면 지도 절반을 덮는 상자가 됐다(11-03 사용자 지적). 어느 무리가 맞는지는 데이터로 가릴 수 없어
    # 점은 그대로 두고, BOSS_CLUSTER_M 안으로 이어지는 점끼리 묶어 무리마다 따로 낸다(이름·보스·확률은 같게).
    out = []
    for z in zones.values():
        z["bosses"].sort(key=lambda x: -x["chance"])
        if z.get("anywhere"):
            cx = sum(p[0] for p in z["pts"]) / len(z["pts"]); cz = sum(p[1] for p in z["pts"]) / len(z["pts"])
            out.append({**z, "pts": [[round(cx, 1), round(cz, 1)]]})
            continue
        for grp in _cluster_pts(z["pts"], BOSS_CLUSTER_M):
            out.append({**z, "pts": grp})
    return out


BOSS_CLUSTER_M = 150.0  # 보스 구역 점 묶기 거리(m) — 이보다 멀리 떨어진 점 무리는 다른 상자로

# tarkov.dev bosses[] 에 섞여 있지만 보스가 아닌 무리 — 보스 구역에 넣지 않는다(11-04 사용자 결정).
# 'pmc' 로 시작하는 것(pmcBEAR·pmcUSEC·pmcBotBlackDiv)은 위에서 따로 뺀다.
#   레이더(PmcBot) · 센트리(Sentry, 해안선 정문 망루) · 터미널 세력(blackDivision·vsRF·vsRFSniper) · 감염자(infected*, 감염 타길라는 보스라 남김)
# 로그(ROGUE_MOBS)도 보스 구역에선 빼고, 대신 위험 구역 레이어에 저격수처럼 조준점 표식으로 낸다(rogue_spots).
ROGUE_MOBS: set = {"exUsec", "exUsecFree", "ExUsec"}
NON_BOSS_MOBS: set = {"PmcBot", "Sentry", "blackDivision", "vsRF", "vsRFSniper",
                      "infectedScreamer", "infectedAssault", "infectedPmc"} | ROGUE_MOBS
ROGUE_CLUSTER_M = 40.0  # 로그 스폰 점 묶기 — 무리마다 표식 하나(저격수 표식처럼 점 하나씩)


def rogue_spots(m: dict, loc_maps: dict, loc_en: Optional[dict] = None) -> list:
    """맵의 로그 스폰(bosses[] 의 exUsec 계열) → 위험 구역 레이어용 조준점 [{name, type:'rogue', p:[x,y,z], outline:[]}].
    좌표는 spawnLocations.positions, 없으면 같은 zoneName 의 스폰 점. 40m 안 점끼리 묶어 무리 중심 하나. 확률은 그 구역 최대값."""
    def ok(p):
        return isinstance(p, dict) and p.get("x") is not None and p.get("z") is not None
    by_zone: dict = {}
    for s in m.get("spawns") or []:
        if s.get("zoneName") and ok(s.get("position")):
            q = s["position"]
            by_zone.setdefault(s["zoneName"], []).append([float(q["x"]), float(q.get("y") or 0), float(q["z"])])
    zones: dict = {}
    for b in m.get("bosses") or []:
        if (b.get("mob") or "") not in ROGUE_MOBS:
            continue
        rname = _loc(loc_maps, b["mob"]) or _loc(loc_en, b["mob"]) or "Rogue"
        for sl in b.get("spawnLocations") or []:
            key = sl.get("spawnKey") or sl.get("name")
            if not key:
                continue
            pts = [[float(p["x"]), float(p.get("y") or 0), float(p["z"])] for p in sl.get("positions") or [] if ok(p)] or by_zone.get(key) or []
            if not pts:
                continue
            zname = _loc(loc_maps, sl.get("name")) or _loc(loc_en, sl.get("name")) or sl.get("name") or ""
            if re.search(r"\d", zname) and " " not in zname:
                zname = ""
            z = zones.setdefault(key, {"rname": rname, "zname": zname, "pts": pts, "chance": 0.0})
            z["chance"] = max(z["chance"], float(b.get("spawnChance") or 0) * float(sl.get("chance") or 1))
    out = []
    for z in zones.values():
        for grp in _cluster_pts([[p[0], p[2], p[1]] for p in z["pts"]], ROGUE_CLUSTER_M):
            cx = sum(p[0] for p in grp) / len(grp); cz = sum(p[1] for p in grp) / len(grp); cy = sum(p[2] for p in grp) / len(grp)
            name = " · ".join(x for x in (z["rname"], z["zname"]) if x) + f" {round(z['chance'] * 100)}%"
            out.append({"name": name, "type": "rogue", "p": [round(cx, 1), round(cy, 1), round(cz, 1)], "outline": []})
    return out

# 원본(tarkov.dev)에 좌표도, 같은 이름의 스폰 점도 없어 통째로 빠지던 보스 구역(11-03 전 맵 점검).
# 같은 맵의 열쇠 문·탈출구 위치로 '대략의 자리'만 잡는다 — 점 1~2개라 지도는 윤곽 없이 배지만 그린다(구역 넓이는 모름).
#   세관 ZoneDormitory = 기숙사 방 열쇠 문 22개의 건물별 중심(2층 기숙사 x225~234·z134~160 / 3층 기숙사 x173~195·z149~184)
#   세관 ZoneGasStation = 'Gas station office/storage room key' 문 2개(새 주유소)
#   해안선 ZonePort(산차르) = 'Pier Boat' 탈출구
# 기준점을 못 찾은 구역(해안선 ZoneGateTowerRight·ZoneForestSpawn, 터미널·쇄빙선 내부 코드)은 그대로 생략.
BOSS_ANCHORS: dict = {
    "customs": {"ZoneDormitory": [(229.8, 145.3), (180.6, 167.1)], "ZoneGasStation": [(415.6, 37.1)]},
    "shoreline": {"ZonePort": [(-335.9, 564.1)]},
}

# 원본 bosses[].spawnLocations 에 아예 없는 스폰 장소(11-04, 사용자 지적 + 공식 위키 확인).
#   등대 군즈(Knight): 위키 Knight 문서 "At the water treatment plant in the north, and at the blue chalet" —
#   tarkov.dev 는 별장(Zone_Chalet)만 갖고 있다. 정수장 쪽 보스 범주 스폰 구역 셋의 점으로 채운다(확률은 같은 보스의 맵 확률).
# (맵, 보스 mob, 표시 이름, 스폰 zoneName 들)
BOSS_EXTRA: list = [
    ("lighthouse", "bossKnight", "Water Treatment Plant", ["Zone_TreatmentBeach", "Zone_TreatmentContainers", "Zone_TreatmentRocks"]),
]


def _cluster_pts(pts: list, th: float) -> list:
    """점들을 '거리 th 이내로 이어지면 같은 무리'(단일 연결)로 나눈다. 무리 순서·무리 안 점 순서는 입력 순서를 따른다."""
    n = len(pts)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            if math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) <= th:
                parent[find(j)] = find(i)
    groups: dict = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(pts[i])
    return sorted(groups.values(), key=lambda g: pts.index(g[0]))


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
        extracts.append({"name": _disp_name(loc_maps, loc_en, e.get("name")), "en": _loc(loc_en or {}, e.get("name"), e.get("name")),
                         "p": note(pt(e["position"])),
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
    # 저격 스캐브 자리: tarkov.dev 위험 구역(hazardType=sniper)은 맵 가장자리 저격 구역 위주라, 스폰 목록에만 있는
    # 저격 스캐브 자리(zoneName 에 'Snipe' — 해안선 요양원 북쪽 ZoneBunkeSniper 등, categories 에 sniper 가 빠진 경우가 많다)가
    # 지도에 아예 안 나왔다(11-03 사용자 지적: 해안선 마스터키 퀘스트 쪽 저격수 표시 없음). 같은 '저격수' 표시로 합친다.
    # 서로 25m 안의 점·기존 저격 구역에서 25m 안의 점은 하나로(같은 자리 겹침 방지).
    snipe_name = _loc(loc_maps, "ScavRole/Marksman") or _loc(loc_en, "ScavRole/Marksman") or "Sniper"
    snipe_pts = [h["p"] for h in hazards if h["type"] == "sniper" and h.get("p")]
    for s in m.get("spawns") or []:
        if not ok(s.get("position")):
            continue
        cats = [str(c).lower() for c in (s.get("categories") or [])]
        if "sniper" not in cats and "snipe" not in (s.get("zoneName") or "").lower():
            continue
        q = pt(s["position"])
        if any(math.hypot(q[0] - o[0], q[2] - o[2]) <= 25 for o in snipe_pts):
            continue
        snipe_pts.append(q)
        hazards.append({"name": snipe_name, "type": "sniper", "p": note(q), "outline": []})
    for h in rogue_spots(m, loc_maps, loc_en):  # 로그 = 저격수처럼 조준점(11-04 사용자 결정, 보스 구역에선 뺌)
        h["p"] = note(h["p"])
        hazards.append(h)
    locks = [{"p": note(pt(lk["position"])), "type": lk.get("lockType") or "door", "key": lk.get("key") or None}  # key = 여는 열쇠 아이템 id(시세 조회한 열쇠 강조용)
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
            "containers": containers, "spawns": spawns, "weapons": weapons, "switches": switches,
            "bosses": boss_zones(m, loc_maps, loc_en)}


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
    author = x.get("author") or "tarkov.dev"
    credit = "tarkov.dev (CC BY-NC-SA 4.0)" if author.lower() == "tarkov.dev" else f"{author} · tarkov.dev (CC BY-NC-SA 4.0)"
    # 그림을 까는 사각형: SVG 맵은 svgBounds 가 있으면 그것(tarkov.dev src/pages/map/index.jsx 와 같음). 11-07 피드백 #56 '지도 좌표가
    # 밀려 보임' 조사로 발견 — 리저브만 svgBounds([[289,-274],[-303,272]])가 bounds 와 달라 그림이 남북으로 19~28m 밀려 있었다.
    # 타일 맵은 bounds 그대로(_tile_plan 도 bounds 로 자른다).
    img_bounds = (x.get("svgBounds") if x.get("svg") else None) or x["bounds"]
    return {"url": f"/radar/mapimg?map={slug}", "rot": x.get("rot") or 0, "bounds": img_bounds, "transform": x["transform"],
            "credit": credit, "base": x.get("base"),
            "layers": [{k: v for k, v in l.items() if k != "tiles"} for l in x.get("layers") or []]}


# ── 타일 지도(11-04): SVG 가 없는 맵(연구소·미궁·쇄빙선)은 tarkov.dev 사이트가 Leaflet 타일 PNG 로 그린다.
# 좌표는 SVG 맵과 같은 식(CRS.Simple + transform, 확대 z 에서 화면 px = 투영 px × 2^z, 타일 하나 = tileSize px).
# 사이드카가 bounds 를 투영한 사각형만큼 타일을 받아 PNG 한 장으로 이어 붙여 캐시한다 → 프런트는 SVG 와 똑같이 그 사각형에 깐다.
_TILE_TARGET_PX = 2400  # 이어 붙인 그림의 긴 변 목표(px) — 이 근처가 되는 확대 단계를 고른다
_TILE_WORKERS = 6


def _tile_plan(x: dict) -> dict:
    """bounds 투영 사각형 → (확대 z, 타일 범위, 잘라낼 상자). 프런트 imageMatrix 와 같은 투영식."""
    t0, t1, t2, t3 = x["transform"]
    a = math.radians(x.get("rot") or 0)
    ca, sa = math.cos(a), math.sin(a)

    def proj(gx, gz):
        return t0 * (gx * ca - gz * sa) + t1, -t2 * (gx * sa + gz * ca) + t3
    (ax, ay), (bx, by) = proj(*x["bounds"][0]), proj(*x["bounds"][1])
    pxmin, pxmax, pymin, pymax = min(ax, bx), max(ax, bx), min(ay, by), max(ay, by)
    span = max(pxmax - pxmin, pymax - pymin)
    zmin, zmax = int(x.get("minZoom") or 0), int(x.get("maxZoom") or 5)
    z = max(zmin, min(zmax, round(math.log2(_TILE_TARGET_PX / span)) if span > 0 else zmax))  # 목표에 가장 가까운 단계(올림이면 3500px+로 무거워짐)
    s, ts = 2 ** z, int(x.get("tileSize") or 256)
    X0, X1 = math.floor(pxmin * s / ts), math.floor((pxmax * s - 1e-6) / ts)
    Y0, Y1 = math.floor(pymin * s / ts), math.floor((pymax * s - 1e-6) / ts)
    crop = (round(pxmin * s - X0 * ts), round(pymin * s - Y0 * ts), round(pxmax * s - X0 * ts), round(pymax * s - Y0 * ts))
    return {"z": z, "ts": ts, "X": (X0, X1), "Y": (Y0, Y1), "crop": crop}


def map_tile_png(slug: str, layer: Optional[str] = None) -> Optional[Path]:
    """타일 맵 그림 PNG(층마다 따로, 7일 캐시). layer = td_maps.json layers[].g(L0…) — 없으면 바탕 층. 타일 맵이 아니면 None."""
    map_image_meta(slug)  # _TD_MAPS 적재
    x = (_TD_MAPS or {}).get(_IMG_ALIAS.get(slug, slug))
    if not x or not x.get("tiles"):
        return None
    lay = next((l for l in x.get("layers") or [] if l.get("g") == layer and l.get("tiles")), None) if layer else None
    tpath = lay["tiles"] if lay else x["tiles"]
    from quest_tracker import _state_dir
    d = _state_dir() / "mapimg"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{_IMG_ALIAS.get(slug, slug)}{'-' + lay['g'] if lay else ''}.png"
    if f.exists() and f.stat().st_size > 1000 and time.time() - f.stat().st_mtime < _MAPIMG_TTL:
        return f
    try:
        import io
        from concurrent.futures import ThreadPoolExecutor

        import requests
        from PIL import Image
        p = _tile_plan(x)
        ts, z = p["ts"], p["z"]
        (X0, X1), (Y0, Y1) = p["X"], p["Y"]
        canvas = Image.new("RGBA", ((X1 - X0 + 1) * ts, (Y1 - Y0 + 1) * ts), (0, 0, 0, 0))
        sess = requests.Session()
        sess.headers["User-Agent"] = "tarkov-price-overlay radar"

        def fetch(xy):
            tx, ty = xy
            try:
                r = sess.get(tpath.replace("{z}", str(z)).replace("{x}", str(tx)).replace("{y}", str(ty)), timeout=30)
                if r.status_code != 200 or not r.content.startswith(b"\x89PNG"):
                    return xy, None  # 바깥 타일은 없다(투명으로 둔다)
                return xy, Image.open(io.BytesIO(r.content)).convert("RGBA")
            except Exception:  # noqa: BLE001
                return xy, None
        got = 0
        with ThreadPoolExecutor(_TILE_WORKERS) as ex:
            for (tx, ty), im in ex.map(fetch, [(tx, ty) for tx in range(X0, X1 + 1) for ty in range(Y0, Y1 + 1)]):
                if im is not None:
                    canvas.paste(im.resize((ts, ts)) if im.size != (ts, ts) else im, ((tx - X0) * ts, (ty - Y0) * ts))
                    got += 1
        if not got:
            raise ValueError("no tiles")
        canvas.crop(p["crop"]).save(f, "PNG", optimize=True)
        log.info(f"[radar] 타일 지도 {f.name}: z{z} 타일 {got}개")
        return f
    except Exception as e:  # noqa: BLE001 — 옛 캐시라도 있으면 그걸로
        log.warning(f"[radar] 타일 지도 실패 {slug}/{layer}: {e}")
        return f if f.exists() and f.stat().st_size > 1000 else None


def map_image_bytes(slug: str, layer: Optional[str] = None) -> Optional[tuple]:
    """지도 그림 (바이트, MIME). SVG 맵은 층 처리한 SVG, 타일 맵은 이어 붙인 PNG."""
    meta = map_image_meta(slug)
    if meta is None:
        return None
    x = (_TD_MAPS or {}).get(_IMG_ALIAS.get(slug, slug)) or {}
    if x.get("tiles"):
        allowed = {l["g"] for l in meta["layers"]}
        f = map_tile_png(slug, layer if layer in allowed else None)
        return (f.read_bytes(), "image/png") if f else None
    data = map_image_svg(slug, layer)
    return (data, "image/svg+xml") if data else None


_SVG_G_RE = re.compile(r"<g\b[^>]*\bid=\"([^\"]+)\"")


def style_svg_layers(svg: bytes, base: Optional[str], layer: Optional[str]) -> bytes:
    """SVG 에 <style> 을 넣어 층 그룹을 켜고 끈다(tarkov.dev 사이트와 같은 규칙).
    layer 없음: 바탕(base)과 data-keep-with-group=base 그룹만 · layer 있음: 바탕은 흐리게(0.35) + 그 층 그룹.
    base 를 모르면(그룹 id 없음) 원본 그대로."""
    if not base or b"<svg" not in svg[:4000]:
        return svg
    css = f'svg > g {{ display: none }} svg > g#{base}, svg > g[data-keep-with-group="{base}"] {{ display: inline }}'
    if layer and layer != base:
        css += f' svg > g#{base}, svg > g[data-keep-with-group="{base}"] {{ opacity: 0.35 }} svg > g#{layer} {{ display: inline; opacity: 1 }}'
    i = svg.find(b">", svg.find(b"<svg"))
    if i < 0:
        return svg
    return svg[: i + 1] + f"<style>{css}</style>".encode("utf-8") + svg[i + 1:]


def map_image_svg(slug: str, layer: Optional[str] = None) -> Optional[bytes]:
    """층 처리를 끝낸 SVG 바이트. layer 는 maps.json 의 svgLayer(그룹 id)만 받는다(아무 문자열이나 CSS 에 넣지 않게)."""
    f = map_image_file(slug)
    meta = map_image_meta(slug)
    if f is None or meta is None:
        return None
    allowed = {l["g"] for l in meta["layers"]}
    lay = layer if layer in allowed else None
    return style_svg_layers(f.read_bytes(), meta.get("base"), lay)


# 같은 그림을 쓰는 맵 변형(tarkov.dev 사이트는 대표 slug 하나만 가진다)
_IMG_ALIAS = MAP_BASE


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
    slug = EVENT_MAPS.get(slug, slug)
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
def _recycle(paths: list[str]) -> int:
    """파일들을 Windows 휴지통으로(SHFileOperationW, FOF_ALLOWUNDO). 성공한 개수 반환. 비윈도우/실패 = 0."""
    if not paths or os.name != "nt":
        return 0
    try:
        import ctypes
        from ctypes import wintypes

        class SHFILEOPSTRUCTW(ctypes.Structure):
            _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR),
                        ("pTo", wintypes.LPCWSTR), ("fFlags", ctypes.c_ushort),
                        ("fAnyOperationsAborted", wintypes.BOOL), ("hNameMappings", ctypes.c_void_p),
                        ("lpszProgressTitle", wintypes.LPCWSTR)]

        FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_SILENT, FOF_NOERRORUI = 3, 0x40, 0x10, 0x4, 0x400
        op = SHFILEOPSTRUCTW()
        op.wFunc = FO_DELETE
        op.pFrom = "\0".join(os.path.abspath(p) for p in paths) + "\0\0"   # 이중 NUL 종료 목록
        op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
        rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
        if rc != 0 or op.fAnyOperationsAborted:
            log.warning(f"[radar] 휴지통 보내기 실패 rc={rc}")
            return 0
        return sum(1 for p in paths if not os.path.exists(p))
    except Exception as e:
        log.warning(f"[radar] 휴지통 보내기 예외: {e}")
        return 0


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
        self._prune_keep: Optional[int] = None   # None=자동 정리 끔
        self._last_pruned_for: Optional[str] = None
        # 내 탈출구 — OCR 은 백그라운드 스레드(한 장 1.5~2초)라 상태 응답을 막지 않는다
        self._exfil_lock = threading.Lock()
        self._exfil_seen: set[str] = set()
        self._exfil_busy = False
        self._my_exits: Optional[dict] = None  # {"slug", "raid", "names": set[str]}
        self._load_settings()

    def _start_exfil_check(self, path: Path, slug: str, raid: Optional[float]) -> None:
        with self._exfil_lock:
            if self._exfil_busy or path.name in self._exfil_seen:
                return
            self._exfil_seen.add(path.name)
            self._exfil_busy = True

        def run() -> None:
            try:
                if not exfil_banner(path):
                    return
                got = match_exfils(read_exfil_lines(path), exfil_names(slug))
                log.info(f"[radar] 탈출구 목록 사진 {path.name}: {slug} 맞춤 {sorted(got)}")
                if len(got) < 2:
                    return  # 탈출구 안 '머무르십시오' 띠(하나만 보임) 등 — 목록으로 안 봄
                with self._exfil_lock:
                    cur = self._my_exits
                    if cur and cur["slug"] == slug and cur["raid"] == raid:
                        cur["names"] |= got
                    else:
                        self._my_exits = {"slug": slug, "raid": raid, "names": set(got)}
            except Exception as e:  # noqa: BLE001 — 사진·OCR 문제는 지도 전체를 막지 않는다
                log.warning(f"[radar] 탈출구 목록 읽기 실패: {e!r}")
                # 게임이 아직 PNG 를 쓰는 중(잘린 파일)일 수 있다 — 본 목록에서 빼 다음 확인 때 다시 읽는다(앱이 0.4초마다 묻는다)
                with self._exfil_lock:
                    self._exfil_seen.discard(path.name)
            finally:
                with self._exfil_lock:
                    self._exfil_busy = False

        threading.Thread(target=run, daemon=True, name="exfil-ocr").start()

    def my_exits(self, slug: Optional[str], raid: Optional[float]) -> Optional[list[str]]:
        with self._exfil_lock:
            me = self._my_exits
            if not me or not slug or me["slug"] != slug or (raid is not None and me["raid"] != raid):
                return None
            return sorted(me["names"])

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
            pk = d.get("prune_keep")
            self._prune_keep = int(pk) if isinstance(pk, int) and pk > 0 else None
        except FileNotFoundError:
            pass
        except Exception as e:
            log.warning(f"[radar] 설정 읽기 실패(무시): {e}")

    def _save_settings(self) -> None:
        try:
            import json
            _settings_path().write_text(
                json.dumps({"folder": str(self._folder_override) if self._folder_override else None,
                            "prune_keep": self._prune_keep}, ensure_ascii=False),
                encoding="utf-8")
        except Exception as e:
            log.warning(f"[radar] 설정 저장 실패: {e}")

    # ── 자동 정리: 좌표 스크린샷은 장당 5~7MB라 레이더용으로 F2를 누르다 보면 하루 1GB를 넘긴다 ──
    # 좌표 패턴 파일만, 최신 N장을 남기고, **휴지통으로**(영구 삭제 안 함 — 되돌릴 수 있게).
    def set_prune(self, keep: Optional[int]) -> dict:
        """keep=None/0 → 끔. 양수면 좌표 스크린샷을 최신 keep장만 남긴다."""
        k = int(keep) if keep else 0
        if k < 0:
            raise ValueError("keep은 0 이상")
        with self._lock:
            self._prune_keep = k or None
            self._save_settings()
        return {"prune_keep": self._prune_keep}

    def _prune(self, folder: Path) -> int:
        """최신 N장 밖의 좌표 스크린샷을 휴지통으로. 지운 개수 반환. 실패하면 0(절대 영구 삭제로 폴백하지 않음)."""
        keep = self._prune_keep
        if not keep:
            return 0
        try:
            shots = []
            with os.scandir(folder) as it:
                for ent in it:
                    n = ent.name
                    if n.lower().endswith(SHOT_EXT) and "]_" in n and parse_shot_name(n):
                        try:
                            shots.append((ent.stat().st_mtime, ent.path))
                        except OSError:
                            pass
        except OSError:
            return 0
        if len(shots) <= keep:
            return 0
        shots.sort()
        victims = [p for _, p in shots[:-keep]]
        done = _recycle(victims)
        if done:
            log.info(f"[radar] 좌표 스크린샷 {done}장 휴지통으로(최신 {keep}장 유지)")
        return done

    def folder_info(self) -> dict:
        """현재 쓰는 폴더와 출처. auto = 자동 탐색 결과(없으면 None)."""
        auto = screenshots_dir()
        cur = self._folder_override or auto
        return {"folder": str(cur) if cur else None,
                "source": "manual" if self._folder_override else "auto",
                "auto": str(auto) if auto else None,
                "ok": bool(cur and cur.is_dir()),
                "prune_keep": self._prune_keep}

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

    def key_locks(self, item_id: str, lang: str = "ko", game_mode: str = "regular") -> dict:
        """시세로 조회한 아이템이 열쇠면, 지금 맵에서 그 열쇠로 여는 잠긴 문·트렁크(가까운 순, 내 위치 기준 거리·방향).
        열쇠가 아니거나 맵을 모르면 locks 가 빈 목록. 카드 한 줄 + 지도 강조에 쓴다."""
        st = self.state(lang, game_mode)
        mp, shot = st.get("map"), st.get("shot")
        if not mp or not item_id:
            return {"map": mp, "locks": []}
        doc = map_features(mp["id"], lang) or {}
        out = []
        for lk in doc.get("locks") or []:
            if lk.get("key") != item_id:
                continue
            p = lk["p"]
            row = {"p": p, "type": lk.get("type") or "door", "dist": None, "rel": None, "dy": None}
            if shot:
                dist, rel = relative(shot["x"], shot["z"], shot.get("heading"), p[0], p[2])
                row.update({"dist": round(dist, 1), "rel": None if rel is None else round(rel, 1), "dy": round(p[1] - shot["y"], 1)})
            out.append(row)
        out.sort(key=lambda r: (r["dist"] is None, r["dist"] or 0))
        return {"map": mp, "locks": out}

    def state(self, lang: str = "ko", game_mode: str = "regular", map_override: Optional[str] = None,
              full: bool = False, story: Optional[str] = None) -> dict:
        with self._lock:
            folder = self._folder_override or screenshots_dir()
            res: dict = {"folder": str(folder) if folder else None,
                         "folder_source": "manual" if self._folder_override else "auto",
                         "shot": None, "map": None,
                         "map_source": None, "preset": None, "targets": [], "maps": []}
            shot = self._shots.latest(folder) if folder else None
            # 새 스크린샷이 들어올 때만 한 번 정리(1초 폴링마다 폴더를 다시 훑지 않게)
            if shot and self._prune_keep and shot["name"] != self._last_pruned_for:
                self._last_pruned_for = shot["name"]
                self._prune(folder)
            if shot:
                shot = dict(shot)
                shot["heading"] = heading_deg(shot["qx"], shot["qy"], shot["qz"], shot["qw"])
                res["shot"] = {"id": shot["name"], "ts": shot["ts"], "age": round(time.time() - shot["ts"], 1),
                               "x": shot["x"], "y": shot["y"], "z": shot["z"], "heading": shot["heading"]}
            # 맵: 수동 선택 > 로그
            slug = map_override or None
            source = "manual" if slug else None
            raid_ts: Optional[float] = None  # 이번 레이드 로딩 시각(로그) — 내 탈출구 기억 열쇠
            if not slug and shot:
                try:
                    import quest_tracker as qt
                    tr = qt.get_tracker()
                    inst = tr._effective_install_path()
                    folders = qt._list_log_folders(inst)[-3:] if inst else []
                    ev = map_event_at(self._logs.events(folders), shot["ts"])
                    slug, preset = ((ev[2] or None), ev[1]) if ev else (None, None)
                    raid_ts = ev[0] if ev else None
                    side = raid_side_at(self._logs.sides(folders), shot["ts"])
                    if side:
                        res["raid_side"] = side  # 11-07 이번 레이드 PMC/스캐브 — 앱이 탈출구 칩을 자동으로 맞춘다
                    if raid_ts is not None:
                        res["raid_ts"] = raid_ts
                    res["preset"] = preset
                    source = "log" if slug else None
                except Exception as e:  # 로그를 못 읽어도 레이더는 수동 선택으로 쓸 수 있다
                    log.warning(f"[radar] 로그 맵 판정 실패: {e}")
            if slug in EVENT_MAPS:  # 이벤트 변형은 데이터가 비어 있어 일반 맵으로(이름·대상·지도 전부)
                slug = EVENT_MAPS[slug]
            if shot and slug and folder:
                self._start_exfil_check(Path(folder) / shot["name"], slug, raid_ts)  # 탈출구 목록 사진이면 백그라운드 OCR
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
                 for mm in maps_doc.values()
                 if mm.get("normalizedName") != "ground-zero-tutorial" and mm.get("normalizedName") not in EVENT_MAPS),
                key=lambda x: x["name"] or "")
            try:
                loc_story = _doc(f"{jmode}/tasks_{lang}") or {}
                if lang == "ko":
                    loc_story = quest_ko.overlay(loc_story)
            except Exception:
                loc_story = {}
            res["story_chapters"] = story_chapters(loc_story)
            if slug:
                mm = next((x for x in maps_doc.values() if x.get("normalizedName") == slug), None)
                # rot = tarkov.dev 지도 그림 기준 기본 회전(coordinateRotation) — 지도 탭·고정 레이더가 그 지도와 같은 방향으로 보이게
                res["map"] = {"id": slug, "name": _loc(loc_maps, (mm or {}).get("name"), slug),
                              "rot": (map_image_meta(slug) or {}).get("rot", 0)}
                res["map_source"] = source
                mine = self.my_exits(slug, raid_ts)
                if mine:
                    res["my_exits"] = mine  # 이번 레이드 내 탈출구(영어 원문 이름) — 앱이 지도에서 이것만 보인다
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
                    if lang == "ko":
                        loc_tasks = quest_ko.overlay(loc_tasks)  # 영어로 남은 퀘스트 이름·목표를 한국어 보정 표로
                except Exception:
                    tasks_doc, loc_tasks = {}, {}
                try:
                    key_names = quest_key_names(jmode, lang, all_tasks(tasks_doc)) if active else {}
                except Exception:
                    key_names = {}
                res["targets"] = build_targets(maps_doc, slug, loc_maps, all_tasks(tasks_doc), loc_tasks,
                                               active, shot, loc_en=_doc("regular/maps_en") or {}, key_names=key_names)
                if story:
                    auto = story_auto_quests(game_mode) if story == "auto" else None
                    res["targets"] = sorted(res["targets"] + story_targets(story, slug, shot, loc_tasks, auto=auto), key=lambda r: r["dist"])
                    if story == "auto":
                        res["story_auto"] = sorted(auto or {})  # 추정된 진행 중 챕터(slug) — 화면 안내용
                res["active_quests"] = len(active)
            return res


_service: Optional[RadarService] = None


def get_service() -> RadarService:
    global _service
    if _service is None:
        _service = RadarService()
    return _service
