"""레이드 끝 뒤(은신처·메뉴) 스크린샷을 맵 좌표에서 빼기 — radar.parse_raid_marks·raid_ends·map_event_at(ends)·is_menu_camera,
map_share.build_lines. 네트워크·게임 없이. 실행: .venv/Scripts/python.exe test_raid_window.py"""
import os
import sys
import tempfile
import time
from pathlib import Path

import map_share
import radar

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    fails += 0 if ok else 1
    print(("OK   " if ok else "FAIL ") + name)
    if not ok:
        print("     got ", got)
        print("     want", want)


def ts(s):
    return time.mktime(time.strptime(s, "%Y-%m-%d %H:%M:%S"))


# 1) 로그 줄 → 신호
text = "\n".join([
    "2026-11-04 21:56:10.100|1.3.0|Info|application|GameStarted",
    "2026-11-04 22:22:37.500|1.3.0|Info|backend|---> Request HTTPS, Url: https://x/client/match/local/end, ID: 1",
    "2026-11-04 22:23:00.000|1.3.0|Info|application|PrepareSelectedProfileLocally ProfileId:aaaaaaaaaaaaaaaaaaaaaaaa",
    "2026-11-04 22:23:01.000|1.3.0|Info|application|other line",
])
eq("신호 읽기", [k for _t, k in radar.parse_raid_marks(text)], ["started", "end", "menu"])

# 2) 해안선 실례: 21:55:56 로딩 → 22:22:37 local/end → 22:25:32 은신처 스크린샷
L = ts("2026-11-04 21:55:56")
events = [(L, "shoreline_preset", "shoreline")]
marks = radar.parse_raid_marks(text)
ends = radar.raid_ends(events, marks)
eq("PvE: 끝 = /client/match/local/end", ends[L], ts("2026-11-04 22:22:37"))
eq("끝 뒤 은신처 스크린샷 → 맵 없음", radar.map_event_at(events, ts("2026-11-04 22:25:32"), ends), None)
eq("레이드 중 스크린샷 → 해안선", radar.map_event_at(events, ts("2026-11-04 22:10:00"), ends)[2], "shoreline")
eq("끝과 같은 초 +2초(탈출 순간) → 해안선", radar.map_event_at(events, ts("2026-11-04 22:22:39"), ends)[2], "shoreline")
eq("ends 를 안 주면 예전대로(2시간 안이면 해안선)", radar.map_event_at(events, ts("2026-11-04 22:25:32"))[2], "shoreline")

# 3) PvP(local/end 없음): GameStarted 뒤 메뉴로 돌아옴(PrepareSelectedProfileLocally) = 끝. GameStarted 전 메뉴 신호는 끝이 아님
L2 = ts("2026-11-05 10:00:00")
mk2 = [(ts("2026-11-05 10:00:30"), "menu"), (ts("2026-11-05 10:02:00"), "started"), (ts("2026-11-05 10:40:00"), "menu")]
e2 = radar.raid_ends([(L2, "bigmap", "customs")], mk2)
eq("PvP: GameStarted 뒤 메뉴 = 끝(앞선 메뉴 신호는 무시)", e2[L2], ts("2026-11-05 10:40:00"))
# 4) 끝 신호가 없으면 다음 로딩, 그것도 없으면 2시간
L3, L4 = ts("2026-11-06 10:00:00"), ts("2026-11-06 10:50:00")
e3 = radar.raid_ends([(L3, "a", "woods"), (L4, "b", "customs")], [])
eq("끝 신호 없음 → 다음 로딩이 끝", e3[L3], L4)
eq("마지막 로딩 → 2시간", e3[L4], L4 + radar.MAX_RAID_AGE_SEC)

# 5) 메뉴 고정 카메라
eq("메뉴 카메라 방향", radar.is_menu_camera({"qx": 0.41849, "qy": 0.37487, "qz": -0.19514, "qw": 0.80390}), True)
eq("보통 방향", radar.is_menu_camera({"qx": 0.1, "qy": 0.2, "qz": 0.3, "qw": 0.9}), False)

# 6) map_share.build_lines: 끝 뒤 스크린샷·메뉴 카메라 빼기
d = Path(tempfile.mkdtemp())
def shot(name, when):
    p = d / name
    p.write_bytes(b"x")
    os.utime(p, (when, when))
shot("2026-11-04[22-10]_10.00, 1.00, 20.00_0.10000, 0.20000, 0.30000, 0.90000_16.00 (0).png", ts("2026-11-04 22:10:00"))  # 레이드 안
shot("2026-11-04[22-25]_7.62, 1.81, -2.35_0.10000, 0.20000, 0.30000, 0.90000_16.00 (0).png", ts("2026-11-04 22:25:32"))  # 은신처
shot("2026-11-04[22-11]_5.00, 17.75, 5.00_0.41849, 0.37487, -0.19514, 0.80390_17.75 (0).png", ts("2026-11-04 22:11:00"))  # 메뉴 카메라
lines = map_share.build_lines(d, events, marks)
eq("build_lines: 레이드 안 1줄만(은신처·메뉴 카메라 빠짐)", [l.split("|")[1].split(",")[0] for l in lines], ["10.00"])
lines_old = map_share.build_lines(d, events)
eq("marks 없이 events 만 주면 끝 판정 없음(메뉴 카메라만 빠짐)", len(lines_old), 2)

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
