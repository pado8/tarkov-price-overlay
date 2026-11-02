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
        {"name": "Gate m", "faction": "pmc", "position": {"x": 0, "y": 0, "z": -500},
         "transferItem": {"item": {"id": "5449016a4bdc2d6f028b456f"}, "count": 5000}},
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
eq("대상 수(탈출 3 + 트랜짓 1 + 퀘스트 2)", len(tg), 6)
eq("가까운 순 정렬", [t["dist"] for t in tg], sorted(t["dist"] for t in tg))
q = [t for t in tg if t["kind"] == "quest"]
eq("다른 맵 목표는 빠짐", sorted(t["objective"] for t in q), ["구역 방문", "상자 찾기"])
eq("후보 위치 중 가까운 곳", next(t for t in q if t["objective"] == "상자 찾기")["dist"], round(math.hypot(5, 5), 1))
eq("진행 중이 아닌 퀘스트(T2)는 빠짐", any(t.get("task") == "T2" for t in tg), False)
ex_b = next(t for t in tg if t["name"] == "Office")
eq("데이터 switches 는 조건으로 안 씀(맵 전체 스위치가 모든 탈출구에 붙어 있음)", (ex_b["faction"], ex_b["switch"], ex_b["cond"], ex_b["rel"], ex_b["dy"]), ("scav", False, [], 90.0, 5.0))
gm = next(t for t in tg if t["name"] == "Gate m")
eq("위키 표: 공장 의료 텐트 = 열쇠, 돈 제출 = 유료", (gm["cond"], gm["paid"], gm["switch"]), (["key", "paid"], True, False))
tg_nf = r.build_targets({**maps_doc, "M3": {**maps_doc["M3"], "extracts": [{"name": "Cellars", "position": {"x": 1, "y": 0, "z": 1}}]}},
                        "night-factory", loc, tasks, loc_t, set(), pose)
eq("야간 공장도 공장 표 사용", next(t for t in tg_nf if t["kind"] == "extract")["cond"], ["key"])
trn = next(t for t in tg if t["kind"] == "transit")
eq("트랜짓 이름·목적지·아래 6m", (trn["name"], trn["dest"], trn["dy"], trn["rel"]), ("삼림으로 이동", "삼림", -6.0, -90.0))
tg_n = r.build_targets(maps_doc, "night-factory", loc, tasks, loc_t, {"T1"}, pose)
eq("야간 공장에서도 공장 퀘스트 구역이 보임", sorted(t["objective"] for t in tg_n if t["kind"] == "quest"), ["구역 방문", "상자 찾기"])
eq("없는 맵이면 빈 목록", r.build_targets(maps_doc, "nowhere", loc, tasks, loc_t, {"T1"}, pose), [])

# 6-1) 탈출구 조건 표(extract_conditions) — 가이드와 레이더가 같이 쓴다
import extract_conditions as xc
eq("조건 없는 탈출구", xc.conditions("customs", {"name": "ex_customs_scav_gasstation", "switches": ["s"]})[:2], (set(), None))
eq("세관 ZB-1013 = 레버+열쇠", xc.conditions("customs", {"name": "ex_customs_pmc_zb1013"})[0], {"lever", "key"})
eq("아이템 제출 = item(유료 아님)", xc.conditions("customs", {"name": "ex_customs_secret_voron_boat", "transferItem": {"item": {"id": "675aaab74bca0b001d02f356"}, "count": 1}})[0], {"item"})
eq("유로 = paid·기호", xc.conditions("icebreaker", {"name": "Heli", "transferItem": {"item": "569668774bdc2da2298b4568", "count": 2400}})[2]["money"], "€")
eq("그라운드 제로 21+ 도 같은 표", xc.conditions("ground-zero-21", {"name": "Sniper_exit"})[0], {"flare"})


# 7) 스크린샷 폴더 직접 지정 — 저장·복원·없는 폴더 거부·자동 복귀 (설정 파일은 임시 폴더로 돌림)
import tempfile, os, json as _json
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
    eq("탈출구: 위치 없는 것 제외·번역·스위치·윤곽", (len(d["extracts"]), d["extracts"][0]["name"], d["extracts"][0]["switch"], d["extracts"][0]["outline"]), (1, "탈출 A", False, [[9, 19], [11, 19], [11, 21]]))
    eq("좌표 소수 1자리로 압축", d["containers"][0], [1.3, 0.5, 2.7])
    eq("스폰 종류 코드 p/b/s", [s[3] for s in d["spawns"]], ["p", "b", "s"])
    eq("위험 구역 윤곽", len(d["hazards"][0]["outline"]), 3)
    eq("경계 상자", d["bounds"], {"minx": -5, "maxx": 10, "minz": 0, "maxz": 20})
    eq("회전값 전달", d["rot"], 180)
    eq("빈 맵은 경계 None", r.compact_map_features({"normalizedName": "x"}, {})["bounds"], None)
    # 9b) 보스 구역 — 좌표 있는 구역은 그대로, 비어 있으면 spawns 의 zoneName 으로, PMC 는 제외, 같은 구역의 보스는 합침
    fb = {"normalizedName": "customs", "spawns": [{"position": {"x": 1, "y": 0, "z": 1}, "zoneName": "ZoneDorm", "categories": ["player"]},
                                                  {"position": {"x": 3, "y": 0, "z": 3}, "zoneName": "ZoneDorm", "categories": ["boss"]}],
          "bosses": [{"mob": "bossBully", "spawnChance": 0.75, "spawnLocations": [{"name": "ZoneDorm", "spawnKey": "ZoneDorm", "chance": 0.5, "positions": []},
                                                                                   {"name": "ZoneGas", "spawnKey": "ZoneGas", "chance": 0.5, "positions": [{"x": 9, "y": 0, "z": 9}]}]},
                     {"mob": "bossKnight", "spawnChance": 0.25, "spawnLocations": [{"name": "ZoneDorm", "spawnKey": "ZoneDorm", "chance": 1, "positions": []}]},
                     {"mob": "pmcBEAR", "spawnChance": 1, "spawnLocations": [{"name": "ZoneDorm", "spawnKey": "ZoneDorm", "chance": 1, "positions": []}]},
                     {"mob": "bossNowhere", "spawnChance": 1, "spawnLocations": [{"name": "ZoneNone", "spawnKey": "ZoneNone", "chance": 1, "positions": []}]}]}
    bz = r.compact_map_features(fb, {"bossBully": "르샬라", "ZoneDorm": "기숙사"})["bosses"]
    eq("보스 구역 수(좌표 없는 구역 제외)", sorted(z["name"] for z in bz), ["ZoneGas", "기숙사"])
    d1 = next(z for z in bz if z["name"] == "기숙사")
    eq("구역 좌표는 spawns 로 보충", d1["pts"], [[1, 1], [3, 3]])
    eq("같은 구역 보스 합침·확률 큰 순·PMC 제외", [(b["name"], b["chance"]) for b in d1["bosses"]], [("르샬라", 0.38), ("bossKnight", 0.25)])
# 8) 자동 정리 — 좌표 스크린샷만, 최신 N장 유지, 휴지통으로(실제 Windows 휴지통 사용; 작은 더미 파일)
    svc2 = r.RadarService()
    pr = _tmp / "prune"; pr.mkdir()
    svc2.set_folder(str(pr))
    names = [f"2026-10-26[01-0{i}]_{i}.0, 1.0, 2.0_0, 0, 0, 1_0.0 (0).png" for i in range(5)]
    for i, nm in enumerate(names):
        (pr / nm).write_bytes(b"x"); os.utime(pr / nm, (1000 + i, 1000 + i))
    (pr / "normal_screenshot.png").write_bytes(b"x")   # 좌표 없는 일반 스크린샷 — 건드리면 안 됨
    eq("정리 끔이면 아무것도 안 지움", svc2._prune(pr), 0)
    eq("set_prune 저장", svc2.set_prune(2)["prune_keep"], 2)
    eq("설정 파일에 prune_keep", _json.loads((_tmp / "radar.json").read_text(encoding="utf-8"))["prune_keep"], 2)
    n = svc2._prune(pr)
    eq("최신 2장 밖 3장 정리", n, 3)
    eq("남은 좌표 파일 = 최신 2장", sorted(p.name for p in pr.iterdir() if "]_" in p.name), sorted(names[3:]))
    eq("일반 스크린샷은 그대로", (pr / "normal_screenshot.png").exists(), True)
    eq("state()가 새 샷마다 한 번만 정리", svc2.state("ko").get("folder_source"), "manual")
    eq("재로드 시 prune_keep 복원", r.RadarService().folder_info()["prune_keep"], 2)
    eq("0이면 끔", svc2.set_prune(0)["prune_keep"], None)
    try:
        svc2.set_prune(-1); eq("음수 거부", "예외 없음", "ValueError")
    except ValueError:
        eq("음수 거부", True, True)
finally:
    r._settings_path = _orig_settings

# 보스 구역 — 한 구역 이름 아래 멀리 떨어진 점 무리는 따로 낸다(해안선 '기상 관측소' 1km 갈라짐, 11-03)
bm = {"bosses": [
    {"mob": "bossKnight", "spawnChance": 0.18, "spawnLocations": [{"spawnKey": "ZoneMeteoStation", "name": "Weather Station", "chance": 1,
        "positions": [{"x": 459, "z": 56}, {"x": 373, "z": 76}, {"x": -582, "z": 110}, {"x": 460, "z": 92}, {"x": -575, "z": 129}]}]},
    {"mob": "bossSanitar", "spawnChance": 0.5, "spawnLocations": [{"spawnKey": "ZoneA", "name": "A", "chance": 1,
        "positions": [{"x": 0, "z": 0}, {"x": 140, "z": 0}, {"x": 280, "z": 0}]}]},  # 140m 씩 이어진 사슬 = 한 무리
], "spawns": []}
bz = r.boss_zones(bm, {})
ws = [z for z in bz if z["name"] == "ZoneMeteoStation"]
eq("갈라진 구역은 무리 2개", sorted(len(z["pts"]) for z in ws), [2, 3])
eq("무리마다 보스·확률 그대로", all(z["bosses"] == [{"name": "bossKnight", "chance": 0.18}] for z in ws), True)
eq("먼 무리는 서로 안 섞임", sorted(sorted(p[0] for p in z["pts"]) for z in ws), [[-582, -575], [373, 459, 460]])
eq("150m 안으로 이어진 사슬은 한 무리", [len(z["pts"]) for z in bz if z["name"] == "ZoneA"], [3])

# 저격 스캐브 자리 — 스폰 목록의 'Snipe' 구역도 저격수 표시로(해안선 요양원 북쪽, 11-03)
sm = {"normalizedName": "", "hazards": [{"name": "ScavRole/Marksman", "hazardType": "sniper", "position": {"x": 0, "y": 0, "z": 0}, "outline": []}],
      "spawns": [
          {"zoneName": "ZoneBunkeSniper", "categories": ["bot"], "sides": ["scav"], "position": {"x": -153.3, "y": 10, "z": -269.4}},
          {"zoneName": "ZoneBunkeSniper", "categories": ["bot"], "sides": ["scav"], "position": {"x": -152.3, "y": 10, "z": -269.4}},  # 1m 옆 = 하나로
          {"zoneName": "ZoneX", "categories": ["bot", "sniper"], "sides": ["scav"], "position": {"x": 10, "y": 0, "z": 10}},  # 기존 저격 구역 25m 안 = 생략
          {"zoneName": "ZoneRoad", "categories": ["bot"], "sides": ["scav"], "position": {"x": 300, "y": 0, "z": 300}},  # 일반 스캐브 = 아님
      ]}
sf = r.compact_map_features(sm, {"ScavRole/Marksman": "저격수"}, {})
sn = [h for h in sf["hazards"] if h["type"] == "sniper"]
eq("스폰 목록 저격 자리 추가(겹침·기존 구역 근처 제외)", [(h["name"], h["p"][0], h["p"][2]) for h in sn], [("저격수", 0.0, 0.0), ("저격수", -153.3, -269.4)])

# 메인(스토리) 퀘스트 — tarkov.dev 가 'story' 를 공개하면 상인 퀘스트와 함께 읽는다(11-03)
td = {"tasks": {"a": {"id": "a", "name": "trader"}}, "story": [{"id": "ch1", "tasks": [{"id": "s1", "name": "story1"}, {"id": "a", "name": "dup"}]}]}
at = r.all_tasks(td)
eq("스토리 퀘스트 합침", sorted(at), ["a", "s1"])
eq("id 겹치면 상인 퀘스트 우선", at["a"]["name"], "trader")
eq("story 없으면 그대로", sorted(r.all_tasks({"tasks": {"a": {}}})), ["a"])

print(f"\n{'전부 통과' if not fails else str(fails) + '건 실패'}")
import sys as _sys
_sys.exit(1 if fails else 0)
