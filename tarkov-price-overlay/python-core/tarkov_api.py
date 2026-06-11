import difflib
import re
import threading
import time

import requests

TARKOV_API_URL = "https://api.tarkov.dev/graphql"

# Background bulk-cache configuration. The whole tarkov.dev item catalog
# (per language × per game mode) is fetched periodically so that /lookup
# becomes a hashmap lookup + an optional fuzzy match - no per-item network
# round-trip on the hot path.
CACHE_TTL_SEC = 600  # 10 min
REFRESH_RETRY_BACKOFF_SEC = 30  # transient failure cool-down

_QUERY_BY_NAME = """
query ItemByName($name: String!, $lang: LanguageCode, $gameMode: GameMode) {
  items(name: $name, lang: $lang, gameMode: $gameMode) {
    id
    name
    shortName
    width
    height
    weight
    gridImageLink
    types
    properties {
      __typename
      ... on ItemPropertiesAmmo { caliber }
      ... on ItemPropertiesWeapon { caliber }
    }
    containsItems {
      count
      item {
        properties {
          __typename
          ... on ItemPropertiesAmmo { caliber }
        }
      }
    }
    avg24hPrice
    low24hPrice
    high24hPrice
    lastLowPrice
    lastOfferCount
    changeLast48hPercent
    sellFor {
      priceRUB
      vendor { name }
    }
    bartersFor {
      trader { name }
      level
      requiredItems {
        count
        item { name shortName }
      }
    }
    bartersUsing {
      trader { name }
      level
      rewardItems {
        count
        item { name shortName }
      }
    }
    buyFor {
      priceRUB
      vendor {
        name
        ... on TraderOffer { minTraderLevel }
      }
    }
    usedInTasks {
      id
      name
      minPlayerLevel
      kappaRequired
      trader { name }
      objectives {
        ... on TaskObjectiveItem {
          type
          count
          foundInRaid
          items { id }
        }
      }
    }
    craftsFor {
      station { name }
      level
      duration
      requiredItems {
        count
        item { name shortName }
      }
    }
  }
}
"""

_QUERY_ALL_NAMES = """
query AllNames($lang: LanguageCode) {
  items(lang: $lang) {
    name
  }
}
"""

# Hideout station upgrade requirements. We invert this into
# {item_id -> [{station, level, count}]} so a per-item lookup can answer
# "is this needed for a hideout upgrade?" without re-walking 26 stations.
_QUERY_HIDEOUT_STATIONS = """
query HideoutReqs($lang: LanguageCode) {
  hideoutStations(lang: $lang) {
    id
    name
    levels {
      level
      itemRequirements {
        count
        item { id }
      }
    }
  }
}
"""

# All ammunition with the stats the matrix panel needs. Tarkov.dev returns
# ~195 rounds across ~30 calibers — small enough to ship the full payload
# to the frontend once at startup and let it filter client-side.
# Localized name/shortName fall back to English; lang is supported here.
_QUERY_AMMO = """
query AllAmmo($lang: LanguageCode) {
  ammo(lang: $lang) {
    item { id name shortName }
    caliber
    penetrationPower
    damage
    fragmentationChance
    armorDamage
    accuracyModifier
  }
}
"""

_QUERY_ALL_PRICED = """
query AllItems($lang: LanguageCode, $gameMode: GameMode) {
  items(lang: $lang, gameMode: $gameMode) {
    id
    name
    shortName
    width
    height
    weight
    gridImageLink
    types
    properties {
      __typename
      ... on ItemPropertiesAmmo { caliber }
      ... on ItemPropertiesWeapon { caliber }
    }
    containsItems {
      count
      item {
        properties {
          __typename
          ... on ItemPropertiesAmmo { caliber }
        }
      }
    }
    avg24hPrice
    low24hPrice
    high24hPrice
    lastLowPrice
    lastOfferCount
    changeLast48hPercent
    sellFor {
      priceRUB
      vendor { name }
    }
    bartersFor {
      trader { name }
      level
      requiredItems {
        count
        item { name shortName }
      }
    }
    bartersUsing {
      trader { name }
      level
      rewardItems {
        count
        item { name shortName }
      }
    }
    buyFor {
      priceRUB
      vendor {
        name
        ... on TraderOffer { minTraderLevel }
      }
    }
    usedInTasks {
      id
      name
      minPlayerLevel
      kappaRequired
      trader { name }
      objectives {
        ... on TaskObjectiveItem {
          type
          count
          foundInRaid
          items { id }
        }
      }
    }
    craftsFor {
      station { name }
      level
      duration
      requiredItems {
        count
        item { name shortName }
      }
    }
  }
}
"""

_names_cache: dict[str, list[str]] = {}
_names_lock = threading.Lock()

# (lang, game_mode) -> {item_name: entry_dict}
_price_cache: dict[tuple[str, str], dict[str, dict]] = {}
_price_cache_ts: dict[tuple[str, str], float] = {}
# (lang, game_mode) -> {canonical_name: entry | None}. None marks an
# AMBIGUOUS canonical form (two different items fold to the same key) —
# never used for matching. See _canon().
_canon_cache: dict[tuple[str, str], dict[str, dict | None]] = {}
_price_cache_lock = threading.Lock()
_refresher_started = False
_refresher_lock = threading.Lock()

# lang -> {item_id -> [{"station": str, "level": int, "count": int}, ...]}
# Station names are localized (depend on lang); item ids are not. Cached
# per lang so each catalog refresh re-uses the matching index.
_hideout_index_cache: dict[str, dict[str, list[dict]]] = {}
_hideout_station_list_cache: dict[str, list[dict]] = {}
_hideout_index_lock = threading.Lock()

# lang -> {"calibers": {caliber_key: {display, rounds: [...]}}}
# Same lifecycle as the hideout index: refreshed alongside the catalog,
# served from cache for /ammo endpoint and inline lookup hints.
_ammo_cache: dict[str, dict] = {}
_ammo_cache_lock = threading.Lock()


# Map tarkov.dev's CamelCase caliber id ("Caliber545x39") to the
# human-readable display string ("5.45x39"). Falls back to stripping the
# "Caliber" prefix if no specific rule matches, so future calibers don't
# silently get hidden.
def _caliber_display(raw: str) -> str:
    if not raw:
        return ""
    s = raw[len("Caliber"):] if raw.startswith("Caliber") else raw
    # Common shapes: "545x39", "556x45NATO", "762x54R", "12g", "127x55",
    # "9x18PM", "366TKM", "40x46", "1143x23ACP".
    overrides = {
        "1143x23ACP": ".45 ACP",
        "9x18PM":     "9x18 PM",
        "9x18PMM":    "9x18 PMM",
        "9x19PARA":   "9x19",
        "9x21":       "9x21",
        "9x33R":      ".357",
        "9x39":       "9x39",
        "10x25ECDC":  "10x25",
        "127x33":     "12.7x33",
        "127x55":     "12.7x55",
        "127x99":     ".50 BMG",
        "12g":        "12 gauge",
        "20g":        "20 gauge",
        "20x1mm":     "20x1mm",
        "23x75":      "23x75",
        "26x75":      "26x75",
        "366TKM":     ".366 TKM",
        "40mmRU":     "40mm RU",
        "40x46":      "40x46",
        "46x30":      "4.6x30",
        "545x39":     "5.45x39",
        "556x45NATO": "5.56x45 NATO",
        "57x28":      "5.7x28",
        "68x51":      "6.8x51",
        "762x25TT":   "7.62x25 TT",
        "762x35":     "7.62x35 (.300 BLK)",
        "762x39":     "7.62x39",
        "762x51":     "7.62x51",
        "762x54R":    "7.62x54R",
        "784x49":     ".308 ME",
        "86x70":      ".338 LM",
        "93x64":      "9.3x64",
    }
    if s in overrides:
        return overrides[s]
    # Dynamic fallback for NEW calibers not yet in the override map (so a game
    # patch's new ammo shows e.g. "7.62x51" instead of the raw "762x51" and
    # never needs a manual code edit). Only reshapes the clean "<bore>x<case>"
    # pattern; irregular shapes (12g, 366TKM, …) fall through unchanged.
    m = re.match(r"^(\d+)x(.+)$", s)
    if m:
        bore, rest = m.group(1), m.group(2)
        if len(bore) == 2:        # 57  -> 5.7
            bore = f"{bore[0]}.{bore[1]}"
        elif len(bore) == 3:      # 762 -> 7.62 ; 545 -> 5.45 ; 127 -> 12.7
            # The 12.7mm family (127xNN) is the lone XY.Z exception; every
            # other 3-digit bore is X.YZ.
            bore = (
                f"{bore[:2]}.{bore[2]}"
                if bore.startswith("12")
                else f"{bore[0]}.{bore[1:]}"
            )
        elif len(bore) >= 4:      # 1143 -> 11.43
            bore = f"{bore[:-2]}.{bore[-2:]}"
        # 1 digit (9x19) stays as-is
        return f"{bore}x{rest}"
    return s


def _fetch_ammo(lang: str) -> dict:
    """Pulls every ammo entry from tarkov.dev and groups by caliber.
    Returns {"calibers": {caliber_raw: {display, rounds: [...]}}}.
    Empty dict on any failure so the frontend can degrade gracefully."""
    try:
        response = requests.post(
            TARKOV_API_URL,
            json={"query": _QUERY_AMMO, "variables": {"lang": lang}},
            timeout=20,
        )
        response.raise_for_status()
        rows = (response.json().get("data") or {}).get("ammo") or []
    except Exception as e:
        print(f"[ammo] fetch failed for lang={lang}: {e!r}")
        return {"calibers": {}}

    by_caliber: dict[str, dict] = {}
    for r in rows:
        cal = r.get("caliber") or ""
        if not cal:
            continue
        item = r.get("item") or {}
        round_entry = {
            "id": item.get("id"),
            "name": item.get("name") or "?",
            "short_name": item.get("shortName") or item.get("name") or "?",
            "penetration": r.get("penetrationPower") or 0,
            "damage": r.get("damage") or 0,
            "fragmentation": r.get("fragmentationChance") or 0.0,
            "armor_damage": r.get("armorDamage") or 0,
            "accuracy_mod": r.get("accuracyModifier") or 0.0,
        }
        slot = by_caliber.setdefault(
            cal, {"display": _caliber_display(cal), "rounds": []}
        )
        slot["rounds"].append(round_entry)

    # Sort each caliber's rounds by penetration descending — that's the
    # "best round" ordering players want to scan first.
    for slot in by_caliber.values():
        slot["rounds"].sort(key=lambda r: r["penetration"], reverse=True)

    return {"calibers": by_caliber}


def get_ammo(lang: str) -> dict:
    """Cached read for the /ammo endpoint. Populates on first call."""
    with _ammo_cache_lock:
        cached = _ammo_cache.get(lang)
    if cached is not None:
        return cached
    data = _fetch_ammo(lang)
    with _ammo_cache_lock:
        _ammo_cache[lang] = data
    return data


# OCR-confusion folding for the canonical-match fallback. Both the query and
# every catalog name are folded the same way, so "M8SS" and "M855" land on
# the same key. EXACT match on the folded form only — no fuzzy — so the
# false-positive risk is limited to genuinely ambiguous folds, which the
# index marks as None and never matches.
_CANON_TABLE = str.maketrans(
    {
        "0": "o",
        "1": "l",
        "i": "l",
        "|": "l",
        "5": "s",
        "8": "b",
        "6": "g",
        "2": "z",
    }
)


def _canon(s: str) -> str:
    return "".join(s.lower().translate(_CANON_TABLE).split())


_FLEA_MARKET_NAMES = {"Flea Market", "플리마켓", "Барахолка", "跳蚤市场", "蚤の市"}


def _is_flea(vendor_name: str) -> bool:
    return vendor_name in _FLEA_MARKET_NAMES


def _fetch_hideout_index(lang: str) -> tuple[dict[str, list[dict]], list[dict]]:
    """One GraphQL call → (item_index, station_list).
    item_index: {item_id: [{station, station_id, level, count}]}
    station_list: [{id, name, maxLevel}] sorted by name.
    Returns ({}, []) on failure so callers keep serving stale data."""
    response = requests.post(
        TARKOV_API_URL,
        json={"query": _QUERY_HIDEOUT_STATIONS, "variables": {"lang": lang}},
        timeout=20,
    )
    response.raise_for_status()
    stations = response.json().get("data", {}).get("hideoutStations", []) or []
    index: dict[str, list[dict]] = {}
    station_list: list[dict] = []
    for s in stations:
        sid = s.get("id") or ""
        sname = s.get("name") or "?"
        levels = s.get("levels") or []
        max_level = max((lv.get("level") or 0 for lv in levels), default=0)
        station_list.append({"id": sid, "name": sname, "maxLevel": max_level})
        for lv in levels:
            level = lv.get("level") or 1
            for r in lv.get("itemRequirements") or []:
                inner = r.get("item") or {}
                iid = inner.get("id")
                if not iid:
                    continue
                index.setdefault(iid, []).append(
                    {
                        "station": sname,
                        "station_id": sid,
                        "level": level,
                        "count": r.get("count") or 1,
                    }
                )
    for needs in index.values():
        needs.sort(key=lambda n: (n["station"], n["level"]))
    station_list.sort(key=lambda s: s["name"])
    return index, station_list


def _get_hideout_index(lang: str) -> dict[str, list[dict]]:
    """Cached read; populates on first miss. Empty dict on fetch failure."""
    with _hideout_index_lock:
        cached = _hideout_index_cache.get(lang)
    if cached is not None:
        return cached
    try:
        idx, station_list = _fetch_hideout_index(lang)
    except Exception as e:
        print(f"[hideout] cold fetch failed for lang={lang}: {e!r}")
        idx, station_list = {}, []
    with _hideout_index_lock:
        _hideout_index_cache[lang] = idx
        _hideout_station_list_cache[lang] = station_list
    return idx


def get_station_list(lang: str) -> list[dict]:
    """Return [{id, name, maxLevel}] for all hideout stations, sorted by name.

    Does NOT rely on _get_hideout_index as a side-effect because that function
    returns early on index cache-hit without touching the station-list cache.
    Instead we fetch directly when the station list is missing or empty
    (empty means a prior fetch failed — treat it as uncached so we retry)."""
    with _hideout_index_lock:
        cached = _hideout_station_list_cache.get(lang)
    if cached:  # truthy: non-empty list means we have real data
        return cached
    try:
        idx, station_list = _fetch_hideout_index(lang)
        with _hideout_index_lock:
            _hideout_index_cache[lang] = idx
            _hideout_station_list_cache[lang] = station_list
        return station_list
    except Exception as e:
        print(f"[hideout] station list fetch failed for lang={lang}: {e!r}")
        return []


def _build_cache_entry(item: dict, hideout_idx: dict[str, list[dict]]) -> dict:
    sell_for_all = item.get("sellFor", []) or []
    trader_entries = [
        {"name": s["vendor"]["name"], "price": s["priceRUB"]}
        for s in sell_for_all
        if not _is_flea(s["vendor"]["name"]) and s.get("priceRUB") is not None
    ]
    trader_entries.sort(key=lambda e: e["price"], reverse=True)

    # Flatten bartersFor: [{trader, level, items: [{name, short_name, count}]}]
    barters: list[dict] = []
    for b in item.get("bartersFor", []) or []:
        items_list = []
        for ri in b.get("requiredItems", []) or []:
            inner = ri.get("item") or {}
            if inner.get("name"):
                items_list.append(
                    {
                        "name": inner["name"],
                        "short_name": inner.get("shortName"),
                        "count": ri.get("count") or 1,
                    }
                )
        if not items_list:
            continue
        trader = b.get("trader") or {}
        barters.append(
            {
                "trader": trader.get("name") or "?",
                "level": b.get("level") or 1,
                "items": items_list,
            }
        )

    # Quest references — for each task, find which objectives reference this
    # specific item (by id) and aggregate count + FiR requirement.
    #   - giveItem / findItem: paired objectives (find then hand in) — use max
    #     so we don't double-count.
    #   - plantItem: each is a separate drop point — sum.
    #   - Any matching objective with foundInRaid=True flips the task's FiR.
    item_id = item.get("id")
    used_in_tasks = []
    for t in item.get("usedInTasks", []) or []:
        if not t.get("name"):
            continue
        max_carry = 0  # findItem / giveItem (paired)
        sum_plant = 0  # plantItem (separate)
        fir = False
        for obj in t.get("objectives", []) or []:
            obj_items = obj.get("items") or []
            if not any(oi.get("id") == item_id for oi in obj_items):
                continue
            cnt = obj.get("count") or 0
            otype = obj.get("type") or ""
            if obj.get("foundInRaid"):
                fir = True
            if otype == "plantItem":
                sum_plant += cnt
            else:  # giveItem, findItem, fallback
                if cnt > max_carry:
                    max_carry = cnt
        total = max_carry + sum_plant
        if total <= 0:
            # Item appeared in usedInTasks but no item-objective matched it
            # (e.g. it's referenced indirectly). Still surface the task so
            # the user sees the "used in quest" hint, just without a count.
            total = None
        trader = t.get("trader") or {}
        used_in_tasks.append(
            {
                "id": t.get("id"),
                "name": t["name"],
                "trader": trader.get("name") or "",
                "min_level": t.get("minPlayerLevel") or 0,
                "count": total,
                "fir": fir,
                # Kappa flag drives the loot-tier badge (B vs A): Kappa-required
                # tasks boost the item to at least A even at low ₽/slot.
                "kappa_required": bool(t.get("kappaRequired")),
            }
        )

    # bartersUsing: barters where THIS item is a required ingredient. Show
    # only the reward side — user already has this item, they want to know
    # what comes out.
    barters_using: list[dict] = []
    for b in item.get("bartersUsing", []) or []:
        rewards = []
        for ri in b.get("rewardItems", []) or []:
            inner = ri.get("item") or {}
            if inner.get("name"):
                rewards.append(
                    {
                        "name": inner["name"],
                        "short_name": inner.get("shortName"),
                        "count": ri.get("count") or 1,
                    }
                )
        if not rewards:
            continue
        trader = b.get("trader") or {}
        barters_using.append(
            {
                "trader": trader.get("name") or "?",
                "level": b.get("level") or 1,
                "rewards": rewards,
            }
        )

    # buyFor: cash purchase offers (traders only — Flea Market is already
    # captured by flea_price). minTraderLevel is the rep gate.
    buy_for: list[dict] = []
    for b in item.get("buyFor", []) or []:
        vendor = b.get("vendor") or {}
        vname = vendor.get("name") or ""
        if _is_flea(vname) or b.get("priceRUB") is None:
            continue
        buy_for.append(
            {
                "name": vname,
                "price": b["priceRUB"],
                "min_level": vendor.get("minTraderLevel") or 1,
            }
        )
    buy_for.sort(key=lambda e: e["price"])

    # Hideout production recipes that produce THIS item (item is the reward).
    crafts_for: list[dict] = []
    for c in item.get("craftsFor", []) or []:
        items_list = []
        for ri in c.get("requiredItems", []) or []:
            inner = ri.get("item") or {}
            if inner.get("name"):
                items_list.append(
                    {
                        "name": inner["name"],
                        "short_name": inner.get("shortName"),
                        "count": ri.get("count") or 1,
                    }
                )
        if not items_list:
            continue
        station = c.get("station") or {}
        crafts_for.append(
            {
                "station": station.get("name") or "?",
                "level": c.get("level") or 1,
                "duration_sec": c.get("duration") or 0,
                "items": items_list,
            }
        )

    # Hideout upgrades that need this item. Pre-sorted by station/level inside
    # _fetch_hideout_index, so list order is stable across calls.
    needed_for_hideout = list(hideout_idx.get(item.get("id") or "", []))

    # Caliber for ammo/weapons — drives the inline Ammo Matrix panel on the
    # frontend. None for everything else, in which case the panel is hidden.
    # Ammo *boxes* don't have caliber on their own properties (the type is
    # `null` from the API) but their containsItems[0] is the round they
    # hold, which does carry caliber. Treat the box as if it has the
    # round's caliber so the matrix shows up for the common "I picked up
    # an ammo pack, is this any good?" lookup.
    props = item.get("properties") or {}
    caliber_raw = props.get("caliber") if isinstance(props, dict) else None
    if not caliber_raw and "ammoBox" in (item.get("types") or []):
        for ci in item.get("containsItems") or []:
            inner_props = (ci.get("item") or {}).get("properties") or {}
            if isinstance(inner_props, dict) and inner_props.get("caliber"):
                caliber_raw = inner_props["caliber"]
                break
    caliber_display = _caliber_display(caliber_raw) if caliber_raw else None

    return {
        "id": item.get("id"),
        "name": item["name"],
        "short_name": item.get("shortName"),
        "width": item.get("width"),
        "height": item.get("height"),
        "weight": item.get("weight"),
        "icon": item.get("gridImageLink"),
        "flea": item.get("avg24hPrice"),
        "flea_low_24h": item.get("low24hPrice"),
        "flea_high_24h": item.get("high24hPrice"),
        "flea_last_low": item.get("lastLowPrice"),
        "flea_last_offer_count": item.get("lastOfferCount"),
        "flea_change_48h_pct": item.get("changeLast48hPercent"),
        "trader": trader_entries[0]["price"] if trader_entries else None,
        "sell_for": trader_entries,
        "barters_for": barters,
        "barters_using": barters_using,
        "buy_for": buy_for,
        "used_in_tasks": used_in_tasks,
        "crafts_for": crafts_for,
        "needed_for_hideout": needed_for_hideout,
        "caliber": caliber_raw,
        "caliber_display": caliber_display,
    }


def _refresh_one(lang: str, game_mode: str) -> int:
    response = requests.post(
        TARKOV_API_URL,
        json={
            "query": _QUERY_ALL_PRICED,
            "variables": {"lang": lang, "gameMode": game_mode},
        },
        timeout=30,
    )
    response.raise_for_status()
    items = response.json().get("data", {}).get("items", []) or []
    # Refresh the lang's hideout index alongside prices so cached entries
    # always have the latest "needed for upgrade" mapping baked in.
    try:
        hideout_idx, station_list = _fetch_hideout_index(lang)
        with _hideout_index_lock:
            _hideout_index_cache[lang] = hideout_idx
            _hideout_station_list_cache[lang] = station_list
    except Exception as e:
        print(f"[hideout] refresh failed for lang={lang}: {e!r} - using stale/empty")
        with _hideout_index_lock:
            hideout_idx = _hideout_index_cache.get(lang, {})
    by_name: dict[str, dict] = {}
    for it in items:
        name = it.get("name")
        if not name:
            continue
        entry = _build_cache_entry(it, hideout_idx)
        by_name[name] = entry
        # Alias by shortName too so ground-pickup OCR ("SALEWA") matches the
        # same entry as the full inventory name ("Salewa first aid kit"). The
        # full name takes priority on collisions; aliases are first-write-wins.
        short = (it.get("shortName") or "").strip()
        if short and short != name and short not in by_name:
            by_name[short] = entry
    # Canonical (OCR-confusion-folded) index for the last-resort exact match.
    # Built once per refresh so the hot path pays a single dict lookup.
    canon_map: dict[str, dict | None] = {}
    for n, entry in by_name.items():
        key = _canon(n)
        if not key:
            continue
        prev = canon_map.get(key)
        if prev is None and key in canon_map:
            continue  # already marked ambiguous
        if prev is not None and prev is not entry:
            canon_map[key] = None  # two items collide → ambiguous, never match
        else:
            canon_map[key] = entry
    with _price_cache_lock:
        _price_cache[(lang, game_mode)] = by_name
        _canon_cache[(lang, game_mode)] = canon_map
        _price_cache_ts[(lang, game_mode)] = time.time()
    # Reuse the populated names for fuzzy matching too (one source of truth).
    with _names_lock:
        _names_cache[lang] = list(by_name.keys())
    print(f"[cache] refreshed ({lang},{game_mode}) - {len(by_name)} items")
    return len(by_name)


def _refresher_loop() -> None:
    """Periodic warm-up + refresh of all (lang, game_mode) catalogs."""
    while True:
        for lang in ("ko", "en"):
            for game_mode in ("regular", "pve"):
                try:
                    _refresh_one(lang, game_mode)
                except Exception as e:
                    print(f"[cache] refresh ({lang},{game_mode}) failed: {e!r}")
                    time.sleep(REFRESH_RETRY_BACKOFF_SEC)
                    continue
                # Tiny gap between calls so we don't slam tarkov.dev.
                time.sleep(1)
        # Invalidate the ammo cache after each catalog refresh so newly
        # released calibers (game-patch additions) get picked up within the
        # CACHE_TTL_SEC window. Without this, the React-side caliber
        # re-fetch hits the same stale dict every time and never sees new
        # calibers until the process restarts. Lang-keyed clear is enough
        # since _fetch_ammo is per-lang.
        with _ammo_cache_lock:
            _ammo_cache.clear()
            print("[ammo] cache invalidated for next /ammo fetch")
        time.sleep(CACHE_TTL_SEC)


def start_background_refresher() -> None:
    """Idempotent - call from FastAPI lifespan to warm + keep cache fresh."""
    global _refresher_started
    with _refresher_lock:
        if _refresher_started:
            return
        _refresher_started = True
    t = threading.Thread(target=_refresher_loop, daemon=True, name="price-cache-refresher")
    t.start()
    print("[cache] background refresher started")


def _load_all_names(lang: str) -> list[str]:
    with _names_lock:
        if lang in _names_cache:
            return _names_cache[lang]
        try:
            response = requests.post(
                TARKOV_API_URL,
                json={"query": _QUERY_ALL_NAMES, "variables": {"lang": lang}},
                timeout=20,
            )
            response.raise_for_status()
            items = response.json().get("data", {}).get("items", [])
            names = [it["name"] for it in items if it.get("name")]
            _names_cache[lang] = names
            print(f"[tarkov_api] cached {len(names)} item names for lang={lang}")
            return names
        except Exception as e:
            print(f"[tarkov_api] failed to load all names for lang={lang}: {e!r}")
            _names_cache[lang] = []
            return []


def _find_closest_name(text: str, lang: str, cutoff: float = 0.6) -> str | None:
    names = _load_all_names(lang)
    if not names:
        return None
    matches = difflib.get_close_matches(text, names, n=1, cutoff=cutoff)
    return matches[0] if matches else None


def _query_by_name(name: str, lang: str, game_mode: str) -> list[dict]:
    response = requests.post(
        TARKOV_API_URL,
        json={
            "query": _QUERY_BY_NAME,
            "variables": {"name": name, "lang": lang, "gameMode": game_mode},
        },
        timeout=10,
    )
    response.raise_for_status()
    return response.json().get("data", {}).get("items", [])


def _empty_result(matched_from: str | None = None) -> dict:
    return {
        "id": None,
        "name": None,
        "short_name": None,
        "width": None,
        "height": None,
        "weight": None,
        "icon": None,
        "flea": None,
        "flea_low_24h": None,
        "flea_high_24h": None,
        "flea_last_low": None,
        "flea_last_offer_count": None,
        "flea_change_48h_pct": None,
        "trader": None,
        "sell_for": [],
        "barters_for": [],
        "barters_using": [],
        "buy_for": [],
        "used_in_tasks": [],
        "crafts_for": [],
        "needed_for_hideout": [],
        "caliber": None,
        "caliber_display": None,
        "matched_from": matched_from,
    }


def _cache_lookup(
    item_name: str, lang: str, game_mode: str, matched_from: str | None
) -> dict | None:
    """Hot-path cache hit (exact + fuzzy). Returns a result dict ready to
    return, or None if cache is empty / no fuzzy hit either. Even stale
    caches are served - the background refresher will eventually update."""
    cache = _price_cache.get((lang, game_mode))
    if not cache:
        return None

    # Exact hit
    entry = cache.get(item_name)
    if entry:
        return {**entry, "matched_from": matched_from}

    # Fuzzy match against cached names. Re-use the pre-built names list
    # populated by _refresh_one() so we don't rebuild list(cache.keys())
    # (~5k entries) on every fuzzy fallback. Falls back to the live keys
    # view when the names cache is empty (cold cache path).
    with _names_lock:
        names = _names_cache.get(lang)
    if not names:
        names = list(cache.keys())
    matches = difflib.get_close_matches(item_name, names, n=1, cutoff=0.6)
    if matches:
        hit = matches[0]
        print(f"[cache] fuzzy: {item_name!r} -> {hit!r}")
        entry = cache[hit]
        return {**entry, "matched_from": matched_from or item_name}

    # Prefix fallback for long item names that don't fit the user's capture
    # box. When the box is narrow, OCR catches only the start of the item
    # name (e.g. "GP-25 attachment" instead of "GP-25 attachment for the
    # Kalashnikov system") — fuzzy ratio for a heavy right-truncation drops
    # below cutoff so the match fails. Try matching against catalog names
    # that START WITH the OCR text instead. Requires the captured prefix to
    # be at least 6 chars AND to cover at least 30% of the matched name
    # length so a short generic prefix ("5.45") can't snipe an unrelated
    # long name. When multiple catalog names share the prefix, prefer the
    # shortest one (most specific to the captured fragment).
    item_stripped = item_name.strip()
    if len(item_stripped) >= 6:
        prefix_lower = item_stripped.lower()
        prefix_candidates = [
            n for n in cache
            if n.lower().startswith(prefix_lower)
            and len(prefix_lower) >= 0.3 * len(n)
        ]
        if prefix_candidates:
            hit = min(prefix_candidates, key=len)
            print(f"[cache] prefix: {item_name!r} -> {hit!r}")
            entry = cache[hit]
            return {**entry, "matched_from": matched_from or item_name}

    # Last resort: exact match on the OCR-confusion-folded canonical form
    # (0↔O, 1/i↔l, 5↔S, 8↔B, …). Rescues pure character-confusion misreads
    # like "M8SS" → "M855" that fuzzy can miss on short names. Exact-only on
    # an unambiguous fold, so it can't mis-match the way a looser fuzzy would.
    canon_map = _canon_cache.get((lang, game_mode))
    if canon_map:
        entry = canon_map.get(_canon(item_name))
        if entry is not None:
            print(f"[cache] canon: {item_name!r} -> {entry['name']!r}")
            return {**entry, "matched_from": matched_from or item_name}

    # Cache populated but no name matches. Return None (not an empty result)
    # so the caller falls through to the cold-path GraphQL query — that's how
    # newly-released items (post-cache-warmup patch additions) get found.
    # Returning _empty_result here used to make every novel item silently
    # invisible until app restart.
    return None


def _is_junk_ocr(text: str) -> bool:
    """Reject obvious garbage OCR before burning GraphQL calls + fuzzy
    matching against the full 4700-item catalog. Common cause: capture
    region misaligned for the user's resolution (QHD/4K with 1080p
    defaults) — OCR grabs empty UI or partial chars and we'd otherwise
    spend up to ~20s per attempt on doomed network lookups.

    Heuristics (validated against the full live catalog, 4946 items × 2
    languages → 0% full-name false positives, <1% shortName FP):
      - n < 2: single chars are noise (longest real names are >70 chars
        anyway; shortest real Korean items are 2 chars like 비누 / 송곳)
      - n > 80: multi-line UI captures
      - 0 letters in stripped text: pure digit/symbol noise ("..", "12345",
        "*&^%"). Items with any letter (incl. "M855", "AR-15 10.3\"",
        "비누", "5.56x45mm M855A1") pass.
    """
    stripped = text.strip()
    n = len(stripped)
    if n < 2 or n > 80:
        return True
    # Need at least one alphabetic char (Latin or Hangul). Anything with
    # zero letters is reliably noise — separators, digits, punctuation.
    return not any(c.isalpha() or "가" <= c <= "힣" for c in stripped)


def get_item_price(
    item_name: str,
    lang: str = "ko",
    game_mode: str = "regular",
    corrections: dict[str, str] | None = None,
) -> dict:
    if not item_name:
        return _empty_result()

    matched_from: str | None = None

    # User-trained OCR correction takes priority over fuzzy matching. The
    # frontend ships the dict each call; key is the lowercased OCR text.
    if corrections:
        key = item_name.strip().lower()
        if key in corrections:
            corrected = corrections[key]
            if corrected and corrected != item_name:
                print(
                    f"[tarkov_api] user correction: {item_name!r} -> {corrected!r}"
                )
                matched_from = item_name
                item_name = corrected

    # Reject obvious junk OCR *after* corrections (so user-trained
    # mappings still work) but *before* cold-path GraphQL + fuzzy. Spares
    # us the 10s-per-network-call cost when capture region is misaligned.
    if _is_junk_ocr(item_name):
        print(f"[tarkov_api] junk OCR rejected: {item_name!r}")
        return _empty_result(matched_from)

    # Fast path: in-memory cache.
    cached = _cache_lookup(item_name, lang, game_mode, matched_from)
    if cached is not None:
        return cached

    # Cold path (cache not yet populated for this lang/mode): fall back to
    # individual GraphQL queries. Same flow as pre-v0.4.0.
    items = _query_by_name(item_name, lang, game_mode)

    if not items:
        closest = _find_closest_name(item_name, lang)
        if closest and closest != item_name:
            print(f"[tarkov_api] fuzzy match: {item_name!r} -> {closest!r}")
            if matched_from is None:
                matched_from = item_name
            items = _query_by_name(closest, lang, game_mode)

    if not items:
        return _empty_result(matched_from)

    item = items[0]
    entry = _build_cache_entry(item, _get_hideout_index(lang))
    # Backfill the cache with this single entry so the next lookup is hot.
    with _price_cache_lock:
        _price_cache.setdefault((lang, game_mode), {})[item["name"]] = entry
    return {**entry, "matched_from": matched_from}
