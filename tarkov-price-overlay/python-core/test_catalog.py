"""카탈로그 소스 순서·디스크 스냅샷 테스트 — 네트워크 없이 fetch 함수를 바꿔 끼운다.
실행: PYTHONIOENCODING=utf-8 .venv\\Scripts\\python.exe test_catalog.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import time

TMP = tempfile.mkdtemp(prefix="tpo-catalog-")
os.environ["TPO_CATALOG_DIR"] = TMP
os.environ.pop("TPO_PRICE_SOURCE", None)

import tarkov_api as ta  # noqa: E402  (환경변수 뒤에 import)

FAILS = 0


def check(name: str, cond: bool) -> None:
    global FAILS
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        FAILS += 1


def fake_items(tag: str) -> list[dict]:
    return [
        {"id": "i1", "name": f"Salewa {tag}", "shortName": "Salewa", "types": ["meds"], "sellFor": [
            {"vendor": {"name": "Therapist"}, "priceRUB": 20000}, {"vendor": {"name": "Flea Market"}, "priceRUB": 30000}],
         "avg24hPrice": 30000, "width": 1, "height": 2, "weight": 0.2},
        {"id": "i2", "name": f"M4A1 {tag}", "shortName": "M4A1", "types": ["gun"], "sellFor": [
            {"vendor": {"name": "Mechanic"}, "priceRUB": 50000}], "avg24hPrice": 60000, "width": 4, "height": 1, "weight": 3.0},
    ]


calls: list[str] = []


def json_ok(lang, mode):
    calls.append("json")
    return fake_items("json"), ({}, []), None


def json_fail(lang, mode):
    calls.append("json")
    raise RuntimeError("json down")


def gql_ok(lang, mode):
    calls.append("graphql")
    return fake_items("gql")


def gql_fail(lang, mode):
    calls.append("graphql")
    raise RuntimeError("gql down")


def reset():
    with ta._price_cache_lock:
        ta._price_cache.clear()
        ta._price_cache_ts.clear()
        ta._price_cache_source.clear()
        ta._canon_cache.clear()
    calls.clear()


# json 폴백이 (items, idx, stations) 3-튜플을 돌려주므로 맞춘다
def json_ok3(lang, mode):
    calls.append("json")
    return fake_items("json"), {}, []


# 1) 기본 순서: json 먼저, 성공하면 GraphQL 은 안 부른다
reset()
ta._json_fetch_catalog = json_ok3
ta._graphql_fetch_items = gql_ok
n = ta._refresh_one("ko", "regular")
check("json 1순위로 채움(2개 + 별칭)", n >= 2 and calls == ["json"])
check("출처 json 기록", ta.catalog_age("ko", "regular")[1] == "json")
check("조회 가능", ta.has_price_cache("ko", "regular") and "Salewa json" in ta._price_cache[("ko", "regular")])

# 2) json 실패 → GraphQL 폴백
reset()
ta._json_fetch_catalog = json_fail
ta._graphql_fetch_items = gql_ok
# GraphQL 경로는 은신처를 따로 받는다 — 네트워크 없이 빈 값으로
ta._fetch_hideout_index = lambda lang: ({}, [])
n = ta._refresh_one("ko", "regular")
check("json 실패 시 GraphQL 폴백", calls == ["json", "graphql"] and "M4A1 gql" in ta._price_cache[("ko", "regular")])
check("출처 graphql 기록", ta.catalog_age("ko", "regular")[1] == "graphql")

# 3) 둘 다 실패 → 예외(기존 캐시는 그대로)
reset()
ta._json_fetch_catalog = json_fail
ta._graphql_fetch_items = gql_fail
try:
    ta._refresh_one("ko", "regular")
    check("둘 다 실패면 예외", False)
except Exception:
    check("둘 다 실패면 예외", True)

# 4) 스냅샷 왕복: 성공 갱신 → 파일 생김 → 캐시 비움 → load_snapshots 로 복원(source=disk, ts 보존)
reset()
ta._json_fetch_catalog = json_ok3
ta._refresh_one("en", "pve")
p = ta._snapshot_path("en", "pve")
check("스냅샷 파일 저장", p.exists() and p.stat().st_size > 50)
saved_ts = ta._price_cache_ts[("en", "pve")]
reset()
restored = ta.load_snapshots()
age, src = ta.catalog_age("en", "pve")
check("스냅샷 복원(en/pve 포함)", restored >= 1 and ta.has_price_cache("en", "pve"))
check("복원 출처 disk · 시각 보존", src == "disk" and abs(ta._price_cache_ts[("en", "pve")] - saved_ts) < 1)
check("복원 나이 계산", age is not None and age < 60)

# 5) 메모리에 이미 있으면 스냅샷이 덮지 않는다
ta._json_fetch_catalog = json_ok3
ta._refresh_one("en", "pve")  # 네트워크로 다시 채움(source json)
ta.load_snapshots()
check("네트워크 캐시 있으면 스냅샷이 덮지 않음", ta.catalog_age("en", "pve")[1] == "json")

# 6) 7일 넘은 스냅샷은 무시
reset()
old = time.time() - ta.SNAPSHOT_MAX_AGE_SEC - 10
os.utime(p, (old, old))  # mtime 은 안 보고 내용의 ts 를 본다 → 내용을 고쳐 쓴다
import gzip
import json

doc = json.load(gzip.open(p, "rt", encoding="utf-8"))
doc["ts"] = old
with gzip.open(p, "wt", encoding="utf-8") as f:
    json.dump(doc, f)
ta.load_snapshots()
check("오래된 스냅샷은 안 올림", not ta.has_price_cache("en", "pve"))

# 7) 상태 요약
reset()
ta._json_fetch_catalog = json_ok3
ta._refresh_one("ko", "pve")
st = ta.catalog_status()
check("상태 요약에 순서·카탈로그", st["order"] == ["json", "graphql"] and "ko/pve" in st["catalogs"] and st["catalogs"]["ko/pve"]["source"] == "json")

# 8) 순서 뒤집기 환경변수
os.environ["TPO_PRICE_SOURCE"] = "graphql"
check("TPO_PRICE_SOURCE=graphql 이면 GraphQL 먼저", ta._source_order() == ["graphql", "json"])
os.environ.pop("TPO_PRICE_SOURCE", None)

# 9) 같은 전체 이름 충돌 — 시세 없는 변형이 시세 있는 원본을 가리지 않는다(피드백 #52 진단)
reset()
ta._fetch_hideout_index = lambda lang: ({}, [])
orig = {"id": "59fb0428", "name": "물품 보관함 (Item case)", "shortName": "물품 보관함", "types": ["container"],
        "avg24hPrice": 900000, "sellFor": [], "width": 2, "height": 2, "weight": 1.0}
variant = {"id": "6a997ccf", "name": "물품 보관함 (Item case)", "shortName": "물품 보관함", "types": ["container", "noFlea"],
           "sellFor": [], "width": 2, "height": 2, "weight": 1.0}
for label, order in (("원본 먼저", [orig, variant]), ("변형 먼저", [variant, orig])):
    by = ta._install_catalog("ko", "regular", order, ({}, []), "json")
    check(f"충돌({label}): 전체 이름은 시세 있는 원본", by["물품 보관함 (Item case)"]["id"] == "59fb0428")
    check(f"충돌({label}): 짧은 이름 별칭도 원본", by["물품 보관함"]["id"] == "59fb0428")
a = dict(orig, id="a1", name="Same"); b = dict(orig, id="b2", name="Same")
check("둘 다 시세 있으면 예전대로 나중 것", ta._install_catalog("ko", "regular", [a, b], ({}, []), "json")["Same"]["id"] == "b2")
a2 = dict(variant, id="a1", name="Same2"); b2 = dict(variant, id="b2", name="Same2")
check("둘 다 시세 없으면 예전대로 나중 것", ta._install_catalog("ko", "regular", [a2, b2], ({}, []), "json")["Same2"]["id"] == "b2")

print("\n" + ("전부 통과" if FAILS == 0 else f"{FAILS}건 실패"))
sys.exit(1 if FAILS else 0)
