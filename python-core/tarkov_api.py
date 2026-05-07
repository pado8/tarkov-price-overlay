import difflib
import threading

import requests

TARKOV_API_URL = "https://api.tarkov.dev/graphql"

_QUERY_BY_NAME = """
query ItemByName($name: String!, $lang: LanguageCode, $gameMode: GameMode) {
  items(name: $name, lang: $lang, gameMode: $gameMode) {
    id
    name
    shortName
    width
    height
    avg24hPrice
    low24hPrice
    changeLast48hPercent
    sellFor {
      priceRUB
      vendor { name }
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

_names_cache: dict[str, list[str]] = {}
_names_lock = threading.Lock()


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
        "flea": None,
        "flea_low_24h": None,
        "flea_change_48h_pct": None,
        "trader": None,
        "sell_for": [],
        "matched_from": matched_from,
    }


def get_item_price(item_name: str, lang: str = "ko", game_mode: str = "regular") -> dict:
    if not item_name:
        return _empty_result()

    items = _query_by_name(item_name, lang, game_mode)
    matched_from: str | None = None

    if not items:
        closest = _find_closest_name(item_name, lang)
        if closest and closest != item_name:
            print(f"[tarkov_api] fuzzy match: {item_name!r} -> {closest!r}")
            matched_from = item_name
            items = _query_by_name(closest, lang, game_mode)

    if not items:
        return _empty_result(matched_from)

    item = items[0]

    # All vendors except Flea Market, sorted high to low. priceRUB normalizes
    # USD/EUR vendors to rubles for direct comparison.
    sell_for_all = item.get("sellFor", []) or []
    trader_entries = [
        {"name": s["vendor"]["name"], "price": s["priceRUB"]}
        for s in sell_for_all
        if s["vendor"]["name"] != "Flea Market" and s.get("priceRUB") is not None
    ]
    trader_entries.sort(key=lambda e: e["price"], reverse=True)
    best_trader = trader_entries[0]["price"] if trader_entries else None

    return {
        "name": item["name"],
        "short_name": item.get("shortName"),
        "width": item.get("width"),
        "height": item.get("height"),
        "flea": item.get("avg24hPrice"),
        "flea_low_24h": item.get("low24hPrice"),
        "flea_change_48h_pct": item.get("changeLast48hPercent"),
        "trader": best_trader,
        "sell_for": trader_entries,
        "matched_from": matched_from,
    }
