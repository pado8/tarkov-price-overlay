"""건스미스 위키 예시 조립(쇼핑 리스트) 수집기.

공식 위키(escapefromtarkov.fandom.com)의 각 건스미스 문서에서 'Build(s)' 섹션의 쇼핑 리스트 표를
미디어위키 API(action=parse&prop=wikitext)로 받아 scripts/guide_data/gunsmith_builds.json 에 저장한다.
가이드 생성기(guide_static.gunsmith_page)가 이 JSON을 읽어 "위키 예시 조립"으로 붙인다.

- 위키 HTML 직접 요청은 403(Cloudflare)이라 API만 쓴다.
- 위키 내용은 CC BY-NC-SA — 페이지에 출처 링크를 반드시 단다(gunsmith_page에서 처리).
- 실행: python-core\\.venv\\Scripts\\python.exe scripts\\gunsmith_wiki.py  (퀘스트 영문 이름 목록은 json.tarkov.dev에서)

사용법 갱신 시점: 건스미스 퀘스트가 바뀌었거나 위키 조립 예시가 갱신됐을 때. 실패한 문서는 건너뛰고 기존 값을 남긴다.
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
from pathlib import Path

import requests

API = "https://escapefromtarkov.fandom.com/api.php"
WIKI = "https://escapefromtarkov.fandom.com/wiki/"
OUT = Path(__file__).resolve().parent / "guide_data" / "gunsmith_builds.json"
HEADERS = {"User-Agent": "Mozilla/5.0 tarkov-guide-builder/1.0 (tarkov.aquapado.com)"}
BASE = "https://json.tarkov.dev"


def wikitext(page: str) -> str | None:
    r = requests.get(API, params={"action": "parse", "page": page, "prop": "wikitext", "format": "json", "redirects": 1},
                     headers=HEADERS, timeout=60)
    if r.status_code != 200:
        return None
    j = r.json()
    if "parse" not in j:
        return None
    return j["parse"]["wikitext"]["*"]


LINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]")


def strip_wiki(s: str) -> str:
    s = re.sub(r"\[\[File:[^\]]*\]\]", "", s)
    s = LINK.sub(lambda m: m.group(2) if m.group(2) is not None else m.group(1), s)
    s = re.sub(r"'''?", "", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(re.sub(r"\s+", " ", s)).strip()


def split_cells(s: str) -> list[str]:
    """셀 안의 <hr/>·<br/>로 나뉜 여러 값(상인 둘, LL 둘)을 리스트로."""
    parts = re.split(r"<hr\s*/?>|<br\s*/?>", s)
    return [strip_wiki(p) for p in parts if strip_wiki(p)]


def parse_tables(wt: str) -> list[dict]:
    """<tabber> 안의 'XXX Shopping List=' / 'XXX Shop. List=' 탭마다 wikitable 한 개씩."""
    out = []
    # tabber 탭 경계: 첫 탭은 '<tabber>라벨=' , 다음 탭은 '|-|라벨='
    tabs = re.split(r"<tabber>|\|-\|", wt)
    for tab in tabs:
        m = re.match(r"\s*([^=\n]*?)\s*=\s*\n", tab)
        if not m:
            continue
        label = strip_wiki(m.group(1))
        if not re.search(r"shop", label, re.I):
            continue
        tm = re.search(r"\{\|.*?\|\}", tab, re.S)
        if not tm:
            continue
        rows = []
        for raw in re.split(r"\n\|-\s*\n?", tm.group(0))[1:]:
            cells = [c for c in re.split(r"\n\|(?!\})", "\n" + raw) if c.strip()]
            # 첫 셀은 '![[File:..]]' 아이콘 — '!'로 시작하는 줄은 버린다
            cells = [c for c in cells if not c.lstrip().startswith("!")]
            cells = [c.strip() for c in cells]
            if len(cells) < 3:
                continue
            name_raw = cells[0]
            lm = LINK.search(name_raw)
            page = lm.group(1).strip() if lm else strip_wiki(name_raw)
            name = strip_wiki(name_raw)
            if not name:
                continue
            ll_raw = re.sub(r"\|\}\s*$", "", cells[2].strip())  # 마지막 행은 표 끝 '|}'가 같은 셀에 붙어 온다
            rows.append({"name": name, "page": page, "sellers": split_cells(cells[1]), "ll": split_cells(ll_raw)})
        if rows:
            w = re.sub(r"\s*(Shopping List|Shop\. List)\s*$", "", label, flags=re.I).strip()
            out.append({"weapon": w, "rows": rows})
    return out


def parse_note(wt: str) -> str:
    m = re.search(r"\*\s*(Th(?:is|ese) builds? (?:is|are) based on .*?)\n", wt)
    return strip_wiki(m.group(1)) if m else ""


def gunsmith_names() -> list[str]:
    r = requests.get(f"{BASE}/regular/tasks_en", headers=HEADERS, timeout=120)
    r.raise_for_status()
    data = r.json().get("data") or {}
    names = sorted({v for v in data.values() if isinstance(v, str) and v.startswith("Gunsmith")})
    return names


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    names = gunsmith_names()
    print(f"[gunsmith] 퀘스트 {len(names)}개")
    res = dict(old)
    ok = fail = 0
    for n in names:
        page = n.replace(" ", "_")
        try:
            wt = wikitext(page)
        except Exception as ex:  # noqa: BLE001
            wt = None
            print(f"  ! {n}: {ex}")
        if not wt:
            fail += 1
            print(f"  - {n}: 문서 없음/실패 (기존 값 유지)")
            continue
        lists = parse_tables(wt)
        res[n] = {"url": WIKI + page, "note": parse_note(wt), "lists": lists, "fetched": time.strftime("%Y-%m-%d")}
        ok += 1
        print(f"  + {n}: 표 {len(lists)}개, 부품 {sum(len(x['rows']) for x in lists)}개")
        time.sleep(0.4)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[gunsmith] 성공 {ok} · 실패 {fail} → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
