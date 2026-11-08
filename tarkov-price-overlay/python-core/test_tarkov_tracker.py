"""TarkovTracker 연동(11-08) 시험. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_tarkov_tracker.py
진짜 토큰은 없어서 진행도 응답은 API 문서(api.tarkovtracker.org/openapi.json) 모양으로 흉내 낸다. 마지막 한 건만 실제 API 에
가짜 토큰을 보내 '토큰 틀림'(401)을 우리 오류 코드로 바꾸는지 본다(네트워크 없으면 건너뜀)."""
import tarkov_tracker as tt

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


WB = "5d484fc0654e76006657e0ab"  # 작업대 류의 24자 id(형식만 맞으면 됨)
MED = "5d484fcd654e7668ec2ec322"
eq("시설-레벨 id 해석", tt.station_level(f"{WB}-2"), (WB, 2))
eq("형식 다르면 None", tt.station_level("not-an-id"), None)
eq("레벨 두 자리", tt.station_level(f"{WB}-10"), (WB, 10))

progress = {"hideoutModulesProgress": [
    {"id": f"{WB}-1", "complete": True}, {"id": f"{WB}-2", "complete": True}, {"id": f"{WB}-3", "complete": False},
    {"id": f"{MED}-1", "complete": True}, {"id": "garbage", "complete": True}, "not-a-dict",
]}
eq("시설마다 완료된 가장 높은 레벨(미완료·이상한 줄 무시)", tt.hideout_levels(progress), {WB: 2, MED: 1})
eq("완료 기록 없으면 빈 값", tt.hideout_levels({"hideoutModulesProgress": [{"id": f"{WB}-1", "complete": False}]}), {})
eq("필드 없으면 빈 값", tt.hideout_levels({}), {})

eq("토큰 가리기(접두사 + 끝 4자)", tt.mask("PVE_abcdef1234567890"), "PVE_…7890")
eq("빈 토큰 가리기", tt.mask(""), "")
eq("토큰 형식 PVP_ 통과", bool(tt.TOKEN_RE.match("PVP_deadbeefcafefeed01")), True)
eq("옛 tt_ 토큰은 형식에서 거름(API 가 더는 안 받음)", bool(tt.TOKEN_RE.match("tt_deadbeefcafefeed01")), False)
eq("접두사 없는 토큰 거름", bool(tt.TOKEN_RE.match("deadbeefcafefeed01")), False)
eq("앱 모드 → TT 모드(season → seasonal)", (tt.APP_TO_TT["pvp"], tt.APP_TO_TT["pve"], tt.APP_TO_TT["season"]), ("pvp", "pve", "seasonal"))


# ETag·60초 간격 — requests.get 을 바꿔 끼워 304·호출 수를 본다
class FakeResp:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self._b, self.headers = status, body, headers or {}

    def json(self):
        return self._b


calls = []


def fake_get(url, headers=None, timeout=None):
    calls.append((url, dict(headers or {})))
    if headers.get("If-None-Match") == 'W/"v1"':
        return FakeResp(304)
    return FakeResp(200, {"success": True, "data": progress, "meta": {"self": "u", "gameMode": "pve"}}, {"ETag": 'W/"v1"'})


orig = tt.requests.get
tt.requests.get = fake_get
try:
    src = tt.TarkovTrackerSource("PVE_deadbeefcafefeed01")
    d1 = src.progress()
    d2 = src.progress()  # 60초 안 → 호출 안 함
    eq("60초 안 두 번째 호출은 네트워크 안 씀", len(calls), 1)
    eq("모드는 meta.gameMode", d1.get("_game_mode"), "pve")
    d3 = src.progress(force=True)  # 강제 → If-None-Match 로 304 → 지난 값
    eq("강제 새로고침은 If-None-Match 를 보냄", calls[-1][1].get("If-None-Match"), 'W/"v1"')
    eq("304 면 지난 값 그대로", tt.hideout_levels(d3), {WB: 2, MED: 1})
    eq("Authorization Bearer 헤더", calls[0][1].get("Authorization"), "Bearer PVE_deadbeefcafefeed01")
    eq("토큰은 우리 서버로 안 감(호출 주소는 TarkovTracker 만)", all(u.startswith("https://api.tarkovtracker.org/") for u, _ in calls), True)
finally:
    tt.requests.get = orig

# 실제 API — 가짜 토큰 → bad_token
try:
    tt.TarkovTrackerSource("PVP_" + "0" * 24).token_info()
    eq("가짜 토큰이 거부됨", "통과됨", "bad_token")
except tt.TrackerError as e:
    if e.code == "network":
        print("   (네트워크 없음 — 실제 API 확인 건너뜀)")
    else:
        eq("실제 API: 가짜 토큰 → bad_token", e.code, "bad_token")

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
