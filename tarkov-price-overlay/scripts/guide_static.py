"""탈콥 가이드 정적 페이지 생성기 — 퀘스트 상세·상인별 순서·필요 아이템·퀘스트 전용 아이템·
은신처·초반 가이드·프레스티지·맵·보스.

build_guide.py가 json.tarkov.dev 데이터를 받아 Ctx를 만든 뒤 build_all()을 부른다.
본문은 전부 서버에서 HTML로 만들어 둔다 — 검색엔진(특히 네이버)이 자바스크립트를 안 돌려도
읽을 수 있게. 자바스크립트는 체크 표시·필터·PVP/PVE 전환 같은 상호작용에만 쓴다.

데이터 해석 주의(2026-10, 게임 1.2.x 기준):
- 1.1.0부터 사이드 퀘스트는 대부분 '상인 LL별 2~4개 묶음'으로 열린다. 데이터에선
  otherRequirements의 globalVariable(상인별 카운터 ≥ N)로 나타난다. 어떤 퀘스트가 카운터를
  올리는지는 데이터에 없으니 "같은 상인 묶음 퀘스트 N개 완료 후"까지만 말한다.
- 스토리 챕터(투어 등)는 데이터에 없다 → 초반 가이드의 투어 표는 공식 위키를 보고 직접 썼다.
"""
from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python-core"))
import extract_conditions  # noqa: E402 — 탈출구 조건(앱 레이더와 같은 표)

SITE = "https://tarkov.aquapado.com"
# Google AdSense 게시자 ID(예: "ca-pub-1234567890123456"). 비어 있으면 광고 스크립트를 넣지 않는다.
# 승인 뒤 값을 채우고 다시 생성하면 가이드 전 페이지에 자동 광고가 켜진다. 랜딩·방침·상태 페이지(손글)에는 넣지 않는다.
# 켤 때 함께 할 것: landing/ads.txt 생성, landing/privacy/index.html 5번 "현재 광고 없음" 문구 갱신.
ADSENSE_CLIENT = ""
MONEY = {"5449016a4bdc2d6f028b456f": "₽", "5696686a4bdc2da3298b456a": "$", "569668774bdc2da2298b4568": "€"}
# 같은 지도의 변형 — 대표 지도 페이지에 메모로만 합친다(열쇠 페이지와 같은 규칙).
MAP_VARIANTS = {"night-factory": "factory", "ground-zero-21": "ground-zero",
                "ground-zero-tutorial": "ground-zero", "the-lab-dark": "the-lab"}
MAP_ORDER = ["ground-zero", "streets-of-tarkov", "interchange", "customs", "factory", "woods",
             "shoreline", "reserve", "lighthouse", "the-lab", "icebreaker", "terminal", "the-labyrinth"]
TRADER_ORDER = ["prapor", "therapist", "skier", "peacekeeper", "mechanic", "ragman", "jaeger",
                "fence", "ref", "lightkeeper", "btr-driver", "taran", "voevoda", "mr-kerman",
                "radio-station", "survivor"]
ZONE_RE = re.compile(r"\s*\[(?:PVP|PVE) ZONE\]\s*$")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

TARGETS = {"Any": "아무 대상", "Savage": "스캐브", "AnyPmc": "PMC", "Usec": "USEC 요원", "Bear": "BEAR 요원",
           "pmcBot": "레이더", "exUsec": "로그", "marksman": "스캐브 저격수"}
BODY = {"Head": "머리", "Chest": "흉부", "Stomach": "복부", "LeftArm": "왼팔", "RightArm": "오른팔",
        "LeftLeg": "왼다리", "RightLeg": "오른다리"}
BUILD_ATTR = {"accuracy": "정확도(MOA)", "durability": "내구도", "effectiveDistance": "유효 사거리",
              "ergonomics": "인체공학", "height": "세로 칸", "width": "가로 칸", "magazineCapacity": "탄창 용량",
              "muzzleVelocity": "총구 속도", "recoil": "반동 합계", "weight": "무게(kg)"}
STATUS = {"complete": "완료", "active": "진행 중", "failed": "실패", "started": "시작"}
# 기본 건스미스의 옛 '파트 N' 번호(공식 위키 퀘스트 아이콘 파일명 GunsmithPart{N} 기준, 2026-10-27) — 같은 묶음 단계 안에서 순서를 정할 때만 쓴다.
# 데이터엔 기본 건스미스끼리 선행 관계가 없어(1.1.0 묶음 방식) 이 번호가 없으면 알파벳순이 돼 AK-105가 맨 앞에 왔었다.
GUNSMITH_LEGACY = {"MP-133": 1, "AKS-74U": 2, "HK MP5": 3, "OP-SKS": 4, "M4A1": 4, "Model 870": 7, "AKM": 8,
                   "AKS-74N": 9, "P226R": 9, "AK-105": 10, "Vector 9x19": 11, "AS VAL": 11, "MPX": 13}
MOB_KO = {"Kaban Guard (Sniper)": "카반 경호원(저격)", "Kaban Guard": "카반 경호원", "Kaban": "카반", "Knight": "나이트", "Kollontay": "콜론타이", "Partisan": "파르티잔", "Big Pipe": "빅 파이프",
          "Glukhar Guard": "글루하 경호원",
          "Birdeye": "버드아이", "Shadow of Tagilla": "타길라의 그림자", "Vengeful Killa": "분노한 킬라", "Scourge": "스커지",
          "The Wedge": "웨지", "Basmach": "바스마치", "Gus": "구스", "Reshala Guard": "르샬라 경호원",
          "Shturman Guard": "슈트르만 경호원", "Sanitar Guard": "세니타 경호원",
          "Infected Tagilla": "감염된 타길라", "infectedScreamer": "감염자"}
# 현재 게임 버전 — 허브·초반·패치 페이지 문구에 쓴다. 패치 때 올릴 것(공식 위키 Changelog 기준).
GAME_VERSION = "1.3.0"
# 진행 중 이벤트 — tarkov.dev 데이터에 이벤트 기간 값이 그대로 들어오므로(오염된 맵·감염자·보스 확률 변화)
# 이벤트 한정 내용은 반드시 표시하고, 이벤트가 끝나면 다시 생성해야 평소 값으로 돌아간다.
EVENT_NAME, EVENT_SINCE = "할로윈 이벤트", "2026-10-29"
EVENT_MAPS = {"infected-factory", "infected-lab"}
EVENT_TAG = '<span class="evtag">🎃 이벤트 한정</span>'


# 언어판 — build_guide 가 GUIDE_LANG 으로 정한다. ko 가 기본, en/ru 는 /guide/<lang>/ 아래에 생성된다.
# en/ru 빌드에서는 이 모듈 자체가 guide_i18n.load_module 로 '한글 구간이 번역된 소스'로 실행되므로 아래 문구들도 그 언어로 나온다.
LANG = "ko"
I18N: dict = {}      # ko 구간 → 번역 (en/ru 빌드에서 템플릿 페이지 번역용)
I18N_MISSING: set = set()
LANGS = [("ko", "한국어", "ko_KR"), ("en", "English", "en_US"), ("ru", "Русский", "ru_RU")]


def set_lang(lang: str, table: dict | None = None) -> None:
    global LANG, I18N
    LANG = lang
    I18N = table or {}


def lang_path(path: str, lang: str | None = None) -> str:
    """ko 경로(/guide/x/) → 해당 언어 경로(/guide/en/x/)."""
    lang = lang or LANG
    return path if lang == "ko" else f"/guide/{lang}/" + path[len("/guide/"):]


def hreflang_html(path: str) -> str:
    links = "".join(f'<link rel="alternate" hreflang="{l}" href="{SITE}{lang_path(path, l)}" />\n' for l, _, _ in LANGS)
    return links + f'<link rel="alternate" hreflang="x-default" href="{SITE}{path}" />\n'


def lang_switch_html(path: str) -> str:
    """상단 언어 전환 — 절대 주소로 써서 en/ru 판의 링크 접두 처리에 안 걸리게."""
    return '<div class="lang">' + "".join(
        f'<a{" class=\"on\"" if l == LANG else ""} href="{SITE}{lang_path(path, l)}" hreflang="{l}">{name}</a>' for l, name, _ in LANGS) + "</div>"


def localize_template(html_text: str, path: str) -> str:
    """템플릿 페이지(quests/kappa/keys): 고정 문구 번역 + html lang·canonical·og 교체 + hreflang·언어 전환. ko 는 hreflang·전환만."""
    import re as _re
    html_text = html_text.replace("</head>", hreflang_html(path) + "</head>", 1)
    html_text = _re.sub(r"(<nav>.*?</nav>)", lambda m: m.group(1) + lang_switch_html(path), html_text, count=1, flags=_re.S)
    if LANG == "ko":
        return html_text
    import guide_i18n
    html_text = guide_i18n.translate_text(html_text, I18N, I18N_MISSING)
    html_text = html_text.replace('<html lang="ko">', f'<html lang="{LANG}">', 1)
    html_text = html_text.replace(f'{SITE}{path}"', f'{SITE}{lang_path(path)}"')  # canonical·og:url
    html_text = html_text.replace('content="ko_KR"', f'content="{dict((l, loc) for l, _, loc in LANGS)[LANG]}"')
    return localize_html(html_text)


def localize_html(html_text: str) -> str:
    """en/ru 판: 내부 /guide/ 링크를 /guide/<lang>/ 로 바꾼다(자산 파일 제외)."""
    import re as _re
    assets = ("/guide/guide.css", "/guide/gunsmith.json")  # sync.js 는 언어판마다 번역본이 /guide/<lang>/sync.js 에 따로 있다

    def _href(m):
        url = m.group(2)
        if url.startswith(assets) or url.startswith(f"/guide/{LANG}/"):
            return m.group(0)
        return f'{m.group(1)}="/guide/{LANG}/{url[len("/guide/"):]}"'
    html_text = _re.sub(r'(href|action|src)="(/guide/[^"]*)"', _href, html_text)
    # 랜딩·상태 페이지도 그 언어판으로
    html_text = html_text.replace('href="/"', f'href="/{LANG}"').replace('href="/?src=guide"', f'href="/{LANG}?src=guide"')
    html_text = html_text.replace('href="/status/"', f'href="/status/?lang={LANG}"')
    # 번역 조각을 이어 붙이며 생긴 이중 공백 정리(태그·스크립트 밖 본문)
    html_text = _re.sub(r"(?<=[^\s>])  +(?=[^\s<])", " ", html_text)
    return html_text


def is_event_mob(mob) -> bool:
    return str(mob or "").startswith("infected")


# 공개 데이터와 공식 위키가 다른 맵 기본 정보 — 2026-11-02 전수 대조. 값을 바꾸지 않고 병기하거나(판정 불가), 명백한 오류만 교체.
MAP_FIX = {
    "terminal": {"duration_note": "공개 데이터 50분 · 공식 위키는 45분"},
    "the-labyrinth": {"players": "1-5", "players_note": "공개 데이터는 5-5로 적혀 있으나 공식 위키 기준 1~5인"},
}
# 공식 위키(2026-11-02 전수 대조)와 공개 데이터가 다른 퀘스트 — 키는 영어 이름(모드 접미 제외). 어느 쪽이 현재 게임과 맞는지
# 확인되지 않아 값을 바꾸지 않고 퀘스트 페이지에 병기한다. rev=위키 문서 마지막 수정일. 재대조는 tmp/quest_verify2.py 방식.
WIKI_DIFF = {
    "A Difficult Choice": {"rev": "2026-10-27", "exp": 65000},
    "A Helping Hand": {"rev": "2026-10-28", "level": 20},
    "Beneath The Streets": {"rev": "2026-10-27", "exp": 65000},
    "Booze": {"rev": "2026-10-27", "exp": 20000},
    "Cargo X - Part 3": {"rev": "2026-10-27", "level": 12},
    "Charity": {"rev": "2026-10-27", "ll": 2},
    "Collector": {"rev": "2026-10-31", "level": 40, "obj": "위키는 선행 퀘스트를 4개로 적음(Postman Pat - Part 2 제외)"},
    "Create a Distraction - Part 2": {"rev": "2026-10-27", "obj": "위키에는 「카반·콜론타이를 해치지 말 것」 조건이 더 있음"},
    "Crisis": {"rev": "2026-10-27", "exp": 65000},
    "Dandies": {"rev": "2026-10-27", "exp": 10000},
    "Debtor": {"rev": "2026-10-27", "exp": 10000},
    "Decisions, Decisions": {"rev": "2026-10-27", "obj": "위키에는 「세관의 옛 챔피언 은신처로 돌아가기」 목표가 더 있음"},
    "Decontamination Service": {"rev": "2026-10-27", "exp": 65000},
    "Disease History": {"rev": "2026-10-27", "exp": 2800},
    "District Patrol": {"rev": "2026-10-27", "exp": 10000},
    "Drug Trafficking": {"rev": "2026-10-28", "exp": 28500},
    "Every Hunter Knows This": {"rev": "2026-10-27", "exp": 5800, "rep": "Jaeger +0.01"},
    "Glory to CPSU - Part 1": {"rev": "2026-10-27", "level": 15},
    "Gunsmith Master - Part 1": {"rev": "2026-10-13", "level": 27},
    "Hell on Earth - Part 1": {"rev": "2026-10-27", "exp": 3000},
    "Hell on Earth - Part 2": {"rev": "2026-10-27", "exp": 28000},
    "Job for a Patriot": {"rev": "2026-10-27", "exp": 10000},
    "Make an Impression": {"rev": "2026-11-01", "obj": "위키에는 「볼트액션 소총 스킬 10 달성」 조건이 더 있고 처치 수를 10명으로 적음"},
    "Minibus": {"rev": "2026-10-27", "obj": "위키에는 「도구 분류 아이템 10개 제출」 목표가 더 있음"},
    "New Beginning": {"rev": "2026-10-27", "rep": "Ragman +0.1"},
    "No Swiping": {"rev": "2026-10-28", "exp": 3000},
    "Nostalgia": {"rev": "2026-10-27", "level": 28},
    "Perfect Mediator": {"rev": "2026-10-27", "exp": 20900},
    "Private Club": {"rev": "2026-10-28", "exp": 3000},
    "Properties All Around": {"rev": "2026-10-27", "exp": 10000},
    "Pyramid Scheme": {"rev": "2026-10-27", "exp": 28000},
    "Reconnaissance": {"rev": "2026-10-27", "exp": 28000},
    "Scavenger": {"rev": "2026-10-27", "exp": 28000},
    "Shooter Born in Heaven": {"rev": "2026-10-27", "exp": 65000},
    "Slaughterhouse": {"rev": "2026-10-31", "obj": "위키는 삼림·인터체인지·세관까지 9개 맵(공개 데이터는 6개 맵)"},
    "Surveillance": {"rev": "2026-10-27", "exp": 10000},
    "Tarkov-Style Diplomacy": {"rev": "2026-10-27", "exp": 28200},
    "The Bunker - Part 2": {"rev": "2026-10-27", "level": 15},
    "The Cult": {"rev": "2026-10-27", "exp": 1000},
    "The Huntsman Path - Administrator": {"rev": "2026-10-31", "obj": "위키는 등대 기차역에서도 조명탄 발사·6명 처치를 요구(총 4개 목표)하고 처치 수를 6명으로 적음"},
    "The Tarkov Shooter - Part 5": {"rev": "2026-10-31", "exp": 28000},
    "Trophies": {"rev": "2026-10-28", "obj": "위키는 「20레벨 이상 PMC 인식표」와 「PMC 12명 처치」 조건(공개 데이터는 프레스티지 1 이상 인식표)"},
    "Unique Experience": {"rev": "2026-10-28", "exp": 65000},
    "Urban Medicine": {"rev": "2026-10-28", "obj": "위키에는 「시내에서 스캐브 처치」 목표가 없음"},
}
# 은신처 시설도 같은 방식(위키 Hideout 표는 1.3.0 이전 갱신). 키 = 시설 normalizedName, 단계별 문장.
STATION_WIKI_DIFF = {
    "hall-of-fame": {1: "위키에는 선행 시설(약해 보이는 벽 6단계·조명 시설 2단계) 조건이 없음"},
    "rest-space": {2: "위키는 건설 시간을 2시간으로 적음", 3: "위키는 건설 시간을 10시간으로 적음"},
    "cultist-circle": {1: "위키는 건설 시간을 6시간으로 적음"},
}


def wiki_diff_html(en_name: str, stamp: str) -> str:
    """퀘스트 페이지용 — 공개 데이터와 공식 위키가 다른 항목을 병기한다(값은 바꾸지 않음)."""
    import re as _re
    d = WIKI_DIFF.get(_re.sub(r"\s*\[(?:PVP|PVE) ZONE\]\s*$", "", en_name or ""))
    if not d:
        return ""
    parts = []
    if "level" in d:
        parts.append(f"레벨 {d['level']}")
    if "ll" in d:
        parts.append(f"상인 등급 LL{d['ll']}")
    if "exp" in d:
        parts.append(f"경험치 {d['exp']:,}")
    if "rep" in d:
        parts.append(f"평판 {d['rep']}")
    if "obj" in d:
        parts.append(d["obj"])
    return (f'<div class="note">⚠ <b>공식 위키 표기와 다름</b>(위키 마지막 수정 {d["rev"]}) — 위키: {" · ".join(parts)}. '
            f'이 페이지는 공개 데이터(기준 {stamp}) 값을 보여주며, 어느 쪽이 현재 게임과 맞는지는 확인되지 않았습니다.</div>')


def station_diff_html(slug: str, level) -> str:
    txt = (STATION_WIKI_DIFF.get(slug) or {}).get(level)
    return f'<p class="small"><span class="warn">⚠ 공식 위키 표기와 다름:</span> {txt} — 위키 시설 표는 1.3.0 이전 갱신이라 어느 쪽이 맞는지 확인되지 않았습니다.</p>' if txt else ""

# 데이터에 잘못 섞인 탈출구 — (맵, 탈출구 내부 이름). 2026-11-02: 그라운드 제로 데이터에 시내의 Pinewood Basement (Co-Op)가 들어 있음(위키 표에 없음).
EXTRACT_SKIP = {("ground-zero", "Exit_E10_coop")}
# 데이터에 탈출구가 비어 있는 맵 — 공식 위키 표를 손으로 옮김(2026-11-02).
HAND_EXTRACTS = {
    "terminal": '공개 데이터에 탈출구 정보가 없어 공식 위키 기준: <b>Zubr Boat</b>(PMC, 항상 열림, 1회용) — 입장 인원 1~3명이면 3석, 4명 3~4석, 5명 4~5석. Alpha-1 증거 컨테이너를 가져온 사람은 소지하고 있어야 하며, 부두 도착 뒤 3분 타이머. '
                '출처: <a href="https://escapefromtarkov.fandom.com/wiki/Terminal" rel="noopener" target="_blank">공식 위키 Terminal</a>',
    "infected-lab": '공개 데이터에 탈출구 정보가 없어 공식 위키 기준: <b>Parking</b>(PMC, Car keys 필요) · <b>Sewage Conduit</b>(PMC, Collector map 필요). '
                    '출처: <a href="https://escapefromtarkov.fandom.com/wiki/Infected_Lab" rel="noopener" target="_blank">공식 위키 Infected Lab</a>',
    "infected-factory": '공개 데이터에 탈출구 정보가 없어 공식 위키 기준: <b>Gate 0</b> · <b>Gate 3</b>(둘 다 PMC, 조건 없음). '
                        '출처: <a href="https://escapefromtarkov.fandom.com/wiki/Infected_Factory" rel="noopener" target="_blank">공식 위키 Infected Factory</a>',
}


def event_note(what: str) -> str:
    return (f'<div class="note">🎃 <b>{EVENT_NAME}({EVENT_SINCE}~) 기간 값</b> — {what} 이벤트가 끝나면 이 페이지를 다시 생성해 평소 값으로 돌아갑니다. '
            '출처: <a href="https://escapefromtarkov.fandom.com/wiki/Events" rel="noopener" target="_blank">공식 위키 Events</a>.</div>')
HAZARD = {"minefield": "지뢰밭", "sniper": "저격 구역", "hazard": "위험 지역"}

NAV = [("start", "/guide/start/", "초반 가이드"), ("quests", "/guide/quests/", "퀘스트"),
       ("items", "/guide/items/", "필요 아이템"), ("rewards", "/guide/rewards/", "보상 아이템"), ("hideout", "/guide/hideout/", "은신처"),
       ("maps", "/guide/maps/", "맵"), ("bosses", "/guide/bosses/", "보스"),
       ("kappa", "/guide/kappa/", "카파템"), ("keys", "/guide/keys/", "열쇠"),
       ("crafts", "/guide/crafts/", "제작 수익"), ("ammo", "/guide/ammo/", "탄약표"),
       ("prestige", "/guide/prestige/", "프레스티지"), ("patch", "/guide/patch/", "패치 요약"),
       ("promo", "/guide/promo/", "프로모 코드"), ("gunsmith", "/guide/gunsmith/", "건스미스"),
       ("overlay", "/", "시세 오버레이")]


# 2뎁스 그룹 메뉴(2026-10-27, 탭 16개가 가로 스크롤을 만들어서). 그룹 제목은 대표 페이지 링크,
# 데스크톱은 올리면 펼침, 좁은 화면·터치는 눌러 펼침(sync.js 의 메뉴 토글). 아이템 페이지들을 한 페이지로 합치지
# 않은 이유: 페이지가 너무 커지고 검색 유입용 개별 주소를 잃는다.
NAV_GROUPS = [
    ("시작하기", "/guide/start/", [("start", "/guide/start/", "초반 가이드"), ("patch", "/guide/patch/", "패치 요약"),
                               ("promo", "/guide/promo/", "프로모 코드")]),
    ("퀘스트", "/guide/quests/", [("quests", "/guide/quests/", "퀘스트 목록"), ("hunt", "/guide/hunt/", "사냥 퀘스트"), ("favorites", "/guide/favorites/", "내 즐겨찾기"), ("gunsmith", "/guide/gunsmith/", "건스미스"),
                                 ("kappa", "/guide/kappa/", "카파템"), ("prestige", "/guide/prestige/", "프레스티지")]),
    ("아이템", "/guide/items/", [("items", "/guide/items/", "필요 아이템"), ("rewards", "/guide/rewards/", "보상으로 받는 아이템"),
                                ("quest-items", "/guide/quest-items/", "퀘스트 전용 아이템"),
                                ("keys", "/guide/keys/", "열쇠"), ("ammo", "/guide/ammo/", "탄약표")]),
    ("은신처", "/guide/hideout/", [("hideout", "/guide/hideout/", "은신처"), ("crafts", "/guide/crafts/", "제작 수익")]),
    ("맵", "/guide/maps/", [("maps", "/guide/maps/", "맵 정보"), ("bosses", "/guide/bosses/", "보스")]),
]


def nav_html(active: str, path: str | None = None) -> str:
    """가이드 상단 메뉴 — 정적 페이지와 템플릿 페이지(카파·열쇠·퀘스트)가 같은 걸 쓴다. path 를 주면 언어 전환도 붙인다"""
    out = []
    for label, href, items in NAV_GROUPS:
        gon = any(k == active for k, _, _ in items)
        inner = "".join(f'<a{" class=\"on\"" if k == active else ""} href="{h}">{l}</a>' for k, h, l in items)
        out.append(f'<div class="g{" on" if gon else ""}"><a class="gt" href="{href}">{label}<span class="car" aria-hidden="true">▾</span></a>'
                   f'<div class="dd">{inner}</div></div>')
    # '시세 오버레이'는 nav 밖 형제로 둔다 — 넓은 화면에선 메뉴 바로 뒤, 폰에선 로고 줄 오른쪽(guide.css)
    ov = f'<a class="ov{" on" if active == "overlay" else ""}" href="/">시세 오버레이</a>'
    return "<nav>" + "".join(out) + "</nav>" + (lang_switch_html(path) if path else "") + ov


def e(s) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def fmt_int(n) -> str:
    try:
        n = float(n)
    except (TypeError, ValueError):
        return e(n)
    return f"{int(round(n)):,}" if abs(n - round(n)) < 1e-9 else f"{n:,.2f}".rstrip("0").rstrip(".")


def fmt_dur(sec) -> str:
    sec = int(sec or 0)
    if sec <= 0:
        return "즉시"
    d, rem = divmod(sec, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    out = []
    if d:
        out.append(f"{d}일")
    if h:
        out.append(f"{h}시간")
    if m and not d:
        out.append(f"{m}분")
    return " ".join(out) or f"{sec}초"


@dataclass
class Ctx:
    stamp: str
    items: dict                 # regular items (id → raw)
    items_pve: dict
    loc_items: dict
    loc_items_en: dict
    tasks_reg: dict
    tasks_pve: dict
    loc_tasks: dict
    loc_tasks_en: dict
    quest_items: dict
    achievements: dict
    prestige_reg: list
    prestige_pve: list
    maps: dict
    loc_maps: dict
    mobs: dict
    traders: dict
    loc_traders: dict
    hideout_reg: dict
    hideout_pve: dict
    loc_hideout: dict
    crafts_reg: list
    crafts_pve: list
    tasks: dict = field(default_factory=dict)
    task_modes: dict = field(default_factory=dict)
    _item_cache: dict = field(default_factory=dict)

    def __post_init__(self):
        self.tasks = {**self.tasks_pve, **self.tasks_reg}
        self.task_modes = {tid: [m for m, src in (("pvp", self.tasks_reg), ("pve", self.tasks_pve)) if tid in src]
                           for tid in self.tasks}
        self.trader_by_slug = {t.get("normalizedName"): tid for tid, t in self.traders.items()}
        self.map_by_slug = {m.get("normalizedName"): mid for mid, m in self.maps.items()}
        self.station_by_id = self.hideout_reg
        # 역색인: 다음 퀘스트(이 퀘스트를 선행으로 삼는 것들)
        self.next_of: dict[str, list[str]] = {}
        for tid, t in self.tasks.items():
            for r in t.get("taskRequirements") or []:
                if r.get("task") in self.tasks:
                    self.next_of.setdefault(r["task"], []).append(tid)
        self._depth: dict[str, int] = {}
        # 같은 이름 퀘스트 구분('[PVP ZONE]' 판·BEAR/USEC 판·레벨별 판·'-2' 판) — 제목이 겹치지 않게
        groups: dict[str, list] = {}
        for tid in self.tasks:
            groups.setdefault(self.task_names(tid)[0], []).append(tid)
        self.display_suffix: dict[str, str] = {}
        for name, ids in groups.items():
            if len(ids) < 2:
                continue
            def key_of(tid):
                t = self.tasks[tid]
                parts = []
                facs = {self.tasks[x].get("factionName") for x in ids}
                if len(facs) > 1 and t.get("factionName") in ("BEAR", "USEC"):
                    parts.append(t["factionName"])
                mset = {tuple(self.task_modes.get(x, [])) for x in ids}
                if len(mset) > 1 and len(self.task_modes.get(tid, [])) == 1:
                    parts.append(self.task_modes[tid][0].upper())
                lvs = {self.tasks[x].get("minPlayerLevel") or 0 for x in ids}
                if len(lvs) > 1:
                    parts.append(f"레벨 {t.get('minPlayerLevel') or 0}")
                return " · ".join(parts)
            keys = {tid: key_of(tid) for tid in ids}
            counts: dict[str, int] = {}
            for tid in sorted(ids, key=lambda x: self.tasks[x].get("normalizedName") or x):
                k = keys[tid]
                counts[k] = counts.get(k, 0) + 1
                if list(keys.values()).count(k) > 1:  # 그래도 같으면 번호
                    k = (k + " · " if k else "") + f"{counts[k]}번째"
                self.display_suffix[tid] = k

    # ── 이름 ────────────────────────────────────────────────
    @staticmethod
    def _loc(table, key, fallback=None):
        if key is None:
            return fallback
        v = table.get(key)
        if isinstance(v, str):
            # 원본 번역에 제어 문자가 섞인 경우가 있다(예: 'CPU \x08fan 쿨러')
            v = CTRL_RE.sub("", v).strip()
        return v if isinstance(v, str) and v else fallback

    def tk(self, key, fallback=None):
        return self._loc(self.loc_tasks, key, None) or self._loc(self.loc_tasks_en, key, fallback)

    def task_names(self, tid):
        t = self.tasks.get(tid) or {}
        en = self._loc(self.loc_tasks_en, t.get("name"), t.get("normalizedName")) or ""
        ko = self._loc(self.loc_tasks, t.get("name"), en) or en
        return ZONE_RE.sub("", ko), ZONE_RE.sub("", en)

    def task_slug(self, tid):
        return (self.tasks.get(tid) or {}).get("normalizedName") or tid

    def task_url(self, tid):
        return f"/guide/quest/{self.task_slug(tid)}/"

    def task_link(self, tid, cls=""):
        if tid not in self.tasks:
            return e(tid)
        ko, _ = self.task_names(tid)
        suf = getattr(self, "display_suffix", {}).get(tid)
        label = f"{ko} ({suf})" if suf else ko
        return f'<a class="{cls}" href="{self.task_url(tid)}">{e(label)}</a>'

    def trader(self, tid):
        return self.traders.get(tid) or {}

    def trader_name(self, tid):
        tr = self.trader(tid)
        return self._loc(self.loc_traders, tr.get("name"), tr.get("normalizedName") or "?")

    def trader_slug(self, tid):
        return self.trader(tid).get("normalizedName") or tid

    def map_name(self, mid):
        m = self.maps.get(mid)
        if not m:
            return None
        return self._loc(self.loc_maps, m.get("name"), m.get("normalizedName"))

    def map_link(self, mid):
        m = self.maps.get(mid)
        if not m:
            return ""
        slug = MAP_VARIANTS.get(m.get("normalizedName"), m.get("normalizedName"))
        return f'<a href="/guide/maps/{e(slug)}/">{e(self.map_name(mid))}</a>'

    def map_links(self, mids) -> str:
        """지도 링크 목록 — 변형(21+·야간·튜토리얼)은 대표 지도로 합쳐 한 번만"""
        out = []
        for mid in mids or []:
            slug = (self.maps.get(mid) or {}).get("normalizedName")
            if not slug or slug == "ground-zero-tutorial":
                continue
            lk = self.map_link(self.map_by_slug.get(MAP_VARIANTS.get(slug, slug), mid))
            if lk and lk not in out:
                out.append(lk)
        return ", ".join(out)

    def station_name(self, sid):
        st = self.hideout_reg.get(sid) or self.hideout_pve.get(sid) or {}
        return self._loc(self.loc_hideout, st.get("name"), st.get("normalizedName") or "?")

    def station_link(self, sid, lv=None):
        st = self.hideout_reg.get(sid) or self.hideout_pve.get(sid) or {}
        label = e(self.station_name(sid)) + (f" {lv}단계" if lv else "")
        return f'<a href="/guide/hideout/{e(st.get("normalizedName"))}/#lv{lv or 1}">{label}</a>'

    def skill_name(self, sid):
        for table in (self.loc_hideout, self.loc_tasks, self.loc_items):
            v = self._loc(table, sid)
            if v:
                return v
        return sid

    def mob_name(self, mob):
        if is_event_mob(mob):  # 할로윈 감염자 — 로케일이 내부 ID(infectedScreamer)를 그대로 돌려주는 것도 있어 종류만 표시
            if LANG == "ko":
                return "감염된 타길라" if mob == "infectedTagilla" else "감염자"
            n = self._loc(self.loc_maps, mob) or mob
            return n if n != mob else {"en": "Infected", "ru": "Заражённый"}.get(LANG, "Infected")
        n = self._loc(self.loc_maps, mob) or self._loc(self.loc_tasks, mob) or TARGETS.get(mob) or mob
        if LANG != "ko":  # en/ru 로케일은 보스 이름이 그 언어로 있다
            return n
        # 한국어판도 영어로 두는 보스 이름 — 검색은 한글로 하니 음역을 앞에 붙인다
        for en, ko in MOB_KO.items():
            if n == en or n.startswith(en + " "):
                return ko + "(" + n + ")"
        return n

    # ── 아이템 ──────────────────────────────────────────────
    def item(self, iid):
        if iid in self._item_cache:
            return self._item_cache[iid]
        it = self.items.get(iid) or self.items_pve.get(iid)
        info = None
        if isinstance(it, dict):
            pv = self.items_pve.get(iid) or {}
            en = self._loc(self.loc_items_en, it.get("name"), it.get("name"))
            info = {
                "id": iid,
                "n": self._loc(self.loc_items, it.get("name"), en),
                "en": en,
                "s": self._loc(self.loc_items, it.get("shortName"), self._loc(self.loc_items_en, it.get("shortName"), "")),
                "img": it.get("gridImageLink") or it.get("iconLink"),
                "pvp": it.get("avg24hPrice"),
                "pve": pv.get("avg24hPrice"),
                "wiki": it.get("wikiLink"),
                "noflea": "noFlea" in (it.get("types") or []),
            }
        else:
            qi = self.quest_items.get(iid)
            if qi:
                info = {"id": iid, "n": self.tk(f"{iid} Name", iid), "en": self._loc(self.loc_tasks_en, f"{iid} Name", ""),
                        "s": self.tk(f"{iid} ShortName", ""), "img": qi.get("gridImageLink") or qi.get("iconLink"),
                        "quest": True, "desc": self.tk(f"{iid} Description", "")}
        self._item_cache[iid] = info
        return info

    def money(self, iid, count):
        sym = MONEY.get(iid)
        if not sym:
            return None
        return f"{sym}{fmt_int(count)}" if sym != "₽" else f"{fmt_int(count)}₽"

    def chip(self, iid, count=None, fir=False, extra=""):
        m = self.money(iid, count) if count is not None else None
        if m:
            return f'<span class="chip money"><b>{e(m)}</b></span>'
        it = self.item(iid)
        if not it:
            return f'<span class="chip">{e(iid)}</span>'
        img = f'<img loading="lazy" alt="" src="{e(it["img"])}" width="24" height="24" />' if it.get("img") else ""
        cnt = f' <span class="cnt">×{fmt_int(count)}</span>' if count not in (None, 1, 1.0) else ""
        firb = ' <span class="badge b-fir">인레이드</span>' if fir else ""
        title = it["n"] + (f" ({it['en']})" if it.get("en") and it["en"] != it["n"] else "")
        return f'<span class="chip{" fir" if fir else ""}" title="{e(title)}">{img}{e(it["n"])}{cnt}{firb}{extra}</span>'

    def chips_alt(self, ids, count=None, fir=False, limit=6):
        """대체 가능한 아이템 목록(아무거나 하나) — 많으면 접어 둔다."""
        ids = [i for i in dict.fromkeys(ids or []) if i]
        if not ids:
            return ""
        if len(ids) == 1:
            return self.chip(ids[0], count, fir)
        head = "".join(self.chip(i) for i in ids[:limit])
        tail = ""
        if len(ids) > limit:
            tail = (f'<details class="more"><summary>외 {len(ids) - limit}종 더 보기</summary>'
                    + "".join(self.chip(i) for i in ids[limit:]) + "</details>")
        lead = (f'<span class="muted small">아래 중 아무거나'
                + (f' <b class="cnt">×{fmt_int(count)}</b>' if count not in (None, 1) else "")
                + (' <span class="badge b-fir">인레이드</span>' if fir else "") + "</span>")
        return f'<div class="alt">{lead}<div class="chips">{head}</div>{tail}</div>'

    # ── 퀘스트 해석 ────────────────────────────────────────
    def depth(self, tid, _seen=None):
        """선행 퀘스트 사슬의 깊이 — 상인별 목록에서 '먼저 하는 순서'로 정렬하는 데 쓴다."""
        if tid in self._depth:
            return self._depth[tid]
        _seen = _seen or set()
        if tid in _seen:
            return 0
        _seen.add(tid)
        reqs = [r["task"] for r in (self.tasks.get(tid) or {}).get("taskRequirements") or [] if r.get("task") in self.tasks]
        d = 1 + max((self.depth(r, _seen) for r in reqs), default=-1)
        self._depth[tid] = d
        return d

    def chain(self, tid) -> list[tuple[str, bool]]:
        """처음부터 이 퀘스트까지의 선행 사슬 — (퀘스트 id, 완료가 필요한지) 를 먼저 하는 순서로.
        완료가 아니라 '시작/진행 중'만 요구하는 선행(status 에 complete 없음)은 False 로 표시한다. 자기 자신은 뺀다."""
        need: dict[str, bool] = {}
        stack = [tid]
        seen = {tid}
        while stack:
            cur = stack.pop()
            for r in (self.tasks.get(cur) or {}).get("taskRequirements") or []:
                q = r.get("task")
                if q not in self.tasks:
                    continue
                st = r.get("status") or []
                comp = (not st) or ("complete" in st)
                need[q] = need.get(q, False) or comp
                if q not in seen:
                    seen.add(q)
                    stack.append(q)
        order = sorted(need, key=lambda q: (self.depth(q), (self.tasks[q].get("minPlayerLevel") or 0), self.task_names(q)[0]))
        return [(q, need[q]) for q in order]

    def early_tasks(self, traders: list[str], max_batch: int = 1) -> list[str]:
        """초반(대략 10레벨까지)에 실제로 받게 되는 퀘스트.

        1.1.0 이후엔 레벨·LL 조건이 없는 퀘스트가 많아서 'LL1·레벨 10 이하'만으로는 후반 퀘스트가
        섞인다(실측: 247개 중 피스키퍼 '특수 장비'=COFDM·Virtex, 묶음 3). 그래서 묶음 단계가 낮고,
        선행 퀘스트도 전부 초반이며, 다른 퀘스트와 택일(실패 조건)로 묶이지 않은 것만 고른다.
        """
        memo: dict[str, bool] = {}

        def ok(tid, stack=()):
            if tid in memo:
                return memo[tid]
            t = self.tasks[tid]
            r = (self.trader_slug(t.get("trader")) in traders and (t.get("minPlayerLevel") or 0) <= 10
                 and self.trader_ll(t) <= 1 and self.batch_req(t) <= max_batch
                 and not any(fc.get("type") == "taskStatus" for fc in t.get("failConditions") or []))
            if r:
                for q in t.get("taskRequirements") or []:
                    p = q.get("task")
                    if p in self.tasks and p not in stack and not ok(p, stack + (tid,)):
                        r = False
                        break
            memo[tid] = r
            return r

        return [x for x in self.tasks if ok(x)]

    def trader_ll(self, t):
        return max((r.get("value") or 0 for r in t.get("traderRequirements") or []
                    if r.get("requirementType") == "level"), default=1) or 1

    def batch_req(self, t):
        return max((o.get("value") or 0 for o in t.get("otherRequirements") or [] if o.get("type") == "globalVariable"), default=0)

    def tier(self, t):
        """상인별 목록의 묶음 표시: (정렬 키, 라벨)"""
        ll = self.trader_ll(t)
        b = self.batch_req(t)
        chain = bool(t.get("taskRequirements"))
        label = f"LL{ll}"
        if b:
            label += f" · 묶음 {b}"
        if chain:
            label += " · 연쇄"
        return (ll, b, self.depth(t["id"]) if chain else 0), label

    def task_maps(self, t):
        """퀘스트에 관련된 지도 id(대표 지도 우선, 목표 지도 합침, 변형 제외)"""
        out = []
        mp = t.get("map")
        mid = mp.get("id") if isinstance(mp, dict) else mp
        if mid:
            out.append(mid)
        for o in t.get("objectives") or []:
            for m in o.get("maps") or []:
                mid2 = m.get("id") if isinstance(m, dict) else m
                if mid2:
                    out.append(mid2)
            for z in o.get("zones") or []:
                if z.get("map"):
                    out.append(z["map"])
            for loc in o.get("possibleLocations") or []:
                if loc.get("map"):
                    out.append(loc["map"])
        seen, res = set(), []
        for m in out:
            slug = (self.maps.get(m) or {}).get("normalizedName")
            if not slug:
                continue
            base = MAP_VARIANTS.get(slug, slug)
            if base in seen:
                continue
            seen.add(base)
            res.append(self.map_by_slug.get(base, m))
        return res

    def needed_items(self, t):
        """미리 챙길 것: 제출(giveItem) + 설치(plantItem) + 표시(mark 마커) 아이템을 묶는다."""
        agg: dict[tuple, dict] = {}
        groups = []
        for o in t.get("objectives") or []:
            ty = o.get("type")
            if ty in ("giveItem", "plantItem", "sellItem"):
                ids = [i for i in o.get("items") or [] if i]
                if not ids:
                    continue
                c = o.get("count") or 1
                if len(ids) == 1:
                    k = (ids[0], bool(o.get("foundInRaid")))
                    a = agg.setdefault(k, {"id": ids[0], "fir": k[1], "c": 0, "opt": True})
                    a["c"] += c
                    a["opt"] = a["opt"] and bool(o.get("optional"))
                else:
                    groups.append({"ids": ids, "c": c, "fir": bool(o.get("foundInRaid"))})
            elif ty == "mark" and o.get("markerItem"):
                mi = o["markerItem"].get("id") if isinstance(o["markerItem"], dict) else o["markerItem"]
                k = (mi, False)
                a = agg.setdefault(k, {"id": mi, "fir": False, "c": 0, "opt": False})
                a["c"] += o.get("count") or 1
        return list(agg.values()), groups


# ─────────────────────────────────────────────────────────────
# 레이아웃
# ─────────────────────────────────────────────────────────────

def page(ctx: Ctx, *, path: str, title: str, desc: str, body: str, nav: str = "", crumbs=None,
         og_type: str = "article", extra_head: str = "", scripts: str = "") -> str:
    url = SITE + lang_path(path)
    crumbs = crumbs or []
    navhtml = nav_html(nav, path)  # <nav>…</nav> + 언어 전환 + '시세 오버레이' 링크(형제)
    crumb_html = ""
    ld = []
    if crumbs:
        items = [("탈콥 가이드", "/guide/")] + crumbs
        crumb_html = '<nav class="crumbs" aria-label="경로">' + " › ".join(
            (f'<a href="{href}">{e(name)}</a>' if href and i < len(items) - 1 else f"<span>{e(name)}</span>")
            for i, (name, href) in enumerate(items)) + "</nav>"
        ld.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, **({"item": SITE + lang_path(href)} if href else {})}
            for i, (name, href) in enumerate(items)]})
    og_locale = dict((l, loc) for l, _, loc in LANGS)[LANG]
    ld_html = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)
    ads_html = (f'\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={ADSENSE_CLIENT}" crossorigin="anonymous"></script>'
                if ADSENSE_CLIENT else "")
    return f"""<!doctype html>
<html lang="{LANG}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}" />
<link rel="canonical" href="{e(url)}" />
{hreflang_html(path)}<meta property="og:type" content="{og_type}" />
<meta property="og:site_name" content="탈콥 가이드 · 타르코프 시세 오버레이" />
<meta property="og:title" content="{e(title)}" />
<meta property="og:description" content="{e(desc)}" />
<meta property="og:url" content="{e(url)}" />
<meta property="og:image" content="{SITE}/og.png" />
<meta property="og:locale" content="{og_locale}" />
<meta name="theme-color" content="#c8aa64" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="stylesheet" href="/guide/guide.css" />
{ld_html}{extra_head}{ads_html}
</head>
<body>
<div class="top"><div class="wrap">
  <a class="brand" href="/guide/">탈콥 가이드</a>
  {navhtml}
</div></div>
<main class="wrap">
{crumb_html}
{body}
<div class="cta"><span>레이드 중 아이템에 마우스 올리고 <b>F2 한 번</b> — 시세·퀘스트·은신처에 필요한지 바로 확인</span><a class="btn" href="/?src=guide">무료 시세 오버레이 받기</a></div>
</main>
<footer><div class="wrap">게임 데이터: <a href="https://tarkov.dev" rel="noopener">tarkov.dev</a> 공개 데이터(기준 {e(ctx.stamp)}) · 설명 문구는 <a href="https://escapefromtarkov.fandom.com/" rel="noopener">공식 위키</a>와 패치 노트를 참고해 직접 정리 · 체크 표시는 이 브라우저에만 저장 · <a href="/guide/">가이드 홈</a> · <a href="/status/">서비스 상태</a> · <a href="/about/">소개</a> · <a href="/privacy/">개인정보처리방침</a> · <a href="/">타르코프 시세 오버레이</a></div></footer>
<script src="/guide/sync.js" defer></script>
{scripts}
<script defer src="/_vercel/insights/script.js"></script>
<script src="/beacon.js"></script>
</body>
</html>
"""


def write(out: Path, path: str, html_text: str, urls: list):
    dest = out / path.strip("/").removeprefix("guide/") / "index.html" if path != "/guide/" else out / "index.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if LANG != "ko":
        html_text = localize_html(html_text)
    dest.write_text(html_text, encoding="utf-8")
    urls.append(path)


# ─────────────────────────────────────────────────────────────
# 퀘스트 상세
# ─────────────────────────────────────────────────────────────

OBJ_ICON = {"giveItem": "📦", "findItem": "🔎", "findQuestItem": "🔎", "giveQuestItem": "📨", "plantItem": "📍",
            "plantQuestItem": "📍", "mark": "📡", "visit": "🧭", "shoot": "🎯", "extract": "🚪", "buildWeapon": "🔧",
            "skill": "📈", "traderLevel": "🤝", "traderStanding": "🤝", "taskStatus": "🔗", "useItem": "💉",
            "sellItem": "💰", "experience": "⭐", "globalVariable": "⚠", "dialogue": "💬", "playerLevel": "⭐"}


def _cmp(c):
    return {">=": "≥", "<=": "≤", ">": ">", "<": "<", "==": "="}.get(c or ">=", c)


def _flat(ids):
    out = []
    for x in ids or []:
        if isinstance(x, list):
            out.extend(_flat(x))
        elif isinstance(x, dict):
            out.append(x.get("id") or x.get("item"))
        else:
            out.append(x)
    return [i for i in out if i]


def _join_tags(xs):
    return " ".join(x for x in xs if x)


def objective_html(ctx: Ctx, o: dict) -> str:
    ty = o.get("type")
    desc = ctx.tk(o.get("description"), None)
    if not desc or desc == o.get("description"):
        desc = {"giveItem": "아이템 제출", "findItem": "레이드에서 아이템 찾기", "shoot": "적 처치",
                "visit": "지역 방문", "extract": "탈출", "mark": "마커 설치", "plantItem": "아이템 숨기기"}.get(ty, ty)
    bits = []
    cnt = o.get("count")
    if ty in ("shoot", "extract", "experience") and cnt and cnt > 1:
        bits.append(f'<span class="badge b-cnt">×{fmt_int(cnt)}</span>')
    if o.get("optional"):
        bits.append('<span class="badge b-any">선택</span>')
    detail = []
    if ty in ("giveItem", "findItem", "plantItem", "sellItem"):
        detail.append(ctx.chips_alt(o.get("items"), cnt, bool(o.get("foundInRaid"))))
        if o.get("dogTagLevel"):
            detail.append(f'<div class="osub">인식표 레벨 {o["dogTagLevel"]} 이상</div>')
        if (o.get("minDurability") or 0) > 0 or (o.get("maxDurability") or 100) < 100:
            detail.append(f'<div class="osub">내구도 {o.get("minDurability", 0)}~{o.get("maxDurability", 100)}%</div>')
    elif ty in ("findQuestItem", "giveQuestItem", "plantQuestItem"):
        qi = o.get("questItem")
        qid = qi.get("id") if isinstance(qi, dict) else qi
        if qid:
            detail.append(f'<div class="chips">{ctx.chip(qid, cnt)}</div>')
    elif ty == "mark" and o.get("markerItem"):
        mi = o["markerItem"].get("id") if isinstance(o["markerItem"], dict) else o["markerItem"]
        detail.append(f'<div class="chips">{ctx.chip(mi)}</div>')
    elif ty == "shoot":
        tg = list(dict.fromkeys(TARGETS.get(n) or ctx.mob_name(n) for n in o.get("targetNames") or []))
        sub = []
        if tg and tg != ["아무 대상"]:
            sub.append("대상: " + ", ".join(e(x) for x in tg))
        if o.get("shotType") == "hit":
            sub.append("명중만 해도 인정")
        parts = [BODY.get(str(b).rsplit("/", 1)[-1], str(b).rsplit("/", 1)[-1]) for b in o.get("bodyParts") or []]
        if parts:
            sub.append("부위: " + ", ".join(e(p) for p in parts))
        dist = o.get("distance") or {}
        if (dist.get("value") or 0) > 0:
            sub.append(f'거리 {_cmp(dist.get("compareMethod"))} {fmt_int(dist["value"])}m')
        if o.get("timeFromHour") or o.get("timeUntilHour"):
            sub.append(f'게임 시간 {o.get("timeFromHour", 0)}시~{o.get("timeUntilHour", 0)}시')
        if sub:
            detail.append('<div class="osub">' + " · ".join(sub) + "</div>")
        for label, key in (("사용 무기", "usingWeapon"), ("필요 부착물", "usingWeaponMods"),
                           ("착용 필요", "wearing"), ("착용 금지", "notWearing")):
            ids = _flat(o.get(key))
            if ids:
                detail.append(f'<div class="sublabel">{label}</div>' + ctx.chips_alt(ids))
    elif ty == "extract":
        st = []
        for s in o.get("exitStatus") or []:
            s2 = str(s)
            st.append("생존" if "Survived" in s2 else "런스루" if "Runner" in s2 else "이동(트랜짓)" if "Transit" in s2 else s2)
        sub = []
        if st:
            sub.append("상태: " + " 또는 ".join(dict.fromkeys(st)))
        if o.get("exitName"):
            sub.append("탈출구: " + e(ctx._loc(ctx.loc_maps, o["exitName"], o["exitName"])))
        if sub:
            detail.append('<div class="osub">' + " · ".join(sub) + "</div>")
    elif ty == "buildWeapon":
        it = o.get("item")
        iid = it.get("id") if isinstance(it, dict) else it
        if iid:
            detail.append(f'<div class="chips">{ctx.chip(iid)}</div>')
        reqs = []
        for k, v in (o.get("buildAttributes") or {}).items():
            if isinstance(v, dict) and (v.get("value") or 0) > 0:
                reqs.append(f'{BUILD_ATTR.get(k, k)} {_cmp(v.get("compareMethod"))} {fmt_int(v["value"])}')
        if reqs:
            detail.append('<div class="osub">조건: ' + e(" · ".join(reqs)) + "</div>")
        need = _flat(o.get("containsAll"))
        if need:
            detail.append('<div class="sublabel">반드시 포함할 부품</div><div class="chips">' + "".join(ctx.chip(i) for i in need) + "</div>")
    elif ty == "skill":
        sk = o.get("skill")
        name = ctx.skill_name(sk.get("name") if isinstance(sk, dict) else sk)
        detail.append(f'<div class="osub">{e(name)} {o.get("level")}레벨</div>')
    elif ty == "traderLevel":
        detail.append(f'<div class="osub">{e(ctx.trader_name(o.get("trader")))} LL{o.get("level")}</div>')
    elif ty == "traderStanding":
        detail.append(f'<div class="osub">{e(ctx.trader_name(o.get("trader")))} 평판 {_cmp(o.get("compareMethod"))} {o.get("value")}</div>')
    elif ty == "taskStatus" and o.get("task") in ctx.tasks:
        st = " · ".join(STATUS.get(s, s) for s in o.get("status") or [])
        detail.append(f'<div class="osub">{ctx.task_link(o["task"])} {e(st)}</div>')
    elif ty == "useItem":
        detail.append(ctx.chips_alt(_flat(o.get("useAny")), cnt))
    keys = _flat(o.get("requiredKeys"))
    if keys:
        detail.append('<div class="sublabel">열쇠</div>' + ctx.chips_alt(keys))
    maps = []
    for m in o.get("maps") or []:
        mid = m.get("id") if isinstance(m, dict) else m
        if mid and mid not in maps:
            maps.append(mid)
    for z in o.get("zones") or []:
        if z.get("map") and z["map"] not in maps:
            maps.append(z["map"])
    for loc in o.get("possibleLocations") or []:
        if loc.get("map") and loc["map"] not in maps:
            maps.append(loc["map"])
    links = ctx.map_links(maps)  # 변형(21+·야간)은 대표 지도로 합쳐 한 번만
    if links:
        detail.append('<div class="osub">지도: ' + links + "</div>")
    icon = OBJ_ICON.get(ty, "•")
    return (f'<li class="obj"><span class="oi" aria-hidden="true">{icon}</span><div class="ob">'
            f'<div class="od">{e(desc)} {_join_tags(bits)}</div>{"".join(x for x in detail if x)}</div></li>')


def rewards_html(ctx: Ctx, t: dict, side: str = "finishRewards") -> str:
    rw = t.get(side) or {}
    rows = []
    if side == "finishRewards" and t.get("experience"):
        rows.append(("경험치", f'<b>+{fmt_int(t["experience"])}</b>'))
    st = rw.get("traderStanding") or []
    if st:
        parts = []
        for x in st:
            v = x.get("standing") or 0
            sign = "+" if v >= 0 else ""
            parts.append(f'{e(ctx.trader_name(x.get("trader")))} <b>{sign}{v}</b>')
        rows.append(("상인 평판", ", ".join(parts)))
    its = rw.get("items") or []
    if its:
        rows.append(("아이템", '<div class="chips">' + "".join(ctx.chip(x.get("item"), x.get("count")) for x in its) + "</div>"))
    ou = rw.get("offerUnlock") or []
    if ou:
        rows.append(("구매 해금", '<div class="chips">' + "".join(
            ctx.chip(x.get("item"), extra=f' <span class="muted small">{e(ctx.trader_name(x.get("trader")))} LL{x.get("level")}</span>')
            for x in ou) + "</div>"))
    cu = rw.get("craftUnlock") or []
    if cu:
        rows.append(("제작 해금", '<div class="chips">' + "".join(
            ctx.chip(x.get("item"), x.get("count"), extra=f' <span class="muted small">{e(ctx.station_name(x.get("station")))} {x.get("level")}단계</span>')
            for x in cu) + "</div>"))
    sk = rw.get("skillLevelReward") or []
    if sk:
        rows.append(("스킬", ", ".join(f'{e(ctx.skill_name(x.get("skill")))} +{x.get("level")}' for x in sk)))
    tu = rw.get("traderUnlock") or []
    if tu:
        rows.append(("상인 해금", ", ".join(
            f'<b>{e(ctx.trader_name(x.get("trader") if isinstance(x, dict) else x))}</b>' for x in tu)))
    ach = rw.get("achievement") or []
    if ach:
        names = []
        for a in ach:
            aid = a.get("id") if isinstance(a, dict) else a
            ad = ctx.achievements.get(aid) or {}
            names.append(e(ctx.tk(ad.get("name"), aid)))
        rows.append(("업적", ", ".join(names)))
    cz = rw.get("customization") or []
    if cz:
        rows.append(("꾸미기", f"{len(cz)}개 (은신처·제스처·인식표 등)"))
    if not rows:
        return ""
    return '<table class="kv">' + "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows) + "</table>"


def requirements_html(ctx: Ctx, t: dict) -> str:
    rows = []
    lv = t.get("minPlayerLevel") or 0
    rows.append(("레벨", f"{lv} 이상" if lv > 1 else "제한 없음"))
    tr_req = [r for r in t.get("traderRequirements") or [] if r.get("requirementType") == "level"]
    rows.append(("상인 등급", ", ".join(f'{e(ctx.trader_name(r.get("trader")))} LL{r.get("value")} 이상' for r in tr_req) or "LL1"))
    reqs = [r for r in t.get("taskRequirements") or [] if r.get("task") in ctx.tasks]
    if reqs:
        lines = []
        for r in reqs:
            st = " · ".join(STATUS.get(s, s) for s in r.get("status") or [])
            lines.append(f'{ctx.task_link(r["task"])} <span class="muted small">{e(st)}</span>')
        rows.append(("선행 퀘스트", "<br>".join(lines)))
    b = ctx.batch_req(t)
    if b:
        rows.append(("묶음 해금", f'{e(ctx.trader_name(t.get("trader")))}의 앞 묶음 퀘스트 <b>{b}개</b> 완료 후 '
                               f'<span class="muted small">(1.1.0 묶음 방식)</span>'))
    for o in t.get("otherRequirements") or []:
        if o.get("type") == "dialogue":
            rows.append(("대화", ", ".join(e(ctx.trader_name(x)) for x in o.get("traders") or []) + "와 대화"))
    if t.get("factionName") in ("BEAR", "USEC"):
        rows.append(("진영", f'<b>{e(t["factionName"])}</b> 전용'))
    if t.get("availableDelaySecondsMin"):
        lo, hi = t.get("availableDelaySecondsMin") or 0, t.get("availableDelaySecondsMax") or 0
        rows.append(("대기", f"앞 퀘스트 완료 후 {fmt_dur(lo)}" + (f"~{fmt_dur(hi)}" if hi and hi != lo else "") + " 뒤"))
    return '<table class="kv">' + "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows) + "</table>"


QUEST_JS = """<script>
(function(){var K="guide.quests",d={};function rd(){try{d=JSON.parse(localStorage.getItem(K))||{}}catch(e){d={}}}rd();
var el=document.querySelector(".quest");if(!el)return;var id=el.getAttribute("data-id"),c=document.getElementById("qdone");c.checked=!!d[id];
function mark(){var sy=window.__guideSync;if(!sy)return;var lab=c.parentNode;if(!lab||lab.querySelector(".syn"))return;var st=(sy.completed||[]).indexOf(id)>=0?"완료":(sy.started||[]).indexOf(id)>=0?"진행 중":"";if(!st)return;var b=document.createElement("span");b.className="syn badge";b.textContent="오버레이: "+st;lab.appendChild(b)}
// '처음부터 순서' 목록: 완료한 선행 퀘스트(직접 체크 + 오버레이 연동)는 흐리게
function chainMark(){var sy=window.__guideSync,cp=(sy&&sy.completed)||[];document.querySelectorAll(".chain li[data-t]").forEach(function(li){var t=li.getAttribute("data-t");li.classList.toggle("done",!!d[t]||cp.indexOf(t)>=0)})}
chainMark();document.addEventListener("guide-sync",function(){rd();c.checked=!!d[id];mark();chainMark()});if(window.__guideSync)mark();
c.addEventListener("change",function(){if(c.checked)d[id]=1;else delete d[id];try{localStorage.setItem(K,JSON.stringify(d))}catch(e){}});
// ★ 즐겨찾기(guide.fav) — 사냥 퀘스트 페이지(/guide/hunt/)에서 모아 본다
var FK="guide.fav";function fr(){try{return JSON.parse(localStorage.getItem(FK))||{}}catch(e){return {}}}var fb=document.getElementById("qfav");
if(fb){fb.classList.toggle("on",!!fr()[id]);fb.addEventListener("click",function(){var f=fr();if(f[id])delete f[id];else f[id]=1;try{localStorage.setItem(FK,JSON.stringify(f))}catch(e){}fb.classList.toggle("on",!!f[id])})}})();
</script>"""


def _sig(x):
    return json.dumps([(o.get("type"), o.get("count"), sorted(o.get("items") or [])) for o in x.get("objectives") or []])


def quest_page(ctx: Ctx, tid: str) -> tuple[str, str]:
    t = ctx.tasks[tid]
    ko, en = ctx.task_names(tid)
    tr_id = t.get("trader")
    trn = ctx.trader_name(tr_id)
    trs = ctx.trader_slug(tr_id)
    modes = ctx.task_modes.get(tid, ["pvp", "pve"])
    en_label = en if en and en != ko else ""  # 번역이 없으면 영어 이름이 두 번 나오지 않게
    if ctx.display_suffix.get(tid):
        ko = f"{ko} ({ctx.display_suffix[tid]})"
    maps = ctx.task_maps(t)
    img = ctx.trader(tr_id).get("imageLink")
    tags = [f'<a class="tag tr" href="/guide/quests/{e(trs)}/">'
            + (f'<img src="{e(img)}" alt="" width="20" height="20" loading="lazy" />' if img else "")
            + f"{e(trn)}</a>"]
    lv = t.get("minPlayerLevel") or 0
    if lv > 1:
        tags.append(f'<span class="tag">레벨 {lv}+</span>')
    ll = ctx.trader_ll(t)
    if ll > 1:
        tags.append(f'<span class="tag">LL{ll}</span>')
    for mid in maps[:4]:
        tags.append(f'<span class="tag map">{ctx.map_link(mid)}</span>')
    if len(modes) == 1:
        tags.append(f'<span class="badge b-mode">{"PVE 전용" if modes[0] == "pve" else "PVP 전용"}</span>')
    if t.get("kappaRequired"):
        tags.append('<span class="badge b-kappa">카파 필수</span>')
    if t.get("lightkeeperRequired"):
        tags.append('<span class="badge b-lk">등대지기 필수</span>')
    if t.get("factionName") in ("BEAR", "USEC"):
        tags.append(f'<span class="badge b-any">{e(t["factionName"])} 전용</span>')
    if t.get("restartable"):
        tags.append('<span class="badge b-any">실패 시 재시작 가능</span>')
    tags.append(f'<button type="button" class="fav" id="qfav" data-t="{e(tid)}" aria-label="즐겨찾기" title="즐겨찾기 — 사냥 퀘스트 페이지에서 모아 보기">★</button>')

    objs = "".join(objective_html(ctx, o) for o in t.get("objectives") or [])
    sections_main = [wiki_diff_html(en, ctx.stamp) + f'<section class="box"><h2>목표 {len(t.get("objectives") or [])}개</h2><ol class="objs">{objs}</ol></section>']
    tp = ctx.tasks_pve.get(tid)
    if tp and tid in ctx.tasks_reg and _sig(tp) != _sig(ctx.tasks_reg[tid]):
        sections_main.append('<section class="box"><h2>PVE 버전 목표</h2><p class="small muted">PVE에서는 목표가 조금 다릅니다.</p><ol class="objs">'
                             + "".join(objective_html(ctx, o) for o in tp.get("objectives") or []) + "</ol></section>")
    keys_html = ""
    for nk in t.get("neededKeys") or []:
        ks = _flat(nk.get("keys"))
        if ks:
            mp = nk.get("map")
            mid = mp.get("id") if isinstance(mp, dict) else mp
            keys_html += f'<div class="keyrow"><span class="muted small">{ctx.map_link(mid) or "지도"}</span>{ctx.chips_alt(ks)}</div>'
    if keys_html:
        sections_main.append(f'<section class="box"><h2>필요한 열쇠</h2>{keys_html}</section>')
    fail = []
    for fc in t.get("failConditions") or []:
        if fc.get("type") == "taskStatus" and fc.get("task") in ctx.tasks:
            st = " · ".join(STATUS.get(s, s) for s in fc.get("status") or [])
            fail.append(f'{ctx.task_link(fc["task"])}을(를) {e(st)}하면 이 퀘스트는 <b>실패</b>합니다 (둘 중 하나만 가능).')
        else:
            d = ctx.tk(fc.get("description"), None)
            if d and d != fc.get("description"):
                fail.append(e(d))
    if fail:
        sections_main.append('<section class="box"><h2>실패 조건</h2><ul class="plain">' + "".join(f"<li>{x}</li>" for x in fail) + "</ul></section>")
    rw = rewards_html(ctx, t)
    sections_main.append(f'<section class="box"><h2>보상</h2>{rw or "<p class=muted>데이터에 보상 정보가 없습니다.</p>"}</section>')
    srw = rewards_html(ctx, t, "startRewards")
    if srw:
        sections_main.append(f'<section class="box"><h2>시작할 때 받는 것</h2>{srw}</section>')

    sections_side = [f'<section class="box"><h2>받는 조건</h2>{requirements_html(ctx, t)}</section>']
    need, groups = ctx.needed_items(t)
    if need or groups:
        need_sorted = sorted(need, key=lambda a: (not a["fir"], -a["c"]))
        sections_side.append('<section class="box"><h2>미리 챙길 아이템</h2><div class="chips">'
                             + "".join(ctx.chip(a["id"], a["c"], a["fir"]) for a in need_sorted) + "</div>"
                             + "".join(ctx.chips_alt(g["ids"], g["c"], g["fir"]) for g in groups) + "</section>")
    ch = ctx.chain(tid)
    if ch:
        lis = "".join(
            f'<li data-t="{e(q)}">{ctx.task_link(q)} <span class="muted small">{e(ctx.trader_name(ctx.tasks[q].get("trader")))}'
            + (f' · 레벨 {ctx.tasks[q].get("minPlayerLevel")}' if (ctx.tasks[q].get("minPlayerLevel") or 0) > 1 else "")
            + ("" if comp else " · 시작만 하면 됨") + "</span></li>" for q, comp in ch)
        sections_side.append(f'<section class="box"><h2>처음부터 순서 <span class="muted small">먼저 깰 퀘스트 {len(ch)}개</span></h2>'
                             f'<ol class="chain">{lis}<li class="tgt">{e(ko)} <span class="muted small">이 퀘스트</span></li></ol>'
                             '<p class="muted small">선행 조건을 끝까지 거슬러 올라가 먼저 하는 순서로 늘어놓았습니다. 완료로 표시한 퀘스트는 흐리게 보입니다.</p></section>')
    nxt = sorted(set(ctx.next_of.get(tid, [])), key=lambda x: ctx.task_names(x)[0])
    if nxt:
        lis = "".join(f'<li>{ctx.task_link(x)} <span class="muted small">{e(ctx.trader_name(ctx.tasks[x].get("trader")))}</span></li>' for x in nxt)
        sections_side.append(f'<section class="box"><h2>다음 퀘스트</h2><ul class="plain">{lis}</ul></section>')
    else:
        sections_side.append('<section class="box"><h2>다음 퀘스트</h2><p class="muted small">이 퀘스트를 선행 조건으로 삼는 퀘스트는 없습니다. '
                             '1.1.0 이후 대부분은 상인 등급·묶음으로 열립니다.</p></section>')
    refs = []
    if t.get("wikiLink"):
        refs.append(f'<a href="{e(t["wikiLink"])}" target="_blank" rel="noopener">공식 위키(영문)</a>')
    refs.append(f'<a href="https://tarkov.dev/task/{e(t.get("normalizedName"))}" target="_blank" rel="noopener">tarkov.dev</a>')
    sections_side.append(f'<section class="box"><h2>더 보기</h2><p class="small">{" · ".join(refs)}</p></section>')

    body = (f'<article class="quest" data-id="{e(tid)}">'
            f'<h1>{e(ko)}' + (f' <span class="h1en">{e(en_label)}</span>' if en_label else "") + '</h1>'
            f'<div class="tags">{"".join(tags)}</div>'
            f'<label class="donebox"><input type="checkbox" id="qdone" /> 완료로 표시 <span class="muted small">(퀘스트 목록과 같이 저장)</span></label>'
            f'<div class="cols"><div class="col-main">{"".join(sections_main)}</div>'
            f'<aside class="col-side">{"".join(sections_side)}</aside></div></article>')
    map_txt = ", ".join(ctx.map_name(m) for m in maps[:3]) or "모든 지역"
    title = f"{ko} 퀘스트 공략 — {trn} · 목표·필요템·보상 | 타르코프(탈콥) 가이드"
    desc = (f"타르코프 {trn} 퀘스트 '{ko}'({en}) 공략: 목표 {len(t.get('objectives') or [])}개, 필요 아이템·열쇠, 보상, "
            f"받는 조건과 다음 퀘스트. 지역: {map_txt}. 데이터 기준 {ctx.stamp}.")
    html_text = page(ctx, path=ctx.task_url(tid), title=title, desc=desc, body=body, nav="quests",
                     crumbs=[("퀘스트", "/guide/quests/"), (trn, f"/guide/quests/{trs}/"), (ko, None)], scripts=QUEST_JS)
    return ctx.task_url(tid), html_text


# ─────────────────────────────────────────────────────────────
# 상인별 퀘스트 순서
# ─────────────────────────────────────────────────────────────

def _fir_need(t):
    n = 0
    for o in t.get("objectives") or []:
        if o.get("type") == "giveItem" and o.get("foundInRaid") and not o.get("optional"):
            n += o.get("count") or 1
    return n


def trader_page(ctx: Ctx, tr_id: str, tids: list[str]) -> tuple[str, str]:
    tr = ctx.trader(tr_id)
    name = ctx.trader_name(tr_id)
    slug = ctx.trader_slug(tr_id)
    desc_ko = ctx._loc(ctx.loc_traders, tr.get("description"), "")
    rows = []
    for tid in tids:
        t = ctx.tasks[tid]
        key, label = ctx.tier(t)
        rows.append((key + ((t.get("minPlayerLevel") or 0), ctx.task_names(tid)[0]), label, tid))
    rows.sort()
    trs = []
    last = None
    for _, label, tid in rows:
        t = ctx.tasks[tid]
        tier = label.split(" · ")[0]
        if tier != last:
            trs.append(f'<tr class="grp"><td colspan="5">{e(tier)} 퀘스트</td></tr>')
            last = tier
        modes = ctx.task_modes.get(tid, [])
        badges = []
        if t.get("kappaRequired"):
            badges.append('<span class="badge b-kappa">카파</span>')
        if t.get("lightkeeperRequired"):
            badges.append('<span class="badge b-lk">등대지기</span>')
        if len(modes) == 1:
            badges.append(f'<span class="badge b-mode">{"PVE" if modes[0] == "pve" else "PVP"}</span>')
        maps = ", ".join(e(ctx.map_name(m)) for m in ctx.task_maps(t)[:2]) or '<span class="muted">아무 곳</span>'
        fir = _fir_need(t)
        trs.append(f'<tr data-q="{e(tid)}"><td><span class="muted small">{e(label)}</span></td>'
                   f'<td>{ctx.task_link(tid)} {" ".join(badges)}<div class="muted small">{e(ctx.task_names(tid)[1])}</div></td>'
                   f'<td class="n">{t.get("minPlayerLevel") or 1}</td><td>{maps}</td>'
                   f'<td class="n">{("인레이드 " + str(fir)) if fir else ""}</td></tr>')
    lv_rows = ""
    for lv in tr.get("levels") or []:
        req = []
        if lv.get("requiredPlayerLevel"):
            req.append(f'레벨 {lv["requiredPlayerLevel"]}')
        if lv.get("requiredReputation"):
            req.append(f'평판 {lv["requiredReputation"]}')
        if lv.get("requiredCommerce"):
            req.append(f'거래액 {fmt_int(lv["requiredCommerce"])}')
        lv_rows += f'<tr><th>LL{lv.get("level")}</th><td>{" · ".join(req) or "처음부터"}</td></tr>'
    img = tr.get("imageLink")
    kappa_n = sum(1 for x in tids if ctx.tasks[x].get("kappaRequired"))
    img_html = f'<img src="{e(img)}" alt="{e(name)}" width="96" height="96" loading="lazy" />' if img else ""
    head = (f'<div class="trhead">{img_html}'
            f'<div><h1>{e(name)} 퀘스트 순서 <span class="h1en">{e(tr.get("normalizedName", "").title())}</span></h1>'
            f'<p class="sub">전체 {len(tids)}개 · 카파 필수 {kappa_n}개 · 데이터 기준 {e(ctx.stamp)}</p>'
            f'<p class="small muted">{e(desc_ko)}</p></div></div>')
    note = ('<div class="note">1.1.0 이후 사이드 퀘스트는 대부분 <b>상인 등급(LL)별 2~4개 묶음</b>으로 열립니다. '
            '같은 묶음의 퀘스트를 몇 개 깨거나 상인 등급을 올리면 다음 묶음이 열리고, 일부만 예전처럼 연쇄로 이어집니다. '
            '아래 표는 <b>LL → 묶음 → 연쇄 깊이 → 레벨</b> 순으로 정렬해 "먼저 받게 되는 순서"에 가깝게 맞췄습니다.</div>')
    body = (head + note
            + (f'<section class="box"><h2>상인 등급 조건</h2><table class="kv">{lv_rows}</table></section>' if lv_rows else "")
            + '<div class="box tbl" style="padding:4px 8px"><table class="tot qtbl"><thead><tr><th>해금</th><th>퀘스트</th>'
            '<th class="n">레벨</th><th>지역</th><th class="n">제출</th></tr></thead><tbody>' + "".join(trs) + "</tbody></table></div>")
    path = f"/guide/quests/{slug}/"
    title = f"타르코프 {name} 퀘스트 순서 — 전체 {len(tids)}개 해금 조건·필요템 | 탈콥 가이드"
    desc = f"타르코프 {name} 퀘스트 {len(tids)}개를 해금 순서(상인 등급·묶음·연쇄)대로 정리. 레벨, 지역, 인레이드 제출 개수, 카파 필수 여부까지. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="quests",
                      crumbs=[("퀘스트", "/guide/quests/"), (name, None)])


# ─────────────────────────────────────────────────────────────
# 필요 아이템 총정리 (퀘스트 + 은신처)
# ─────────────────────────────────────────────────────────────

def item_needs(ctx: Ctx, tasks: dict, hideout: dict):
    q: dict[str, dict] = {}
    h: dict[str, dict] = {}
    money = {"quest": {}, "hideout": {}}
    for tid, t in tasks.items():
        for o in t.get("objectives") or []:
            if o.get("type") != "giveItem" or o.get("optional"):
                continue
            ids = [i for i in o.get("items") or [] if i]
            if len(ids) != 1:
                continue
            iid, c = ids[0], o.get("count") or 1
            if iid in MONEY:
                money["quest"][iid] = money["quest"].get(iid, 0) + c
                continue
            a = q.setdefault(iid, {"fir": 0, "any": 0, "where": [], "parts": []})
            a["fir" if o.get("foundInRaid") else "any"] += c
            a["parts"].append((tid, 1 if o.get("foundInRaid") else 0, c))  # 연동: 완료 퀘스트 분을 브라우저에서 뺀다
            if tid not in a["where"]:
                a["where"].append(tid)
    for sid, st in hideout.items():
        for lv in st.get("levels") or []:
            for r in lv.get("itemRequirements") or []:
                it = r.get("item")
                iid = it.get("id") if isinstance(it, dict) else it
                c = r.get("count") or 1
                if not iid:
                    continue
                if iid in MONEY:
                    money["hideout"][iid] = money["hideout"].get(iid, 0) + c
                    continue
                fir = bool((r.get("attributes") or {}).get("foundInRaid"))
                a = h.setdefault(iid, {"fir": 0, "any": 0, "where": [], "parts": []})
                a["fir" if fir else "any"] += c
                a["parts"].append((sid, lv.get("level") or 1, 1 if fir else 0, c))
                a["where"].append((sid, lv.get("level")))
    return q, h, money


def _parts_q(a: dict) -> str:
    """퀘스트 내역 직렬화 'tid:fir:count;…' — 연동 JS가 완료 퀘스트 분을 뺄 때 쓴다"""
    return ";".join(f"{t}:{f}:{c}" for t, f, c in (a.get("parts") or []))


def _parts_h(a: dict) -> str:
    """은신처 내역 'sid:lv:fir:count;…' — 연동 JS가 이미 지은 단계 분을 뺀다"""
    return ";".join(f"{sid}:{lv}:{f}:{c}" for sid, lv, f, c in (a.get("parts") or []))


ITEMS_JS = """<script>
(function(){var KEY="guide.items.have",MK="guide.mode";function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}
function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var have=L(KEY,{}),mode=L(MK,"pvp"),scope="all",rows=[].slice.call(document.querySelectorAll("#itbl tbody tr"));
function seg(id,v){document.querySelectorAll("#"+id+" button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)})}
// 연동/체크 반영: 완료 퀘스트(guide.quests — 직접 체크 + 오버레이 연동)와 지은 은신처 단계(연동) 분을 뺀 필요량
function needs(d,p){var done=L("guide.quests",{}),sy=window.__guideSync||L("guide.sync",null),hl=(sy&&sy.hideout)||{},qf=0,qa=0,hf=0,ha=0,cut=false;
(d[p+"q"]||"").split(";").forEach(function(x){if(!x)return;var a=x.split(":"),t=a[0],f=a[1]==="1",c=+a[2]||0;if(done[t]){cut=true;return}if(f)qf+=c;else qa+=c});
(d[p+"h"]||"").split(";").forEach(function(x){if(!x)return;var a=x.split(":"),sid=a[0],lv=+a[1]||1,f=a[2]==="1",c=+a[3]||0;if((+hl[sid]||0)>=lv){cut=true;return}if(f)hf+=c;else ha+=c});
return {qf:qf,qa:qa,hf:hf,ha:ha,cut:cut}}
function render(){var q=document.getElementById("q").value.trim().toLowerCase(),fo=document.getElementById("firOnly").checked,hh=document.getElementById("hideHave").checked,shown=0,cutn=0;
rows.forEach(function(r){var d=r.dataset,p=mode==="pve"?"e":"p",nd=needs(d,p),qf=nd.qf,qa=nd.qa,hf=nd.hf,ha=nd.ha;if(nd.cut)cutn++;r.classList.toggle("cut",nd.cut);
var qq=qf+qa,hc=hf+ha,ok=true;if(scope==="quest"&&!qq)ok=false;if(scope==="hideout"&&!hc)ok=false;if(!qq&&!hc)ok=false;
if(fo&&!(qf||hf))ok=false;if(q&&d.s.indexOf(q)<0&&d.s.indexOf(q.replace(/\\s+/g,""))<0)ok=false;var hv=!!have[d.id];if(hh&&hv)ok=false;
r.style.display=ok?"":"none";r.classList.toggle("done",hv);var c=r.querySelector("input");if(c)c.checked=hv;
var cells=r.querySelectorAll("td.n");cells[0].textContent=qf||"";cells[1].textContent=qa||"";cells[2].textContent=hf||"";cells[3].textContent=ha||"";cells[4].textContent=(qq+hc)||"";if(ok)shown++;});
document.getElementById("shown").textContent=shown;var cn=document.getElementById("cutn");if(cn)cn.textContent=cutn?("· 완료분 제외 "+cutn+"종"):"";
var nr=document.getElementById("norow");if(nr){nr.style.display=(shown||!q)?"none":"";var a=nr.querySelector("a");if(a)a.href="/guide/rewards/"+(q?"?q="+encodeURIComponent(q):"")}}
document.addEventListener("guide-sync",render);
seg("mode",mode);document.getElementById("mode").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;mode=v;S(MK,v);seg("mode",v);render()});
document.getElementById("scope").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;scope=v;seg("scope",v);render()});
["firOnly","hideHave"].forEach(function(id){document.getElementById(id).addEventListener("change",render)});document.getElementById("q").addEventListener("input",render);
var q0=new URLSearchParams(location.search).get("q");if(q0)document.getElementById("q").value=q0;
document.getElementById("itbl").addEventListener("change",function(e){var r=e.target.closest("tr");if(!r)return;if(e.target.checked)have[r.dataset.id]=1;else delete have[r.dataset.id];S(KEY,have);render()});
render();})();
</script>"""


def items_page(ctx: Ctx, collector_ids: set) -> tuple[str, str]:
    qp, hp, mp_ = item_needs(ctx, ctx.tasks_reg, ctx.hideout_reg)
    qe, he, me = item_needs(ctx, ctx.tasks_pve, ctx.hideout_pve)
    ids = set(qp) | set(hp) | set(qe) | set(he)

    def tot(d, iid):
        a = d.get(iid) or {}
        return (a.get("fir") or 0) + (a.get("any") or 0)

    def fir(d, iid):
        return (d.get(iid) or {}).get("fir") or 0

    # 인레이드 필요량이 많은 것부터 — 사서 낼 수 있는 탄약 수천 발이 맨 위로 오지 않게
    order = sorted(ids, key=lambda i: (-(fir(qp, i) + fir(hp, i)), -(tot(qp, i) + tot(hp, i)),
                                       -(tot(qe, i) + tot(he, i)), (ctx.item(i) or {}).get("n") or i))
    trs = []
    for iid in order:
        it = ctx.item(iid)
        if not it:
            continue
        a_q, a_h = qp.get(iid) or {}, hp.get(iid) or {}
        b_q, b_h = qe.get(iid) or {}, he.get(iid) or {}
        where = []
        for tid in (a_q.get("where") or b_q.get("where") or [])[:4]:
            where.append(ctx.task_link(tid))
        more_q = len(a_q.get("where") or b_q.get("where") or []) - 4
        if more_q > 0:
            where.append(f'<span class="muted">퀘스트 외 {more_q}개</span>')
        seen = set()
        for sid, lv in (a_h.get("where") or b_h.get("where") or []):
            if (sid, lv) in seen:
                continue
            seen.add((sid, lv))
            if len(seen) > 4:
                break
            where.append(ctx.station_link(sid, lv))
        kappa = ' <span class="badge b-kappa">카파</span>' if iid in collector_ids else ""
        price = it.get("pvp")
        price_html = f'<span class="price">{fmt_int(price)}₽</span>' if price else ('<span class="muted small">거래 불가</span>' if it.get("noflea") else "")
        s = (it["n"] + " " + (it.get("en") or "") + " " + (it.get("s") or "")).lower()
        s = s + " " + s.replace(" ", "")  # 띄어 쓴 이름도 붙여 쓴 검색어로 찾히게
        img = f'<img class="icon sm" loading="lazy" alt="" src="{e(it["img"])}" />' if it.get("img") else ""
        trs.append(
            f'<tr data-id="{e(iid)}" data-s="{e(s)}" data-pqf="{a_q.get("fir", 0)}" data-pqa="{a_q.get("any", 0)}" data-phf="{a_h.get("fir", 0)}" data-pha="{a_h.get("any", 0)}" '
            f'data-eqf="{b_q.get("fir", 0)}" data-eqa="{b_q.get("any", 0)}" data-ehf="{b_h.get("fir", 0)}" data-eha="{b_h.get("any", 0)}" '
            f'data-pq="{_parts_q(a_q)}" data-eq="{_parts_q(b_q)}" data-ph="{_parts_h(a_h)}" data-eh="{_parts_h(b_h)}">'
            f'<td><input type="checkbox" aria-label="보유" /></td><td><span class="itn">{img}<span>{e(it["n"])}{kappa}<br><span class="muted small">{e(it.get("en") or "")}</span></span></span></td>'
            f'<td class="n">{a_q.get("fir") or ""}</td><td class="n">{a_q.get("any") or ""}</td><td class="n">{a_h.get("fir") or ""}</td><td class="n">{a_h.get("any") or ""}</td>'
            f'<td class="n"><b>{(tot(qp, iid) + tot(hp, iid)) or ""}</b></td><td>{price_html}</td><td class="small">{" · ".join(where)}</td></tr>')

    def money_line(m):
        parts = [ctx.money(k, m[k]) for k in MONEY if k in m]
        return " + ".join(p for p in parts if p) or "없음"
    fir_q = sum((a.get("fir") or 0) for a in qp.values())
    fir_h = sum((a.get("fir") or 0) for a in hp.values())
    body = f"""<h1>퀘스트·은신처 필요 아이템 총정리 <span class="h1en">버리면 안 되는 템</span></h1>
<p class="sub">퀘스트 제출 + 은신처 건설에 들어가는 아이템 {len(trs)}종 · PVP 기준 인레이드 필요: 퀘스트 {fir_q:,}개, 은신처 {fir_h:,}개 · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note">숫자는 <b>모든 퀘스트·모든 은신처 단계</b>에 들어가는 총량입니다. <b>인레이드</b> 칸은 레이드에서 직접 주운 상태(Found in Raid)여야 하는 수량, <b>일반</b> 칸은 플리·상인에서 사도 되는 수량입니다.
"아무거나 N개"처럼 여러 아이템 중 고르는 제출은 각 퀘스트 페이지에서 확인하세요. 체크하면 '보유'로 표시되고 이 브라우저에만 저장됩니다.</div>
<section class="box"><h2>필요한 돈</h2><table class="kv"><tr><th>퀘스트 제출</th><td>PVP {e(money_line(mp_["quest"]))} · PVE {e(money_line(me["quest"]))}</td></tr><tr><th>은신처 건설</th><td>PVP {e(money_line(mp_["hideout"]))} · PVE {e(money_line(me["hideout"]))}</td></tr></table></section>
<div class="controls"><input type="search" id="q" placeholder="아이템 이름 검색 (한글·영문)" aria-label="검색" />
<div class="seg" id="scope"><button data-v="all" class="on">전체</button><button data-v="quest">퀘스트</button><button data-v="hideout">은신처</button></div>
<div class="seg" id="mode"><button data-v="pvp" class="on">PVP</button><button data-v="pve">PVE</button></div>
<label class="chk"><input type="checkbox" id="firOnly" /> 인레이드 필요만</label><label class="chk"><input type="checkbox" id="hideHave" /> 보유 체크 숨기기</label>
<span class="muted small"><span id="shown">{len(trs)}</span>종 표시 <span id="cutn"></span></span></div>
<div class="box tbl" style="padding:4px 8px"><table class="tot" id="itbl"><thead><tr><th></th><th>아이템</th><th class="n">퀘스트<br>인레이드</th><th class="n">퀘스트<br>일반</th><th class="n">은신처<br>인레이드</th><th class="n">은신처<br>일반</th><th class="n">합계</th><th>플리 시세</th><th>쓰이는 곳</th></tr></thead><tbody>
{"".join(trs)}
</tbody></table></div>
<div class="note" id="norow" style="display:none">이 표에 없는 아이템이에요. 여기는 <b>퀘스트에 내거나 은신처에 넣는</b> 아이템만 모았습니다 — <b>퀘스트 보상으로 받는</b> 아이템(상자·파우치·열쇠 등)은 <a href="/guide/rewards/">보상으로 받는 아이템</a>에서 찾아보세요. 어떤 퀘스트가 주는지, 처음부터 어떤 순서로 깨야 하는지 나옵니다.</div>"""
    path = "/guide/items/"
    title = "타르코프 퀘스트·은신처 필요 아이템 총정리 — 버리면 안 되는 템, 인레이드 수량 | 탈콥 가이드"
    desc = f"타르코프 전체 퀘스트 제출 아이템과 은신처 건설 재료 {len(trs)}종을 한 표로. 인레이드(FiR) 필요 수량, 일반 수량, 플리 시세, 쓰이는 퀘스트·은신처 단계. PVP·PVE 전환. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="items",
                      crumbs=[("필요 아이템", None)], scripts=ITEMS_JS)


# ─────────────────────────────────────────────────────────────
# 퀘스트 보상으로 받는 아이템 — 어떤 퀘스트가 주는지 + 처음부터의 선행 사슬
# ─────────────────────────────────────────────────────────────

REWARDS_JS = """<script>
(function(){var Q=JSON.parse(document.getElementById("qd").textContent),T=Q.t,K="guide.quests";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}
var dmemo={};function depth(t,seen){if(dmemo[t]!=null)return dmemo[t];seen=seen||{};if(seen[t])return 0;seen[t]=1;var r=(T[t]&&T[t][3])||[],m=-1;for(var i=0;i<r.length;i++){var x=T[r[i][0]]?depth(r[i][0],seen):-1;if(x>m)m=x}return dmemo[t]=m+1}
// 선행 사슬: 끝까지 거슬러 올라가 모은 뒤 깊이(먼저 하는 것) → 레벨 → 이름 순
function chain(t){var need={},st=[t],seen={};seen[t]=1;while(st.length){var c=st.pop(),r=(T[c]&&T[c][3])||[];for(var i=0;i<r.length;i++){var q=r[i][0];if(!T[q])continue;need[q]=need[q]||r[i][1]===1;if(!seen[q]){seen[q]=1;st.push(q)}}}
var ids=Object.keys(need);ids.sort(function(a,b){return depth(a)-depth(b)||(T[a][2]-T[b][2])||(T[a][0]<T[b][0]?-1:1)});return ids.map(function(q){return [q,need[q]]})}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function li(q,d,cls,tail){var x=T[q];return '<li data-t="'+q+'" class="'+cls+(d?" done":"")+'"><a href="/guide/quest/'+x[4]+'/">'+esc(x[0])+'</a> <span class="muted small">'+esc(x[1])+(x[2]>1?" · 레벨 "+x[2]:"")+tail+(x[5]&&x[5].length===1?" · "+x[5][0].toUpperCase()+" 전용":"")+'</span></li>'}
function render(box){var t=box.getAttribute("data-t");if(!T[t])return;var done=L(K,{}),sy=window.__guideSync,cp=(sy&&sy.completed)||[],isd=function(q){return !!done[q]||cp.indexOf(q)>=0},ch=chain(t),left=0,first=null,h="";
ch.forEach(function(p){var d=isd(p[0]);if(!d){left++;if(!first)first=p[0]}h+=li(p[0],d,"",p[1]?"":" · 시작만 하면 됨")});
var td=isd(t);h+=li(t,td,"tgt"," · 이 퀘스트를 깨면 받음");
var sum=td?"이미 완료한 퀘스트예요":ch.length?(left?("먼저 깰 퀘스트 <b>"+left+"</b>개 남음 / 전체 "+ch.length+"개 · 시작점: <b>"+esc(T[first][0])+"</b>"):"선행 퀘스트를 다 끝냈어요 — 조건(레벨·상인 등급)만 맞으면 바로 받습니다"):"선행 퀘스트 없음 — 레벨·상인 등급 조건만 맞으면 바로 받습니다";
box.innerHTML='<div class="small csum">'+sum+'</div><ol class="chain">'+h+'</ol>'}
function renderOpen(){document.querySelectorAll("details.rw[open] .cbox").forEach(render)}
document.addEventListener("toggle",function(ev){var d=ev.target;if(d.tagName==="DETAILS"&&d.open)d.querySelectorAll(".cbox").forEach(render)},true);
document.addEventListener("guide-sync",renderOpen);
var rows=[].slice.call(document.querySelectorAll("details.rw")),scope="all",qi=document.getElementById("q");
function seg(id,v){document.querySelectorAll("#"+id+" button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)})}
function filter(auto){var q=qi.value.trim().toLowerCase(),qn=q.replace(/\\s+/g,""),n=0,vis=[];rows.forEach(function(r){var ok=true,s=r.getAttribute("data-s");if(scope!=="all"&&(r.getAttribute("data-k")||"").indexOf(scope)<0)ok=false;if(q&&s.indexOf(q)<0&&s.indexOf(qn)<0)ok=false;r.style.display=ok?"":"none";if(ok){n++;vis.push(r)}});
document.getElementById("shown").textContent=n;var ne=document.getElementById("none");if(ne)ne.style.display=n?"none":"";if(auto&&q.length>=2&&vis.length<=3)vis.forEach(function(r){if(!r.open)r.open=true})}
document.getElementById("scope").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;scope=v;seg("scope",v);filter(false)});
qi.addEventListener("input",function(){filter(true)});
var p=new URLSearchParams(location.search).get("q");if(p)qi.value=p;filter(true);})();
</script>"""


HUNT_JS = """<script>
(function(){var K="guide.quests",FK="guide.fav";function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var rows=[].slice.call(document.querySelectorAll(".hq")),list=document.getElementById("hl"),tg="all",mp="all",favOnly=false,hideDone=false,qi=document.getElementById("q");
var all=JSON.parse(document.getElementById("allq").textContent),hunt={};rows.forEach(function(r){hunt[r.getAttribute("data-t")]=1});
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function apply(){var f=L(FK,{}),d=L(K,{}),sy=window.__guideSync||L("guide.sync",null),cp=(sy&&sy.completed)||[],st=(sy&&sy.started)||[],q=qi.value.trim().toLowerCase(),n=0,nf=0;
rows.forEach(function(r){var t=r.getAttribute("data-t"),isf=!!f[t],done=!!d[t]||cp.indexOf(t)>=0,started=!done&&st.indexOf(t)>=0;
r.classList.toggle("isfav",isf);r.classList.toggle("done",done);r.querySelector(".fav").classList.toggle("on",isf);var b=r.querySelector(".stbadge");b.textContent=done?"완료":started?"진행 중":"";b.className="stbadge badge"+(done?" b-done":started?" b-run":"");b.style.display=b.textContent?"":"none";if(isf)nf++;
var ok=true;if(tg!=="all"&&(" "+r.getAttribute("data-tg")+" ").indexOf(" "+tg+" ")<0)ok=false;var dm=r.getAttribute("data-m"),mg=mp==="all"?0:(!dm?1:(("|"+dm+"|").indexOf("|"+mp+"|")>=0?0:2));if(mg===2)ok=false;if(favOnly&&!isf)ok=false;if(hideDone&&done)ok=false;if(q&&r.getAttribute("data-s").indexOf(q)<0)ok=false;
r.style.display=ok?"":"none";if(ok)n++;r._k=[isf?0:1,mg,done?1:0,+r.getAttribute("data-lv")]});
rows.slice().sort(function(a,b){for(var i=0;i<4;i++){if(a._k[i]!==b._k[i])return a._k[i]-b._k[i]}return 0}).forEach(function(r){list.appendChild(r)});
document.getElementById("shown").textContent=n;document.getElementById("nfav").textContent=nf;var ne=document.getElementById("none");ne.style.display=n?"none":"";
var o=document.getElementById("ofav"),h="";Object.keys(f).forEach(function(t){if(hunt[t]||!all[t])return;h+='<li><a href="/guide/quest/'+all[t][1]+'/">'+esc(all[t][0])+'</a> <span class="muted small">'+esc(all[t][2])+'</span></li>'});o.innerHTML=h;document.getElementById("ofavbox").style.display=h?"":"none"}
document.addEventListener("click",function(ev){var b=ev.target.closest(".fav");if(!b)return;var t=b.getAttribute("data-t"),f=L(FK,{});if(f[t])delete f[t];else f[t]=1;S(FK,f);apply()});
function seg(id,v){document.querySelectorAll("#"+id+" button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)})}
document.getElementById("tg").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;tg=v;seg("tg",v);apply()});
document.getElementById("mp").addEventListener("change",function(e){mp=e.target.value;apply()});
document.getElementById("favonly").addEventListener("change",function(e){favOnly=e.target.checked;apply()});
document.getElementById("hidedone").addEventListener("change",function(e){hideDone=e.target.checked;apply()});
qi.addEventListener("input",apply);document.addEventListener("guide-sync",apply);apply();})();
</script>"""


def _allq(ctx: Ctx) -> dict:
    """즐겨찾기 페이지들이 쓰는 전체 퀘스트 요약 {tid: [이름, slug, 상인, 레벨]} (≈40KB)"""
    out = {}
    for tid, t in ctx.tasks.items():
        ko, _en = ctx.task_names(tid)
        suf = ctx.display_suffix.get(tid)
        mnames = []
        for mid in ctx.task_maps(t):
            mn = ctx.map_name(mid)
            if mn and mn not in mnames:
                mnames.append(mn)
        out[tid] = [f"{ko} ({suf})" if suf else ko, ctx.task_slug(tid), ctx.trader_name(t.get("trader")), t.get("minPlayerLevel") or 0, mnames]
    return out


FAV_JS = r"""<script>
(function(){var FK="guide.fav",K="guide.quests";function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var all=JSON.parse(document.getElementById("allq").textContent),box=document.getElementById("fl"),cache={},MP="guide.fav.map";
var mpSel=document.getElementById("mp");(function(){var ms={};Object.keys(all).forEach(function(t){(all[t][4]||[]).forEach(function(m){ms[m]=1})});Object.keys(ms).sort().forEach(function(m){var o=document.createElement("option");o.value=m;o.textContent=m;mpSel.appendChild(o)});var sv=L(MP,"all");if(sv!=="all"&&ms[sv])mpSel.value=sv})();
mpSel.addEventListener("change",function(){S(MP,mpSel.value);render()});
// 지역 그룹: 0 = 고른 지역, 1 = 아무 지역(지역 제한 없음), 2 = 다른 지역(숨김). 전체면 모두 0
function mgrp(t){var mp=mpSel.value;if(mp==="all")return 0;var ms=all[t][4]||[];if(!ms.length)return 1;return ms.indexOf(mp)>=0?0:2}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function card(t,html,done,started,isFav){var x=all[t];return '<article class="box hq'+(done?" done":"")+'" data-t="'+t+'"><div class="hqh"><button type="button" class="fav'+(isFav?" on":"")+'" data-t="'+t+'" aria-label="'+(isFav?"즐겨찾기 해제":"즐겨찾기")+'" title="'+(isFav?"즐겨찾기 해제":"즐겨찾기로 고정")+'">★</button><h2><a href="/guide/quest/'+x[1]+'/">'+esc(x[0])+'</a></h2>'+(done?'<span class="badge b-done">완료</span>':started?'<span class="badge b-run">진행 중</span>':'')+'<span class="muted small">'+esc(x[2])+(x[3]>1?" · 레벨 "+x[3]:"")+' · '+((x[4]&&x[4].length)?esc(x[4].join(", ")):"아무 지역")+'</span></div>'+html+'</article>'}
// 퀘스트 페이지를 그대로 받아 목표·필요한 열쇠 부분만 잘라 온다(정적 사이트라 즐겨찾기 조합은 브라우저가 만든다)
function load1(t){if(cache[t])return Promise.resolve(cache[t]);return fetch("/guide/quest/"+all[t][1]+"/").then(function(r){return r.text()}).then(function(h){var d=new DOMParser().parseFromString(h,"text/html"),objs=d.querySelector(".col-main .objs"),out='<ol class="objs">'+(objs?objs.innerHTML:"")+"</ol>";
[].slice.call(d.querySelectorAll(".col-main .box")).forEach(function(b){var h2=b.querySelector("h2");if(h2&&h2.textContent.indexOf("필요한 열쇠")===0){out+='<div class="sublabel">필요한 열쇠</div>'+b.innerHTML.replace(/<h2>[\s\S]*?<\/h2>/,"")}});cache[t]=out;return out}).catch(function(){return '<p class="muted small">목표를 불러오지 못했어요 — 퀘스트 페이지에서 확인하세요</p>'})}
var seq=0;
function render(){var f=L(FK,{}),ids=Object.keys(f).filter(function(t){return !!all[t]}),d=L(K,{}),sy=window.__guideSync||L("guide.sync",null),cp=(sy&&sy.completed)||[],st=(sy&&sy.started)||[];
var isd=function(t){return !!d[t]||cp.indexOf(t)>=0},byLv=function(a,b){return mgrp(a)-mgrp(b)||(all[a][3]-all[b][3])||(all[a][0]<all[b][0]?-1:1)};
var nhid=0;ids=ids.filter(function(t){if(mgrp(t)===2){nhid++;return false}return true});
// 오버레이 연동이 알려 준 진행 중 퀘스트 — 즐겨찾기·완료는 빼고 아래 구역에(★ 누르면 즐겨찾기로 고정)
var runs=st.filter(function(t){return !!all[t]&&!f[t]&&!isd(t)&&(mgrp(t)!==2||(nhid++,false))});runs.sort(byLv);
ids.sort(function(a,b){return mgrp(a)-mgrp(b)||(isd(a)?1:0)-(isd(b)?1:0)||byLv(a,b)});
document.getElementById("nhid").textContent=nhid;document.getElementById("hidnote").style.display=nhid?"":"none";
document.getElementById("nfav").textContent=ids.length;document.getElementById("nrun").textContent=runs.length;
document.getElementById("empty").style.display=(ids.length||runs.length)?"none":"";document.getElementById("runbox").style.display=runs.length?"":"none";
document.getElementById("nosync").style.display=(sy||runs.length)?"none":"";
var rl=document.getElementById("rl"),my=++seq;if(!ids.length)box.innerHTML="";else box.innerHTML='<p class="muted small">불러오는 중…</p>';if(runs.length)rl.innerHTML='<p class="muted small">불러오는 중…</p>';else rl.innerHTML="";
Promise.all(ids.concat(runs).map(load1)).then(function(hs){if(my!==seq)return;
box.innerHTML=ids.map(function(t,i){var done=isd(t);return card(t,hs[i],done,!done&&st.indexOf(t)>=0,true)}).join("");
rl.innerHTML=runs.map(function(t,i){return card(t,hs[ids.length+i],false,true,false)}).join("")})}
document.addEventListener("click",function(ev){var b=ev.target.closest(".fav");if(!b)return;var t=b.getAttribute("data-t"),f=L(FK,{});if(f[t])delete f[t];else f[t]=1;S(FK,f);render()});
document.addEventListener("guide-sync",render);render();})();
</script>"""


def favorites_page(ctx: Ctx) -> tuple[str, str]:
    """내 즐겨찾기 — ★로 표시한 퀘스트(어떤 종류든)를 목표·필요한 열쇠까지 한 페이지에. 내용은 브라우저가 각 퀘스트 페이지에서 잘라 온다."""
    allq_json = json.dumps(_allq(ctx), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    body = f"""<h1>내 즐겨찾기 <span class="h1en">★로 표시한 퀘스트</span></h1>
<p class="sub">퀘스트 페이지·<a href="/guide/quests/">퀘스트 목록</a>·<a href="/guide/hunt/">사냥 퀘스트</a>의 ★를 누르면 여기 모입니다(이 브라우저에 저장) · 즐겨찾기 <b id="nfav">0</b>개 · 오버레이를 연동하면 <b>진행 중인 퀘스트</b>도 자동으로 아래에 · 완료한 퀘스트는 뒤로·흐리게</p>
<div class="controls"><select id="mp" aria-label="지역"><option value="all">모든 지역</option></select><span class="muted small">지역을 고르면 그 지역 퀘스트 → 아무 지역 순으로, 다른 지역은 숨김 <span id="hidnote" style="display:none">(숨김 <b id="nhid">0</b>개)</span></span></div>
<div class="note" id="empty">아직 즐겨찾기가 없어요. <a href="/guide/quests/">퀘스트 목록</a>이나 <a href="/guide/hunt/">사냥 퀘스트</a>에서 ★를 눌러 보세요.</div>
<div id="fl"></div>
<section id="runbox" style="display:none"><h2 style="margin-top:22px">진행 중인 퀘스트 <span class="muted small">시세 오버레이가 게임 로그로 확인한 것 · <b id="nrun">0</b>개 · ★를 누르면 즐겨찾기로 고정</span></h2><div id="rl"></div></section>
<div class="note" id="nosync" style="display:none">같은 PC에서 <a href="/">시세 오버레이</a>를 켜고 상단 <b>오버레이 연동</b>을 누르면, 지금 진행 중인 퀘스트가 여기에 자동으로 들어옵니다.</div>
<script type="application/json" id="allq">{allq_json}</script>"""
    path = "/guide/favorites/"
    title = "내 즐겨찾기 퀘스트 — 목표·필요 아이템·열쇠 한눈에 | 탈콥 가이드"
    desc = "★로 표시한 타르코프 퀘스트를 목표·필요 아이템·열쇠까지 한 페이지에 모아 게임 옆에 띄워 두세요. 브라우저에 저장되며 오버레이 연동 시 완료 퀘스트는 자동으로 흐려집니다."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="favorites",
                      crumbs=[("퀘스트", "/guide/quests/"), ("내 즐겨찾기", None)], scripts=FAV_JS,
                      extra_head='<meta name="robots" content="noindex" />')


def _hunt_classes(names) -> set:
    """사격 목표 대상 이름 → 필터용 분류(pmc·scav·boss·any)"""
    cls = set()
    for n in names or []:
        s = str(n)
        if s == "Any":
            cls.add("any")
        elif s in ("AnyPmc", "Usec", "Bear", "PmcBot", "ExUsec", "exUsecFree") or s.lower().startswith("pmc"):
            cls.add("pmc")
        elif s in ("Savage", "Marksman", "assaultGroup") or s.lower().startswith("cursed"):
            cls.add("scav")
        else:
            cls.add("boss")  # boss*·follower*·sectant*·infected* …
    return cls


def hunt_page(ctx: Ctx) -> tuple[str, str]:
    """사냥 퀘스트 — 적 처치(shoot) 목표가 있는 퀘스트만 모아 대상·무기·조건을 한눈에. ★ 즐겨찾기(guide.fav)는 브라우저 저장."""
    rows = []
    map_names: set = set()
    allq = _allq(ctx)
    for tid, t in ctx.tasks.items():
        ko, en = ctx.task_names(tid)
        suf = ctx.display_suffix.get(tid)
        name = f"{ko} ({suf})" if suf else ko
        shoot = [o for o in t.get("objectives") or [] if o.get("type") == "shoot"]
        if not shoot:
            continue
        other = len(t.get("objectives") or []) - len(shoot)
        tr_id = t.get("trader")
        trn = ctx.trader_name(tr_id)
        img = ctx.trader(tr_id).get("imageLink")
        lv = t.get("minPlayerLevel") or 0
        tags = [f'<a class="tag tr" href="/guide/quests/{e(ctx.trader_slug(tr_id))}/">'
                + (f'<img src="{e(img)}" alt="" width="18" height="18" loading="lazy" />' if img else "") + f"{e(trn)}</a>"]
        if lv > 1:
            tags.append(f'<span class="tag">레벨 {lv}+</span>')
        mids = ctx.task_maps(t)
        mnames = []
        for mid in mids:
            mn = ctx.map_name(mid)
            if mn and mn not in mnames:
                mnames.append(mn)
        for mid in mids[:4]:
            tags.append(f'<span class="tag map">{ctx.map_link(mid)}</span>')
        if t.get("kappaRequired"):
            tags.append('<span class="badge b-kappa">카파</span>')
        modes = ctx.task_modes.get(tid, ["pvp", "pve"])
        if len(modes) == 1:
            tags.append(f'<span class="badge b-mode">{"PVE 전용" if modes[0] == "pve" else "PVP 전용"}</span>')
        cls: set = set()
        tg_names: list = []
        for o in shoot:
            cls |= _hunt_classes(o.get("targetNames"))
            for n in o.get("targetNames") or []:
                tn = TARGETS.get(n) or ctx.mob_name(n)
                if tn and tn not in tg_names:
                    tg_names.append(tn)
        map_names.update(mnames)
        search = " ".join([name, en or "", trn] + tg_names + mnames).lower()
        objs = "".join(objective_html(ctx, o) for o in shoot)
        rows.append(
            f'<article class="box hq" data-t="{e(tid)}" data-tg="{" ".join(sorted(cls))}" data-m="{e("|".join(mnames))}" data-lv="{lv}" data-s="{e(search)}">'
            f'<div class="hqh"><button type="button" class="fav" data-t="{e(tid)}" aria-label="즐겨찾기" title="즐겨찾기">★</button>'
            f'<h2>{ctx.task_link(tid)}</h2><span class="stbadge badge" style="display:none"></span><span class="tags">{"".join(tags)}</span></div>'
            f'<ol class="objs">{objs}</ol>'
            + (f'<p class="muted small">이 밖에 다른 목표 {other}개 — 퀘스트 페이지에서 확인</p>' if other else "")
            + "</article>")
    rows_sorted = rows  # 정렬은 브라우저가(즐겨찾기 → 미완료 → 레벨)
    opts = "".join(f'<option value="{e(m)}">{e(m)}</option>' for m in sorted(map_names))
    allq_json = json.dumps(allq, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    n = len(rows)
    body = f"""<h1>사냥 퀘스트 <span class="h1en">누구를 · 어떤 총으로 · 어디서</span></h1>
<p class="sub">적 처치 목표가 있는 퀘스트 {n}개 · <b>★</b>를 누르면 즐겨찾기 — 맨 위로 모이고 이 브라우저에 저장됩니다 · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note">게임하면서 옆에 띄워 두는 용도입니다. 대상·사용 무기·부착물·착용 장비·거리·부위·시간대 조건이 바로 보이고, 완료로 표시한 퀘스트(퀘스트 페이지 체크 또는 오버레이 연동)는 흐려집니다. 사냥이 아닌 퀘스트의 ★는 <a href="/guide/favorites/">내 즐겨찾기</a>에서 목표까지 볼 수 있습니다.</div>
<div class="controls"><input type="search" id="q" placeholder="퀘스트·대상·상인·맵 검색" aria-label="검색" />
<div class="seg" id="tg"><button data-v="all" class="on">전체</button><button data-v="pmc">PMC</button><button data-v="scav">스캐브</button><button data-v="boss">보스·경호</button><button data-v="any">아무나</button></div>
<select id="mp" aria-label="맵"><option value="all">모든 맵</option>{opts}</select><span class="muted small">고른 맵 → 아무 지역 순, 다른 맵은 숨김</span>
<label class="chk"><input type="checkbox" id="favonly" /> 즐겨찾기만</label>
<label class="chk"><input type="checkbox" id="hidedone" /> 완료 숨기기</label>
<span class="muted small">즐겨찾기 <b id="nfav">0</b> · 표시 <span id="shown">{n}</span></span></div>
<section class="box" id="ofavbox" style="display:none"><h2>다른 즐겨찾기 <span class="muted small">사냥 퀘스트가 아닌 것</span></h2><ul class="plain" id="ofav"></ul></section>
<div id="hl">{"".join(rows_sorted)}</div>
<div class="note" id="none" style="display:none">조건에 맞는 퀘스트가 없어요.</div>
<script type="application/json" id="allq">{allq_json}</script>"""
    path = "/guide/hunt/"
    title = "타르코프 사냥 퀘스트 총정리 — 누구를 어떤 총으로 어디서 잡나 + 즐겨찾기 | 탈콥 가이드"
    desc = (f"타르코프 적 처치 퀘스트 {n}개: 대상(PMC·스캐브·보스), 사용 무기·부착물·착용 장비·거리·부위·시간대 조건을 한 페이지에. "
            f"★ 즐겨찾기로 지금 할 사냥 퀘스트만 모아 게임 옆에 띄워 두세요. 완료 퀘스트는 흐리게. 데이터 기준 {ctx.stamp}.")
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="hunt",
                      crumbs=[("퀘스트", "/guide/quests/"), ("사냥 퀘스트", None)], scripts=HUNT_JS)


def rewards_page(ctx: Ctx) -> tuple[str, str]:
    rew: dict[str, list] = {}   # 아이템 → [(퀘스트, 수량)]
    unl: dict[str, list] = {}   # 아이템 → [(퀘스트, 상인, LL)]
    crf: dict[str, list] = {}   # 아이템 → [(퀘스트, 시설, 단계)]
    for tid, t in ctx.tasks.items():
        fr = t.get("finishRewards") or {}
        for x in fr.get("items") or []:
            iid = x.get("item")
            if iid and iid not in MONEY:
                rew.setdefault(iid, []).append((tid, x.get("count") or 1))
        for x in fr.get("offerUnlock") or []:
            if x.get("item"):
                unl.setdefault(x["item"], []).append((tid, x.get("trader"), x.get("level")))
        for x in fr.get("craftUnlock") or []:
            if x.get("item"):
                crf.setdefault(x["item"], []).append((tid, x.get("station"), x.get("level")))
    ids = set(rew) | set(unl) | set(crf)

    def qline(tid, extra):
        t = ctx.tasks[tid]
        lv = t.get("minPlayerLevel") or 0
        modes = ctx.task_modes.get(tid, [])
        tag = f' <span class="badge b-mode">{"PVE 전용" if modes == ["pve"] else "PVP 전용"}</span>' if len(modes) == 1 else ""
        return (f'<div class="rq"><div>{ctx.task_link(tid)} <span class="muted small">{e(ctx.trader_name(t.get("trader")))}'
                + (f" · 레벨 {lv}" if lv > 1 else "") + (f" · {extra}" if extra else "") + f"</span>{tag}</div>"
                f'<div class="cbox" data-t="{e(tid)}"></div></div>')

    blocks = []
    for iid in sorted(ids, key=lambda i: ((ctx.item(i) or {}).get("n") or i)):
        it = ctx.item(iid)
        if not it:
            continue
        kinds, body, badges = [], "", ""
        if iid in rew:
            kinds.append("r")
            qs = sorted(rew[iid], key=lambda x: (ctx.depth(x[0]), ctx.task_names(x[0])[0]))
            badges += f'<span class="badge b-quest">완료 보상 {len(qs)}</span>'
            body += '<h3>퀘스트를 깨면 받음</h3>' + "".join(qline(tid, f"×{fmt_int(c)}" if c not in (None, 1) else "") for tid, c in qs)
        if iid in unl:
            kinds.append("u")
            badges += '<span class="badge b-any">구매 해금</span>'
            body += '<h3>퀘스트를 깨면 상인이 팔기 시작</h3>' + "".join(
                qline(tid, f"{e(ctx.trader_name(tr))} LL{lvl}에서 구매") for tid, tr, lvl in sorted(unl[iid], key=lambda x: ctx.depth(x[0])))
        if iid in crf:
            kinds.append("c")
            badges += '<span class="badge b-power">제작 해금</span>'
            body += '<h3>퀘스트를 깨면 은신처에서 제작 가능</h3>' + "".join(
                qline(tid, f"{e(ctx.station_name(st))} {lvl}단계") for tid, st, lvl in sorted(crf[iid], key=lambda x: ctx.depth(x[0])))
        price = it.get("pvp")
        price_html = f'<span class="price">{fmt_int(price)}₽</span>' if price else ('<span class="muted small">거래 불가</span>' if it.get("noflea") else "")
        s = (it["n"] + " " + (it.get("en") or "") + " " + (it.get("s") or "")).lower()
        s = s + " " + s.replace(" ", "")  # 'S I C C' 처럼 띄어 쓴 이름도 'sicc' 로 찾히게
        img = f'<img class="icon sm" loading="lazy" alt="" src="{e(it["img"])}" />' if it.get("img") else ""
        en_html = f'<span class="muted small">{e(it["en"])}</span>' if it.get("en") and it["en"] != it["n"] else ""
        blocks.append(f'<details class="rw" data-s="{e(s)}" data-k="{" ".join(kinds)}"><summary>{img}<span class="itn2"><b>{e(it["n"])}</b>{en_html}</span>'
                      f'<span class="bd">{badges}</span>{price_html}</summary><div class="rwb">{body}</div></details>')

    # 선행 사슬은 열 때 브라우저가 그린다 — 퀘스트 전체(이름·상인·레벨·선행·주소·모드)를 JSON 으로 한 번만 싣는다
    qd = {"t": {}}
    for tid, t in ctx.tasks.items():
        ko = ctx.task_names(tid)[0]
        suf = ctx.display_suffix.get(tid)
        reqs = [[r["task"], 1 if (not r.get("status") or "complete" in r.get("status")) else 0]
                for r in t.get("taskRequirements") or [] if r.get("task") in ctx.tasks]
        qd["t"][tid] = [f"{ko} ({suf})" if suf else ko, ctx.trader_name(t.get("trader")), t.get("minPlayerLevel") or 0, reqs,
                        ctx.task_slug(tid), ctx.task_modes.get(tid, [])]
    qd_json = json.dumps(qd, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    n_r, n_u, n_c = len(rew), len(unl), len(crf)
    body = f"""<h1>퀘스트 보상으로 받는 아이템 <span class="h1en">어떤 퀘스트를 깨야 받나</span></h1>
<p class="sub">완료 보상 {n_r}종 · 구매 해금 {n_u}종 · 제작 해금 {n_c}종 · 아이템을 누르면 주는 퀘스트와 <b>처음부터 깨야 하는 순서</b>가 나옵니다 · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note">예: <b>럭키 스캐브의 고물상자</b>를 검색하면 그 상자를 주는 퀘스트와, 그 퀘스트를 받기까지 먼저 깨야 하는 선행 퀘스트가 시작점부터 순서대로 보입니다. 완료로 표시한 퀘스트(퀘스트 페이지 체크 또는 오버레이 연동)는 흐리게 지워져 <b>지금 어디서 시작하면 되는지</b>만 남습니다. 돈 보상은 뺐습니다.</div>
<div class="controls"><input type="search" id="q" placeholder="아이템 이름 검색 (한글·영문)" aria-label="검색" />
<div class="seg" id="scope"><button data-v="all" class="on">전체</button><button data-v="r">완료 보상</button><button data-v="u">구매 해금</button><button data-v="c">제작 해금</button></div>
<span class="muted small"><span id="shown">{len(blocks)}</span>종 표시</span></div>
<div class="rwlist">{"".join(blocks)}</div>
<div class="note" id="none" style="display:none">보상·해금 아이템 중엔 없어요. 퀘스트에 <b>내는</b> 아이템이라면 <a href="/guide/items/">필요 아이템 총정리</a>에서 찾아보세요.</div>
<script type="application/json" id="qd">{qd_json}</script>"""
    path = "/guide/rewards/"
    title = "타르코프 퀘스트 보상 아이템 — 어떤 퀘스트가 주는지·선행 퀘스트 순서 | 탈콥 가이드"
    desc = (f"타르코프 퀘스트 완료 보상 아이템 {n_r}종, 구매 해금 {n_u}종, 제작 해금 {n_c}종. 아이템을 검색하면 주는 퀘스트와 처음부터 깨야 하는 선행 퀘스트 순서, "
            f"남은 선행 퀘스트 수를 보여줍니다. PVP·PVE. 데이터 기준 {ctx.stamp}.")
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="rewards",
                      crumbs=[("보상으로 받는 아이템", None)], scripts=REWARDS_JS)


# ─────────────────────────────────────────────────────────────
# 퀘스트 전용 아이템
# ─────────────────────────────────────────────────────────────

def quest_items_page(ctx: Ctx) -> tuple[str, str]:
    uses: dict[str, dict] = {}
    for tid, t in ctx.tasks.items():
        for o in t.get("objectives") or []:
            if o.get("type") not in ("findQuestItem", "giveQuestItem", "plantQuestItem"):
                continue
            qi = o.get("questItem")
            qid = qi.get("id") if isinstance(qi, dict) else qi
            if not qid:
                continue
            u = uses.setdefault(qid, {"tasks": [], "maps": []})
            if tid not in u["tasks"]:
                u["tasks"].append(tid)
            for loc in o.get("possibleLocations") or []:
                if loc.get("map") and loc["map"] not in u["maps"]:
                    u["maps"].append(loc["map"])
            for m in o.get("maps") or []:
                mid = m.get("id") if isinstance(m, dict) else m
                if mid and mid not in u["maps"]:
                    u["maps"].append(mid)
    by_map: dict[str, list] = {}
    for qid, u in uses.items():
        base = None
        for m in u["maps"]:
            slug = (ctx.maps.get(m) or {}).get("normalizedName")
            if slug and slug != "ground-zero-tutorial":
                base = MAP_VARIANTS.get(slug, slug)
                break
        by_map.setdefault(base or "_", []).append(qid)
    order = [s for s in MAP_ORDER if s in by_map] + [s for s in by_map if s not in MAP_ORDER and s != "_"] + (["_"] if "_" in by_map else [])
    secs = []
    toc = []
    for slug in order:
        mid = ctx.map_by_slug.get(slug)
        mname = ctx.map_name(mid) if mid else "지역 무관"
        toc.append(f'<a href="#m-{e(slug)}">{e(mname)} <span class="muted">{len(by_map[slug])}</span></a>')
        cards = []
        for qid in sorted(by_map[slug], key=lambda x: (ctx.item(x) or {}).get("n") or x):
            it = ctx.item(qid) or {"n": qid}
            u = uses[qid]
            tl = " · ".join(f'{ctx.task_link(x)} <span class="muted small">{e(ctx.trader_name(ctx.tasks[x].get("trader")))}</span>' for x in u["tasks"])
            ml = ctx.map_links(u["maps"])
            img = f'<img class="icon" loading="lazy" alt="" src="{e(it.get("img"))}" />' if it.get("img") else ""
            cards.append(f'<div class="card static">{img}<div><div class="nm">{e(it["n"])}</div>'
                         f'<div class="small muted">{e(it.get("desc") or "")}</div>'
                         f'<div class="small" style="margin-top:4px">퀘스트: {tl}</div>'
                         + (f'<div class="small muted">지도: {ml}</div>' if ml else "") + "</div></div>")
        secs.append(f'<h2 class="sec" id="m-{e(slug)}">{e(mname)}</h2><div class="grid wide">{"".join(cards)}</div>')
    body = (f'<h1>퀘스트 전용 아이템 <span class="h1en">Quest items</span></h1>'
            f'<p class="sub">레이드에서 찾아 제출·설치하는 퀘스트 전용 아이템 {len(uses)}종 · 지도별 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note">퀘스트 전용 아이템은 해당 퀘스트를 <b>받은 상태</b>에서만 보이고, 죽으면 잃습니다(일부는 다시 생성). '
            '1.0.5부터 근처에 가면 화면에 방향 표시가 뜹니다. 정확한 위치는 각 퀘스트 페이지의 위키·tarkov.dev 지도 링크를 참고하세요.</div>'
            f'<nav class="toc">{"".join(toc)}</nav>' + "".join(secs))
    path = "/guide/quest-items/"
    title = f"타르코프 퀘스트 전용 아이템 {len(uses)}종 — 지도별 위치·관련 퀘스트 | 탈콥 가이드"
    desc = f"타르코프 퀘스트에서 찾아야 하는 전용 아이템(문서·USB·케이스 등) {len(uses)}종을 지도별로 정리. 아이템 설명과 관련 퀘스트 링크. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="items",
                      crumbs=[("퀘스트 전용 아이템", None)])


# ─────────────────────────────────────────────────────────────
# 은신처
# ─────────────────────────────────────────────────────────────

PCT_BONUS_ABS = {"AdditionalSlots", "StashSize", "MaximumEnergyReserve"}


def bonus_text(ctx: Ctx, b: dict) -> str:
    ty = b.get("type") or ""
    name = ctx._loc(ctx.loc_hideout, b.get("name"), None) or ctx._loc(ctx.loc_hideout, "hideout_" + ty, ty)
    v = b.get("value")
    if ty.startswith("Unlock") or v is None:
        return name
    if ty == "SkillGroupLevelingBoost" and b.get("skillName"):
        name += f" ({ctx.skill_name(b['skillName'])})"
    if ty in PCT_BONUS_ABS:
        return f"{name} +{fmt_int(v)}"
    pct = v * 100 if abs(v) < 5 else v
    sign = "+" if pct > 0 else ""
    return f"{name} {sign}{fmt_int(pct)}%"


def _req_sig(lv):
    return json.dumps(sorted(((r.get("item") if not isinstance(r.get("item"), dict) else r["item"].get("id")),
                              r.get("count"), bool((r.get("attributes") or {}).get("foundInRaid")))
                             for r in lv.get("itemRequirements") or []))


def level_req_html(ctx: Ctx, lv: dict) -> str:
    rows = []
    items, money = [], []
    for r in lv.get("itemRequirements") or []:
        it = r.get("item")
        iid = it.get("id") if isinstance(it, dict) else it
        if iid in MONEY:
            money.append(ctx.chip(iid, r.get("count")))
        else:
            items.append(ctx.chip(iid, r.get("count"), bool((r.get("attributes") or {}).get("foundInRaid"))))
    if items:
        rows.append(("재료", '<div class="chips">' + "".join(items) + "</div>"))
    if money:
        rows.append(("돈", '<div class="chips">' + "".join(money) + "</div>"))
    st = lv.get("stationLevelRequirements") or []
    if st:
        rows.append(("선행 시설", ", ".join(ctx.station_link(x.get("station") if not isinstance(x.get("station"), dict) else x["station"].get("id"), x.get("level")) for x in st)))
    tr = lv.get("traderRequirements") or []
    if tr:
        rows.append(("상인 등급", ", ".join(f'{e(ctx.trader_name(x.get("trader") if not isinstance(x.get("trader"), dict) else x["trader"].get("id")))} LL{x.get("level") or x.get("value")}' for x in tr)))
    sk = lv.get("skillRequirements") or []
    if sk:
        rows.append(("스킬", ", ".join(f'{e(ctx.skill_name(x.get("skill") if not isinstance(x.get("skill"), dict) else x["skill"].get("name")))} {x.get("level")}레벨' for x in sk)))
    rows.append(("건설 시간", fmt_dur(lv.get("constructionTime"))))
    return '<table class="kv">' + "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows) + "</table>"


def craft_unlocks(ctx: Ctx):
    """(station, level, product) → 해금 퀘스트 id 목록"""
    out: dict[tuple, list] = {}
    for tid, t in ctx.tasks_reg.items():
        for side in ("finishRewards", "startRewards"):
            for c in (t.get(side) or {}).get("craftUnlock") or []:
                k = (c.get("station"), c.get("level"), c.get("item"))
                out.setdefault(k, [])
                if tid not in out[k]:
                    out[k].append(tid)
    return out


def crafts_html(ctx: Ctx, crafts: list, unlock_map: dict) -> str:
    if not crafts:
        return ""
    trs = []
    for c in sorted(crafts, key=lambda c: (c.get("duration") or 0)):
        p = c.get("productItem") or {}
        pid = p.get("item")
        mats = []
        for r in c.get("requiredItems") or []:
            tool = (r.get("attributes") or {}).get("tool")
            mats.append(ctx.chip(r.get("item"), r.get("count"), extra=' <span class="badge b-any">도구·반환</span>' if tool else ""))
        for r in c.get("requiredQuestItems") or []:  # 퀘스트 아이템 재료(키카드 재프로그래밍 등 7개 제작) — 2026-11-02 위키 대조에서 누락 발견
            qid = r.get("item") if isinstance(r, dict) else r
            qid = qid.get("id") if isinstance(qid, dict) else qid
            if qid:
                mats.append(ctx.chip(qid, (r.get("count") if isinstance(r, dict) else None) or 1, extra=' <span class="badge b-any">퀘스트 아이템</span>'))
        q = unlock_map.get((c.get("station"), c.get("level"), pid))
        lock = (' <span class="muted small">해금: ' + ", ".join(ctx.task_link(x) for x in q) + "</span>") if q else ""
        trs.append(f'<tr><td>{ctx.chip(pid, p.get("count"))}{lock}</td><td><div class="chips">{"".join(mats)}</div></td><td class="n">{fmt_dur(c.get("duration"))}</td></tr>')
    return ('<div class="tbl"><table class="tot"><thead><tr><th>만드는 것</th><th>재료</th><th class="n">시간</th></tr></thead><tbody>'
            + "".join(trs) + "</tbody></table></div>")


def station_page(ctx: Ctx, sid: str, unlock_map: dict) -> tuple[str, str]:
    st = ctx.hideout_reg[sid]
    stp = ctx.hideout_pve.get(sid) or {}
    name = ctx.station_name(sid)
    slug = st.get("normalizedName")
    area = st.get("areaType")
    secs = []
    crafts_by_lv: dict[int, list] = {}
    for c in ctx.crafts_reg:
        if c.get("station") == sid:
            crafts_by_lv.setdefault(c.get("level") or 1, []).append(c)
    pve_levels = {lv.get("level"): lv for lv in stp.get("levels") or []}
    toc = []
    for lv in st.get("levels") or []:
        n = lv.get("level")
        toc.append(f'<a href="#lv{n}">{n}단계</a>')
        d = ctx._loc(ctx.loc_hideout, f"hideout_area_{area}_stage_{n}_description", "")
        bon = lv.get("bonuses") or []
        bon_html = ('<ul class="plain">' + "".join(f"<li>{e(bonus_text(ctx, b))}</li>" for b in bon) + "</ul>") if bon else '<p class="muted small">표시할 효과 없음</p>'
        pve_html = ""
        pl = pve_levels.get(n)
        if pl and _req_sig(pl) != _req_sig(lv):
            pve_html = '<h3>PVE 재료 (다름)</h3>' + level_req_html(ctx, pl)
        crafts = crafts_by_lv.get(n) or []
        secs.append(f'<section class="box lvl" id="lv{n}"><h2>{e(name)} {n}단계</h2>'
                    + (f'<p class="small muted">{e(d)}</p>' if d else "")
                    + '<div class="cols2"><div><h3>필요 조건</h3>' + level_req_html(ctx, lv) + station_diff_html(slug, n) + pve_html + "</div>"
                    + f'<div><h3>효과</h3>{bon_html}</div></div>'
                    + (f'<h3>이 단계에서 할 수 있는 제작 {len(crafts)}개</h3>' + crafts_html(ctx, crafts, unlock_map) if crafts else "")
                    + "</section>")
    others = " · ".join(f'<a href="/guide/hideout/{e(s.get("normalizedName"))}/">{e(ctx.station_name(k))}</a>'
                        for k, s in sorted(ctx.hideout_reg.items(), key=lambda kv: ctx.station_name(kv[0])) if k != sid)
    total_time = sum(lv.get("constructionTime") or 0 for lv in st.get("levels") or [])
    body = (f'<h1>{e(name)} <span class="h1en">{e(slug.replace("-", " ").title())}</span></h1>'
            f'<p class="sub">은신처 시설 · {len(st.get("levels") or [])}단계 · 총 건설 시간 {fmt_dur(total_time)} · 데이터 기준 {e(ctx.stamp)}</p>'
            f'<nav class="toc">{"".join(toc)}</nav>' + "".join(secs)
            + f'<section class="box"><h2>다른 시설</h2><p class="small">{others}</p></section>')
    path = f"/guide/hideout/{slug}/"
    title = f"타르코프 은신처 {name} — 단계별 재료·조건·효과·제작 레시피 | 탈콥 가이드"
    desc = f"타르코프 은신처 {name} {len(st.get('levels') or [])}단계 업그레이드에 필요한 재료(인레이드 여부), 돈, 선행 시설·상인 등급·스킬, 건설 시간, 효과와 제작 레시피. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="hideout",
                      crumbs=[("은신처", "/guide/hideout/"), (name, None)])


HIDEOUT_JS = """<script>
(function(){var D=JSON.parse(document.getElementById("hdata").textContent),KEY="guide.hideout.levels",MK="guide.mode";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var cur=L(KEY,{}),mode=L(MK,"pvp");if(D.pve===undefined)mode="pvp";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}
function seg(v){document.querySelectorAll("#hmode button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)})}
function money(id,c){var s=D.money[id];if(!s)return null;return s==="₽"?c.toLocaleString("ko-KR")+"₽":s+c.toLocaleString("ko-KR")}
function render(){var S2=D[mode],agg={},cash={};
document.querySelectorAll("#hsel select").forEach(function(sel){var sid=sel.getAttribute("data-s"),st=S2[sid];if(!st)return;var have=+(cur[sid]||0);
st.l.forEach(function(lv,i){if(i+1<=have)return;lv.forEach(function(r){var id=r[0],c=r[1],f=r[2];if(D.money[id]){cash[id]=(cash[id]||0)+c;return}
var k=id+(f?"|f":"");var a=agg[k]||(agg[k]={id:id,f:f,c:0});a.c+=c;})})});
var rows=Object.keys(agg).map(function(k){return agg[k]}).sort(function(a,b){return(b.f-a.f)||(b.c-a.c)});
var it=D.items,html=rows.map(function(r){var x=it[r.id]||{n:r.id};return '<span class="chip'+(r.f?' fir':'')+'">'+(x.i?'<img loading="lazy" alt="" src="'+esc(x.i)+'" width="24" height="24" />':'')+esc(x.n)+' <span class="cnt">×'+r.c+'</span>'+(r.f?' <span class="badge b-fir">인레이드</span>':'')+'</span>'}).join("");
var cs=Object.keys(cash).map(function(k){return money(k,cash[k])}).join(" + ");
document.getElementById("hneed").innerHTML=(html?'<div class="chips">'+html+'</div>':'<p class="muted">모든 시설을 끝까지 올렸습니다 🎉</p>')+(cs?'<p class="small" style="margin-top:8px">돈: <b>'+esc(cs)+'</b></p>':'');
document.getElementById("hcount").textContent=rows.length;}
document.querySelectorAll("#hsel select").forEach(function(sel){var sid=sel.getAttribute("data-s");sel.value=String(cur[sid]||0);
sel.addEventListener("change",function(){cur[sid]=+sel.value;S(KEY,cur);render()})});
seg(mode);document.getElementById("hmode").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;mode=v;S(MK,v);seg(v);render()});
document.getElementById("hreset").addEventListener("click",function(){if(confirm("현재 단계 입력을 모두 지울까요?")){cur={};S(KEY,cur);document.querySelectorAll("#hsel select").forEach(function(s){s.value="0"});render()}});
render();})();
</script>"""


def hideout_index(ctx: Ctx) -> tuple[str, str]:
    stations = sorted(ctx.hideout_reg.items(), key=lambda kv: ctx.station_name(kv[0]))
    # 다른 시설의 선행 조건으로 몇 번 쓰이는지 — "먼저 올릴수록 많이 풀리는 시설"
    unlock_cnt: dict[str, int] = {}
    for sid, st in ctx.hideout_reg.items():
        for lv in st.get("levels") or []:
            for r in lv.get("stationLevelRequirements") or []:
                s2 = r.get("station") if not isinstance(r.get("station"), dict) else r["station"].get("id")
                unlock_cnt[s2] = unlock_cnt.get(s2, 0) + 1
    data = {"money": MONEY, "items": {}}
    for mode, src in (("pvp", ctx.hideout_reg), ("pve", ctx.hideout_pve)):
        m = {}
        for sid, st in src.items():
            levels = []
            for lv in sorted(st.get("levels") or [], key=lambda x: x.get("level") or 0):
                reqs = []
                for r in lv.get("itemRequirements") or []:
                    it = r.get("item")
                    iid = it.get("id") if isinstance(it, dict) else it
                    reqs.append([iid, r.get("count") or 1, 1 if (r.get("attributes") or {}).get("foundInRaid") else 0])
                    if iid not in MONEY and iid not in data["items"]:
                        info = ctx.item(iid) or {}
                        data["items"][iid] = {"n": info.get("n") or iid, "i": info.get("img")}
                levels.append(reqs)
            m[sid] = {"l": levels}
        data[mode] = m
    rows = []
    sels = []
    for sid, st in stations:
        name = ctx.station_name(sid)
        slug = st.get("normalizedName")
        n_lv = len(st.get("levels") or [])
        lv1 = (st.get("levels") or [{}])[0]
        pre = ", ".join(ctx.station_link(r.get("station") if not isinstance(r.get("station"), dict) else r["station"].get("id"), r.get("level"))
                        for r in lv1.get("stationLevelRequirements") or []) or '<span class="muted">없음</span>'
        last = (st.get("levels") or [{}])[-1]
        bon = ", ".join(e(bonus_text(ctx, b)) for b in (last.get("bonuses") or [])[:3])
        rows.append(f'<tr><td><a href="/guide/hideout/{e(slug)}/"><b>{e(name)}</b></a></td><td class="n">{n_lv}</td><td class="small">{pre}</td>'
                    f'<td class="n">{unlock_cnt.get(sid, 0) or ""}</td><td class="small">{bon}</td></tr>')
        opts = "".join(f'<option value="{i}">{"미건설" if i == 0 else f"{i}단계"}</option>' for i in range(0, n_lv + 1))
        sels.append(f'<label class="hs"><span>{e(name)}</span><select data-s="{e(sid)}" aria-label="{e(name)} 현재 단계">{opts}</select></label>')
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    top_unlock = sorted(unlock_cnt.items(), key=lambda kv: -kv[1])[:5]
    tip = ", ".join(f"{ctx.station_link(s)}({c}곳)" for s, c in top_unlock)
    body = f"""<h1>은신처 업그레이드 총정리 <span class="h1en">Hideout</span></h1>
<p class="sub">시설 {len(stations)}개 · 단계별 재료·조건·효과·제작 · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note">1.1.0에서 1~3단계 일부 재료의 인레이드 조건이 빠지고 돈 요구가 추가됐습니다. 아래 숫자는 현재 데이터 기준입니다.
다른 시설의 선행 조건으로 가장 많이 쓰이는 시설: {tip} — 이 시설들을 먼저 올리면 막히는 곳이 줄어듭니다.</div>
<section class="box"><h2>남은 재료 계산기</h2><p class="small muted">시설마다 지금 단계를 고르면 끝까지 올리는 데 남은 재료를 합쳐 보여 줍니다(이 브라우저에 저장).</p>
<div class="controls"><div class="seg" id="hmode"><button data-v="pvp" class="on">PVP</button><button data-v="pve">PVE</button></div><button class="seg" id="hreset" style="padding:6px 10px;background:var(--panel);color:var(--muted);cursor:pointer;font:inherit;font-size:12px">입력 초기화</button></div>
<div class="hsel" id="hsel">{"".join(sels)}</div>
<h3>남은 재료 <span class="muted small"><span id="hcount">0</span>종</span></h3><div id="hneed"></div></section>
<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th>시설</th><th class="n">단계</th><th>1단계 선행 조건</th><th class="n">다른 시설 해금</th><th>최종 단계 효과</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>
<script id="hdata" type="application/json">{payload}</script>"""
    path = "/guide/hideout/"
    title = "타르코프 은신처 업그레이드 총정리 — 시설별 재료·조건·효과, 남은 재료 계산기 | 탈콥 가이드"
    desc = f"타르코프 은신처 시설 {len(stations)}개의 단계별 업그레이드 재료·돈·선행 조건·효과를 정리하고, 현재 단계를 입력하면 남은 재료를 계산해 줍니다. PVP·PVE. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="hideout",
                      crumbs=[("은신처", None)], scripts=HIDEOUT_JS)


# ─────────────────────────────────────────────────────────────
# 초반 진행 가이드 (투어 + 10레벨까지)
# ─────────────────────────────────────────────────────────────

# 투어 단계 — 공식 위키 'Tour'(2026-10 확인)를 보고 직접 정리. 데이터에 스토리 챕터가 없어 손으로 쓴다.
TOUR_STEPS = [
    ("—", "그라운드 제로 튜토리얼을 <b>Klimov Street</b> 탈출구(Skyside 건물 뒤)로 탈출합니다. 화면 안내는 따라 하지 않아도 됩니다.",
     "없음", "상인 대화 시작"),
    ("테라피스트", "대화한 뒤 <b>250,000₽</b>를 건넵니다. 돈은 인레이드가 아니어도 됩니다.", "250,000₽", "맵: 타르코프 시내"),
    ("래그맨", "<b>인터체인지</b>에서 '생존' 또는 '런스루'로 탈출하고 래그맨에게 보고합니다. 탈출이 어려우면 <b>3번 들어가기만</b> 해도 됩니다.",
     "없음", "상인: 스키어 · 맵: 세관"),
    ("스키어", "<b>세관</b> 생존·런스루 탈출(또는 3회 방문) + 인레이드 <b>건축 자재·공구 아무거나 5개</b>를 한 번에 제출합니다(나눠 내기 불가).",
     "인레이드 건축 자재·공구 5개", "상인: 메카닉 · 맵: 공장"),
    ("메카닉", "<b>공장</b> 생존·런스루 탈출(또는 3회 방문) + 인레이드 <b>무기 아무거나 2정</b>을 제출합니다.",
     "인레이드 무기 2정", "상인: 프라퍼 · 맵: 삼림"),
    ("스키어", "<b>삼림</b>에서 아무 적 3명 처치 + 삼림 생존·런스루 탈출(또는 3회 방문). 처치와 탈출은 다른 레이드여도 됩니다.",
     "없음", "상인: 피스키퍼 · 맵: 해안선"),
    ("—", "<b>해안선</b> 남동쪽 끝, 터미널 앞 감시탑의 <b>인터콤</b>을 씁니다. 터미널 담장에 붙지 말고, 경비병을 쏘지 말고, "
     "떠나라는 말을 들은 뒤 인터콤을 연타하지 마세요(사살됩니다).", "없음", "다음 단계"),
    ("프라퍼", "해안선 생존·런스루 탈출(또는 3회 방문) 후 <b>PMC 인식표 5개</b>를 건넵니다. 인식표는 인레이드가 아니어도 되고 직접 처치하지 않아도 됩니다.",
     "PMC 인식표 5개", "맵: 리저브"),
    ("메카닉", "<b>8,000달러</b>를 건넵니다. 달러는 피스키퍼에게 루블로 살 수 있습니다.", "$8,000", "맵: 등대"),
    ("—", "<b>연구소 출입 카드</b>를 들고 타르코프 시내(클리모바 16A 앞 지하 입구) 또는 공장(침수된 지하와 이어진 하수 터널)의 "
     "트랜짓으로 연구소에 들어갑니다(레이드 시작 1분 뒤부터 이용 가능). 2층 연구소장실(O21) · 1층 격납고 옆 서버실 · "
     "지하 'Sewage Conduit' 탈출구의 하수 탈출로를 차례로 확인하면 끝(탈출구 작동·생존 불필요).",
     "연구소 출입 카드", "맵: 연구소 · 업적 Pathfinder"),
]

EARLY_TRADERS = ["therapist", "ragman", "skier", "mechanic", "prapor", "peacekeeper", "jaeger"]


def start_page(ctx: Ctx) -> tuple[str, str]:
    tour_rows = "".join(
        f'<tr><td class="n">{i}</td><td class="nw">{e(who)}</td><td>{what}</td><td class="small">{e(need)}</td><td class="small"><b>{e(gain)}</b></td></tr>'
        for i, (who, what, need, gain) in enumerate(TOUR_STEPS, 1))
    # 초반 퀘스트: Ctx.early_tasks 기준(LL1·레벨 ≤ 10·묶음 1단계까지·선행도 초반·택일 제외)
    early: dict[str, list] = {}
    for tid in ctx.early_tasks(EARLY_TRADERS, max_batch=1):
        early.setdefault(ctx.trader_slug(ctx.tasks[tid].get("trader")), []).append(tid)
    blocks = []
    fir_agg: dict[str, int] = {}
    any_agg: dict[str, int] = {}
    money: dict[str, int] = {"5449016a4bdc2d6f028b456f": 250000, "5696686a4bdc2da3298b456a": 8000}
    total = 0
    for slug in EARLY_TRADERS:
        tids = early.get(slug) or []
        if not tids:
            continue
        tr_id = ctx.trader_by_slug.get(slug)
        rows = sorted(((ctx.tier(ctx.tasks[x])[0] + ((ctx.tasks[x].get("minPlayerLevel") or 0),), ctx.tier(ctx.tasks[x])[1], x) for x in tids))
        lis = []
        for _, label, tid in rows:
            t = ctx.tasks[tid]
            total += 1
            lv = t.get("minPlayerLevel") or 0
            badge = '<span class="badge b-kappa">카파</span>' if t.get("kappaRequired") else ""
            modes = ctx.task_modes.get(tid, [])
            mb = f'<span class="badge b-mode">{"PVE" if modes == ["pve"] else "PVP"}</span>' if len(modes) == 1 else ""
            lis.append(f'<li>{ctx.task_link(tid)} {badge}{mb} <span class="muted small">{e(label)}{f" · {lv}레벨+" if lv > 1 else ""}</span></li>')
            for o in t.get("objectives") or []:
                if o.get("type") != "giveItem" or o.get("optional"):
                    continue
                ids = [i for i in o.get("items") or [] if i]
                if len(ids) != 1:
                    continue
                if ids[0] in MONEY:
                    money[ids[0]] = money.get(ids[0], 0) + (o.get("count") or 0)
                elif o.get("foundInRaid"):
                    fir_agg[ids[0]] = fir_agg.get(ids[0], 0) + (o.get("count") or 1)
                else:
                    any_agg[ids[0]] = any_agg.get(ids[0], 0) + (o.get("count") or 1)
        blocks.append(f'<section class="box"><h3><a href="/guide/quests/{e(slug)}/">{e(ctx.trader_name(tr_id))}</a> '
                      f'<span class="muted small">{len(tids)}개</span></h3><ul class="cols-list">{"".join(lis)}</ul></section>')
    # 은신처 1단계 인레이드 재료(PVP)
    hide_fir: dict[str, int] = {}
    for st in ctx.hideout_reg.values():
        for lv in st.get("levels") or []:
            if lv.get("level") != 1:
                continue
            for r in lv.get("itemRequirements") or []:
                it = r.get("item")
                iid = it.get("id") if isinstance(it, dict) else it
                if iid in MONEY:
                    continue
                if (r.get("attributes") or {}).get("foundInRaid"):
                    hide_fir[iid] = hide_fir.get(iid, 0) + (r.get("count") or 1)
    fir_chips = "".join(ctx.chip(i, c, True) for i, c in sorted(fir_agg.items(), key=lambda kv: -kv[1]))
    any_chips = "".join(ctx.chip(i, c) for i, c in sorted(any_agg.items(), key=lambda kv: -kv[1])[:30])
    hide_chips = "".join(ctx.chip(i, c, True) for i, c in sorted(hide_fir.items(), key=lambda kv: -kv[1]))
    money_txt = " · ".join(ctx.money(k, v) for k, v in money.items() if ctx.money(k, v))
    jaeger = next((x for x in ctx.tasks if ctx.task_names(x)[1] == "Introduction"), None)
    ref = next((x for x in ctx.tasks_reg if ctx.task_names(x)[1].startswith("Easy Money - Part 1")), None)
    ref_pve = next((x for x in ctx.tasks_pve if ctx.task_names(x)[1].startswith("Easy Money - Part 1") and x != ref), None)
    body = f"""<h1>타르코프 초반 가이드 <span class="h1en">투어(Tour)부터 10레벨까지</span></h1>
<p class="sub">새 캐릭터·프레스티지 직후 기준 · 게임 {GAME_VERSION} · 데이터 기준 {e(ctx.stamp)}</p>
<div class="note key"><b>먼저 이 세 가지만</b><ol>
<li>시작하면 스토리 <b>투어(Tour)</b>가 자동으로 붙습니다. 이걸 순서대로 밀어야 <b>스키어 → 메카닉 → 프라퍼 → 피스키퍼</b>와 맵이 하나씩 열립니다.</li>
<li>사이드 퀘스트는 상인이 열린 뒤 그 상인의 <b>등급(LL)별로 2~4개씩 묶음</b>으로 열립니다. 몇 개 깨거나 등급이 오르면 다음 묶음이 나옵니다.</li>
<li>투어 제출용 <b>인레이드 건축 자재·공구 5개, 인레이드 무기 2정</b>과 돈(<b>250,000₽ · 8,000$</b>)을 미리 챙겨 두면 막히지 않습니다.</li></ol></div>
<nav class="toc"><a href="#s1">처음 열려 있는 것</a><a href="#s2">투어 순서</a><a href="#s3">사이드 퀘스트 여는 법</a><a href="#s4">특별한 상인 해금</a><a href="#s5">10레벨까지 퀘스트</a><a href="#s6">미리 모을 아이템</a><a href="#s7">초반 팁</a></nav>

<h2 class="sec" id="s1">1. 처음 열려 있는 것</h2>
<section class="box"><table class="kv">
<tr><th>상인</th><td><a href="/guide/quests/therapist/">테라피스트</a>, <a href="/guide/quests/ragman/">래그맨</a> (펜스는 스캐브 평판으로 거래)</td></tr>
<tr><th>맵</th><td>그라운드 제로 — 나머지 맵은 투어를 진행하며 열립니다</td></tr>
<tr><th>나중에 열리는 상인</th><td>스키어·메카닉·프라퍼·피스키퍼(투어), 예거·레프·등대지기(사이드 퀘스트, 아래 4번)</td></tr>
</table></section>

<h2 class="sec" id="s2">2. 투어(Tour) 진행 순서</h2>
<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th class="n">#</th><th>상인</th><th>할 일</th><th>준비물</th><th>열리는 것</th></tr></thead><tbody>{tour_rows}</tbody></table></div>
<p class="small muted">등대 해금 금액은 공식 위키 기준 8,000달러입니다(2만·2만5천 달러로 적힌 글은 옛 정보이거나 잘못된 정보). '3회 방문'은 생존 탈출 대신 쓸 수 있는 조건이라, 탈출이 어렵다면 들어갔다 나오기를 반복해도 됩니다.</p>

<h2 class="sec" id="s3">3. 사이드 퀘스트가 열리는 방식 (1.1.0 이후)</h2>
<section class="box"><ul class="plain">
<li>상인마다 <b>LL1 기본 퀘스트</b>가 먼저 열리고, 그중 몇 개를 깨거나 상인 등급이 오르면 다음 묶음(2~4개)이 열립니다. 퀘스트 페이지의 '묶음 해금 N개'가 이 조건입니다.</li>
<li>일부는 예전처럼 <b>연쇄</b>로 이어지고, 끝에 희귀 구매·제작 해금 같은 큰 보상이 있습니다(첫 퀘스트를 받을 때 보상이 미리 보입니다).</li>
<li>스캐브 처치 목표에는 일반·저격 스캐브와 플레이어 스캐브만 인정됩니다. <b>보스·레이더·로그는 안 셉니다.</b></li>
<li>파티원이 대신 채워 줄 수 있는 목표가 생겼습니다(퀘스트 화면에 아이콘). 일부 퀘스트는 여전히 솔로 전용입니다.</li>
<li>상인 등급 조건에서 <b>판매액 조건이 없어지고</b> 레벨·평판만 남았습니다.</li></ul></section>

<h2 class="sec" id="s4">4. 특별한 상인 해금</h2>
<section class="box"><table class="kv">
<tr><th>예거</th><td>{ctx.task_link(jaeger) if jaeger else '소개'} (메카닉) — 메카닉과 대화하면 받습니다. 삼림의 예거 캠프에서 암호 메시지를 찾아 건네면 예거가 열립니다. 예거는 식량·의료 퀘스트와 은신처에 중요하니 메카닉이 열리면 바로 진행하세요.</td></tr>
<tr><th>레프</th><td>{ctx.task_link(ref) if ref else '손쉬운 돈벌이 - 파트 1'}{(' / PVE: ' + ctx.task_link(ref_pve)) if ref_pve else ''} (스키어) — <b>10레벨 + 스키어 LL2</b>. 세관 스캐브 요새 거실에 포스터를 붙이면 레프가 열립니다.</td></tr>
<tr><th>등대지기</th><td>1.1.5에서 개편된 '빛을 향해' 체인 — 투어로 <b>등대</b>를 연 상태 + 펜스·레프를 뺀 <b>모든 상인 LL3</b> + 펜스 평판 <b>2.0</b> + 메카닉에게 등대지기 이야기를 물어보면 시작합니다. (옛 가이드의 '33레벨·네트워크 공급자' 조건은 지금 맞지 않습니다)</td></tr>
</table></section>

<h2 class="sec" id="s5">5. 초반에 받는 퀘스트 — 10레벨 무렵까지 ({total}개)</h2>
<p class="small muted">상인 등급 LL1·레벨 조건 10 이하이고, 첫 묶음까지 열리며, 앞 퀘스트도 모두 초반인 것만 골랐습니다(다른 퀘스트와 택일인 스토리성 퀘스트는 제외). 해당 상인이 투어로 열려 있어야 받을 수 있습니다.
라벨: LL1 = 바로 · 묶음 1 = 같은 상인의 앞 묶음 1개 완료 후 · 연쇄 = 앞 퀘스트 완료 후. 전체 목록은 <a href="/guide/quests/">퀘스트</a>에서 상인별로 볼 수 있습니다.</p>
{"".join(blocks)}

<h2 class="sec" id="s6">6. 미리 모아 둘 아이템</h2>
<section class="box"><h3>돈</h3><p>{e(money_txt)} <span class="muted small">(투어 250,000₽·8,000$ + 위 퀘스트들의 현금 제출)</span></p>
<h3>투어 제출용 (인레이드)</h3><p class="small">건축 자재·공구 카테고리 아무거나 <b>5개</b> (볼트·너트·전선·테이프 등) · 아무 무기 <b>2정</b> · PMC 인식표 <b>5개</b>(인레이드 불필요)</p>
<h3>10레벨까지 퀘스트 제출용 — 인레이드 필요</h3><div class="chips">{fir_chips or '<span class="muted">없음</span>'}</div>
<h3>10레벨까지 퀘스트 제출용 — 사서 내도 되는 것</h3><div class="chips">{any_chips or '<span class="muted">없음</span>'}</div>
<h3>은신처 1단계 — 인레이드 필요 (PVP)</h3><div class="chips">{hide_chips or '<span class="muted">없음</span>'}</div>
<p class="small muted" style="margin-top:8px">전체 퀘스트·은신처 기준 총량은 <a href="/guide/items/">필요 아이템 총정리</a>, 은신처 단계별 재료는 <a href="/guide/hideout/">은신처</a>에서 볼 수 있습니다.</p></section>

<h2 class="sec" id="s7">7. 초반 팁</h2>
<section class="box"><ul class="plain">
<li><b>인레이드(FiR) 표시</b>는 레이드에서 직접 주워 살아서 나온 아이템에만 붙습니다. 보험으로 돌아온 장비, 상인·플리에서 산 물건에는 없습니다.</li>
<li>1.1.0부터 상인 판매가는 평균 25% 오르고, 상인 매입가는 20% 내렸으며, 플리마켓 수수료는 3%에서 5%로 올랐습니다. 파는 곳을 고를 때 차이가 커졌습니다.</li>
<li>투어의 '3회 방문'·'인식표는 인레이드 불필요' 조건을 활용하면 장비가 부족한 초반에도 막힘 없이 맵을 열 수 있습니다.</li>
<li>프레스티지를 했다면 <a href="/guide/prestige/">프레스티지 조건·보상</a>도 확인하세요. PVE 1단계는 PVP보다 조건이 가볍습니다.</li>
<li>레이드 중에는 아이템에 마우스를 올리고 F2 — <a href="/?src=guide-start">시세 오버레이</a>가 이 아이템이 퀘스트·은신처에 필요한지, 얼마에 팔리는지 바로 보여 줍니다.</li></ul></section>
<p class="small muted">출처: 공식 위키 'Tour' 문서, 패치 노트 1.1.0(2026-08-03)·1.1.5(2026-09-08)·1.2.0(2026-10-06)·1.3.0(2026-10-29, 투어·상인 해금 변경 없음 확인), tarkov.dev 퀘스트 데이터. 문장은 직접 정리했습니다.</p>"""
    path = "/guide/start/"
    title = "타르코프 초반 가이드 — 투어(Tour) 순서·상인/맵 해금·10레벨까지 퀘스트 | 탈콥 가이드"
    desc = "타르코프 새 캐릭터·프레스티지 직후 진행 순서: 투어로 스키어·메카닉·프라퍼·피스키퍼와 맵 여는 법, 사이드 퀘스트 묶음 해금, 예거·레프·등대지기 해금, 10레벨까지 퀘스트와 미리 모을 인레이드 아이템."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="start", crumbs=[("초반 가이드", None)])


# ─────────────────────────────────────────────────────────────
# 프레스티지
# ─────────────────────────────────────────────────────────────

def prestige_cond(ctx: Ctx, c: dict) -> str:
    ty = c.get("type")
    if ty == "playerLevel":
        return f'레벨 <b>{c.get("playerLevel") or c.get("count")}</b> 달성'
    if ty == "taskStatus" and c.get("task") in ctx.tasks:
        return f'{ctx.task_link(c["task"])} 완료'
    if ty == "taskStatus":
        return "특정 퀘스트 완료"
    if ty == "hideoutStation":
        sid = c.get("station") if not isinstance(c.get("station"), dict) else c["station"].get("id")
        return f'은신처 {ctx.station_link(sid, c.get("stationLevel") or c.get("count"))}'
    if ty == "skill":
        sk = c.get("skill")
        name = sk.get("name") if isinstance(sk, dict) else sk
        lvl = c.get("level") if c.get("level") is not None else (sk.get("level") if isinstance(sk, dict) else c.get("count"))
        return f'스킬 {e(ctx.skill_name(name))} <b>{lvl}</b>레벨'
    if ty == "haveItem":
        ids = c.get("items") or []
        return "창고에 " + ("".join(ctx.chip(i, c.get("count"), bool(c.get("foundInRaid"))) for i in ids[:1]) if ids else e(c.get("count"))) + " 보유"
    d = ctx.tk(c.get("description"), None)
    return e(d) if d and d != c.get("description") else e(ty)


def prestige_page(ctx: Ctx) -> tuple[str, str]:
    secs = []
    for label, plist in (("PVE", ctx.prestige_pve), ("PVP", ctx.prestige_reg)):
        rows = []
        for p in sorted(plist or [], key=lambda x: x.get("prestigeLevel") or 0):
            conds = "".join(f"<li>{prestige_cond(ctx, c)}</li>" for c in p.get("conditions") or [])
            rw = p.get("rewards") or {}
            rwp = []
            if rw.get("items"):
                rwp.append('<div class="chips">' + "".join(ctx.chip(x.get("item"), x.get("count")) for x in rw["items"]) + "</div>")
            if rw.get("skillLevelReward"):
                rwp.append(", ".join(f'{e(ctx.skill_name(x.get("skill")))} +{x.get("level")}' for x in rw["skillLevelReward"]))
            if rw.get("customization"):
                rwp.append(f'꾸미기 {len(rw["customization"])}개')
            if rw.get("traderStanding"):
                rwp.append(", ".join(f'{e(ctx.trader_name(x.get("trader")))} 평판 +{x.get("standing")}' for x in rw["traderStanding"]))
            tf = (p.get("transferSettings") or [{}])[0] or {}
            carry = f'{tf.get("gridWidth")}×{tf.get("gridHeight")}칸' if tf.get("gridWidth") else "—"
            img = f'<img src="{e(p.get("iconLink"))}" alt="" width="40" height="40" loading="lazy" />' if p.get("iconLink") else ""
            rows.append(f'<tr><td class="n">{img}<br><b>{p.get("prestigeLevel")}</b></td><td><ul class="plain">{conds}</ul></td>'
                        f'<td>{"<br>".join(rwp) or "—"}</td><td class="n small">{carry}</td></tr>')
        if rows:
            secs.append(f'<h2 class="sec" id="{label.lower()}">{label} 프레스티지 {len(rows)}단계</h2>'
                        '<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th class="n">단계</th><th>조건</th><th>보상</th><th class="n">이월 칸</th></tr></thead>'
                        f'<tbody>{"".join(rows)}</tbody></table></div>')
    body = (f'<h1>프레스티지 조건 총정리 <span class="h1en">Prestige</span></h1>'
            f'<p class="sub">PVE·PVP 단계별 조건과 보상 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note">프레스티지는 조건을 채운 고레벨 캐릭터가 진행도를 초기화하고 다시 시작하는 대신 고유 보상을 받는 시스템입니다. '
            '1.2.0(2026-10-06)부터 <b>PVE에도 6단계</b>가 생겼고, PVE 1단계는 PVP보다 조건이 가볍습니다. 초기화할 때 장비 일부와 스킬·무기 숙련도 일부(이월 비율은 단계별로 PVE 10~50%, PVP 5~30% — 공식 위키 Prestige 문서 기준)를 가져갈 수 있고, '
            '"이월 칸" 크기만큼 허용된 종류의 아이템을 옮길 수 있습니다. PVE 프레스티지는 PVE 캐릭터만 초기화합니다.</div>'
            f'<nav class="toc"><a href="#pve">PVE</a><a href="#pvp">PVP</a><a href="/guide/start/">초기화 뒤 초반 가이드 →</a></nav>'
            + "".join(secs)
            + '<p class="small muted">출처: tarkov.dev 프레스티지 데이터, 패치 노트 1.2.0. 시세 오버레이 v1.2.5는 PVE 프레스티지를 게임 로그로 자동 감지해 퀘스트 진행을 새로 시작합니다.</p>')
    path = "/guide/prestige/"
    title = "타르코프 프레스티지 조건 총정리 — PVE·PVP 단계별 요구사항과 보상 | 탈콥 가이드"
    desc = "타르코프 프레스티지 PVE 6단계·PVP 단계별 조건(레벨·퀘스트·은신처·스킬·보유 금액)과 보상, 초기화 때 가져가는 보관함 크기. 1.2.0 PVE 프레스티지 반영."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="prestige", crumbs=[("프레스티지", None)])


# ─────────────────────────────────────────────────────────────
# 맵 · 보스
# ─────────────────────────────────────────────────────────────

def _escort_txt(ctx: Ctx, esc_list):
    out = []
    for es in esc_list or []:
        counts = [a.get("count") for a in es.get("amount") or [] if a.get("count") is not None]
        rng = (f"{min(counts)}~{max(counts)}명" if counts and min(counts) != max(counts) else f"{counts[0]}명") if counts else ""
        out.append(f"{ctx.mob_name(es.get('mob'))} {rng}".strip())
    return ", ".join(out)


def map_quests(ctx: Ctx, mid: str) -> list[str]:
    out = []
    for tid, t in ctx.tasks.items():
        if mid in ctx.task_maps(t):
            out.append(tid)
    return out


def map_page(ctx: Ctx, mid: str) -> tuple[str, str]:
    m = ctx.maps[mid]
    slug = m.get("normalizedName")
    name = ctx.map_name(mid)
    en_name = slug.replace("-", " ").title()
    desc_ko = ctx._loc(ctx.loc_maps, m.get("description"), "")
    fix = MAP_FIX.get(slug, {})
    rows = [("레이드 시간", (f'{m.get("raidDuration")}분' if m.get("raidDuration") else "—") + (f' <span class="muted small">({fix["duration_note"]})</span>' if fix.get("duration_note") else "")),
            ("인원", e(fix.get("players") or m.get("players") or "—") + (f' <span class="muted small">({fix["players_note"]})</span>' if fix.get("players_note") else ""))]
    lo_lv, hi_lv = m.get("minPlayerLevel") or 0, m.get("maxPlayerLevel") or 0
    if lo_lv > 0 or 0 < hi_lv < 79:  # 0~99·0~100은 사실상 제한 없음
        rows.append(("입장 레벨", f"{lo_lv}~{hi_lv} 레벨" if hi_lv else f"{lo_lv} 레벨 이상"))
    acc = _flat(m.get("accessKeys"))
    if acc:
        rows.append(("입장 아이템", '<div class="chips">' + "".join(ctx.chip(i) for i in acc) + "</div>"
                     + (f'<span class="muted small">{m.get("accessKeysMinPlayerLevel")}레벨 이상</span>' if m.get("accessKeysMinPlayerLevel") else "")))
    variants = [ctx.map_name(x) for x, mm in ctx.maps.items() if MAP_VARIANTS.get(mm.get("normalizedName")) == slug and mm.get("normalizedName") != "ground-zero-tutorial"]
    if variants:
        rows.append(("변형", ", ".join(e(v) for v in variants) + ' <span class="muted small">(같은 지역의 다른 판 — 보스·탈출구가 다를 수 있음)</span>'))
    boss_rows = []
    has_event_mob = False
    # 데이터는 스폰 지점마다 줄이 따로 있다(쇄빙선 웨지 12줄, 감염자 3줄 등) → 같은 적은 한 줄로: 확률 최대, 위치·호위 합집합
    grouped: dict[str, dict] = {}
    for b in m.get("bosses") or []:
        ev = is_event_mob(b.get("mob"))
        has_event_mob = has_event_mob or ev
        label = ctx.mob_name(b.get("mob"))
        g = grouped.setdefault(label, {"chance": 0, "zones": [], "escorts": [], "ev": ev})
        g["chance"] = max(g["chance"], b.get("spawnChance") or 0)
        for z in b.get("spawnLocations") or []:
            zn = ctx._loc(ctx.loc_maps, z.get("spawnKey"), z.get("name"))
            if zn and zn not in g["zones"]:
                g["zones"].append(zn)
        et = _escort_txt(ctx, b.get("escorts"))
        if et and et not in g["escorts"]:
            g["escorts"].append(et)
    for label, g in grouped.items():
        boss_rows.append(f'<tr><td><b>{e(label)}</b>{" " + EVENT_TAG if g["ev"] else ""}</td><td class="n">{fmt_int(g["chance"] * 100)}%</td>'
                         f'<td class="small">{e(", ".join(g["zones"]))}</td><td class="small">{e(" / ".join(g["escorts"]))}</td></tr>')
    is_event_map = slug in EVENT_MAPS
    ex_groups: dict[str, list] = {}
    for ex in m.get("extracts") or []:
        if (slug, ex.get("name")) in EXTRACT_SKIP:
            continue
        fac = ex.get("faction") or "shared"
        cond = []  # 이미 안전한 HTML 조각만 넣는다(칩 HTML을 다시 이스케이프하면 글자로 보인다)
        # 조건은 위키 기준 표(python-core/extract_conditions.py). 데이터의 switches 는 맵 전체 스위치가
        # 모든 탈출구에 붙어 있어 조건으로 쓰면 틀린다.
        tags, text, give = extract_conditions.conditions(slug, ex)
        if text:
            cond.append(e(text))
        if give and "vex" not in tags:  # 차량 탈출 요금은 인원·카르마로 바뀌어 고정 금액을 적지 않는다
            if give["money"]:
                cost = ctx.money(give["id"], give["count"])
                cond.append("유료 " + e(cost or f'{give["count"]:,}{give["money"]}'))
            else:
                cond.append("필요 아이템 " + ctx.chip(give["id"], give["count"]))
        ex_groups.setdefault(fac, []).append(f'<li><b>{e(ctx._loc(ctx.loc_maps, ex.get("name"), ex.get("name")))}</b>'
                                             + (f'<div class="xcond small">{" · ".join(cond)}</div>' if cond else "") + "</li>")
    fac_label = {"pmc": "PMC", "scav": "스캐브", "shared": "공용(PMC·스캐브)"}
    ex_html = "".join(f'<div><h3>{fac_label.get(f, f)} <span class="muted small">{len(v)}개</span></h3><ul class="plain">{"".join(v)}</ul></div>'
                      for f, v in sorted(ex_groups.items(), key=lambda kv: ["pmc", "shared", "scav"].index(kv[0]) if kv[0] in ("pmc", "shared", "scav") else 9))
    tr_rows = []
    for tr in m.get("transits") or []:
        dest = tr.get("map")
        dest_id = dest.get("id") if isinstance(dest, dict) else dest
        tr_rows.append(f'<li>{e(ctx._loc(ctx.loc_maps, tr.get("description"), "이동"))} — {ctx.map_link(dest_id)}</li>')
    hz: dict[str, int] = {}
    for h in m.get("hazards") or []:
        hz[h.get("hazardType") or "hazard"] = hz.get(h.get("hazardType") or "hazard", 0) + 1
    hz_txt = ", ".join(f"{HAZARD.get(k, k)}(표시 구역 {v}개)" for k, v in hz.items())  # 데이터의 폴리곤 수 — '곳'으로 읽히면 과장됨
    extra = []
    if hz_txt:
        extra.append(("위험 지역", e(hz_txt)))
    if m.get("stationaryWeapons"):
        extra.append(("거치 화기", f'{len(m["stationaryWeapons"])}곳'))
    if m.get("btrStops"):
        extra.append(("BTR 정류장", f'{len(m["btrStops"])}곳'))
    if m.get("locks"):
        extra.append(("잠긴 곳", f'{len(m["locks"])}곳 — <a href="/guide/keys/">맵별 열쇠</a>에서 열쇠 목록 보기'))
    rows += extra
    qs = map_quests(ctx, mid)
    by_tr: dict[str, list] = {}
    for tid in qs:
        by_tr.setdefault(ctx.trader_slug(ctx.tasks[tid].get("trader")), []).append(tid)
    q_html = "".join(f'<div><h3>{e(ctx.trader_name(ctx.trader_by_slug.get(s)))} <span class="muted small">{len(v)}</span></h3><ul class="plain">'
                     + "".join(f"<li>{ctx.task_link(x)}</li>" for x in sorted(v, key=lambda x: ctx.task_names(x)[0])) + "</ul></div>"
                     for s, v in sorted(by_tr.items(), key=lambda kv: TRADER_ORDER.index(kv[0]) if kv[0] in TRADER_ORDER else 99))
    enemies = ", ".join(dict.fromkeys(e(ctx.mob_name(x)) for x in m.get("enemies") or [] if not str(x).startswith("follower")))
    body = (f'<h1>{e(name)} <span class="h1en">{e(en_name)}</span>{" " + EVENT_TAG if is_event_map else ""}</h1>'
            f'<p class="sub">맵 정보 · 보스 {len(boss_rows)} · 탈출구 {len(m.get("extracts") or [])} · 관련 퀘스트 {len(qs)} · 데이터 기준 {e(ctx.stamp)}</p>'
            + (event_note("이 맵은 이벤트 기간에만 들어갈 수 있습니다.") if is_event_map else "")
            + (f'<p class="small muted">{e(desc_ko)}</p>' if desc_ko else "")
            + f'<section class="box"><h2>기본 정보</h2><table class="kv">{"".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in rows)}'
            + (f"<tr><th>등장 적</th><td class=small>{enemies}</td></tr>" if enemies else "") + "</table></section>"
            + (('<section class="box"><h2>보스</h2>'
                + (event_note("감염자 계열은 이벤트 기간에만 출현하고, 다른 보스의 출현 확률도 이벤트 중에는 평소와 다를 수 있습니다.") if (has_event_mob and not is_event_map) else "")
                + '<div class="tbl"><table class="tot"><thead><tr><th>보스</th><th class="n">출현 확률</th><th>출현 위치</th><th>호위</th></tr></thead><tbody>'
                + "".join(boss_rows) + "</tbody></table></div></section>") if boss_rows else "")
            + (f'<section class="box"><h2>탈출구</h2><div class="cols3">{ex_html}</div><p class="small muted">조건이 적혀 있지 않은 탈출구는 대개 그냥 나갈 수 있지만, 공식 위키 표에 아직 없는 새 탈출구(1.2.0 세관 추가분 등)는 조건을 확인하지 못했습니다. 조건은 공식 위키 기준이며, 탈출구가 열리는지는 레이드마다 달라질 수 있으니 게임 안 탈출구 목록(O키 두 번)도 확인하세요.</p></section>' if ex_html else "")
            + (f'<section class="box"><h2>탈출구</h2><p class="small">{HAND_EXTRACTS[slug]}</p></section>' if (not ex_html and slug in HAND_EXTRACTS) else "")
            + (f'<section class="box"><h2>다른 맵으로 이동(트랜짓)</h2><ul class="plain">{"".join(tr_rows)}</ul></section>' if tr_rows else "")
            + (f'<section class="box"><h2>이 맵의 퀘스트 {len(qs)}개</h2><div class="cols3">{q_html}</div></section>' if q_html else ""))
    path = f"/guide/maps/{slug}/"
    boss_names = ", ".join(dict.fromkeys(ctx.mob_name(b.get("mob")) for b in m.get("bosses") or []))
    title = f"타르코프 {name} 공략 정보 — 탈출구·보스·퀘스트 {len(qs)}개 | 탈콥 가이드"
    desc = f"타르코프 {name}({en_name}) 맵 정보: 레이드 {m.get('raidDuration')}분, {m.get('players')}명, 보스 {boss_names or '없음'}, 탈출구 {len(m.get('extracts') or [])}개, 트랜짓, 이 맵 퀘스트 {len(qs)}개. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="maps", crumbs=[("맵", "/guide/maps/"), (name, None)])


def main_maps(ctx: Ctx) -> list[str]:
    out = []
    for slug in MAP_ORDER:
        mid = ctx.map_by_slug.get(slug)
        if mid:
            out.append(mid)
    for mid, m in ctx.maps.items():
        s = m.get("normalizedName")
        if mid not in out and s not in MAP_VARIANTS and s not in MAP_ORDER:
            out.append(mid)
    return out


def maps_index(ctx: Ctx) -> tuple[str, str]:
    cards = []
    for mid in main_maps(ctx):
        m = ctx.maps[mid]
        bosses = ", ".join(dict.fromkeys(ctx.mob_name(b.get("mob")) for b in m.get("bosses") or [] if str(b.get("mob", "")).startswith("boss")))
        nq = len(map_quests(ctx, mid))
        cards.append(f'<a class="hub" href="/guide/maps/{e(m.get("normalizedName"))}/"><div class="t">{e(ctx.map_name(mid))}{" " + EVENT_TAG if m.get("normalizedName") in EVENT_MAPS else ""}</div>'
                     f'<div class="d">레이드 {m.get("raidDuration") or "—"}분 · {e(m.get("players") or "—")}명 · 탈출구 {len(m.get("extracts") or [])}</div>'
                     f'<div class="d">보스: {e(bosses) or "없음"}</div><div class="d">퀘스트 {nq}개</div></a>')
    body = (f'<h1>맵 정보 <span class="h1en">Maps</span></h1><p class="sub">맵 {len(cards)}개 · 보스·탈출구·트랜짓·퀘스트 · 데이터 기준 {e(ctx.stamp)}</p>'
            f'<div class="cards">{"".join(cards)}</div>'
            '<p class="small muted">보스별로 모아 보려면 <a href="/guide/bosses/">보스 총정리</a>, 열쇠는 <a href="/guide/keys/">맵별 열쇠</a>.</p>')
    path = "/guide/maps/"
    title = "타르코프 맵 정보 총정리 — 보스 출현 확률·탈출구·퀘스트 | 탈콥 가이드"
    desc = "타르코프 전체 맵(세관·삼림·해안선·인터체인지·리저브·등대·시내·연구소·쇄빙선 등)의 레이드 시간, 인원, 보스 출현 확률, 탈출구, 트랜짓, 맵별 퀘스트."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="maps", crumbs=[("맵", None)])


# 데이터 mob 키는 대소문자를 가린다: 레이더=PmcBot, 로그=ExUsec·exUsecFree (2026-11-02 확인 — 소문자로 적어 둬 둘 다 빠져 있었음)
BOSS_EXTRA = {"sectantPriest", "PmcBot", "ExUsec", "exUsecFree", "blackDivision"}  # 터미널 블랙 디비전은 키에 boss 접두가 없다(2026-11-02)


def bosses_page(ctx: Ctx) -> tuple[str, str]:
    agg: dict[str, dict] = {}
    for mid in main_maps(ctx) + [x for x, m in ctx.maps.items() if m.get("normalizedName") in MAP_VARIANTS and m.get("normalizedName") != "ground-zero-tutorial"]:
        m = ctx.maps[mid]
        for b in m.get("bosses") or []:
            mob = b.get("mob")
            if not mob or not (str(mob).startswith("boss") or mob in BOSS_EXTRA):
                continue
            a = agg.setdefault(mob, {"maps": [], "escorts": set()})
            zones = ", ".join(ctx._loc(ctx.loc_maps, z.get("spawnKey"), z.get("name")) for z in b.get("spawnLocations") or [])
            a["maps"].append((mid, b.get("spawnChance") or 0, zones))
            et = _escort_txt(ctx, b.get("escorts"))
            if et:
                a["escorts"].add(et)
    cards = []
    for mob, a in sorted(agg.items(), key=lambda kv: (not str(kv[0]).startswith("boss"), ctx.mob_name(kv[0]))):
        mb = ctx.mobs.get(mob) or {}
        hp = sum(h.get("max") or 0 for h in mb.get("health") or [])
        img = f'<img class="portrait" src="{e(mb.get("imagePortraitLink"))}" alt="" width="72" height="72" loading="lazy" />' if mb.get("imagePortraitLink") else ""
        merged: dict[str, list] = {}  # 같은 맵의 스폰 지점별 줄(쇄빙선 웨지 12줄 등)을 맵 하나로 합친다 — 확률은 최대, 위치는 합집합
        for x, c, z in a["maps"]:
            mm = merged.setdefault(x, [0, []])
            mm[0] = max(mm[0], c)
            for zz in (z.split(", ") if z else []):
                if zz and zz not in mm[1]:
                    mm[1].append(zz)
        lis = "".join(f'<li>{ctx.map_link(x)} <b>{fmt_int(c * 100)}%</b> <span class="muted small">{e(", ".join(z))}</span></li>'
                      for x, (c, z) in sorted(merged.items(), key=lambda kv: -kv[1][0]))
        cards.append(f'<section class="box boss">{img}<div><h2>{e(ctx.mob_name(mob))}</h2>'
                     + (f'<p class="small muted">체력 합계 {hp}</p>' if hp else "")
                     + f'<ul class="plain">{lis}</ul>'
                     + (f'<p class="small">호위: {e(" / ".join(sorted(a["escorts"])))}</p>' if a["escorts"] else "") + "</div></section>")
    if "bossPartisan" not in agg:
        # 파르티잔은 카르마에 따라 출현해 공개 데이터에 확률이 비는 때가 있다(2026-11 할로윈 이벤트 기간 데이터에서 통째로 빠짐).
        # 보스가 없는 것처럼 보이지 않게 공식 위키(Partisan 문서) 기준으로 카드를 유지한다.
        mb = ctx.mobs.get("bossPartisan") or {}
        hp = sum(h.get("max") or 0 for h in mb.get("health") or [])
        img = f'<img class="portrait" src="{e(mb.get("imagePortraitLink"))}" alt="" width="72" height="72" loading="lazy" />' if mb.get("imagePortraitLink") else ""
        maps_txt = " · ".join(f'<a href="/guide/maps/{s}/">{n}</a>' for s, n in (("customs", "세관"), ("woods", "삼림"), ("shoreline", "해안선"), ("lighthouse", "등대")))
        cards.append(f'<section class="box boss">{img}<div><h2>{e(ctx.mob_name("bossPartisan"))}</h2>'
                     + (f'<p class="small muted">체력 합계 {hp}</p>' if hp else "")
                     + f'<p class="small">{maps_txt} — 맵 전역에서 나올 수 있음</p>'
                     '<p class="small muted">출현 확률은 공개 데이터에 없음(카르마가 낮은 PMC가 있는 레이드에 더 자주 나타나고, 1.3.0에서 카르마 낮은 플레이어가 없는 레이드의 출현 확률 계산 오류가 수정됨). '
                     '출처: <a href="https://escapefromtarkov.fandom.com/wiki/Partisan" rel="noopener" target="_blank">공식 위키 Partisan</a></p></div></section>')
    body = (f'<h1>보스 총정리 <span class="h1en">Bosses</span></h1><p class="sub">보스·특수 적 {len(cards)}종 · 출현 맵과 확률 · 호위 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note">출현 확률은 레이드마다의 기본 확률이며, 이벤트 기간에는 크게 달라집니다(예: 2026-09 이벤트 때 글루하가 등대 정수장에 100% 출현). 같은 보스가 맵의 여러 변형(야간 공장 등)에 따로 나오면 각각 표시합니다.</div>'
            + event_note("감염자·감염된 타길라는 이벤트 기간에만 출현하며(<a href=\"/guide/maps/infected-factory/\">오염된 공장</a>·<a href=\"/guide/maps/infected-lab/\">오염된 연구소</a> 참고), 아래 확률은 이벤트 중 값입니다.")
            + f'<div class="bossgrid">{"".join(cards)}</div>')
    path = "/guide/bosses/"
    title = "타르코프 보스 총정리 — 출현 맵·확률·위치·호위·체력 | 탈콥 가이드"
    desc = f"타르코프 보스 {len(cards)}종(르샬라·킬라·타길라·세니타·글루하·슈트르만·카반·즈리야치 등)의 출현 맵, 출현 확률, 출현 위치, 호위 인원, 체력. 데이터 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="bosses", crumbs=[("보스", None)])


# ─────────────────────────────────────────────────────────────
# 가이드 홈 + 전체 생성
# ─────────────────────────────────────────────────────────────

def hub_page(ctx: Ctx, counts: dict) -> tuple[str, str]:
    cards = [
        ("/guide/start/", "초반 가이드", "투어(Tour)로 상인·맵 여는 순서 · 10레벨까지 퀘스트 · 미리 모을 아이템", "처음·프레스티지 직후"),
        ("/guide/quests/", "퀘스트", "상인별 해금 순서 · 퀘스트마다 목표·필요템·열쇠·보상", f'{counts.get("quests", 0)}개'),
        ("/guide/items/", "필요 아이템 총정리", "퀘스트·은신처에 들어가는 아이템 총량 · 버리면 안 되는 템", f'{counts.get("items", 0)}종'),
        ("/guide/rewards/", "보상으로 받는 아이템", "어떤 퀘스트가 이 아이템을 주는지 · 처음부터 어떤 순서로 깨야 받는지", f'{counts.get("rewards", 0)}종'),
        ("/guide/quest-items/", "퀘스트 전용 아이템", "레이드에서 찾는 퀘스트템 · 지도별", f'{counts.get("qitems", 0)}종'),
        ("/guide/hideout/", "은신처", "시설별 단계 재료·조건·효과·제작 · 남은 재료 계산기", f'{counts.get("stations", 0)}개 시설'),
        ("/guide/maps/", "맵 정보", "보스 출현 확률·탈출구·트랜짓·맵별 퀘스트", f'{counts.get("maps", 0)}개'),
        ("/guide/bosses/", "보스 총정리", "출현 맵·확률·위치·호위", f'{counts.get("bosses", 0)}종'),
        ("/guide/crafts/", "제작 수익표", "은신처 제작 재료비·판매가·시간당 이익 순위", f'{counts.get("crafts", 0)}개'),
        ("/guide/ammo/", "탄약표", "구경별 관통력·데미지·방어구 피해·상인 구매처", f'{counts.get("ammo", 0)}종'),
        ("/guide/prestige/", "프레스티지", "PVE·PVP 단계별 조건과 보상", "1.2.0 PVE 반영"),
        ("/guide/patch/", "패치 요약", f"1.0.5~{GAME_VERSION} 주요 변경 한국어 정리", "2026-05~10"),
        ("/guide/promo/", "프로모 코드", "지금 쓸 수 있는 공식 프로모 코드 · 모드별 · 등록 방법", f'{counts.get("promo", 0)}개 · {PROMO_CHECKED}'),
        ("/guide/gunsmith/", "건스미스 부품 총정리", "퀘스트별 무기·필수 부품·성능 조건 + 전체 부품 체크리스트(즐겨찾기용)", f'{counts.get("gunsmith_q", 0)}개 퀘스트 · 부품 {counts.get("gunsmith_p", 0)}종'),
        ("/guide/kappa/", "카파템", "수집가(Collector) 제출 아이템 · 보유 체크", f'{counts.get("kappa", 0)}개'),
        ("/guide/keys/", "맵별 열쇠", "여는 곳·퀘스트 필요 키·시세", f'{counts.get("keys", 0)}개'),
    ]
    html_cards = "".join(f'<a class="hub" href="{href}"><div class="t">{e(t)}</div><div class="d">{e(d)}</div><div class="n2">{e(n)}</div></a>' for href, t, d, n in cards)
    body = (f'<h1>탈콥 가이드 <span class="h1en">타르코프 한국어 정리</span></h1>'
            f'<p class="sub">공개 게임 데이터로 만드는 한국어 정리 · 패치·이벤트 뒤 다시 생성 · 데이터 기준 {e(ctx.stamp)} · 게임 {GAME_VERSION}</p>'
            f'<div class="cards">{html_cards}</div>'
            '<section class="box"><h2>이 가이드는</h2><p class="small">퀘스트 목표·아이템·은신처·맵 정보는 <a href="https://tarkov.dev" rel="noopener">tarkov.dev</a> 공개 데이터에서 자동으로 만들고, '
            '초반 진행·프레스티지 설명은 공식 위키와 패치 노트를 확인해 직접 정리했습니다. 보유·완료 체크는 이 브라우저에만 저장됩니다.</p></section>')
    title = "탈콥 가이드 — 타르코프 퀘스트·은신처·필요 아이템·맵·보스·카파템 한국어 정리"
    desc = "타르코프(Escape from Tarkov) 한국어 가이드: 초반 투어 진행, 전체 퀘스트 목표·필요템, 퀘스트·은신처 필요 아이템 총정리, 은신처 단계별 재료, 맵별 보스·탈출구, 프레스티지, 카파템, 맵별 열쇠."
    return "/guide/", page(ctx, path="/guide/", title=title, desc=desc, body=body, nav="", og_type="website")


# ─────────────────────────────────────────────────────────────
# 가격 도우미 · 은신처 제작 수익 · 탄약표 · 패치 요약
# ─────────────────────────────────────────────────────────────

def _raw(ctx: Ctx, iid, mode):
    src = ctx.items_pve if mode == "pve" else ctx.items
    return src.get(iid) or ctx.items.get(iid) or {}


def buy_price(ctx: Ctx, iid, mode="pvp"):
    """살 때 드는 값: 플리 24시간 평균과 상인 판매가 중 싼 쪽(₽). 돈 아이템은 환산가."""
    if iid == "5449016a4bdc2d6f028b456f":
        return 1.0
    it = _raw(ctx, iid, mode)
    cands = []
    if it.get("avg24hPrice") and "noFlea" not in (it.get("types") or []):
        cands.append(it["avg24hPrice"])
    for o in it.get("buyFromTrader") or []:
        if o.get("priceRUB"):
            cands.append(o["priceRUB"])
    return min(cands) if cands else None


def sell_value(ctx: Ctx, iid, mode="pvp"):
    """팔 때 받는 값: 플리 24시간 평균(거래 가능하면), 아니면 상인 최고 매입가(₽). 수수료 미반영."""
    it = _raw(ctx, iid, mode)
    if it.get("avg24hPrice") and "noFlea" not in (it.get("types") or []):
        return it["avg24hPrice"]
    best = max((o.get("priceRUB") or 0 for o in it.get("sellToTrader") or []), default=0)
    return best or None


def craft_calc(ctx: Ctx, c: dict, mode: str):
    p = c.get("productItem") or {}
    val = sell_value(ctx, p.get("item"), mode)
    if val is None:
        return None
    value = val * (p.get("count") or 1)
    cost = 0.0
    for r in c.get("requiredItems") or []:
        if (r.get("attributes") or {}).get("tool"):
            continue  # 도구는 돌려받는다
        bp = buy_price(ctx, r.get("item"), mode)
        if bp is None:
            return None
        cost += bp * (r.get("count") or 1)
    profit = value - cost
    hours = (c.get("duration") or 0) / 3600
    return {"value": value, "cost": cost, "profit": profit, "per_h": profit / hours if hours > 0 else None}


CRAFTS_JS = """<script>
(function(){var MK="guide.mode";function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}
var mode=L(MK,"pvp"),rows=[].slice.call(document.querySelectorAll("#ctbl tbody tr"));
function f(n){return n===""||n==null||isNaN(+n)?"—":Math.round(+n).toLocaleString("ko-KR")+"₽"}
function seg(v){document.querySelectorAll("#cmode button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)})}
function render(){var q=document.getElementById("cq").value.trim().toLowerCase(),st=document.getElementById("cst").value,pos=document.getElementById("cpos").checked,p=mode==="pve"?"e":"p";
rows.forEach(function(r){var d=r.dataset,ok=true;if(q&&d.s.indexOf(q)<0)ok=false;if(st&&d.st!==st)ok=false;if(pos&&!(+d[p+"pr"]>0))ok=false;r.style.display=ok?"":"none";
var c=r.querySelectorAll("td.m");c[0].textContent=f(d[p+"co"]);c[1].textContent=f(d[p+"va"]);c[2].textContent=f(d[p+"pr"]);c[3].textContent=f(d[p+"ph"]);
c[2].className="m n "+(+d[p+"pr"]>0?"up":"down");c[3].className="m n "+(+d[p+"ph"]>0?"up":"down");});
var tb=document.querySelector("#ctbl tbody");rows.slice().sort(function(a,b){return(+b.dataset[p+"ph"]||-1e12)-(+a.dataset[p+"ph"]||-1e12)}).forEach(function(r){tb.appendChild(r)});}
seg(mode);document.getElementById("cmode").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;mode=v;try{localStorage.setItem(MK,JSON.stringify(v))}catch(x){}seg(v);render()});
["cst","cpos"].forEach(function(id){document.getElementById(id).addEventListener("change",render)});document.getElementById("cq").addEventListener("input",render);render();})();
</script>"""


def crafts_page(ctx: Ctx) -> tuple[str, str]:
    unlock = craft_unlocks(ctx)
    rows = []
    for c in ctx.crafts_reg:
        a, b = craft_calc(ctx, c, "pvp"), craft_calc(ctx, c, "pve")
        rows.append((c, a, b))
    rows.sort(key=lambda r: -(r[1]["per_h"] if r[1] and r[1]["per_h"] is not None else -1e12))
    st_opts = sorted({c.get("station") for c, _, _ in rows}, key=lambda s: ctx.station_name(s))
    trs = []
    for c, a, b in rows:
        p = c.get("productItem") or {}
        pid = p.get("item")
        it = ctx.item(pid) or {}
        mats = []
        for r in c.get("requiredItems") or []:
            tool = (r.get("attributes") or {}).get("tool")
            mats.append(ctx.chip(r.get("item"), r.get("count"), extra=' <span class="badge b-any">도구</span>' if tool else ""))
        for r in c.get("requiredQuestItems") or []:  # 퀘스트 아이템 재료 — 2026-11-02 위키 대조에서 누락 발견(7개 제작)
            qid = r.get("item") if isinstance(r, dict) else r
            qid = qid.get("id") if isinstance(qid, dict) else qid
            if qid:
                mats.append(ctx.chip(qid, (r.get("count") if isinstance(r, dict) else None) or 1, extra=' <span class="badge b-any">퀘스트 아이템</span>'))
        q = unlock.get((c.get("station"), c.get("level"), pid))
        lock = ('<div class="osub">해금: ' + ", ".join(ctx.task_link(x) for x in q) + "</div>") if q else ""

        def num(d, k):
            return "" if not d or d.get(k) is None else f"{d[k]:.0f}"
        names = " ".join([it.get("n") or "", it.get("en") or ""] + [(ctx.item(r.get("item")) or {}).get("n") or "" for r in c.get("requiredItems") or []]).lower()
        trs.append(f'<tr data-s="{e(names)}" data-st="{e(c.get("station"))}" '
                   f'data-pco="{num(a, "cost")}" data-pva="{num(a, "value")}" data-ppr="{num(a, "profit")}" data-pph="{num(a, "per_h")}" '
                   f'data-eco="{num(b, "cost")}" data-eva="{num(b, "value")}" data-epr="{num(b, "profit")}" data-eph="{num(b, "per_h")}">'
                   f'<td class="pr">{ctx.chip(pid, p.get("count"))}{lock}</td><td class="small nw" data-l="시설">{ctx.station_link(c.get("station"), c.get("level"))}</td>'
                   f'<td class="n" data-l="시간">{fmt_dur(c.get("duration"))}</td><td class="mt" data-l="재료"><div class="chips">{"".join(mats)}</div></td>'
                   '<td class="m n" data-l="재료비"></td><td class="m n" data-l="판매가"></td><td class="m n" data-l="이익"></td><td class="m n" data-l="시간당"></td></tr>')
    opts = '<option value="">모든 시설</option>' + "".join(f'<option value="{e(s)}">{e(ctx.station_name(s))}</option>' for s in st_opts)
    body = f"""<h1>은신처 제작 수익표 <span class="h1en">Crafting profit</span></h1>
<p class="sub">제작 {len(trs)}개 · 시간당 이익 순 · 시세 기준 {e(ctx.stamp)} (tarkov.dev 24시간 평균)</p>
<div class="note">⚠ <b>공식 위키 Crafts 표와 다른 제작(2026-11-02 전수 대조, 어느 쪽이 현재 게임과 맞는지 미확인)</b> — 재료: 5.56x45 MK 318(SOST) 90발은 위키가 화약 Eagle 2·Kite 4, M855A1 90발은 위키에 Kite 없음, ANA M2 플레이트 캐리어는 위키가 Ox bleach 2·Ripstop 없음, AK-50은 위키에 RPK-16 요구 없음 · 산출: 12/70 플레셰트 위키 60발(데이터 40) · 시설 단계: .300 BLK M62 작업대 3단계(데이터 2), 차량 배터리 작업대 2단계(데이터 1), Wilston 담배 조리 시설 2단계(데이터 1) · 시간: BNTI Zhuk(Press) 위키 2시간 6분(데이터 1시간 6분) 등 8건은 몇 분 차이. 위키에만 있는 제작 5개(스토리 챕터 연계)는 데이터에 없음. 시즌 모드에서는 제작 시간이 절반입니다.</div>
<div class="note">이익 = 결과물 판매가 − 재료 구입비. 결과물은 플리 24시간 평균가(플리 거래 불가면 상인 최고 매입가), 재료는 플리 평균가와 상인 판매가 중 싼 쪽으로 계산했습니다.
<b>도구</b> 표시 재료는 돌려받으므로 비용에서 뺐습니다. <b>연료비·플리 수수료(1.1.0부터 인상)·판매 시간은 빠져 있으니</b> 실제 이익은 이보다 작습니다. 시세는 하루에도 크게 움직이니 참고용으로만 보세요.</div>
<div class="controls"><input type="search" id="cq" placeholder="결과물·재료 이름 검색" aria-label="검색" /><select id="cst" aria-label="시설">{opts}</select>
<div class="seg" id="cmode"><button data-v="pvp" class="on">PVP 시세</button><button data-v="pve">PVE 시세</button></div>
<label class="chk"><input type="checkbox" id="cpos" /> 이익 나는 것만</label></div>
<div class="box tbl" style="padding:4px 8px"><table class="tot" id="ctbl"><thead><tr><th>결과물</th><th>시설</th><th class="n">시간</th><th>재료</th><th class="n">재료비</th><th class="n">판매가</th><th class="n">이익</th><th class="n">시간당</th></tr></thead><tbody>
{"".join(trs)}
</tbody></table></div>
<p class="small muted">시설별 단계 조건과 레시피는 <a href="/guide/hideout/">은신처</a>에서 볼 수 있습니다.</p>"""
    path = "/guide/crafts/"
    title = "타르코프 은신처 제작 수익표 — 시간당 이익 순위·재료비·판매가 | 탈콥 가이드"
    desc = f"타르코프 은신처 제작 {len(trs)}개의 재료비·판매가·이익·시간당 이익을 tarkov.dev 시세로 계산해 정렬. PVP·PVE 시세 전환, 시설별 필터. 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="crafts", crumbs=[("제작 수익", None)], scripts=CRAFTS_JS)


CAL_OVERRIDES = {"1143x23ACP": ".45 ACP", "9x18PM": "9x18 PM", "9x18PMM": "9x18 PMM", "9x19PARA": "9x19", "9x33R": ".357",
                 "127x33": ".50 AE", "23x75": "23x75", "26x75": "26x75", "40x46": "40x46", "20x1mm": "20x1mm",  # 두 자리 구경(KS-23·신호탄·유탄·장난감)은 소수점 규칙 예외(2026-11-02) "127x55": "12.7x55", "127x99": ".50 BMG", "12g": "12 게이지", "20g": "20 게이지",
                 "366TKM": ".366 TKM", "40mmRU": "40mm (RU)", "46x30": "4.6x30", "556x45NATO": "5.56x45 NATO", "57x28": "5.7x28",
                 "762x25TT": "7.62x25 TT", "762x35": "7.62x35 (.300 BLK)", "784x49": ".308 ME", "86x70": ".338 LM", "725": "72.5mm"}
CAL_ORDER = ["545x39", "556x45NATO", "762x39", "762x51", "762x54R", "9x19PARA", "9x39", "366TKM", "46x30", "57x28",
             "1143x23ACP", "9x18PM", "9x21", "762x25TT", "12g", "20g", "23x75", "127x55", "86x70", "68x51", "58x42", "762x35"]


def cal_name(raw: str) -> str:
    """앱(tarkov_api._caliber_display)과 같은 규칙 — 'Caliber545x39' → '5.45x39'"""
    s = raw[len("Caliber"):] if raw.startswith("Caliber") else raw
    if s in CAL_OVERRIDES:
        return CAL_OVERRIDES[s]
    m = re.match(r"^(\d+)x(.+)$", s)
    if not m:
        return s
    bore, rest = m.group(1), m.group(2)
    if len(bore) == 2:
        bore = f"{bore[0]}.{bore[1]}"
    elif len(bore) == 3:
        bore = f"{bore[:2]}.{bore[2]}" if bore.startswith("12") else f"{bore[0]}.{bore[1:]}"
    elif len(bore) >= 4:
        bore = f"{bore[:-2]}.{bore[-2:]}"
    return f"{bore}x{rest}"


def ammo_page(ctx: Ctx) -> tuple[str, str]:
    by_cal: dict[str, list] = {}
    for iid, it in ctx.items.items():
        if "ammo" not in (it.get("types") or []):
            continue
        p = it.get("properties") or {}
        cal = p.get("caliber") if isinstance(p, dict) else None
        if not cal:
            continue
        by_cal.setdefault(cal[len("Caliber"):] if cal.startswith("Caliber") else cal, []).append(iid)
    order = [c for c in CAL_ORDER if c in by_cal] + sorted(c for c in by_cal if c not in CAL_ORDER)
    toc, secs = [], []
    for cal in order:
        name = cal_name(cal)
        toc.append(f'<a href="#c-{e(cal)}">{e(name)}</a>')
        rows = []
        for iid in sorted(by_cal[cal], key=lambda i: -(((ctx.items[i].get("properties") or {}).get("penetrationPower")) or 0)):
            it = ctx.items[iid]
            p = it.get("properties") or {}
            info = ctx.item(iid) or {}
            pen = p.get("penetrationPower") or 0
            dmg = p.get("damage") or 0
            pc = p.get("projectileCount") or 1
            dmg_txt = f"{pc}×{dmg}" if pc > 1 else f"{dmg}"
            cls = "p6" if pen >= 60 else "p5" if pen >= 50 else "p4" if pen >= 40 else "p3" if pen >= 30 else "p2" if pen >= 20 else "p1"
            offers = sorted(it.get("buyFromTrader") or [], key=lambda o: (o.get("minTraderLevel") or 9, o.get("priceRUB") or 0))
            buy = ""
            if offers:
                o = offers[0]
                buy = (f'{e(ctx.trader_name(o.get("trader")))} LL{o.get("minTraderLevel") or 1} · {fmt_int(o.get("priceRUB"))}₽'
                       + (' <span class="muted">(퀘스트 해금)</span>' if o.get("taskUnlock") else ""))
            tracer = ' <span class="badge b-any">예광</span>' if p.get("tracer") else ""
            short = info.get("s") or info.get("n")
            icon = f'<img class="icon sm" loading="lazy" alt="" src="{e(info.get("img"))}" />' if info.get("img") else ""
            rows.append(f'<tr><td><span class="itn">{icon}<span><b>{e(short)}</b>{tracer}'
                        f'<div class="muted small">{e(info.get("n"))}</div></span></span></td>'
                        f'<td class="n">{dmg_txt}</td><td class="n pen {cls}">{pen}</td><td class="n">{p.get("armorDamage") or 0}%</td>'
                        f'<td class="n">{fmt_int((p.get("fragmentationChance") or 0) * 100)}%</td><td class="n">{fmt_int(p.get("initialSpeed") or 0)}</td>'
                        f'<td class="small">{buy or "<span class=muted>상인 판매 없음</span>"}</td></tr>')
        secs.append(f'<h2 class="sec" id="c-{e(cal)}">{e(name)} <span class="muted small">{len(rows)}종</span></h2>'
                    '<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th>탄</th><th class="n">데미지</th><th class="n">관통력</th>'
                    '<th class="n">방어구 피해</th><th class="n">파편화</th><th class="n">초속(m/s)</th><th>상인 구매</th></tr></thead><tbody>'
                    + "".join(rows) + "</tbody></table></div>")
    n_ammo = sum(len(v) for v in by_cal.values())
    body = (f'<h1>탄약표 <span class="h1en">Ammo chart</span></h1>'
            f'<p class="sub">구경 {len(order)}종 · 탄 {n_ammo}종 · 관통력 높은 순 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note">관통력 색은 대략적인 기준입니다 — 방어 등급 N 방어구는 내구도가 충분할 때 관통력 약 N×10 이상에서 잘 뚫립니다'
            '(<span class="pen p3">30</span> 3등급 · <span class="pen p4">40</span> 4등급 · <span class="pen p5">50</span> 5등급 · <span class="pen p6">60</span> 6등급). '
            '현재 탄약은 모두 <b>플리마켓 거래가 막혀 있어</b> 상인 구매가와 해금 등급을 함께 적었습니다(가장 낮은 등급 기준).</div>'
            f'<nav class="toc">{"".join(toc)}</nav>' + "".join(secs)
            + '<p class="small muted">게임 안에서는 시세 오버레이로 탄약에 F2를 누르면 같은 구경 탄 비교표가 바로 뜹니다.</p>')
    path = "/guide/ammo/"
    title = "타르코프 탄약표 — 구경별 관통력·데미지·방어구 피해·상인 구매처 | 탈콥 가이드"
    desc = f"타르코프 탄약 {n_ammo}종을 구경별로 관통력 순 정리: 데미지, 관통력, 방어구 피해, 파편화, 초속, 상인 구매 등급·가격. 5.45·5.56·7.62·9x19·12게이지 등. 기준 {ctx.stamp}."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="ammo", crumbs=[("탄약표", None)])


PATCHES = [
    ("1.3.0", "2026-10-29·30", [
        "<b>할로윈 이벤트</b>: 연구소에서 퍼진 감염으로 <b>오염된 공장·오염된 연구소</b> 맵 추가(맵 선택 화면에서 맵별 감염 정도 표시), 감염자(민간인·연구원·PMC·블랙 디비전 요원)와 감염된 타길라 출현(공장·인터체인지에도 가끔), 감염자에게 맞으면 '바이러스' 효과(잠시 청력 상실·수분 감소, 탈출하거나 죽어야 해제), 할로윈 퀘스트 19개, 플레이어 스캐브가 스캐브를 죽여도 카르마 감점 없음, 월드에 사탕 든 호박 배치",
        "날씨 계절이 가을로 전환 · PVE 고레벨 맵에 고난도 PMC 봇 추가 · 화폐·귀중품 일부의 충돌 범위를 키워 줍기 쉽게",
        "은신처 꾸미기 세트 2종(Expansion Hub) · <b>Unity 6 엔진 전환은 11월 중순 1.3.5.0으로 연기</b>",
        "스킬: 대사(Metabolism) 성장이 회복한 에너지·수분량 기준으로 바뀜, 시즌 모드는 전 스킬 성장 속도 대폭 상승, 수확 체감 보정, 무기 스킬 성장 속도를 다른 스킬과 같게 수정",
        "플레이어가 설치한 트립와이어 지속 시간 증가 · 카르마 낮은 플레이어가 없는 레이드의 파르티잔 출현 확률 계산 오류 수정 · <b>PMC 봇은 이제 항상 플레이어를 적대</b>(1.2.0의 '접근 전까지 중립' 동작은 사실상 사라짐) · 일부 조준경 시야각, 고장 뒤 탄창 장전·분리 불가, 상인 상호작용 화면 진입 불가, 쇄빙선·인터체인지·해안선 지형 수정 · 10-30: 특정 지역에서 엎드려 이동·넘기 불가, 컨테이너 수색 중단 문제 수정"]),
    ("1.2.5", "2026-10-16·20", [
        "PVE: PMC 봇이 총소리에 반응하는 거리·엄폐 시간 단축 등 행동 조정",
        "이벤트 퀘스트 라인 완료 업적 추가, 이벤트 보스 Scourge와 경호원 약화(체력·시야·원거리 명중률·발견 속도)",
        "블랙 디비전 순간이동 버그, RShG-2 장전 해제로 막히던 문제 등 수정"]),
    ("1.2.0", "2026-10-06·09", [
        "<b>PVE 프레스티지 6단계</b> — PVE 1단계는 PVP보다 조건 완화, 장비 일부·스킬/숙련 최대 50% 이월 (<a href=\"/guide/prestige/\">프레스티지</a>)",
        "EXFIL Brothers 추천 프로그램(신규 친구와 함께하면 경험치 +5%와 보상)",
        "PVE 봇: USEC·BEAR 봇끼리 협력 확률↑, 일부 봇은 접근 전까지 중립, 봇 수·장비가 레벨과 진영에 맞게 조정",
        "세관: 탈출구 추가, 잠긴 상자 보상 보장, 새 열쇠 <b>ZB-1013 열쇠·경비 초소 열쇠</b> · 인터체인지: 루팅 장소 추가, ULTRA 단독 매장 계산대는 열쇠 불필요",
        "편의: 거래 화면 Ctrl+좌클릭으로 구매/판매 전환, 런스루 탈출 표시, 드럼 탄창 개선, 친구 고정"]),
    ("1.1.5", "2026-09-08·15", [
        "<b>등대 개편</b>: 로그가 산장 지역으로 이동, 정수장 거치 화기·지뢰 제거, BTR 순찰, 산악 지하 통로, 마킹룸 이동",
        "<b>등대지기 해금 체인 '빛을 향해' 전면 개편</b>: 투어로 등대 해금 + 펜스·레프 제외 전 상인 LL3 + 펜스 평판 2.0 + 메카닉에게 문의",
        "쇄빙선: 해안선·등대에서 입장, 루블 대신 '수닥-투닥' 수리 키트(래그맨 'Pay the Fare!' 보상) 필요",
        "퀘스트에 지금 제출 가능한 아이템 표시, 달러·유로 구매가 인하",
        "시즌 캐릭터 전용 리그(주간 경험치 순위, 50명 그룹) — 09-15"]),
    ("1.1.0 KORD BREACH", "2026-08-03", [
        "<b>시즌 시스템</b>: 별도 서버의 시즌 캐릭터(4~6개월마다 초기화), 전역·개인 수정자, 시즌 보상은 모든 모드에 영구 해금, 무료 배틀패스(테라그룹 문서)",
        "<b>사이드 퀘스트 개편</b>: 상인 등급(LL)별 2~4개 묶음으로 해금, 일부만 연쇄. 스캐브 처치 목표에서 보스·레이더·로그 제외, 분대 공유 진행",
        "<b>경제</b>: 상인 판매가 평균 +25%, 상인 매입가 평균 −20%, 플리마켓 수수료 3%→5%",
        "상인 등급: 판매액 조건 삭제, 평판·레벨 조건 재조정 / 일부 탄약·탄창 해금 등급 1단계 하향",
        "은신처: 1~3단계 일부 완화(일부 인레이드 조건 해제·건설 시간 단축), 많은 시설에 돈 요구 추가, 무기 빌드는 작업대 없이도 가능",
        "보험: 예거 보험 추가(가장 빠르고 비쌈), 프라퍼·테라피스트 반환 빨라짐",
        "신규: QBZ-191·Howa Type 20·HK 416A5, <b>5.8x42 구경</b>, 자물쇠 달린 문·상자, 모드 선택 화면, Arena→시즌 진행 동기화",
        "<b>카파 업적 변경</b>: 'The Kappa Path' 업적은 시즌 1부터 더 얻을 수 없고, 수집가(Collector) 완료 시 'Dawn of a New Era' 업적을 받음(기존 획득자는 프로필에 유지)",
        "래그맨 전술 의류는 계정 영구 해금(프로필 초기화·프레스티지·시즌 캐릭터 뒤 다시 살 필요 없음), 기본 의류 가격 인상 · 시즌 모드는 보험 사용 불가"]),
    ("1.0.6", "2026-07-03", ["퀘스트 화면에서 이름·목표·지역·상인으로 검색", "Expansion Hub 준비(유료 상점)"]),
    ("1.0.5", "2026-05-25", ["<b>쇄빙선(Icebreaker)</b>: 1~3인 PvE 탐사 지역 + 스토리 챕터 '보레아스'",
                             "레이드 중 퀘스트 아이템 근처에 가면 방향 표시"]),
]


def patch_page(ctx: Ctx) -> tuple[str, str]:
    secs = "".join(f'<section class="box"><h2>{e(v)} <span class="muted small">{e(d)}</span></h2><ul class="plain">'
                   + "".join(f"<li>{x}</li>" for x in items) + "</ul></section>" for v, d, items in PATCHES)
    body = (f'<h1>패치 요약 <span class="h1en">1.0.5 → {GAME_VERSION}</span></h1>'
            f'<p class="sub">2026년 5월~10월 주요 변경 · 현재 게임 버전 {GAME_VERSION} · 정리 {e(ctx.stamp)}</p>'
            '<div class="note">공식 패치 노트(위키 Changelog 모음)를 읽고 플레이에 영향이 큰 것만 골라 한국어로 요약했습니다. 원문은 '
            '<a href="https://escapefromtarkov.fandom.com/wiki/Changelog" rel="noopener" target="_blank">공식 위키 Changelog</a>에서 볼 수 있습니다.</div>'
            + secs)
    path = "/guide/patch/"
    title = f"타르코프 패치 요약 1.0.5~{GAME_VERSION} — 할로윈 이벤트·시즌·퀘스트 개편·PVE 프레스티지·경제 변경 | 탈콥 가이드"
    desc = f"타르코프 2026년 5~10월 패치 한국어 요약: 1.1.0 KORD BREACH(시즌·사이드 퀘스트 묶음 해금·플리 수수료 5%), 1.1.5 등대 개편·등대지기 체인, 1.2.0 PVE 프레스티지, 1.2.5, {GAME_VERSION} 할로윈 이벤트·오염된 맵·스킬 변경."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="patch", crumbs=[("패치 요약", None)])


# ─────────────────────────────────────────────────────────────
# 프로모 코드 — 손으로 관리. 넣는 기준: 서로 다른 출처 3곳 이상이 최근 2주 안에 '활성'으로 확인했고
# 국내 커뮤니티(디시 타르코프 갤러리)에서도 쓴 보고가 있는 것만. 한 곳이라도 '만료'로 적은 코드는 '제외' 칸에 둔다.
# 갱신할 때 PROMO_CHECKED 날짜를 꼭 바꿀 것(페이지·허브 카드에 그대로 나간다).
# ─────────────────────────────────────────────────────────────
PROMO_CHECKED = "2026-11-02"
# (모드 키, 제목, 설명)
PROMO_MODES = [
    ("unknown", "🎃 신규 — 모드 미확인", "최근 나온 코드인데 어느 모드(PVE·PVP·시즌) 캐릭터가 받는지 출처가 아직 없습니다. 등록은 계정당 한 번이니 주로 쓰는 캐릭터로 접속한 뒤 등록하세요."),
    ("pve", "PVE 존", "PVE 캐릭터로 접속해 메신저에서 받습니다. 1.2.0(10-06) 업데이트 기념으로 해외 매체마다 하나씩 나온 코드라 이름이 매체명입니다."),
    ("season", "PVP 시즌 (KORD BREACH)", "시즌 캐릭터 전용 — 영구 PVP·PVE 캐릭터에는 안 들어옵니다."),
    ("pvp", "PVP 영구 존", "영구 PVP 캐릭터 전용. 대부분 소소한 보급품·루블이고 2025년 말~2026년 초에 나온 뒤 아직 살아 있는 코드입니다."),
]
# (코드, 모드 키, 보상 요약, 비고)
PROMO_CODES = [
    ("POLYGON", "pve", "M60E6 기관총 + 100발 박스 + 7.62x51 M993 200발, ComTac II 헤드셋, TC 800 헬멧, M53A1 방독면, LV-119 플레이트 캐리어, 배낭", "가장 알찬 코드"),
    ("YYSTV", "pve", "HK 416A5 + PMAG + 5.56 M995 120발, LV-119 플레이트 캐리어, Bastion 헬멧, SOTR 마스크, Sordin 헤드셋, 배낭", ""),
    ("PVEPRESTIGE", "pve", "나무 장비 상자 2개 + 탄약 상자 1개", "PVE 프레스티지 추가 기념"),
    ("WIPE", "season", "HK G36 + AKS-74U, RBAV-AF 플레이트 캐리어, DevTac Ronin 헬멧, 탄창 케이스, 탄약·의료품", "시즌 시작(08-03) 기념"),
    ("GAMESPARK", "season", "Desert Tech MDR, Trooper 방탄복, Ronin 헬멧, T20 배낭, TV-104 체스트리그, PMAG 3개, Grizzly·CMS·Salewa 의료품", ""),
    ("PCGAMESN", "season", "Velociraptor .300 BLK + .300 BLK 탄 120발, SLR-106/AK 5.56 30발 탄창 3개, TV-110 플레이트 캐리어, TC 800 헬멧, Walker's Razor 헤드셋, 배낭, Grizzly 의료품, 제작 재료", "SLR-106은 소총이 아니라 탄창(11-02 정정)"),
    ("UNDEADTARKOV", "unknown", "'좀비 잡이 세트' — M3 Super 90 산탄총 + 12게이지 플레셰트, SP PC V2 플레이트 캐리어, ULACH 헬멧, ComTac V, Salewa·CALOK-B·붕대, RGD-5 4개, Klesch-2P 손전등 등(디시 갤러리 보관함 캡처 기준, 공식 목록 없음)",
     "10-30 공개(할로윈 1.3.0 연동). 런처 '등록됨' 캡처와 갤러리 보고 5건으로 확인. 어느 모드에 들어오는지는 어떤 출처에도 없음 — 쓰는 캐릭터로 접속해 메신저 확인"),
    ("ELVISVISTA", "pvp", "Elvisvista 피규어, 은색 트리 장식 2개", "BSG 아트 리드 공개(2025-12-24)"),
    ("PAY2WIN", "pvp", "TOZ-106 산탄총, Blicky 장난감 총, FAST MT 헬멧(모조), GP 코인", "니키타가 올린 장난 코드(2025-12-07)"),
    ("LIGHTSOUT", "pvp", "절전형 전구 6개", ""),
    ("GOONSQUAD", "pvp", "50,000₽, CALOK-B, 원정용 연료통, 설탕, 볼트 2, KEKTAPE 2", "개발자 방송 공개"),
    ("SCAVYBOI", "pvp", "50,000₽, CALOK-B, 원정용 연료통, 위스키, 알룐카 초콜릿, 볼트 2, 너트 2, 전원 코드", ""),
    ("SBEUKOMAR", "pvp", "50,000₽, CALOK-B, 원정용 연료통, 주름 호스 2, 연유, Slickers 초코바, Iskra 전투식량", ""),
]
# 최근 끝났거나 넣지 않은 것 — 검색해서 들어온 사람이 헛수고하지 않게 이유와 함께 적는다
PROMO_GONE = [
    ("INVEN", "PVE", "M1A 소총 세트. 인벤 독자용으로 <b>업데이트 뒤 2주 한정</b>이라고 인벤 기사(10-07)에 명시 → 10-20 전후 만료. 20일까지 됐다는 댓글이 마지막 보고."),
    ("AUTOMATON", "PVE", "SIG MCX .300 BLK 세트. 일본 매체 배포 코드로 <b>교환 2주 한정</b>(10-06 시작 → 10-20 전후)이라고 안내됨(11-02 확인). 해외 정리 사이트 상당수는 아직 '활성'으로 두고 있어 런처에서 넣어 봐도 손해는 없음."),
    ("WIPE · GAMESPARK · PCGAMESN · ELVISVISTA · PAY2WIN · SCAVYBOI 참고", "—", "위 표에 그대로 두었지만, 정리 사이트 두 곳(10-03·10-30)이 '만료됐을 수 있음' 묶음에 넣고 있습니다. 같은 시기 갱신된 다른 사이트들은 전부 활성이라 유지 — 안 들어오면 만료된 것."),
    ("12주년 선물", "전 모드", "코드가 아니라 <a href=\"https://profile.tarkov.com/profile/gifts\" rel=\"noopener\" target=\"_blank\">프로필 선물함</a>에서 받는 식료품 꾸러미. 공식 트윗 기준 <b>10-19 20:00(한국)</b>에 끝남."),
    ("JUST150TARCOINS", "확장 허브", "TarCoin 150개. 선착순 4만 명 한정이라 소진됨(8월 공개)."),
    ("PROMOCODE · BACKTORAID · SUDAKTUDAK · LETMEIN", "—", "정리 사이트마다 활성/만료가 갈려서 뺐습니다. 런처에서 직접 넣어 보는 건 손해 볼 게 없습니다."),
]


def promo_page(ctx: Ctx) -> tuple[str, str]:
    by_mode: dict[str, list] = {}
    for code, mode, reward, note in PROMO_CODES:
        by_mode.setdefault(mode, []).append((code, reward, note))
    secs = []
    for key, title, desc in PROMO_MODES:
        rows = "".join(
            f'<tr><td class="n"><code class="promo">{e(code)}</code> <button type="button" class="cp" data-c="{e(code)}" aria-label="{e(code)} 복사">복사</button></td>'
            f'<td>{e(reward)}</td><td class="small muted">{e(note) or "—"}</td></tr>'
            for code, reward, note in by_mode.get(key, []))
        secs.append(f'<h2 class="sec" id="{key}">{e(title)} <span class="muted small">{len(by_mode.get(key, []))}개</span></h2>'
                    f'<p class="small muted">{desc}</p>'
                    '<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th class="n">코드</th><th>보상</th><th>비고</th></tr></thead>'
                    f'<tbody>{rows}</tbody></table></div>')
    gone = "".join(f'<tr><td class="n"><code class="promo off">{e(c)}</code></td><td class="small">{e(m)}</td><td class="small">{why}</td></tr>' for c, m, why in PROMO_GONE)
    body = (f'<h1>프로모 코드 <span class="h1en">Promo codes</span></h1>'
            f'<p class="sub">지금 쓸 수 있는 공식 코드 {len(PROMO_CODES)}개 · 마지막 확인 {PROMO_CHECKED}</p>'
            '<div class="note key"><b>넣는 기준</b> — 서로 다른 정리 사이트 3곳 이상이 최근 2주 안에 "활성"으로 확인했고, 디시 타르코프 갤러리에서도 쓴 보고가 있는 코드만 올립니다. '
            '한 곳이라도 만료로 적은 코드는 아래 "제외" 표로 내립니다. BSG는 만료일을 공지하지 않고 하루 만에 닫는 코드도 있어서, <b>보이면 바로 넣는 게 답</b>입니다. '
            '코드는 <b>모드별</b>로 들어오니 PVE 코드를 넣고 PVP 캐릭터로 접속하면 메신저에 아무것도 없습니다.</div>'
            '<nav class="toc"><a href="#how">등록 방법</a>' + "".join(f'<a href="#{k}">{e(t)}</a>' for k, t, _ in PROMO_MODES) + '<a href="#gone">끝난·제외</a></nav>'
            '<section class="box" id="how"><h2>등록 방법</h2><ol>'
            '<li><b>런처</b>: 오른쪽 위 계정 이름 → <b>Activate code(코드 활성화)</b> → 코드 입력 → Enter. 대소문자를 구분합니다.</li>'
            '<li><b>웹</b>: <a href="https://www.escapefromtarkov.com/promo/activate" rel="noopener" target="_blank">escapefromtarkov.com/promo/activate</a>에 로그인해 입력해도 같습니다.</li>'
            '<li>게임에 <b>해당 모드 캐릭터</b>로 접속 → 오른쪽 아래 <b>메신저</b> → 보낸 사람 탭에서 수령. 보관함이 꽉 차면 안 들어오니 자리를 비워 두세요.</li>'
            '<li>여러 개를 연달아 넣으면 잠깐 쿨다운이 걸립니다. 점검 중엔 등록이 안 되니 서버가 열린 뒤에 넣으세요.</li>'
            '<li>"이미 사용됨"은 계정당 1회라서, "유효하지 않음"은 만료라서 뜹니다. 두 번째가 뜨면 아래 표에서 내려야 하니 알려 주세요(시세 오버레이 앱 ⚙ → 피드백, 또는 디시 타르코프 갤러리).</li>'
            '</ol></section>'
            + "".join(secs)
            + f'<h2 class="sec" id="gone">최근 끝났거나 넣지 않은 것</h2>'
            '<div class="box tbl" style="padding:4px 8px"><table class="tot"><thead><tr><th class="n">코드</th><th>모드</th><th>이유</th></tr></thead>'
            f'<tbody>{gone}</tbody></table></div>'
            '<p class="small muted">확인 출처(2026-10-26): Dexerto(10-20 갱신)·PCGamesN(10-24)·Guided.news(10-14)·Timesaver(10-15)·games.gg(10-07)·tarkov.help, 디시 타르코프 갤러리 10-09·10-15 글, 인벤 기사(10-07), Battlestate Games 공식 X(10-15). '
            '보상 구성은 사이트마다 조금씩 달라 공통되는 것만 적었습니다. 직접 받아 보고 다르면 알려 주세요.</p>')
    extra_head = ('<style>code.promo{font-family:Consolas,"D2Coding",monospace;font-size:14px;font-weight:700;color:var(--gold);background:var(--panel2);'
                  'border:1px solid var(--line);border-radius:6px;padding:2px 7px;letter-spacing:.3px;user-select:all}code.promo.off{color:var(--muted);text-decoration:line-through;font-weight:600}'
                  'button.cp{margin-left:4px;font-size:11.5px;padding:2px 7px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer}'
                  'button.cp:hover{border-color:var(--gold)}button.cp.ok{border-color:var(--gold);color:var(--gold)}</style>')
    scripts = ('<script>document.addEventListener("click",function(ev){var b=ev.target.closest("button.cp");if(!b)return;'
               'var c=b.getAttribute("data-c");(navigator.clipboard?navigator.clipboard.writeText(c):Promise.reject()).then(function(){b.textContent="복사됨";b.classList.add("ok");'
               'setTimeout(function(){b.textContent="복사";b.classList.remove("ok")},1500)},function(){var r=document.createRange();r.selectNodeContents(b.previousElementSibling);'
               'var s=getSelection();s.removeAllRanges();s.addRange(r)})});</script>')
    path = "/guide/promo/"
    title = f"타르코프 프로모 코드 {PROMO_CHECKED} — 지금 쓸 수 있는 공식 코드 {len(PROMO_CODES)}개 (PVE·시즌·PVP) | 탈콥 가이드"
    desc = f"타르코프(Escape from Tarkov) 프로모 코드 {PROMO_CHECKED} 확인판: PVE 존 POLYGON·AUTOMATON·YYSTV·PVEPRESTIGE, KORD BREACH 시즌 WIPE·GAMESPARK·PCGAMESN, PVP 영구 존 6개. 보상·모드·런처 등록 방법·만료된 코드."
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="promo", crumbs=[("프로모 코드", None)],
                      extra_head=extra_head, scripts=scripts)


# ─────────────────────────────────────────────────────────────
# 건스미스 — 메카닉 무기 조립 퀘스트 전부(기본 '건스미스 - 무기명' + '건스미스 마스터 - 파트 N').
# 데이터의 buildWeapon 목표: item(무기) · containsAll(반드시 포함할 부품) · buildAttributes(성능 조건).
# 부품은 즐겨찾기(플리마켓 ★)용 체크리스트로도 한 번 더 묶는다.
# ─────────────────────────────────────────────────────────────
GUNSMITH_JS = """<script>
(function(){var KEY="guide.gunsmith.have";function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}
function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var have=L(KEY,{}),scope="all",rows=[].slice.call(document.querySelectorAll("#gtbl tbody tr")),chips=[].slice.call(document.querySelectorAll("[data-part]"));
function render(){var q=document.getElementById("q").value.trim().toLowerCase(),hh=document.getElementById("hideHave").checked,shown=0,hv=0;
rows.forEach(function(r){var d=r.dataset,h=!!have[d.id];if(h)hv++;var ok=true;if(hh&&h)ok=false;if(q&&d.s.indexOf(q)<0)ok=false;
if(scope==="req"&&d.req!=="1")ok=false;if(scope==="ex"&&!r.children[3].textContent.trim())ok=false;
r.style.display=ok?"":"none";r.classList.toggle("done",h);var c=r.querySelector("input");if(c)c.checked=h;if(ok)shown++;});
chips.forEach(function(c){c.classList.toggle("done",!!have[c.getAttribute("data-part")])});
document.getElementById("shown").textContent=shown;document.getElementById("havecnt").textContent=hv;}
document.getElementById("hideHave").addEventListener("change",render);document.getElementById("q").addEventListener("input",render);
document.getElementById("scope").addEventListener("click",function(e){var v=e.target.getAttribute("data-v");if(!v)return;scope=v;document.querySelectorAll("#scope button").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-v")===v)});render()});
document.getElementById("gtbl").addEventListener("change",function(e){var r=e.target.closest("tr");if(!r)return;if(e.target.checked)have[r.dataset.id]=1;else delete have[r.dataset.id];S(KEY,have);render()});
document.getElementById("clearHave").addEventListener("click",function(){if(!confirm("보유 체크를 모두 지울까요?"))return;have={};S(KEY,have);render()});
render();})();
</script>"""


GUNSMITH_BUILDS = Path(__file__).resolve().parent / "guide_data" / "gunsmith_builds.json"  # scripts/gunsmith_wiki.py 가 만든다
TRADER_KO = {"Prapor": "프라퍼", "Therapist": "테라피스트", "Skier": "스키어", "Peacekeeper": "피스키퍼", "Mechanic": "메카닉",
             "Ragman": "래그맨", "Jaeger": "예거", "Fence": "펜스", "Ref": "레프", "Lightkeeper": "등대지기", "Flea Market": "플리마켓"}


def _wiki_item_index(ctx: Ctx):
    """위키 영문 부품명 → 아이템 id. 정확히 같으면 그걸, 아니면 '이름 (색상)'처럼 변형이 하나뿐일 때 그것."""
    def norm(s):
        return re.sub(r"[^a-z0-9]+", "", (s or "").lower().replace("“", '"').replace("”", '"'))
    exact: dict[str, str] = {}
    prefix: dict[str, list] = {}
    for iid, it in ctx.items.items():
        n = ctx._loc(ctx.loc_items_en, it.get("name"), None)
        if not isinstance(n, str):
            continue
        exact.setdefault(norm(n), iid)
        m = re.match(r"(.+?)\s*\([^()]*\)\s*$", n)
        if m:
            prefix.setdefault(norm(m.group(1)), []).append(iid)

    def find(name, page=None):
        for k in (norm(page), norm(name)):
            if k and k in exact:
                return exact[k]
        for k in (norm(page), norm(name)):
            if k and len(prefix.get(k) or []) >= 1:
                return prefix[k][0]
        return None
    return find


def gunsmith_page(ctx: Ctx) -> tuple[str, str, str] | None:
    # 건스미스 퀘스트 = buildWeapon 목표가 있고 영문 이름이 Gunsmith로 시작
    gs = [tid for tid, t in ctx.tasks.items()
          if ctx.task_names(tid)[1].startswith("Gunsmith") and any(o.get("type") == "buildWeapon" for o in t.get("objectives") or [])]
    if not gs:
        return None
    try:
        builds = json.loads(GUNSMITH_BUILDS.read_text(encoding="utf-8")) if GUNSMITH_BUILDS.exists() else {}
    except Exception:  # noqa: BLE001
        builds = {}
    find_item = _wiki_item_index(ctx)
    ex_parts: dict[str, dict] = {}  # 예시 조립 부품: key(id 또는 w:이름) → {"n","id","q":[tid...]}

    def build_html(tid, k, n_objs, wid=None):
        """퀘스트 tid 의 k번째 무기에 해당하는 위키 예시 조립 표"""
        b = builds.get(ctx.task_names(tid)[1])
        if not b or not b.get("lists"):
            return ""
        lists = b["lists"]
        pick = [lists[k]] if len(lists) == n_objs and n_objs > 1 else (lists if k == 0 else [])
        if not pick:
            return ""
        out = []
        for lst in pick:
            trs = []
            for r in lst["rows"]:
                iid = find_item(r.get("name"), r.get("page"))
                key = iid or ("w:" + r["name"])
                ent = ex_parts.setdefault(key, {"n": r["name"], "id": iid, "q": []})
                ent["q"].append(tid)
                ex_w.setdefault(key, []).append(lst.get("weapon") or (ctx.item(wid) or {}).get("s") or "")
                sellers = " / ".join(f'{TRADER_KO.get(s, s)} {l}' for s, l in zip(r.get("sellers") or [], r.get("ll") or []))
                if not sellers:
                    sellers = ", ".join(TRADER_KO.get(s, s) for s in r.get("sellers") or []) or "—"
                sellers = sellers.replace("(Barter)", "(교환)")
                cell = f'<span data-part="{e(key)}">{ctx.chip(iid)}</span>' if iid else f'<span data-part="{e(key)}"><span class="chip">{e(r["name"])}</span></span>'
                trs.append(f'<tr><td>{cell}</td><td class="small muted">{e(sellers)}</td></tr>')
            cap = f'{e(lst["weapon"])} ' if lst.get("weapon") else ""
            out.append(f'<table class="tot wb"><thead><tr><th>{cap}예시 조립 부품 {len(trs)}개</th><th>파는 곳 · 등급</th></tr></thead><tbody>{"".join(trs)}</tbody></table>')
        note = b.get("note") or ""
        note = re.sub(r"^Th(?:is|ese) builds? (?:is|are) based on ", "기본 무기: ", note).replace("a standard ", "").replace(" from ", " ← ").replace(" and ", ", ").rstrip(".")
        for en_, ko_ in TRADER_KO.items():
            note = note.replace(en_, ko_)
        return (f'<details class="wb"><summary>위키 예시 조립 보기 <span class="muted small">(여러 방법 중 하나 · '
                f'<a href="{e(b["url"])}" rel="noopener" target="_blank">출처</a>)</span></summary>'
                + (f'<p class="small muted">{e(note)}</p>' if note else "") + "".join(out) + "</details>")

    def num(tid):
        m = re.search(r"Part (\d+)", ctx.task_names(tid)[1])
        return int(m.group(1)) if m else 0

    # 기본 건스미스는 서로 선행 관계가 없고(1.1.0 묶음 방식) 메카닉 묶음 카운터 4갈래에 흩어져 있어 깊이로는 전부 0 →
    # 실제 받는 순서 = ①바로(대화만) ②묶음 1개 완료 뒤 ③3개 ④5개 ⑤LL3·레벨 26, 같은 단계 안에선 옛 '파트 N' 번호(공식 위키 아이콘)로.
    def gs_tier(tid):
        t = ctx.tasks[tid]
        b = ctx.batch_req(t)
        if b:
            return b
        return 6 + ctx.trader_ll(t) if ctx.trader_ll(t) > 1 or (t.get("minPlayerLevel") or 0) > 1 else 0

    def gs_legacy(tid):
        en = ctx.task_names(tid)[1]
        return GUNSMITH_LEGACY.get(en.split(" - ", 1)[-1].strip(), 99)

    base = sorted([t for t in gs if "Master" not in ctx.task_names(t)[1]], key=lambda t: (gs_tier(t), gs_legacy(t), ctx.task_names(t)[1]))
    master = sorted([t for t in gs if "Master" in ctx.task_names(t)[1]], key=lambda t: (num(t), ctx.task_names(t)[1]))

    parts: dict[str, list[str]] = {}  # 부품 → 쓰는 퀘스트들(중복 포함: 같은 부품을 두 퀘스트가 요구하면 2개 필요)
    parts_w: dict[str, list[str]] = {}  # 부품 → 그 퀘스트에서 조립하는 무기 id(오버레이용 JSON에 무기 이름을 넣으려고)
    ex_w: dict[str, list[str]] = {}  # 예시 조립 부품 key → 무기 라벨

    def build_rows(tids):
        rows = []
        for tid in tids:
            t = ctx.tasks[tid]
            objs = [o for o in t.get("objectives") or [] if o.get("type") == "buildWeapon"]
            for k, o in enumerate(objs):
                it = o.get("item")
                wid = it.get("id") if isinstance(it, dict) else it
                need = _flat(o.get("containsAll"))
                for pid in need:
                    parts.setdefault(pid, []).append(tid)
                    parts_w.setdefault(pid, []).append(wid)
                conds = []
                # 종류 조건(containsCategory): "소음기 아무거나 하나" 식 — 특정 부품은 아니지만 꼭 달아야 한다
                kinds = []
                for c in o.get("containsCategory") or []:
                    cid = c.get("id") if isinstance(c, dict) else c
                    nm = ctx._loc(ctx.loc_items, f"{cid} Name", None) or ctx._loc(ctx.loc_items_en, f"{cid} Name", None) \
                        or (c.get("name") if isinstance(c, dict) else None) or cid
                    kinds.append(nm)
                if kinds:
                    conds.append("필수 종류: " + " · ".join(kinds))
                for key, v in (o.get("buildAttributes") or {}).items():
                    if isinstance(v, dict) and (v.get("value") or 0) > 0:
                        conds.append(f'{BUILD_ATTR.get(key, key)} {_cmp(v.get("compareMethod"))} {fmt_int(v["value"])}')
                chips = "".join(f'<span data-part="{e(pid)}">{ctx.chip(pid)}</span>' for pid in need) or '<span class="muted small">없음 — 성능 조건만</span>'
                lv = t.get("minPlayerLevel") or 0
                b = ctx.batch_req(t)
                when = (f"메카닉 묶음 {b}개 완료 뒤" if b else
                        (f"메카닉 LL{ctx.trader_ll(t)}" if ctx.trader_ll(t) > 1 else ("" if "Master" in ctx.task_names(tid)[1] else "바로 받음")))
                sub = " · ".join(x for x in (f"레벨 {lv}" if lv else "", when) if x)
                first = (f'<td class="q" rowspan="{len(objs)}">{ctx.task_link(tid)}'
                         + (f'<div class="small muted">{e(sub)}</div>' if sub else "") + "</td>") if k == 0 else ""
                rows.append(f'<tr>{first}<td class="w"><div class="chips">{ctx.chip(wid)}</div></td>'
                            f'<td class="p"><div class="chips">{chips}</div>{build_html(tid, k, len(objs), wid)}</td><td class="small c">{e(" · ".join(conds)) or "—"}</td></tr>')
        return rows

    base_rows = build_rows(base)
    master_rows = build_rows(master)

    def table(rows, hid, title, note):
        return (f'<h2 class="sec" id="{hid}">{e(title)} <span class="muted small">{len(rows)}개</span></h2><p class="small muted">{note}</p>'
                '<div class="box tbl" style="padding:4px 8px"><table class="tot gs"><thead><tr><th>퀘스트</th><th>무기</th><th>반드시 포함할 부품</th><th>성능 조건</th></tr></thead>'
                f'<tbody>{"".join(rows)}</tbody></table></div>')

    # 전체 부품 체크리스트 — 필수 부품 + 위키 예시 조립 부품을 한 표에. 필수 횟수 많은 것부터, 그다음 예시 횟수, 이름순
    allkeys = set(parts) | set(ex_parts)

    def nm(k):
        it = ctx.item(k) if not k.startswith("w:") else None
        return (it or {}).get("n") or ex_parts.get(k, {}).get("n") or k

    order = sorted(allkeys, key=lambda k: (-len(parts.get(k, [])), -len(ex_parts.get(k, {}).get("q", [])), nm(k)))
    trs = []
    for key in order:
        it = ctx.item(key) if not key.startswith("w:") else None
        req = parts.get(key, [])
        exq = ex_parts.get(key, {}).get("q", [])
        qlinks = ", ".join(ctx.task_link(t) for t in dict.fromkeys(req + exq))
        if it:
            s = (it["n"] + " " + (it.get("en") or "") + " " + (it.get("s") or "")).lower()
            price = it.get("pvp")
            pcell = (fmt_int(price) + "₽") if price else ("상인" if it.get("noflea") else "—")
            chip = ctx.chip(key)
        else:
            s = nm(key).lower()
            pcell = "—"
            chip = f'<span class="chip">{e(nm(key))}</span>'
        trs.append(f'<tr data-id="{e(key)}" data-s="{e(s)}" data-req="{1 if req else 0}"><td class="n"><input type="checkbox" aria-label="보유" /></td>'
                   f'<td>{chip}</td><td class="n">{len(req) or ""}</td><td class="n">{len(exq) or ""}</td><td class="small">{qlinks}</td>'
                   f'<td class="n small">{pcell}</td></tr>')

    body = (f'<h1>건스미스 부품 총정리 <span class="h1en">Gunsmith</span></h1>'
            f'<p class="sub">메카닉 무기 조립 퀘스트 {len(gs)}개 · 반드시 포함할 부품 {len(parts)}종 · 데이터 기준 {e(ctx.stamp)}</p>'
            '<div class="note key"><b>쓰는 법</b> — 아래 "전체 부품 체크리스트"의 이름을 플리마켓 검색창에 넣고 ★(즐겨찾기)를 눌러 두면 시세 볼 때 한 번에 모입니다. '
            '표의 "반드시 포함할 부품"은 조립에 꼭 들어가야 하는 것이고, 그 외 인체공학·반동·무게 같은 <b>성능 조건</b>은 어떤 부품으로든 맞추면 됩니다. '
            '각 줄의 <b>"위키 예시 조립 보기"</b>를 펼치면 공식 위키가 올린 조립 예시(부품·파는 상인·등급)가 나오고, 그 부품들도 체크리스트에 "예시" 열로 들어가 있습니다. '
            '조립한 무기를 통째로 제출하므로 같은 부품을 두 퀘스트가 요구하면 두 개가 필요합니다(횟수 열). 보유 체크는 이 브라우저에만 저장됩니다.</div>'
            '<nav class="toc"><a href="#base">건스미스</a><a href="#master">건스미스 마스터</a><a href="#parts">전체 부품 체크리스트</a></nav>'
            + table(base_rows, "base", "건스미스", "메카닉 기본 조립 퀘스트. 선행 순서대로 정렬했고, 퀘스트 이름을 누르면 상세(보상·선행·해금)로 갑니다.")
            + table(master_rows, "master", "건스미스 마스터", "40레벨 이후 이어지는 상위 조립 퀘스트. 한 퀘스트에 무기가 여러 정이면 줄이 나뉩니다.")
            + f'<h2 class="sec" id="parts">전체 부품 체크리스트 <span class="muted small">{len(trs)}종</span></h2>'
            '<div class="box"><div class="bar"><input id="q" type="search" placeholder="부품 이름 검색 (한글·영문)" />'
            '<span class="seg" id="scope"><button type="button" data-v="all" class="on">전체</button><button type="button" data-v="req">필수만</button><button type="button" data-v="ex">예시 조립만</button></span>'
            '<label class="small"><input type="checkbox" id="hideHave" /> 보유 숨기기</label>'
            '<span class="small muted">표시 <b id="shown">0</b> · 보유 <b id="havecnt">0</b></span>'
            '<button type="button" id="clearHave" class="small">체크 초기화</button></div>'
            '<div class="tbl"><table class="tot" id="gtbl"><thead><tr><th class="n">보유</th><th>부품</th><th class="n">필수</th><th class="n">예시</th><th>쓰는 퀘스트</th><th class="n">시세(PVP)</th></tr></thead>'
            f'<tbody>{"".join(trs)}</tbody></table></div></div>'
            '<p class="small muted">"필수"는 데이터상 반드시 포함해야 하는 횟수, "예시"는 위키 예시 조립에 쓰인 횟수입니다. 출처: tarkov.dev 퀘스트 데이터(buildWeapon 목표), '
            '예시 조립은 <a href="https://escapefromtarkov.fandom.com/wiki/Mechanic" rel="noopener" target="_blank">공식 위키</a>(CC BY-NC-SA, 각 퀘스트 줄에 문서 링크). '
            '시세는 24시간 평균이며 "상인"은 플리마켓 거래 불가 품목입니다.</p>')
    extra_head = ('<style>table.gs td{vertical-align:top}table.gs .chips{margin-top:0}'
                  'details.wb{margin-top:6px}details.wb summary{cursor:pointer;font-size:12.5px;color:var(--gold)}details.wb table.wb{margin-top:6px;font-size:12.5px}details.wb table.wb td,details.wb table.wb th{padding:4px 6px}'
                  '.seg button{padding:3px 9px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;font-size:12.5px}.seg button.on{border-color:var(--gold);color:var(--gold)}'
                  '[data-part].done .chip{opacity:.45;text-decoration:line-through}'
                  '#gtbl tr.done td{opacity:.5}#gtbl tr.done td.n:first-child{opacity:1}'
                  '.bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-bottom:8px}.bar input[type=search]{flex:1;min-width:180px;padding:6px 9px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text)}'
                  '.bar button{padding:4px 9px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer}</style>')
    # 오버레이(사이드카 gunsmith.py)가 받아 가는 압축 JSON — 아이템 id → [{q: 영문 퀘스트, k: 한국어 퀘스트, t: req|ex, w: 무기}]
    feed: dict[str, list[dict]] = {}
    for pid, tids in parts.items():
        for tid, wid in zip(tids, parts_w.get(pid, [])):
            ko, en = ctx.task_names(tid)
            w = (ctx.item(wid) or {}).get("s") or (ctx.item(wid) or {}).get("n") or ""
            feed.setdefault(pid, []).append({"q": en, "k": ko, "t": "req", "w": w})
    for key, ent in ex_parts.items():
        if not ent.get("id"):
            continue
        for tid, w in zip(ent["q"], ex_w.get(key, [])):
            ko, en = ctx.task_names(tid)
            feed.setdefault(ent["id"], []).append({"q": en, "k": ko, "t": "ex", "w": w})
    feed_json = json.dumps({"updated": ctx.stamp, "items": feed}, ensure_ascii=False, separators=(",", ":"))

    path = "/guide/gunsmith/"
    title = f"타르코프 건스미스 부품 총정리 — 퀘스트 {len(gs)}개 필수 부품 {len(parts)}종·성능 조건·즐겨찾기 체크리스트 | 탈콥 가이드"
    desc = (f"타르코프 건스미스(메카닉 무기 조립) 퀘스트 {len(gs)}개 전부: 무기별 반드시 포함할 부품 {len(parts)}종, 인체공학·반동·무게 조건, "
            "플리마켓 즐겨찾기용 전체 부품 체크리스트. 건스미스 마스터 포함.")
    return path, page(ctx, path=path, title=title, desc=desc, body=body, nav="gunsmith", crumbs=[("건스미스", None)],
                      extra_head=extra_head, scripts=GUNSMITH_JS), feed_json


# ─────────────────────────────────────────────────────────────
# 오버레이 연동 — 같은 PC에서 시세 오버레이가 켜져 있으면 사이드카(127.0.0.1:8765)의 /progress 를 읽어
# 게임 로그로 확인된 완료 퀘스트를 이 브라우저의 체크 저장소(guide.quests)에 합치고, 은신처 단계도 받아 둔다.
# 오버레이가 꺼져 있으면 조용히 아무것도 안 한다. 사용자 데이터는 이 브라우저 밖으로 나가지 않는다.
# 사이드카 쪽은 /progress 한 경로에만 이 사이트 출처를 허용한다(main.py _ProgressCORS).
# ─────────────────────────────────────────────────────────────
SYNC_JS = r"""(function(){
// 상단 그룹 메뉴: 마우스가 없는(터치) 환경이나 좁은 화면에선 그룹 제목을 누르면 펼치고, 다시 누르면 이동. 바깥 클릭이면 닫힘
var noHover=window.matchMedia&&window.matchMedia("(hover: none)").matches;
document.addEventListener("click",function(ev){var gt=ev.target.closest(".top nav .gt");var open=document.querySelectorAll(".top nav .g.open");
if(!gt){open.forEach(function(g){g.classList.remove("open")});return}
var g=gt.parentNode,narrow=window.innerWidth<900;if(!(noHover||narrow))return;
if(!g.classList.contains("open")){ev.preventDefault();open.forEach(function(x){x.classList.remove("open")});g.classList.add("open")}});
})();
(function(){
var MK="guide.mode",KEY="guide.quests",SK="guide.sync",SYNCED="guide.quests.synced",SE="guide.sync.err";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function gmode(){return L(MK,"pvp")==="pve"?"pve":"regular"}
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top)return;var old=document.querySelector(".sync");if(old)old.remove();var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href=stale?"#":"/guide/quests/";
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0,agoTxt=ago<1?"방금":ago<60?ago+"분 전":Math.round(ago/60)+"시간 전";
var base="🔗 오버레이 연동 · 완료 "+n+"개"+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (시즌)":" (PVP)");
a.textContent=stale?(base+" · "+agoTxt+" 기준 ↻"):base;
var err=L(SE,null);
a.title=stale?("마지막으로 받은 진행도("+agoTxt+")를 쓰고 있어요. 지금은 오버레이를 직접 읽지 못했어요"+(err&&err.msg?" — "+err.msg:"")+". 눌러서 다시 읽기. 크롬이 '로컬 네트워크 접근'을 차단해 두었다면 주소창 자물쇠 → 사이트 설정 → 로컬 네트워크 접근 → 허용"):"시세 오버레이가 게임 로그로 확인한 완료 퀘스트를 자동 반영 중";
if(stale)a.addEventListener("click",function(ev){ev.preventDefault();if(a.dataset.busy)return;a.dataset.busy="1";a.textContent="연동 다시 시도 중…";pull(true).then(function(ok){delete a.dataset.busy;if(ok)return;chip(sy,true);help()})});
top.appendChild(a)}
// 오버레이가 알려 준 서버(PVE/PVP)로 사이트 모드를 맞춘다 — 안 맞추면 다음 페이지의 자동 읽기가 다른 서버 진행도를 가져와 "완료 n개"가 바뀐다
function apply(p){if(p.mode==="pve"||p.mode==="regular"||p.mode==="pvp"||p.mode==="season"){var nm=p.mode==="pve"?"pve":"pvp";if(L(MK,"pvp")!==nm)S(MK,nm)}
var done=L(KEY,{}),syn=L(SYNCED,{}),changed=0;(p.completed||[]).forEach(function(id){if(!done[id]){done[id]=1;changed++}syn[id]=1});if(changed)S(KEY,done);S(SYNCED,syn);
var sy={ts:Date.now(),mode:p.mode,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0};S(SK,sy);window.__guideSync=sy;chip(sy,false);
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) 오버레이의 "가이드 열기" 버튼이 주소 해시(#sync=base64 JSON)로 넘긴 진행도 — 브라우저의 로컬 네트워크 정책과 무관하게 동작
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0);history.replaceState(null,"",location.pathname+location.search)}}catch(e){}}
// 2) 같은 PC의 사이드카에서 직접 읽기 — https 페이지에서 127.0.0.1 로 가려면 크롬은 targetAddressSpace:"loopback" 이 필요하고,
//    처음 한 번 "로컬 네트워크 접근 허용" 창이 뜬다. 거부·미지원이면 조용히 마지막 연동 값만 보여 준다.
//    앱을 안 쓰는 방문자에게 권한 창을 띄우지 않도록, 자동 시도는 한 번이라도 연동된 브라우저에서만 하고,
//    처음인 브라우저에는 상단에 "오버레이 연동" 버튼을 두어 사용자가 눌렀을 때(사용자 동작) 시도한다.
function pull(manual){var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},manual?25000:12000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
return fetch("http://127.0.0.1:8765/progress?game_mode="+gmode(),opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok){try{localStorage.removeItem(SE)}catch(x){}apply(p);return true}throw new Error("응답 형식 오류")})
.catch(function(e){clearTimeout(tm);S(SE,{ts:Date.now(),msg:(e&&e.name==="AbortError")?"응답 없음(시간 초과)":String(e&&e.message||e)});if(manual)return false;if(window.__guideSync)return false;var old=L(SK,null);if(old&&old.ts){window.__guideSync=old;chip(old,true);document.dispatchEvent(new CustomEvent("guide-sync",{detail:old}))}return false})}
if(window.__guideSync||L(SK,null)){pull(false);return}
var top=document.querySelector(".top .wrap");if(!top)return;
var b=document.createElement("button");b.type="button";b.className="sync btn";b.textContent="🔗 오버레이 연동";
b.title="같은 PC에서 켜 둔 시세 오버레이의 퀘스트 진행도·은신처 단계를 이 브라우저에 가져옵니다. 데이터는 브라우저 밖으로 나가지 않아요.";
b.addEventListener("click",function(){if(b.disabled)return;b.disabled=true;b.textContent="연동 중…";
pull(true).then(function(ok){if(ok){b.remove();return}b.disabled=false;b.textContent="🔗 오버레이 연동";help()})});
top.appendChild(b);
function help(){var old=document.querySelector(".synchelp");if(old)old.remove();var h=document.createElement("div");h.className="synchelp";
h.innerHTML='<b>오버레이를 찾지 못했어요.</b> 같은 PC에서 <a href="/">시세 오버레이</a>(연동 기능이 들어간 최신 버전)를 켜 두고 다시 눌러 주세요. 크롬이 "로컬 네트워크 접근"을 차단해 두었다면 <b>주소창 자물쇠 → 사이트 설정 → 로컬 네트워크 접근 → 허용</b>으로 바꾼 뒤 새로고침하세요. 그래도 안 되면 오버레이 <b>설정 → 사이트 연동하기</b> 버튼으로 이 사이트를 열면 진행도가 같이 넘어옵니다. <button type="button" class="x" aria-label="닫기">✕</button>';
h.querySelector(".x").addEventListener("click",function(){h.remove()});document.querySelector(".top").insertAdjacentElement("afterend",h)}
})();"""


def build_all(ctx: Ctx, out: Path, collector_ids: set, extra_counts: dict) -> list[str]:
    urls: list[str] = []
    (out / "sync.js").write_text(SYNC_JS, encoding="utf-8")
    # 퀘스트 상세
    for tid in ctx.tasks:
        p, h = quest_page(ctx, tid)
        write(out, p, h, urls)
    # 상인별
    by_tr: dict[str, list] = {}
    for tid, t in ctx.tasks.items():
        by_tr.setdefault(t.get("trader"), []).append(tid)
    for tr_id, tids in by_tr.items():
        if tr_id in ctx.traders:
            p, h = trader_page(ctx, tr_id, tids)
            write(out, p, h, urls)
    p, h = items_page(ctx, collector_ids)
    write(out, p, h, urls)
    items_n = h.count('<tr data-id="')
    p, h = rewards_page(ctx)
    write(out, p, h, urls)
    p, h = hunt_page(ctx)
    write(out, p, h, urls)
    p, h = favorites_page(ctx)
    write(out, p, h, urls)
    rewards_n = h.count('<details class="rw"')
    p, h = quest_items_page(ctx)
    write(out, p, h, urls)
    qitems_n = h.count('class="card static"')
    unlock_map = craft_unlocks(ctx)
    for sid in ctx.hideout_reg:
        p, h = station_page(ctx, sid, unlock_map)
        write(out, p, h, urls)
    p, h = hideout_index(ctx)
    write(out, p, h, urls)
    p, h = start_page(ctx)
    write(out, p, h, urls)
    p, h = prestige_page(ctx)
    write(out, p, h, urls)
    for mid in main_maps(ctx):
        p, h = map_page(ctx, mid)
        write(out, p, h, urls)
    p, h = maps_index(ctx)
    write(out, p, h, urls)
    p, h = bosses_page(ctx)
    write(out, p, h, urls)
    bosses_n = h.count('class="box boss"')
    p, h = crafts_page(ctx)
    write(out, p, h, urls)
    crafts_n = h.count("<tr data-s=")
    p, h = ammo_page(ctx)
    write(out, p, h, urls)
    ammo_n = h.count('<td class="n pen ')
    p, h = patch_page(ctx)
    write(out, p, h, urls)
    p, h = promo_page(ctx)
    write(out, p, h, urls)
    gs_q = gs_p = 0
    gsr = gunsmith_page(ctx)
    if gsr:
        p, h, feed_json = gsr
        write(out, p, h, urls)
        (out / "gunsmith.json").write_text(feed_json, encoding="utf-8")  # 오버레이가 받아 가는 데이터(사이트맵엔 안 넣음)
        gs_q = h.count("<td rowspan=")
        gs_p = h.count('<tr data-id="')
    counts = {"quests": len(ctx.tasks), "items": items_n, "rewards": rewards_n, "qitems": qitems_n, "stations": len(ctx.hideout_reg),
              "maps": len(main_maps(ctx)), "bosses": bosses_n, "crafts": crafts_n, "ammo": ammo_n,
              "promo": len(PROMO_CODES), "gunsmith_q": gs_q, "gunsmith_p": gs_p, **extra_counts}
    p, h = hub_page(ctx, counts)
    write(out, p, h, urls)
    return urls
