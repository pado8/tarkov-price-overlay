"""툴팁 대기 자가 보정(11-09) + 포트 선점 대기 시험. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_tooltip_calib.py
판정기·캡처를 바꿔 끼워 '놓침 4번 연속 → 끔 → 30번마다 재확인 → 3번 맞으면 켬 → 파일로 다음 실행에 이어짐'을 본다."""
import os
import socket
import tempfile
import time
from pathlib import Path

os.environ.pop("TPO_TOOLTIP_WAIT", None)
import main  # noqa: E402

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


tmp = Path(tempfile.mkdtemp()) / "tooltip_wait.json"
main._tw_path = lambda: tmp
main._tw.update(loaded=False, off=False, hit=0, miss=0, streak=0, n_off=0, probe_hits=0)

# 판정기: 항상 '없음'(1080p 같은 PC)
seen = {"v": False, "calls": 0}
import tooltip_detect as td  # noqa: E402

td.has_tooltip = lambda img: (seen.__setitem__("calls", seen["calls"] + 1), seen["v"])[1]
td.has_label = lambda img: False
main.capture_region = lambda *a, **k: object()
attempts = [("primary", 0, 0, 10, 10), ("mirror", 20, 0, 10, 10), ("ground", 0, 20, 10, 10)]
main.TOOLTIP_WAIT_MAX_SEC = 0.12  # 시험은 짧게

t0 = time.perf_counter()
st = main._wait_for_tooltip(attempts, None)
eq("처음엔 기다린다(waited_none)", st, "waited_none")
eq("실제로 상한만큼 기다림", time.perf_counter() - t0 >= 0.1, True)

for i in range(3):
    main._tw_learn("waited_none", True, "primary")
eq("놓침 3번까진 켜진 채", main._tw_is_off(), False)
main._tw_learn("waited_none", True, "mirror")
eq("놓침 4번 연속 → 끔", main._tw_is_off(), True)
eq("파일에 저장됨", tmp.exists() and '"off": true' in tmp.read_text(encoding="utf-8"), True)

t0 = time.perf_counter()
st = main._wait_for_tooltip(attempts, None)
eq("꺼지면 안 기다리고 'off'", (st, time.perf_counter() - t0 < 0.05), ("off", True))
main._tw_learn("off", True, "primary")
eq("꺼진 동안 학습 안 함(hit/miss 그대로)", (main._tw["hit"], main._tw["miss"]), (0, 4))

# 재확인: 30번마다 판정만 — 판정기가 다시 보이기 시작하면 3번 맞고 켜짐(위에서 꺼진 채 한 번 불렀으니 카운터를 0 에서 다시)
main._tw.update(n_off=0, probe_hits=0)
seen["v"] = True
calls0 = seen["calls"]
for _ in range(29):
    main._wait_for_tooltip(attempts, None)
eq("29번까진 판정기 안 부름", seen["calls"], calls0)
for _ in range(2 * 30):
    main._wait_for_tooltip(attempts, None)
eq("60번 더(재확인 2번) → 아직 꺼짐(맞춘 횟수 2)", (main._tw_is_off(), main._tw["probe_hits"]), (True, 2))
for _ in range(30):
    main._wait_for_tooltip(attempts, None)
eq("재확인 3번 맞음 → 다시 켬", main._tw_is_off(), False)
eq("켜진 뒤 첫 판정은 '있음'", main._wait_for_tooltip(attempts, None), "present")

# 비율 규칙: 8번 중 6번 놓침(맞춘 적 있어도) → 끔
main._tw.update(off=False, hit=2, miss=0, streak=0)
for _ in range(6):
    main._tw_learn("waited_none", True, "primary")
eq("8번 중 6번(75%) 놓침 → 끔", main._tw_is_off(), True)

# 다음 실행: 파일에서 이어받음 / 보정 버전이 바뀌면 처음부터
main._tw.update(loaded=False, off=False, hit=0, miss=0)
eq("다음 실행도 파일의 '끔' 이어받음", main._tw_is_off(), True)
tmp.write_text(tmp.read_text(encoding="utf-8").replace('"calib": %d' % main.TW_CALIB_VERSION, '"calib": 0'), encoding="utf-8")
main._tw.update(loaded=False, off=False, hit=0, miss=0)
eq("보정 버전이 다르면 무시(켜진 채 시작)", main._tw_is_off(), False)

# 끈 플래그(TPO_TOOLTIP_WAIT=0)는 보정과 무관하게 skip
os.environ["TPO_TOOLTIP_WAIT"] = "0"
eq("TPO_TOOLTIP_WAIT=0 → skip", main._wait_for_tooltip(attempts, None), "skip")
os.environ.pop("TPO_TOOLTIP_WAIT", None)

# 포트 선점 대기
srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.bind(("127.0.0.1", 0))
port = srv.getsockname()[1]
srv.listen(1)
t0 = time.perf_counter()
main._wait_port_free(port, max_sec=1.2)
dt = time.perf_counter() - t0
eq("포트가 바쁘면 상한까지 기다렸다 넘어감", 1.0 <= dt <= 3.0, True)
srv.close()
t0 = time.perf_counter()
main._wait_port_free(port, max_sec=1.2)
eq("포트가 비면 바로", time.perf_counter() - t0 < 0.3, True)

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
