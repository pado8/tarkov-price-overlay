"""툴팁 대기 시험(11-04). 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_tooltip_wait.py
- tooltip_detect: 실제 게임 화면 조각(test_data/tip_*.png) + 합성 그림으로 툴팁·바닥 이름표 판정
- main._wait_for_tooltip: 캡처를 바꿔 끼워 '이미 있음·바닥 이름표·기다려서 뜸·끝내 없음·끔' 경로와 대기 시간
"""
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
tmp = Path(tempfile.mkdtemp(prefix="tpo-tipwait-"))
os.environ["LOCALAPPDATA"] = str(tmp)
os.environ["TPO_CATALOG_DIR"] = str(tmp / "catalog")
os.environ.pop("TPO_TOOLTIP_WAIT", None)

import tooltip_detect as td  # noqa: E402
import main  # noqa: E402

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


def load(name):
    rgb = np.array(Image.open(HERE / "test_data" / name).convert("RGB"))
    return rgb[:, :, ::-1].copy()  # BGR


TIP, NONE, LABEL = load("tip_tooltip.png"), load("tip_inventory_none.png"), load("tip_ground_label.png")

# 1) 실제 게임 화면 조각
eq("실제 툴팁 → 툴팁 있음", td.has_tooltip(TIP), True)
eq("툴팁 뜨기 전 인벤토리 → 툴팁 없음", td.has_tooltip(NONE), False)
eq("툴팁 뜨기 전 인벤토리 → 이름표도 없음", td.has_label(NONE), False)
eq("바닥 이름표 → 이름표 있음", td.has_label(LABEL), True)
eq("바닥 이름표 → 툴팁으로 오인 안 함", td.has_tooltip(LABEL), False)
bgra = np.dstack([TIP, np.full(TIP.shape[:2], 255, np.uint8)])
eq("mss 모양(BGRA)도 같은 판정", td.has_tooltip(bgra), True)

# 2) 합성: 순검정 + 87 테두리 + 흰 글자 = 툴팁 / 회색(45) 바탕 글자 = 아님 / 테두리 없는 검정 상자 = 이름표만
def synth(bg, box_val, border, text=True):
    im = np.full((93, 400, 3), bg, np.uint8)
    if border is not None:
        im[19:71, 39:331] = border
    im[20:70, 40:330] = box_val
    if text:
        im[35:50, 60:250:3] = 230
    return im


eq("합성 툴팁", td.has_tooltip(synth(45, 0, 87)), True)
eq("합성: 회색 바탕 글자(인벤토리 칸)", td.has_tooltip(synth(45, 45, None)), False)
eq("합성: 테두리 없는 검정 상자 → 툴팁 아님", td.has_tooltip(synth(120, 3, None)), False)
eq("합성: 테두리 없는 검정 상자 → 이름표", td.has_label(synth(120, 3, None)), True)
eq("합성: 글자 없는 검정 상자 → 툴팁 아님", td.has_tooltip(synth(45, 0, 87, text=False)), False)
eq("빈 그림 → 판정 불가는 '있음'(기다리지 않음)", td.has_tooltip(np.zeros((0, 0, 3), np.uint8)), True)

# 3) 대기 흐름 — 캡처를 바꿔 끼운다
main.TOOLTIP_WAIT_STEPS = (0.05, 0.05)
main._lookup_superseded = lambda seq: False
ATT = [("primary", 10, 10, 400, 93), ("mirror", 0, 10, 400, 93), ("ground", 5, 50, 284, 70)]


def run(seq_by_label, steps=None):
    calls = {"primary": 0, "mirror": 0, "ground": 0}
    boxes = {a[0]: a[1:] for a in ATT}

    def fake(x, y, w, h):
        lbl = next(k for k, v in boxes.items() if v == (x, y, w, h))
        i = calls[lbl]
        calls[lbl] += 1
        seq = seq_by_label[lbl]
        return seq[min(i, len(seq) - 1)]

    main.capture_region = fake
    t0 = time.perf_counter()
    r = main._wait_for_tooltip(ATT, 1)
    return r, time.perf_counter() - t0, calls


r, dt, _ = run({"primary": [TIP], "mirror": [NONE], "ground": [NONE]})
eq("이미 툴팁 → present, 기다리지 않음", (r, dt < 0.04), ("present", True))
r, dt, _ = run({"primary": [NONE], "mirror": [TIP], "ground": [NONE]})
eq("거울 쪽 툴팁도 present", r, "present")
r, dt, c = run({"primary": [NONE], "mirror": [NONE], "ground": [LABEL]})
eq("바닥 이름표 → label, 기다리지 않음", (r, dt < 0.04), ("label", True))
r, dt, c = run({"primary": [NONE, TIP], "mirror": [NONE], "ground": [NONE]})
eq("한 번 기다려 툴팁 뜸 → waited_ok", (r, 0.04 <= dt < 0.2), ("waited_ok", True))
r, dt, c = run({"primary": [NONE], "mirror": [NONE], "ground": [NONE]})
eq("끝내 없음 → waited_none, 두 번만 기다림", (r, c["primary"]), ("waited_none", 3))
os.environ["TPO_TOOLTIP_WAIT"] = "0"
r, dt, c = run({"primary": [NONE], "mirror": [NONE], "ground": [NONE]})
eq("TPO_TOOLTIP_WAIT=0 → skip, 캡처 안 함", (r, c["primary"]), ("skip", 0))
os.environ.pop("TPO_TOOLTIP_WAIT", None)
main._lookup_superseded = lambda seq: True
r, dt, c = run({"primary": [NONE], "mirror": [NONE], "ground": [NONE]})
eq("기다리는 중 새 F2 → superseded 로 바로 끝", r, "superseded")


def boom(*a):
    raise RuntimeError("capture failed")


main.capture_region = boom
main._lookup_superseded = lambda seq: False
eq("캡처 오류 → skip(예전처럼 바로 읽음)", main._wait_for_tooltip(ATT, 1), "skip")

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
