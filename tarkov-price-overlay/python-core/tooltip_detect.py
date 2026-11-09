"""캡처 조각 안에 EFT 툴팁 패널(또는 바닥 이름표)이 '떠 있는지' 판정 — 11-04.

왜: 인벤토리에서는 아이템에 마우스를 올리고 잠깐 뒤에야 이름 툴팁이 뜬다. 그 전에 F2 를 누르면 캡처 상자에 툴팁 대신
인벤토리 칸 글자(짧은 이름·개수)가 찍혀 엉뚱한 아이템으로 매칭되거나 못 찾는다(사용자는 '인식을 못한다'로 느낌).
조회 직전에 툴팁이 떠 있는지 보고, 없으면 잠깐 기다렸다 다시 찍는다(main.py _wait_for_tooltip).

판정(11-03 게임 스크린샷 실측, 1.3.0): 툴팁 안쪽은 순검정(회색값 중앙 0), 둘레 1px 테두리는 87 안팎으로 일정하다.
인벤토리 장비 칸·빈 칸도 어둡지만 바탕이 10~28 로 순검정이 아니고 87 테두리가 없다. 그래서
  툴팁  = 순검정 덩어리(어두운 픽셀 중앙 ≤ 6) + 밝은 글자 + 잘리지 않은 면 중 하나 이상이 87 테두리
  이름표 = 순검정 덩어리 + 밝은 글자(바닥 아이템 이름표는 테두리 없음)
닫힘 연산은 쓰지 않는다(1px 테두리가 메워져 바깥 어두운 영역과 합쳐진다). 캡처 상자에 툴팁이 잘려 들어오는 경우가 많아
가장자리에 닿은 덩어리는 가로세로 비율을 따지지 않는다. 거래 화면의 'SPACE 거래하기' 패널(바탕 24)은 툴팁이 아니다.

빗나가도 안전한 방향: 없는 툴팁을 '있다'고 보면 지금처럼 바로 읽고, 있는 툴팁을 '없다'고 보면 최대 대기 시간만큼 늦어질 뿐이다.

11-09 문턱 넓힘(통계: 1.2.7 뒤 같은 설치 64곳의 중간 응답 350→829ms, 1920x1080 은 920ms — 그 화면에선 판정이 늘 '없음'이라 조회마다
상한 0.6초를 다 기다림. 2560x1440·2880x1620 만 정상). 원래 문턱은 이 PC(1440p) 한 곳의 실측에 딱 붙어 있었다: 글자 픽셀(>150) 비율의
중앙이 1.6% 인데 하한이 1%, 테두리는 76~98. 다른 화면 높이는 UI 가 줄거나 커져 글자 획·1px 테두리가 섞인 색으로 그려진다.
이 PC 캡처(툴팁 544장·인벤토리 조각 960장)를 0.75~1.5배로 바꿔 비교(dev/…audit tip_eval): 원래 규칙은 원본 94.7% → 그 밖 0.4~9.6%,
새 규칙(글자 >110 이 1.5% 이상, 테두리 중앙 55~110 + 그 ±18 안에 70%)은 전 배율 93.6~94.7%, 인벤토리 오탐 0.6% → 1.0~1.4%.
바닥 이름표(테두리 없음) 쪽은 넓혀도 검출이 안 늘고 오탐만 늘어 그대로 둔다. 실화면(1080p)으로는 미확인 — 빗나가는 PC 는
main.py 의 자가 보정이 받는다.
"""
from __future__ import annotations

import numpy as np

try:
    import cv2
except Exception:  # noqa: BLE001 — cv2 가 없으면 판정 불가 → 호출부가 '있다'로 취급
    cv2 = None

DARK_MAX = 32  # 덩어리로 묶을 어두운 픽셀 상한
PURE_MED_MAX = 6  # 툴팁 바탕 = 순검정(어두운 픽셀 중앙값, 실측 0)
LABEL_MED_MAX = 10  # 바닥 이름표 바탕(실측 7)
BRIGHT_MIN = 150  # 글자 픽셀 하한(바닥 이름표)
BRIGHT_FRAC_MIN = 0.01
TIP_BRIGHT_MIN = 110  # 툴팁 글자 픽셀 하한 — 작은 UI 의 가는 획은 150 을 못 넘는다(11-09)
TIP_BRIGHT_FRAC_MIN = 0.015
BORDER_LO, BORDER_HI = 55, 110  # 툴팁 테두리(1440p 에서 87) 허용 범위 — 다른 화면 높이에선 배경과 섞여 50~70대·100 안팎(11-09, 전 76~98)
BORDER_TOL = 18  # 테두리 선은 '고른 회색': 선의 70% 이상이 중앙값 ±이 안


def _gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    if image.shape[-1] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _border_sides(g: np.ndarray, x: int, y: int, w: int, h: int) -> int:
    """덩어리 바로 바깥 1px 선 중 '87 테두리'인 면의 수(이미지 가장자리에 잘린 면은 세지 않는다)."""
    H, W = g.shape[:2]
    sides = []
    if y - 1 >= 0:
        sides.append(g[y - 1, x:x + w])
    if y + h < H:
        sides.append(g[y + h, x:x + w])
    if x - 1 >= 0:
        sides.append(g[y:y + h, x - 1])
    if x + w < W:
        sides.append(g[y:y + h, x + w])
    n = 0
    for s in sides:
        if not s.size:
            continue
        med = float(np.median(s))
        if BORDER_LO <= med <= BORDER_HI and float((np.abs(s.astype(np.int16) - med) <= BORDER_TOL).mean()) >= 0.7:
            n += 1
    return n


def find_panel(image: np.ndarray | None, need_border: bool = True) -> dict | None:
    """툴팁 패널(need_border=True) 또는 바닥 이름표(False)처럼 보이는 덩어리. 없으면 None.

    image: mss 캡처(BGRA) 또는 BGR·회색. 크기 기준은 상자 높이 대비 비율이라 해상도·UI 배율과 무관하다.
    """
    if image is None or cv2 is None or image.size == 0:
        return None
    g = _gray(image)
    H, W = g.shape[:2]
    dark = (g < DARK_MAX).astype(np.uint8)
    n, _lab, st, _ = cv2.connectedComponentsWithStats(dark, 8)
    min_h = max(10, int(H * 0.14))
    min_w = max(28, int(W * 0.07))
    best = None
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in st[i])
        if h < min_h or w < min_w:
            continue
        if area / float(w * h) < 0.55:
            continue
        touches = x <= 0 or y <= 0 or x + w >= W or y + h >= H
        if not touches and w < 1.6 * h:
            continue
        inner = g[y:y + h, x:x + w]
        darkpx = inner[inner < DARK_MAX]
        if darkpx.size == 0 or float(np.median(darkpx)) > (PURE_MED_MAX if need_border else LABEL_MED_MAX):
            continue  # 순검정이 아니다(장비 칸·빈 칸·거래 패널)
        bright = float((inner > (TIP_BRIGHT_MIN if need_border else BRIGHT_MIN)).mean())
        if bright < (TIP_BRIGHT_FRAC_MIN if need_border else BRIGHT_FRAC_MIN) or bright > 0.45:
            continue
        sides = _border_sides(g, x, y, w, h)
        if need_border and sides < 1:
            continue
        cand = {"x": x, "y": y, "w": w, "h": h, "bright": round(bright, 3), "touches": touches, "border": sides}
        if best is None or w * h > best["w"] * best["h"]:
            best = cand
    return best


def has_tooltip(image: np.ndarray | None) -> bool:
    """인벤토리 툴팁이 캡처에 있나. 판정 불가(cv2 없음·빈 이미지)는 True — 기다리지 않고 지금처럼 읽게."""
    if image is None or cv2 is None or getattr(image, "size", 0) == 0:
        return True
    return find_panel(image, need_border=True) is not None


def has_label(image: np.ndarray | None) -> bool:
    """레이드 바닥 아이템 이름표(검은 상자 + 흰 글자)가 캡처에 있나. 판정 불가는 True."""
    if image is None or cv2 is None or getattr(image, "size", 0) == 0:
        return True
    return find_panel(image, need_border=False) is not None
