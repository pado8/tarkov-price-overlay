"""extract_current — 우리 탈출구 표(data/extracts_ours.json)로 tarkov.dev 탈출구를 거르는 규칙(11-10 위키 표에서 갈아냄)"""
import extract_current as ec


def test_table_loaded_has_main_maps():
    t = ec.table()
    for slug in ("woods", "customs", "streets-of-tarkov", "ground-zero-21", "factory", "night-factory"):
        assert slug in t and len(t[slug]) >= 6


def test_exact_and_faction():
    keep, fac, key = ec.lookup("woods", "ZB-014")
    assert keep and fac == "pmc" and key == "zb014"
    keep, fac, _ = ec.lookup("woods", "Outskirts")
    assert keep and fac == "shared"
    # 그라운드 제로는 tarkov.dev 진영이 None — 표 값으로 채워진다
    keep, fac, _ = ec.lookup("ground-zero-21", "Mira Ave (Flare)")
    assert keep and fac == "pmc"


def test_removed_extracts_are_dropped():
    for old in ("Old Road Gate", "Sniper Roadblock", "Factory Shacks", "Warehouse 4", "Beyond Fuel Tank"):
        assert ec.lookup("customs", old)[0] is False
    assert ec.lookup("shoreline", "Rock Passage")[0] is False


def test_alias_and_the_prefix():
    # 우리 표는 tarkov.dev 이름 그대로 — 예전 위키 별칭(Smugglers' Tunnel) 없이 바로 맞고, 예외 목록으로 '모두'
    assert ec.lookup("interchange", "Hole in the Fence") == (True, "shared", "holeinthefence")
    keep, fac, key = ec.lookup("woods", "The Boat")
    assert keep and key == "boat"
    assert ec.lookup("woods", "Boat")[2] == "boat"  # 앞의 'The' 빼고도 같은 키


def test_unknown_map_is_not_filtered():
    assert ec.lookup("some-new-map", "Anything") == (True, None, "")


def test_dedupe_key_same_for_pmc_and_scav_rows():
    # 같은 탈출구의 PMC/스캐브 두 줄 → 같은 정규 키(호출 쪽에서 하나만 남김)
    assert ec.lookup("customs", "Crossroads")[2] == ec.lookup("customs", "Crossroads")[2] == "crossroads"


def test_shared_exceptions_and_pair_rule():
    # 예외 목록(근거 적은 SHARED) → '모두' · PMC·스캐브 두 줄 규칙 → '모두'
    assert ec.lookup("customs", "Smugglers' Boat")[1] == "shared"
    assert ec.lookup("customs", "Crossroads")[1] == "shared"


if __name__ == "__main__":  # 스크립트로 돌려도 실제로 시험하게(11-10: 함수만 있어 아무것도 안 돌던 것)
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
    print(f"전부 통과 ({n}개)")
