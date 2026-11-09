"""툴팁 판정이 화면 높이(UI 배율)가 달라도 버티는지(11-09). 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_tooltip_scale.py
실제 게임 조각(test_data, 2560x1440)을 줄이고 키워 1080p·1200p·1620p·2160p 를 흉내 낸다. 통계: 1.2.7 뒤 1440p 가 아닌 화면에서
판정이 늘 빗나가 조회마다 0.6초를 더 기다렸다(같은 설치 64곳 350→829ms)."""
from pathlib import Path

import cv2
import numpy as np

import tooltip_detect as td

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


T = Path(__file__).parent / "test_data"


def load(n):
    return cv2.imdecode(np.fromfile(str(T / n), dtype=np.uint8), cv2.IMREAD_COLOR)


tip, none, label = load("tip_tooltip.png"), load("tip_inventory_none.png"), load("tip_ground_label.png")
SCALES = [(1.0, None, "1440p 원본"), (0.833, cv2.INTER_AREA, "1200p"), (0.75, cv2.INTER_AREA, "1080p(면적)"), (0.75, cv2.INTER_LINEAR, "1080p(선형)"),
          (1.125, cv2.INTER_LINEAR, "1620p"), (1.5, cv2.INTER_LINEAR, "2160p(선형)"), (1.5, cv2.INTER_CUBIC, "2160p(3차)")]


def rs(im, s, interp):
    return im if interp is None else cv2.resize(im, (int(im.shape[1] * s), int(im.shape[0] * s)), interpolation=interp)


for s, interp, name in SCALES:
    eq(f"{name}: 툴팁 조각 → 있음", td.has_tooltip(rs(tip, s, interp)), True)
    eq(f"{name}: 툴팁 없는 인벤토리 조각 → 없음", td.has_tooltip(rs(none, s, interp)), False)

# 합성: 순검정 패널 + 회색 테두리 + 흰 글자. 테두리 색이 섞여 65(0.75배)·100(1.5배 번짐)이어도 잡고, 테두리가 없으면 안 잡는다
def panel(border, text=200, bg=22):
    im = np.full((93, 400), bg, np.uint8)
    im[30:62, 40:300] = border
    im[31:61, 41:299] = 0
    for x in range(60, 280, 9):  # 글자 획 흉내
        im[40:52, x:x + 2] = text
    return cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)


eq("테두리 87(1440p) → 있음", td.has_tooltip(panel(87)), True)
eq("테두리 65(작은 UI 에서 배경과 섞임) → 있음", td.has_tooltip(panel(65)), True)
eq("테두리 100(큰 UI 번짐) → 있음", td.has_tooltip(panel(100)), True)
eq("가는 획(글자 밝기 130) → 있음", td.has_tooltip(panel(87, text=130)), True)
eq("테두리 없음(배경 22 그대로) → 없음", td.has_tooltip(panel(22)), False)
eq("테두리가 너무 밝음(160, 흰 틀) → 없음", td.has_tooltip(panel(160)), False)
eq("글자 없음(빈 검은 패널) → 없음", td.has_tooltip(panel(87, text=0)), False)
# 바닥 이름표 판정은 그대로(문턱 안 바꿈)
eq("바닥 이름표 조각 → 이름표 있음(원본)", td.has_label(label), True)
eq("툴팁 없는 인벤토리 조각 → 이름표 없음", td.has_label(none), False)

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
