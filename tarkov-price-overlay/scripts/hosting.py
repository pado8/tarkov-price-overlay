"""tarkov.aquapado.com 호스팅에 따라 바뀌는 HTML 조각 정리 — scripts/hosting.txt 한 줄(vercel | cloudflare).

cloudflare 일 때: Vercel 전용 방문 분석 스크립트(/_vercel/insights/script.js)를 모든 landing HTML 에서 뺀다
  (Cloudflare 에선 404 — 방문 수는 GA4 가 센다). vercel 일 때는 아무것도 안 한다(생성기·원본 HTML 이 이미 넣고 있음).
build_guide.py 끝과 deploy_landing.ps1 이 부른다. 실행: python scripts/hosting.py

2026-11-02: AdSense 를 위해 Vercel Hobby(광고 금지) → Cloudflare Pages 로 옮길 준비. 전환 절차 = scripts/cloudflare/CUTOVER.md
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANDING = ROOT / "landing"
HOSTING_FILE = ROOT / "scripts" / "hosting.txt"
VERCEL_INSIGHTS_RE = re.compile(r'[ \t]*<script defer src="/_vercel/insights/script\.js"></script>\n?')


def target() -> str:
    v = HOSTING_FILE.read_text(encoding="utf-8").strip().lower() if HOSTING_FILE.exists() else "vercel"
    if v not in ("vercel", "cloudflare"):
        raise SystemExit(f"[hosting] scripts/hosting.txt 값이 이상함: {v!r} (vercel 또는 cloudflare)")
    return v


def apply() -> tuple[int, str]:
    t = target()
    changed = 0
    if t == "cloudflare":
        for f in LANDING.rglob("*.html"):
            s = f.read_text(encoding="utf-8")
            n = VERCEL_INSIGHTS_RE.sub("", s)
            if n != s:
                for _i in range(20):  # 방금 쓴 파일을 Windows(백신 검사 등)가 잠깐 잡으면 OSError 22/13 — 잠시 뒤 다시
                    try:
                        f.write_text(n, encoding="utf-8")
                        break
                    except OSError as ex:
                        if ex.errno not in (13, 22) or _i == 19:
                            raise
                        __import__("time").sleep(0.25)
                changed += 1
    return changed, t


if __name__ == "__main__":
    n, t = apply()
    print(f"[hosting] {t} · Vercel 분석 스크립트 뺀 페이지 {n}개")
    sys.exit(0)
