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
            # 층: SVG 안의 최상위 <g id=svgLayer> 그룹. extents = [{h:[min,max], b:[[x1,z1,x2,z2],…]}] (b 없으면 맵 전체)
            layers = []
            for l in x.get("layers") or []:
                if not l.get("svgLayer"):
                    continue  # 타일 전용 층은 SVG 로 못 그린다
                ext = []
                for e in l.get("extents") or []:
                    h = e.get("height")
                    if not h:
                        continue
                    rects = [[b[0][0], b[0][1], b[1][0], b[1][1]] for b in (e.get("bounds") or []) if isinstance(b, list) and len(b) >= 2]
                    ext.append({"h": [h[0], h[1]], "b": rects})
                layers.append({"name": l.get("name"), "g": l["svgLayer"], "ext": ext})
            out["maps"][slug] = {"svg": x["svgPath"], "rot": x.get("coordinateRotation") or 0, "bounds": x["bounds"],
                                 "transform": x["transform"], "svgBounds": x.get("svgBounds"), "base": x.get("svgLayer"), "layers": layers}
            print(f"[td_maps] {slug}: rot {x.get('coordinateRotation')} {x['svgPath'].rsplit('/', 1)[-1]} 층 {len(layers)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[td_maps] {len(out['maps'])}개 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
