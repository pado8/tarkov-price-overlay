"""상인 재입고 시각(11-16) 시험 — 네트워크 없이. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_trader_reset.py
① ISO 시각 읽기 ② 문서 → 줄(이른 순, 시각 없는 상인 뺌, 이름 번역) ③ 언제 다시 받나(처음·2분 안엔 안 받음·지켜보는 상인이 지났을 때만·6시간)
④ 서비스: 받는 횟수가 늘지 않는다(주기 폴링 없음) ⑤ 값이 그대로면 stale ⑥ 받기 실패는 옛 값 + error."""
import trader_reset as T

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK  " if ok else "FAIL"), name, "" if ok else f"→ {got!r} (원했던 값 {want!r})")


eq("① ISO(Z)", T.parse_iso("2026-11-16T07:53:30.000Z"), 1794815610.0)
eq("① 깨진 값", [T.parse_iso(x) for x in ("", None, "soon", 123)], [None, None, None, None])

BASE = 1794815610  # 07:53:30


def doc(pr=0, th=170, sk=6000):
    return {"a": {"name": "a Nickname", "normalizedName": "prapor", "resetTime": T.datetime.fromtimestamp(BASE + pr, T.timezone.utc).isoformat().replace("+00:00", "Z")},
            "b": {"name": "b Nickname", "normalizedName": "therapist", "resetTime": T.datetime.fromtimestamp(BASE + th, T.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")},
            "c": {"name": "c Nickname", "normalizedName": "skier", "resetTime": T.datetime.fromtimestamp(BASE + sk, T.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")},
            "d": {"name": "d Nickname", "normalizedName": "fence"},  # 시각 없음
            "e": "garbage"}


rows = T.parse_rows(doc(), {"a Nickname": "프라퍼 ", "b Nickname": "테라피스트"})
eq("② 줄: 이른 순·시각 없는 상인 뺌", [(r["key"], r["reset"] - BASE) for r in rows], [("prapor", 0), ("therapist", 170), ("skier", 6000)])
eq("② 이름 번역(없으면 key)", [r["name"] for r in rows], ["프라퍼", "테라피스트", "skier"])

c = {"at": BASE - 1000, "rows": T.parse_rows(doc())}
eq("③ 캐시 없음 → 받는다", T.need_fetch(None, BASE), True)
eq("③ 아직 아무도 안 지남 → 안 받는다", T.need_fetch(c, BASE - 5), False)
eq("③ 지났지만 1분 전 → 안 받는다", T.need_fetch(c, BASE + 30), False)
eq("③ 지난 지 1분 → 받는다", T.need_fetch(c, BASE + 61), True)
eq("③ 방금 받았으면(2분 안) 지났어도 안 받는다", T.need_fetch({**c, "at": BASE + 10}, BASE + 100), False)
eq("③ 지켜보지 않는 상인이 지난 건 무시", T.need_fetch(c, BASE + 61, {"skier"}), False)
eq("③ 지켜보는 상인이 지나면 받는다", T.need_fetch(c, BASE + 6061, {"skier"}), True)
eq("③ 6시간 넘은 값은 받는다", T.need_fetch(c, BASE - 1000 + 6 * 3600 + 1, {"skier"}), True)

state = {"doc": doc(), "fail": False}


def fetch(mode):
    if state["fail"]:
        raise RuntimeError("net down")
    return state["doc"]


svc = T.TraderResets(fetch=fetch, names=lambda mode, lang: {"a Nickname": "Prapor"} if lang == "en" else {"a Nickname": "프라퍼"})
r = svc.get("regular", "ko", {"prapor", "skier"}, now=BASE - 600)
eq("④ 첫 호출: 받음 1번 + 고른 상인만", (svc.fetches, [(t["key"], t["name"]) for t in r["traders"]], r["stale"]), (1, [("prapor", "프라퍼"), ("skier", "skier")], False))
for dt in (-500, -300, -60, 0, 30):
    svc.get("regular", "ko", {"prapor", "skier"}, now=BASE + dt)
eq("④ 초기화 전·직후엔 몇 번을 물어도 다시 안 받는다", svc.fetches, 1)
r = svc.get("regular", "ko", {"prapor", "skier"}, now=BASE + 61)
eq("⑤ 1분 지나 다시 받음 — 값이 그대로면 stale", (svc.fetches, r["stale"]), (2, True))
r = svc.get("regular", "ko", {"prapor", "skier"}, now=BASE + 100)
eq("⑤ 2분 안엔 또 안 받는다", svc.fetches, 2)
state["doc"] = doc(pr=7200)
r = svc.get("regular", "ko", {"prapor", "skier"}, now=BASE + 61 + 121)
eq("⑤ 새 값이 오면 stale 풀림", (svc.fetches, r["stale"], r["traders"][0]["key"]), (3, False, "skier"))
eq("언어가 다르면 이름만 다름(다시 안 받음)", (svc.get("regular", "en", {"prapor"}, now=BASE + 200)["traders"][0]["name"], svc.fetches), ("Prapor", 3))
svc.get("pve", "ko", None, now=BASE + 200)
eq("모드가 다르면 따로 받는다", svc.fetches, 4)
state["fail"] = True
r = svc.get("regular", "ko", {"skier"}, now=BASE + 6000 + 61 + 500)
eq("⑥ 받기 실패 = 옛 값 + error", (len(r["traders"]), bool(r["error"]), r["stale"]), (1, True, True))
r = svc.get("regular", "ko", {"skier"}, now=BASE + 6000 + 61 + 560)
eq("⑥ 실패 뒤에도 2분 안엔 다시 안 받는다", r["error"], None)

print("실패", fails) if fails else print("전부 통과")
raise SystemExit(1 if fails else 0)
