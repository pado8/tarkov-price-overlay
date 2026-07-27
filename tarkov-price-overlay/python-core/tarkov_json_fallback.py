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
    failure (a missing/404 locale must not blank every name)."""
    try:
        return (_get(path) or {}).get("data") or {}
    except Exception:
        return {}


def fetch_catalog(lang: str, game_mode: str) -> list[dict]:
    """Fetch the whole catalog from json.tarkov.dev and return it as a list of
    items in the GraphQL shape `_build_cache_entry` reads. Raises on hard
    failure (items dump unreachable) so the caller keeps serving stale cache
    instead of overwriting it with nothing."""
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
            # Enrichments unavailable in lean fallback mode — the card degrades
            # gracefully (price shows; barter/quest/craft/hideout panels hide).
            "bartersFor": [],
            "bartersUsing": [],
            "usedInTasks": [],
            "craftsFor": [],
        })

    if not out:
        raise RuntimeError("json.tarkov.dev fallback produced no usable items")
    return out
