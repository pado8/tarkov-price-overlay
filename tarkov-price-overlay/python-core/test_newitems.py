"""패치 직후 새 아이템 대응 시험(11-04). 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_newitems.py
① 못 찾음 → 카탈로그 즉시 재갱신(5분 제한·진행 중·방금 갱신이면 생략) ② 플리 금지 표시(no_flea) ③ 게임 업데이트 뒤 시간."""
import os
import sys
import tempfile
import time
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="tpo-newitems-"))
os.environ["LOCALAPPDATA"] = str(tmp)
os.environ["TPO_CATALOG_DIR"] = str(tmp / "catalog")

import tarkov_api as ta  # noqa: E402
import main  # noqa: E402

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


def item(i, name, types, avg=None, sell=()):
    return {"id": i, "name": name, "shortName": name[:6], "types": list(types), "avg24hPrice": avg,
            "sellFor": [{"vendor": {"name": v}, "priceRUB": p} for v, p in sell], "width": 1, "height": 1, "weight": 0.1}


ta._fetch_hideout_index = lambda lang: ({}, [])
ITEMS = [item("pumpkin", "Pumpkin with sweets", ["noFlea"]), item("newgun", "Brand new rifle", ["gun"]),
         item("salewa", "Salewa first aid kit", ["meds"], 30000, [("Therapist", 7000)])]

# ② 플리 금지 표시
by = ta._install_catalog("en", "pve", ITEMS, ({}, []), "json")
eq("플리 금지 아이템 → no_flea True", by["Pumpkin with sweets"]["no_flea"], True)
eq("플리 가능한데 시세 없음(새 아이템) → no_flea False", by["Brand new rifle"]["no_flea"], False)
eq("시세 있는 아이템 → no_flea False", by["Salewa first aid kit"]["no_flea"], False)
r = main._build_response("Pumpkin", {**by["Pumpkin with sweets"], "name": "Pumpkin with sweets"}, "pve", lang="en")
eq("응답에 no_flea 전달", (r.no_flea, r.catalog_refreshing, r.game_updated_hours), (True, False, None))
r = main._build_response("x", {"name": None}, "pve", lang="en", catalog_refreshing=True, game_updated_hours=5)
eq("못 찾음 응답에 재갱신·업데이트 시간 전달", (r.no_flea, r.catalog_refreshing, r.game_updated_hours), (None, True, 5))

# ① 재갱신 요청
calls = []


def fake_refresh(lang, gm):
    calls.append((lang, gm))
    time.sleep(0.2)
    ta._install_catalog(lang, gm, ITEMS + [item("newpatch", "Patch item", ["barter"])], ({}, []), "json")
    return 4


ta._refresh_one = fake_refresh
with ta._price_cache_lock:
    ta._price_cache_ts[("en", "pve")] = time.time() - 600  # 10분 전 갱신
eq("오래된 목록 → 재갱신 시작", ta.request_catalog_refresh("en", "pve"), True)
eq("진행 중 → 받는 중(True)", (ta.catalog_refresh_running("en", "pve"), ta.request_catalog_refresh("en", "pve")), (True, True))
time.sleep(0.5)
eq("끝나면 진행 중 아님 · 한 번만 받음", (ta.catalog_refresh_running("en", "pve"), len(calls)), (False, 1))
eq("새로 들어온 아이템이 바로 잡힘", ta.get_item_price("Patch item", lang="en", game_mode="pve", allow_cold=False).get("id"), "newpatch")
eq("5분 안에 또 → 안 받음", ta.request_catalog_refresh("en", "pve"), False)
with ta._price_cache_lock:
    ta._price_cache_ts[("ko", "pve")] = time.time() - 30  # 방금 정기 갱신
eq("방금 갱신된 목록 → 안 받음", ta.request_catalog_refresh("ko", "pve"), False)

# 못 찾음 뒤 콜드 구제 = 재갱신 요청만, 결과는 None
asked = []
ta.request_catalog_refresh = lambda lang, gm: asked.append((lang, gm)) or True
eq("못 찾음 → 재갱신 요청하고 None", (main._cold_rescue(["Some new item"], "en", "pve", {}), asked), (None, [("en", "pve")]))
asked.clear()
eq("짧은 글자뿐이면 요청 안 함", (main._cold_rescue(["ab", " "], "en", "pve", {}), asked), (None, []))

# ③ 게임 업데이트 뒤 시간
now = time.time()
fmt = lambda h: time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now - h * 3600))
eq("이전 버전 기록 없음 → 모름(None)", main._hours_since_version_change([(fmt(30), "1.3.0"), (fmt(2), "1.3.0")], now), None)
eq("5시간 전 새 버전 → 5", main._hours_since_version_change([(fmt(80), "1.2.9"), (fmt(5.2), "1.3.0"), (fmt(1), "1.3.0")], now), 5)
eq("3일 전 새 버전 → 안내 안 함", main._hours_since_version_change([(fmt(100), "1.2.9"), (fmt(72), "1.3.0")], now), None)
eq("기록 없음 → None", main._hours_since_version_change([], now), None)
eq("핫픽스(넷째 자리)만 바뀜 → 안내 안 함", main._hours_since_version_change([(fmt(40), "1.3.0.0.48484"), (fmt(10), "1.3.0.1.48558")], now), None)
eq("1.3.0.1 핫픽스 뒤여도 1.3.0 으로 바뀐 시각 기준", main._hours_since_version_change(
    [(fmt(90), "1.2.5.0.48146"), (fmt(30), "1.3.0.0.48484"), (fmt(10), "1.3.0.1.48558")], now), 30)

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
