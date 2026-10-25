"""탈콥 가이드 정적 페이지 생성기 — 퀘스트 상세·상인별 순서·필요 아이템·퀘스트 전용 아이템·
은신처·초반 가이드·프레스티지·맵·보스.

build_guide.py가 json.tarkov.dev 데이터를 받아 Ctx를 만든 뒤 build_all()을 부른다.
본문은 전부 서버에서 HTML로 만들어 둔다 — 검색엔진(특히 네이버)이 자바스크립트를 안 돌려도
읽을 수 있게. 자바스크립트는 체크 표시·필터·PVP/PVE 전환 같은 상호작용에만 쓴다.

데이터 해석 주의(2026-10, 게임 1.2.x 기준):
- 1.1.0부터 사이드 퀘스트는 대부분 '상인 LL별 2~4개 묶음'으로 열린다. 데이터에선
  otherRequirements의 globalVariable(상인별 카운터 ≥ N)로 나타난다. 어떤 퀘스트가 카운터를
  올리는지는 데이터에 없으니 "같은 상인 묶음 퀘스트 N개 완료 후"까지만 말한다.
- 스토리 챕터(투어 등)는 데이터에 없다 → 초반 가이드의 투어 표는 공식 위키를 보고 직접 썼다.
"""
from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

SITE = "https://tarkov.aquapado.com"
MONEY = {"5449016a4bdc2d6f028b456f": "₽", "5696686a4bdc2da3298b456a": "$", "569668774bdc2da2298b4568": "€"}
# 같은 지도의 변형 — 대표 지도 페이지에 메모로만 합친다(열쇠 페이지와 같은 규칙).
MAP_VARIANTS = {"night-factory": "factory", "ground-zero-21": "ground-zero",
                "ground-zero-tutorial": "ground-zero", "the-lab-dark": "the-lab"}
MAP_ORDER = ["ground-zero", "streets-of-tarkov", "interchange", "customs", "factory", "woods",
             "shoreline", "reserve", "lighthouse", "the-lab", "icebreaker", "terminal", "the-labyrinth"]
TRADER_ORDER = ["prapor", "therapist", "skier", "peacekeeper", "mechanic", "ragman", "jaeger",
                "fence", "ref", "lightkeeper", "btr-driver", "taran", "voevoda", "mr-kerman",
                "radio-station", "survivor"]
ZONE_RE = re.compile(r"\s*\[(?:PVP|PVE) ZONE\]\s*$")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

TARGETS = {"Any": "아무 대상", "Savage": "스캐브", "AnyPmc": "PMC", "Usec": "USEC 요원", "Bear": "BEAR 요원",
           "pmcBot": "레이더", "exUsec": "로그", "marksman": "저격 스캐브"}
BODY = {"Head": "머리", "Chest": "흉부", "Stomach": "복부", "LeftArm": "왼팔", "RightArm": "오른팔",
        "LeftLeg": "왼다리", "RightLeg": "오른다리"}
BUILD_ATTR = {"accuracy": "정확도(MOA)", "durability": "내구도", "effectiveDistance": "유효 사거리",
              "ergonomics": "인체공학", "height": "세로 칸", "width": "가로 칸", "magazineCapacity": "탄창 용량",
              "muzzleVelocity": "총구 속도", "recoil": "반동 합계", "weight": "무게(kg)"}
STATUS = {"complete": "완료", "active": "진행 중", "failed": "실패", "started": "시작"}
MOB_KO = {"Kaban Guard": "카반 경호원", "Kaban": "카반", "Knight": "나이트", "Kollontay": "콜론타이", "Partisan": "파르티잔", "Big Pipe": "빅 파이프",
          "Birdeye": "버드아이", "Shadow of Tagilla": "타길라의 그림자", "Vengeful Killa": "분노한 킬라", "Scourge": "스커지",
          "The Wedge": "웨지", "Basmach": "바스마치", "Gus": "구스", "Reshala Guard": "르샬라 경호원",
          "Shturman Guard": "슈트르만 경호원", "Sanitar Guard": "세니타 경호원"}
HAZARD = {"minefield": "지뢰밭", "sniper": "저격 구역", "hazard": "위험 지역"}

NAV = [("start", "/guide/start/", "초반 가이드"), ("quests", "/guide/quests/", "퀘스트"),
       ("items", "/guide/items/", "필요 아이템"), ("hideout", "/guide/hideout/", "은신처"),
       ("maps", "/guide/maps/", "맵"), ("bosses", "/guide/bosses/", "보스"),
       ("kappa", "/guide/kappa/", "카파템"), ("keys", "/guide/keys/", "열쇠"),
       ("prestige", "/guide/prestige/", "프레스티지"), ("overlay", "/", "시세 오버레이")]


def e(s) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def fmt_int(n) -> str:
    try:
        n = float(n)
    except (TypeError, ValueError):
        return e(n)
    return f"{int(round(n)):,}" if abs(n - round(n)) < 1e-9 else f"{n:,.2f}".rstrip("0").rstrip(".")


def fmt_dur(sec) -> str:
    sec = int(sec or 0)
    if sec <= 0:
        return "즉시"
    d, rem = divmod(sec, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    out = []
    if d:
        out.append(f"{d}일")
    if h:
        out.append(f"{h}시간")
    if m and not d:
        out.append(f"{m}분")
    return " ".join(out) or f"{sec}초"


@dataclass
class Ctx:
    stamp: str
    items: dict                 # regular items (id → raw)
    items_pve: dict
    loc_items: dict
    loc_items_en: dict
    tasks_reg: dict
    tasks_pve: dict
    loc_tasks: dict
    loc_tasks_en: dict
    quest_items: dict
    achievements: dict
    prestige_reg: list
    prestige_pve: list
    maps: dict
    loc_maps: dict
    mobs: dict
    traders: dict
    loc_traders: dict
    hideout_reg: dict
    hideout_pve: dict
    loc_hideout: dict
    crafts_reg: list
    crafts_pve: list
    tasks: dict = field(default_factory=dict)
    task_modes: dict = field(default_factory=dict)
    _item_cache: dict = field(default_factory=dict)

    def __post_init__(self):
        self.tasks = {**self.tasks_pve, **self.tasks_reg}
        self.task_modes = {tid: [m for m, src in (("pvp", self.tasks_reg), ("pve", self.tasks_pve)) if tid in src]
                           for tid in self.tasks}
        self.trader_by_slug = {t.get("normalizedName"): tid for tid, t in self.traders.items()}
        self.map_by_slug = {m.get("normalizedName"): mid for mid, m in self.maps.items()}
        self.station_by_id = self.hideout_reg
        # 역색인: 다음 퀘스트(이 퀘스트를 선행으로 삼는 것들)
        self.next_of: dict[str, list[str]] = {}
        for tid, t in self.tasks.items():
            for r in t.get("taskRequirements") or []:
                if r.get("task") in self.tasks:
                    self.next_of.setdefault(r["task"], []).append(tid)
        self._depth: dict[str, int] = {}
        # 같은 이름 퀘스트 구분('[PVP ZONE]' 판·BEAR/USEC 판·레벨별 판·'-2' 판) — 제목이 겹치지 않게
        groups: dict[str, list] = {}
        for tid in self.tasks:
            groups.setdefault(self.task_names(tid)[0], []).append(tid)
        self.display_suffix: dict[str, str] = {}
        for name, ids in groups.items():
            if len(ids) < 2:
                continue
            def key_of(tid):
                t = self.tasks[tid]
                parts = []
                facs = {self.tasks[x].get("factionName") for x in ids}
                if len(facs) > 1 and t.get("factionName") in ("BEAR", "USEC"):
                    parts.append(t["factionName"])
                mset = {tuple(self.task_modes.get(x, [])) for x in ids}
                if len(mset) > 1 and len(self.task_modes.get(tid, [])) == 1:
                    parts.append(self.task_modes[tid][0].upper())
                lvs = {self.tasks[x].get("minPlayerLevel") or 0 for x in ids}
                if len(lvs) > 1:
                    parts.append(f"레벨 {t.get('minPlayerLevel') or 0}")
                return " · ".join(parts)
            keys = {tid: key_of(tid) for tid in ids}
            counts: dict[str, int] = {}
            for tid in sorted(ids, key=lambda x: self.tasks[x].get("normalizedName") or x):
                k = keys[tid]
                counts[k] = counts.get(k, 0) + 1
                if list(keys.values()).count(k) > 1:  # 그래도 같으면 번호
                    k = (k + " · " if k else "") + f"{counts[k]}번째"
                self.display_suffix[tid] = k

    # ── 이름 ────────────────────────────────────────────────
    @staticmethod
    def _loc(table, key, fallback=None):
        if key is None:
            return fallback
        v = table.get(key)
        if isinstance(v, str):
            # 원본 번역에 제어 문자가 섞인 경우가 있다(예: 'CPU \x08fan 쿨러')
            v = CTRL_RE.sub("", v).strip()
        return v if isinstance(v, str) and v else fallback

    def tk(self, key, fallback=None):
        return self._loc(self.loc_tasks, key, None) or self._loc(self.loc_tasks_en, key, fallback)

    def task_names(self, tid):
        t = self.tasks.get(tid) or {}
        en = self._loc(self.loc_tasks_en, t.get("name"), t.get("normalizedName")) or ""
        ko = self._loc(self.loc_tasks, t.get("name"), en) or en
        return ZONE_RE.sub("", ko), ZONE_RE.sub("", en)

    def task_slug(self, tid):
        return (self.tasks.get(tid) or {}).get("normalizedName") or tid

    def task_url(self, tid):
        return f"/guide/quest/{self.task_slug(tid)}/"

    def task_link(self, tid, cls=""):
        if tid not in self.tasks:
            return e(tid)
        ko, _ = self.task_names(tid)
        suf = getattr(self, "display_suffix", {}).get(tid)
        label = f"{ko} ({suf})" if suf else ko
        return f'<a class="{cls}" href="{self.task_url(tid)}">{e(label)}</a>'

    def trader(self, tid):
        return self.traders.get(tid) or {}

    def trader_name(self, tid):
        tr = self.trader(tid)
        return self._loc(self.loc_traders, tr.get("name"), tr.get("normalizedName") or "?")

    def trader_slug(self, tid):
        return self.trader(tid).get("normalizedName") or tid

    def map_name(self, mid):
        m = self.maps.get(mid)
        if not m:
            return None
        return self._loc(self.loc_maps, m.get("name"), m.get("normalizedName"))

    def map_link(self, mid):
        m = self.maps.get(mid)
        if not m:
            return ""
        slug = MAP_VARIANTS.get(m.get("normalizedName"), m.get("normalizedName"))
        return f'<a href="/guide/maps/{e(slug)}/">{e(self.map_name(mid))}</a>'

    def map_links(self, mids) -> str:
        """지도 링크 목록 — 변형(21+·야간·튜토리얼)은 대표 지도로 합쳐 한 번만"""
        out = []
        for mid in mids or []:
            slug = (self.maps.get(mid) or {}).get("normalizedName")
            if not slug or slug == "ground-zero-tutorial":
                continue
            lk = self.map_link(self.map_by_slug.get(MAP_VARIANTS.get(slug, slug), mid))
            if lk and lk not in out:
                out.append(lk)
        return ", ".join(out)

    def station_name(self, sid):
        st = self.hideout_reg.get(sid) or self.hideout_pve.get(sid) or {}
        return self._loc(self.loc_hideout, st.get("name"), st.get("normalizedName") or "?")

    def station_link(self, sid, lv=None):
        st = self.hideout_reg.get(sid) or self.hideout_pve.get(sid) or {}
        label = e(self.station_name(sid)) + (f" {lv}단계" if lv else "")
        return f'<a href="/guide/hideout/{e(st.get("normalizedName"))}/#lv{lv or 1}">{label}</a>'

    def skill_name(self, sid):
        for table in (self.loc_hideout, self.loc_tasks, self.loc_items):
            v = self._loc(table, sid)
            if v:
                return v
        return sid

    def mob_name(self, mob):
        n = self._loc(self.loc_maps, mob) or self._loc(self.loc_tasks, mob) or TARGETS.get(mob) or mob
        # 한국어판도 영어로 두는 보스 이름 — 검색은 한글로 하니 음역을 앞에 붙인다
        for en, ko in MOB_KO.items():
            if n == en or n.startswith(en + " "):
                return ko + "(" + n + ")"
        return n

    # ── 아이템 ──────────────────────────────────────────────
    def item(self, iid):
        if iid in self._item_cache:
            return self._item_cache[iid]
        it = self.items.get(iid) or self.items_pve.get(iid)
        info = None
        if isinstance(it, dict):
            pv = self.items_pve.get(iid) or {}
            en = self._loc(self.loc_items_en, it.get("name"), it.get("name"))
            info = {
                "id": iid,
                "n": self._loc(self.loc_items, it.get("name"), en),
                "en": en,
                "s": self._loc(self.loc_items, it.get("shortName"), self._loc(self.loc_items_en, it.get("shortName"), "")),
                "img": it.get("gridImageLink") or it.get("iconLink"),
                "pvp": it.get("avg24hPrice"),
                "pve": pv.get("avg24hPrice"),
                "wiki": it.get("wikiLink"),
                "noflea": "noFlea" in (it.get("types") or []),
            }
        else:
            qi = self.quest_items.get(iid)
            if qi:
                info = {"id": iid, "n": self.tk(f"{iid} Name", iid), "en": self._loc(self.loc_tasks_en, f"{iid} Name", ""),
                        "s": self.tk(f"{iid} ShortName", ""), "img": qi.get("gridImageLink") or qi.get("iconLink"),
                        "quest": True, "desc": self.tk(f"{iid} Description", "")}
        self._item_cache[iid] = info
        return info

    def money(self, iid, count):
        sym = MONEY.get(iid)
        if not sym:
            return None
        return f"{sym}{fmt_int(count)}" if sym != "₽" else f"{fmt_int(count)}₽"

    def chip(self, iid, count=None, fir=False, extra=""):
        m = self.money(iid, count) if count is not None else None
        if m:
            return f'<span class="chip money"><b>{e(m)}</b></span>'
        it = self.item(iid)
        if not it:
            return f'<span class="chip">{e(iid)}</span>'
        img = f'<img loading="lazy" alt="" src="{e(it["img"])}" width="24" height="24" />' if it.get("img") else ""
        cnt = f' <span class="cnt">×{fmt_int(count)}</span>' if count not in (None, 1, 1.0) else ""
        firb = ' <span class="badge b-fir">인레이드</span>' if fir else ""
        title = it["n"] + (f" ({it['en']})" if it.get("en") and it["en"] != it["n"] else "")
        return f'<span class="chip{" fir" if fir else ""}" title="{e(title)}">{img}{e(it["n"])}{cnt}{firb}{extra}</span>'

    def chips_alt(self, ids, count=None, fir=False, limit=6):
        """대체 가능한 아이템 목록(아무거나 하나) — 많으면 접어 둔다."""
        ids = [i for i in dict.fromkeys(ids or []) if i]
        if not ids:
            return ""
        if len(ids) == 1:
            return self.chip(ids[0], count, fir)
        head = "".join(self.chip(i) for i in ids[:limit])
        tail = ""
        if len(ids) > limit:
            tail = (f'<details class="more"><summary>외 {len(ids) - limit}종 더 보기</summary>'
                    + "".join(self.chip(i) for i in ids[limit:]) + "</details>")
        lead = (f'<span class="muted small">아래 중 아무거나'
                + (f' <b class="cnt">×{fmt_int(count)}</b>' if count not in (None, 1) else "")
                + (' <span class="badge b-fir">인레이드</span>' if fir else "") + "</span>")
        return f'<div class="alt">{lead}<div class="chips">{head}</div>{tail}</div>'

    # ── 퀘스트 해석 ────────────────────────────────────────
    def depth(self, tid, _seen=None):
        """선행 퀘스트 사슬의 깊이 — 상인별 목록에서 '먼저 하는 순서'로 정렬하는 데 쓴다."""
        if tid in self._depth:
            return self._depth[tid]
        _seen = _seen or set()
        if tid in _seen:
            return 0
        _seen.add(tid)
        reqs = [r["task"] for r in (self.tasks.get(tid) or {}).get("taskRequirements") or [] if r.get("task") in self.tasks]
        d = 1 + max((self.depth(r, _seen) for r in reqs), default=-1)
        self._depth[tid] = d
        return d

    def early_tasks(self, traders: list[str], max_batch: int = 1) -> list[str]:
        """초반(대략 10레벨까지)에 실제로 받게 되는 퀘스트.

        1.1.0 이후엔 레벨·LL 조건이 없는 퀘스트가 많아서 'LL1·레벨 10 이하'만으로는 후반 퀘스트가
        섞인다(실측: 247개 중 피스키퍼 '특수 장비'=COFDM·Virtex, 묶음 3). 그래서 묶음 단계가 낮고,
        선행 퀘스트도 전부 초반이며, 다른 퀘스트와 택일(실패 조건)로 묶이지 않은 것만 고른다.
        """
        memo: dict[str, bool] = {}

        def ok(tid, stack=()):
            if tid in memo:
                return memo[tid]
            t = self.tasks[tid]
            r = (self.trader_slug(t.get("trader")) in traders and (t.get("minPlayerLevel") or 0) <= 10
                 and self.trader_ll(t) <= 1 and self.batch_req(t) <= max_batch
                 and not any(fc.get("type") == "taskStatus" for fc in t.get("failConditions") or []))
            if r:
                for q in t.get("taskRequirements") or []:
                    p = q.get("task")
                    if p in self.tasks and p not in stack and not ok(p, stack + (tid,)):
                        r = False
                        break
            memo[tid] = r
            return r

        return [x for x in self.tasks if ok(x)]

    def trader_ll(self, t):
        return max((r.get("value") or 0 for r in t.get("traderRequirements") or []
                    if r.get("requirementType") == "level"), default=1) or 1

    def batch_req(self, t):
        return max((o.get("value") or 0 for o in t.get("otherRequirements") or [] if o.get("type") == "globalVariable"), default=0)

    def tier(self, t):
        """상인별 목록의 묶음 표시: (정렬 키, 라벨)"""
        ll = self.trader_ll(t)
        b = self.batch_req(t)
        chain = bool(t.get("taskRequirements"))
        label = f"LL{ll}"
        if b:
            label += f" · 묶음 {b}"
        if chain:
            label += " · 연쇄"
        return (ll, b, self.depth(t["id"]) if chain else 0), label

    def task_maps(self, t):
        """퀘스트에 관련된 지도 id(대표 지도 우선, 목표 지도 합침, 변형 제외)"""
        out = []
        mp = t.get("map")
        mid = mp.get("id") if isinstance(mp, dict) else mp
        if mid:
            out.append(mid)
        for o in t.get("objectives") or []:
            for m in o.get("maps") or []:
                mid2 = m.get("id") if isinstance(m, dict) else m
                if mid2:
                    out.append(mid2)
            for z in o.get("zones") or []:
                if z.get("map"):
                    out.append(z["map"])
            for loc in o.get("possibleLocations") or []:
                if loc.get("map"):
                    out.append(loc["map"])
        seen, res = set(), []
        for m in out:
            slug = (self.maps.get(m) or {}).get("normalizedName")
            if not slug:
                continue
            base = MAP_VARIANTS.get(slug, slug)
            if base in seen:
                continue
            seen.add(base)
            res.append(self.map_by_slug.get(base, m))
        return res

    def needed_items(self, t):
        """미리 챙길 것: 제출(giveItem) + 설치(plantItem) + 표시(mark 마커) 아이템을 묶는다."""
        agg: dict[tuple, dict] = {}
        groups = []
        for o in t.get("objectives") or []:
            ty = o.get("type")
            if ty in ("giveItem", "plantItem", "sellItem"):
                ids = [i for i in o.get("items") or [] if i]
                if not ids:
                    continue
                c = o.get("count") or 1
                if len(ids) == 1:
                    k = (ids[0], bool(o.get("foundInRaid")))
                    a = agg.setdefault(k, {"id": ids[0], "fir": k[1], "c": 0, "opt": True})
                    a["c"] += c
                    a["opt"] = a["opt"] and bool(o.get("optional"))
                else:
                    groups.append({"ids": ids, "c": c, "fir": bool(o.get("foundInRaid"))})
            elif ty == "mark" and o.get("markerItem"):
                mi = o["markerItem"].get("id") if isinstance(o["markerItem"], dict) else o["markerItem"]
                k = (mi, False)
                a = agg.setdefault(k, {"id": mi, "fir": False, "c": 0, "opt": False})
                a["c"] += o.get("count") or 1
        return list(agg.values()), groups


# ─────────────────────────────────────────────────────────────
# 레이아웃
# ─────────────────────────────────────────────────────────────

def page(ctx: Ctx, *, path: str, title: str, desc: str, body: str, nav: str = "", crumbs=None,
         og_type: str = "article", extra_head: str = "", scripts: str = "") -> str:
    url = SITE + path
    crumbs = crumbs or []
    on = ' class="on"'
    navhtml = "".join(f'<a{on if key == nav else ""} href="{href}">{label}</a>' for key, href, label in NAV)
    crumb_html = ""
    ld = []
    if crumbs:
        items = [("탈콥 가이드", "/guide/")] + crumbs
        crumb_html = '<nav class="crumbs" aria-label="경로">' + " › ".join(
            (f'<a href="{href}">{e(name)}</a>' if href and i < len(items) - 1 else f"<span>{e(name)}</span>")
            for i, (name, href) in enumerate(items)) + "</nav>"
        ld.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, **({"item": SITE + href} if href else {})}
            for i, (name, href) in enumerate(items)]})
    ld_html = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}" />
<link rel="canonical" href="{e(url)}" />
<meta property="og:type" content="{og_type}" />
<meta property="og:site_name" content="탈콥 가이드 · 타르코프 시세 오버레이" />
<meta property="og:title" content="{e(title)}" />
<meta property="og:description" content="{e(desc)}" />
<meta property="og:url" content="{e(url)}" />
<meta property="og:image" content="{SITE}/og.png" />
<meta property="og:locale" content="ko_KR" />
<meta name="theme-color" content="#c8aa64" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="stylesheet" href="/guide/guide.css" />
{ld_html}{extra_head}
</head>
<body>
<div class="top"><div class="wrap">
  <a class="brand" href="/guide/">탈콥 가이드</a>
  <nav>{navhtml}</nav>
</div></div>
<main class="wrap">
{crumb_html}
{body}
<div class="cta"><span>레이드 중 아이템에 마우스 올리고 <b>F2 한 번</b> — 시세·퀘스트·은신처에 필요한지 바로 확인</span><a class="btn" href="/?src=guide">무료 시세 오버레이 받기</a></div>
</main>
<footer><div class="wrap">게임 데이터: <a href="https://tarkov.dev" rel="noopener">tarkov.dev</a> 공개 데이터(기준 {e(ctx.stamp)}) · 설명 문구는 <a href="https://escapefromtarkov.fandom.com/" rel="noopener">공식 위키</a>와 패치 노트를 참고해 직접 정리 · 체크 표시는 이 브라우저에만 저장 · <a href="/guide/">가이드 홈</a> · <a href="/status/">서비스 상태</a> · <a href="/">타르코프 시세 오버레이</a></div></footer>
{scripts}
<script defer src="/_vercel/insights/script.js"></script>
<script src="/beacon.js"></script>
</body>
</html>
"""


def write(out: Path, path: str, html_text: str, urls: list):
    dest = out / path.strip("/").removeprefix("guide/") / "index.html" if path != "/guide/" else out / "index.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(html_text, encoding="utf-8")
    urls.append(path)


# ─────────────────────────────────────────────────────────────
# 퀘스트 상세
# ─────────────────────────────────────────────────────────────

OBJ_ICON = {"giveItem": "📦", "findItem": "🔎", "findQuestItem": "🔎", "giveQuestItem": "📨", "plantItem": "📍",
            "plantQuestItem": "📍", "mark": "📡", "visit": "🧭", "shoot": "🎯", "extract": "🚪", "buildWeapon": "🔧",
            "skill": "📈", "traderLevel": "🤝", "traderStanding": "🤝", "taskStatus": "🔗", "useItem": "💉",
            "sellItem": "💰", "experience": "⭐", "globalVariable": "⚠", "dialogue": "💬", "playerLevel": "⭐"}


def _cmp(c):
    return {">=": "≥", "<=": "≤", ">": ">", "<": "<", "==": "="}.get(c or ">=", c)


def _flat(ids):
    out = []
    for x in ids or []:
        if isinstance(x, list):
            out.extend(_flat(x))
        elif isinstance(x, dict):
            out.append(x.get("id") or x.get("item"))
        else:
            out.append(x)
    return [i for i in out if i]


def _join_tags(xs):
    return " ".join(x for x in xs if x)


def objective_html(ctx: Ctx, o: dict) -> str:
    ty = o.get("type")
    desc = ctx.tk(o.get("description"), None)
    if not desc or desc == o.get("description"):
        desc = {"giveItem": "아이템 제출", "findItem": "레이드에서 아이템 찾기", "shoot": "적 처치",
                "visit": "지역 방문", "extract": "탈출", "mark": "마커 설치", "plantItem": "아이템 숨기기"}.get(ty, ty)
    bits = []
    cnt = o.get("count")
    if ty in ("shoot", "extract", "experience") and cnt and cnt > 1:
        bits.append(f'<span class="badge b-cnt">×{fmt_int(cnt)}</span>')
    if o.get("optional"):
        bits.append('<span class="badge b-any">선택</span>')
    detail = []
    if ty in ("giveItem", "findItem", "plantItem", "sellItem"):
        detail.append(ctx.chips_alt(o.get("items"), cnt, bool(o.get("foundInRaid"))))
        if o.get("dogTagLevel"):
            detail.append(f'<div class="osub">인식표 레벨 {o["dogTagLevel"]} 이상</div>')
        if (o.get("minDurability") or 0) > 0 or (o.get("maxDurability") or 100) < 100:
            detail.append(f'<div class="osub">내구도 {o.get("minDurability", 0)}~{o.get("maxDurability", 100)}%</div>')
    elif ty in ("findQuestItem", "giveQuestItem", "plantQuestItem"):
        qi = o.get("questItem")
        qid = qi.get("id") if isinstance(qi, dict) else qi
        if qid:
            detail.append(f'<div class="chips">{ctx.chip(qid, cnt)}</div>')
    elif ty == "mark" and o.get("markerItem"):
        mi = o["markerItem"].get("id") if isinstance(o["markerItem"], dict) else o["markerItem"]
        detail.append(f'<div class="chips">{ctx.chip(mi)}</div>')
    elif ty == "shoot":
        tg = list(dict.fromkeys(TARGETS.get(n) or ctx.mob_name(n) for n in o.get("targetNames") or []))
        sub = []
        if tg and tg != ["아무 대상"]:
            sub.append("대상: " + ", ".join(e(x) for x in tg))
        if o.get("shotType") == "hit":
            sub.append("명중만 해도 인정")
        parts = [BODY.get(str(b).rsplit("/", 1)[-1], str(b).rsplit("/", 1)[-1]) for b in o.get("bodyParts") or []]
        if parts:
            sub.append("부위: " + ", ".join(e(p) for p in parts))
        dist = o.get("distance") or {}
        if (dist.get("value") or 0) > 0:
            sub.append(f'거리 {_cmp(dist.get("compareMethod"))} {fmt_int(dist["value"])}m')
        if o.get("timeFromHour") or o.get("timeUntilHour"):
            sub.append(f'게임 시간 {o.get("timeFromHour", 0)}시~{o.get("timeUntilHour", 0)}시')
        if sub:
            detail.append('<div class="osub">' + " · ".join(sub) + "</div>")
        for label, key in (("사용 무기", "usingWeapon"), ("필요 부착물", "usingWeaponMods"),
                           ("착용 필요", "wearing"), ("착용 금지", "notWearing")):
            ids = _flat(o.get(key))
            if ids:
                detail.append(f'<div class="sublabel">{label}</div>' + ctx.chips_alt(ids))
    elif ty == "extract":
        st = []
        for s in o.get("exitStatus") or []:
            s2 = str(s)
            st.append("생존" if "Survived" in s2 else "런스루" if "Runner" in s2 else "이동(트랜짓)" if "Transit" in s2 else s2)
        sub = []
        if st:
            sub.append("상태: " + " 또는 ".join(dict.fromkeys(st)))
        if o.get("exitName"):
            sub.append("탈출구: " + e(ctx._loc(ctx.loc_maps, o["exitName"], o["exitName"])))
        if sub:
            detail.append('<div class="osub">' + " · ".join(sub) + "</div>")
    elif ty == "buildWeapon":
        it = o.get("item")
        iid = it.get("id") if isinstance(it, dict) else it
        if iid:
            detail.append(f'<div class="chips">{ctx.chip(iid)}</div>')
        reqs = []
        for k, v in (o.get("buildAttributes") or {}).items():
            if isinstance(v, dict) and (v.get("value") or 0) > 0:
                reqs.append(f'{BUILD_ATTR.get(k, k)} {_cmp(v.get("compareMethod"))} {fmt_int(v["value"])}')
        if reqs:
            detail.append('<div class="osub">조건: ' + e(" · ".join(reqs)) + "</div>")
        need = _flat(o.get("containsAll"))
        if need:
            detail.append('<div class="sublabel">반드시 포함할 부품</div><div class="chips">' + "".join(ctx.chip(i) for i in need) + "</div>")
    elif ty == "skill":
        sk = o.get("skill")
        name = ctx.skill_name(sk.get("name") if isinstance(sk, dict) else sk)
        detail.append(f'<div class="osub">{e(name)} {o.get("level")}레벨</div>')
    elif ty == "traderLevel":
        detail.append(f'<div class="osub">{e(ctx.trader_name(o.get("trader")))} LL{o.get("level")}</div>')
    elif ty == "traderStanding":
        detail.append(f'<div class="osub">{e(ctx.trader_name(o.get("trader")))} 평판 {_cmp(o.get("compareMethod"))} {o.get("value")}</div>')
    elif ty == "taskStatus" and o.get("task") in ctx.tasks:
        st = " · ".join(STATUS.get(s, s) for s in o.get("status") or [])
        detail.append(f'<div class="osub">{ctx.task_link(o["task"])} {e(st)}</div>')
    elif ty == "useItem":
        detail.append(ctx.chips_alt(_flat(o.get("useAny")), cnt))
    keys = _flat(o.get("requiredKeys"))
    if keys:
        detail.append('<div class="sublabel">열쇠</div>' + ctx.chips_alt(keys))
    maps = []
    for m in o.get("maps") or []:
        mid = m.get("id") if isinstance(m, dict) else m
        if mid and mid not in maps:
            maps.append(mid)
    for z in o.get("zones") or []:
        if z.get("map") and z["map"] not in maps:
            maps.append(z["map"])
    for loc in o.get("possibleLocations") or []:
        if loc.get("map") and loc["map"] not in maps:
            maps.append(loc["map"])
    links = ctx.map_links(maps)  # 변형(21+·야간)은 대표 지도로 합쳐 한 번만
    if links:
        detail.append('<div class="osub">지도: ' + links + "</div>")
    icon = OBJ_ICON.get(ty, "•")
    return (f'<li class="obj"><span class="oi" aria-hidden="true">{icon}</span><div class="ob">'
            f'<div class="od">{e(desc)} {_join_tags(bits)}</div>{"".join(x for x in detail if x)}</div></li>')


def rewards_html(ctx: Ctx, t: dict, side: str = "finishRewards") -> str:
    rw = t.get(side) or {}
    rows = []
    if side == "finishRewards" and t.get("experience"):
        rows.append(("경험치", f'<b>+{fmt_int(t["experience"])}</b>'))
    st = rw.get("traderStanding") or []
    if st:
        parts = []
        for x in st:
            v = x.get("standing") or 0
            sign = "+" if v >= 0 else ""
            parts.append(f'{e(ctx.trader_name(x.get("trader")))} <b>{sign}{v}</b>')
        rows.append(("상인 평판", ", ".join(parts)))
    its = rw.get("items") or []
    if its:
        rows.append(("아이템", '<div class="chips">' + "".join(ctx.chip(x.get("item"), x.get("count")) for x in its) + "</div>"))
    ou = rw.get("offerUnlock") or []
    if ou:
        rows.append(("구매 해금", '<div class="chips">' + "".join(
            ctx.chip(x.get("item"), extra=f' <span class="muted small">{e(ctx.trader_name(x.get("trader")))} LL{x.get("level")}</span>')
            for x in ou) + "</div>"))
    cu = rw.get("craftUnlock") or []
    if cu:
        rows.append(("제작 해금", '<div class="chips">' + "".join(
            ctx.chip(x.get("item"), x.get("count"), extra=f' <span class="muted small">{e(ctx.station_name(x.get("station")))} {x.get("level")}단계</span>')
            for x in cu) + "</div>"))
    sk = rw.get("skillLevelReward") or []
    if sk:
        rows.append(("스킬", ", ".join(f'{e(ctx.skill_name(x.get("skill")))} +{x.get("level")}' for x in sk)))
    tu = rw.get("traderUnlock") or []
    if tu:
        rows.append(("상인 해금", ", ".join(
            f'<b>{e(ctx.trader_name(x.get("trader") if isinstance(x, dict) else x))}</b>' for x in tu)))
    ach = rw.get("achievement") or []
    if ach:
        names = []
        for a in ach:
            aid = a.get("id") if isinstance(a, dict) else a
            ad = ctx.achievements.get(aid) or {}
            names.append(e(ctx.tk(ad.get("name"), aid)))
        rows.append(("업적", ", ".join(names)))
    cz = rw.get("customization") or []
    if cz:
        rows.append(("꾸미기", f"{len(cz)}개 (은신처·제스처·인식표 등)"))
    if not rows:
        return ""
    return '<table class="kv">' + "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows) + "</table>"


def requirements_html(ctx: Ctx, t: dict) -> str:
    rows = []
    lv = t.get("minPlayerLevel") or 0
    rows.append(("레벨", f"{lv} 이상" if lv > 1 else "제한 없음"))
    tr_req = [r for r in t.get("traderRequirements") or [] if r.get("requirementType") == "level"]
    rows.append(("상인 등급", ", ".join(f'{e(ctx.trader_name(r.get("trader")))} LL{r.get("value")} 이상' for r in tr_req) or "LL1"))
    reqs = [r for r in t.get("taskRequirements") or [] if r.get("task") in ctx.tasks]
    if reqs:
        lines = []
        for r in reqs:
            st = " · ".join(STATUS.get(s, s) for s in r.get("status") or [])
            lines.append(f'{ctx.task_link(r["task"])} <span class="muted small">{e(st)}</span>')
        rows.append(("선행 퀘스트", "<br>".join(lines)))
    b = ctx.batch_req(t)
    if b:
        rows.append(("묶음 해금", f'{e(ctx.trader_name(t.get("trader")))}의 앞 묶음 퀘스트 <b>{b}개</b> 완료 후 '
                               f'<span class="muted small">(1.1.0 묶음 방식)</span>'))
    for o in t.get("otherRequirements") or []:
        if o.get("type") == "dialogue":
            rows.append(("대화", ", ".join(e(ctx.trader_name(x)) for x in o.get("traders") or []) + "와 대화"))
    if t.get("factionName") in ("BEAR", "USEC"):
        rows.append(("진영", f'<b>{e(t["factionName"])}</b> 전용'))
    if t.get("availableDelaySecondsMin"):
        lo, hi = t.get("availableDelaySecondsMin") or 0, t.get("availableDelaySecondsMax") or 0
        rows.append(("대기", f"앞 퀘스트 완료 후 {fmt_dur(lo)}" + (f"~{fmt_dur(hi)}" if hi and hi != lo else "") + " 뒤"))
    return '<table class="kv">' + "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows) + "</table>"


QUEST_JS = """<script>
(function(){var K="guide.quests",d={};try{d=JSON.parse(localStorage.getItem(K))||{}}catch(e){}
var el=document.querySelector(".quest");if(!el)return;var id=el.getAttribute("data-id"),c=document.getElementById("qdone");c.checked=!!d[id];
c.addEventListener("change",function(){if(c.checked)d[id]=1;else delete d[id];try{localStorage.setItem(K,JSON.stringify(d))}catch(e){}});})();
</script>"""


def _sig(x):
    return json.dumps([(o.get("type"), o.get("count"), sorted(o.get("items") or [])) for o in x.get("objectives") or []])


def quest_page(ctx: Ctx, tid: str) -> tuple[str, str]:
    t = ctx.tasks[tid]
    ko, en = ctx.task_names(tid)
    tr_id = t.get("trader")
    trn = ctx.trader_name(tr_id)
    trs = ctx.trader_slug(tr_id)
    modes = ctx.task_modes.get(tid, ["pvp", "pve"])
    en_label = en if en and en != ko else ""  # 번역이 없으면 영어 이름이 두 번 나오지 않게
    if ctx.display_suffix.get(tid):
        ko = f"{ko} ({ctx.display_suffix[tid]})"
    maps = ctx.task_maps(t)
    img = ctx.trader(tr_id).get("imageLink")
    tags = [f'<a class="tag tr" href="/guide/quests/{e(trs)}/">'
            + (f'<img src="{e(img)}" alt="" width="20" height="20" loading="lazy" />' if img else "")
            + f"{e(trn)}</a>"]
    lv = t.get("minPlayerLevel") or 0
    if lv > 1:
        tags.append(f'<span class="tag">레벨 {lv}+</span>')
    ll = ctx.trader_ll(t)
    if ll > 1:
        tags.append(f'<span class="tag">LL{ll}</span>')
    for mid in maps[:4]:
        tags.append(f'<span class="tag map">{ctx.map_link(mid)}</span>')
    if len(modes) == 1:
        tags.append(f'<span class="badge b-mode">{"PVE 전용" if modes[0] == "pve" else "PVP 전용"}</span>')
    if t.get("kappaRequired"):
        tags.append('<span class="badge b-kappa">카파 필수</span>')
    if t.get("lightkeeperRequired"):
        tags.append('<span class="badge b-lk">등대지기 필수</span>')
    if t.get("factionName") in ("BEAR", "USEC"):
        tags.append(f'<span class="badge b-any">{e(t["factionName"])} 전용</span>')
    if t.get("restartable"):
        tags.append('<span class="badge b-any">실패 시 재시작 가능</span>')

    objs = "".join(objective_html(ctx, o) for o in t.get("objectives") or [])
    sections_main = [f'<section class="box"><h2>목표 {len(t.get("objectives") or [])}개</h2><ol class="objs">{objs}</ol></section>']
    tp = ctx.tasks_pve.get(tid)
    if tp and tid in ctx.tasks_reg and _sig(tp) != _sig(ctx.tasks_reg[tid]):
        sections_main.append('<section class="box"><h2>PVE 버전 목표</h2><p class="small muted">PVE에서는 목표가 조금 다릅니다.</p><ol class="objs">'
                             + "".join(objective_html(ctx, o) for o in tp.get("objectives") or []) + "</ol></section>")
    keys_html = ""
    for nk in t.get("neededKeys") or []:
        ks = _flat(nk.get("keys"))
        if ks:
            mp = nk.get("map")
            mid = mp.get("id") if isinstance(mp, dict) else mp
            keys_html += f'<div class="keyrow"><span class="muted small">{ctx.map_link(mid) or "지도"}</span>{ctx.chips_alt(ks)}</div>'
    if keys_html:
        sections_main.append(f'<section class="box"><h2>필요한 열쇠</h2>{keys_html}</section>')
    fail = []
    for fc in t.get("failConditions") or []:
        if fc.get("type") == "taskStatus" and fc.get("task") in ctx.tasks:
            st = " · ".join(STATUS.get(s, s) for s in fc.get("status") or [])
            fail.append(f'{ctx.task_link(fc["task"])}을(를) {e(st)}하면 이 퀘스트는 <b>실패</b>합니다 (둘 중 하나만 가능).')
        else:
            d = ctx.tk(fc.get("description"), None)
            if d and d != fc.get("description"):
                fail.append(e(d))
    if fail:
        sections_main.append('<section class="box"><h2>실패 조건</h2><ul class="plain">' + "".join(f"<li>{x}</li>" for x in fail) + "</ul></section>")
    rw = rewards_html(ctx, t)
    sections_main.append(f'<section class="box"><h2>보상</h2>{rw or "<p class=muted>데이터에 보상 정보가 없습니다.</p>"}</section>')
    srw = rewards_html(ctx, t, "startRewards")
    if srw:
        sections_main.append(f'<section class="box"><h2>시작할 때 받는 것</h2>{srw}</section>')

    sections_side = [f'<section class="box"><h2>받는 조건</h2>{requirements_html(ctx, t)}</section>']
    need, groups = ctx.needed_items(t)
    if need or groups:
        need_sorted = sorted(need, key=lambda a: (not a["fir"], -a["c"]))
        sections_side.append('<section class="box"><h2>미리 챙길 아이템</h2><div class="chips">'
                             + "".join(ctx.chip(a["id"], a["c"], a["fir"]) for a in need_sorted) + "</div>"
                             + "".join(ctx.chips_alt(g["ids"], g["c"], g["fir"]) for g in groups) + "</section>")
    nxt = sorted(set(ctx.next_of.get(tid, [])), key=lambda x: ctx.task_names(x)[0])
    if nxt:
        lis = "".join(f'<li>{ctx.task_link(x)} <span class="muted small">{e(ctx.trader_name(ctx.tasks[x].get("trader")))}</span></li>' for x in nxt)
        sections_side.append(f'<section class="box"><h2>다음 퀘스트</h2><ul class="plain">{lis}</ul></section>')
    else:
        sections_side.append('<section class="box"><h2>다음 퀘스트</h2><p class="muted small">이 퀘스트를 선행 조건으로 삼는 퀘스트는 없습니다. '
                             '1.1.0 이후 대부분은 상인 등급·묶음으로 열립니다.</p></section>')
    refs = []
    if t.get("wikiLink"):
        refs.append(f'<a href="{e(t["wikiLink"])}" target="_blank" rel="noopener">공식 위키(영문)</a>')
    refs.append(f'<a href="https://tarkov.dev/task/{e(t.get("normalizedName"))}" target="_blank" rel="noopener">tarkov.dev</a>')
    sections_side.append(f'<section class="box"><h2>더 보기</h2><p class="small">{" · ".join(refs)}</p></section>')

    body = (f'<article class="quest" data-id="{e(tid)}">'
            f'<h1>{e(ko)}' + (f' <span class="h1en">{e(en_label)}</span>' if en_label else "") + '</h1>'
            f'<div class="tags">{"".join(tags)}</div>'
            f'<label class="donebox"><input type="checkbox" id="qdone" /> 완료로 표시 <span class="muted small">(퀘스트 목록과 같이 저장)</span></label>'
            f'<div class="cols"><div class="col-main">{"".join(sections_main)}</div>'
            f'<aside class="col-side">{"".join(sections_side)}</aside></div></article>')
    map_txt = ", ".join(ctx.map_name(m) for m in maps[:3]) or "모든 지역"
    title = f"{ko} 퀘스트 공략 — {trn} · 목표·필요템·보상 | 타르코프(탈콥) 가이드"
    desc = (f"타르코프 {trn} 퀘스트 '{ko}'({en}) 공략: 목표 {len(t.get('objectives') or [])}개, 필요 아이템·열쇠, 보상, "
            f"받는 조건과 다음 퀘스트. 지역: {map_txt}. 데이터 기준 {ctx.stamp}.")
    html_text = page(ctx, path=ctx.task_url(tid), title=title, desc=desc, body=body, nav="quests",
                     crumbs=[("퀘스트", "/guide/quests/"), (trn, f"/guide/quests/{trs}/"), (ko, None)], scripts=QUEST_JS)
    return ctx.task_url(tid), html_text


# ─────────────────────────────────────────────────────────────
# 상인별 퀘스트 순서
# ─────────────────────────────────────────────────────────────

def _fir_need(t):
    n = 0
    for o in t.get("objectives") or []:
        if o.get("type") == "giveItem" and o.get("foundInRaid") and not o.get("optional"):
            n += o.get("count") or 1
    return n


def trader_page(ctx: Ctx, tr_id: str, tids: list[str]) -> tuple[str, str]:
    tr = ctx.trader(tr_id)
    name = ctx.trader_name(tr_id)
    slug = ctx.trader_slug(tr_id)
    desc_ko = ctx._loc(ctx.loc_traders, tr.get("description"), "")
    rows = []
    for tid in tids:
        t = ctx.tasks[tid]
        key, label = ctx.tier(t)
        rows.append((key + ((t.get("minPlayerLevel") or 0), ctx.task_names(tid)[0]), label, tid))
    rows.sort()
    trs = []
    last = None
    for _, label, tid in rows:
        t = ctx.tasks[tid]
        tier = label.split(" · ")[0]
        if tier != last:
            trs.append(f'<tr class="grp"><td colspan="5">{e(tier)} 퀘스트</td></tr>')
            last = tier
        modes = ctx.task_modes.get(tid, [])
        badges = []
        if t.get("kappaRequired"):
            badges.append('<span class="badge b-kappa">카파</span>')
        if t.get("lightkeeperRequired"):
            badges.append('<span class="badge b-lk">등대지기</span>')
        if len(modes) == 1:
            badges.append(f'<span class="badge b-mode">{"PVE" if modes[0] == "pve" else "PVP"}</span>')
        maps = ", ".join(e(ctx.map_name(m)) for m in ctx.task_maps(t)[:2]) or '<span class="muted">아무 곳</span>'
        fir = _fir_need(t)
        trs.append(f'<tr data-q="{e(tid)}"><td><span class="muted small">{e(label)}</span></td>'
                   f'<td>{ctx.task_link(tid)} {" ".join(badges)}<div class="muted small">{e(ctx.task_names(tid)[1])}</div></td>'
                   f'<td class="n">{t.get("minPlayerLevel") or 1}</td><td>{maps}</td>'
                   f'<td class="n">{("인레이드 " + str(fir)) if fir else ""}</td></tr>')
    lv_rows = ""
    for lv in tr.get("levels") or []:
        req = []
        if lv.get("requiredPlayerLevel"):
            req.append(f'레벨 {lv["requiredPlayerLevel"]}')
        if lv.get("requiredReputation"):
            req.append(f'평판 {lv["requiredReputation"]}')
        if lv.get("requiredCommerce"):
            req.append(f'거래액 {fmt_int(lv["requiredCommerce"])}')
        lv_rows += f'<tr><th>LL{lv.get("level")}</th><td>{" · ".join(req) or "처음부터"}</td></tr>'
    img = tr.get("imageLink")
    kappa_n = sum(1 for x in tids if ctx.tasks[x].get("kappaRequired"))
    img_html = f'<img src="{e(img)}" alt="{e(name)}" width="96" height="96" loading="lazy" />' if img else ""
    head = (f'<div class="trhead">{img_html}'
            f'<div><h1>{e(name)} 퀘스트 순서 <span class="h1en">{e(tr.get("normalizedName", "").title())}</span></h1>'
            f'<p class="sub">전체 {len(tids)}개 · 카파 필수 {kappa_n}개 · 데이터 기준 {e(ctx.stamp)}</p>'
            f'<p class="small muted">{e(desc_ko)}</p></div></div>')
    note = ('<div class="note">1.1.0 이후 사이드 퀘스트는 대부분 <b>상인 등급(LL)별 2~4개 묶음</b>으로 열립니다. '
            '같은 묶음의 퀘스트를 몇 개 깨거나 상인 등급을 올리면 다음 묶음이 열리고, 일부만 예전처럼 연쇄로 이어집니다. '
            '아래 표는 <b>LL → 묶음 → 연쇄 깊이 → 레벨</b> 순으로 정렬해 "먼저 받게 되는 순서"에 가깝게 맞췄습니다.</div>')
    body = (head + note
            + (f'<section class="box"><h2>상인 등급 조건</h2><table class="kv">{lv_rows}</table></section>' if lv_rows else "")
            + '<div class="box tbl" style="padding:4px 8px"><table class="tot qtbl"><thead><tr><th>해금</th><th>퀘스트</th>'
            '<th class="n">레벨</th><th>지역</th><th class="n">제출</th></tr></thead><tbody>' + "".join(trs) + "</tbody></table></div>")
    path = f"/guide/quests/{slug}/"
    title = f"타르코프 {name} 퀘스트 순서 — 전체 {len(tids)}개 해금 조건·필요템 | 탈콥 가이드"
    desc = f"타르코프 {name} 퀘스트 {len(tids)}개를 해금 순서(상인 등급·묶음·연쇄)대로 정리. 레벨, 지역, 인레이드 제출 개수, 카파 필수 여부까지. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="quests",
                      crumbs=[("퀘스트", "/guide/quests/"), (name, None)])


# ─────────────────────────────────────────────────────────────
# 필요 아이템 총정리 (퀘스트 + 은신처)
# ─────────────────────────────────────────────────────────────

def item_needs(ctx: Ctx, tasks: dict, hideout: dict):
    q: dict[str, dict] = {}
    h: dict[str, dict] = {}
    money = {"quest": {}, "hideout": {}}
    for tid, t in tasks.items():
        for o in t.get("objectives") or []:
            if o.get("type") != "giveItem" or o.get("optional"):
                continue
            ids = [i for i in o.get("items") or [] if i]
            if len(ids) != 1:
                continue
            iid, c = ids[0], o.get("count") or 1
            if iid in MONEY:
                money["quest"][iid] = money["quest"].get(iid, 0) + c
                continue
            a = q.setdefault(iid, {"fir": 0, "any": 0, "where": []})
            a["fir" if o.get("foundInRaid") else "any"] += c
            if tid not in a["where"]:
                a["where"].append(tid)
    for sid, st in hideout.items():
        for lv in st.get("levels") or []:
            for r in lv.get("itemRequirements") or []:
                it = r.get("item")
                iid = it.get("id") if isinstance(it, dict) else it
                c = r.get("count") or 1
                if not iid:
                    continue
                if iid in MONEY:
                    money["hideout"][iid] = money["hideout"].get(iid, 0) + c
                    continue
                fir = bool((r.get("attributes") or {}).get("foundInRaid"))
                a = h.setdefault(iid, {"fir": 0, "any": 0, "where": []})
                a["fir" if fir else "any"] += c
                a["where"].append((sid, lv.get("level")))
    return q, h, money


ITEMS_JS = """<script>
(function(){var KEY="guide.items.have",MK="guide.mode";function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}
function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var have=L(KEY,{}),mode=L(MK,"pvp"),scope="all",rows=[].slice.call(document.querySelectorAll("#itbl tbody tr"));
function seg(id,v){document.querySelectorAll("#"+id+" button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)})}
function render(){var q=document.getElementById("q").value.trim().toLowerCase(),fo=document.getElementById("firOnly").checked,hh=document.getElementById("hideHave").checked,shown=0;
rows.forEach(function(r){var d=r.dataset,p=mode==="pve"?"e":"p",qf=+d[p+"qf"]||0,qa=+d[p+"qa"]||0,hf=+d[p+"hf"]||0,ha=+d[p+"ha"]||0;
var qq=qf+qa,hc=hf+ha,ok=true;if(scope==="quest"&&!qq)ok=false;if(scope==="hideout"&&!hc)ok=false;if(!qq&&!hc)ok=false;
if(fo&&!(qf||hf))ok=false;if(q&&d.s.indexOf(q)<0)ok=false;var hv=!!have[d.id];if(hh&&hv)ok=false;
r.style.display=ok?"":"none";r.classList.toggle("done",hv);var c=r.querySelector("input");if(c)c.checked=hv;
var cells=r.querySelectorAll("td.n");cells[0].textContent=qf||"";cells[1].textContent=qa||"";cells[2].textContent=hf||"";cells[3].textContent=ha||"";cells[4].textContent=(qq+hc)||"";if(ok)shown++;});
document.getElementById("shown").textContent=shown;}
seg("mode",mode);document.getElementById("mode").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;mode=v;S(MK,v);seg("mode",v);render()});
document.getElementById("scope").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;scope=v;seg("scope",v);render()});
["firOnly","hideHave"].forEach(function(id){document.getElementById(id).addEventListener("change",render)});document.getElementById("q").addEventListener("input",render);
document.getElementById("itbl").addEventListener("change",function(e){var r=e.target.closest("tr");if(!r)return;if(e.target.checked)have[r.dataset.id]=1;else delete have[r.dataset.id];S(KEY,have);render()});
render();})();
</script>"""


def items_page(ctx: Ctx, collector_ids: set) -> tuple[str, str]:
    qp, hp, mp_ = item_needs(ctx, ctx.tasks_reg, ctx.hideout_reg)
    qe, he, me = item_needs(ctx, ctx.tasks_pve, ctx.hideout_pve)
    ids = set(qp) | set(hp) | set(qe) | set(he)

    def tot(d, iid):
        a = d.get(iid) or {}
        return (a.get("fir") or 0) + (a.get("any") or 0)

    def fir(d, iid):
        return (d.get(iid) or {}).get("fir") or 0

    # 인레이드 필요량이 많은 것부터 — 사서 낼 수 있는 탄약 수천 발이 맨 위로 오지 않게
    order = sorted(ids, key=lambda i: (-(fir(qp, i) + fir(hp, i)), -(tot(qp, i) + tot(hp, i)),
                                       -(tot(qe, i) + tot(he, i)), (ctx.item(i) or {}).get("n") or i))
    trs = []
    for iid in order:
        it = ctx.item(iid)
        if not it:
            continue
        a_q, a_h = qp.get(iid) or {}, hp.get(iid) or {}
        b_q, b_h = qe.get(iid) or {}, he.get(iid) or {}
        where = []
        for tid in (a_q.get("where") or b_q.get("where") or [])[:4]:
            where.append(ctx.task_link(tid))
        more_q = len(a_q.get("where") or b_q.get("where") or []) - 4
        if more_q > 0:
            where.append(f'<span class="muted">퀘스트 외 {more_q}개</span>')
        seen = set()
        for sid, lv in (a_h.get("where") or b_h.get("where") or []):
            if (sid, lv) in seen:
                continue
            seen.add((sid, lv))
            if len(seen) > 4:
                break
            where.append(ctx.station_link(sid, lv))
        kappa = ' <span class="badge b-kappa">카파</span>' if iid in collector_ids else ""
        price = it.get("pvp")
        price_html = f'<span class="price">{fmt_int(price)}₽</span>' if price else ('<span class="muted small">거래 불가</span>' if it.get("noflea") else "")
        s = (it["n"] + " " + (it.get("en") or "") + " " + (it.get("s") or "")).lower()
        img = f'<img class="icon sm" loading="lazy" alt="" src="{e(it["img"])}" />' if it.get("img") else ""
        trs.append(
            f'<tr data-id="{e(iid)}" data-s="{e(s)}" data-pqf="{a_q.get("fir", 0)}" data-pqa="{a_q.get("any", 0)}" data-phf="{a_h.get("fir", 0)}" data-pha="{a_h.get("any", 0)}" '
            f'data-eqf="{b_q.get("fir", 0)}" data-eqa="{b_q.get("any", 0)}" data-ehf="{b_h.get("fir", 0)}" data-eha="{b_h.get("any", 0)}">'
            f'<td><input type="checkbox" aria-label="보유" /></td><td><span class="itn">{img}<span>{e(it["n"])}{kappa}<br><span class="muted small">{e(it.get("en") or "")}</span></span></span></td>'
            f'<td class="n">{a_q.get("fir") or ""}</td><td class="n">{a_q.get("any") or ""}</td><td class="n">{a_h.get("fir") or ""}</td><td class="n">{a_h.get("any") or ""}</td>'
            f'<td class="n"><b>{(tot(qp, iid) + tot(hp, iid)) or ""}</b></td><td>{price_html}</td><td class="small">{" · ".join(where)}</td></tr>')

    def money_line(m):
        parts = [ctx.money(k, m[k]) for k in MONEY if k in m]
        return " + ".join(p for p in parts if p) or "없음"
    fir_q = sum((a.get("fir") or 0) for a in qp.values())
    fir_h = sum((a.get("fir") or 0) for a in hp.values())
    body = f"""<h1>퀘스트·은신처 필요 아이템 총정리 <span class="h1en">버리면 안 되는 템</span></h1>
<p class="sub">퀘스트 제출 + 은신처 건설에 들어가는 아이템 {len(trs)}종 · PVP 기준 인레이드 필요: 퀘스트 {fir_q:,}개, 은신처 {fir_h:,}개 · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note">숫자는 <b>모든 퀘스트·모든 은신처 단계</b>에 들어가는 총량입니다. <b>인레이드</b> 칸은 레이드에서 직접 주운 상태(Found in Raid)여야 하는 수량, <b>일반</b> 칸은 플리·상인에서 사도 되는 수량입니다.
"아무거나 N개"처럼 여러 아이템 중 고르는 제출은 각 퀘스트 페이지에서 확인하세요. 체크하면 '보유'로 표시되고 이 브라우저에만 저장됩니다.</div>
<section class="box"><h2>필요한 돈</h2><table class="kv"><tr><th>퀘스트 제출</th><td>PVP {e(money_line(mp_["quest"]))} · PVE {e(money_line(me["quest"]))}</td></tr><tr><th>은신처 건설</th><td>PVP {e(money_line(mp_["hideout"]))} · PVE {e(money_line(me["hideout"]))}</td></tr></table></section>
<div class="controls"><input type="search" id="q" placeholder="아이템 이름 검색 (한글·영문)" aria-label="검색" />
<div class="seg" id="scope"><button data-v="all" class="on">전체</button><button data-v="quest">퀘스트</button><button data-v="hideout">은신처</button></div>
<div class="seg" id="mode"><button data-v="pvp" class="on">PVP</button><button data-v="pve">PVE</button></div>
<label class="chk"><input type="checkbox" id="firOnly" /> 인레이드 필요만</label><label class="chk"><input type="checkbox" id="hideHave" /> 보유 체크 숨기기</label>
<span class="muted small"><span id="shown">{len(trs)}</span>종 표시</span></div>
<div class="box tbl" style="padding:4px 8px"><table class="tot" id="itbl"><thead><tr><th></th><th>아이템</th><th class="n">퀘스트<br>인레이드</th><th class="n">퀘스트<br>일반</th><th class="n">은신처<br>인레이드</th><th class="n">은신처<br>일반</th><th class="n">합계</th><th>플리 시세</th><th>쓰이는 곳</th></tr></thead><tbody>
{"".join(trs)}
</tbody></table></div>"""
    path = "/guide/items/"
    title = "타르코프 퀘스트·은신처 필요 아이템 총정리 — 버리면 안 되는 템, 인레이드 수량 | 탈콥 가이드"
    desc = f"타르코프 전체 퀘스트 제출 아이템과 은신처 건설 재료 {len(trs)}종을 한 표로. 인레이드(FiR) 필요 수량, 일반 수량, 플리 시세, 쓰이는 퀘스트·은신처 단계. PVP·PVE 전환. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="items",
                      crumbs=[("필요 아이템", None)], scripts=ITEMS_JS)


# ─────────────────────────────────────────────────────────────
# 퀘스트 전용 아이템
# ─────────────────────────────────────────────────────────────

def quest_items_page(ctx: Ctx) -> tuple[str, str]:
    uses: dict[str, dict] = {}
    for tid, t in ctx.tasks.items():
        for o in t.get("objectives") or []:
            if o.get("type") not in ("findQuestItem", "giveQuestItem", "plantQuestItem"):
                continue
            qi = o.get("questItem")
            qid = qi.get("id") if isinstance(qi, dict) else qi
            if not qid:
                continue
            u = uses.setdefault(qid, {"tasks": [], "maps": []})
            if tid not in u["tasks"]:
                u["tasks"].append(tid)
            for loc in o.get("possibleLocations") or []:
                if loc.get("map") and loc["map"] not in u["maps"]:
                    u["maps"].append(loc["map"])
            for m in o.get("maps") or []:
                mid = m.get("id") if isinstance(m, dict) else m
                if mid and mid not in u["maps"]:
                    u["maps"].append(mid)
    by_map: dict[str, list] = {}
    for qid, u in uses.items():
        base = None
        for m in u["maps"]:
            slug = (ctx.maps.get(m) or {}).get("normalizedName")
            if slug and slug != "ground-zero-tutorial":
                base = MAP_VARIANTS.get(slug, slug)
                break
        by_map.setdefault(base or "_", []).append(qid)
    order = [s for s in MAP_ORDER if s in by_map] + [s for s in by_map if s not in MAP_ORDER and s != "_"] + (["_"] if "_" in by_map else [])
    secs = []
    toc = []
    for slug in order:
        mid = ctx.map_by_slug.get(slug)
        mname = ctx.map_name(mid) if mid else "지역 무관"
        toc.append(f'<a href="#m-{e(slug)}">{e(mname)} <span class="muted">{len(by_map[slug])}</span></a>')
        cards = []
        for qid in sorted(by_map[slug], key=lambda x: (ctx.item(x) or {}).get("n") or x):
            it = ctx.item(qid) or {"n": qid}
            u = uses[qid]
            tl = " · ".join(f'{ctx.task_link(x)} <span class="muted small">{e(ctx.trader_name(ctx.tasks[x].get("trader")))}</span>' for x in u["tasks"])
            ml = ctx.map_links(u["maps"])
            img = f'<img class="icon" loading="lazy" alt="" src="{e(it.get("img"))}" />' if it.get("img") else ""
            cards.append(f'<div class="card static">{img}<div><div class="nm">{e(it["n"])}</div>'
                         f'<div class="small muted">{e(it.get("desc") or "")}</div>'
                         f'<div class="small" style="margin-top:4px">퀘스트: {tl}</div>'
                         + (f'<div class="small muted">지도: {ml}</div>' if ml else "") + "</div></div>")
        secs.append(f'<h2 class="sec" id="m-{e(slug)}">{e(mname)}</h2><div class="grid wide">{"".join(cards)}</div>')
    body = (f'<h1>퀘스트 전용 아이템 <span class="h1en">Quest items</span></h1>'
            f'<p class="sub">레이드에서 찾아 제출·설치하는 퀘스트 전용 아이템 {len(uses)}종 · 지도별 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note">퀘스트 전용 아이템은 해당 퀘스트를 <b>받은 상태</b>에서만 보이고, 죽으면 잃습니다(일부는 다시 생성). '
            '1.0.5부터 근처에 가면 화면에 방향 표시가 뜹니다. 정확한 위치는 각 퀘스트 페이지의 위키·tarkov.dev 지도 링크를 참고하세요.</div>'
            f'<nav class="toc">{"".join(toc)}</nav>' + "".join(secs))
    path = "/guide/quest-items/"
    title = f"타르코프 퀘스트 전용 아이템 {len(uses)}종 — 지도별 위치·관련 퀘스트 | 탈콥 가이드"
    desc = f"타르코프 퀘스트에서 찾아야 하는 전용 아이템(문서·USB·케이스 등) {len(uses)}종을 지도별로 정리. 아이템 설명과 관련 퀘스트 링크. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="items",
                      crumbs=[("퀘스트 전용 아이템", None)])


# ─────────────────────────────────────────────────────────────
# 은신처
# ─────────────────────────────────────────────────────────────

PCT_BONUS_ABS = {"AdditionalSlots", "StashSize", "MaximumEnergyReserve"}


def bonus_text(ctx: Ctx, b: dict) -> str:
    ty = b.get("type") or ""
    name = ctx._loc(ctx.loc_hideout, b.get("name"), None) or ctx._loc(ctx.loc_hideout, "hideout_" + ty, ty)
    v = b.get("value")
    if ty.startswith("Unlock") or v is None:
        return name
    if ty == "SkillGroupLevelingBoost" and b.get("skillName"):
        name += f" ({ctx.skill_name(b['skillName'])})"
    if ty in PCT_BONUS_ABS:
        return f"{name} +{fmt_int(v)}"
    pct = v * 100 if abs(v) < 5 else v
    sign = "+" if pct > 0 else ""
    return f"{name} {sign}{fmt_int(pct)}%"


def _req_sig(lv):
    return json.dumps(sorted(((r.get("item") if not isinstance(r.get("item"), dict) else r["item"].get("id")),
                              r.get("count"), bool((r.get("attributes") or {}).get("foundInRaid")))
                             for r in lv.get("itemRequirements") or []))


def level_req_html(ctx: Ctx, lv: dict) -> str:
    rows = []
    items, money = [], []
    for r in lv.get("itemRequirements") or []:
        it = r.get("item")
        iid = it.get("id") if isinstance(it, dict) else it
        if iid in MONEY:
            money.append(ctx.chip(iid, r.get("count")))
        else:
            items.append(ctx.chip(iid, r.get("count"), bool((r.get("attributes") or {}).get("foundInRaid"))))
    if items:
        rows.append(("재료", '<div class="chips">' + "".join(items) + "</div>"))
    if money:
        rows.append(("돈", '<div class="chips">' + "".join(money) + "</div>"))
    st = lv.get("stationLevelRequirements") or []
    if st:
        rows.append(("선행 시설", ", ".join(ctx.station_link(x.get("station") if not isinstance(x.get("station"), dict) else x["station"].get("id"), x.get("level")) for x in st)))
    tr = lv.get("traderRequirements") or []
    if tr:
        rows.append(("상인 등급", ", ".join(f'{e(ctx.trader_name(x.get("trader") if not isinstance(x.get("trader"), dict) else x["trader"].get("id")))} LL{x.get("level") or x.get("value")}' for x in tr)))
    sk = lv.get("skillRequirements") or []
    if sk:
        rows.append(("스킬", ", ".join(f'{e(ctx.skill_name(x.get("skill") if not isinstance(x.get("skill"), dict) else x["skill"].get("name")))} {x.get("level")}레벨' for x in sk)))
    rows.append(("건설 시간", fmt_dur(lv.get("constructionTime"))))
    return '<table class="kv">' + "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows) + "</table>"


def craft_unlocks(ctx: Ctx):
    """(station, level, product) → 해금 퀘스트 id 목록"""
    out: dict[tuple, list] = {}
    for tid, t in ctx.tasks_reg.items():
        for side in ("finishRewards", "startRewards"):
            for c in (t.get(side) or {}).get("craftUnlock") or []:
                k = (c.get("station"), c.get("level"), c.get("item"))
                out.setdefault(k, [])
                if tid not in out[k]:
                    out[k].append(tid)
    return out


def crafts_html(ctx: Ctx, crafts: list, unlock_map: dict) -> str:
    if not crafts:
        return ""
    trs = []
    for c in sorted(crafts, key=lambda c: (c.get("duration") or 0)):
        p = c.get("productItem") or {}
        pid = p.get("item")
        mats = []
        for r in c.get("requiredItems") or []:
            tool = (r.get("attributes") or {}).get("tool")
            mats.append(ctx.chip(r.get("item"), r.get("count"), extra=' <span class="badge b-any">도구·반환</span>' if tool else ""))
        q = unlock_map.get((c.get("station"), c.get("level"), pid))
        lock = (' <span class="muted small">해금: ' + ", ".join(ctx.task_link(x) for x in q) + "</span>") if q else ""
        trs.append(f'<tr><td>{ctx.chip(pid, p.get("count"))}{lock}</td><td><div class="chips">{"".join(mats)}</div></td><td class="n">{fmt_dur(c.get("duration"))}</td></tr>')
    return ('<div class="tbl"><table class="tot"><thead><tr><th>만드는 것</th><th>재료</th><th class="n">시간</th></tr></thead><tbody>'
            + "".join(trs) + "</tbody></table></div>")


def station_page(ctx: Ctx, sid: str, unlock_map: dict) -> tuple[str, str]:
    st = ctx.hideout_reg[sid]
    stp = ctx.hideout_pve.get(sid) or {}
    name = ctx.station_name(sid)
    slug = st.get("normalizedName")
    area = st.get("areaType")
    secs = []
    crafts_by_lv: dict[int, list] = {}
    for c in ctx.crafts_reg:
        if c.get("station") == sid:
            crafts_by_lv.setdefault(c.get("level") or 1, []).append(c)
    pve_levels = {lv.get("level"): lv for lv in stp.get("levels") or []}
    toc = []
    for lv in st.get("levels") or []:
        n = lv.get("level")
        toc.append(f'<a href="#lv{n}">{n}단계</a>')
        d = ctx._loc(ctx.loc_hideout, f"hideout_area_{area}_stage_{n}_description", "")
        bon = lv.get("bonuses") or []
        bon_html = ('<ul class="plain">' + "".join(f"<li>{e(bonus_text(ctx, b))}</li>" for b in bon) + "</ul>") if bon else '<p class="muted small">표시할 효과 없음</p>'
        pve_html = ""
        pl = pve_levels.get(n)
        if pl and _req_sig(pl) != _req_sig(lv):
            pve_html = '<h3>PVE 재료 (다름)</h3>' + level_req_html(ctx, pl)
        crafts = crafts_by_lv.get(n) or []
        secs.append(f'<section class="box lvl" id="lv{n}"><h2>{e(name)} {n}단계</h2>'
                    + (f'<p class="small muted">{e(d)}</p>' if d else "")
                    + '<div class="cols2"><div><h3>필요 조건</h3>' + level_req_html(ctx, lv) + pve_html + "</div>"
                    + f'<div><h3>효과</h3>{bon_html}</div></div>'
                    + (f'<h3>이 단계에서 할 수 있는 제작 {len(crafts)}개</h3>' + crafts_html(ctx, crafts, unlock_map) if crafts else "")
                    + "</section>")
    others = " · ".join(f'<a href="/guide/hideout/{e(s.get("normalizedName"))}/">{e(ctx.station_name(k))}</a>'
                        for k, s in sorted(ctx.hideout_reg.items(), key=lambda kv: ctx.station_name(kv[0])) if k != sid)
    total_time = sum(lv.get("constructionTime") or 0 for lv in st.get("levels") or [])
    body = (f'<h1>{e(name)} <span class="h1en">{e(slug.replace("-", " ").title())}</span></h1>'
            f'<p class="sub">은신처 시설 · {len(st.get("levels") or [])}단계 · 총 건설 시간 {fmt_dur(total_time)} · 데이터 기준 {e(ctx.stamp)}</p>'
            f'<nav class="toc">{"".join(toc)}</nav>' + "".join(secs)
            + f'<section class="box"><h2>다른 시설</h2><p class="small">{others}</p></section>')
    path = f"/guide/hideout/{slug}/"
    title = f"타르코프 은신처 {name} — 단계별 재료·조건·효과·제작 레시피 | 탈콥 가이드"
    desc = f"타르코프 은신처 {name} {len(st.get('levels') or [])}단계 업그레이드에 필요한 재료(인레이드 여부), 돈, 선행 시설·상인 등급·스킬, 건설 시간, 효과와 제작 레시피. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="hideout",
                      crumbs=[("은신처", "/guide/hideout/"), (name, None)])


HIDEOUT_JS = """<script>
(function(){var D=JSON.parse(document.getElementById("hdata").textContent),KEY="guide.hideout.levels",MK="guide.mode";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var cur=L(KEY,{}),mode=L(MK,"pvp");if(D.pve===undefined)mode="pvp";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}
function seg(v){document.querySelectorAll("#hmode button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)})}
function money(id,c){var s=D.money[id];if(!s)return null;return s==="₽"?c.toLocaleString("ko-KR")+"₽":s+c.toLocaleString("ko-KR")}
function render(){var S2=D[mode],agg={},cash={};
document.querySelectorAll("#hsel select").forEach(function(sel){var sid=sel.getAttribute("data-s"),st=S2[sid];if(!st)return;var have=+(cur[sid]||0);
st.l.forEach(function(lv,i){if(i+1<=have)return;lv.forEach(function(r){var id=r[0],c=r[1],f=r[2];if(D.money[id]){cash[id]=(cash[id]||0)+c;return}
var k=id+(f?"|f":"");var a=agg[k]||(agg[k]={id:id,f:f,c:0});a.c+=c;})})});
var rows=Object.keys(agg).map(function(k){return agg[k]}).sort(function(a,b){return(b.f-a.f)||(b.c-a.c)});
var it=D.items,html=rows.map(function(r){var x=it[r.id]||{n:r.id};return '<span class="chip'+(r.f?' fir':'')+'">'+(x.i?'<img loading="lazy" alt="" src="'+esc(x.i)+'" width="24" height="24" />':'')+esc(x.n)+' <span class="cnt">×'+r.c+'</span>'+(r.f?' <span class="badge b-fir">인레이드</span>':'')+'</span>'}).join("");
var cs=Object.keys(cash).map(function(k){return money(k,cash[k])}).join(" + ");
document.getElementById("hneed").innerHTML=(html?'<div class="chips">'+html+'</div>':'<p class="muted">모든 시설을 끝까지 올렸습니다 🎉</p>')+(cs?'<p class="small" style="margin-top:8px">돈: <b>'+esc(cs)+'</b></p>':'');
document.getElementById("hcount").textContent=rows.length;}
document.querySelectorAll("#hsel select").forEach(function(sel){var sid=sel.getAttribute("data-s");sel.value=String(cur[sid]||0);
sel.addEventListener("change",function(){cur[sid]=+sel.value;S(KEY,cur);render()})});
seg(mode);document.getElementById("hmode").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;mode=v;S(MK,v);seg(v);render()});
document.getElementById("hreset").addEventListener("click",function(){if(confirm("현재 단계 입력을 모두 지울까요?")){cur={};S(KEY,cur);document.querySelectorAll("#hsel select").forEach(function(s){s.value="0"});render()}});
render();})();
</script>"""


def hideout_index(ctx: Ctx) -> tuple[str, str]:
    stations = sorted(ctx.hideout_reg.items(), key=lambda kv: ctx.station_name(kv[0]))
    # 다른 시설의 선행 조건으로 몇 번 쓰이는지 — "먼저 올릴수록 많이 풀리는 시설"
    unlock_cnt: dict[str, int] = {}
    for sid, st in ctx.hideout_reg.items():
        for lv in st.get("levels") or []:
            for r in lv.get("stationLevelRequirements") or []:
                s2 = r.get("station") if not isinstance(r.get("station"), dict) else r["station"].get("id")
                unlock_cnt[s2] = unlock_cnt.get(s2, 0) + 1
    data = {"money": MONEY, "items": {}}
    for mode, src in (("pvp", ctx.hideout_reg), ("pve", ctx.hideout_pve)):
        m = {}
        for sid, st in src.items():
            levels = []
            for lv in sorted(st.get("levels") or [], key=lambda x: x.get("level") or 0):
                reqs = []
                for r in lv.get("itemRequirements") or []:
                    it = r.get("item")
                    iid = it.get("id") if isinstance(it, dict) else it
                    reqs.append([iid, r.get("count") or 1, 1 if (r.get("attributes") or {}).get("foundInRaid") else 0])
                    if iid not in MONEY and iid not in data["items"]:
                        info = ctx.item(iid) or {}
                        data["items"][iid] = {"n": info.get("n") or iid, "i": info.get("img")}
                levels.append(reqs)
            m[sid] = {"l": levels}
        data[mode] = m
    rows = []
    sels = []
    for sid, st in stations:
        name = ctx.station_name(sid)
        slug = st.get("normalizedName")
        n_lv = len(st.get("levels") or [])
        lv1 = (st.get("levels") or [{}])[0]
        pre = ", ".join(ctx.station_link(r.get("station") if not isinstance(r.get("station"), dict) else r["station"].get("id"), r.get("level"))
                        for r in lv1.get("stationLevelRequirements") or []) or '<span class="muted">없음</span>'
        last = (st.get("levels") or [{}])[-1]
        bon = ", ".join(e(bonus_text(ctx, b)) for b in (last.get("bonuses") or [])[:3])
        rows.append(f'<tr><td><a href="/guide/hideout/{e(slug)}/"><b>{e(name)}</b></a></td><td class="n">{n_lv}</td><td class="small">{pre}</td>'
                    f'<td class="n">{unlock_cnt.get(sid, 0) or ""}</td><td class="small">{bon}</td></tr>')
        opts = "".join(f'<option value="{i}">{"미건설" if i == 0 else f"{i}단계"}</option>' for i in range(0, n_lv + 1))
        sels.append(f'<label class="hs"><span>{e(name)}</span><select data-s="{e(sid)}" aria-label="{e(name)} 현재 단계">{opts}</select></label>')
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    top_unlock = sorted(unlock_cnt.items(), key=lambda kv: -kv[1])[:5]
    tip = ", ".join(f"{ctx.station_link(s)}({c}곳)" for s, c in top_unlock)
    body = f"""<h1>은신처 업그레이드 총정리 <span class="h1en">Hideout</span></h1>
<p class="sub">시설 {len(stations)}개 · 단계별 재료·조건·효과·제작 · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note">1.1.0에서 1~3단계 일부 재료의 인레이드 조건이 빠지고 돈 요구가 추가됐습니다. 아래 숫자는 현재 데이터 기준입니다.
다른 시설의 선행 조건으로 가장 많이 쓰이는 시설: {tip} — 이 시설들을 먼저 올리면 막히는 곳이 줄어듭니다.</div>
<section class="box"><h2>남은 재료 계산기</h2><p class="small muted">시설마다 지금 단계를 고르면 끝까지 올리는 데 남은 재료를 합쳐 보여 줍니다(이 브라우저에 저장).</p>
<div class="controls"><div class="seg" id="hmode"><button data-v="pvp" class="on">PVP</button><button data-v="pve">PVE</button></div><button class="seg" id="hreset" style="padding:6px 10px;background:var(--panel);color:var(--muted);cursor:pointer;font:inherit;font-size:12px">입력 초기화</button></div>
<div class="hsel" id="hsel">{"".join(sels)}</div>
<h3>남은 재료 <span class="muted small"><span id="hcount">0</span>종</span></h3><div id="hneed"></div></section>
<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th>시설</th><th class="n">단계</th><th>1단계 선행 조건</th><th class="n">다른 시설 해금</th><th>최종 단계 효과</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>
<script id="hdata" type="application/json">{payload}</script>"""
    path = "/guide/hideout/"
    title = "타르코프 은신처 업그레이드 총정리 — 시설별 재료·조건·효과, 남은 재료 계산기 | 탈콥 가이드"
    desc = f"타르코프 은신처 시설 {len(stations)}개의 단계별 업그레이드 재료·돈·선행 조건·효과를 정리하고, 현재 단계를 입력하면 남은 재료를 계산해 줍니다. PVP·PVE. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="hideout",
                      crumbs=[("은신처", None)], scripts=HIDEOUT_JS)


# ─────────────────────────────────────────────────────────────
# 초반 진행 가이드 (투어 + 10레벨까지)
# ─────────────────────────────────────────────────────────────

# 투어 단계 — 공식 위키 'Tour'(2026-10 확인)를 보고 직접 정리. 데이터에 스토리 챕터가 없어 손으로 쓴다.
TOUR_STEPS = [
    ("—", "그라운드 제로 튜토리얼을 <b>Klimov Street</b> 탈출구(Skyside 건물 뒤)로 탈출합니다. 화면 안내는 따라 하지 않아도 됩니다.",
     "없음", "상인 대화 시작"),
    ("테라피스트", "대화한 뒤 <b>250,000₽</b>를 건넵니다. 돈은 인레이드가 아니어도 됩니다.", "250,000₽", "맵: 타르코프 시내"),
    ("래그맨", "<b>인터체인지</b>에서 '생존' 또는 '런스루'로 탈출하고 래그맨에게 보고합니다. 탈출이 어려우면 <b>3번 들어가기만</b> 해도 됩니다.",
     "없음", "상인: 스키어 · 맵: 세관"),
    ("스키어", "<b>세관</b> 생존·런스루 탈출(또는 3회 방문) + 인레이드 <b>건축 자재·공구 아무거나 5개</b>를 한 번에 제출합니다(나눠 내기 불가).",
     "인레이드 건축 자재·공구 5개", "상인: 메카닉 · 맵: 공장"),
    ("메카닉", "<b>공장</b> 생존·런스루 탈출(또는 3회 방문) + 인레이드 <b>무기 아무거나 2정</b>을 제출합니다.",
     "인레이드 무기 2정", "상인: 프라퍼 · 맵: 삼림"),
    ("스키어", "<b>삼림</b>에서 아무 적 3명 처치 + 삼림 생존·런스루 탈출(또는 3회 방문). 처치와 탈출은 다른 레이드여도 됩니다.",
     "없음", "상인: 피스키퍼 · 맵: 해안선"),
    ("—", "<b>해안선</b> 남동쪽 끝, 터미널 앞 감시탑의 <b>인터콤</b>을 씁니다. 터미널 담장에 붙지 말고, 경비병을 쏘지 말고, "
     "떠나라는 말을 들은 뒤 인터콤을 연타하지 마세요(사살됩니다).", "없음", "다음 단계"),
    ("프라퍼", "해안선 생존·런스루 탈출(또는 3회 방문) 후 <b>PMC 인식표 5개</b>를 건넵니다. 인식표는 인레이드가 아니어도 되고 직접 처치하지 않아도 됩니다.",
     "PMC 인식표 5개", "맵: 리저브"),
    ("메카닉", "<b>8,000달러</b>를 건넵니다. 달러는 피스키퍼에게 루블로 살 수 있습니다.", "$8,000", "맵: 등대"),
    ("—", "<b>연구소 출입 카드</b>를 들고 타르코프 시내(클리모바 16A 앞 지하 입구) 또는 공장(침수된 지하와 이어진 하수 터널)의 "
     "트랜짓으로 연구소에 들어갑니다(레이드 시작 1분 뒤부터 이용 가능). 2층 연구소장실(O21) · 1층 격납고 옆 서버실 · "
     "지하 'Sewage Conduit' 탈출구의 하수 탈출로를 차례로 확인하면 끝(탈출구 작동·생존 불필요).",
     "연구소 출입 카드", "맵: 연구소 · 업적 Pathfinder"),
]

EARLY_TRADERS = ["therapist", "ragman", "skier", "mechanic", "prapor", "peacekeeper", "jaeger"]


def start_page(ctx: Ctx) -> tuple[str, str]:
    tour_rows = "".join(
        f'<tr><td class="n">{i}</td><td class="nw">{e(who)}</td><td>{what}</td><td class="small">{e(need)}</td><td class="small"><b>{e(gain)}</b></td></tr>'
        for i, (who, what, need, gain) in enumerate(TOUR_STEPS, 1))
    # 초반 퀘스트: Ctx.early_tasks 기준(LL1·레벨 ≤ 10·묶음 1단계까지·선행도 초반·택일 제외)
    early: dict[str, list] = {}
    for tid in ctx.early_tasks(EARLY_TRADERS, max_batch=1):
        early.setdefault(ctx.trader_slug(ctx.tasks[tid].get("trader")), []).append(tid)
    blocks = []
    fir_agg: dict[str, int] = {}
    any_agg: dict[str, int] = {}
    money: dict[str, int] = {"5449016a4bdc2d6f028b456f": 250000, "5696686a4bdc2da3298b456a": 8000}
    total = 0
    for slug in EARLY_TRADERS:
        tids = early.get(slug) or []
        if not tids:
            continue
        tr_id = ctx.trader_by_slug.get(slug)
        rows = sorted(((ctx.tier(ctx.tasks[x])[0] + ((ctx.tasks[x].get("minPlayerLevel") or 0),), ctx.tier(ctx.tasks[x])[1], x) for x in tids))
        lis = []
        for _, label, tid in rows:
            t = ctx.tasks[tid]
            total += 1
            lv = t.get("minPlayerLevel") or 0
            badge = '<span class="badge b-kappa">카파</span>' if t.get("kappaRequired") else ""
            modes = ctx.task_modes.get(tid, [])
            mb = f'<span class="badge b-mode">{"PVE" if modes == ["pve"] else "PVP"}</span>' if len(modes) == 1 else ""
            lis.append(f'<li>{ctx.task_link(tid)} {badge}{mb} <span class="muted small">{e(label)}{f" · {lv}레벨+" if lv > 1 else ""}</span></li>')
            for o in t.get("objectives") or []:
                if o.get("type") != "giveItem" or o.get("optional"):
                    continue
                ids = [i for i in o.get("items") or [] if i]
                if len(ids) != 1:
                    continue
                if ids[0] in MONEY:
                    money[ids[0]] = money.get(ids[0], 0) + (o.get("count") or 0)
                elif o.get("foundInRaid"):
                    fir_agg[ids[0]] = fir_agg.get(ids[0], 0) + (o.get("count") or 1)
                else:
                    any_agg[ids[0]] = any_agg.get(ids[0], 0) + (o.get("count") or 1)
        blocks.append(f'<section class="box"><h3><a href="/guide/quests/{e(slug)}/">{e(ctx.trader_name(tr_id))}</a> '
                      f'<span class="muted small">{len(tids)}개</span></h3><ul class="cols-list">{"".join(lis)}</ul></section>')
    # 은신처 1단계 인레이드 재료(PVP)
    hide_fir: dict[str, int] = {}
    for st in ctx.hideout_reg.values():
        for lv in st.get("levels") or []:
            if lv.get("level") != 1:
                continue
            for r in lv.get("itemRequirements") or []:
                it = r.get("item")
                iid = it.get("id") if isinstance(it, dict) else it
                if iid in MONEY:
                    continue
                if (r.get("attributes") or {}).get("foundInRaid"):
                    hide_fir[iid] = hide_fir.get(iid, 0) + (r.get("count") or 1)
    fir_chips = "".join(ctx.chip(i, c, True) for i, c in sorted(fir_agg.items(), key=lambda kv: -kv[1]))
    any_chips = "".join(ctx.chip(i, c) for i, c in sorted(any_agg.items(), key=lambda kv: -kv[1])[:30])
    hide_chips = "".join(ctx.chip(i, c, True) for i, c in sorted(hide_fir.items(), key=lambda kv: -kv[1]))
    money_txt = " · ".join(ctx.money(k, v) for k, v in money.items() if ctx.money(k, v))
    jaeger = next((x for x in ctx.tasks if ctx.task_names(x)[1] == "Introduction"), None)
    ref = next((x for x in ctx.tasks_reg if ctx.task_names(x)[1].startswith("Easy Money - Part 1")), None)
    ref_pve = next((x for x in ctx.tasks_pve if ctx.task_names(x)[1].startswith("Easy Money - Part 1") and x != ref), None)
    body = f"""<h1>타르코프 초반 가이드 <span class="h1en">투어(Tour)부터 10레벨까지</span></h1>
<p class="sub">새 캐릭터·프레스티지 직후 기준 · 게임 1.2.x · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note key"><b>먼저 이 세 가지만</b><ol>
<li>시작하면 스토리 <b>투어(Tour)</b>가 자동으로 붙습니다. 이걸 순서대로 밀어야 <b>스키어 → 메카닉 → 프라퍼 → 피스키퍼</b>와 맵이 하나씩 열립니다.</li>
<li>사이드 퀘스트는 상인이 열린 뒤 그 상인의 <b>등급(LL)별로 2~4개씩 묶음</b>으로 열립니다. 몇 개 깨거나 등급이 오르면 다음 묶음이 나옵니다.</li>
<li>투어 제출용 <b>인레이드 건축 자재·공구 5개, 인레이드 무기 2정</b>과 돈(<b>250,000₽ · 8,000$</b>)을 미리 챙겨 두면 막히지 않습니다.</li></ol></div>
<nav class="toc"><a href="#s1">처음 열려 있는 것</a><a href="#s2">투어 순서</a><a href="#s3">사이드 퀘스트 여는 법</a><a href="#s4">특별한 상인 해금</a><a href="#s5">10레벨까지 퀘스트</a><a href="#s6">미리 모을 아이템</a><a href="#s7">초반 팁</a></nav>

<h2 class="sec" id="s1">1. 처음 열려 있는 것</h2>
<section class="box"><table class="kv">
<tr><th>상인</th><td><a href="/guide/quests/therapist/">테라피스트</a>, <a href="/guide/quests/ragman/">래그맨</a> (펜스는 스캐브 평판으로 거래)</td></tr>
<tr><th>맵</th><td>그라운드 제로 — 나머지 맵은 투어를 진행하며 열립니다</td></tr>
<tr><th>나중에 열리는 상인</th><td>스키어·메카닉·프라퍼·피스키퍼(투어), 예거·레프·등대지기(사이드 퀘스트, 아래 4번)</td></tr>
</table></section>

<h2 class="sec" id="s2">2. 투어(Tour) 진행 순서</h2>
<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th class="n">#</th><th>상인</th><th>할 일</th><th>준비물</th><th>열리는 것</th></tr></thead><tbody>{tour_rows}</tbody></table></div>
<p class="small muted">등대 해금 금액은 공식 위키 기준 8,000달러입니다(2만·2만5천 달러로 적힌 글은 옛 정보이거나 잘못된 정보). '3회 방문'은 생존 탈출 대신 쓸 수 있는 조건이라, 탈출이 어렵다면 들어갔다 나오기를 반복해도 됩니다.</p>

<h2 class="sec" id="s3">3. 사이드 퀘스트가 열리는 방식 (1.1.0 이후)</h2>
<section class="box"><ul class="plain">
<li>상인마다 <b>LL1 기본 퀘스트</b>가 먼저 열리고, 그중 몇 개를 깨거나 상인 등급이 오르면 다음 묶음(2~4개)이 열립니다. 퀘스트 페이지의 '묶음 해금 N개'가 이 조건입니다.</li>
<li>일부는 예전처럼 <b>연쇄</b>로 이어지고, 끝에 희귀 구매·제작 해금 같은 큰 보상이 있습니다(첫 퀘스트를 받을 때 보상이 미리 보입니다).</li>
<li>스캐브 처치 목표에는 일반·저격 스캐브와 플레이어 스캐브만 인정됩니다. <b>보스·레이더·로그는 안 셉니다.</b></li>
<li>파티원이 대신 채워 줄 수 있는 목표가 생겼습니다(퀘스트 화면에 아이콘). 일부 퀘스트는 여전히 솔로 전용입니다.</li>
<li>상인 등급 조건에서 <b>판매액 조건이 없어지고</b> 레벨·평판만 남았습니다.</li></ul></section>

<h2 class="sec" id="s4">4. 특별한 상인 해금</h2>
<section class="box"><table class="kv">
<tr><th>예거</th><td>{ctx.task_link(jaeger) if jaeger else '소개'} (메카닉) — 메카닉과 대화하면 받습니다. 삼림의 예거 캠프에서 암호 메시지를 찾아 건네면 예거가 열립니다. 예거는 식량·의료 퀘스트와 은신처에 중요하니 메카닉이 열리면 바로 진행하세요.</td></tr>
<tr><th>레프</th><td>{ctx.task_link(ref) if ref else '손쉬운 돈벌이 - 파트 1'}{(' / PVE: ' + ctx.task_link(ref_pve)) if ref_pve else ''} (스키어) — <b>10레벨 + 스키어 LL2</b>. 세관 스캐브 요새 거실에 포스터를 붙이면 레프가 열립니다.</td></tr>
<tr><th>등대지기</th><td>1.1.5에서 개편된 '빛을 향해' 체인 — 투어로 <b>등대</b>를 연 상태 + 펜스·레프를 뺀 <b>모든 상인 LL3</b> + 펜스 평판 <b>2.0</b> + 메카닉에게 등대지기 이야기를 물어보면 시작합니다. (옛 가이드의 '33레벨·네트워크 공급자' 조건은 지금 맞지 않습니다)</td></tr>
</table></section>

<h2 class="sec" id="s5">5. 초반에 받는 퀘스트 — 10레벨 무렵까지 ({total}개)</h2>
<p class="small muted">상인 등급 LL1·레벨 조건 10 이하이고, 첫 묶음까지 열리며, 앞 퀘스트도 모두 초반인 것만 골랐습니다(다른 퀘스트와 택일인 스토리성 퀘스트는 제외). 해당 상인이 투어로 열려 있어야 받을 수 있습니다.
라벨: LL1 = 바로 · 묶음 1 = 같은 상인의 앞 묶음 1개 완료 후 · 연쇄 = 앞 퀘스트 완료 후. 전체 목록은 <a href="/guide/quests/">퀘스트</a>에서 상인별로 볼 수 있습니다.</p>
{"".join(blocks)}

<h2 class="sec" id="s6">6. 미리 모아 둘 아이템</h2>
<section class="box"><h3>돈</h3><p>{e(money_txt)} <span class="muted small">(투어 250,000₽·8,000$ + 위 퀘스트들의 현금 제출)</span></p>
<h3>투어 제출용 (인레이드)</h3><p class="small">건축 자재·공구 카테고리 아무거나 <b>5개</b> (볼트·너트·전선·테이프 등) · 아무 무기 <b>2정</b> · PMC 인식표 <b>5개</b>(인레이드 불필요)</p>
<h3>10레벨까지 퀘스트 제출용 — 인레이드 필요</h3><div class="chips">{fir_chips or '<span class="muted">없음</span>'}</div>
<h3>10레벨까지 퀘스트 제출용 — 사서 내도 되는 것</h3><div class="chips">{any_chips or '<span class="muted">없음</span>'}</div>
<h3>은신처 1단계 — 인레이드 필요 (PVP)</h3><div class="chips">{hide_chips or '<span class="muted">없음</span>'}</div>
<p class="small muted" style="margin-top:8px">전체 퀘스트·은신처 기준 총량은 <a href="/guide/items/">필요 아이템 총정리</a>, 은신처 단계별 재료는 <a href="/guide/hideout/">은신처</a>에서 볼 수 있습니다.</p></section>

<h2 class="sec" id="s7">7. 초반 팁</h2>
<section class="box"><ul class="plain">
<li><b>인레이드(FiR) 표시</b>는 레이드에서 직접 주워 살아서 나온 아이템에만 붙습니다. 보험으로 돌아온 장비, 상인·플리에서 산 물건에는 없습니다.</li>
<li>1.1.0부터 상인 판매가는 평균 25% 오르고, 상인 매입가는 20% 내렸으며, 플리마켓 수수료는 3%에서 5%로 올랐습니다. 파는 곳을 고를 때 차이가 커졌습니다.</li>
<li>투어의 '3회 방문'·'인식표는 인레이드 불필요' 조건을 활용하면 장비가 부족한 초반에도 막힘 없이 맵을 열 수 있습니다.</li>
<li>프레스티지를 했다면 <a href="/guide/prestige/">프레스티지 조건·보상</a>도 확인하세요. PVE 1단계는 PVP보다 조건이 가볍습니다.</li>
<li>레이드 중에는 아이템에 마우스를 올리고 F2 — <a href="/?src=guide-start">시세 오버레이</a>가 이 아이템이 퀘스트·은신처에 필요한지, 얼마에 팔리는지 바로 보여 줍니다.</li></ul></section>
<p class="small muted">출처: 공식 위키 'Tour' 문서, 패치 노트 1.1.0(2026-08-03)·1.1.5(2026-09-08)·1.2.0(2026-10-06), tarkov.dev 퀘스트 데이터. 문장은 직접 정리했습니다.</p>"""
    path = "/guide/start/"
    title = "타르코프 초반 가이드 — 투어(Tour) 순서·상인/맵 해금·10레벨까지 퀘스트 | 탈콥 가이드"
    desc = "타르코프 새 캐릭터·프레스티지 직후 진행 순서: 투어로 스키어·메카닉·프라퍼·피스키퍼와 맵 여는 법, 사이드 퀘스트 묶음 해금, 예거·레프·등대지기 해금, 10레벨까지 퀘스트와 미리 모을 인레이드 아이템."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="start", crumbs=[("초반 가이드", None)])


# ─────────────────────────────────────────────────────────────
# 프레스티지
# ─────────────────────────────────────────────────────────────

def prestige_cond(ctx: Ctx, c: dict) -> str:
    ty = c.get("type")
    if ty == "playerLevel":
        return f'레벨 <b>{c.get("playerLevel") or c.get("count")}</b> 달성'
    if ty == "taskStatus" and c.get("task") in ctx.tasks:
        return f'{ctx.task_link(c["task"])} 완료'
    if ty == "taskStatus":
        return "특정 퀘스트 완료"
    if ty == "hideoutStation":
        sid = c.get("station") if not isinstance(c.get("station"), dict) else c["station"].get("id")
        return f'은신처 {ctx.station_link(sid, c.get("stationLevel") or c.get("count"))}'
    if ty == "skill":
        sk = c.get("skill")
        name = sk.get("name") if isinstance(sk, dict) else sk
        lvl = c.get("level") if c.get("level") is not None else (sk.get("level") if isinstance(sk, dict) else c.get("count"))
        return f'스킬 {e(ctx.skill_name(name))} <b>{lvl}</b>레벨'
    if ty == "haveItem":
        ids = c.get("items") or []
        return "창고에 " + ("".join(ctx.chip(i, c.get("count"), bool(c.get("foundInRaid"))) for i in ids[:1]) if ids else e(c.get("count"))) + " 보유"
    d = ctx.tk(c.get("description"), None)
    return e(d) if d and d != c.get("description") else e(ty)


def prestige_page(ctx: Ctx) -> tuple[str, str]:
    secs = []
    for label, plist in (("PVE", ctx.prestige_pve), ("PVP", ctx.prestige_reg)):
        rows = []
        for p in sorted(plist or [], key=lambda x: x.get("prestigeLevel") or 0):
            conds = "".join(f"<li>{prestige_cond(ctx, c)}</li>" for c in p.get("conditions") or [])
            rw = p.get("rewards") or {}
            rwp = []
            if rw.get("items"):
                rwp.append('<div class="chips">' + "".join(ctx.chip(x.get("item"), x.get("count")) for x in rw["items"]) + "</div>")
            if rw.get("skillLevelReward"):
                rwp.append(", ".join(f'{e(ctx.skill_name(x.get("skill")))} +{x.get("level")}' for x in rw["skillLevelReward"]))
            if rw.get("customization"):
                rwp.append(f'꾸미기 {len(rw["customization"])}개')
            if rw.get("traderStanding"):
                rwp.append(", ".join(f'{e(ctx.trader_name(x.get("trader")))} 평판 +{x.get("standing")}' for x in rw["traderStanding"]))
            tf = (p.get("transferSettings") or [{}])[0] or {}
            carry = f'{tf.get("gridWidth")}×{tf.get("gridHeight")}칸' if tf.get("gridWidth") else "—"
            img = f'<img src="{e(p.get("iconLink"))}" alt="" width="40" height="40" loading="lazy" />' if p.get("iconLink") else ""
            rows.append(f'<tr><td class="n">{img}<br><b>{p.get("prestigeLevel")}</b></td><td><ul class="plain">{conds}</ul></td>'
                        f'<td>{"<br>".join(rwp) or "—"}</td><td class="n small">{carry}</td></tr>')
        if rows:
            secs.append(f'<h2 class="sec" id="{label.lower()}">{label} 프레스티지 {len(rows)}단계</h2>'
                        '<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th class="n">단계</th><th>조건</th><th>보상</th><th class="n">이월 칸</th></tr></thead>'
                        f'<tbody>{"".join(rows)}</tbody></table></div>')
    body = (f'<h1>프레스티지 조건 총정리 <span class="h1en">Prestige</span></h1>'
            f'<p class="sub">PVE·PVP 단계별 조건과 보상 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note">프레스티지는 조건을 채운 고레벨 캐릭터가 진행도를 초기화하고 다시 시작하는 대신 고유 보상을 받는 시스템입니다. '
            '1.2.0(2026-10-06)부터 <b>PVE에도 6단계</b>가 생겼고, PVE 1단계는 PVP보다 조건이 가볍습니다. 초기화할 때 장비 일부와 스킬·무기 숙련도 일부(최대 50%)를 가져갈 수 있고, '
            '"이월 칸" 크기만큼 허용된 종류의 아이템을 옮길 수 있습니다. PVE 프레스티지는 PVE 캐릭터만 초기화합니다.</div>'
            f'<nav class="toc"><a href="#pve">PVE</a><a href="#pvp">PVP</a><a href="/guide/start/">초기화 뒤 초반 가이드 →</a></nav>'
            + "".join(secs)
            + '<p class="small muted">출처: tarkov.dev 프레스티지 데이터, 패치 노트 1.2.0. 시세 오버레이 v1.2.5는 PVE 프레스티지를 게임 로그로 자동 감지해 퀘스트 진행을 새로 시작합니다.</p>')
    path = "/guide/prestige/"
    title = "타르코프 프레스티지 조건 총정리 — PVE·PVP 단계별 요구사항과 보상 | 탈콥 가이드"
    desc = "타르코프 프레스티지 PVE 6단계·PVP 단계별 조건(레벨·퀘스트·은신처·스킬·보유 금액)과 보상, 초기화 때 가져가는 보관함 크기. 1.2.0 PVE 프레스티지 반영."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="prestige", crumbs=[("프레스티지", None)])


# ─────────────────────────────────────────────────────────────
# 맵 · 보스
# ─────────────────────────────────────────────────────────────

def _escort_txt(ctx: Ctx, esc_list):
    out = []
    for es in esc_list or []:
        counts = [a.get("count") for a in es.get("amount") or [] if a.get("count") is not None]
        rng = (f"{min(counts)}~{max(counts)}명" if counts and min(counts) != max(counts) else f"{counts[0]}명") if counts else ""
        out.append(f"{ctx.mob_name(es.get('mob'))} {rng}".strip())
    return ", ".join(out)


def map_quests(ctx: Ctx, mid: str) -> list[str]:
    out = []
    for tid, t in ctx.tasks.items():
        if mid in ctx.task_maps(t):
            out.append(tid)
    return out


def map_page(ctx: Ctx, mid: str) -> tuple[str, str]:
    m = ctx.maps[mid]
    slug = m.get("normalizedName")
    name = ctx.map_name(mid)
    en_name = slug.replace("-", " ").title()
    desc_ko = ctx._loc(ctx.loc_maps, m.get("description"), "")
    rows = [("레이드 시간", f'{m.get("raidDuration")}분' if m.get("raidDuration") else "—"),
            ("인원", e(m.get("players") or "—"))]
    lo_lv, hi_lv = m.get("minPlayerLevel") or 0, m.get("maxPlayerLevel") or 0
    if lo_lv > 0 or 0 < hi_lv < 79:  # 0~99·0~100은 사실상 제한 없음
        rows.append(("입장 레벨", f"{lo_lv}~{hi_lv} 레벨" if hi_lv else f"{lo_lv} 레벨 이상"))
    acc = _flat(m.get("accessKeys"))
    if acc:
        rows.append(("입장 아이템", '<div class="chips">' + "".join(ctx.chip(i) for i in acc) + "</div>"
                     + (f'<span class="muted small">{m.get("accessKeysMinPlayerLevel")}레벨 이상</span>' if m.get("accessKeysMinPlayerLevel") else "")))
    variants = [ctx.map_name(x) for x, mm in ctx.maps.items() if MAP_VARIANTS.get(mm.get("normalizedName")) == slug and mm.get("normalizedName") != "ground-zero-tutorial"]
    if variants:
        rows.append(("변형", ", ".join(e(v) for v in variants) + ' <span class="muted small">(같은 지역의 다른 판 — 보스·탈출구가 다를 수 있음)</span>'))
    boss_rows = []
    for b in m.get("bosses") or []:
        zones = ", ".join(e(ctx._loc(ctx.loc_maps, z.get("spawnKey"), z.get("name"))) for z in b.get("spawnLocations") or [])
        chance = b.get("spawnChance")
        boss_rows.append(f'<tr><td><b>{e(ctx.mob_name(b.get("mob")))}</b></td><td class="n">{fmt_int((chance or 0) * 100)}%</td>'
                         f'<td class="small">{zones}</td><td class="small">{e(_escort_txt(ctx, b.get("escorts")))}</td></tr>')
    ex_groups: dict[str, list] = {}
    for ex in m.get("extracts") or []:
        fac = ex.get("faction") or "shared"
        cond = []  # 이미 안전한 HTML 조각만 넣는다(칩 HTML을 다시 이스케이프하면 글자로 보인다)
        if ex.get("switches") or ex.get("switch"):
            cond.append("스위치·레버 작동 필요")
        ti = ex.get("transferItem")
        if ti:
            iid = (ti.get("item") or {}).get("id") if isinstance(ti.get("item"), dict) else ti.get("item")
            cost = ctx.money(iid, ti.get("count"))
            cond.append("유료 " + (e(cost) if cost else ctx.chip(iid, ti.get("count"))))
        ex_groups.setdefault(fac, []).append(f'<li><b>{e(ctx._loc(ctx.loc_maps, ex.get("name"), ex.get("name")))}</b>'
                                             + (f' <span class="muted small">{" · ".join(cond)}</span>' if cond else "") + "</li>")
    fac_label = {"pmc": "PMC", "scav": "스캐브", "shared": "공용(PMC·스캐브)"}
    ex_html = "".join(f'<div><h3>{fac_label.get(f, f)} <span class="muted small">{len(v)}개</span></h3><ul class="plain">{"".join(v)}</ul></div>'
                      for f, v in sorted(ex_groups.items(), key=lambda kv: ["pmc", "shared", "scav"].index(kv[0]) if kv[0] in ("pmc", "shared", "scav") else 9))
    tr_rows = []
    for tr in m.get("transits") or []:
        dest = tr.get("map")
        dest_id = dest.get("id") if isinstance(dest, dict) else dest
        tr_rows.append(f'<li>{e(ctx._loc(ctx.loc_maps, tr.get("description"), "이동"))} — {ctx.map_link(dest_id)}</li>')
    hz: dict[str, int] = {}
    for h in m.get("hazards") or []:
        hz[h.get("hazardType") or "hazard"] = hz.get(h.get("hazardType") or "hazard", 0) + 1
    hz_txt = ", ".join(f"{HAZARD.get(k, k)} {v}곳" for k, v in hz.items())
    extra = []
    if hz_txt:
        extra.append(("위험 지역", e(hz_txt)))
    if m.get("stationaryWeapons"):
        extra.append(("거치 화기", f'{len(m["stationaryWeapons"])}곳'))
    if m.get("btrStops"):
        extra.append(("BTR 정류장", f'{len(m["btrStops"])}곳'))
    if m.get("locks"):
        extra.append(("잠긴 곳", f'{len(m["locks"])}곳 — <a href="/guide/keys/">맵별 열쇠</a>에서 열쇠 목록 보기'))
    rows += extra
    qs = map_quests(ctx, mid)
    by_tr: dict[str, list] = {}
    for tid in qs:
        by_tr.setdefault(ctx.trader_slug(ctx.tasks[tid].get("trader")), []).append(tid)
    q_html = "".join(f'<div><h3>{e(ctx.trader_name(ctx.trader_by_slug.get(s)))} <span class="muted small">{len(v)}</span></h3><ul class="plain">'
                     + "".join(f"<li>{ctx.task_link(x)}</li>" for x in sorted(v, key=lambda x: ctx.task_names(x)[0])) + "</ul></div>"
                     for s, v in sorted(by_tr.items(), key=lambda kv: TRADER_ORDER.index(kv[0]) if kv[0] in TRADER_ORDER else 99))
    enemies = ", ".join(dict.fromkeys(e(ctx.mob_name(x)) for x in m.get("enemies") or [] if not str(x).startswith("follower")))
    body = (f'<h1>{e(name)} <span class="h1en">{e(en_name)}</span></h1>'
            f'<p class="sub">맵 정보 · 보스 {len(boss_rows)} · 탈출구 {len(m.get("extracts") or [])} · 관련 퀘스트 {len(qs)} · 데이터 기준 {e(ctx.stamp)}</p>'
            + (f'<p class="small muted">{e(desc_ko)}</p>' if desc_ko else "")
            + f'<section class="box"><h2>기본 정보</h2><table class="kv">{"".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows)}'
            + (f"<tr><th>등장 적</th><td class=small>{enemies}</td></tr>" if enemies else "") + "</table></section>"
            + (('<section class="box"><h2>보스</h2><div class="tbl"><table class="tot"><thead><tr><th>보스</th><th class="n">출현 확률</th><th>출현 위치</th><th>호위</th></tr></thead><tbody>'
                + "".join(boss_rows) + "</tbody></table></div></section>") if boss_rows else "")
            + (f'<section class="box"><h2>탈출구</h2><div class="cols3">{ex_html}</div><p class="small muted">조건(배낭 금지, 파라코드 등)은 데이터에 일부만 있습니다. 레이드 중 탈출구 목록을 꼭 확인하세요.</p></section>' if ex_html else "")
            + (f'<section class="box"><h2>다른 맵으로 이동(트랜짓)</h2><ul class="plain">{"".join(tr_rows)}</ul></section>' if tr_rows else "")
            + (f'<section class="box"><h2>이 맵의 퀘스트 {len(qs)}개</h2><div class="cols3">{q_html}</div></section>' if q_html else ""))
    path = f"/guide/maps/{slug}/"
    boss_names = ", ".join(dict.fromkeys(ctx.mob_name(b.get("mob")) for b in m.get("bosses") or []))
    title = f"타르코프 {name} 공략 정보 — 탈출구·보스·퀘스트 {len(qs)}개 | 탈콥 가이드"
    desc = f"타르코프 {name}({en_name}) 맵 정보: 레이드 {m.get('raidDuration')}분, {m.get('players')}명, 보스 {boss_names or '없음'}, 탈출구 {len(m.get('extracts') or [])}개, 트랜짓, 이 맵 퀘스트 {len(qs)}개. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="maps", crumbs=[("맵", "/guide/maps/"), (name, None)])


def main_maps(ctx: Ctx) -> list[str]:
    out = []
    for slug in MAP_ORDER:
        mid = ctx.map_by_slug.get(slug)
        if mid:
            out.append(mid)
    for mid, m in ctx.maps.items():
        s = m.get("normalizedName")
        if mid not in out and s not in MAP_VARIANTS and s not in MAP_ORDER:
            out.append(mid)
    return out


def maps_index(ctx: Ctx) -> tuple[str, str]:
    cards = []
    for mid in main_maps(ctx):
        m = ctx.maps[mid]
        bosses = ", ".join(dict.fromkeys(ctx.mob_name(b.get("mob")) for b in m.get("bosses") or [] if str(b.get("mob", "")).startswith("boss")))
        nq = len(map_quests(ctx, mid))
        cards.append(f'<a class="hub" href="/guide/maps/{e(m.get("normalizedName"))}/"><div class="t">{e(ctx.map_name(mid))}</div>'
                     f'<div class="d">레이드 {m.get("raidDuration") or "—"}분 · {e(m.get("players") or "—")}명 · 탈출구 {len(m.get("extracts") or [])}</div>'
                     f'<div class="d">보스: {e(bosses) or "없음"}</div><div class="d">퀘스트 {nq}개</div></a>')
    body = (f'<h1>맵 정보 <span class="h1en">Maps</span></h1><p class="sub">맵 {len(cards)}개 · 보스·탈출구·트랜짓·퀘스트 · 데이터 기준 {e(ctx.stamp)}</p>'
            f'<div class="cards">{"".join(cards)}</div>'
            '<p class="small muted">보스별로 모아 보려면 <a href="/guide/bosses/">보스 총정리</a>, 열쇠는 <a href="/guide/keys/">맵별 열쇠</a>.</p>')
    path = "/guide/maps/"
    title = "타르코프 맵 정보 총정리 — 보스 출현 확률·탈출구·퀘스트 | 탈콥 가이드"
    desc = "타르코프 전체 맵(세관·삼림·해안선·인터체인지·리저브·등대·시내·연구소·쇄빙선 등)의 레이드 시간, 인원, 보스 출현 확률, 탈출구, 트랜짓, 맵별 퀘스트."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="maps", crumbs=[("맵", None)])


BOSS_EXTRA = {"sectantPriest", "pmcBot", "exUsec"}


def bosses_page(ctx: Ctx) -> tuple[str, str]:
    agg: dict[str, dict] = {}
    for mid in main_maps(ctx) + [x for x, m in ctx.maps.items() if m.get("normalizedName") in MAP_VARIANTS and m.get("normalizedName") != "ground-zero-tutorial"]:
        m = ctx.maps[mid]
        for b in m.get("bosses") or []:
            mob = b.get("mob")
            if not mob or not (str(mob).startswith("boss") or mob in BOSS_EXTRA):
                continue
            a = agg.setdefault(mob, {"maps": [], "escorts": set()})
            zones = ", ".join(ctx._loc(ctx.loc_maps, z.get("spawnKey"), z.get("name")) for z in b.get("spawnLocations") or [])
            a["maps"].append((mid, b.get("spawnChance") or 0, zones))
            et = _escort_txt(ctx, b.get("escorts"))
            if et:
                a["escorts"].add(et)
    cards = []
    for mob, a in sorted(agg.items(), key=lambda kv: (not str(kv[0]).startswith("boss"), ctx.mob_name(kv[0]))):
        mb = ctx.mobs.get(mob) or {}
        hp = sum(h.get("max") or 0 for h in mb.get("health") or [])
        img = f'<img class="portrait" src="{e(mb.get("imagePortraitLink"))}" alt="" width="72" height="72" loading="lazy" />' if mb.get("imagePortraitLink") else ""
        lis = "".join(f'<li>{ctx.map_link(x)} <b>{fmt_int(c * 100)}%</b> <span class="muted small">{e(z)}</span></li>' for x, c, z in sorted(a["maps"], key=lambda r: -r[1]))
        cards.append(f'<section class="box boss">{img}<div><h2>{e(ctx.mob_name(mob))}</h2>'
                     + (f'<p class="small muted">체력 합계 {hp}</p>' if hp else "")
                     + f'<ul class="plain">{lis}</ul>'
                     + (f'<p class="small">호위: {e(" / ".join(sorted(a["escorts"])))}</p>' if a["escorts"] else "") + "</div></section>")
    body = (f'<h1>보스 총정리 <span class="h1en">Bosses</span></h1><p class="sub">보스·특수 적 {len(cards)}종 · 출현 맵과 확률 · 호위 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note">출현 확률은 레이드마다의 기본 확률이며, 이벤트 기간에는 크게 달라질 수 있습니다. 같은 보스가 맵의 여러 변형(야간 공장 등)에 따로 나오면 각각 표시합니다.</div>'
            f'<div class="bossgrid">{"".join(cards)}</div>')
    path = "/guide/bosses/"
    title = "타르코프 보스 총정리 — 출현 맵·확률·위치·호위·체력 | 탈콥 가이드"
    desc = f"타르코프 보스 {len(cards)}종(르샬라·킬라·타길라·세니타·글루하·슈트르만·카반·즈리야치 등)의 출현 맵, 출현 확률, 출현 위치, 호위 인원, 체력. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="bosses", crumbs=[("보스", None)])


# ─────────────────────────────────────────────────────────────
# 가이드 홈 + 전체 생성
# ─────────────────────────────────────────────────────────────

def hub_page(ctx: Ctx, counts: dict) -> tuple[str, str]:
    cards = [
        ("/guide/start/", "초반 가이드", "투어(Tour)로 상인·맵 여는 순서 · 10레벨까지 퀘스트 · 미리 모을 아이템", "처음·프레스티지 직후"),
        ("/guide/quests/", "퀘스트", "상인별 해금 순서 · 퀘스트마다 목표·필요템·열쇠·보상", f'{counts.get("quests", 0)}개'),
        ("/guide/items/", "필요 아이템 총정리", "퀘스트·은신처에 들어가는 아이템 총량 · 버리면 안 되는 템", f'{counts.get("items", 0)}종'),
        ("/guide/quest-items/", "퀘스트 전용 아이템", "레이드에서 찾는 퀘스트템 · 지도별", f'{counts.get("qitems", 0)}종'),
        ("/guide/hideout/", "은신처", "시설별 단계 재료·조건·효과·제작 · 남은 재료 계산기", f'{counts.get("stations", 0)}개 시설'),
        ("/guide/maps/", "맵 정보", "보스 출현 확률·탈출구·트랜짓·맵별 퀘스트", f'{counts.get("maps", 0)}개'),
        ("/guide/bosses/", "보스 총정리", "출현 맵·확률·위치·호위", f'{counts.get("bosses", 0)}종'),
        ("/guide/prestige/", "프레스티지", "PVE·PVP 단계별 조건과 보상", "1.2.0 PVE 반영"),
        ("/guide/kappa/", "카파템", "수집가(Collector) 제출 아이템 · 보유 체크", f'{counts.get("kappa", 0)}개'),
        ("/guide/keys/", "맵별 열쇠", "여는 곳·퀘스트 필요 키·시세", f'{counts.get("keys", 0)}개'),
    ]
    html_cards = "".join(f'<a class="hub" href="{href}"><div class="t">{e(t)}</div><div class="d">{e(d)}</div><div class="n2">{e(n)}</div></a>' for href, t, d, n in cards)
    body = (f'<h1>탈콥 가이드 <span class="h1en">타르코프 한국어 정리</span></h1>'
            f'<p class="sub">공개 게임 데이터로 만드는 한국어 정리 · 패치되면 자동 갱신 · 데이터 기준 {e(ctx.stamp)} · 게임 1.2.x</p>'
            f'<div class="cards">{html_cards}</div>'
            '<section class="box"><h2>이 가이드는</h2><p class="small">퀘스트 목표·아이템·은신처·맵 정보는 <a href="https://tarkov.dev" rel="noopener">tarkov.dev</a> 공개 데이터에서 자동으로 만들고, '
            '초반 진행·프레스티지 설명은 공식 위키와 패치 노트를 확인해 직접 정리했습니다. 보유·완료 체크는 이 브라우저에만 저장됩니다.</p></section>')
    title = "탈콥 가이드 — 타르코프 퀘스트·은신처·필요 아이템·맵·보스·카파템 한국어 정리"
    desc = "타르코프(Escape from Tarkov) 한국어 가이드: 초반 투어 진행, 전체 퀘스트 목표·필요템, 퀘스트·은신처 필요 아이템 총정리, 은신처 단계별 재료, 맵별 보스·탈출구, 프레스티지, 카파템, 맵별 열쇠."
    return "/guide/", page(ctx, path="/guide/", title=title, desc=desc, body=body, nav="", og_type="website")


def build_all(ctx: Ctx, out: Path, collector_ids: set, extra_counts: dict) -> list[str]:
    urls: list[str] = []
    # 퀘스트 상세
    for tid in ctx.tasks:
        p, h = quest_page(ctx, tid)
        write(out, p, h, urls)
    # 상인별
    by_tr: dict[str, list] = {}
    for tid, t in ctx.tasks.items():
        by_tr.setdefault(t.get("trader"), []).append(tid)
    for tr_id, tids in by_tr.items():
        if tr_id in ctx.traders:
            p, h = trader_page(ctx, tr_id, tids)
            write(out, p, h, urls)
    p, h = items_page(ctx, collector_ids)
    write(out, p, h, urls)
    items_n = h.count('<tr data-id="')
    p, h = quest_items_page(ctx)
    write(out, p, h, urls)
    qitems_n = h.count('class="card static"')
    unlock_map = craft_unlocks(ctx)
    for sid in ctx.hideout_reg:
        p, h = station_page(ctx, sid, unlock_map)
        write(out, p, h, urls)
    p, h = hideout_index(ctx)
    write(out, p, h, urls)
    p, h = start_page(ctx)
    write(out, p, h, urls)
    p, h = prestige_page(ctx)
    write(out, p, h, urls)
    for mid in main_maps(ctx):
        p, h = map_page(ctx, mid)
        write(out, p, h, urls)
    p, h = maps_index(ctx)
    write(out, p, h, urls)
    p, h = bosses_page(ctx)
    write(out, p, h, urls)
    bosses_n = h.count('class="box boss"')
    counts = {"quests": len(ctx.tasks), "items": items_n, "qitems": qitems_n, "stations": len(ctx.hideout_reg),
              "maps": len(main_maps(ctx)), "bosses": bosses_n, **extra_counts}
    p, h = hub_page(ctx, counts)
    write(out, p, h, urls)
    return urls
