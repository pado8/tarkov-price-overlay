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
# 그림이 좌표와 안 맞아 넣지 않는 맵(11-04 검증: 그림 위에 스폰·탈출구를 같은 투영식으로 찍어 봄)
SKIP_TILES = {
    "icebreaker": "transform 세로 배율 3.5 가 그림과 안 맞음 — 선체가 스폰 범위의 46% 길이로 그려져 스폰 56개 중 15개·헬기 탈출구가 그림 밖(가로 2.0 은 맞음)",
}


def main() -> int:
    r = requests.get(SRC, timeout=60)
    r.raise_for_status()
    out = {"source": SRC, "license": "maps.json MIT · SVG·타일 CC BY-NC-SA 4.0 (tarkov.dev · 쇄빙선 타일 TarkovBOT.eu)", "maps": {}}
    for m in r.json():
        slug = m.get("normalizedName")
        for x in m.get("maps") or []:
            if x.get("projection") != "interactive" or not x.get("bounds") or not x.get("transform"):
                continue
            if slug in SKIP_TILES:
                print(f"[td_maps] {slug}: 건너뜀 — {SKIP_TILES[slug]}")
                continue
            svg = x.get("svgPath")
            tiles = None if svg else x.get("tilePath")  # 11-04: SVG 가 없는 맵(연구소·미궁·쇄빙선)은 타일 PNG — 사이드카가 이어 붙인다
            if not svg and not tiles:
                continue
            # 층: SVG 맵은 SVG 안의 최상위 <g id=svgLayer> 그룹, 타일 맵은 층마다 다른 tilePath.
            # extents = [{h:[min,max], b:[[x1,z1,x2,z2],…]}] (b 없으면 맵 전체)
            layers = []
            for i, l in enumerate(x.get("layers") or []):
                if svg and not l.get("svgLayer"):
                    continue  # SVG 맵의 타일 전용 층은 그리지 않는다
                if not svg and not l.get("tilePath"):
                    continue
                ext = []
                for e in l.get("extents") or []:
                    h = e.get("height")
                    if not h:
                        continue
                    rects = [[b[0][0], b[0][1], b[1][0], b[1][1]] for b in (e.get("bounds") or []) if isinstance(b, list) and len(b) >= 2]
                    ext.append({"h": [h[0], h[1]], "b": rects})
                g = l.get("svgLayer") if svg else f"L{i}"  # 타일 층 id = 순번(사이드카 ?layer= 로 받는 값이라 안전한 글자만)
                layers.append({"name": l.get("name"), "g": g, "ext": ext, **({"tiles": l["tilePath"]} if not svg else {})})
            out["maps"][slug] = {"svg": svg, "rot": x.get("coordinateRotation") or 0, "bounds": x["bounds"],
                                 "transform": x["transform"], "svgBounds": x.get("svgBounds"), "base": x.get("svgLayer"), "layers": layers}
            if tiles:
                out["maps"][slug].update({"tiles": tiles, "tileSize": x.get("tileSize") or 256,
                                          "minZoom": x.get("minZoom") or 0, "maxZoom": x.get("maxZoom") or 5,
                                          "author": x.get("author") or "tarkov.dev"})
            src = svg.rsplit("/", 1)[-1] if svg else f"타일 {tiles.split('/maps/', 1)[-1].split('/{z}', 1)[0]}"
            print(f"[td_maps] {slug}: rot {x.get('coordinateRotation')} {src} 층 {len(layers)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[td_maps] {len(out['maps'])}개 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
