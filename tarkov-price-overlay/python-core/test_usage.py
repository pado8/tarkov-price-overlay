"""거래 불가 아이템 쓰임새(11-06) 시험. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_usage.py
① 표(data/item_usage.json) 형식 — 6개 · 네 언어 · 작은따옴표 없음 ② 응답에 usage·is_event·guide_page 실림
③ 표에 없는 아이템(시세 있는 아이템)은 그대로 ④ 가이드 색인 usage 목록."""
import json
import os
import sys
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="tpo-usage-"))
os.environ["LOCALAPPDATA"] = str(tmp)
os.environ["TPO_CATALOG_DIR"] = str(tmp / "catalog")

import guide_index  # noqa: E402
import item_usage  # noqa: E402
import main  # noqa: E402

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


TOP6 = ["634959225289190e5e773b3b", "6a426fbe99757acd420f64b0", "69dd0de23dfe95d9e70b5ebb",
        "5732ee6a24597719ae0c0281", "68f8e04eae031982b00e7aaf", "6a997c025aec2a3abc08b152"]

# ① 표 형식
doc = json.loads((Path(__file__).parent / "data" / "item_usage.json").read_text(encoding="utf-8"))
eq("표에 시세 없음 상위 6개", sorted(doc["items"]), sorted(TOP6))
bad = [(i, k) for i, e in doc["items"].items() for u in e["uses"] for k in item_usage.LANGS if not u.get(k)]
eq("모든 줄에 네 언어", bad, [])
eq("작은따옴표 없음", [i for i, e in doc["items"].items() if "'" in json.dumps(e["uses"], ensure_ascii=False)], [])
eq("이벤트 표시는 호박만", [i for i, e in doc["items"].items() if e.get("event")], ["634959225289190e5e773b3b"])

# ② 응답
base = {"id": "634959225289190e5e773b3b", "name": "Pumpkin with sweets", "no_flea": True}
r = main._build_response("Pumpkin", base, "regular", lang="ko")
eq("호박 응답 usage 2줄", len(r.usage), 2)
eq("호박 is_event", r.is_event, True)
eq("호박 guide_page = usage(색인 없어도)", r.guide_page, "usage")
eq("zh 문구 실림", r.usage[1]["zh"].startswith("在邪教徒法阵"), True)

# ③ 표에 없는 아이템은 그대로
r = main._build_response("Salewa", {"id": "544fb45d4bdc2dee738b4568", "name": "Salewa", "flea": 30000}, "regular", lang="ko")
eq("시세 있는 아이템 usage 비어 있음", (r.usage, r.is_event, r.guide_page), ([], False, None))

# ④ 가이드 색인
guide_index.load_from_dict({"updated": "x", "items": ["a"], "keys": ["b"], "usage": ["c", "a"]})
eq("색인: 필요 아이템이 쓰임새보다 먼저", guide_index.page_for("a"), "items")
eq("색인: 쓰임새만", guide_index.page_for("c"), "usage")
eq("색인: 옛 형식(usage 없음)도 읽음", guide_index.load_from_dict({"items": ["a"], "keys": []}), 1)

# ⑤ 같은 이름 충돌 — 상인 판매가만 있는 원본(의약품 보관함)이 거래 불가 변형에 가려지지 않아야
import tarkov_api as ta  # noqa: E402

ta._fetch_hideout_index = lambda lang: ({}, [])


def item(i, name, types, avg=None, sell=()):
    return {"id": i, "name": name, "shortName": name[:6], "types": list(types), "avg24hPrice": avg,
            "sellFor": [{"vendor": {"name": v}, "priceRUB": p} for v, p in sell], "width": 3, "height": 3, "weight": 1}


orig = item("5aafbcd986f7745e590fff23", "의약품 보관함", ["container", "noFlea"], sell=[("Therapist", 243653)])
var = item("6a997c025aec2a3abc08b152", "의약품 보관함", ["container", "noFlea"])
by = ta._install_catalog("ko", "regular", [orig, var], ({}, []), "json")
eq("원본(상인가 있음)이 변형보다 우선", by["의약품 보관함"]["id"], "5aafbcd986f7745e590fff23")
by = ta._install_catalog("ko", "regular", [var, orig], ({}, []), "json")
eq("순서 바뀌어도 원본", by["의약품 보관함"]["id"], "5aafbcd986f7745e590fff23")
g1 = item("5857a8bc2459772bad15db29", "Secure container Gamma", ["noFlea"])
g2 = item("68f8e04eae031982b00e7aaf", "Secure container Gamma", ["noFlea"])
by = ta._install_catalog("en", "regular", [g1, g2], ({}, []), "json")
eq("둘 다 시세 없으면 예전대로 나중 것", by["Secure container Gamma"]["id"], "68f8e04eae031982b00e7aaf")

print("\n실패", fails)
sys.exit(1 if fails else 0)
