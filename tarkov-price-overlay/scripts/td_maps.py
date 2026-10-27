"""tarkov.dev 사이트의 maps.json(MIT, the-hideout/tarkov-dev) → python-core/data/td_maps.json

레이더 전체 지도가 지도 그림(assets.tarkov.dev SVG, CC BY-NC-SA 4.0 — 출처 표기·비영리)을 게임 좌표에 맞춰 깔 때 쓰는 값만 추린다:
coordinateRotation(90° 단위), bounds([[x,z],[x,z]] 두 모서리), transform([scaleX, offX, scaleY, offY]), svgPath.
좌표 해석은 tarkov-dev src/pages/map/index.jsx getCRS/applyRotation/pos 와 같다(RadarMap.tsx 의 imgMatrix 참고).
실행: python-core/.venv/Scripts/python.exe scripts/td_maps.py
"""
from __future__ import annotations

import json
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "python-core" / "data" / "td_maps.json"
SRC = "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json"


def main() -> int:
    r = requests.get(SRC, timeout=60)
    r.raise_for_status()
    out = {"source": SRC, "license": "maps.json MIT · SVG CC BY-NC-SA 4.0 (tarkov.dev)", "maps": {}}
    for m in r.json():
        slug = m.get("normalizedName")
        for x in m.get("maps") or []:
            if x.get("projection") != "interactive" or not x.get("svgPath") or not x.get("bounds") or not x.get("transform"):
                continue
            out["maps"][slug] = {"svg": x["svgPath"], "rot": x.get("coordinateRotation") or 0, "bounds": x["bounds"],
                                 "transform": x["transform"], "svgBounds": x.get("svgBounds")}
            print(f"[td_maps] {slug}: rot {x.get('coordinateRotation')} {x['svgPath'].rsplit('/', 1)[-1]}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[td_maps] {len(out['maps'])}개 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
