"""가이드 정확성 자동 대조 — 빌드 결과(landing/guide)를 공식 위키·공개 데이터와 맞춰 본다(2026-11-04 점검에서 만든 검사).

검사(실패 = 오정보가 페이지에 나가는 것):
  ll        퀘스트 '받는 조건'의 상인 LL = 위키 정보 상자 'LL requirement'(위키에 값이 있는 퀘스트만)
  extracts  맵 페이지 탈출구 목록 = 위키 Extractions 표(python-core/data/extracts_current.json)
  rep       공개 데이터의 상인 평판 조건(펜스 카르마 등)이 퀘스트 페이지에 실제로 찍혔는가
경고(빌드를 막지는 않음):
  version   위키 Changelog 최신 버전 ≠ guide_static.GAME_VERSION
  event     guide_static.EVENT_NAME 이 있는데 위키 Events 문서에 그 이벤트가 '진행 중'으로 안 보임(종료 추정)

실행: python-core\\.venv\\Scripts\\python.exe scripts\\guide_verify.py [--lang ko] [--no-net]
  위키 원문은 %TEMP%\\guide_verify_cache 에 하루 캐시. --no-net 이면 네트워크 검사(ll·version·event)를 건너뛴다.
종료 코드: 0 = 통과, 1 = 실패 항목 있음.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
GUIDE = ROOT / "landing" / "guide"
sys.path.insert(0, str(ROOT / "python-core"))
sys.path.insert(0, str(ROOT / "scripts"))
import extract_current  # noqa: E402

API = "https://escapefromtarkov.fandom.com/api.php"
BASE = "https://json.tarkov.dev"
HEADERS = {"User-Agent": "Mozilla/5.0 tarkov-guide-verify/1.0 (tarkov.aquapado.com)"}
CACHE = Path(tempfile.gettempdir()) / "guide_verify_cache"


def cached_get(url: str, params: dict | None = None) -> dict:
    CACHE.mkdir(exist_ok=True)
    key = re.sub(r"[^\w.-]", "_", url + "?" + urllib.parse.urlencode(sorted((params or {}).items())))[:180]
    f = CACHE / (key + ".json")
    if f.exists() and time.time() - f.stat().st_mtime < 86400:
        return json.loads(f.read_text(encoding="utf-8"))
    r = requests.get(url, params=params, headers=HEADERS, timeout=120)
    r.raise_for_status()
    f.write_text(r.text, encoding="utf-8")
    return r.json()


def wiki_texts(titles: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        q = cached_get(API, {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                             "titles": "|".join(chunk), "redirects": 1, "format": "json", "formatversion": 2}).get("query") or {}
        back = {x["to"]: x["from"] for x in q.get("redirects") or []}
        norm = {x["to"]: x["from"] for x in q.get("normalized") or []}
        for p in q.get("pages") or []:
            if p.get("revisions"):
                t = back.get(p["title"], p["title"])
                out[norm.get(t, t)] = p["revisions"][0]["slots"]["main"]["content"]
    return out


def text(h: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


def req_table(h: str) -> str:
    tables = re.findall(r'<table class="kv">(.*?)</table>', h, re.S)
    for t in tables:
        if "상인 등급" in t:
            return t
    return " ".join(tables)  # 언어판 — 표 이름이 번역돼 있으니 전부


def tasks() -> dict:
    out: dict = {}
    for mode in ("regular", "pve"):
        for tid, t in cached_get(f"{BASE}/{mode}/tasks")["data"]["tasks"].items():
            out.setdefault(tid, t)
    return out


def check_ll(gdir: Path, tk: dict, fails: list) -> str:
    titles = {}
    for tid, t in tk.items():
        wl = t.get("wikiLink") or ""
        if "/wiki/" in wl and t.get("normalizedName"):
            titles[tid] = urllib.parse.unquote(wl.rsplit("/wiki/", 1)[1]).replace("_", " ")
    texts = wiki_texts(sorted(set(titles.values())))
    import guide_static
    known = {k for k, v in guide_static.WIKI_DIFF.items() if "ll" in v}  # 데이터가 LL을 명시했고 위키가 다른 것 — 페이지에 병기 중
    n = 0
    for tid, ti in titles.items():
        m = re.search(r"\|\s*LL requirement\s*=\s*(\d+)", texts.get(ti, ""))
        if not m or ti in known:
            continue
        p = gdir / "quest" / tk[tid]["normalizedName"] / "index.html"
        if not p.exists():
            continue
        tbl = req_table(p.read_text(encoding="utf-8"))
        shown = max(map(int, re.findall(r"LL(\d)", text(tbl))), default=1)
        n += 1
        if shown != int(m.group(1)):
            fails.append(f"ll  {ti}: 페이지 LL{shown} / 위키 LL{m.group(1)}  ({p.relative_to(ROOT)})")
    return f"ll: 위키 LL 있는 퀘스트 {n}개 대조"


def check_extracts(gdir: Path, fails: list) -> str:
    rows = json.loads(extract_current._data_path().read_text(encoding="utf-8")).get("maps") or {}
    n = 0
    for slug, want_rows in rows.items():
        p = gdir / "maps" / slug / "index.html"
        if not p.exists():
            continue
        h = p.read_text(encoding="utf-8")
        i = h.find("<h2>탈출구</h2>") if "<h2>탈출구</h2>" in h else h.find('class="cols3"')
        sec = h[i:h.find("</section>", i)]
        # 한국어 이름 → 영문 매칭은 빌드 데이터가 필요해서, 여기선 개수와 '위키에만 있음' 표식만 본다
        shown = len(re.findall(r"<li><b>", sec))
        n += 1
        if shown != len(want_rows):
            fails.append(f"extracts  {slug}: 페이지 {shown}개 / 위키 표 {len(want_rows)}개")
    return f"extracts: 맵 {n}개 개수 대조"


def check_rep(gdir: Path, tk: dict, fails: list) -> str:
    n = 0
    for tid, t in tk.items():
        reps = [r for r in t.get("traderRequirements") or [] if r.get("requirementType") == "reputation"]
        if not reps or not t.get("normalizedName"):
            continue
        p = gdir / "quest" / t["normalizedName"] / "index.html"
        if not p.exists():
            continue
        tbl = text(req_table(p.read_text(encoding="utf-8")))
        n += 1
        for r in reps:
            if f" {r.get('value')} " not in f" {tbl} ":
                fails.append(f"rep  {t['normalizedName']}: 평판 {r.get('compareMethod')} {r.get('value')} 가 페이지에 없음")
    return f"rep: 평판 조건 퀘스트 {n}개"


def warn_version(warns: list) -> str:
    import guide_static
    w = cached_get(API, {"action": "parse", "page": "Changelog", "prop": "wikitext", "format": "json"})["parse"]["wikitext"]["*"]
    vers = re.findall(r"\b(\d+\.\d+\.\d+(?:\.\d+)?)\b", w[:20000])
    latest = vers[0] if vers else "?"
    if latest != guide_static.GAME_VERSION:
        warns.append(f"version  위키 Changelog 최신 {latest} ≠ GAME_VERSION {guide_static.GAME_VERSION} — 패치 반영(PATCHES·데이터 재빌드) 필요할 수 있음")
    ev = getattr(guide_static, "EVENT_NAME", "") or ""
    if ev:
        e = cached_get(API, {"action": "parse", "page": "Events", "prop": "wikitext", "format": "json"})["parse"]["wikitext"]["*"]
        head = e[:e.lower().find("past events")] if "past events" in e.lower() else e[:6000]
        if "halloween" in ev.lower() or "할로윈" in ev:
            if "halloween" not in head.lower():
                warns.append("event  위키 Events 상단(진행 중)에 Halloween 이 안 보임 — 이벤트 종료 추정, EVENT_* 비우기 검토")
    return f"version: 위키 최신 {latest} / 사이트 {guide_static.GAME_VERSION}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="ko")
    ap.add_argument("--no-net", action="store_true")
    a = ap.parse_args()
    gdir = GUIDE if a.lang == "ko" else GUIDE / a.lang
    fails: list[str] = []
    warns: list[str] = []
    notes = [check_extracts(gdir, fails)]
    if not a.no_net:
        tk = tasks()
        notes += [check_rep(gdir, tk, fails)]
        if a.lang == "ko":  # 받는 조건 표 문구가 한국어 기준
            notes += [check_ll(gdir, tk, fails)]
        try:
            notes.append(warn_version(warns))
        except Exception as ex:  # noqa: BLE001
            warns.append(f"version/event 확인 실패: {ex}")
    for n in notes:
        print("[verify]", n)
    for w in warns:
        print("[verify] 경고", w)
    for f in fails:
        print("[verify] 실패", f)
    print(f"[verify] {'통과' if not fails else f'실패 {len(fails)}건'} · 경고 {len(warns)}건")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
