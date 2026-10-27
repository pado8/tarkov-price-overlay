"""공식 위키(fandom)의 맵별 Extractions 표 → python-core/data/extracts_current.json

왜: tarkov.dev 지도 문서(json.tarkov.dev regular/maps)에는 1.0 개편 때 없어진 탈출구(세관 Old Road Gate·Sniper Roadblock 등)가
그대로 남아 있고 그라운드 제로는 진영이 비어 있다. 레이더·가이드는 이 파일로 "지금 있는 탈출구"만 남기고 진영을 보정한다.
실행: python-core/.venv/Scripts/python.exe scripts/wiki_extracts.py  (미디어위키 API, HTML 직접 요청은 403)
탈출구가 바뀌면 다시 돌려 커밋. 레이더 쪽 매칭 규칙은 python-core/extract_current.py.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "python-core" / "data" / "extracts_current.json"
API = "https://escapefromtarkov.fandom.com/api.php"
UA = "tarkov-price-overlay guide builder (+https://tarkov.aquapado.com)"
# 위키 페이지 → tarkov.dev normalizedName 들(같은 맵의 변형 포함)
PAGES = {
    "Woods": ["woods"], "Customs": ["customs"], "Streets_of_Tarkov": ["streets-of-tarkov"],
    "Ground_Zero": ["ground-zero", "ground-zero-21"], "Interchange": ["interchange"], "Shoreline": ["shoreline"],
    "Reserve": ["reserve"], "Lighthouse": ["lighthouse"], "Factory": ["factory", "night-factory"],
    "The_Lab": ["the-lab", "the-lab-dark"], "The_Labyrinth": ["the-labyrinth"], "Terminal": ["terminal"],
}
FACTION = {"PMC": "pmc", "Scav": "scav", "All": "shared"}


def wikitext(page: str) -> str:
    r = requests.get(API, params={"action": "parse", "page": page, "prop": "wikitext", "format": "json"},
                     headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    return (r.json().get("parse") or {}).get("wikitext", {}).get("*", "") or ""


def parse_rows(w: str) -> list[dict]:
    i = w.find("==Extractions")
    if i < 0:
        return []
    seg = w[i:]
    j = re.search(r"\n==[^=]", seg[5:])
    if j:
        seg = seg[: j.start() + 5]
    rows = []
    for row in seg.split("|-")[1:]:
        m = re.search(r'!\s*style="text-align: left;"\s*\|\s*([^\n]+)', row)
        if not m:
            continue
        name = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", r"\1", m.group(1)).strip()
        img = re.search(r"\[\[File:([^\]|]+)", row)
        lines = [ln.strip() for ln in row.split("\n")]
        fac = next((ln[1:].strip() for ln in lines if re.match(r"^\|\s*(Scav|PMC|All)\s*$", ln)), None)
        rows.append({"name": name, "faction": FACTION.get(fac or "", None), "img": (img.group(1).rsplit(".", 1)[0] if img else "")})
    return rows


def main() -> int:
    out = {"checked": time.strftime("%Y-%m-%d"), "source": "https://escapefromtarkov.fandom.com (Extractions 표)", "maps": {}}
    for page, slugs in PAGES.items():
        try:
            rows = parse_rows(wikitext(page))
        except Exception as ex:  # noqa: BLE001
            print(f"[wiki_extracts] {page}: 실패 {ex}", file=sys.stderr)
            rows = []
        if not rows:
            print(f"[wiki_extracts] {page}: 표를 못 읽음 — 이 맵은 필터 없이 둔다", file=sys.stderr)
            continue
        for s in slugs:
            out["maps"][s] = rows
        print(f"[wiki_extracts] {page}: {len(rows)}개 → {', '.join(slugs)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[wiki_extracts] → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
