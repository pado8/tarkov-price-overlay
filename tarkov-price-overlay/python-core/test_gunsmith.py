"""gunsmith.py 단위 테스트 — 네트워크 없이 load_from_dict 로 주입해 for_item 결과를 본다.
실행: PYTHONIOENCODING=utf-8 .venv\\Scripts\\python.exe test_gunsmith.py
"""
from __future__ import annotations

import sys

import gunsmith

FAILS = 0


def check(name: str, cond: bool) -> None:
    global FAILS
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        FAILS += 1


doc = {
    "updated": "2026-10-27",
    "items": {
        "mag1": [
            {"q": "Gunsmith - AKM", "k": "건스미스 - AKM", "t": "req", "w": "AKM"},
            {"q": "Gunsmith Master - Part 5", "k": "건스미스 마스터 - 파트 5", "t": "req", "w": "AKMN"},
            {"q": "Gunsmith - AKM", "k": "건스미스 - AKM", "t": "ex", "w": "AKM"},
            {"q": "Gunsmith - AKM", "k": "건스미스 - AKM", "t": "ex", "w": "AKM"},  # 중복은 한 번만
        ],
        "laser1": [{"q": "Gunsmith - MP-133", "k": "건스미스 - MP-133", "t": "ex", "w": ""}],
        "bad": "not-a-list",
    },
}

n = gunsmith.load_from_dict(doc)
check("주입: 리스트가 아닌 항목은 버리고 2개 적재", n == 2)

rows = gunsmith.for_item("mag1", "ko")
check("한국어 이름으로 나옴", rows and rows[0]["quest"].startswith("건스미스"))
check("필수가 먼저, 예시가 뒤", [r["kind"] for r in rows] == ["req", "req", "ex"])
check("같은 (퀘스트·종류·무기) 중복 제거", len(rows) == 3)
check("무기 이름 전달", rows[0]["weapon"] == "AKM")

rows_en = gunsmith.for_item("mag1", "en")
check("영어 모드는 영문 퀘스트 이름", rows_en[0]["quest"].startswith("Gunsmith"))

check("빈 무기는 None", gunsmith.for_item("laser1", "ko")[0]["weapon"] is None)
check("모르는 아이템은 빈 목록", gunsmith.for_item("nope", "ko") == [])
check("None 아이템은 빈 목록", gunsmith.for_item(None, "ko") == [])
check("상태에 항목 수", gunsmith.status()["items"] == 2)

print("\n" + ("전부 통과" if FAILS == 0 else f"{FAILS}건 실패"))
sys.exit(1 if FAILS else 0)
