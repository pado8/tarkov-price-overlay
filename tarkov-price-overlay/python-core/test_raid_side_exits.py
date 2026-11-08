"""내 탈출구로 PMC/스캐브 판정(11-08) 시험. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_raid_side_exits.py"""
import radar

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


# 11-08 실제 PMC 레이드(해안선)에서 읽힌 8개 — 'Lighthouse'(스캐브 전용)는 'Path to Lighthouse' 안에 든 이름
real = ["Climber's Trail", "Lighthouse", "Path to Lighthouse", "Pier Boat", "Railway Bridge", "Road to Customs",
        "Road to North V-Ex", "Smugglers' Path (Co-op)"]
eq("실측 PMC 해안선 → pmc", radar.side_from_exits("shoreline", real), "pmc")
eq("공용만 → 판정 안 함", radar.side_from_exits("shoreline", ["Road to Customs", "Smugglers' Path (Co-op)"]), None)
eq("PMC 1개 → 판정 안 함(근거 부족)", radar.side_from_exits("shoreline", ["Pier Boat", "Road to Customs"]), None)
eq("섞임(PMC 2·스캐브 2) → 판정 안 함", radar.side_from_exits("shoreline", ["Pier Boat", "Railway Bridge", "Lighthouse", "Ruined Road"]), None)
eq("스캐브 전용 3개 + 공용 → scav", radar.side_from_exits("shoreline", ["Admin Basement", "East Wing Gym Entrance", "Ruined Road", "Road to Customs"]), "scav")
eq("맵 없음 → None", radar.side_from_exits(None, real), None)
eq("빈 목록 → None", radar.side_from_exits("shoreline", []), None)
import extract_current as ec
sc = [n for n, f in ec.table().get("shoreline", {}).items() if f == "scav"]
print("   (해안선 스캐브 전용 표 키:", sc, ")")
print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
