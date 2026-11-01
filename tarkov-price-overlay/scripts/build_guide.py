"""타르코프 가이드(카파템·열쇠·퀘스트 필요템) 정적 페이지 생성기.

데이터: json.tarkov.dev (앱 시세 폴백과 같은 공식 소스, 한국어 로케일 포함).
출력:   landing/guide/{kappa,keys,quests}/index.html  (각 페이지에 데이터 내장)
        + guide_static.py가 만드는 정적 페이지 전부(퀘스트 상세 500여 개·상인별·필요 아이템·
          퀘스트 전용 아이템·은신처·초반 가이드·프레스티지·맵·보스·가이드 홈) + landing/sitemap.xml

실행:   python-core/.venv/Scripts/python.exe scripts/build_guide.py
다시 돌리면 최신 패치 데이터로 갱신된다(열쇠 목록 '최신화'가 이것).
개발 중엔 GUIDE_CACHE=<폴더> 를 주면 받은 JSON을 그 폴더에 두고 재사용한다(배포용 빌드엔 쓰지 말 것).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

import requests

import guide_static

BASE = "https://json.tarkov.dev"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "landing" / "guide"
COLLECTOR_ID = "5c51aac186f77432ea65c552"
# 같은 지도의 변형(야간·21+·튜토리얼·암전)은 열쇠 목록이 겹치므로 대표 지도로 합친다.
MAP_SKIP = {"night-factory", "ground-zero-21", "ground-zero-tutorial", "the-lab-dark"}
MAP_ORDER = ["customs", "factory", "woods", "shoreline", "interchange", "reserve",
             "lighthouse", "streets-of-tarkov", "ground-zero", "the-lab",
             "icebreaker", "terminal", "the-labyrinth"]


def get(path: str):
    cache = os.environ.get("GUIDE_CACHE")
    if cache:
        f = Path(cache) / (path.replace("/", "_") + ".json")
        if f.exists() and f.stat().st_size > 0:
            return json.loads(f.read_text(encoding="utf-8")).get("data")
    r = requests.get(f"{BASE}/{path}", timeout=120)
    r.raise_for_status()
    if cache:
        (Path(cache) / (path.replace("/", "_") + ".json")).write_bytes(r.content)
    return r.json().get("data")


SITEMAP_HEAD = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
"""


def write_sitemap(guide_urls: list[str], stamp: str) -> None:
    """랜딩 3개(언어 대체 주소 포함) + 가이드 전 페이지. 랜딩 lastmod는 기존 값을 유지한다."""
    sm = ROOT / "landing" / "sitemap.xml"
    old = sm.read_text(encoding="utf-8") if sm.exists() else ""

    def old_lastmod(loc):
        m = re.search(r"<loc>" + re.escape(loc) + r"</loc>.*?<lastmod>([^<]+)</lastmod>", old, re.S)
        return m.group(1) if m else stamp

    alts = ['<xhtml:link rel="alternate" hreflang="ko" href="https://tarkov.aquapado.com/" />',
            '<xhtml:link rel="alternate" hreflang="en" href="https://tarkov.aquapado.com/en" />',
            '<xhtml:link rel="alternate" hreflang="ru" href="https://tarkov.aquapado.com/ru" />',
            '<xhtml:link rel="alternate" hreflang="x-default" href="https://tarkov.aquapado.com/" />']
    nl = chr(10)
    out = [SITEMAP_HEAD.rstrip(nl)]
    for loc, pri in (("https://tarkov.aquapado.com/", "1.0"), ("https://tarkov.aquapado.com/en", "0.9"),
                     ("https://tarkov.aquapado.com/ru", "0.9")):
        out += ["  <url>", f"    <loc>{loc}</loc>"] + [f"    {a}" for a in alts] + [
            f"    <lastmod>{old_lastmod(loc)}</lastmod>", "    <changefreq>weekly</changefreq>",
            f"    <priority>{pri}</priority>", "  </url>"]

    def pri_of(u):
        if u == "/guide/":
            return "0.9"
        return "0.8" if u.count("/") <= 3 else "0.6"

    # 가이드는 ko(/guide/x/)·en(/guide/en/x/)·ru(/guide/ru/x/) 세 판 — 각 항목에 언어 대체 주소를 단다
    for u in sorted(set(guide_urls), key=lambda u: (u.count("/"), u)):
        galts = [f'<xhtml:link rel="alternate" hreflang="{l}" href="https://tarkov.aquapado.com{guide_static.lang_path(u, l)}" />'
                 for l, _, _ in guide_static.LANGS] + [f'<xhtml:link rel="alternate" hreflang="x-default" href="https://tarkov.aquapado.com{u}" />']
        for l, _, _ in guide_static.LANGS:
            out += ["  <url>", f"    <loc>https://tarkov.aquapado.com{guide_static.lang_path(u, l)}</loc>"] + [f"    {a}" for a in galts] + [
                f"    <lastmod>{stamp}</lastmod>", "    <changefreq>weekly</changefreq>",
                f"    <priority>{pri_of(u) if l == 'ko' else '0.5'}</priority>", "  </url>"]
    # 개인정보처리방침(landing/privacy/index.html, 손글) — 광고 심사·검색 노출용으로 사이트맵에 포함
    out += ["  <url>", "    <loc>https://tarkov.aquapado.com/privacy/</loc>",
            f"    <lastmod>{old_lastmod('https://tarkov.aquapado.com/privacy/')}</lastmod>",
            "    <changefreq>yearly</changefreq>", "    <priority>0.3</priority>", "  </url>"]
    # 사이트 소개·운영자(landing/about/index.html, 손글)
    out += ["  <url>", "    <loc>https://tarkov.aquapado.com/about/</loc>",
            f"    <lastmod>{old_lastmod('https://tarkov.aquapado.com/about/')}</lastmod>",
            "    <changefreq>yearly</changefreq>", "    <priority>0.3</priority>", "  </url>"]
    out.append("</urlset>")
    sm.write_text(nl.join(out) + nl, encoding="utf-8")
    print(f"[guide] sitemap: {len(set(guide_urls)) * 3 + 5} URL (가이드 {len(set(guide_urls))}쪽 × 3개 언어)")


def main() -> int:
    t0 = time.time()
    # 언어판: GUIDE_LANG=ko(기본)·en·ru. ko 외는 tarkov.dev 해당 로케일 표를 쓰고 /guide/<lang>/ 아래에 쓴다.
    lang = (os.environ.get("GUIDE_LANG") or "ko").lower()
    if lang not in ("ko", "en", "ru"):
        raise SystemExit(f"GUIDE_LANG must be ko/en/ru (got {lang})")
    sfx = f"_{lang}"
    out_dir = OUT if lang == "ko" else OUT / lang
    global guide_static
    i18n_missing: set = set()
    if lang != "ko":
        # 생성기 소스의 한글 구간을 번역표로 치환한 모듈로 바꿔 끼운다(guide_i18n.py 설명 참고)
        import guide_i18n
        table = guide_i18n.load_table(lang)
        if not table:
            raise SystemExit(f"번역표가 없습니다: scripts/guide_i18n/{lang}.json")
        sys.path.insert(0, str(ROOT / "python-core"))
        guide_i18n.load_module(ROOT / "python-core" / "extract_conditions.py", "extract_conditions", table, i18n_missing)
        guide_static = guide_i18n.load_module(ROOT / "scripts" / "guide_static.py", "guide_static", table, i18n_missing)
        guide_static.set_lang(lang, table)
    else:
        guide_static.set_lang(lang)
    items_reg = get("regular/items")["items"]
    items_pve = get("pve/items")["items"]
    loc_items = get(f"regular/items{sfx}") or {}
    loc_items_en = get("regular/items_en") or {}
    # 퀘스트는 모드마다 조금 다르다(23개가 [PVP ZONE]/[PVE ZONE] 판으로 갈림, 프레스티지
    # 퀘스트는 일반판에만) → 두 모드의 합집합으로 만들고 퀘스트마다 속한 모드를 단다.
    tasks_doc_reg = get("regular/tasks")
    tasks_doc_pve = get("pve/tasks")
    tasks_reg = tasks_doc_reg["tasks"]
    tasks_pve = tasks_doc_pve["tasks"]
    tasks = {**tasks_pve, **tasks_reg}
    task_modes = {tid: [m for m, src in (("pvp", tasks_reg), ("pve", tasks_pve)) if tid in src]
                  for tid in tasks}
    sys.path.insert(0, str(ROOT / "python-core"))
    # 두 모드 로케일 병합: 같은 키면 '그 언어 글자가 든 쪽' 우선(regular 는 영어로 남아 있고 pve 에만 한글이 있는 키가
    # 83개 있었다 — regular 가 덮어써 공식 한글이 버려지던 것, 2026-11-02 검수에서 발견)
    script = {"ko": re.compile(r"[가-힣]"), "ru": re.compile(r"[А-Яа-яЁё]"), "en": re.compile(r"[A-Za-z]")}[lang]
    loc_tasks = dict(get(f"pve/tasks{sfx}") or {})
    for k, v in (get(f"regular/tasks{sfx}") or {}).items():
        cur = loc_tasks.get(k)
        if not (isinstance(cur, str) and script.search(cur) and not (isinstance(v, str) and script.search(v))):
            loc_tasks[k] = v
    if lang == "ko":
        import quest_ko  # 영어로 남은 퀘스트 이름·목표의 한국어 보정 표(python-core/data/quest_ko.json) — 사이드카와 공유
        loc_tasks = quest_ko.overlay(loc_tasks)
    loc_tasks_en = {**(get("pve/tasks_en") or {}), **(get("regular/tasks_en") or {})}
    maps_doc = get("regular/maps")
    maps = maps_doc["maps"]
    loc_maps = get(f"regular/maps{sfx}") or {}
    traders = get("regular/traders")
    loc_traders = get(f"regular/traders{sfx}") or {}
    print(f"[guide] 데이터 수신 {time.time() - t0:.1f}s — 아이템 {len(items_reg)}, 퀘스트 {len(tasks)}, 지도 {len(maps)}")

    def loc(table, key, fallback=None):
        if key is None:
            return fallback
        v = table.get(key)
        return (v.strip() if isinstance(v, str) and v.strip() else fallback)

    def trader_name(tid):
        tr = traders.get(tid) or {}
        return loc(loc_traders, tr.get("name"), tr.get("normalizedName") or "?")

    def best_sell(it):
        best = None
        for s in it.get("sellToTrader") or it.get("sellFor") or []:
            price = s.get("priceRUB") or s.get("price")
            if isinstance(price, (int, float)) and (best is None or price > best[1]):
                best = (s.get("trader") or s.get("vendor"), price)
        return best

    item_cache: dict[str, dict] = {}

    def item_info(iid: str) -> dict | None:
        if iid in item_cache:
            return item_cache[iid]
        it = items_reg.get(iid)
        if not isinstance(it, dict):
            return None
        pv = items_pve.get(iid) or {}
        en = loc(loc_items_en, it.get("name"), it.get("name"))
        info = {
            "id": iid,
            "n": loc(loc_items, it.get("name"), en),
            "en": en,
            "s": loc(loc_items, it.get("shortName"), loc(loc_items_en, it.get("shortName"), "")),
            "img": it.get("gridImageLink") or it.get("iconLink"),
            "w": it.get("width") or 1,
            "h": it.get("height") or 1,
            "pvp": it.get("avg24hPrice"),
            "pve": pv.get("avg24hPrice"),
            "wiki": it.get("wikiLink"),
            "noflea": "noFlea" in (it.get("types") or []),
        }
        bs = best_sell(it)
        if bs:
            info["tr"] = [trader_name(bs[0]) if isinstance(bs[0], str) else "?", bs[1]]
        props = it.get("properties") or {}
        if isinstance(props, dict) and props.get("uses"):
            info["uses"] = props["uses"]
        item_cache[iid] = info
        return info

    zone_re = re.compile(r"\s*\[(?:PVP|PVE) ZONE\]\s*$")

    def task_name(t):
        """(한국어, 영어) — 모드 판 표기 '[PVP ZONE]'은 떼고 배지로 보여 준다."""
        en = loc(loc_tasks_en, t.get("name"), t.get("normalizedName")) or ""
        ko = loc(loc_tasks, t.get("name"), en) or en
        return zone_re.sub("", ko), zone_re.sub("", en)

    def map_name(mid):
        m = maps.get(mid) if mid else None
        if not m:
            return None
        return loc(loc_maps, m.get("name"), m.get("normalizedName"))

    # ── 카파(컬렉터) ──────────────────────────────────────────
    col = tasks[COLLECTOR_ID]
    kappa = []
    seen = set()
    for o in col.get("objectives") or []:
        if o.get("type") not in ("giveItem", "findItem"):
            continue
        for iid in o.get("items") or []:
            if iid in seen:
                continue
            info = item_info(iid)
            if not info:
                continue
            seen.add(iid)
            kappa.append({**info, "c": o.get("count") or 1, "fir": bool(o.get("foundInRaid"))})
    kappa.sort(key=lambda x: x["n"])
    col_req = {
        "level": col.get("minPlayerLevel"),
        "tasks": [task_name(tasks[r["task"]])[0] for r in col.get("taskRequirements") or [] if r.get("task") in tasks],
        "traders": [f"{trader_name(r.get('trader'))} {r.get('value')}" for r in col.get("traderRequirements") or []
                    if r.get("requirementType") == "level"],
        "trader": trader_name(col.get("trader")),
        "wiki": col.get("wikiLink"),
    }

    # ── 퀘스트 ────────────────────────────────────────────────
    qlist = []
    for tid, t in tasks.items():
        ko, en = task_name(t)
        give = []
        quest_items = []
        for o in t.get("objectives") or []:
            ty = o.get("type")
            if ty == "giveItem":
                ids = [i for i in o.get("items") or [] if item_info(i)]
                if ids:
                    give.append({"i": ids, "c": o.get("count") or 1, "fir": bool(o.get("foundInRaid")),
                                 "opt": bool(o.get("optional"))})
            elif ty in ("giveQuestItem",):
                quest_items.append(1)
        keys = []
        for nk in t.get("neededKeys") or []:
            for k in nk.get("keys") or []:
                if item_info(k):
                    keys.append(k)
        mp = t.get("map")
        mid = mp.get("id") if isinstance(mp, dict) else mp
        qlist.append({
            "id": tid, "n": ko, "en": en,
            "tr": trader_name(t.get("trader")),
            "lv": t.get("minPlayerLevel") or 1,
            "map": map_name(mid),
            "modes": task_modes.get(tid, ["pvp", "pve"]),
            "kappa": bool(t.get("kappaRequired")),
            "lk": bool(t.get("lightkeeperRequired")),
            "wiki": t.get("wikiLink"),
            "give": give,
            "keys": sorted(set(keys)),
            "req": [r["task"] for r in t.get("taskRequirements") or [] if r.get("task") in tasks],
            "slug": t.get("normalizedName"),
        })
    # 상인 순서는 언어와 무관하게 normalizedName 으로(ko 이름으로 비교하면 en/ru 판에서 전부 99가 된다)
    trader_rank = {tid: (guide_static.TRADER_ORDER.index(tr.get("normalizedName")) if tr.get("normalizedName") in guide_static.TRADER_ORDER else 99)
                   for tid, tr in traders.items()}
    tr_by_name = {trader_name(tid): r for tid, r in trader_rank.items()}
    qlist.sort(key=lambda q: (tr_by_name.get(q["tr"], 99), q["lv"], q["n"]))

    # 열쇠 → 이 열쇠가 필요한 퀘스트
    key_tasks: dict[str, list[str]] = {}
    for q in qlist:
        for k in q["keys"]:
            names = key_tasks.setdefault(k, [])
            if q["n"] not in names:  # PVP·PVE 판이 같은 이름이면 한 번만
                names.append(q["n"])

    # ── 열쇠(지도별) ──────────────────────────────────────────
    key_maps = []
    for m in maps.values():
        nn = m.get("normalizedName")
        if nn in MAP_SKIP:
            continue
        by_key: dict[str, dict] = {}
        for lk in m.get("locks") or []:
            k = lk.get("key")
            if not k or not item_info(k):
                continue
            e = by_key.setdefault(k, {"locks": 0, "power": False, "types": set()})
            e["locks"] += 1
            e["power"] = e["power"] or bool(lk.get("needsPower"))
            if lk.get("lockType"):
                e["types"].add(lk["lockType"])
        access = [k for k in m.get("accessKeys") or [] if item_info(k)]
        if not by_key and not access:
            continue
        keys = []
        for k, e in by_key.items():
            keys.append({"id": k, "locks": e["locks"], "power": e["power"],
                         "lt": sorted(e["types"]), "q": key_tasks.get(k, [])})
        key_maps.append({
            "id": nn, "n": loc(loc_maps, m.get("name"), nn),
            "access": access, "keys": keys,
        })
    key_maps.sort(key=lambda x: MAP_ORDER.index(x["id"]) if x["id"] in MAP_ORDER else 99)

    # 페이지가 참조하는 아이템만 내장
    def items_for(ids):
        return {i: item_cache[i] for i in ids if i in item_cache}

    stamp = time.strftime("%Y-%m-%d")
    # ── 정적 페이지용 컨텍스트 — 퀘스트 목록 템플릿에도 같은 '구분 표시'를 쓰려고 먼저 만든다 ──
    ctx = guide_static.Ctx(
        stamp=stamp, items=items_reg, items_pve=items_pve, loc_items=loc_items, loc_items_en=loc_items_en,
        tasks_reg=tasks_reg, tasks_pve=tasks_pve, loc_tasks=loc_tasks, loc_tasks_en=loc_tasks_en,
        quest_items={**(tasks_doc_pve.get("questItems") or {}), **(tasks_doc_reg.get("questItems") or {})},
        achievements={**(tasks_doc_pve.get("achievements") or {}), **(tasks_doc_reg.get("achievements") or {})},
        prestige_reg=tasks_doc_reg.get("prestige") or [], prestige_pve=tasks_doc_pve.get("prestige") or [],
        maps=maps, loc_maps=loc_maps, mobs=maps_doc.get("mobs") or {},
        traders=traders, loc_traders=loc_traders,
        hideout_reg=get("regular/hideout") or {}, hideout_pve=get("pve/hideout") or {},
        loc_hideout=get(f"regular/hideout{sfx}") or {},
        crafts_reg=get("regular/crafts") or [], crafts_pve=get("pve/crafts") or [],
    )
    for q in qlist:  # 같은 이름 퀘스트 구분 (BEAR/USEC·PVP/PVE·레벨별 판)
        suf = ctx.display_suffix.get(q["id"])
        if suf:
            q["n"] = f'{q["n"]} ({suf})'
    pages = {
        "kappa": {"items": kappa, "req": col_req},
        "keys": {"maps": key_maps,
                 "items": items_for({k["id"] for mp in key_maps for k in mp["keys"]} |
                                    {a for mp in key_maps for a in mp["access"]})},
        "quests": {"quests": qlist,
                   "items": items_for({i for q in qlist for g in q["give"] for i in g["i"]} |
                                      {k for q in qlist for k in q["keys"]})},
    }
    for name, data in pages.items():
        tpl = (ROOT / "scripts" / "guide_templates" / f"{name}.html").read_text(encoding="utf-8")
        tpl = re.sub(r"<nav>.*?</nav>", lambda _m: guide_static.nav_html(name), tpl, count=1, flags=re.S)  # 언어 전환은 localize_template 이 붙인다
        if 'src="/guide/sync.js"' not in tpl:  # 오버레이 연동 스크립트 — page() 로 만드는 페이지와 같게
            tpl = tpl.replace("</body>", '<script src="/guide/sync.js" defer></script>\n</body>', 1)
        if 'href="/privacy/"' not in tpl:  # 개인정보처리방침 링크 — 광고 심사 요건, page() 푸터와 같게
            tpl = tpl.replace("</div></footer>", ' · <a href="/privacy/">개인정보처리방침</a></div></footer>', 1)
        if 'href="/about/"' not in tpl:  # 사이트 소개·운영자 링크 — 광고 심사 요건(운영 주체·연락처), 방침 링크 앞에
            tpl = tpl.replace(' · <a href="/privacy/">', ' · <a href="/about/">소개</a> · <a href="/privacy/">', 1)
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        # 번역은 자리표시자를 채우기 전에(추출 때와 같은 구간이어야 표에 맞는다)
        page = guide_static.localize_template(tpl, f"/guide/{name}/").replace("__DATA__", payload).replace("__STAMP__", stamp)
        dest = out_dir / name / "index.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(page, encoding="utf-8")
        print(f"[guide] {name}: {len(page) / 1024:.0f} KB")
    # ── 정적 페이지(퀘스트 상세·상인별·아이템·은신처·초반·프레스티지·맵·보스·가이드 홈) ──
    collector_ids = {k["id"] for k in kappa}
    guide_urls = ["/guide/kappa/", "/guide/keys/", "/guide/quests/"]
    guide_urls += guide_static.build_all(ctx, out_dir, collector_ids, {
        "kappa": len(kappa), "keys": len(pages["keys"]["items"])})
    print(f"[guide] 정적 페이지 {len(guide_urls) - 3}개 ({lang})")
    if lang == "ko":
        write_sitemap(guide_urls, stamp)
    css = (ROOT / "scripts" / "guide_templates" / "guide.css").read_text(encoding="utf-8")
    (OUT / "guide.css").write_text(css, encoding="utf-8")
    import adsense  # 새로 만든 페이지에도 AdSense 코드 유지(ID 없으면 아무것도 안 넣음)
    n_ad, cid = adsense.apply()
    print(f"[guide] AdSense: {cid or '끔'} · 바뀐 페이지 {n_ad}")
    import ga4  # GA4도 같은 방식(ID 없으면 아무것도 안 넣음)
    n_ga, gid = ga4.apply()
    print(f"[guide] GA4: {gid or '끔'} · 바뀐 페이지 {n_ga}")
    if lang != "ko":
        # 번역 누락 검사: 생성된 페이지에 한글이 남아 있으면 번역표에 없는 구간이다
        han = re.compile(r"[가-힣]")
        left = 0
        sample: list[str] = []
        for f in out_dir.rglob("index.html"):
            txt = f.read_text(encoding="utf-8")
            n = len(han.findall(txt))
            if n:
                left += 1
                if len(sample) < 5:
                    m = re.search(r"[^<>\"]*[가-힣][^<>\"]*", txt)
                    sample.append(f"{f.relative_to(out_dir)}: {m.group(0).strip()[:60] if m else ''}")
        miss_f = ROOT / "scripts" / "guide_i18n" / f"missing_{lang}.json"
        miss_f.write_text(json.dumps(sorted(i18n_missing), ensure_ascii=False, indent=0), encoding="utf-8")
        print(f"[guide] {lang}: 한글 남은 페이지 {left}개 · 번역표 누락 구간 {len(i18n_missing)}개 → {miss_f.name}")
        for s in sample:
            print("   ", s)
    print(f"[guide] 완료 {time.time() - t0:.1f}s → {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
