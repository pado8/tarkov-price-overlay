"""탈출구 이용 조건 — 탈콥 가이드(scripts/guide_static.py)와 레이더(radar.py)가 같이 쓴다.

tarkov.dev 데이터의 extract.switches 는 조건이 아니다: 세관은 탈출구 28개 전부, 연구소는 7개 전부에
같은 스위치가 붙어 있다(2026-10-27 확인). 그래서 조건은 공식 위키(escapefromtarkov.fandom.com 각 맵 문서의
Extractions 표, 2026-10-27)를 손으로 옮겨 여기 둔다. 아이템 제출·요금(transferItem)은 데이터가 위키와 맞아
그대로 쓰되, 돈이면 '유료', 아이템이면 '필요 아이템'으로 구분한다.

키 = "<맵>:<탈출구 내부 이름>" (내부 이름은 데이터의 extract.name, 번역 전 값). 맵 변형은 MAP_BASE로 묶는다.
태그: lever(레버·전원·스위치) flare(초록 조명탄) key(열쇠·키카드) item(아이템 제출) paid(돈) coop(스캐브+PMC 협동)
      nobag(배낭 금지) climb(등반 장비) time(시간 조건) vex(차량 탈출)
"""
from __future__ import annotations

MAP_BASE = {"night-factory": "factory", "ground-zero-21": "ground-zero", "the-lab-dark": "the-lab"}

# 돈 아이템 — transferItem 이 이거면 '유료', 아니면 '필요 아이템'
MONEY_IDS = {"5449016a4bdc2d6f028b456f": "₽", "569668774bdc2da2298b4568": "€", "5696686a4bdc2da3298b456a": "$"}

_FLARE = "탈출 구역 안에서 초록 조명탄을 하늘로 쏴야 열림"
_VEX = "차량 탈출 — 인원별 요금(스캐브 카르마에 따라 달라짐)"
_COOP = "스캐브와 PMC가 함께 와야 열림(협동)"
_CLIMB = "Red Rebel 아이스 바일 + Paracord 낙하산 줄 필요, 방탄조끼 착용 불가"

# (태그, 설명)
COND: dict[str, tuple[frozenset, str]] = {
    # 세관
    "customs:ex_customs_pmc_zb1013": (frozenset({"lever", "key"}), "크레인 야적장 4번 창고의 레버를 당긴 뒤 ZB-1013 열쇠로 문을 열어야 함"),
    "customs:ex_customs_pmc_gasstation": (frozenset({"flare"}), "PMC는 초록 조명탄을 쏴야 열림"),
    "customs:ex_customs_pmc_flare": (frozenset({"flare"}), _FLARE),
    "customs:ex_customs_coop_boiler": (frozenset({"coop"}), _COOP),
    "customs:ex_customs_pmc_auto": (frozenset({"vex", "paid"}), _VEX + " · 최대 4명"),
    # 공장
    "factory:Gate m": (frozenset({"key"}), "공장 비상구 열쇠로 문을 열어야 함"),
    "factory:Cellars": (frozenset({"key"}), "공장 비상구 열쇠로 문을 열어야 함"),
    # 그라운드 제로
    "ground-zero:Sniper_exit": (frozenset({"flare"}), _FLARE),
    "ground-zero:Scav_coop_exit": (frozenset({"coop"}), _COOP),
    "ground-zero:Sandbox_VExit": (frozenset({"vex", "paid"}), _VEX + " · 최대 4명"),
    # 쇄빙선
    "icebreaker:Heli": (frozenset({"flare"}), "탈출 구역 안에서 초록 조명탄을 쏴야 헬기가 옴"),
    # 인터체인지
    "interchange:ex_interchange_pmc_sniper": (frozenset({"flare"}), _FLARE),
    "interchange:ex_interchange_pmc_auto": (frozenset({"vex", "paid"}), _VEX + " · 최대 4명"),
    "interchange:ex_interchange_coop_basement": (frozenset({"coop"}), _COOP),
    "interchange:ex_interchange_pmc_saferoom": (frozenset({"lever", "key"}),
        "발전소 전원 켜기 → 버거 가게 소변기 물 내리기 → 드러난 패널에 오브젝트 #11SR 키카드 사용 → 이후 단계 진행"),
    # 등대
    "lighthouse:Alpinist_light": (frozenset({"climb"}), _CLIMB),
    "lighthouse:tunnel_shared": (frozenset({"coop"}), _COOP),
    # 리저브
    "reserve:EXFIL_Bunker": (frozenset({"lever"}), "흰색 폰(Pawn) 막사 서쪽 오두막의 레버를 당겨야 열림"),
    "reserve:EXFIL_Bunker_D2": (frozenset({"lever"}), "지하 벙커에서 레버로 전원을 켠 뒤, 미닫이문 옆 벽 버튼을 눌러야 열림"),
    "reserve:Alpinist": (frozenset({"climb"}), _CLIMB),
    "reserve:EXFIL_ScavCooperation": (frozenset({"coop"}), _COOP),
    "reserve:EXFIL_vent": (frozenset({"nobag"}), "배낭을 메고는 못 나감"),
    # 해안선
    "shoreline:RedRebel_alp": (frozenset({"climb"}), _CLIMB),
    "shoreline:Alpinist": (frozenset({"climb"}), _CLIMB),
    "shoreline:Pier Boat": (frozenset({"flare"}), "초록 조명탄을 쏴야 열림(항상 열리는 탈출구 아님)"),
    "shoreline:Smugglers_Trail_coop": (frozenset({"coop"}), _COOP),
    "shoreline:Shorl_V-Ex": (frozenset({"vex", "paid"}), _VEX + " · 최대 5명"),
    # 타르코프 시내
    "streets-of-tarkov:E8_yard": (frozenset({"flare"}), "초록 조명탄을 쏴야 열림(항상 열리는 탈출구 아님)"),
    "streets-of-tarkov:E9_sniper": (frozenset({"flare"}), _FLARE),
    "streets-of-tarkov:Exit_E10_coop": (frozenset({"coop"}), _COOP),
    "streets-of-tarkov:E7_car": (frozenset({"vex", "paid"}), _VEX + " · 최대 4명"),
    # 연구소 — 탈출구마다 여는 방법이 다르다
    "the-lab:lab_Elevator_Cargo": (frozenset({"lever"}), "지하 G1 방에서 전원을 복구해야 작동"),
    "the-lab:lab_Elevator_Main": (frozenset({"lever"}), "지하 R4 맞은편에서 전원을 복구해야 작동"),
    "the-lab:lab_Elevator_Med": (frozenset({"lever"}), "지하 G6 방에서 전원을 복구해야 작동"),
    "the-lab:lab_Hangar_Gate": (frozenset({"lever"}), "격납고 2층 B24 조종실에서 게이트를 열어야 함"),
    "the-lab:lab_Parking_Gate": (frozenset({"lever"}), "2층 Y21(R22 옆)에서 게이트를 열어야 함"),
    "the-lab:lab_Under_Storage_Collector": (frozenset({"lever"}), "수위를 낮춰야 지나갈 수 있음"),
    "the-lab:lab_Vent": (frozenset({"nobag"}), "배낭을 메고는 못 나감"),
    # 미궁
    "the-labyrinth:labir_exit": (frozenset({"time"}), "레이드 시작 15분 뒤부터 이용 가능"),
    # 삼림
    "woods:wood_sniper_exit": (frozenset({"flare"}), _FLARE),
    "woods:RUAF Gate": (frozenset({"flare"}), "초록 조명탄을 쏴야 열림(항상 열리는 탈출구 아님)"),
    "woods:ZB-014": (frozenset({"flare", "key"}), "초록 조명탄을 쏴야 열리고, ZB-014 열쇠로 문을 열어야 함"),
    "woods:ZB-016": (frozenset({"flare"}), "초록 조명탄을 쏴야 열림(항상 열리는 탈출구 아님)"),
    "woods:Factory Gate": (frozenset({"coop"}), _COOP),
    "woods:South V-Ex": (frozenset({"vex", "paid"}), _VEX + " · 최대 4명"),
}


def _item_id(ti: dict | None) -> str | None:
    if not ti:
        return None
    it = ti.get("item")
    return it.get("id") if isinstance(it, dict) else it


def conditions(map_name: str, ex: dict) -> tuple[set[str], str | None, dict | None]:
    """(태그, 설명, 제출물) — 제출물은 {"id", "count", "money": 기호 또는 None}. 조건 없으면 (set(), None, None)."""
    base = MAP_BASE.get(map_name, map_name)
    tags, text = COND.get(f"{base}:{ex.get('name')}", (frozenset(), None))
    tags = set(tags)
    ti = ex.get("transferItem")
    give = None
    iid = _item_id(ti)
    if iid:
        money = MONEY_IDS.get(iid)
        give = {"id": iid, "count": ti.get("count"), "money": money}
        tags.add("paid" if money else "item")
    return tags, text, give
