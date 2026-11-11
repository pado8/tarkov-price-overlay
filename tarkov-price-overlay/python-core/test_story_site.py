"""사이트 스토리 체크 저장(story_site, 11-11) 시험 — 상태 폴더는 임시 폴더로. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_story_site.py
① 챕터와 함께 오면 그 챕터·시각 저장 ② 챕터 없이 오면(사이트가 페이지를 열 때 하는 동기화) 체크 목록만 바꾸고 이전 챕터·시각 유지
③ '자동' 우선 기간(7일)은 챕터를 받은 시각 기준 ④ 11-11 전 파일(chapter_at 없음)도 읽음 ⑤ 형식이 아닌 id·모르는 챕터는 버림 ⑥ 비우기."""
import json
import tempfile
import time
from pathlib import Path

import quest_tracker
import story_site as S

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


tmp = Path(tempfile.mkdtemp(prefix="story-site-test-"))
quest_tracker._state_dir = lambda: tmp  # 실제 %LOCALAPPDATA% 상태는 건드리지 않는다
S._cache = None
KNOWN = {"tour", "batya", "accidental-witness"}
A, B = "68f0f7d9a3fa68269236e047", "68c6a5ed545269faf1c4b157"

S.save("accidental-witness", [A], KNOWN)
eq("① 챕터 저장", S.load()["chapter"], "accidental-witness")
eq("① 최근 챕터", S.recent_chapter(), "accidental-witness")
t_ch = S.load()["chapter_at"]
time.sleep(0.05)
S.save(None, [A, B], KNOWN)
eq("② 챕터 없이 오면 체크 목록만 바뀜", sorted(S.done_set()), sorted([A, B]))
eq("② 이전 챕터 유지", S.load()["chapter"], "accidental-witness")
eq("② 챕터 받은 시각도 유지(페이지 열기가 7일을 늘리지 않게)", S.load()["chapter_at"], t_ch)
S._cache = None  # 파일에서 다시 읽어도 같게
eq("② 파일에서 다시 읽어도 유지", (S.load()["chapter"], S.load()["chapter_at"]), ("accidental-witness", t_ch))
eq("③ 7일 지나면 우선 안 함", S.recent_chapter(now=t_ch + 7 * 24 * 3600 + 1), None)
eq("③ 7일 안이면 우선", S.recent_chapter(now=t_ch + 6 * 24 * 3600), "accidental-witness")
S.save("batya", [A], KNOWN)
eq("① 다른 챕터에서 체크하면 그 챕터로", S.recent_chapter(), "batya")

# ④ 11-11 전 파일 — chapter_at 없음
(tmp / "story_site.json").write_text(json.dumps({"at": 1000.0, "chapter": "tour", "done": [A]}), encoding="utf-8")
S._cache = None
eq("④ 옛 파일: chapter_at = at", (S.load()["chapter"], S.load()["chapter_at"]), ("tour", 1000.0))
eq("④ 옛 파일: 오래돼 우선 안 함", S.recent_chapter(), None)

S.save("nope-chapter", [A, "xyz", "68F0F7D9A3FA68269236E047"], KNOWN)
eq("⑤ 형식 아닌 id 버림", S.load()["done"], [A])
eq("⑤ 모르는 챕터는 없음으로 → 이전 챕터 유지", S.load()["chapter"], "tour")

S.clear()
eq("⑥ 비우기", (S.load()["chapter"], S.load()["done"], (tmp / "story_site.json").exists()), (None, [], False))

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
