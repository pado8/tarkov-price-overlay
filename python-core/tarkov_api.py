import requests

TARKOV_API_URL = "https://api.tarkov.dev/graphql"

_QUERY = """
query ItemByName($name: String!, $lang: LanguageCode) {
  items(name: $name, lang: $lang) {
    id
    name
    shortName
    avg24hPrice
    sellFor {
      price
      vendor { name }
    }
  }
}
"""


def _is_korean(text: str) -> bool:
    return any("가" <= ch <= "힣" for ch in text)


def get_item_price(item_name: str) -> dict:
    if not item_name:
        return {"name": None, "flea": None, "trader": None}

    lang = "ko" if _is_korean(item_name) else "en"

    response = requests.post(
        TARKOV_API_URL,
        json={"query": _QUERY, "variables": {"name": item_name, "lang": lang}},
        timeout=10,
    )
    response.raise_for_status()
    items = response.json().get("data", {}).get("items", [])
    if not items:
        return {"name": None, "flea": None, "trader": None}

    item = items[0]
    trader_prices = [
        s["price"] for s in item.get("sellFor", []) if s["vendor"]["name"] != "Flea Market"
    ]
    return {
        "name": item["name"],
        "flea": item.get("avg24hPrice"),
        "trader": max(trader_prices) if trader_prices else None,
    }
