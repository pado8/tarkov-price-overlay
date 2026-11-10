"""지도 자료 보내기(map_share, 11-09) 시험 — 네트워크 없이, 상태 폴더는 임시 폴더로. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_map_share.py [친구 스크립트 결과 json]
① 줄 형식 = '프리셋|x, y, z_qx, qy, qz, qw'(날짜·시각 없음), 좌표 없는 스크린샷·다른 파일은 뺌, 같은 줄은 하나
② 맵 판정 = 저장 시각 +5초 안의 가장 늦은 로딩, 2시간 넘으면(맵 모름) 줄에서 뺌 ③ 보기: 새 줄 수·맵별·앞 5줄·익명 ID 유지
④ 보내기: 본문에 익명 ID·v2·새 줄만, 설치 ID 없음 → 보낸 줄은 다음에 안 보냄 ⑤ 자동은 3시간 간격(11-10 12→3), '지금 보내기'는 무시
⑥ 실패하면 기록 안 함(다음에 다시) ⑦ 지우기 요청 = DELETE ?id=, 성공하면 새 익명 ID·빈 기록, 실패하면 그대로
⑧ (인자로 주면) 친구용 스크립트 결과와 줄 단위로 같음."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import map_share as M

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK  " if ok else "FAIL"), name, "" if ok else f"→ {got!r} (원했던 값 {want!r})")


tmp = Path(tempfile.mkdtemp(prefix="mapshare-test-"))
M._state_dir = lambda: tmp  # 실제 %LOCALAPPDATA% 상태는 건드리지 않는다
shots = tmp / "shots"
shots.mkdir()
T0 = 1_800_000_000.0


def shot(name, ts):
    p = shots / name
    p.write_bytes(b"x")
    os.utime(p, (ts, ts))


A = "2026-11-01[12-00]_100.5, 2.0, -30.25_0.1, 0.2, 0.3, 0.9_1.5 (0).png"
B = "2026-11-01[12-01]_101.5, 2.0, -31.25_0.1, 0.2, 0.3, 0.9_1.5 (0).png"
C = "2026-11-01[15-00]_5.0, 0.0, 5.0_0, 0, 0, 1_0.0 (0).png"  # 로딩 뒤 2시간 넘음
shot(A, T0 + 60)
shot(B, T0 + 120)
shot(C, T0 + 3 * 3600)
shot("2026-11-01[12-02] menu.png", T0 + 130)  # 좌표 없음
(shots / "notes.txt").write_text("x")
EV = [(T0, "customs_preset", "customs"), (T0 + 200, "factory_day_preset", "factory")]

lines = M.build_lines(shots, EV)
eq("① 줄 2개(메뉴·txt·맵 모르는 것 제외)", len(lines), 2)
eq("① 형식", "customs_preset|100.5, 2.0, -30.25_0.1, 0.2, 0.3, 0.9" in lines, True)
eq("① 날짜·시각 없음", any("2026" in l or "[" in l for l in lines), False)
eq("② 2시간 넘은 건(맵 모름) 줄에 없음", any("5.0, 0.0, 5.0_0, 0, 0, 1" in l for l in lines), False)
eq("② 프리셋 칸이 빈 줄 없음", any(l.startswith("|") for l in lines), False)
eq("② 로딩 기록이 하나도 없으면 줄 0개", M.build_lines(shots, []), [])
eq("② 모르는 프리셋 이름(새 맵)은 그대로 보냄", M.build_lines(shots, [(T0, "newmap_preset", "")]), [
    "newmap_preset|100.5, 2.0, -30.25_0.1, 0.2, 0.3, 0.9", "newmap_preset|101.5, 2.0, -31.25_0.1, 0.2, 0.3, 0.9"])
shot("2026-11-01[12-05]_100.5, 2.0, -30.25_0.1, 0.2, 0.3, 0.9_1.5 (1).png", T0 + 300)  # 같은 좌표, 다른 파일 → 로딩 factory 뒤
eq("① 같은 좌표라도 맵이 다르면 다른 줄", len(M.build_lines(shots, EV)), 3)
(shots / "2026-11-01[12-05]_100.5, 2.0, -30.25_0.1, 0.2, 0.3, 0.9_1.5 (1).png").unlink()

pv = M.preview(lines)
eq("③ 새 줄 2", (pv["total"], pv["new"]), (2, 2))
eq("③ 맵별", pv["maps"], {"customs_preset": 2})
eq("③ 익명 ID 가 저장돼 다음에도 같음", M.preview(lines)["anon_id"], pv["anon_id"])

calls = []


def http_ok(method, url, body):
    calls.append((method, url, json.loads(body) if body else None))
    if method == "DELETE":
        return 200, {"ok": True, "deleted": 2}
    return 200, {"ok": True, "n": len(json.loads(body)["shots"])}


r = M.send(force=True, lines=lines, http=http_ok, now=T0)
eq("④ 보냄 2", r, {"ok": True, "sent": 2})
body = calls[-1][2]
eq("④ 본문 키", sorted(body), ["id", "shots", "v"])
eq("④ 익명 ID·v2", (body["id"], body["v"]), (pv["anon_id"], 2))
eq("④ 설치 ID 같은 값 없음", "install" in json.dumps(body), False)
eq("④ 다시 보내면 0(이미 보냄)", M.send(force=True, lines=lines, http=http_ok, now=T0 + 10), {"ok": True, "sent": 0})
more = lines + ["customs_preset|1.0, 1.0, 1.0_0, 0, 0, 1"]
eq("⑤ 자동은 3시간 안이면 건너뜀(1시간 뒤)", M.send(lines=more, http=http_ok, now=T0 + 3600)["skipped"], "interval")
eq("⑤ 자동은 3시간 안이면 건너뜀(2시간 59분 뒤)", M.send(lines=more, http=http_ok, now=T0 + 10 + 3 * 3600 - 60)["skipped"], "interval")
eq("⑤ 3시간 지나면 새 줄만(4시간 뒤)", M.send(lines=more, http=http_ok, now=T0 + 4 * 3600), {"ok": True, "sent": 1})
eq("⑤ 보낸 줄은 새 줄 1개뿐", calls[-1][2]["shots"], ["customs_preset|1.0, 1.0, 1.0_0, 0, 0, 1"])

more2 = more + ["customs_preset|2.0, 2.0, 2.0_0, 0, 0, 1"]
r = M.send(force=True, lines=more2, http=lambda m, u, b: (503, {"error": "busy"}), now=T0 + 14 * 3600)
eq("⑥ 실패", (r["ok"], r["sent"]), (False, 0))
eq("⑥ 실패한 줄은 다음에 다시", M.preview(more2)["new"], 1)
r = M.send(force=True, lines=more2, http=lambda m, u, b: (_ for _ in ()).throw(OSError("offline")), now=T0 + 14 * 3600)
eq("⑥ 네트워크 오류도 실패로", r["ok"], False)

old_id = M.load_state()["anon_id"]
r = M.forget(http=lambda m, u, b: (500, {"error": "x"}))
eq("⑦ 지우기 실패 → 그대로", (r["ok"], M.load_state()["anon_id"]), (False, old_id))
r = M.forget(http=http_ok)
eq("⑦ 지우기 요청 = DELETE ?id=익명 ID", (calls[-1][0], calls[-1][1].endswith(f"?id={old_id}")), ("DELETE", True))
st = M.load_state()
eq("⑦ 새 익명 ID·빈 기록", (st["anon_id"] != old_id, st["sent"], st["last_send"]), (True, [], 0))
eq("⑦ 지운 뒤엔 전부 새 줄", M.preview(more2)["new"], len(more2))

if len(sys.argv) > 1:
    # ⑧ 친구용 스크립트 결과(같은 PC·같은 폴더)와 비교 — 실제 스크린샷 폴더·로그로
    friend = json.load(open(sys.argv[1], encoding="utf-8-sig"))["shots"]
    t = time.time()
    real = M.build_lines()
    eq(f"⑧ 친구용 스크립트와 같은 줄({len(real)}줄, {time.time() - t:.1f}초)", sorted(real), sorted(friend))

print("\n실패", fails)
raise SystemExit(1 if fails else 0)
