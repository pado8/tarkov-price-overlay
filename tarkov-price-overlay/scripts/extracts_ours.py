"""지금 게임에 있는 탈출구 표 만들기 — 위키 Extractions 표 대신 우리 재료로(11-10, 위키 유래 자료 걷어내기).

재료
  1. tarkov.dev 맵 문서의 탈출구 목록(영어 이름·진영) — 앱이 이미 받는 json.tarkov.dev 캐시
  2. 우리 규칙: ① 같은 이름이 PMC·스캐브 두 줄로 있으면 '모두'(shared)
                ② 변형 맵(밤 공장·GZ 21+·어두운 연구소)은 본 맵의 진영을 따름
                ③ 진영이 비어 있으면(None) '모두'
  3. 예외 목록(아래 REMOVED·SHARED) — 줄마다 근거를 적는다. 근거 = 공식 패치 노트·BSG 공지·사용자 게임 확인.
     위키 문장·표는 근거로 쓰지 않는다.

출력 = python-core/data/extracts_ours.json — 예전 위키 표(extracts_current.json, 11-13 지움)와 같은 모양({"maps": {slug: [{"name", "faction"}]}})이라
extract_current.py 는 읽는 파일만 바꾸면 된다.

  python-core/.venv/Scripts/python.exe scripts/extracts_ours.py           # 만들기 + 위키 표와 차이 보고
"""
from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python-core"))
import extract_current as EC  # noqa: E402
import radar as R  # noqa: E402

OUT = ROOT / "python-core" / "data" / "extracts_ours.json"
VARIANT_BASE = {"night-factory": "factory", "ground-zero-21": "ground-zero", "the-lab-dark": "the-lab"}
TODO = "확인 필요"  # 근거를 아직 못 채운 줄 — 사용자 게임 확인 또는 공식 출처로 채울 것
# 11-10 공식 근거 조사: BSG 가 1.0 패치 노트를 일부러 안 냄(news/id/363 "allowing you to explore the full range of changes by yourself")
#   → 없어진 탈출구는 공식 근거 0 · 공용(shared)은 0.16.0.0 규칙 한 줄(news/id/323 "Hidden exfils are available for both PMCs
#   and Player Scavs.")로 부분 근거. 어떤 탈출구가 '숨겨진 탈출구'인지 맞춘 건 비위키 가이드뿐이라 게임 안 확인이 남음.
GAME = "사용자 게임 확인 필요(공식 노트에 없음)"
HIDDEN = "부분: 공식 0.16.0.0 규칙 news/id/323(숨겨진 탈출구=PMC·스캐브 공용) · 숨겨진 탈출구인지는 게임 확인 필요"
CONTRA = "반대 근거 있음(비공식 가이드: PMC 전용·초록 조명탄) · 게임 확인 필요"

# 1.0 개편으로 없어진 탈출구(tarkov.dev 문서엔 남아 있음). {맵: {영어 이름: 근거}}
REMOVED: dict[str, dict[str, str]] = {
    "factory": {"Gate 2": GAME},
    "customs": {"Factory Shacks": GAME, "Old Road Gate": GAME, "Passage Between Rocks": GAME, "RUAF Roadblock": GAME,
                "Sniper Roadblock": GAME, "Warehouse 4": GAME},
    "shoreline": {"CCP Temporary": GAME, "Cliff Descent": GAME, "Rock Passage": GAME, "Ruined House Fence": GAME,
                  "Svetliy Dead End": GAME},
    "streets-of-tarkov": {"Basement Entrance": GAME, "Scav Checkpoint": GAME},
    "ground-zero": {"Pinewood Basement (Co-Op)": GAME, "Scav Bunker": GAME, "UN Roadblock": GAME},
}
# 한쪽 진영 전용으로 적혀 있지만 지금은 PMC·스캐브 모두 쓰는 탈출구. {맵: {영어 이름: 근거}}
SHARED: dict[str, dict[str, str]] = {
    "factory": {"Smugglers' Passage": HIDDEN},
    "customs": {"Railroad to Reserve": GAME, "Smugglers' Boat": HIDDEN, "Smugglers' Bunker (ZB-1012)": GAME},
    "woods": {"Railway Bridge to Tarkov": HIDDEN},
    "lighthouse": {"Passage by the Lake": HIDDEN},
    "shoreline": {"Mountain Bunker": HIDDEN},
    "reserve": {"Exit to Woods": HIDDEN},
    "interchange": {"Hole in the Fence": CONTRA},
    "streets-of-tarkov": {"Smugglers' Basement": HIDDEN},
    "ground-zero": {"Tartowers Sales Office": HIDDEN},
}


def build() -> dict:
    maps = (R._doc("regular/maps") or {})["maps"]
    loc = R._doc("regular/maps_en") or {}
    by_slug = {m["normalizedName"]: m for m in maps.values()}
    facs: dict[str, dict[str, set]] = {}
    names: dict[str, dict[str, str]] = {}
    for slug, m in by_slug.items():
        f, n = defaultdict(set), {}
        for ex in m.get("extracts") or []:
            en = R._loc(loc, ex.get("name"), ex.get("name"))
            k = EC.norm(en)
            if k:
                f[k].add(ex.get("faction"))
                n.setdefault(k, en)
        facs[slug], names[slug] = f, n

    def faction(slug: str, k: str) -> str:
        base = VARIANT_BASE.get(slug)
        sh = {EC.norm(x) for x in SHARED.get(base or slug, {})}
        if k in sh:
            return "shared"
        fs = facs[slug].get(k, set()) - {None}
        if base and not fs:  # 규칙 ② 변형 맵 진영 비어 있으면 본 맵
            fs = facs.get(base, {}).get(k, set()) - {None}
        if {"pmc", "scav"} <= fs:  # 규칙 ①
            return "shared"
        return next(iter(fs)) if len(fs) == 1 else "shared"  # 규칙 ③

    out: dict[str, list] = {}
    for slug in by_slug:
        if not names[slug]:
            continue
        base = VARIANT_BASE.get(slug, slug)
        rm = {EC.norm(x) for x in REMOVED.get(base, {})}
        out[slug] = [{"name": names[slug][k], "faction": faction(slug, k)} for k in sorted(names[slug]) if k not in rm]
    return {"checked": time.strftime("%Y-%m-%d"),
            "source": "tarkov.dev 탈출구 목록 + 우리 규칙(두 진영 줄→모두·변형 맵→본 맵·빈 진영→모두) + 근거 적은 예외(scripts/extracts_ours.py)",
            "evidence": {"removed": REMOVED, "shared": SHARED}, "maps": out}


def diff_vs_wiki(new: dict) -> list[str]:
    """지금 위키 표로 거른 결과와 다른 곳(맵·이름·차이) — 0 이어야 그대로 갈아끼울 수 있다."""
    try:  # 예전 위키 표(data/extracts_current.json)가 남아 있을 때만 비교 — 지운 뒤엔 비교 생략
        raw = json.loads(EC._data_path("extracts_current.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return []
    wiki = {slug: {EC.norm(r["name"]): r.get("faction") for r in rows} for slug, rows in (raw.get("maps") or {}).items()}
    alias = {"holeinthefence": "smugglerstunnel"}  # 위키 이름만 다르던 것

    def wlook(slug, en):
        k = EC.norm(en)
        for c in (k, alias.get(k, ""), k[3:] if k.startswith("the") else ""):
            if c and c in wiki[slug]:
                return True, wiki[slug][c], c
        return False, None, ""
    loc = R._doc("regular/maps_en") or {}
    maps = (R._doc("regular/maps") or {})["maps"]
    diffs = []
    for m in maps.values():
        slug = m["normalizedName"]
        if slug not in wiki or slug not in new["maps"]:
            continue
        ours = {EC.norm(r["name"]): r["faction"] for r in new["maps"][slug]}
        for ex in m.get("extracts") or []:
            en = R._loc(loc, ex.get("name"), ex.get("name"))
            wk, wf, _ = wlook(slug, en)
            k = EC.norm(en)
            ok = k in ours
            if wk != ok:
                diffs.append(f"{slug} · {en} · 위키 {'남김' if wk else '버림'} / 우리 {'남김' if ok else '버림'}")
            elif ok and wf and wf != ours[k]:
                diffs.append(f"{slug} · {en} · 진영 위키 {wf} / 우리 {ours[k]}")
    return sorted(set(diffs))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    new = build()
    OUT.write_text(json.dumps(new, ensure_ascii=False, indent=1), encoding="utf-8")
    todo = sum(v != HIDDEN for d in (REMOVED, SHARED) for m in d.values() for v in m.values())
    print(f"저장 {OUT.name} · 맵 {len(new['maps'])} · 탈출구 {sum(len(v) for v in new['maps'].values())} · 게임 확인이 남은 예외 {todo}")
    d = diff_vs_wiki(new)
    print(f"위키 표와 다른 곳 {len(d)}")
    for x in d[:40]:
        print("  ", x)
