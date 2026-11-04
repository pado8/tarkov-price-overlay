"""열쇠 사용처 보충표 — tarkov.dev 지도 자물쇠 데이터에 없는 열쇠를 공식 위키에서 찾아 고정 JSON 으로 남긴다.

왜: 공개 데이터의 지도 자물쇠 목록은 문·방 위주라 금고·금전등록기·요양원 방 열쇠 등 40여 개가 빠져 있다.
'내 열쇠들 어느 맵에?'(가이드 /guide/keyfinder/)가 이 열쇠들도 맵으로 묶으려면 사용처가 필요하다.
빌드가 매번 위키를 긁지 않도록, 사람이 이 스크립트를 가끔 돌려 결과 JSON 을 커밋한다(패치로 열쇠가 늘었을 때).

  python scripts/wiki_keys.py   → scripts/guide_data/key_wiki_uses.json

결과 한 줄: {"<item id>": {"maps": ["shoreline"], "none": false, "q": ["Collector"], "lock": "위키 Lock Location 첫 줄"}}
- maps: 위키 'Lock Location'·usage 에 링크된 맵(normalizedName). 비어 있고 none=true 면 '여는 곳 없음'(퀘스트 납품·수집용).
- 둘 다 비면 위키에도 사용처가 없다는 뜻(가이드는 '사용처 정보 없음'으로 표시).
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "guide_data" / "key_wiki_uses.json"
BASE = "https://json.tarkov.dev"
WIKI_API = "https://escapefromtarkov.fandom.com/api.php"
UA = {"User-Agent": "Mozilla/5.0 (tarkov-guide key usage check)"}
# 위키 맵 문서 이름 → tarkov.dev normalizedName
MAPS = {"Customs": "customs", "Factory": "factory", "Woods": "woods", "Shoreline": "shoreline",
        "Interchange": "interchange", "Reserve": "reserve", "Lighthouse": "lighthouse",
        "Streets of Tarkov": "streets-of-tarkov", "Ground Zero": "ground-zero", "The Lab": "the-lab",
        "Labs": "the-lab", "Icebreaker": "icebreaker", "Terminal": "terminal", "Labyrinth": "the-labyrinth",
        "The Labyrinth": "the-labyrinth"}


def get(path: str):
    r = requests.get(f"{BASE}/{path}", timeout=120)
    r.raise_for_status()
    return r.json()["data"]


def wikitext(page: str) -> str | None:
    r = requests.get(WIKI_API, params={"action": "parse", "prop": "wikitext", "format": "json", "formatversion": 2,
                                       "redirects": 1, "page": page}, headers=UA, timeout=30)
    if r.status_code != 200:
        return None
    return ((r.json().get("parse") or {}).get("wikitext")) or None


def main() -> int:
    items = get("regular/items")["items"]
    maps = get("regular/maps")["maps"]
    in_maps = set()
    for m in maps.values():
        for lk in m.get("locks") or []:
            if lk.get("key"):
                in_maps.add(lk["key"])
        in_maps.update(m.get("accessKeys") or [])
    todo = [it for it in items.values() if "keys" in (it.get("types") or []) and it["id"] not in in_maps]
    print(f"열쇠 {sum(1 for it in items.values() if 'keys' in (it.get('types') or []))}개 중 지도 데이터에 없는 것 {len(todo)}개")
    out: dict[str, dict] = {}
    for it in todo:
        link = it.get("wikiLink") or ""
        page = urllib.parse.unquote(link.rsplit("/wiki/", 1)[-1]) if "/wiki/" in link else ""
        t = wikitext(page) if page else None
        time.sleep(0.3)
        if not t:
            out[it["id"]] = {"maps": [], "none": False, "q": [], "lock": ""}
            print(f"  ? {it['normalizedName']}: 위키 문서 없음")
            continue
        m = re.search(r"==\s*Lock [Ll]ocation\s*==(.*?)(\n==[^=]|$)", t, re.S)
        lock = m.group(1).strip() if m else ""
        usage = (re.search(r"\|usage\s*=(.*)", t) or [None, ""])[1].strip()
        blob = lock + " " + usage
        mp = sorted({v for n, v in MAPS.items() if re.search(r"\[\[" + re.escape(n) + r"(\||\]\])", blob)})
        none = bool(re.search(r"^\s*None\.?\s*$", lock, re.M)) or "not open any lock" in usage
        q = list(dict.fromkeys(re.findall(r"for the quest \[\[([^\]|]+)", t)))
        first = re.sub(r"<[^>]+>|\{\{[^}]*\}\}|\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", lambda x: x.group(1) or "", lock.split("\n")[0])[:160].strip()
        out[it["id"]] = {"maps": mp, "none": none and not mp, "q": q, "lock": first}
        print(f"  {'-' if not mp else ' '} {it['normalizedName']}: {mp or ('여는 곳 없음' if none else '사용처 없음')} {q[:2]}")
    OUT.write_text(json.dumps(dict(sorted(out.items())), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {OUT} ({len(out)}개 · 맵 {sum(1 for v in out.values() if v['maps'])} · 여는 곳 없음 {sum(1 for v in out.values() if v['none'])})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
