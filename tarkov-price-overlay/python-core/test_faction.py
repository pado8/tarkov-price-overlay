"""PMC 진영(BEAR/USEC) 시험(11-06). 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_faction.py
① 추정 규칙 ② 응답의 퀘스트 행 faction·모드별 추정 ③ 앱 수동 진영 저장 → /progress faction."""
import os
import sys
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="tpo-faction-"))
os.environ["LOCALAPPDATA"] = str(tmp)
os.environ["TPO_CATALOG_DIR"] = str(tmp / "catalog")

import faction  # noqa: E402
import main  # noqa: E402

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


QF = {"tb1": "BEAR", "tb2": "BEAR", "tu1": "USEC", "tu2": "USEC"}
# ① 추정
eq("기록 없음 → None", faction.detect({}, QF), None)
eq("일반 퀘스트만 → None", faction.detect({"x": "completed"}, QF), None)
eq("USEC 전용 진행 중 → USEC", faction.detect({"tu1": "started", "x": "completed"}, QF), "USEC")
eq("BEAR 전용 끝냄·실패도 근거", faction.detect({"tb1": "completed", "tb2": "failed"}, QF), "BEAR")
eq("상태 없음(None)은 근거 아님", faction.detect({"tb1": None}, QF), None)
eq("두 진영 같은 수로 섞임 → None", faction.detect({"tb1": "started", "tu1": "started"}, QF), None)
eq("섞여도 많은 쪽", faction.detect({"tb1": "started", "tb2": "completed", "tu1": "started"}, QF), "BEAR")

# ② 응답 — 표를 바꿔 끼우고, 트래커 상태도 바꿔 끼운다
faction.quest_factions = lambda: QF


class FakeTracker:
    def __init__(self, st): self.st = st
    def is_enabled(self): return True
    def all_status(self, mode): return self.st.get(mode, {})


main.get_tracker = lambda: FakeTracker({"pve": {"tu1": "started"}, "regular": {}, "season": {}})
price = {"id": "aramid", "name": "Aramid fiber fabric", "flea": 10000, "used_in_tasks": [
    {"id": "tb1", "name": "Textile - Part 1", "count": 5}, {"id": "tu1", "name": "Textile - Part 1", "count": 5},
    {"id": "x", "name": "Some Any Quest", "count": 1}]}
r = main._build_response("Aramid", price, "pve", lang="en")
eq("행 진영", [(t.id, t.faction) for t in r.used_in_tasks], [("tb1", "BEAR"), ("tu1", "USEC"), ("x", None)])
eq("모드별 추정", r.faction_by_mode, {"pvp": None, "pve": "USEC", "season": None})

# ③ 앱 수동 진영 → /progress
main._app_faction_cache = None
eq("수동 없음 → None", main._load_app_faction(), None)
main.sync_hideout(main.HideoutSyncRequest(levels={}, mode="pve", faction="BEAR"))
main._app_faction_cache = None  # 파일에서 다시 읽기
eq("수동 BEAR 저장·복원", main._load_app_faction(), "BEAR")
pr = main.progress(game_mode="pve")
eq("/progress 수동 우선", (pr["faction"], pr["faction_source"]), ("BEAR", "manual"))
main.sync_hideout(main.HideoutSyncRequest(levels={}, mode="pve", faction="auto"))
main._app_faction_cache = None
pr = main.progress(game_mode="pve")
eq("/progress 자동 → 기록 추정", (pr["faction"], pr["faction_source"]), ("USEC", "auto"))
pr = main.progress(game_mode="pvp")
eq("/progress 근거 없음", (pr["faction"], pr["faction_source"]), (None, None))
r = main.sync_hideout(main.HideoutSyncRequest(levels={}, mode="pve"))
eq("faction 안 보내면 그대로", r["faction"], None)

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
