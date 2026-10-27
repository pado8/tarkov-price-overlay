"""GA4 코드 넣기·빼기 — tarkov.aquapado.com(landing/) 전체 HTML에. adsense.py와 같은 방식.

측정 ID는 scripts/ga4_id.txt 한 줄(예: G-ABCDE12345). 파일이 없거나 비어 있으면 모든 페이지에서
코드를 지운다(= 끔). build_guide.py가 끝날 때 자동으로 불러 가이드를 다시 만들어도 코드가 유지된다.
켜기 전 /privacy/ 에 애널리틱스 항목을 넣을 것.

실행: python scripts/ga4.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANDING = ROOT / "landing"
ID_FILE = ROOT / "scripts" / "ga4_id.txt"
START, END = "<!--ga4-->", "<!--/ga4-->"
BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(END) + r"\n?", re.S)
ID_RE = re.compile(r"^G-[A-Z0-9]{6,12}$")


def measurement_id() -> str | None:
    if not ID_FILE.exists():
        return None
    v = ID_FILE.read_text(encoding="utf-8").strip()
    if not v:
        return None
    if not ID_RE.match(v):
        raise SystemExit(f"[ga4] 측정 ID 형식이 아님: {v!r} (예: G-ABCDE12345)")
    return v


def snippet(gid: str) -> str:
    return (f'{START}<script async src="https://www.googletagmanager.com/gtag/js?id={gid}"></script>'
            f"<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}"
            f"gtag('js',new Date());gtag('config','{gid}');</script>{END}\n")


def apply() -> tuple[int, str | None]:
    gid = measurement_id()
    changed = 0
    for f in LANDING.rglob("*.html"):
        s = f.read_text(encoding="utf-8")
        t = BLOCK_RE.sub("", s)
        if gid and "</head>" in t:
            t = t.replace("</head>", snippet(gid) + "</head>", 1)
        if t != s:
            f.write_text(t, encoding="utf-8")
            changed += 1
    return changed, gid


if __name__ == "__main__":
    n, gid = apply()
    print(f"[ga4] {'측정 ID ' + gid if gid else '끔(ID 없음)'} · 바뀐 페이지 {n}개")
    sys.exit(0)
