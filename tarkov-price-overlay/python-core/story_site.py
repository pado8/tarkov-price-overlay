"""가이드 사이트에서 체크한 메인 스토리 목표 (2026-11-10).

사이트 /guide/story/<챕터>/ 체크리스트가 POST /progress/story 로 체크된 목표 id 전체(모든 챕터)를 보낸다.
목표 id = data/story_marks.json 의 marks[].id (같은 원본) → 지도에서 끝낸 목표를 숨기는 데 쓴다.
게임은 스토리 진행을 로그에 남기지 않아(story_progress.py 는 '받은 하위 퀘스트'까지만 추정) 사용자가 직접 한 체크가 가장 정확하다.
이 PC 의 앱 상태 폴더에만 저장하고 어디에도 보내지 않는다.
"""
from __future__ import annotations

import json
import re
import time
from typing import Optional

_ID = re.compile(r"^[0-9a-f]{24}$")
_SLUG = re.compile(r"^[a-z0-9-]{2,40}$")
MAX_DONE = 600
RECENT_SEC = 7 * 24 * 3600  # '자동' 모드가 사이트가 보낸 챕터를 우선하는 기간
_cache: Optional[dict] = None


def _path():
    from quest_tracker import _state_dir

    return _state_dir() / "story_site.json"


def load() -> dict:
    """{"at": 초, "chapter": slug|None, "done": [id…]} — 없거나 깨졌으면 빈 값."""
    global _cache
    if _cache is None:
        try:
            d = json.loads(_path().read_text(encoding="utf-8"))
            _cache = {"at": float(d.get("at") or 0), "chapter": d.get("chapter") if _SLUG.match(str(d.get("chapter") or "")) else None,
                      "done": [i for i in d.get("done") or [] if _ID.match(str(i))][:MAX_DONE]}
        except Exception:  # noqa: BLE001
            _cache = {"at": 0.0, "chapter": None, "done": []}
    return _cache


def done_set() -> set[str]:
    return set(load()["done"])


def recent_chapter(now: Optional[float] = None) -> Optional[str]:
    d = load()
    if d["chapter"] and (now or time.time()) - d["at"] < RECENT_SEC:
        return d["chapter"]
    return None


def save(chapter: Optional[str], done: list, known_chapters: set[str]) -> dict:
    """사이트가 보낸 전체 목록으로 교체한다(체크 해제도 반영). 형식이 아닌 값은 버린다."""
    global _cache
    ids = list(dict.fromkeys(str(i) for i in (done or []) if _ID.match(str(i))))[:MAX_DONE]
    ch = chapter if (chapter and chapter in known_chapters) else None
    _cache = {"at": time.time(), "chapter": ch, "done": ids}
    try:
        _path().write_text(json.dumps(_cache, ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        print(f"[story_site] save failed: {e!r}")
    return _cache


def clear() -> None:
    global _cache
    _cache = {"at": 0.0, "chapter": None, "done": []}
    try:
        _path().unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        print(f"[story_site] clear failed: {e!r}")
