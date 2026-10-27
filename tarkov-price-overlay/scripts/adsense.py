"""AdSense 코드 넣기·빼기 — tarkov.aquapado.com(landing/) 전체 HTML에.

게시자 ID는 scripts/adsense_client.txt 한 줄(예: ca-pub-1234567890123456). 파일이 없거나 비어 있으면
모든 페이지에서 코드를 지우고 ads.txt도 지운다(= 광고 끔). build_guide.py가 끝날 때 자동으로 불러
가이드를 다시 만들어도 코드가 유지된다.

넣는 것(애드센스 '사이트 연결' 문서의 세 방법 중 코드 스니펫 + 메타 태그 + ads.txt 전부):
  <head> 끝: google-adsense-account 메타 + adsbygoogle.js(자동 광고 겸 사이트 확인)
  landing/ads.txt: google.com, pub-…, DIRECT, f08c47fec0942fa0

광고 자리는 애드센스 '자동 광고'로 시작한다. 본문 가리는 형식(전면·앵커)은 애드센스 화면에서 끈다.
실행: python scripts/adsense.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANDING = ROOT / "landing"
CLIENT_FILE = ROOT / "scripts" / "adsense_client.txt"
START, END = "<!--adsense-->", "<!--/adsense-->"
BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(END) + r"\n?", re.S)
CLIENT_RE = re.compile(r"^ca-pub-\d{10,20}$")


def client_id() -> str | None:
    if not CLIENT_FILE.exists():
        return None
    v = CLIENT_FILE.read_text(encoding="utf-8").strip()
    if not v:
        return None
    if not CLIENT_RE.match(v):
        raise SystemExit(f"[adsense] 게시자 ID 형식이 아님: {v!r} (예: ca-pub-1234567890123456)")
    return v


def snippet(cid: str) -> str:
    return (f'{START}<meta name="google-adsense-account" content="{cid}" />'
            f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={cid}" '
            f'crossorigin="anonymous"></script>{END}\n')


def apply() -> tuple[int, str | None]:
    cid = client_id()
    changed = 0
    for f in LANDING.rglob("*.html"):
        s = f.read_text(encoding="utf-8")
        t = BLOCK_RE.sub("", s)
        if cid and "</head>" in t:
            t = t.replace("</head>", snippet(cid) + "</head>", 1)
        if t != s:
            f.write_text(t, encoding="utf-8")
            changed += 1
    ads = LANDING / "ads.txt"
    if cid:
        ads.write_text(f"google.com, {cid.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n", encoding="utf-8")
    elif ads.exists():
        ads.unlink()
    return changed, cid


if __name__ == "__main__":
    n, cid = apply()
    print(f"[adsense] {'게시자 ' + cid if cid else '끔(ID 없음)'} · 바뀐 페이지 {n}개 · ads.txt {'있음' if cid else '없음'}")
    sys.exit(0)
