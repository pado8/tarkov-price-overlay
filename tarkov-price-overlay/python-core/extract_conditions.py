"""탈출구 이용 조건 — 탈콥 가이드(scripts/guide_static.py)와 레이더(radar.py)가 같이 쓴다.

tarkov.dev 데이터의 extract.switches 는 조건이 아니다: 세관은 탈출구 28개 전부, 연구소는 7개 전부에
같은 스위치가 붙어 있다(2026-10-27 확인). 그래서 조건은 여기 FACTS 에 사실(태그·장소·열쇠·시간·인원)만 두고
문장은 _render 의 우리 문장 틀로 만든다(11-10 — 전엔 위키 문장을 옮겨 썼는데 CC BY-NC-SA 라 걷어냄).
아이템 제출·요금(transferItem)은 tarkov.dev 데이터를 그대로 쓰되, 돈이면 '유료', 아이템이면 '필요 아이템'으로 구분한다.

키 = "<맵>:<탈출구 내부 이름>" (내부 이름은 데이터의 extract.name, 번역 전 값). 맵 변형은 MAP_BASE로 묶는다.
태그: lever(레버·전원·스위치) flare(초록 조명탄) key(열쇠·키카드) item(아이템 제출) paid(돈) coop(스캐브+PMC 협동)
      nobag(배낭 금지) climb(등반 장비) time(시간 조건) vex(차량 탈출)
"""
from __future__ import annotations

MAP_BASE = {"night-factory": "factory", "ground-zero-21": "ground-zero", "the-lab-dark": "the-lab"}

# 돈 아이템 — transferItem 이 이거면 '유료', 아니면 '필요 아이템'
MONEY_IDS = {"5449016a4bdc2d6f028b456f": "₽", "569668774bdc2da2298b4568": "€", "5696686a4bdc2da3298b456a": "$"}

# ── 조건 = '사실'만 적은 자료 + 우리 문장 틀(11-10, 위키 문장 걷어내기) ─────────────────────────────
# 전에는 위키 문장을 손으로 옮긴 글이었다(CC BY-NC-SA). 이제 자료는 태그·장소 이름·열쇠 이름·시간·인원 같은 사실만 두고,
# 문장은 아래 _render 의 틀로 만든다. 사실 근거 = 게임 안 표시·공식 패치 노트·사용자 확인(위키 문장은 근거로 쓰지 않음).
# 자료 칸: lever=(어디서, 무엇을) · key=열쇠 이름 · steps=[순서대로 할 일] · vex=최대 인원 · train=(도착 시작 분, 도착 끝 분, 머무는 분)
#          after=레이드 시작 뒤 몇 분 · note=덧붙일 짧은 사실 · flare_only_sometimes=True 면 '항상 열려 있지 않음'
_CLIMB_GEAR = ("Red Rebel 아이스 바일", "Paracord")

FACTS: dict[str, dict] = {
    # 세관
    "customs:ex_customs_pmc_zb1013": {"tags": {"lever", "key"}, "lever": ("크레인 야적장 4번 창고", "레버"), "key": "ZB-1013"},
    "customs:ex_customs_pmc_gasstation": {"tags": {"flare"}, "note": "PMC 만 해당"},
    "customs:ex_customs_pmc_flare": {"tags": {"flare"}},
    "customs:ex_customs_coop_boiler": {"tags": {"coop"}},
    "customs:ex_customs_pmc_auto": {"tags": {"vex", "paid"}, "vex": 4},
    # 공장
    "factory:Gate m": {"tags": {"key"}, "key": "공장 비상구"},
    "factory:Cellars": {"tags": {"key"}, "key": "공장 비상구"},
    # 그라운드 제로
    "ground-zero:Sniper_exit": {"tags": {"flare"}},
    "ground-zero:Scav_coop_exit": {"tags": {"coop"}},
    "ground-zero:Sandbox_VExit": {"tags": {"vex", "paid"}, "vex": 4},
    # 쇄빙선
    "icebreaker:Heli": {"tags": {"flare"}, "note": "헬기 탈출"},
    # 인터체인지
    "interchange:ex_interchange_pmc_sniper": {"tags": {"flare"}},
    "interchange:ex_interchange_pmc_auto": {"tags": {"vex", "paid"}, "vex": 4},
    "interchange:ex_interchange_coop_basement": {"tags": {"coop"}},
    "interchange:ex_interchange_pmc_saferoom": {"tags": {"lever", "key"}, "key": "오브젝트 #11SR 키카드",
        "steps": ["발전소 전원 켜기", "Burger Spot 화장실 소변기 물 내리기", "드러난 패널에 키카드", "안에서 문 옆 버튼으로 문 닫기"]},
    # 등대
    "lighthouse:Alpinist_light": {"tags": {"climb"}},
    "lighthouse:tunnel_shared": {"tags": {"coop"}},
    "lighthouse:EXFIL_Train": {"tags": {"time"}, "train": (20, 15, 7)},
    # 리저브
    "reserve:EXFIL_Train": {"tags": {"time"}, "train": (16, 12, 7), "note": "도착 무렵 레이더가 올 수 있음"},
    "reserve:EXFIL_Bunker": {"tags": {"lever"}, "lever": ("흰 폰(Pawn) 막사 서쪽 오두막", "레버"), "note": "당기면 사이렌, 4분만 열림"},
    "reserve:EXFIL_Bunker_D2": {"tags": {"lever"}, "steps": ["지하 벙커 레버로 전원 켜기", "미닫이문 옆 벽 버튼 누르기"]},
    "reserve:Alpinist": {"tags": {"climb"}},
    "reserve:EXFIL_ScavCooperation": {"tags": {"coop"}},
    "reserve:EXFIL_vent": {"tags": {"nobag"}},
    # 해안선
    "shoreline:RedRebel_alp": {"tags": {"climb"}},
    "shoreline:Alpinist": {"tags": {"climb"}},
    "shoreline:Pier Boat": {"tags": {"flare"}, "flare_only_sometimes": True},
    "shoreline:Smugglers_Trail_coop": {"tags": {"coop"}},
    "shoreline:Shorl_V-Ex": {"tags": {"vex", "paid"}, "vex": 5},
    # 타르코프 시내
    "streets-of-tarkov:E8_yard": {"tags": {"flare"}, "flare_only_sometimes": True},
    "streets-of-tarkov:E9_sniper": {"tags": {"flare"}},
    "streets-of-tarkov:Exit_E10_coop": {"tags": {"coop"}},
    "streets-of-tarkov:E7_car": {"tags": {"vex", "paid"}, "vex": 4},
    # 연구소 — 탈출구마다 여는 방법이 다르다
    "the-lab:lab_Elevator_Cargo": {"tags": {"lever"}, "lever": ("지하 G1 방", "전원 복구")},
    "the-lab:lab_Elevator_Main": {"tags": {"lever"}, "lever": ("지하 R4 맞은편", "전원 복구")},
    "the-lab:lab_Elevator_Med": {"tags": {"lever"}, "lever": ("지하 G6 방", "전원 복구")},
    "the-lab:lab_Hangar_Gate": {"tags": {"lever"}, "lever": ("격납고 2층 B24 조종실", "게이트 열기")},
    "the-lab:lab_Parking_Gate": {"tags": {"lever"}, "lever": ("2층 Y21(R22 옆)", "게이트 열기")},
    "the-lab:lab_Under_Storage_Collector": {"tags": {"lever"}, "note": "물을 빼야 지나갈 수 있음"},
    "the-lab:lab_Vent": {"tags": {"nobag"}},
    # 미궁
    "the-labyrinth:labir_exit": {"tags": {"time"}, "after": 15},
    # 삼림
    "woods:wood_sniper_exit": {"tags": {"flare"}},
    "woods:RUAF Gate": {"tags": {"flare"}, "flare_only_sometimes": True},
    "woods:ZB-014": {"tags": {"flare", "key"}, "key": "ZB-014"},
    "woods:ZB-016": {"tags": {"flare"}, "flare_only_sometimes": True},
    "woods:Factory Gate": {"tags": {"coop"}},
    "woods:South V-Ex": {"tags": {"vex", "paid"}, "vex": 4},
}


def _render(f: dict) -> str:
    """사실 자료 → 한 줄 설명(우리 문장 틀). 조각을 ' · ' 로 잇는다."""
    t = f["tags"]
    parts: list[str] = []
    if f.get("steps"):
        parts.append("순서: " + " → ".join(f["steps"]))
    elif f.get("lever"):
        where, what = f["lever"]
        parts.append(f"{where}에서 {what}")
    if "key" in t and f.get("key"):
        parts.append(f"{f['key']} 열쇠 필요" if "키카드" not in f["key"] else f"{f['key']} 필요")
    if "flare" in t:
        parts.append("탈출 지점에서 초록 조명탄 발사" + (" — 평소엔 닫혀 있음" if f.get("flare_only_sometimes") else ""))
    if "coop" in t:
        parts.append("협동 탈출: 스캐브와 PMC 가 함께 있어야 함")
    if "vex" in t:
        parts.append(f"차량 탈출 · 요금(스캐브 카르마 따라 다름) · 최대 {f['vex']}명")
    if "climb" in t:
        parts.append("등반 장비 " + " + ".join(_CLIMB_GEAR) + " · 방탄조끼 입으면 불가")
    if "nobag" in t:
        parts.append("배낭 메면 못 나감")
    if f.get("train"):
        a, b, stay = f["train"]
        parts.append(f"장갑열차: 레이드 종료 {a}~{b}분 전 도착, {stay}분 정차 · 그 외 시간엔 불가")
    if f.get("after"):
        parts.append(f"레이드 시작 {f['after']}분 뒤부터")
    if f.get("note"):
        parts.append(f["note"])
    return " · ".join(parts)


# 예전과 같은 모양 — 키 = "<맵>:<탈출구 내부 이름>", 값 = (태그, 설명). 호출하는 쪽(conditions·가이드)은 그대로
COND: dict[str, tuple[frozenset, str]] = {k: (frozenset(f["tags"]), _render(f)) for k, f in FACTS.items()}


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
