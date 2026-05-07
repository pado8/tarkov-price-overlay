import difflib
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
    gridImageLink
    avg24hPrice
    low24hPrice
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
    usedInTasks {
      id
      name
      minPlayerLevel
      trader { name }
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

_QUERY_ALL_PRICED = """
query AllItems($lang: LanguageCode, $gameMode: GameMode) {
  items(lang: $lang, gameMode: $gameMode) {
    name
    shortName
    width
    height
    gridImageLink
    avg24hPrice
    low24hPrice
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
    usedInTasks {
      id
      name
      minPlayerLevel
      trader { name }
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
_price_cache_lock = threading.Lock()
_refresher_started = False
_refresher_lock = threading.Lock()


def _build_cache_entry(item: dict) -> dict:
    sell_for_all = item.get("sellFor", []) or []
    trader_entries = [
        {"name": s["vendor"]["name"], "price": s["priceRUB"]}
        for s in sell_for_all
        if s["vendor"]["name"] != "Flea Market" and s.get("priceRUB") is not None
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

    # Quest references — minimal info, just enough for "do not sell" warning.
    used_in_tasks = []
    for t in item.get("usedInTasks", []) or []:
        if not t.get("name"):
            continue
        trader = t.get("trader") or {}
        used_in_tasks.append(
            {
                "id": t.get("id"),
                "name": t["name"],
                "trader": trader.get("name") or "",
                "min_level": t.get("minPlayerLevel") or 0,
            }
        )

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

    return {
        "name": item["name"],
        "short_name": item.get("shortName"),
        "width": item.get("width"),
        "height": item.get("height"),
        "icon": item.get("gridImageLink"),
        "flea": item.get("avg24hPrice"),
        "flea_low_24h": item.get("low24hPrice"),
        "flea_change_48h_pct": item.get("changeLast48hPercent"),
        "trader": trader_entries[0]["price"] if trader_entries else None,
        "sell_for": trader_entries,
        "barters_for": barters,
        "used_in_tasks": used_in_tasks,
        "crafts_for": crafts_for,
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
    by_name = {it["name"]: _build_cache_entry(it) for it in items if it.get("name")}
    with _price_cache_lock:
        _price_cache[(lang, game_mode)] = by_name
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
        "name": None,
        "short_name": None,
        "width": None,
        "height": None,
        "icon": None,
        "flea": None,
        "flea_low_24h": None,
        "flea_change_48h_pct": None,
        "trader": None,
        "sell_for": [],
        "barters_for": [],
        "used_in_tasks": [],
        "crafts_for": [],
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

    # Fuzzy match against cached names
    matches = difflib.get_close_matches(item_name, list(cache.keys()), n=1, cutoff=0.6)
    if matches:
        hit = matches[0]
        print(f"[cache] fuzzy: {item_name!r} -> {hit!r}")
        entry = cache[hit]
        return {**entry, "matched_from": matched_from or item_name}

    # Cache populated but no name matches → real miss.
    return _empty_result(matched_from)


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
    entry = _build_cache_entry(item)
    # Backfill the cache with this single entry so the next lookup is hot.
    with _price_cache_lock:
        _price_cache.setdefault((lang, game_mode), {})[item["name"]] = entry
    return {**entry, "matched_from": matched_from}
