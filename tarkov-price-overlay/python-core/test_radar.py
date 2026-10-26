"""radar.py 시험 — 네트워크·게임 없이 돈다.  실행: .venv/Scripts/python.exe test_radar.py

시험 데이터의 파일명·로그 줄은 개발 PC의 실제 EFT 스크린샷·로그(2026-10-26)에서 그대로 가져왔다.
"""
import math
import time

import radar as r

fails = 0


def eq(name, got, want, tol=None):
    global fails
    if tol is not None and isinstance(got, (int, float)) and isinstance(want, (int, float)):
        ok = abs(got - want) <= tol
    else:
        ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


# 1) 파일명 파싱 — 실제 파일명
p = r.parse_shot_name("2026-10-26[01-30]_30.24, 1.62, 21.55_0.00000, 0.97307, 0.00000, 0.23051_15.47 (0).png")
eq("좌표 x·y·z", (p["x"], p["y"], p["z"]), (30.24, 1.62, 21.55))
eq("쿼터니언", (p["qx"], p["qy"], p["qz"], p["qw"]), (0.0, 0.97307, 0.0, 0.23051))
p2 = r.parse_shot_name("2026-10-26[01-03]_-261.45, 2.28, -127.38_0.00680, -0.99256, 0.06936, 0.09983_19.37 (0).png")
eq("음수 좌표", (p2["x"], p2["z"]), (-261.45, -127.38))
eq("한 자리 시각도", r.parse_shot_name("2026-10-26[1-03]_1.0, 2.0, 3.0_0, 0, 0, 1_0.0 (0).png") is not None, True)
eq("좌표 없는 스크린샷은 None", r.parse_shot_name("2026-10-26[01-30] (0).png"), None)
eq("다른 이미지는 None", r.parse_shot_name("screenshot.png"), None)

# 2) 방향 — 정면(+z)=0, 오른쪽(+x)=90
eq("회전 없음 = 0도", r.heading_deg(0, 0, 0, 1), 0.0, tol=1e-6)
s = math.sin(math.radians(45)); c = math.cos(math.radians(45))
eq("y축 90도 회전 = 90도", r.heading_deg(0, s, 0, c), 90.0, tol=1e-6)
eq("y축 180도 회전 = 180도", r.heading_deg(0, 1, 0, 0), 180.0, tol=1e-6)
eq("y축 -90도 회전 = 270도", r.heading_deg(0, -s, 0, c), 270.0, tol=1e-6)
# 실제 값 (0, 0.97307, 0, 0.23051): y축으로 2·acos(0.23051) = 153.35도
eq("실제 스크린샷 방향", r.heading_deg(0, 0.97307, 0, 0.23051), 2 * math.degrees(math.acos(0.23051)), tol=0.01)
# 고개를 숙이고 찍어도(피치) 수평 방향은 그대로여야 한다: y축 90도 후 x축 30도
qy = (0, s, 0, c); qx = (math.sin(math.radians(15)), 0, 0, math.cos(math.radians(15)))
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx, aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)
eq("피치가 있어도 수평 방향 유지", r.heading_deg(*qmul(qy, qx)), 90.0, tol=0.01)
eq("수직으로 내려다보면 None", r.heading_deg(math.sin(math.radians(45)), 0, 0, math.cos(math.radians(45))), None)

# 3) 상대 각도 — 0 정면, +90 오른쪽, -90 왼쪽
eq("정면 10m", r.relative(0, 0, 0.0, 0, 10), (10.0, 0.0))
eq("오른쪽", r.relative(0, 0, 0.0, 10, 0)[1], 90.0, tol=1e-6)
eq("왼쪽", r.relative(0, 0, 0.0, -10, 0)[1], -90.0, tol=1e-6)
eq("뒤", abs(r.relative(0, 0, 0.0, 0, -10)[1]), 180.0, tol=1e-6)
eq("오른쪽을 보고 있으면 오른쪽 대상이 정면", r.relative(0, 0, 90.0, 10, 0)[1], 0.0, tol=1e-6)
eq("방향 모르면 각도 None", r.relative(0, 0, None, 3, 4), (5.0, None))

# 4) 프리셋 → 맵
eq("세관", r.map_from_preset("customs_preset"), "customs")
eq("인터체인지", r.map_from_preset("shopping_mall"), "interchange")
eq("시내", r.map_from_preset("city_preset"), "streets-of-tarkov")
eq("튜토리얼 그라운드 제로", r.map_from_preset("sandbox_start_preset"), "ground-zero")
eq("야간 공장", r.map_from_preset("factory_night_preset"), "night-factory")
eq("모르는 프리셋 추측(터미널)", r.map_from_preset("terminal_preset_v2"), "terminal")
eq("완전히 모르면 None", r.map_from_preset("hideout_preset"), None)

# 5) 로그 줄 — 실제 줄
LOG = """2026-10-26 00:32:23.252|1.2.5.0.48146|Info|application|Session mode: Pve
2026-10-26 00:41:51.227|1.2.5.0.48146|Info|application|scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset
2026-10-26 00:42:13.330|1.2.5.0.48146|Info|application|LocationLoaded:19.03 real:22.92 diff:3.88
2026-10-26 01:29:34.543|1.2.5.0.48146|Info|application|scene preset path:maps/factory_day_preset.bundle rcid:factory_day.scenespreset.asset"""
evs = r.parse_preset_lines(LOG)
eq("로딩 2건", [(e[1], e[2]) for e in evs], [("customs_preset", "customs"), ("factory_day_preset", "factory")])
t_customs = time.mktime(time.strptime("2026-10-26 00:41:51", "%Y-%m-%d %H:%M:%S"))
t_factory = time.mktime(time.strptime("2026-10-26 01:29:34", "%Y-%m-%d %H:%M:%S"))
eq("시각은 현지 시각", evs[0][0], t_customs)
# 실제 스크린샷 시각: 01:03 세관, 01:30 공장
eq("01:03 스크린샷 = 세관", r.map_at(evs, t_customs + 21 * 60)[0], "customs")
eq("01:30 스크린샷 = 공장", r.map_at(evs, t_factory + 40)[0], "factory")
eq("로딩 직전 4초는 새 맵(여유 5초)", r.map_at(evs, t_factory - 4)[0], "factory")
eq("첫 로딩 전 스크린샷 = 모름", r.map_at(evs, t_customs - 60)[0], None)
eq("2시간 넘게 지나면 = 모름", r.map_at(evs, t_factory + 3 * 3600)[0], None)

# 6) 대상 만들기 — 작은 가짜 데이터
maps_doc = {
    "M1": {"normalizedName": "factory", "name": "M1 Name", "extracts": [
        {"name": "ex_a", "faction": "pmc", "position": {"x": 0, "y": 0, "z": 100}},
        {"name": "ex_b", "faction": "scav", "position": {"x": 30, "y": 5, "z": 0}, "switches": ["s1"]},
    ], "transits": [{"description": "tr_x", "map": "M2", "position": {"x": -40, "y": -6, "z": 0}}]},
    "M2": {"normalizedName": "woods", "name": "M2 Name"},
    "M3": {"normalizedName": "night-factory", "name": "M3 Name", "extracts": []},
}
loc = {"M1 Name": "공장", "M2 Name": "삼림", "ex_a": "Gate 3", "ex_b": "Office", "tr_x": "삼림으로 이동"}
tasks = {"T1": {"name": "T1 name", "objectives": [
    {"description": "o1", "zones": [{"map": "M1", "position": {"x": 10, "y": 0, "z": 10}}]},
    {"description": "o2", "possibleLocations": [{"map": "M1", "positions": [{"x": 300, "y": 0, "z": 0}, {"x": 5, "y": 0, "z": -5}]}]},
    {"description": "o3", "zones": [{"map": "M2", "position": {"x": 1, "y": 0, "z": 1}}]},
]}, "T2": {"name": "T2 name", "objectives": [{"description": "o4", "zones": [{"map": "M1", "position": {"x": 1, "y": 0, "z": 1}}]}]}}
loc_t = {"T1 name": "첫 퀘스트", "o1": "구역 방문", "o2": "상자 찾기", "o3": "다른 맵"}
pose = {"x": 0.0, "y": 0.0, "z": 0.0, "heading": 0.0}
tg = r.build_targets(maps_doc, "factory", loc, tasks, loc_t, {"T1"}, pose)
eq("대상 수(탈출 2 + 트랜짓 1 + 퀘스트 2)", len(tg), 5)
eq("가까운 순 정렬", [t["dist"] for t in tg], sorted(t["dist"] for t in tg))
q = [t for t in tg if t["kind"] == "quest"]
eq("다른 맵 목표는 빠짐", sorted(t["objective"] for t in q), ["구역 방문", "상자 찾기"])
eq("후보 위치 중 가까운 곳", next(t for t in q if t["objective"] == "상자 찾기")["dist"], round(math.hypot(5, 5), 1))
eq("진행 중이 아닌 퀘스트(T2)는 빠짐", any(t.get("task") == "T2" for t in tg), False)
ex_b = next(t for t in tg if t["name"] == "Office")
eq("스캐브 탈출구·스위치 표시", (ex_b["faction"], ex_b["switch"], ex_b["rel"], ex_b["dy"]), ("scav", True, 90.0, 5.0))
trn = next(t for t in tg if t["kind"] == "transit")
eq("트랜짓 이름·목적지·아래 6m", (trn["name"], trn["dest"], trn["dy"], trn["rel"]), ("삼림으로 이동", "삼림", -6.0, -90.0))
tg_n = r.build_targets(maps_doc, "night-factory", loc, tasks, loc_t, {"T1"}, pose)
eq("야간 공장에서도 공장 퀘스트 구역이 보임", sorted(t["objective"] for t in tg_n if t["kind"] == "quest"), ["구역 방문", "상자 찾기"])
eq("없는 맵이면 빈 목록", r.build_targets(maps_doc, "nowhere", loc, tasks, loc_t, {"T1"}, pose), [])

raise SystemExit(1 if fails else 0)


# 7) 스크린샷 폴더 직접 지정 — 저장·복원·없는 폴더 거부·자동 복귀 (설정 파일은 임시 폴더로 돌림)
import tempfile, json as _json
from pathlib import Path as _P
_tmp = _P(tempfile.mkdtemp())
_orig_settings = r._settings_path
r._settings_path = lambda: _tmp / "radar.json"
try:
    svc = r.RadarService()
    eq("처음엔 자동 탐색", svc.folder_info()["source"], "auto")
    shots = _tmp / "shots"; shots.mkdir()
    info = svc.set_folder(str(shots))
    eq("직접 지정 반영", (info["source"], info["folder"]), ("manual", str(shots)))
    eq("설정 파일에 저장", _json.loads((_tmp / "radar.json").read_text(encoding="utf-8"))["folder"], str(shots))
    eq("state()에도 출처 표시", r.RadarService().state("ko").get("folder_source"), "manual")
    try:
        svc.set_folder(str(_tmp / "없는폴더")); eq("없는 폴더 거부", "예외 없음", "ValueError")
    except ValueError:
        eq("없는 폴더 거부", True, True)
    eq("빈 문자열 → 자동", svc.set_folder("")["source"], "auto")
    eq("따옴표·공백 섞인 경로도 허용", svc.set_folder(f'  "{shots}"  ')["source"], "manual")
    (_tmp / "radar.json").write_text(_json.dumps({"folder": str(_tmp / "사라진")}), encoding="utf-8")
    eq("저장된 폴더가 사라지면 자동으로", r.RadarService().folder_info()["source"], "auto")

    # 9) 전체 지도 좌표 추리기(compact_map_features) — 가짜 맵 문서, 네트워크 없음
    fake = {"normalizedName": "customs", "name": "Customs", "coordinateToCardinalRotation": 180,
            "extracts": [{"name": "ex_a", "faction": "pmc", "position": {"x": 10, "y": 1, "z": 20}, "outline": [{"x": 9, "z": 19}, {"x": 11, "z": 19}, {"x": 11, "z": 21}], "switches": ["s1"]},
                     {"name": "ex_bad", "position": None}],
            "transits": [{"description": "tr_a", "position": {"x": -5, "y": 0, "z": 5}, "outline": []}],
            "hazards": [{"name": "mine", "hazardType": "minefield", "position": {"x": 0, "y": 0, "z": 0}, "outline": [{"x": -1, "z": -1}, {"x": 1, "z": -1}, {"x": 1, "z": 1}]}],
            "locks": [{"lockType": "door", "position": {"x": 3, "y": 2, "z": 3}}],
            "lootContainers": [{"position": {"x": 1.26, "y": 0.5, "z": 2.74}}, {"position": {"x": 2, "y": 0, "z": 2}}],
            "spawns": [{"position": {"x": 7, "y": 0, "z": 7}, "sides": ["pmc"], "categories": ["player"]},
                   {"position": {"x": 8, "y": 0, "z": 8}, "sides": ["scav"], "categories": ["boss"]},
                   {"position": {"x": 9, "y": 0, "z": 9}, "sides": ["scav"], "categories": ["bot"]}],
            "stationaryWeapons": [{"position": {"x": 4, "y": 0, "z": 4}}], "switches": []}
    d = r.compact_map_features(fake, {"ex_a": "탈출 A", "tr_a": "트랜짓 A", "Customs": "세관"})
    eq("맵 이름 번역", d["name"], "세관")
    eq("탈출구: 위치 없는 것 제외·번역·스위치·윤곽", (len(d["extracts"]), d["extracts"][0]["name"], d["extracts"][0]["switch"], d["extracts"][0]["outline"]), (1, "탈출 A", True, [[9, 19], [11, 19], [11, 21]]))
    eq("좌표 소수 1자리로 압축", d["containers"][0], [1.3, 0.5, 2.7])
    eq("스폰 종류 코드 p/b/s", [s[3] for s in d["spawns"]], ["p", "b", "s"])
    eq("위험 구역 윤곽", len(d["hazards"][0]["outline"]), 3)
    eq("경계 상자", d["bounds"], {"minx": -5, "maxx": 10, "minz": 0, "maxz": 20})
    eq("회전값 전달", d["rot"], 180)
    eq("빈 맵은 경계 None", r.compact_map_features({"normalizedName": "x"}, {})["bounds"], None)
finally:
    r._settings_path = _orig_settings

print(f"\n{'전부 통과' if not fails else str(fails) + '건 실패'}")
import sys as _sys
_sys.exit(1 if fails else 0)
