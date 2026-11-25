"""스토리(메인 퀘스트) 진행 추정 — 게임 출력 로그의 경고 줄로.

게임은 스토리 단계를 알림 로그에 남기지 않는다. 대신 출력 로그(output_*.log)에 퀘스트 조건을 평가할 때마다
    <b>Quest.</b> Can't find condition for target <하위 퀘스트 id> quest id: <챕터 퀘스트 id>
가 찍힌다 — 챕터 퀘스트가 완료 조건으로 참조하는 하위 퀘스트 중 **아직 프로필에 없는 것** 전부. 2026-11-03 사용자 로그 실측:
  · 챕터가 경고에 나오기 시작한 때 = 그 챕터를 시작한 때(바티야: 02:05:12 묶음부터, 33개)
  · 한 묶음에 적힌 그 챕터의 대상 = 그 시점에 아직 안 받은 하위 퀘스트 전체(그 챕터를 언급하는 묶음은 완전하다;
    1~4개짜리 작은 묶음은 다른 상인 퀘스트의 조건 평가)
  · 묶음은 프로필을 읽을 때(접속·레이드 끝)마다 찍힌다 → 레이드 직후 바뀐 것이 바로 보인다(02:14:43 묶음에서 투어 4→1, 바티야 33→32)
  · 전에 있다가 사라진 것 = 그 뒤에 받은 것(진행 중이거나 완료 — 둘은 구분 못 함)
함정: 와이프·프레스티지·게임 패치(1.2.5→1.3.0) 뒤엔 하위 구성이 달라져 옛 세션과 비교하면 틀린다 → 같은 게임 버전(폴더 이름의 버전)
세션끼리만 비교하고, 받았다고 본 것이 다시 '안 받음'으로 나타나면(리셋) 그 챕터 기록을 비운다.

읽기만 한다. 폴더마다 한 번 훑어 묶음을 캐시(파일 크기 바뀐 최신 폴더만 다시).
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("story_progress")

_LINE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d+\|.*Can't find condition for target ([0-9a-f]{24}) quest id: ([0-9a-f]{24})")
_CACHE_V = 2  # 11-24 묶음을 '같은 초' → '앞 줄과 1초 안'으로 바꿈
_FOLDER = re.compile(r"^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{1,2})-(\d{1,2})_(\S+)")


def _sec(ts: str) -> float:
    try:
        return time.mktime(time.strptime(ts, "%Y-%m-%d %H:%M:%S"))
    except (ValueError, OverflowError):
        return 0.0


def parse_output_log(text: str) -> list[tuple[str, dict[str, set[str]]]]:
    """로그 본문 → [(묶음 시각, {챕터 id: {하위 id…}})…]. 조건 평가 한 번에 찍힌 줄이 한 묶음 — 앞 경고 줄과 1초 안이면 같은 묶음.
    11-24 사용자 로그: 한 번의 평가가 초 경계에 걸쳐 둘로 갈라졌다(바티야 02:53:14 26개 + :15 6개 = 32, 보레아스 23:06:03 17 + :04 18 = 35).
    같은 초만 묶으면 앞 조각을 '그새 받음', 뒤 조각을 '다시 안 받음(리셋)'으로 읽어 그 챕터 진행 기록이 지워졌다."""
    blocks: list[tuple[str, dict[str, set[str]]]] = []
    last = -10.0
    for line in text.splitlines():
        m = _LINE.match(line)
        if not m:
            continue
        ts, target, chapter = m.group(1), m.group(2), m.group(3)
        sec = _sec(ts)
        if not blocks or sec - last > 1.0:
            blocks.append((ts, {}))
        last = sec
        blocks[-1][1].setdefault(chapter, set()).add(target)
    return blocks


def folder_meta(name: str) -> tuple[str, str]:
    """log_2026.11.03_1-39-48_1.3.0.0.48484 → ('2026-11-03 01:39:48', '1.3.0.0.48484'). 모르는 이름은 (이름, '')."""
    m = _FOLDER.match(name)
    if not m:
        return name, ""
    y, mo, d, h, mi, s, ver = m.groups()
    return f"{y}-{mo}-{d} {int(h):02d}:{int(mi):02d}:{int(s):02d}", ver


class StoryProgress:
    """폴더별 묶음 목록을 캐시해 두고 챕터별 진행을 낸다."""

    def __init__(self, cache_path: Optional[Path] = None) -> None:
        self._cache_path = cache_path
        self._folders: dict[str, dict] = {}  # 폴더 이름 → {"size": int, "blocks": [[ts, {챕터: [하위…]}]…]}
        self._load()

    def _load(self) -> None:
        if not self._cache_path or not self._cache_path.exists():
            return
        try:
            data = json.loads(self._cache_path.read_text(encoding="utf-8"))
            # 묶는 방식이 바뀐 판의 캐시는 버리고 다시 읽는다(크기가 같은 옛 폴더도 새 방식으로)
            self._folders = (data.get("folders") or {}) if data.get("v") == _CACHE_V else {}
        except Exception as e:  # noqa: BLE001
            log.warning(f"[story] 캐시 읽기 실패: {e}")
            self._folders = {}

    def _save(self) -> None:
        if not self._cache_path:
            return
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_text(json.dumps({"v": _CACHE_V, "folders": self._folders}, ensure_ascii=False), encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            log.warning(f"[story] 캐시 저장 실패: {e}")

    def scan(self, folders: list[Path]) -> None:
        """로그 폴더들을 훑어 캐시를 채운다. 파일 크기가 그대로면 다시 안 읽는다(출력 로그는 15MB까지 간다)."""
        changed = False
        for fo in folders:
            files = sorted(fo.glob("*output_*.log"))
            if not files:
                continue
            size = sum(f.stat().st_size for f in files)
            cur = self._folders.get(fo.name)
            if cur and cur.get("size") == size:
                continue
            blocks: list = []
            for f in files:
                try:
                    for ts, sets in parse_output_log(f.read_text(encoding="utf-8", errors="replace")):
                        blocks.append([ts, {k: sorted(v) for k, v in sets.items()}])
                except Exception as e:  # noqa: BLE001
                    log.warning(f"[story] 로그 읽기 실패 {f.name}: {e}")
            self._folders[fo.name] = {"size": size, "blocks": blocks}
            changed = True
        if changed:
            self._save()

    def progress(self, chapter_ids: dict[str, str]) -> dict[str, dict]:
        """chapter_ids = {챕터 퀘스트 id: 챕터 slug} → {slug: {"all": [...], "missing": [...], "entered": [{"id", "at"}…](받은 순), "since": 시작 시각}}.
        모든 세션을 묶음 순서대로 본다(게임 버전이 바뀐 뒤 구성이 달라진 챕터만 다시 셈 — 아래). 경고가 한 번도 없는 챕터(시작 안 함)는 빼놓는다."""
        metas = {n: folder_meta(n) for n in self._folders}
        names = sorted(self._folders, key=lambda n: metas[n][0])
        if not names:
            return {}
        want = set(chapter_ids)
        ever: dict[str, set[str]] = {}
        entered_at: dict[str, dict[str, str]] = {}
        since: dict[str, str] = {}
        prev: dict[str, set[str]] = {}
        # 11-24 게임 버전이 바뀌어도 이어서 본다 — 전엔 가장 새 버전 세션만 봐서 패치 전에 받은 하위 퀘스트가 사라졌다(사용자 로그:
        # 11-15 패치 전에 받은 '우연한 목격자' 2개·'보레아스' 3개가 지워져 네 챕터 모두 '받은 것 없음'). 대신 버전이 바뀐 뒤 그 챕터의
        # 첫 묶음에 전에 없던 하위가 나오면(패치로 구성이 달라졌거나 받은 것이 되살아남) 그 챕터만 처음부터 다시 센다.
        ver_changed: set[str] = set()
        cur_ver = None
        # 경고가 한 번이라도 있는 가장 새 게임 버전 세션에 나온 챕터만 낸다(7월 와이프 전처럼 오래전에만 나오고 끊긴 챕터는 끝냈거나
        # 지난 기록이다. 이어서 세게 바꾸자 사용자 로그에서 그런 챕터 5개가 '진행 중'으로 되살아났다). '경고가 있는' 버전으로 보는 것은
        # 11-25 실측: 1.3.5.0 패치 뒤 첫 접속은 경고가 1분 반 뒤에 찍혀 그 사이 추정이 통째로 비었기 때문
        latest_ver = next((metas[n][1] for n in reversed(names)
                           if any(ch in want for _ts, sets in self._folders[n].get("blocks", []) for ch in sets)), metas[names[-1]][1])
        seen_latest: set[str] = set()
        for n in names:
            if metas[n][1] != cur_ver:
                if cur_ver is not None:
                    ver_changed = set(prev)
                cur_ver = metas[n][1]
            for ts, sets in self._folders[n].get("blocks", []):
                for ch, lst in sets.items():
                    if ch not in want:
                        continue
                    s = set(lst)
                    if cur_ver == latest_ver:
                        seen_latest.add(ch)
                    if ch in ver_changed:
                        ver_changed.discard(ch)
                        if s - prev[ch]:
                            entered_at[ch] = {}
                            ever[ch] = set()
                            since[ch] = ts
                            del prev[ch]
                    if ch in prev:
                        if (s - prev[ch]) & set(entered_at.get(ch, {})):
                            # 받았다고 본 것이 다시 '안 받음'으로 → 리셋(와이프·프레스티지). 그 챕터 기록을 비운다
                            entered_at[ch] = {}
                            ever[ch] = set()
                            since[ch] = ts
                        for gone in sorted(prev[ch] - s):
                            entered_at.setdefault(ch, {}).setdefault(gone, ts)
                    else:
                        since.setdefault(ch, ts)
                    ever.setdefault(ch, set()).update(s)
                    prev[ch] = s
        out: dict[str, dict] = {}
        for qid, slug in chapter_ids.items():
            if qid not in ever or qid not in seen_latest:
                continue
            ent = [{"id": i, "at": t} for i, t in sorted(entered_at.get(qid, {}).items(), key=lambda x: (x[1], x[0]))]
            out[slug] = {"all": sorted(ever[qid]), "missing": sorted(prev.get(qid, set())), "entered": ent, "since": since.get(qid)}
        return out


_svc: Optional[StoryProgress] = None


def get_progress(folders: list[Path], chapter_ids: dict[str, str], cache_path: Optional[Path] = None) -> dict[str, dict]:
    """편의 함수 — 한 프로세스에 하나. 호출마다 폴더를 다시 보되 크기가 같으면 안 읽는다."""
    global _svc
    if _svc is None:
        _svc = StoryProgress(cache_path)
    _svc.scan(folders)
    return _svc.progress(chapter_ids)


def pick_auto(progress: dict[str, dict], recent: int = 2, has_marks: Optional[set[str]] = None) -> dict[str, list[str]]:
    """'자동' 모드가 지도에 낼 (챕터 slug → 하위 퀘스트 id 목록). 시작했고(경고 있음) 아직 안 받은 것이 남은 챕터만(진행 중),
    받은 것 중 최근 recent 개 — 완료/진행 중을 구분 못 하므로 최근 것이 진행 중일 가능성이 가장 높다.
    has_marks 를 주면 지도 목표가 있는 하위 퀘스트만 센다(대화·건네주기 단계는 지도에 낼 게 없어 건너뛴다).
    받은 것이 없는 챕터(방금 시작)는 빈 목록으로 넣어 '시작함'은 알린다."""
    out: dict[str, list[str]] = {}
    for slug, p in progress.items():
        if not p["missing"]:
            continue
        ids = [e["id"] for e in p["entered"]]
        if has_marks is not None:
            ids = [i for i in ids if i in has_marks]
        out[slug] = ids[-recent:]
    return out
