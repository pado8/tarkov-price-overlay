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
MAP_SKIP = {"night-factory", "ground-zero-21", "ground-zero-tutorial", "the-lab-dark",
            "infected-factory", "infected-lab"}  # 11-05: 할로윈 변형 맵 — 원래 맵과 같은 열쇠가 따로 한 번 더 나왔다
# 열쇠 페이지에서 뺄 (맵, 열쇠 id) — tarkov.dev locks 의 trunk 항목이 엉뚱한 열쇠를 가리키는 잔재(2026-11-02 위키 전수 대조):
# 공장 비상구 열쇠(5448ba0b…)는 위키 기준 공장 전용인데 해안선·등대·시내·그라운드 제로 금고 17개를 여는 것으로 들어 있고,
# VAZ 차 열쇠(5913651…)는 위키가 "여는 곳 없음"인데 세관 잠금 1개가 붙어 있다.
KEY_SKIP = {("streets-of-tarkov", "61aa5ba8018e9821b7368da9"),  # 11-05: USEC 별장 두 번째 금고 열쇠 — 시내 trunk 잔재(위키는 등대만)
            ("shoreline", "5448ba0b4bdc2d02308b456c"), ("lighthouse", "5448ba0b4bdc2d02308b456c"),
            ("streets-of-tarkov", "5448ba0b4bdc2d02308b456c"), ("ground-zero", "5448ba0b4bdc2d02308b456c"),
            ("customs", "5913651986f774432f15d132")}
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


NOINDEX_PATHS = {"/guide/favorites/"}


def write_sitemap(guide_urls: list[str], stamp: str) -> None:
    """랜딩 3개(언어 대체 주소 포함) + 가이드 전 페이지. 랜딩 lastmod는 기존 값을 유지한다."""
    sm = ROOT / "landing" / "sitemap.xml"
    old = sm.read_text(encoding="utf-8") if sm.exists() else ""
    # noindex 페이지(내 즐겨찾기 등 개인 화면)는 사이트맵에 넣지 않는다 — 서치콘솔 '제출됐지만 noindex' 경고(11-04 점검)
    guide_urls = [u for u in guide_urls if u not in NOINDEX_PATHS]

    def old_lastmod(loc):
        m = re.search(r"<loc>" + re.escape(loc) + r"</loc>.*?<lastmod>([^<]+)</lastmod>", old, re.S)
        return m.group(1) if m else stamp

    alts = ['<xhtml:link rel="alternate" hreflang="ko" href="https://tarkov.aquapado.com/" />',
            '<xhtml:link rel="alternate" hreflang="en" href="https://tarkov.aquapado.com/en/" />',
            '<xhtml:link rel="alternate" hreflang="ru" href="https://tarkov.aquapado.com/ru/" />',
            '<xhtml:link rel="alternate" hreflang="x-default" href="https://tarkov.aquapado.com/" />']
    nl = chr(10)
    out = [SITEMAP_HEAD.rstrip(nl)]
    for loc, pri in (("https://tarkov.aquapado.com/", "1.0"), ("https://tarkov.aquapado.com/en/", "0.9"),
                     ("https://tarkov.aquapado.com/ru/", "0.9")):
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
            loc = f"https://tarkov.aquapado.com{guide_static.lang_path(u, l)}"
            out += ["  <url>", f"    <loc>{loc}</loc>"] + [f"    {a}" for a in galts] + [
                f"    <lastmod>{old_lastmod(loc)}</lastmod>", "    <changefreq>weekly</changefreq>",  # 실제 날짜는 refresh_lastmod 가 정한다
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


# 11-04: 사이트맵 lastmod 를 '내용이 실제로 바뀐 날'로. 전엔 빌드마다 1,794쪽 전부 빌드 날짜가 찍혀
# 구글이 lastmod 를 믿지 않게 된다(늘 바뀌는 값은 무시). 쪽마다 제목·설명·<main> 본문의 지문을 저장해 두고
# 지문이 같으면 예전 날짜를 유지한다. 본문 안 날짜 표기('데이터 기준 YYYY-MM-DD')·스크립트·주석은 지문에서 뺀다.
# 시세가 들어간 쪽(필요 아이템·카파·열쇠 등)은 값이 바뀐 날마다 실제로 날짜가 올라간다(맞는 동작).
# 세 언어 빌드가 각각 끝날 때 부른다 — 사이트맵은 ko 빌드 때만 다시 쓰지만 en/ru 쪽은 그 뒤에 만들어지므로.
LASTMOD_F = ROOT / "scripts" / "guide_data" / "page_lastmod.json"


def _page_print(html_text: str) -> str:
    import hashlib
    t = re.search(r"<title>.*?</title>", html_text, re.S)
    d = re.search(r'<meta name="description" content="[^"]*"', html_text)
    m = re.search(r"<main\b.*?</main>", html_text, re.S)
    s = (t.group(0) if t else "") + (d.group(0) if d else "") + (m.group(0) if m else html_text)
    s = re.sub(r"<script\b.*?</script>|<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"\d{4}-\d{2}-\d{2}", "", s)
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:16]


def refresh_lastmod(stamp: str) -> None:
    sm = ROOT / "landing" / "sitemap.xml"
    if not sm.exists():
        return
    text = sm.read_text(encoding="utf-8")
    try:
        store = json.loads(LASTMOD_F.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        store = {}
    new_store: dict = {}
    changed = 0

    def rep(mo):
        nonlocal changed
        block, loc = mo.group(0), mo.group(1)
        path = loc.replace("https://tarkov.aquapado.com", "")
        if not path.startswith("/guide/"):
            return block
        f = ROOT / "landing" / path.lstrip("/") / "index.html"
        if not f.exists():
            return block
        h = _page_print(f.read_text(encoding="utf-8"))
        rec = store.get(path) or {}
        d = rec.get("d") if rec.get("h") == h else stamp
        if d == stamp and rec.get("d") != stamp:
            changed += 1
        new_store[path] = {"h": h, "d": d}
        return re.sub(r"<lastmod>[^<]*</lastmod>", f"<lastmod>{d}</lastmod>", block, count=1)

    text = re.sub(r"<url>\s*<loc>([^<]+)</loc>.*?</url>", rep, text, flags=re.S)
    sm.write_text(text, encoding="utf-8")
    LASTMOD_F.parent.mkdir(parents=True, exist_ok=True)
    LASTMOD_F.write_text(json.dumps(dict(sorted(new_store.items())), ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"[guide] sitemap lastmod: 오늘 바뀐 쪽 {changed}개 / 가이드 {len(new_store)}쪽")


# 열쇠 찾기 손보정(11-05 점검, 위키 원문 확인): add=[맵, 입장 여부] 더하기 · none=여는 곳 없음 · hist=위키 '게임에 없음'
KEYFINDER_FIX = {
    "67e183377c6c2011970f3149": {"add": [["the-labyrinth", 0]]},   # Ariadne symbol key — 미궁 아리아드네 탈출구
    "67ab3d4b83869afd170fdd3f": {"add": [["the-labyrinth", 0]]},   # BBQ-S43 gas torch — item_key_labyrinth
    "678fa929819ddc4c350c0317": {"add": [["the-labyrinth", 0]]},   # Valve handwheel — item_key_labyrinth
    "5c1d0f4986f7744bb01837fa": {"add": [["streets-of-tarkov", 0]]},  # TerraGroup Labs keycard (Black) — 시내 Cardinal 아파트 금고 패널
    "679b9819a2f2dd4da9023512": {"add": [["shoreline", 1]]},       # Labrys access keycard — 해안선 요양원 서관 지하에서 미궁 입장
    "67c04dac9320f644db06f45c": {"add": [["shoreline", 1]]},       # 터미널 입장 RFID 카드 3종 — 해안선 항만 인터콤
    "67c033fd0610e91bea056998": {"add": [["shoreline", 1]]},
    "67c04a6f9152fbdfa306cc66": {"add": [["shoreline", 1]]},
    "5913651986f774432f15d132": {"none": True},                   # VAZ car key — 위키 "does currently not open any lock"
    "6a33c17933cff6b88c08902e": {"hist": True},                   # Admin's key — 위키 Historical·Event content
    "6391fcf5744e45201147080f": {"hist": True},                   # Primorsky Ave apartment key
    "593858c486f774253a24cb52": {"hist": True},                   # Pumping station back door key
    "57a349b2245977762b199ec7": {"hist": True},                   # Pumping station front door key
}


def keyfinder_data(items_reg, maps, key_maps, key_tasks, qlist, tasks, item_info, loc, loc_maps, loc_short) -> dict:
    """'내 열쇠들 어느 맵에?'(/guide/keyfinder/) 데이터 — 열쇠 전부(지도 자물쇠에 없는 것 포함) + 세 언어 짧은 이름.

    스크린샷의 칸 위 글자(게임이 칸 폭에 맞춰 자른 짧은 이름)를 읽어 이 표의 짧은 이름 앞부분과 맞춘다.
    게임 언어와 사이트 언어가 다를 수 있어 짧은 이름은 ko·en·ru 를 모두 넣는다.
    사용처 = 열쇠 페이지와 같은 지도 자물쇠(KEY_SKIP 적용 뒤) + 맵 입장 키 + 위키 보충표(scripts/wiki_keys.py 결과)."""
    wiki_f = ROOT / "scripts" / "guide_data" / "key_wiki_uses.json"
    wiki = json.loads(wiki_f.read_text(encoding="utf-8")) if wiki_f.exists() else {}
    names = {}
    for m in maps.values():
        nn = m.get("normalizedName")
        if nn and nn not in MAP_SKIP:
            names.setdefault(nn, loc(loc_maps, m.get("name"), nn))
    order = [x for x in MAP_ORDER if x in names] + sorted(x for x in names if x not in MAP_ORDER)
    q_by_en = {}
    for q in qlist:
        q_by_en.setdefault(q["en"], q["n"])
    uses: dict[str, list] = {}
    for mp in key_maps:
        for a in mp["access"]:
            uses.setdefault(a, []).append([mp["id"], [], 1, 0])
        for k in mp["keys"]:
            uses.setdefault(k["id"], []).append([mp["id"], k["q"], 0, 0])
    keys = []
    for iid, it in items_reg.items():
        if "keys" not in (it.get("types") or []):
            continue
        info = item_info(iid)
        if not info:
            continue
        short = list(dict.fromkeys(s for s in (loc(loc_short[l], it.get("shortName"), "") for l in ("ko", "en", "ru")) if s))
        if not short:
            continue
        nm = info["n"]
        if info["en"] and nm.endswith(f'({info["en"]})'):  # 한국어판 이름의 '(영어)' 꼬리 — 영어는 아랫줄에 따로 보여 준다
            nm = nm[: -len(info["en"]) - 2].strip() or nm
        row = {"i": iid, "s": short, "n": nm, "e": info["en"], "img": info["img"], "w": info.get("wiki")}
        u = uses.get(iid)
        wk = wiki.get(iid)
        if not u and wk and wk.get("maps"):
            wq = [q_by_en.get(x, x) for x in wk.get("q") or []]
            u = [[m, wq, 0, 1] for m in wk["maps"] if m in names]
        fx = KEYFINDER_FIX.get(iid) or {}
        for m, acc in fx.get("add", []):
            if m in names and not any(x[0] == m for x in (u or [])):
                u = (u or []) + [[m, [], acc, 1]]
        if fx.get("hist"):
            row["h"] = 1
        if fx.get("none") and not u:
            wk = {**(wk or {}), "none": True}
        if u:
            row["u"] = u
        elif wk and wk.get("none"):
            row["x"] = 1  # 여는 곳 없음(퀘스트 납품·수집용)
            if wk.get("q"):
                row["wq"] = [q_by_en.get(x, x) for x in wk["q"]]
        keys.append(row)
    keys.sort(key=lambda r: r["e"] or "")
    print(f"[guide] keyfinder: 열쇠 {len(keys)} · 맵 있음 {sum(1 for r in keys if r.get('u'))} · 여는 곳 없음 {sum(1 for r in keys if r.get('x'))}")
    return {"maps": [{"id": x, "n": names[x]} for x in order], "keys": keys}


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
            "img": guide_static.icon_url(it.get("iconLink"), it.get("gridImageLink")),  # 64px 아이콘 — 표시 최대 56px라 큰 그리드 그림은 낭비(11-04, 페이지당 3~4MB)
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
        # 펜스 평판(스캐브 카르마) 조건 — 11-04 점검 전엔 빠져 있었다(수집가 = 카르마 3 이상)
        "rep": [[trader_name(r.get("trader")), {">=": "≥", "<=": "≤"}.get(r.get("compareMethod"), r.get("compareMethod")), r.get("value")]
                for r in col.get("traderRequirements") or []
                if r.get("requirementType") == "reputation"],
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
            if (nn, k) in KEY_SKIP:  # 데이터 잔재(공장 비상구 열쇠가 다른 맵 금고를 연다는 등) — 2026-11-02 위키 대조
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
        loc_maps_en=get("regular/maps_en") or {},
    )
    for q in qlist:  # 같은 이름 퀘스트 구분 (BEAR/USEC·PVP/PVE·레벨별 판)
        suf = ctx.display_suffix.get(q["id"])
        if suf:
            q["n"] = f'{q["n"]} ({suf})'
        # 상인 키·받는 LL(묶음 LL 포함) — 퀘스트 목록의 '내 상인 등급'·'지금 받을 수 있는 것만'(11-04)
        q["ts"] = ctx.trader_slug(tasks[q["id"]].get("trader"))
        q["ll"] = ctx.trader_ll(tasks[q["id"]])
    # ll.json — 오버레이 연동 때 sync.js 가 깬·진행 중 퀘스트로 상인별 최소 LL을 추정하는 표(언어판마다 상인 이름 포함)
    ll_doc = {"t": {}, "q": {}}
    for tid, t in tasks.items():
        ts = ctx.trader_slug(t.get("trader"))
        ll_doc["q"][tid] = [ts, ctx.trader_ll(t)]
        ll_doc["t"].setdefault(ts, ctx.trader_name(t.get("trader")))
    (out_dir / "ll.json").parent.mkdir(parents=True, exist_ok=True)
    (out_dir / "ll.json").write_text(json.dumps(ll_doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pages = {
        "kappa": {"items": kappa, "req": col_req},
        "keys": {"maps": key_maps,
                 "items": items_for({k["id"] for mp in key_maps for k in mp["keys"]} |
                                    {a for mp in key_maps for a in mp["access"]})},
        "quests": {"quests": qlist,
                   "items": items_for({i for q in qlist for g in q["give"] for i in g["i"]} |
                                      {k for q in qlist for k in q["keys"]})},
    }
    pages["keyfinder"] = keyfinder_data(items_reg, maps, key_maps, key_tasks, qlist, tasks, item_info, loc, loc_maps,
                                        {l: (loc_items if l == lang else get(f"regular/items_{l}") or {}) for l in ("ko", "en", "ru")})
    for name, data in pages.items():
        tpl = (ROOT / "scripts" / "guide_templates" / f"{name}.html").read_text(encoding="utf-8")
        tpl = tpl.replace("/*GDONE*/", guide_static.DONE_FN)
        tpl = tpl.replace("<!--STALE-->", guide_static.stale_html("__STAMP__"))  # 시세 신선도 경고(번역 전에 넣어야 en/ru 도 번역됨)
        if 'property="og:image"' not in tpl:  # 공유 미리보기 태그(page() 와 같게, 11-04 점검: 템플릿 3쪽만 없었다)
            _t = re.search(r"<title>(.*?)</title>", tpl, re.S)
            _d = re.search(r'<meta name="description" content="([^"]*)"', tpl)
            _og = "".join(x + "\n" for x in (
                '<meta property="og:type" content="website" />',
                '<meta property="og:site_name" content="탈콥 가이드 · 타르코프 시세 오버레이" />',
                f'<meta property="og:title" content="{_t.group(1) if _t else ""}" />',
                f'<meta property="og:description" content="{_d.group(1) if _d else ""}" />',
                f'<meta property="og:url" content="https://tarkov.aquapado.com/guide/{name}/" />',
                f'<meta property="og:image" content="https://tarkov.aquapado.com/{guide_static.OG_IMAGE.get(lang, "og.png")}" />',
                '<meta property="og:locale" content="ko_KR" />'))
            tpl = tpl.replace('<meta name="theme-color"', _og + '<meta name="theme-color"', 1)
        if 'class="gsearch"' not in tpl:  # 검색창 자리 예약(page() 와 같게)
            tpl = tpl.replace('<a class="brand" href="/guide/">탈콥 가이드</a>', '<a class="brand" href="/guide/">탈콥 가이드</a>' + guide_static.GSEARCH_SLOT, 1)
        tpl = re.sub(r"<nav>.*?</nav>", lambda _m: guide_static.nav_html(name), tpl, count=1, flags=re.S)  # 언어 전환은 localize_template 이 붙인다
        if 'src="/guide/sync.js"' not in tpl:  # 오버레이 연동 스크립트 — page() 로 만드는 페이지와 같게
            tpl = tpl.replace("</body>", '<script src="/guide/sync.js" defer></script>\n</body>', 1)
        if 'src="/guide/search.js"' not in tpl:  # 전체 검색창 — page() 로 만드는 페이지와 같게
            tpl = tpl.replace("</body>", '<script src="/guide/search.js" defer></script>\n</body>', 1)
        if 'href="/privacy/"' not in tpl:  # 개인정보처리방침 링크 — 광고 심사 요건, page() 푸터와 같게
            tpl = tpl.replace("</div></footer>", ' · <a href="/privacy/">개인정보처리방침</a></div></footer>', 1)
        if 'href="/about/"' not in tpl:  # 사이트 소개·운영자 링크 — 광고 심사 요건(운영 주체·연락처), 방침 링크 앞에
            tpl = tpl.replace(' · <a href="/privacy/">', ' · <a href="/about/">소개</a> · <a href="/privacy/">', 1)
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        # 번역은 자리표시자를 채우기 전에(추출 때와 같은 구간이어야 표에 맞는다)
        page = (guide_static.localize_template(tpl, f"/guide/{name}/").replace("__DATA__", payload).replace("__STAMP__", stamp)
                .replace("__DONATE__", guide_static.donate_url()))  # 11-04 푸터 후원 링크(ko 카카오페이 / en·ru PayPal)
        page = page.replace("__NKEYS__", str(len(data.get("keys") or [])))  # 열쇠 찾기 페이지의 인식 가능 열쇠 수
        dest = out_dir / name / "index.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(page, encoding="utf-8")
        print(f"[guide] {name}: {len(page) / 1024:.0f} KB")
    # ── 정적 페이지(퀘스트 상세·상인별·아이템·은신처·초반·프레스티지·맵·보스·가이드 홈) ──
    collector_ids = {k["id"] for k in kappa}
    guide_urls = ["/guide/kappa/", "/guide/keys/", "/guide/quests/", "/guide/keyfinder/"]
    guide_urls += guide_static.build_all(ctx, out_dir, collector_ids, {
        "kappa": len(kappa), "keys": len(pages["keys"]["items"]), "keyfinder": len(pages["keyfinder"]["keys"])})
    print(f"[guide] 정적 페이지 {len(guide_urls) - 4}개 ({lang})")
    if lang == "ko":
        write_sitemap(guide_urls, stamp)
        # 11-04 오버레이 카드의 '가이드에서 보기' 버튼용 — 어느 아이템이 어느 목록 페이지에 행으로 있는지.
        # 필요 아이템 페이지는 '그 아이템 하나만 내는 목표'만 모으므로(택일 목표 제외) 퀘스트에 쓰인다고 다 있지 않다.
        # 오버레이 사이드카(guide_index.py)가 하루 1회 받아 간다. 행 id 는 세 언어판이 같아 ko 빌드 때 한 번만 쓴다.
        items_html = (out_dir / "items" / "index.html").read_text(encoding="utf-8")
        page_items = sorted(set(re.findall(r'<tr data-id="([0-9a-f]{24})"', items_html)))
        page_keys = sorted({k["id"] for mp in key_maps for k in mp["keys"]})
        (out_dir / "item-pages.json").write_text(
            json.dumps({"updated": stamp, "items": page_items, "keys": page_keys}, ensure_ascii=False),
            encoding="utf-8")
        print(f"[guide] item-pages.json: 필요 아이템 {len(page_items)} · 열쇠 {len(page_keys)}")
    import guide_search  # 전체 검색 색인(search.json)·검색창(search.js) — 만들어진 페이지를 훑어서
    print(f"[guide] 검색 색인: {guide_search.apply(out_dir, lang, pages['keys']['items'])}개")
    css = (ROOT / "scripts" / "guide_templates" / "guide.css").read_text(encoding="utf-8")
    (OUT / "guide.css").write_text(css, encoding="utf-8")
    (OUT / "noicon.svg").write_text((ROOT / "scripts" / "guide_templates" / "noicon.svg").read_text(encoding="utf-8"), encoding="utf-8")
    import adsense  # 새로 만든 페이지에도 AdSense 코드 유지(ID 없으면 아무것도 안 넣음)
    n_ad, cid = adsense.apply()
    print(f"[guide] AdSense: {cid or '끔'} · 바뀐 페이지 {n_ad}")
    import ga4  # GA4도 같은 방식(ID 없으면 아무것도 안 넣음)
    n_ga, gid = ga4.apply()
    print(f"[guide] GA4: {gid or '끔'} · 바뀐 페이지 {n_ga}")
    import hosting  # 호스팅별 조각(cloudflare 면 Vercel 분석 스크립트 제거) — scripts/hosting.txt
    n_ho, host = hosting.apply()
    print(f"[guide] 호스팅: {host} · 바뀐 페이지 {n_ho}")
    if lang != "ko":
        # 번역 누락 검사: 생성된 페이지에 한글이 남아 있으면 번역표에 없는 구간이다
        han = re.compile(r"[가-힣]")
        left = 0
        sample: list[str] = []
        for f in out_dir.rglob("index.html"):
            txt = f.read_text(encoding="utf-8")
            if f.parent.name == "keyfinder":  # 열쇠 찾기 데이터의 한글 짧은 이름은 한국어 게임 화면 인식용(일부러 넣은 것)
                txt = re.sub(r'<script id="data" type="application/json">.*?</script>', "", txt, flags=re.S)
            n = len(han.findall(re.sub(r'<details class="lang">.*?</details>', "", txt, flags=re.S)))  # 언어 메뉴의 "한국어"는 일부러 남긴 것
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
    refresh_lastmod(stamp)
    print(f"[guide] 완료 {time.time() - t0:.1f}s → {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
