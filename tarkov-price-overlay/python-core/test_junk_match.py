"""빈 곳 조회 잡문자열 회귀 시험(2026-11-04) — 2~3글자 OCR 잡문자열이 정규화·퍼지로 짧은 이름 아이템에 붙지 않아야 하고,
정상 짧은 이름(정확 일치)·긴 이름의 1글자 오독(정규화·퍼지)은 그대로 잡혀야 한다. 실행: .venv/Scripts/python.exe test_junk_match.py"""
from __future__ import annotations

import os
import sys
import tempfile

os.environ["TPO_CATALOG_DIR"] = tempfile.mkdtemp(prefix="tpo-junk-")  # 실제 스냅샷을 건드리지 않게
sys.path.insert(0, os.path.dirname(__file__))
import tarkov_api as ta  # noqa: E402

FAILS = 0


def check(name: str, cond: bool) -> None:
    global FAILS
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        FAILS += 1


def item(i: str, name: str, short: str) -> dict:
    return {"id": i, "name": name, "shortName": short, "types": ["misc"], "avg24hPrice": 1000, "width": 1, "height": 1, "weight": 0.1,
            "sellFor": [{"vendor": {"name": "Flea Market"}, "priceRUB": 1000}]}


ITEMS = [
    item("l1", "L1 (Norepinephrine) injector", "L1"),
    item("rub", "Roubles", "RUB"),
    item("pm", "Makarov PM 9x18PM pistol", "PM"),
    item("usec", "Dogtag USEC", "USEC"),
    item("ap", ".45 ACP AP", "AP"),
    item("m4", "Colt M4A1 5.56x45 assault rifle", "M4A1"),
    item("bolts", "Bolts", "Bolts"),
    item("ifak", "IFAK individual first aid kit", "IFAK"),
    item("sp", "Aimpoint spacer", "SS"),
]

ta._json_fetch_catalog = lambda lang, mode: (ITEMS, {}, [])
ta._graphql_fetch_items = lambda lang, mode: ITEMS
ta._refresh_one("en", "regular")


def hit(text: str) -> str | None:
    r = ta._cache_lookup(text, "en", "regular", None)
    return r.get("id") if r else None


# 잡문자열 — 예전엔 전부 무언가에 붙었다
for junk, was in (("ll", "l1"), ("Il", "l1"), ("1l", "l1"), ("ss", "sp"), ("RU", "rub"), ("PMC", "pm"), ("USE", "usec")):
    got = hit(junk)
    check(f"잡문자열 {junk!r} → 매칭 없음 (예전: {was})", got is None)

# 정상 — 정확 일치는 길이와 상관없이 그대로
for text, want in (("L1", "l1"), ("AP", "ap"), ("RUB", "rub"), ("PM", "pm"), ("USEC", "usec"), ("SS", "sp")):
    check(f"정확 일치 {text!r} → {want}", hit(text) == want)

# 정상 — 4글자 이상 1글자 오독은 정규화·퍼지로 계속 구제
for text, want in (("M4Al", "m4"), ("1FAK", "ifak"), ("Bolte", "bolts")):
    check(f"오독 구제 {text!r} → {want}", hit(text) == want)

print("전부 통과" if FAILS == 0 else f"{FAILS}건 실패")
sys.exit(1 if FAILS else 0)
