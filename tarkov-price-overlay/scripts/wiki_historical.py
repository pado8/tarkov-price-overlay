"""공식 위키가 '더 이상 게임에 없음'({{Historical content}})으로 표시한 퀘스트 중 공개 데이터(json.tarkov.dev)에 남아 있는 것 수집.

왜: tarkov.dev 퀘스트 데이터엔 1.1 개편 등으로 사라진 퀘스트가 남아 있다(11-04 점검: 33개 — Glory to CPSU - Part 1 은
"Removed from the game with 1.1"). 가이드는 이 퀘스트 페이지에 '지금 게임에서 받을 수 없을 수 있음' 안내를 붙인다(지우지는 않음).
- 출력: scripts/guide_data/wiki_historical.json  {"checked": 날짜, "quests": {영문 제목: 위키 수정 메모}}
- 실행: python-core\\.venv\\Scripts\\python.exe scripts\\wiki_historical.py
- 갱신 시점: 패치·와이프·이벤트 종료 뒤(이벤트 퀘스트도 끝나면 위키가 Historical 로 바꾼다)
"""
from __future__ import annotations

import json
import time
import urllib.parse
from pathlib import Path

import requests

API = "https://escapefromtarkov.fandom.com/api.php"
BASE = "https://json.tarkov.dev"
OUT = Path(__file__).resolve().parent / "guide_data" / "wiki_historical.json"
HEADERS = {"User-Agent": "Mozilla/5.0 tarkov-guide-builder/1.0 (tarkov.aquapado.com)"}


def embedded(template: str) -> set[str]:
    out, cont = set(), {}
    while True:
        r = requests.get(API, params={"action": "query", "list": "embeddedin", "eititle": template, "eilimit": 500,
                                      "einamespace": 0, "format": "json", **cont}, headers=HEADERS, timeout=60)
        r.raise_for_status()
        j = r.json()
        out |= {p["title"] for p in j["query"]["embeddedin"]}
        if "continue" not in j:
            return out
        cont = j["continue"]
        time.sleep(0.3)


def main() -> None:
    hist = embedded("Template:Historical content")
    titles: dict[str, str] = {}
    for mode in ("regular", "pve"):
        r = requests.get(f"{BASE}/{mode}/tasks", headers=HEADERS, timeout=120)
        r.raise_for_status()
        for t in r.json()["data"]["tasks"].values():
            wl = t.get("wikiLink") or ""
            if "/wiki/" in wl:
                titles[urllib.parse.unquote(wl.rsplit("/wiki/", 1)[1]).replace("_", " ")] = t.get("id")
    hit = sorted(set(titles) & hist)
    OUT.write_text(json.dumps({"checked": time.strftime("%Y-%m-%d"), "source": "escapefromtarkov.fandom.com Template:Historical content 사용 문서",
                               "quests": hit}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[historical] 위키 Historical 문서 {len(hist)}개 중 공개 데이터에 남은 퀘스트 {len(hit)}개 → {OUT}")
    for x in hit:
        print("  ", x)


if __name__ == "__main__":
    main()
