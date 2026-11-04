"""1.1.0 묶음 카운터(globalVariable) → (상인, LL) 표 수집기.

왜: 1.1.0 이후 사이드 퀘스트는 상인 LL 단계마다 따로 있는 카운터(otherRequirements.type=globalVariable,
variableId 가 LL 단계마다 다름)로 열린다. 공개 데이터(json.tarkov.dev)엔 traderRequirements 가 비어 있어서
생성기가 'LL1'로 가정하고 있었다(11-04 점검: 128개 오표기 — 타르코프식 외교는 실제 테라피스트 LL3).
공식 위키 퀘스트 정보 상자의 'LL requirement' 를 변수별로 모아 다수결로 그 변수의 LL을 정한다.

- 출력: scripts/guide_data/bundle_ll.json  {variableId: {"trader": id, "ll": n, "n": 퀘스트 수, "agree": 다수결 수,
  "conflicts": [[퀘스트, 위키 LL], ...]}} + checked 날짜. 생성기(guide_static.Ctx.trader_ll)가 읽는다.
- 위키 문서는 query+revisions 로 50개씩 받는다(HTML 직접 요청은 403/402).
- 실행: python-core\\.venv\\Scripts\\python.exe scripts\\wiki_bundle_ll.py
- 갱신 시점: 패치·와이프로 퀘스트·묶음이 바뀌었을 때.
"""
from __future__ import annotations

import collections
import json
import re
import time
import urllib.parse
from pathlib import Path

import requests

API = "https://escapefromtarkov.fandom.com/api.php"
BASE = "https://json.tarkov.dev"
OUT = Path(__file__).resolve().parent / "guide_data" / "bundle_ll.json"
HEADERS = {"User-Agent": "Mozilla/5.0 tarkov-guide-builder/1.0 (tarkov.aquapado.com)"}


def tasks(mode: str) -> dict:
    r = requests.get(f"{BASE}/{mode}/tasks", headers=HEADERS, timeout=120)
    r.raise_for_status()
    return r.json()["data"]["tasks"]


def wiki_title(t: dict) -> str | None:
    wl = t.get("wikiLink") or ""
    if "/wiki/" not in wl:
        return None
    return urllib.parse.unquote(wl.rsplit("/wiki/", 1)[1]).replace("_", " ")


def fetch(titles: list[str]) -> dict[str, str]:
    """{제목: wikitext} — 넘겨주기(redirect)는 원래 제목으로 되돌려 매핑."""
    out: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        r = requests.get(API, params={"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                                      "titles": "|".join(chunk), "redirects": 1, "format": "json", "formatversion": 2},
                         headers=HEADERS, timeout=60)
        r.raise_for_status()
        q = r.json().get("query") or {}
        back = {x["to"]: x["from"] for x in q.get("redirects") or []}
        norm = {x["to"]: x["from"] for x in q.get("normalized") or []}
        for p in q.get("pages") or []:
            revs = p.get("revisions") or []
            if not revs:
                continue
            title = p["title"]
            title = back.get(title, title)
            title = norm.get(title, title)
            out[title] = revs[0]["slots"]["main"]["content"]
        time.sleep(0.5)
    return out


def infobox_ll(w: str) -> int | None:
    m = re.search(r"\|\s*LL requirement\s*=\s*(\d+)", w)
    return int(m.group(1)) if m else None


def main() -> None:
    seen: dict[str, dict] = {}
    for mode in ("regular", "pve"):
        for tid, t in tasks(mode).items():
            seen.setdefault(tid, t)
    by_var: dict[str, list] = collections.defaultdict(list)
    trader_of: dict[str, str] = {}
    titles: dict[str, str] = {}
    for tid, t in seen.items():
        for o in t.get("otherRequirements") or []:
            if o.get("type") == "globalVariable" and o.get("variableId"):
                ti = wiki_title(t)
                if ti:
                    by_var[o["variableId"]].append(ti)
                    titles[ti] = tid
                trader_of[o["variableId"]] = t.get("trader")
    # 데이터에 LL 조건이 아예 없는 퀘스트(카운터 없이 선행만 있는 것 포함)도 위키 LL을 같이 받는다
    no_ll = {tid: wiki_title(t) for tid, t in seen.items()
             if wiki_title(t) and not any(r.get("requirementType") == "level" for r in t.get("traderRequirements") or [])}
    texts = fetch(sorted(set(titles) | set(no_ll.values())))
    res: dict[str, dict] = {}
    for var, names in sorted(by_var.items()):
        lls = [(n, infobox_ll(texts.get(n, ""))) for n in sorted(set(names))]
        vals = collections.Counter(v for _, v in lls if v)
        if not vals:
            continue
        ll, agree = vals.most_common(1)[0]
        res[var] = {"trader": trader_of.get(var), "ll": ll, "n": len(lls), "agree": agree,
                    "conflicts": [[n, v] for n, v in lls if v and v != ll]}
    # 퀘스트별: 데이터엔 LL이 없고 위키 LL이 1보다 큰 것 — 묶음 표로 이미 같은 값이 나오는 건 뺀다
    quest_ll: dict[str, list] = {}
    for tid, ti in sorted(no_ll.items()):
        wll = infobox_ll(texts.get(ti, ""))
        t = seen[tid]
        bll = max((res[o["variableId"]]["ll"] for o in t.get("otherRequirements") or []
                   if o.get("type") == "globalVariable" and o.get("variableId") in res), default=0)
        if wll and wll > 1 and wll != bll:
            quest_ll[tid] = [ti, wll]
    OUT.write_text(json.dumps({"checked": time.strftime("%Y-%m-%d"), "source": "escapefromtarkov.fandom.com 퀘스트 정보 상자 'LL requirement'",
                               "vars": res, "quests": quest_ll}, ensure_ascii=False, indent=1), encoding="utf-8")
    bad = sum(1 for v in res.values() if v["conflicts"])
    print(f"[bundle_ll] 변수 {len(res)}개(위키 LL 없음 {len(by_var) - len(res)}) · 다수결 불일치 변수 {bad} · "
          f"데이터에 LL 없는 퀘스트 {len(no_ll)}개 중 위키 LL 보충 {len(quest_ll)}개 → {OUT}")
    for var, v in res.items():
        if v["conflicts"]:
            print("  불일치", var, "LL", v["ll"], v["conflicts"])


if __name__ == "__main__":
    main()
