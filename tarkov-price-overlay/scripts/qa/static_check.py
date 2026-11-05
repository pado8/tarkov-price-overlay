"""가이드 빌드 결과 정적 점검(배포 전 품질 게이트 1단계) — 11-04 점검에서 나온 회귀를 막는다.

  q-links   search.json 의 items/·keys/·rewards/ ?q= 값이 도착 페이지 행(data-s)과 맞는가(카파 배지 0행 사고)
  hreflang  모든 페이지의 hreflang ko/en/ru/zh-Hans/x-default 가 각 언어판 주소를 가리키는가(en/ru 템플릿 자기 참조 사고)
  noindex   noindex 페이지가 사이트맵·광고 코드에 들어 있지 않은가
  hangul    en/ru/zh 판 본문(스크립트·스타일 제외)에 한글이 남지 않았는가
  og        og:image 누락
사용: python scripts/qa/static_check.py [landing 경로]   종료 코드 1 = 실패
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.parse
from pathlib import Path

LAND = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "landing")
G = LAND / "guide"
SITE = "https://tarkov.aquapado.com"
fails: list[str] = []
warns: list[str] = []


def norm(s: str) -> str:
    return re.sub(r"[\s\-_.,:;'\"’()\[\]·…!?]", "", (s or "").lower())


def page_of(url: str) -> Path:
    path = urllib.parse.urlparse(url).path
    return LAND / path.lstrip("/") / "index.html"


# q-links
for pre in ("", "en/", "ru/", "zh/"):
    sj = G / pre / "search.json"
    if not sj.exists():
        continue
    rows = json.loads(sj.read_text(encoding="utf-8"))
    cache: dict[Path, str] = {}
    bad = 0
    for r in rows:
        u = r[3]
        if "?q=" not in u:
            continue
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("q", [""])[0]
        p = page_of(u)
        if p not in cache:
            cache[p] = p.read_text(encoding="utf-8") if p.exists() else ""
        t = cache[p]
        if "keys/" in u:  # 열쇠 템플릿은 JSON 데이터로 그림 — 이름이 데이터에 있으면 통과
            ok = json.dumps(q, ensure_ascii=False)[1:-1] in t or q in html.unescape(t)
        else:
            nq = norm(q)
            ok = any(nq in norm(html.unescape(ds)) for ds in re.findall(r'data-s="([^"]*)"', t))
        if not ok:
            bad += 1
            if bad <= 5:
                fails.append(f"q-links  {pre or 'ko/'} {r[1]} → {u}")
    if bad > 5:
        fails.append(f"q-links  {pre or 'ko/'} … 그 밖 {bad - 5}건")

# hreflang · noindex · hangul · og
sitemap = (LAND / "sitemap.xml").read_text(encoding="utf-8") if (LAND / "sitemap.xml").exists() else ""
n = 0
for f in G.rglob("index.html"):
    n += 1
    t = f.read_text(encoding="utf-8")
    rel = "/" + f.parent.relative_to(LAND).as_posix() + "/"
    lang = next((l for l in ("en", "ru", "zh") if rel.startswith(f"/guide/{l}/")), "ko")
    base = re.sub(r"^/guide/(en|ru|zh)/", "/guide/", rel)
    want = {"ko": SITE + base, "en": SITE + base.replace("/guide/", "/guide/en/", 1),
            "ru": SITE + base.replace("/guide/", "/guide/ru/", 1), "zh-Hans": SITE + base.replace("/guide/", "/guide/zh/", 1)}
    hl = dict(re.findall(r'<link rel="alternate" hreflang="([A-Za-z-]+)" href="([^"]+)"', t))
    if hl:
        for k in ("ko", "en", "ru", "zh-Hans"):
            if k in hl and hl[k] != want[k]:
                fails.append(f"hreflang  {rel}: {k} → {hl[k]} (기대 {want[k]})")
        if "x-default" in hl and hl["x-default"] != want["ko"]:
            fails.append(f"hreflang  {rel}: x-default → {hl['x-default']}")
    noindex = re.search(r'<meta name="robots" content="[^"]*noindex', t)
    if noindex:
        if SITE + rel in sitemap:
            fails.append(f"noindex  {rel}: noindex 인데 사이트맵에 있음")
        if "adsbygoogle" in t or "pagead2.googlesyndication" in t:
            fails.append(f"noindex  {rel}: noindex 인데 광고 코드가 실림")
    elif 'property="og:image"' not in t:
        warns.append(f"og  {rel}: og:image 없음")
    if lang != "ko":
        body = re.sub(r"<(script|style)\b.*?</\1>", "", t, flags=re.S)
        body = re.sub(r'<details class="lang">.*?</details>', "", body, flags=re.S)  # 언어 메뉴의 '한국어'는 정상
        if re.search(r"[가-힣]", re.sub(r'<[^>]+(?:lang="ko"|hreflang)[^>]*>', "", body)):
            m = re.search(r".{0,30}[가-힣]+.{0,30}", body)
            warns.append(f"hangul  {rel}: {m.group(0) if m else ''}")

for w in warns[:30]:
    print("[static] 경고", w)
if len(warns) > 30:
    print(f"[static] 경고 … 그 밖 {len(warns) - 30}건")
for x in fails[:60]:
    print("[static] 실패", x)
print(f"[static] 페이지 {n}개 · 실패 {len(fails)} · 경고 {len(warns)}")
sys.exit(1 if fails else 0)
