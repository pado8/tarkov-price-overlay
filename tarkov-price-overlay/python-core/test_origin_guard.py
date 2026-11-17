"""로컬 서버 출처·Host 방어 시험(11-17) — 서버를 띄우지 않고 앱을 직접 부른다. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_origin_guard.py
① 이 PC 주소로 온 요청은 그대로 ② 남의 도메인이 Host 로 실려 오면(DNS 리바인딩) 400 ③ 남의 출처의 /lookup·/catalog/active 는 403
④ 앱 웹뷰 출처·출처 없는 호출은 통과 ⑤ 자동 문서 페이지는 없음."""
import asyncio
import json

import main

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


def call(method, path, headers=None, body=b""):
    """ASGI 직접 호출 → 상태 코드. lifespan 은 돌리지 않는다(글자 인식 엔진을 올리지 않게)."""
    hs = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
             "path": path, "raw_path": path.encode(), "query_string": b"", "headers": hs,
             "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", 8765)}
    out = {}
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(msg):
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]

    asyncio.run(main.app(scope, receive, send))
    return out.get("status")


LOCAL = {"host": "127.0.0.1:8765"}
ACTIVE = json.dumps({"lang": "xx", "game_mode": "regular"}).encode()  # 모르는 언어 → 아무 일도 안 함
LOOKUP = json.dumps({"x": 0, "y": 0, "width": 10, "height": 10, "client_seq": 10 ** 18}).encode()

eq("① Host 127.0.0.1 → 통과", call("GET", "/health", LOCAL), 200)
eq("① Host localhost → 통과", call("GET", "/health", {"host": "localhost:8765"}), 200)
eq("① Host 없음(직접 호출) → 통과", call("GET", "/health"), 200)
eq("② 남의 도메인 Host → 400", call("GET", "/health", {"host": "evil.example:8765"}), 400)
eq("② 남의 도메인 Host 의 조회 → 400", call("POST", "/lookup", {"host": "evil.example:8765", "origin": "http://evil.example:8765"}, LOOKUP), 400)
eq("② 127.0.0.1 로 시작하는 남의 이름 → 400", call("GET", "/health", {"host": "127.0.0.1.evil.example"}), 400)

seq_before = main._lookup_seq
eq("③ 남의 출처의 /lookup(본문 형식 없음) → 403", call("POST", "/lookup", {**LOCAL, "origin": "https://evil.example"}, LOOKUP), 403)
eq("③ 조회 번호가 오염되지 않음", main._lookup_seq, seq_before)
eq("③ 출처 null(샌드박스 프레임) → 403", call("POST", "/lookup", {**LOCAL, "origin": "null"}, LOOKUP), 403)
eq("③ 남의 출처의 /catalog/active → 403", call("POST", "/catalog/active", {**LOCAL, "origin": "https://evil.example"}, ACTIVE), 403)
eq("③ 가이드 사이트 출처도 /lookup 은 못 부름", call("POST", "/lookup", {**LOCAL, "origin": "https://tarkov.aquapado.com"}, LOOKUP), 403)

JSON_H = {"content-type": "application/json"}
eq("④ 앱 웹뷰 출처의 /catalog/active → 200", call("POST", "/catalog/active", {**LOCAL, **JSON_H, "origin": "http://tauri.localhost"}, ACTIVE), 200)
eq("④ 출처 없는 호출(우리 도구) → 200", call("POST", "/catalog/active", {**LOCAL, **JSON_H}, ACTIVE), 200)

for p in ("/docs", "/redoc", "/openapi.json"):
    eq(f"⑤ {p} 없음", call("GET", p, LOCAL), 404)

print("실패 %d" % fails if fails else "전부 통과")
raise SystemExit(1 if fails else 0)
