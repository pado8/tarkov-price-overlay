"""지도 구역 이름표 — 스폰 구역 코드에 우리가 붙인 이름(한국어·영어·러시아어)을, 그 코드의 점이 모인 자리에 단다.

게임 자료의 스폰 구역 코드(ZoneDormitory 등)는 뜻이 드러나는 영어 낱말이라, 그 뜻을 옮긴 우리 이름 표(ZONE_NAMES)를 둔다.
점이 한 무리에 모인 코드만 이름표를 단다(흩어진 코드는 무게 중심이 엉뚱한 곳이 된다).
"""
from __future__ import annotations

import math


def _ok(p) -> bool:
    return isinstance(p, dict) and p.get("x") is not None and p.get("z") is not None


# 스폰 구역 코드 → (한국어, 영어, 러시아어). 코드 뜻을 그대로 옮긴 우리 이름이다. 뜻이 분명하지 않은 코드(ZoneSW00·ZoneCard1·
# 터미널 Zone1ScavPortStorm6 등)와 맵 전체를 덮는 코드(BotZone·ZoneSandbox), 저격 자리(Snipe)는 넣지 않는다.
ZONE_NAMES: dict[str, tuple[str, str, str]] = {
    # 세관
    "ZoneBlockPost": ("검문소", "Checkpoint", "Блокпост"),
    "ZoneBrige": ("다리", "Bridge", "Мост"),
    "ZoneCrossRoad": ("교차로", "Crossroads", "Перекрёсток"),
    "ZoneCustoms": ("세관 터미널", "Customs terminal", "Таможенный терминал"),
    "ZoneFactoryCenter": ("공장 가운데", "Factory center", "Центр завода"),
    "ZoneFactorySide": ("공장 가장자리", "Factory side", "Край завода"),
    "ZoneOldAZS": ("옛 주유소", "Old gas station", "Старая АЗС"),
    "ZoneScavBase": ("스캐브 기지", "Scav base", "База диких"),
    "ZoneTankSquare": ("탱크 광장", "Tank square", "Площадь с танком"),
    "ZoneWade": ("여울", "Ford", "Брод"),
    "ZoneDormitory": ("기숙사", "Dorms", "Общежития"),
    "ZoneGasStation": ("주유소", "Gas station", "АЗС"),
    # 삼림
    "ZoneBigRocks": ("큰 바위", "Big rocks", "Большие камни"),
    "ZoneBrokenVill": ("부서진 마을", "Broken village", "Разрушенная деревня"),
    "ZoneClearVill": ("빈터 마을", "Clearing village", "Деревня на поляне"),
    "ZoneRedHouse": ("붉은 집", "Red house", "Красный дом"),
    "ZoneScavBase2": ("스캐브 기지", "Scav base", "База диких"),
    "ZoneUsecBase": ("USEC 캠프", "USEC camp", "Лагерь USEC"),
    "ZoneWoodCutter": ("제재소", "Sawmill", "Лесопилка"),
    # 등대
    "Zone_Bridge": ("다리", "Bridge", "Мост"),
    "Zone_Chalet": ("별장", "Chalet", "Шале"),
    "Zone_Containers": ("컨테이너", "Containers", "Контейнеры"),
    "Zone_DestroyedHouse": ("부서진 집", "Destroyed house", "Разрушенный дом"),
    "Zone_Hellicopter": ("헬기", "Helicopter", "Вертолёт"),
    "Zone_Island": ("섬", "Island", "Остров"),
    "Zone_LongRoad": ("긴 도로", "Long road", "Длинная дорога"),
    "Zone_OldHouse": ("옛 집", "Old house", "Старый дом"),
    "Zone_Rocks": ("바위 지대", "Rocks", "Скалы"),
    "Zone_TreatmentBeach": ("정수장 해변", "Treatment plant beach", "Пляж у очистных"),
    "Zone_TreatmentContainers": ("정수장 컨테이너", "Treatment plant containers", "Контейнеры у очистных"),
    "Zone_TreatmentRocks": ("정수장 바위", "Treatment plant rocks", "Скалы у очистных"),
    "Zone_Village": ("마을", "Village", "Деревня"),
    # 해안선
    "ZoneBusStation": ("버스 정류장", "Bus stop", "Автобусная остановка"),
    "ZoneForestTruck": ("숲 트럭", "Forest truck", "Грузовик в лесу"),
    "ZoneGateTowerLeft": ("정문 망루", "Gate tower", "Вышка у ворот"),
    "ZoneGreenHouses": ("온실", "Greenhouses", "Теплицы"),
    "ZoneMeteoStation": ("기상 관측소", "Weather station", "Метеостанция"),
    "ZonePassClose": ("고갯길", "Pass", "Перевал"),
    "ZonePowerStation": ("발전소", "Power station", "Электростанция"),
    "ZoneRailWays": ("철길", "Railway", "Ж/д пути"),
    "ZoneSanatorium1": ("요양원", "Health resort", "Санаторий"),
    "ZoneSanatorium2": ("요양원", "Health resort", "Санаторий"),
    "ZoneStartVillage": ("어귀 마을", "Entry village", "Деревня у въезда"),
    # 리저브
    "ZoneBarrack": ("막사", "Barracks", "Казармы"),
    "ZonePTOR1": ("정비 구역", "Maintenance yard", "ПТОР"),
    "ZonePTOR2": ("정비 구역", "Maintenance yard", "ПТОР"),
    "ZoneRailStrorage": ("철도 창고", "Rail storage", "Ж/д склад"),
    "ZoneSubCommand": ("지하 지휘소", "Underground command", "Подземный КП"),
    "ZoneSubStorage": ("지하 창고", "Underground storage", "Подземный склад"),
    # 인터체인지
    "ZoneBearCamp": ("BEAR 캠프", "BEAR camp", "Лагерь BEAR"),
    "ZoneCenter": ("중앙 홀", "Center", "Центр"),
    "ZoneGoshan": ("고샨", "Goshan", "Гошан"),
    "ZoneIDEA": ("이데아", "IDEA", "ИДЕЯ"),
    "ZoneIDEAPark": ("이데아 주차장", "IDEA parking", "Парковка ИДЕИ"),
    "ZoneOLI": ("올리", "OLI", "ОЛИ"),
    "ZoneOLIPark": ("올리 주차장", "OLI parking", "Парковка ОЛИ"),
    # 시내
    "ZoneCarShowroom": ("자동차 전시장", "Car showroom", "Автосалон"),
    "ZoneCinema": ("영화관", "Cinema", "Кинотеатр"),
    "ZoneClimova": ("클리모프 거리", "Klimov street", "Улица Климова"),
    "ZoneConcordia_1": ("콘코르디아", "Concordia", "Конкордия"),
    "ZoneConcordiaParking": ("콘코르디아 주차장", "Concordia parking", "Парковка Конкордии"),
    "ZoneConstruction": ("공사장", "Construction site", "Стройка"),
    "ZoneFactory": ("공장", "Factory", "Завод"),
    "ZoneHotel_1": ("호텔", "Hotel", "Отель"),
    "ZoneHotel_2": ("호텔", "Hotel", "Отель"),
    "ZoneMvd": ("경찰서", "Police station", "МВД"),
    # 연구소
    "BotZoneArmory": ("무기고", "Armory", "Оружейная"),
    "BotZoneBasement": ("지하", "Basement", "Подвал"),
    "BotZoneGate1": ("1번 출입구", "Gate 1", "Ворота 1"),
    # 쇄빙선
    "BotZoneEngineCenter": ("기관실", "Engine room", "Машинное отделение"),
    "BotZoneFront2": ("뱃머리", "Bow", "Нос"),
    "BotZoneRoomsFour": ("선실", "Cabins", "Каюты"),
    "BotZoneStern": ("고물", "Stern", "Корма"),
}
ZONE_LINK_M = 60.0      # 구역 점 묶기 거리(m)
ZONE_MIN_PTS = 3        # 이름표를 달 무리의 최소 점 수
ZONE_MIN_SHARE = 0.75   # 그 코드의 점 중 가장 큰 무리에 든 비율이 이 이상일 때만 이름표
ZONE_SAME_M = 150.0     # 같은 이름이 이 거리 안에 또 있으면 하나만


def zone_labels(m: dict, lang: str) -> list[dict]:
    """스폰 구역 코드 → 이름표 [{name, p: [x, y, z]}]. 점이 한 무리에 모인 코드만(흩어진 코드는 뺀다)."""
    li = 0 if lang == "ko" else 2 if lang == "ru" else 1
    by: dict[str, list] = {}
    for s in m.get("spawns") or []:
        code = s.get("zoneName") or ""
        if code in ZONE_NAMES and _ok(s.get("position")):
            p = s["position"]; by.setdefault(code, []).append((float(p["x"]), float(p.get("y") or 0), float(p["z"])))
    for b in m.get("bosses") or []:
        for loc in b.get("spawnLocations") or []:
            code = loc.get("spawnKey") or loc.get("name") or ""
            if code in ZONE_NAMES:
                for p in loc.get("positions") or []:
                    if _ok(p):
                        by.setdefault(code, []).append((float(p["x"]), float(p.get("y") or 0), float(p["z"])))
    out, seen = [], []
    for code, pts in sorted(by.items()):
        name = ZONE_NAMES[code][li]
        # 봇 스폰 구역은 이름난 장소 한 곳에 모여 있지 않은 경우가 많다(11-09 측정: 세관 ZoneCustoms 는 큰 무리가 51%,
        # 삼림 ZoneClearVill 22% — 무게 중심에 이름을 달면 엉뚱한 곳에 붙는다). 한 무리에 대부분이 모인 코드만 이름표를 단다.
        grp = max(_groups(pts, ZONE_LINK_M), key=len)
        if len(grp) < ZONE_MIN_PTS or len(grp) / len(pts) < ZONE_MIN_SHARE:
            continue
        cx = sum(p[0] for p in grp) / len(grp); cy = sum(p[1] for p in grp) / len(grp); cz = sum(p[2] for p in grp) / len(grp)
        # 같은 이름이 가까이 두 번(요양원 1·2 등)이면 하나만
        if any(n == name and math.hypot(cx - x, cz - z) < ZONE_SAME_M for n, x, z in seen):
            continue
        seen.append((name, cx, cz))
        out.append({"name": name, "p": [round(cx, 1), round(cy, 1), round(cz, 1)]})
    return out


def _groups(pts: list, th: float) -> list[list]:
    """단일 연결 묶기(가까운 점끼리 th m 안이면 같은 무리)."""
    left = list(pts)
    out = []
    while left:
        grp = [left.pop()]
        i = 0
        while i < len(grp):
            a = grp[i]
            near = [p for p in left if math.hypot(p[0] - a[0], p[2] - a[2]) <= th]
            for p in near:
                left.remove(p)
            grp.extend(near)
            i += 1
        out.append(grp)
    return out
