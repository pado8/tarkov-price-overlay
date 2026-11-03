"""진행 중 이벤트 퀘스트 위키 수집기 — 공개 데이터(tarkov.dev)에 없는 이벤트 퀘스트를 가이드 '이벤트 퀘스트' 페이지로 만든다.

공식 위키(escapefromtarkov.fandom.com)의 퀘스트 분류에서 이름이 PREFIX 로 시작하는 문서를 받아
정보 상자(given by·location·previous·leads to)·목표·보상·선택 분기를 정리해 scripts/guide_data/event_quests.json 에 저장한다.
문장 번역(ko/ru)은 scripts/guide_data/event_quests_i18n.json 에 사람이 채운다(없으면 영어 원문을 그대로 보인다).
아이템·상인·맵 이름은 생성기가 공개 데이터 이름표로 바꾼다(영문명으로 연결).

- 실행: python-core\\.venv\\Scripts\\python.exe scripts\\wiki_event_quests.py [PREFIX]   (기본 "Halloween:")
- 이벤트가 바뀌면 PREFIX 를 바꿔 다시 돌리고, 끝난 이벤트는 json 을 비우면 페이지가 '진행 중 이벤트 없음'으로 바뀐다.
- 위키 내용은 CC BY-NC-SA — 페이지에 출처를 단다.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests

API = "https://escapefromtarkov.fandom.com/api.php"
OUT = Path(__file__).resolve().parent / "guide_data" / "event_quests.json"
HEADERS = {"User-Agent": "Mozilla/5.0 tarkov-guide-builder/1.0 (tarkov.aquapado.com)"}


def q(**params):
    r = requests.get(API, headers=HEADERS, timeout=60, params={"format": "json", **params})
    r.raise_for_status()
    return r.json()


def clean(s: str) -> str:
    s = re.sub(r"<font[^>]*>(.*?)</font>", r"\1", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", s)
    s = s.replace("''", "").replace("<br/>", " ").replace("<br>", " ")
    return re.sub(r"\s+", " ", s).strip()


def links(s: str) -> list[str]:
    return [re.sub(r"#.*", "", x.split("|")[0]).strip() for x in re.findall(r"\[\[([^\]]+)\]\]", s or "")]


def field(t: str, n: str) -> str:
    m = re.search(r"\|\s*" + n + r"\s*=(.*?)(?=\n\s*\||\n\}\})", t, re.S)
    return m.group(1).strip() if m else ""


def section(t: str, n: str) -> str:
    m = re.search(r"==\s*" + n + r"\s*==\n(.*?)(?=\n==[^=]|\Z)", t, re.S)
    return m.group(1).strip() if m else ""


def rewards(block: str) -> list[dict]:
    """보상 줄 → 묶음(선택 분기면 두 묶음). '+EXP' 가 다시 나오면 새 묶음."""
    sets: list[dict] = []
    cur: dict | None = None
    for raw in block.splitlines():
        if not raw.startswith("* "):
            continue  # '** 정보센터 보너스' 줄은 버림
        line = raw[2:].strip()
        m = re.match(r"\+([\d,]+) \[\[EXP\]\]", line)
        if m:
            cur = {"exp": int(m.group(1).replace(",", "")), "money": [], "items": [], "barters": [], "achv": [], "other": []}
            sets.append(cur)
            continue
        if cur is None:
            cur = {"exp": 0, "money": [], "items": [], "barters": [], "achv": [], "other": []}
            sets.append(cur)
        m = re.match(r"([\d,]+) (Roubles|Dollars|Euros)$", line)
        if m:
            cur["money"].append([int(m.group(1).replace(",", "")), m.group(2)])
            continue
        m = re.match(r"(\d+)× \[\[([^\]|]+)(?:\|[^\]]*)?\]\](.*)$", line)
        if m:
            cur["items"].append([int(m.group(1)), m.group(2).strip(), clean(m.group(3))])
            continue
        m = re.match(r"Unlocks barter for \[\[([^\]|]+)[^\]]*\]\] at \[\[([^\]|]+)[^\]]*\]\] LL(\d+)", line)
        if m:
            cur["barters"].append([m.group(1).strip(), m.group(2).strip(), int(m.group(3))])
            continue
        m = re.match(r"Unlocks achievement \[\[[^\]|]*\|([^\]]+)\]\]", line)
        if m:
            cur["achv"].append(m.group(1).strip())
            continue
        cur["other"].append(clean(line))
    return sets


def main() -> int:
    prefix = sys.argv[1] if len(sys.argv) > 1 else "Halloween:"
    titles: list[str] = []
    cont: dict = {}
    while True:
        j = q(action="query", list="categorymembers", cmtitle="Category:Quests", cmlimit=500, cmnamespace=0, **cont)
        titles += [m["title"] for m in j["query"]["categorymembers"] if m["title"].startswith(prefix)]
        if "continue" not in j:
            break
        cont = {"cmcontinue": j["continue"]["cmcontinue"]}
        time.sleep(1)
    out: dict[str, dict] = {}
    for k in range(0, len(titles), 50):
        j = q(action="query", prop="revisions", rvprop="content|timestamp", rvslots="main", titles="|".join(titles[k:k + 50]))
        for p in j["query"]["pages"].values():
            if "revisions" not in p:
                continue
            rv = p["revisions"][0]
            t = rv["slots"]["main"]["*"]
            if "{{Historical content" in t:
                continue  # 끝난 이벤트
            def rel(s):
                return [{"title": x, "note": clean(re.sub(r"\[\[[^\]]+\]\]", "", seg)).strip(" ()")} for seg in re.split(r"<br\s*/?>", s) for x in links(seg)]
            out[p["title"]] = {
                "rev": rv["timestamp"][:10],
                "trader": (links(field(t, "given by")) or [clean(field(t, "given by"))])[0],
                "maps": links(field(t, "location")),
                "prev": rel(field(t, "previous")),
                "prev_accept": field(t, "previous").startswith("Accept"),
                "next": rel(field(t, "leads to")),
                "obj": [clean(re.sub(r"^\*+\s*", "", x)) for x in section(t, "Objectives").splitlines() if x.startswith("*")],  # '**' = 선택 목표 줄
                "rewards": rewards(section(t, "Rewards")),
                "choice": [clean(x) for x in re.findall(r"\{\{Multiple choice\|(.*?)\}\}", t)],
                "notes": [clean(x[2:]) for x in section(t, "Notes").splitlines() if x.startswith("* ")],
            }
        time.sleep(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"prefix": prefix, "quests": dict(sorted(out.items()))}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[event] {prefix} 퀘스트 {len(out)}개 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
