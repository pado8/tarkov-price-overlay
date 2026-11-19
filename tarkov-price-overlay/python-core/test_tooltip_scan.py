"""넓은 범위 툴팁 찾기(tooltip_detect.find_tooltips)가 화면 크기가 달라도 툴팁만 고르는지(11-19). 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python test_tooltip_scan.py
실제 게임 조각(test_data, 2560x1440)의 툴팁을 인벤토리 바탕에 붙여 1080p·1440p·2160p·2880p 를 흉내 낸다."""
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


tip_img = load("tip_tooltip.png")
c = td.find_panel(tip_img, need_border=True)
panel = tip_img[c["y"] - 1:c["y"] + c["h"] + 1, c["x"] - 1:c["x"] + c["w"] + 1]
back = cv2.resize(load("tip_inventory_none.png"), (1800, 600), interpolation=cv2.INTER_LINEAR)


def scene(scale):
    """넓은 캡처 한 장: 커서는 가운데, 툴팁은 커서 오른쪽 위에서 조금 떨어진 곳."""
    h, w = int(back.shape[0] * scale), int(back.shape[1] * scale)
    img = cv2.resize(back, (w, h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    p = cv2.resize(panel, (round(panel.shape[1] * scale), round(panel.shape[0] * scale)), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    cur = (w // 2, h // 2)
    x, y = cur[0] + int(40 * scale), cur[1] - int(90 * scale)
    out = img.copy()
    out[y:y + p.shape[0], x:x + p.shape[1]] = p
    return out, img, cur, (x, y, p.shape[1], p.shape[0])


for screen_h in (1080, 1440, 2160, 2880):
    scale = screen_h / 1440
    shot, empty, cur, want = scene(scale)
    found = td.find_tooltips(shot, screen_h, cur)
    near = bool(found) and abs(found[0]["x"] - want[0]) <= 3 and abs(found[0]["y"] - want[1]) <= 3
    eq(f"{screen_h}p 커서 근처 툴팁을 찾는다", near, True)
    eq(f"{screen_h}p 툴팁이 없으면 후보 없음", td.find_tooltips(empty, screen_h, cur), [])
    far = (cur[0] - int(700 * scale), cur[1] + int(280 * scale))
    eq(f"{screen_h}p 커서에서 먼 패널은 고르지 않는다", td.find_tooltips(shot, screen_h, far), [])

# 무기 칸처럼 키 큰 어두운 칸은 테두리가 있어도 툴팁이 아니다(1440p 실측 413x167)
slot = np.full((400, 800, 3), 60, np.uint8)
cv2.rectangle(slot, (200, 100), (612, 266), (87, 87, 87), 1)
slot[101:266, 201:612] = 0
slot[170:190, 260:560] = 220
eq("키 큰 무기 칸은 고르지 않는다", td.find_tooltips(slot, 1440, (400, 300)), [])
eq("빈 이미지는 빈 목록", td.find_tooltips(None, 1440, (0, 0)), [])

print("\n실패", fails, "건")
raise SystemExit(1 if fails else 0)
