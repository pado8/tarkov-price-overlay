"""퀘스트 선행·다음 연결 위키 대조 수집기.

tarkov.dev 공개 데이터(taskRequirements)에 없는데 공식 위키(escapefromtarkov.fandom.com) 퀘스트 문서의
정보 상자 previous / leads to 칸에는 있는 연결을 모아 scripts/guide_data/wiki_quest_links.json 에 저장한다.
가이드 생성기(guide_static 의 '이전 퀘스트'·'다음 퀘스트' 칸)가 이 JSON을 읽어 "위키" 표시를 붙여 함께 보여 준다.

- 1.1.0 묶음 해금은 공개 데이터엔 '앞 묶음 n개'라는 숫자만 있고, 위키 previous 칸엔 그 퀘스트 이름이 적혀 있다.
- SPT 서버 데이터는 쓰지 않는다 — 1.1.0 이전 기준이고 같은 id의 퀘스트 이름·순서가 지금 게임과 다르다(2026-11-04 확인).
- 같은 이름의 PVP/PVE 변형으로 이미 연결돼 있으면 넣지 않는다. 자기 자신 연결은 버린다.
- 실행: python-core\\.venv\\Scripts\\python.exe scripts\\wiki_quest_links.py  (퀘스트 목록은 json.tarkov.dev에서)

갱신 시점: 패치·와이프로 퀘스트가 바뀌었을 때. 위키 내용은 CC BY-NC-SA — 페이지에 출처를 단다.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
from pathlib import Path

import requests

API = "https://escapefromtarkov.fandom.com/api.php"
OUT = Path(__file__).resolve().parent / "guide_data" / "wiki_quest_links.json"
HEADERS = {"User-Agent": "Mozilla/5.0 tarkov-guide-builder/1.0 (tarkov.aquapado.com)"}
BASE = "https://json.tarkov.dev"


def tasks(mode: str) -> list[dict]:
    r = requests.get(f"{BASE}/{mode}/tasks", headers=HEADERS, timeout=120)
    r.raise_for_status()
    d = r.json()
    t = (d.get("data") or d).get("tasks")
    return list(t.values()) if isinstance(t, dict) else t


def field(txt: str, name: str) -> str:
    m = re.search(r"\|\s*" + name + r"\s*=(.*?)(?=\n\s*\||\n\}\})", txt, re.S)
    return m.group(1).strip() if m else ""


def main() -> int:
    T: dict[str, dict] = {}
    for mode in ("pve", "regular"):
        T.update({x["id"]: x for x in tasks(mode)})
    en = requests.get(f"{BASE}/regular/tasks_en", headers=HEADERS, timeout=120).json().get("data") or {}
    name = lambda i: en.get(f"{i} name") or i  # noqa: E731

    titles = {}
    for i, x in T.items():
        w = x.get("wikiLink") or ""
        if "/wiki/" in w:
            titles[i] = urllib.parse.unquote(w.split("/wiki/", 1)[1]).replace("_", " ")
    title2id: dict[str, set[str]] = {}
    for i, ti in titles.items():
        title2id.setdefault(ti, set()).add(i)

    pages: dict[str, dict] = {}
    uniq = sorted(set(titles.values()))
    for k in range(0, len(uniq), 50):
        r = requests.get(API, headers=HEADERS, timeout=60, params={
            "action": "query", "prop": "revisions", "rvprop": "content|timestamp", "rvslots": "main",
            "titles": "|".join(uniq[k:k + 50]), "format": "json", "redirects": 1})
        r.raise_for_status()
        q = r.json()["query"]
        for p in q["pages"].values():
            if "revisions" in p:
                rv = p["revisions"][0]
                pages[p["title"]] = {"txt": rv["slots"]["main"]["*"], "rev": rv["timestamp"][:10]}
        for a in (q.get("normalized") or []) + (q.get("redirects") or []):
            if a["to"] in pages:
                pages[a["from"]] = pages[a["to"]]
        time.sleep(1)

    def wiki_ids(i: str, f: str) -> tuple[set[str], str]:
        p = pages.get(titles.get(i, ""))
        if not p:
            return set(), ""
        out: set[str] = set()
        for link in re.findall(r"\[\[([^\]]+)\]\]", field(p["txt"], f)):
            out |= title2id.get(re.sub(r"#.*", "", link.split("|")[0]).strip(), set())
        return out, p["rev"]

    next_of: dict[str, set[str]] = {}
    for i, x in T.items():
        for r in x.get("taskRequirements") or []:
            next_of.setdefault(r["task"], set()).add(i)

    res: dict[str, dict] = {}

    def add(i: str, key: str, q: str, rev: str) -> None:
        e = res.setdefault(i, {"name": name(i), "prev": [], "next": [], "rev": rev})
        if q not in e[key]:
            e[key].append(q)
        e["rev"] = max(e["rev"], rev)

    for i, x in T.items():
        data_prev = {r["task"] for r in x.get("taskRequirements") or []}
        w, rev = wiki_ids(i, "previous")
        for p in sorted(w - data_prev):
            if p == i or p not in T or any(name(d) == name(p) for d in data_prev):
                continue
            add(i, "prev", p, rev)
            add(p, "next", i, rev)
        w, rev = wiki_ids(i, "leads to")
        for q in sorted(w - next_of.get(i, set())):
            if q == i or q not in T or any(name(d) == name(q) for d in next_of.get(i, set())):
                continue
            add(i, "next", q, rev)
            add(q, "prev", i, rev)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dict(sorted(res.items())), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[wiki-links] 퀘스트 {len(T)} · 위키 문서 {len(pages)} · 위키에만 있는 연결이 붙은 퀘스트 {len(res)} → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
