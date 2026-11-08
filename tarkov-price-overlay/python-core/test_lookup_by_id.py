"""최근 검색 재조회(이름 + item_id) 시험(11-08). 이름이 비슷한 다른 아이템이 잡히면 id 로 다시 찾아야 한다.
실측(extras 세션): 열쇠를 영어 이름 + id 로 한국어 목록에서 조회하면 'Dorm room 220 key' → 204호처럼 다른 열쇠가 잡혔다.
실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_lookup_by_id.py  (디스크 시세 목록 사본이 있어야 함)"""
import tarkov_api as ta

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


def old_rule(text, item_id, lang, mode):
    price = ta.get_item_price(text, lang=lang, game_mode=mode)
    if not price.get("name") and item_id:
        alt = ta.name_for_id(lang, mode, item_id)
        if alt and alt != text:
            price = ta.get_item_price(alt, lang=lang, game_mode=mode)
    return price


def new_rule(text, item_id, lang, mode):
    price = ta.get_item_price(text, lang=lang, game_mode=mode)
    if item_id and price.get("id") != item_id:
        alt = ta.name_for_id(lang, mode, item_id)
        if alt and alt != text:
            price = ta.get_item_price(alt, lang=lang, game_mode=mode)
    return price


n = ta.load_snapshots()
print(f"   (디스크 시세 목록 {n}개 올림)")
en = ta._price_cache.get(("en", "regular")) or {}
keys = sorted({(e["name"], e["id"]) for e in en.values() if e.get("id") and e.get("name", "").endswith(" key")})
print(f"   (영어 목록 열쇠 {len(keys)}종)")
if not keys or not ta._price_cache.get(("ko", "regular")):
    print("시세 목록 사본이 없어 건너뜀")
    raise SystemExit(0)

bad_old = [(nm, old_rule(nm, iid, "ko", "regular").get("name")) for nm, iid in keys if old_rule(nm, iid, "ko", "regular").get("id") != iid]
bad_new = [(nm, new_rule(nm, iid, "ko", "regular").get("name")) for nm, iid in keys if new_rule(nm, iid, "ko", "regular").get("id") != iid]
print(f"   옛 규칙: 다른 아이템 {len(bad_old)}종 — 예: {bad_old[:3]}")
print(f"   새 규칙: 다른 아이템 {len(bad_new)}종 — 예: {bad_new[:3]}")
eq("새 규칙은 영어 이름 + id 로 한국어 목록에서 열쇠를 전부 그 id 로 찾는다", len(bad_new), 0)
eq("옛 규칙에선 재현됨(다른 열쇠가 잡힘)", len(bad_old) > 0, True)
nm, iid = keys[0]
eq("id 가 없으면 이름 조회 그대로(둘 같음)", new_rule(nm, None, "ko", "regular").get("id"), old_rule(nm, None, "ko", "regular").get("id"))

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
