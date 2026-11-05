"""사이트 링크 전수 점검(11-05) — 사용: python scripts/qa/link_collect.py %TEMP%\links.json 다음 python scripts/qa/link_check.py
외부 사이트를 1,000번 넘게 부르므로 배포 게이트엔 넣지 않는다(필요할 때·주 1회 정도 수동)."""
"""사이트 링크 전수 점검(11-05) — collect.py 결과(links.json)로.
외부: PC 크롬 UA·휴대폰 UA 두 번 GET(카카오페이처럼 PC 에서만 404 인 경우를 잡으려고) + 본문 '404/찾을 수 없' 검사.
위키: 미디어위키 API 로 문서 존재(HTML 은 403). tarkov.dev /task/<slug>: 공개 데이터에 그 normalizedName 이 있는지(SPA 라 항상 200).
내부: landing 파일 존재.
"""
import json, re, sys, pathlib, urllib.parse, concurrent.futures as cf
import requests

import tempfile
J = pathlib.Path(tempfile.gettempdir())
LAND = pathlib.Path(__file__).resolve().parents[2] / "landing"
d = json.load(open(J / "links.json", encoding="utf-8"))
PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
MO = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
bad = []

# ── 내부 ──
miss_int, miss_anchor, cache = [], [], {}
for path, anchor, pages in d["int"]:
    p = urllib.parse.unquote(path) or "/"
    f = LAND / p.lstrip("/")
    tgt = f if f.is_file() else (f / "index.html")
    if not tgt.is_file():
        miss_int.append((path, pages)); continue
    if anchor and tgt.suffix == ".html":
        if tgt not in cache:
            cache[tgt] = set(re.findall(r'\bid="([^"]+)"', tgt.read_text(encoding="utf-8", errors="replace")))
        if anchor not in cache[tgt]:
            miss_anchor.append((path + "#" + anchor, pages))
print(f"[내부] (경로, 앵커) {len(d['int'])}개 중 파일 없음 {len(miss_int)} · 앵커 없음 {len(miss_anchor)}")
for path, pages in miss_int[:30]:
    print("   없음", path, "← 예:", pages[0])
for path, pages in miss_anchor[:30]:
    print("   앵커 없음", path, "← 예:", pages[0])

# ── 위키 ──
wiki = [u for u in d["ext"] if "escapefromtarkov.fandom.com" in u]
titles = {}
for u in wiki:
    pth = urllib.parse.urlparse(u).path
    if "/wiki/" in pth:
        titles[urllib.parse.unquote(pth.split("/wiki/", 1)[1]).replace("_", " ")] = u
    elif "api.php" not in u:
        titles.setdefault("__root__" + u, u)
missing = []
names = [t for t in titles if not t.startswith("__root__")]
H = {"User-Agent": "Mozilla/5.0 tarkov-guide-linkcheck/1.0 (tarkov.aquapado.com)"}
for i in range(0, len(names), 50):
    r = requests.get("https://escapefromtarkov.fandom.com/api.php", headers=H, timeout=60, params={
        "action": "query", "titles": "|".join(names[i:i + 50]), "redirects": 1, "format": "json", "formatversion": 2})
    q = r.json().get("query") or {}
    back = {x["to"]: x["from"] for x in q.get("redirects") or []}
    norm = {x["to"]: x["from"] for x in q.get("normalized") or []}
    for pg in q.get("pages") or []:
        if pg.get("missing") or pg.get("invalid"):
            t = back.get(pg["title"], pg["title"]); t = norm.get(t, t)
            missing.append(titles.get(t, t))
print(f"[위키] 링크 {len(wiki)}개(문서 {len(names)}개) 중 없는 문서 {len(missing)}")
for u in missing[:40]:
    print("   없는 문서", u, "← 예:", d["ext"].get(u, ["?"])[0])

# ── tarkov.dev 퀘스트 ──
td = [u for u in d["ext"] if urllib.parse.urlparse(u).netloc == "tarkov.dev" and "/task/" in u]
slugs = set()
for mode in ("regular", "pve"):
    for t in requests.get(f"https://json.tarkov.dev/{mode}/tasks", timeout=120).json()["data"]["tasks"].values():
        slugs.add(t.get("normalizedName"))
td_bad = [u for u in td if u.rsplit("/task/", 1)[1].strip("/") not in slugs]
print(f"[tarkov.dev] 퀘스트 링크 {len(td)}개 중 공개 데이터에 없는 것 {len(td_bad)}")
for u in td_bad[:20]:
    print("   없음", u)

# ── 그 밖의 외부 ──
other = [u for u in d["ext"] if "fandom.com" not in u and urllib.parse.urlparse(u).netloc != "tarkov.dev" or u.rstrip("/") == "https://tarkov.dev"]


def probe(u, ua):
    try:
        r = requests.get(u, headers={"User-Agent": ua, "Accept-Language": "ko-KR,ko;q=0.9"}, timeout=25, allow_redirects=True)
        body = r.text[:200000] if "text" in r.headers.get("content-type", "") else ""
        title = (re.search(r"<title[^>]*>(.*?)</title>", body, re.S | re.I) or [None, ""])[1].strip()[:60]
        soft = bool(re.search(r"404|not found|page not found|찾을 수 없|존재하지 않", title, re.I))
        return r.status_code, r.url, title, soft
    except Exception as e:  # noqa: BLE001
        return -1, "", str(e)[:60], False


# 원인이 확인된 예외(11-05) — 실패로 세지 않고 사유만 보인다
KNOWN = {
    "https://api.aquapado.com/priceoverlay/web": "버튼이 아니라 통계 전송용 POST 주소(GET 405 정상)",
    "https://qr.kakaopay.com/Ej8AkkdEJ": "휴대폰 전용 송금 링크 — /donate/ 휴대폰 버튼에만 쓴다(PC 404 는 정상)",
    "https://opensource.org/licenses/MIT": "스크립트엔 봇 검사 403, 실제 브라우저 200(11-05 확인)",
    "https://www.escapefromtarkov.com/promo/activate": "공식 사이트 Cloudflare 검사 — 실제 브라우저는 통과",
}
with cf.ThreadPoolExecutor(6) as ex:
    res = {u: (ex.submit(probe, u, PC), ex.submit(probe, u, MO)) for u in other}
print(f"[외부 기타] {len(other)}개 — PC / 휴대폰")
for u, (a, b) in res.items():
    pa, pb = a.result(), b.result()
    flag = "  " if (200 <= pa[0] < 400 and not pa[3] and 200 <= pb[0] < 400 and not pb[3]) else ("ℹ " if u in KNOWN else "✗ ")
    print(f"{flag}{u}" + (f"  — 알려진 예외: {KNOWN[u]}" if flag == "ℹ " else "") + f"\n     PC {pa[0]} {pa[2]!r}{' (제목에 404)' if pa[3] else ''} | 폰 {pb[0]} {pb[2]!r}{' (제목에 404)' if pb[3] else ''}")
