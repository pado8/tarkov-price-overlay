"""지도 문서 디스크 캐시(11-08) 시험 — 네트워크 없이 tarkov_json_fallback._get 을 가짜로 바꿔 호출 수를 센다.
실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_mapdata_cache.py
① 처음 = 네트워크 1번 + 디스크 저장 ② 재시작(메모리 비움) = 디스크만 ③ 6시간 지난 사본 = 바로 쓰고 뒤에서 1번 새로 받기
④ 7일 지난 사본 = 네트워크 ⑤ 깨진 사본 = 네트워크로 대신 ⑥ 받기 실패해도 디스크 사본으로 계속."""
import os
import tempfile
import time
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="tpo-mapdata-"))
os.environ["LOCALAPPDATA"] = str(tmp)

import radar  # noqa: E402
import tarkov_json_fallback as tj  # noqa: E402

fails = 0
calls = []
fail_net = [False]


def fake_get(path):
    calls.append(path)
    if fail_net[0]:
        raise RuntimeError("offline")
    return {"data": {"maps": {"customs": {"n": len(calls)}}}}


tj._get = fake_get


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


def restart():
    with radar._data_lock:
        radar._data.clear()


def wait_bg():
    for _ in range(100):
        with radar._data_lock:
            if not radar._doc_refreshing:
                return
        time.sleep(0.02)


P = "regular/maps"
d = radar._doc(P)
eq("① 처음 = 네트워크 1번", (len(calls), d["maps"]["customs"]["n"]), (1, 1))
eq("① 디스크에 저장", radar._doc_file(P).exists(), True)
radar._doc(P)
eq("① 같은 실행 두 번째 = 메모리", len(calls), 1)

restart()
d = radar._doc(P)
eq("② 재시작 = 디스크만(네트워크 0)", (len(calls), d["maps"]["customs"]["n"]), (1, 1))

restart()
f = radar._doc_file(P)
old = time.time() - radar._DATA_TTL - 60
os.utime(f, (old, old))
d = radar._doc(P)
eq("③ 6시간 지난 사본 = 바로 옛 값", d["maps"]["customs"]["n"], 1)
wait_bg()
eq("③ 뒤에서 1번 새로 받음", len(calls), 2)
eq("③ 새 값이 메모리에", radar._doc(P)["maps"]["customs"]["n"], 2)

restart()
old = time.time() - radar._DOC_DISK_MAX_AGE - 60
os.utime(f, (old, old))
d = radar._doc(P)
eq("④ 7일 지난 사본 = 네트워크", (len(calls), d["maps"]["customs"]["n"]), (3, 3))

restart()
f.write_bytes(b"not gzip")
d = radar._doc(P)
eq("⑤ 깨진 사본 = 네트워크로 대신", (len(calls), d["maps"]["customs"]["n"]), (4, 4))

restart()
old = time.time() - radar._DATA_TTL - 60
os.utime(f, (old, old))
fail_net[0] = True
d = radar._doc(P)
wait_bg()
eq("⑥ 뒤에서 받기 실패 → 디스크 사본으로 계속", d["maps"]["customs"]["n"], 4)
eq("⑥ 실패해도 사본은 그대로", radar._doc(P)["maps"]["customs"]["n"], 4)

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
