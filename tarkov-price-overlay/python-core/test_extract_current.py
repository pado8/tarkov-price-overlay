"""extract_current — 위키 현재 탈출구 표로 tarkov.dev 탈출구를 거르는 규칙"""
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
    assert ec.lookup("interchange", "Hole in the Fence") == (True, "shared", "smugglerstunnel")
    keep, fac, key = ec.lookup("woods", "The Boat")  # 위키는 'Boat'
    assert keep and key == "boat"


def test_unknown_map_is_not_filtered():
    assert ec.lookup("some-new-map", "Anything") == (True, None, "")


def test_dedupe_key_same_for_pmc_and_scav_rows():
    # 같은 탈출구의 PMC/스캐브 두 줄 → 같은 정규 키(호출 쪽에서 하나만 남김)
    assert ec.lookup("customs", "Crossroads")[2] == ec.lookup("customs", "Crossroads")[2] == "crossroads"
