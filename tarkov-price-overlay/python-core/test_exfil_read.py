"""탈출구 목록 읽기(11-08 사용자 제보: 시내 PvE 6개 중 4개) 시험. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_exfil_read.py
앞부분은 글자 읽기 없이 맞추기 규칙만, 끝은 이 PC 의 그날 실제 사진(있을 때만, 코어 2개·낮은 우선순위)."""
import os
from pathlib import Path

import radar

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


names = ["Klimov Street (Flare)", "Klimov Shopping Mall Exfil", "Pinewood Basement (Co-Op)", "Courtyard", "Primorsky Ave Taxi V-Ex", "Crash Site"]
eq("원문 'Klimov Street (Flare)' ↔ 한국어 화면 'Klimov Street (조명탄 탈출구)'",
   radar.match_exfils(["탈출지점05 Klimov Street (조명단 탈출구)"], names), {"Klimov Street (Flare)"})
eq("괄호까지 같은 이름은 그대로", radar.match_exfils(["06 Pinewood Basement (Co-Op)"], names), {"Pinewood Basement (Co-Op)"})
eq("한두 글자 틀림(Caurtyard)은 비슷한 이름으로", radar.match_exfils(["탈출지점01 Caurtyard ??:??:??"], names), {"Courtyard"})
dup = ["Smugglers' Path (Co-op)", "Smugglers' Path"]
eq("괄호 빼면 다른 탈출구와 같아지는 이름은 괄호 뺀 열쇠를 안 만듦", radar.match_exfils(["Smugglers' Path"], dup), {"Smugglers' Path"})


class R:  # readtext 결과 흉내: (상자, 글자, 신뢰도)
    @staticmethod
    def box(x, y):
        return [[x, y], [x + 50, y], [x + 50, y + 20], [x, y + 20]]


res = [(R.box(300, 100), "V-Ex", 0.9), (R.box(10, 101), "42x/:02 Primorsky Ave", 0.9), (R.box(200, 99), "Taxi", 0.9),
       (R.box(10, 150), "03 Crash Site", 0.9), (R.box(10, 200), "흐림", 0.1)]
lines = radar._join_rows(res, tol=8)
eq("같은 높이 조각을 x 순서로 한 줄로", lines, ["42x/:02 Primorsky Ave Taxi V-Ex", "03 Crash Site"])
eq("이은 줄로 'Primorsky Ave Taxi V-Ex' 맞춤", radar.match_exfils(lines, names), {"Primorsky Ave Taxi V-Ex", "Crash Site"})
# 두 줄로 접힌 긴 이름(실측 16:24 시내 스캐브): 아랫줄 'Parking' 이 같은 줄로 붙어 앞에 오면 안 된다
wrap = [(R.box(10, 300), "게임종료03 Cardinal Apartment Complex", 0.9), (R.box(10, 322), "Parking", 0.9), (R.box(10, 360), "게임종료04 Klimov Shopping Mall Exfil", 0.9)]
wl = radar._join_rows(wrap)
eq("접힌 아랫줄은 따로(글자 높이 절반 기준)", wl[1], "Parking")
eq("접힌 이름은 이웃 줄 이어 붙여 맞춤", radar.match_exfils(wl, ["Cardinal Apartment Complex Parking", "Klimov Shopping Mall Exfil"]),
   {"Cardinal Apartment Complex Parking", "Klimov Shopping Mall Exfil"})

eq("단어 순서가 바뀐 줄(실측 'rarking Cardinal Apartment Complex')도 맞춤",
   radar.match_exfils(["게임종료03 rarking Cardinal Apartment Complex"], ["Cardinal Apartment Complex Parking", "Courtyard"]),
   {"Cardinal Apartment Complex Parking"})
eq("단어 맞추기는 이웃 줄을 이은 것엔 안 씀(서로 다른 탈출구 단어가 섞인 오탐 방지)",
   radar.match_exfils(["01 Smugglers Boat", "02 Path to Lighthouse"], ["Smugglers' Path", "Smugglers' Boat", "Path to Lighthouse"]),
   {"Smugglers' Boat", "Path to Lighthouse"})

# 실제 사진(11-08 시내 PvE, 같은 레이드 두 장) — 있을 때만
S = Path(os.environ.get("USERPROFILE", "")) / "Documents" / "Escape from Tarkov" / "Screenshots"
shots = [p for tag in ("20-39", "20-46") for p in S.glob(f"2026-11-08[[]{tag}]*") if radar.exfil_banner(p)]
if shots:
    import ctypes

    k = ctypes.windll.kernel32
    k.GetCurrentProcess.restype = ctypes.c_void_p
    k.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    k.SetPriorityClass(k.GetCurrentProcess(), 0x40)  # 게임보다 늘 뒤
    import torch

    torch.set_num_threads(2)
    truth = {"Courtyard", "Primorsky Ave Taxi V-Ex", "Crash Site", "Damaged House", "Klimov Street (Flare)", "Pinewood Basement (Co-Op)"}
    all_names = radar.exfil_names("streets-of-tarkov")
    for p in shots:
        got = radar.match_exfils(radar.read_exfil_lines(p, "ko"), all_names)
        eq(f"실제 사진 {p.name[:17]} 한국어 게임 → 6개 전부", got, truth)
else:
    print("   (11-08 실제 사진 없음 — 건너뜀)")

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
