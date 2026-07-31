"""json.tarkov.dev fallback source for when the GraphQL API is unavailable.

Background: tarkov.dev's GraphQL endpoint (api.tarkov.dev/graphql) had a
multi-day outage in 2026-07 returning HTTP 503 "GraphQL server unavailable"
(the-hideout/tarkov-api#474). During that window every price lookup failed.
The project's own maintainers pointed at json.tarkov.dev as the live fallback —
"tarkov.dev is based on this JSON API, not the GraphQL" — so this module fetches
the same catalog from there and reshapes it into the GraphQL item shape that
`tarkov_api._build_cache_entry` already consumes. That reuse means the price
card renders identically; only the barter/quest/craft/hideout ENRICHMENTS are
absent in fallback mode (those live in separate JSON datasets we intentionally
skip to keep the fallback lean and reliable — the core flea + trader prices,
caliber and dimensions all come through).

Shape reference (verified against live data 2026-07):
- `{mode}/items`        -> {data: {items: {id: {name<key>, shortName<key>,
                            avg24hPrice, low24hPrice, high24hPrice, lastLowPrice,
                            lastOfferCount, changeLast48hPercent, width, height,
                            weight, gridImageLink, types, properties{caliber},
                            containsItems[{item:id, count}],
                            sellToTrader[{trader:id, priceRUB}],
                            buyFromTrader[{trader:id, priceRUB, minTraderLevel}]}}}}
- `{mode}/items_{lang}` -> {data: {"<key>": "<localized string>"}}  (name lookup)
- `{mode}/traders`      -> {data: {id: {name<key>}}}
- `{mode}/traders_{lang}` -> {data: {"<key>": "<localized trader name>"}}
"""

import threading
import time

import requests

_JSON_BASE = "https://json.tarkov.dev"
# A real User-Agent — the GraphQL API's Cloudflare rate-limits the bare
# python-requests UA under load; the maintainers' own client sets one too.
_HEADERS = {"User-Agent": "tarkov-price-overlay-fallback"}

# The item catalog (prices + trader ids) is language-AGNOSTIC, so the ko/en ×
# regular/pve refresher would otherwise pull the ~15 MB items dump four times a
# cycle. Cache the raw docs per game_mode for a short window so sibling-language
# refreshes reuse them. Locale files (per lang) are small and fetched each time.
_RAW_TTL_SEC = 120
_raw_lock = threading.Lock()
_raw_cache: dict[str, tuple[float, dict]] = {}  # key: "<mode>/items" or "<mode>/traders"


def _get(path: str) -> dict:
    r = requests.get(f"{_JSON_BASE}/{path}", headers=_HEADERS, timeout=60)
    r.raise_for_status()
    return r.json()


def _get_cached(path: str) -> dict:
    now = time.time()
    with _raw_lock:
        hit = _raw_cache.get(path)
        if hit and (now - hit[0]) < _RAW_TTL_SEC:
            return hit[1]
    doc = _get(path)
    with _raw_lock:
        _raw_cache[path] = (now, doc)
    return doc


def _get_locale(path: str) -> dict:
    """Translation-key -> localized string map. Falls back to English on any
    failure (a missing/404 locale must not blank every name).

    Cached like the raw dumps: a refresh cycle resolves names for 4
    (lang, game_mode) combos and would otherwise re-download the same small
    locale files a dozen times per pass."""
    try:
        return (_get_cached(path) or {}).get("data") or {}
    except Exception:
        return {}


def _build_enrichments(mode: str, lang: str, en_loc: dict, item_loc: dict,
                       trader_name: dict) -> dict:
    """Reverse indexes so a lookup can answer "what else does this item do?".

    json.tarkov.dev serves these as separate flat datasets keyed by id, while
    `_build_cache_entry` expects them already attached per item in the GraphQL
    shape (bartersFor/bartersUsing/craftsFor/usedInTasks). We invert them once
    per refresh — a few hundred rows each, so the cost is negligible next to
    the item dump — and hand back per-item lists.

    Every dataset here is optional: a failure degrades that one panel to empty
    rather than losing the whole (far more valuable) price catalog.
    """
    def loc_name(key):
        if key is None:
            return None
        v = item_loc.get(key) or en_loc.get(key) or key
        return v.strip() if isinstance(v, str) else v

    out = {
        "barters_for": {},    # item_id -> [GraphQL bartersFor entries]
        "barters_using": {},  # item_id -> [GraphQL bartersUsing entries]
        "crafts_for": {},     # item_id -> [GraphQL craftsFor entries]
        "tasks_for": {},      # item_id -> [GraphQL usedInTasks entries]
        "hideout_index": {},  # item_id -> [{station, station_id, level, count, fir}]
        "stations": [],       # [{id, name, maxLevel}]
    }

    # Item id -> {name, shortName} for barter/craft ingredient lists.
    def item_ref(iid: str, items: dict) -> dict | None:
        it = items.get(iid)
        if not isinstance(it, dict):
            return None
        return {"name": loc_name(it.get("name")), "shortName": loc_name(it.get("shortName"))}

    items_doc = _get_cached(f"{mode}/items")
    items = ((items_doc.get("data") or {}).get("items")) or {}

    # ── tasks: names are translated, so pull the locale like items do ──
    task_name: dict[str, str] = {}
    try:
        tasks_doc = _get_cached(f"{mode}/tasks")
        tasks = ((tasks_doc.get("data") or {}).get("tasks")) or {}
        t_loc = _get_locale(f"{mode}/tasks_{lang}")
        t_en = t_loc if lang == "en" else _get_locale(f"{mode}/tasks_en")

        def t_name(key):
            v = t_loc.get(key) or t_en.get(key) or key
            return v.strip() if isinstance(v, str) else v

        for tid, task in tasks.items():
            if not isinstance(task, dict):
                continue
            nm = t_name(task.get("name"))
            task_name[tid] = nm
            # Objectives carry plain item-id strings; the entry builder expects
            # objects with an `id`, and only item-bearing objectives matter.
            objs = []
            referenced: set[str] = set()
            for o in task.get("objectives") or []:
                ids = o.get("items")
                if not isinstance(ids, list) or not ids:
                    continue
                objs.append({
                    "type": o.get("type") or "",
                    "count": o.get("count") or 0,
                    "foundInRaid": bool(o.get("foundInRaid")),
                    "items": [{"id": s} for s in ids if isinstance(s, str)],
                })
                referenced.update(s for s in ids if isinstance(s, str))
            if not referenced:
                continue
            entry = {
                "id": tid,
                "name": nm,
                "minPlayerLevel": task.get("minPlayerLevel") or 0,
                "kappaRequired": bool(task.get("kappaRequired")),
                "trader": {"name": trader_name.get(task.get("trader"), "")},
                "objectives": objs,
            }
            for iid in referenced:
                out["tasks_for"].setdefault(iid, []).append(entry)
    except Exception as e:
        print(f"[fallback] tasks enrichment skipped ({lang},{mode}): {e!r}")

    def task_unlock_ref(tid):
        if not tid:
            return None
        return {"id": tid, "name": task_name.get(tid, "")}

    # ── barters: offeredItem = what you get, requiredItems = what you pay ──
    try:
        barters = (_get_cached(f"{mode}/barters").get("data")) or []
        for b in barters:
            if not isinstance(b, dict):
                continue
            trader = {"name": trader_name.get(b.get("trader"), "?")}
            level = b.get("minTraderLevel") or 1
            unlock = task_unlock_ref(b.get("taskUnlock"))
            req = []
            for ri in b.get("requiredItems") or []:
                ref = item_ref(ri.get("item"), items)
                if ref:
                    req.append({"count": ri.get("count") or 1, "item": ref})
            offered = b.get("offeredItem") or {}
            oid = offered.get("item")
            # bartersFor: this barter yields the item
            if oid and req:
                out["barters_for"].setdefault(oid, []).append({
                    "trader": trader, "level": level, "taskUnlock": unlock,
                    "requiredItems": req,
                })
            # bartersUsing: the item is an ingredient → show what it buys
            oref = item_ref(oid, items) if oid else None
            if oref:
                reward = [{"count": offered.get("count") or 1, "item": oref}]
                for ri in b.get("requiredItems") or []:
                    iid = ri.get("item")
                    if iid:
                        out["barters_using"].setdefault(iid, []).append({
                            "trader": trader, "level": level, "taskUnlock": unlock,
                            "rewardItems": reward,
                        })
    except Exception as e:
        print(f"[fallback] barters enrichment skipped ({mode}): {e!r}")

    # ── hideout: station names are translated; also feeds craft station names ──
    station_name: dict[str, str] = {}
    try:
        h_data = (_get_cached(f"{mode}/hideout").get("data")) or {}
        h_loc = _get_locale(f"{mode}/hideout_{lang}")
        h_en = h_loc if lang == "en" else _get_locale(f"{mode}/hideout_en")

        def s_name(key):
            v = h_loc.get(key) or h_en.get(key) or key
            return v.strip() if isinstance(v, str) else v

        for sid, st in h_data.items():
            if not isinstance(st, dict):
                continue
            nm = s_name(st.get("name")) or "?"
            station_name[sid] = nm
            levels = st.get("levels") or []
            out["stations"].append({
                "id": sid, "name": nm,
                "maxLevel": max((lv.get("level") or 0 for lv in levels), default=0),
            })
            for lv in levels:
                level = lv.get("level") or 1
                for r in lv.get("itemRequirements") or []:
                    iid = r.get("item")
                    if not iid:
                        continue
                    attrs = r.get("attributes") or {}
                    out["hideout_index"].setdefault(iid, []).append({
                        "station": nm, "station_id": sid, "level": level,
                        "count": r.get("count") or 1,
                        "fir": bool(attrs.get("foundInRaid")),
                    })
        for needs in out["hideout_index"].values():
            needs.sort(key=lambda n: (n["station"], n["level"]))
        out["stations"].sort(key=lambda s: s["name"])
    except Exception as e:
        print(f"[fallback] hideout enrichment skipped ({lang},{mode}): {e!r}")

    # ── crafts: productItem = what the station makes ──
    try:
        crafts = (_get_cached(f"{mode}/crafts").get("data")) or []
        for c in crafts:
            if not isinstance(c, dict):
                continue
            product = (c.get("productItem") or {}).get("item")
            if not product:
                continue
            req = []
            for ri in c.get("requiredItems") or []:
                ref = item_ref(ri.get("item"), items)
                if ref:
                    req.append({"count": ri.get("count") or 1, "item": ref})
            if not req:
                continue
            sid = c.get("station")
            out["crafts_for"].setdefault(product, []).append({
                "station": {"id": sid or "", "name": station_name.get(sid, "?")},
                "level": c.get("level") or 1,
                "duration": c.get("duration") or 0,
                "requiredItems": req,
            })
    except Exception as e:
        print(f"[fallback] crafts enrichment skipped ({mode}): {e!r}")

    return out


def fetch_catalog(lang: str, game_mode: str) -> tuple[list[dict], dict, list[dict]]:
    """Fetch the whole catalog from json.tarkov.dev.

    Returns (items, hideout_index, station_list) where `items` are in the
    GraphQL shape `_build_cache_entry` reads — including the barter/quest/craft
    enrichments — and the hideout pair mirrors `_fetch_hideout_index` so the
    caller can serve the hideout panel too while GraphQL is unreachable.

    Raises on hard failure (items dump unreachable) so the caller keeps serving
    stale cache instead of overwriting it with nothing."""
    mode = "pve" if game_mode == "pve" else "regular"

    items_doc = _get_cached(f"{mode}/items")
    items = ((items_doc.get("data") or {}).get("items")) or {}
    if not items:
        raise RuntimeError("json.tarkov.dev returned no items")

    # Name/shortName/description are translation KEYS; resolve via the locale
    # file. English is the universal fallback for a missing locale.
    item_loc = _get_locale(f"{mode}/items_{lang}")
    if lang != "en":
        en_loc = _get_locale(f"{mode}/items_en")
    else:
        en_loc = item_loc

    def loc(key):
        if key is None:
            return None
        # Some json.tarkov.dev locale strings carry trailing whitespace
        # ("...돌격소총 "); the GraphQL names don't, so strip for exact-match
        # parity with the primary source (canon/fuzzy would otherwise absorb it).
        val = item_loc.get(key) or en_loc.get(key) or key
        return val.strip() if isinstance(val, str) else val

    # Trader id -> localized name (for sellFor/buyFor vendor labels).
    traders_doc = _get_cached(f"{mode}/traders")
    trader_loc = _get_locale(f"{mode}/traders_{lang}")
    if lang != "en":
        trader_en = _get_locale(f"{mode}/traders_en")
    else:
        trader_en = trader_loc
    trader_name: dict[str, str] = {}
    for tid, t in ((traders_doc.get("data") or {}).items()):
        nm = (t or {}).get("name")
        resolved = trader_loc.get(nm) or trader_en.get(nm) or nm or "?"
        trader_name[tid] = resolved.strip() if isinstance(resolved, str) else resolved

    # Barter / quest / craft / hideout panels. Best-effort: if these datasets
    # fail we still return prices (the previous "lean mode" behaviour).
    try:
        enrich = _build_enrichments(mode, lang, en_loc, item_loc, trader_name)
    except Exception as e:
        print(f"[fallback] enrichments unavailable ({lang},{mode}): {e!r}")
        enrich = {"barters_for": {}, "barters_using": {}, "crafts_for": {},
                  "tasks_for": {}, "hideout_index": {}, "stations": []}

    out: list[dict] = []
    for iid, it in items.items():
        if not isinstance(it, dict):
            continue
        props = it.get("properties") or {}
        gql_props: dict = {}
        if isinstance(props, dict) and props.get("caliber"):
            gql_props = {"__typename": "ItemPropertiesAmmo", "caliber": props["caliber"]}

        sell_for = []
        for s in it.get("sellToTrader") or []:
            tid = s.get("trader")
            if s.get("priceRUB") is None or not tid:
                continue
            sell_for.append({"vendor": {"name": trader_name.get(tid, "?")}, "priceRUB": s["priceRUB"]})

        buy_for = []
        for b in it.get("buyFromTrader") or []:
            tid = b.get("trader")
            if b.get("priceRUB") is None or not tid:
                continue
            buy_for.append({
                "vendor": {"name": trader_name.get(tid, "?"), "minTraderLevel": b.get("minTraderLevel") or 1},
                "priceRUB": b["priceRUB"],
            })

        # Ammo boxes carry no caliber themselves — the round inside does. Resolve
        # the contained round so the ammo matrix still triggers for pack lookups.
        contains = []
        for ci in it.get("containsItems") or []:
            inner_id = ci.get("item")
            inner = items.get(inner_id) if isinstance(inner_id, str) else None
            if not isinstance(inner, dict):
                continue
            ip = inner.get("properties") or {}
            ipr = {"__typename": "ItemPropertiesAmmo", "caliber": ip["caliber"]} if ip.get("caliber") else {}
            contains.append({
                "count": ci.get("count") or 1,
                "item": {
                    "id": inner_id,
                    "name": loc(inner.get("name")),
                    "shortName": loc(inner.get("shortName")),
                    "properties": ipr,
                },
            })

        out.append({
            "id": it.get("id") or iid,
            "name": loc(it.get("name")),
            "shortName": loc(it.get("shortName")),
            "width": it.get("width"),
            "height": it.get("height"),
            "weight": it.get("weight"),
            "gridImageLink": it.get("gridImageLink"),
            "wikiLink": it.get("wikiLink"),
            "types": it.get("types") or [],
            "properties": gql_props,
            "containsItems": contains,
            "avg24hPrice": it.get("avg24hPrice"),
            "low24hPrice": it.get("low24hPrice"),
            "high24hPrice": it.get("high24hPrice"),
            "lastLowPrice": it.get("lastLowPrice"),
            "lastOfferCount": it.get("lastOfferCount"),
            "changeLast48hPercent": it.get("changeLast48hPercent"),
            "sellFor": sell_for,
            "buyFor": buy_for,
            "bartersFor": enrich["barters_for"].get(iid, []),
            "bartersUsing": enrich["barters_using"].get(iid, []),
            "usedInTasks": enrich["tasks_for"].get(iid, []),
            "craftsFor": enrich["crafts_for"].get(iid, []),
        })

    if not out:
        raise RuntimeError("json.tarkov.dev fallback produced no usable items")
    return out, enrich["hideout_index"], enrich["stations"]
