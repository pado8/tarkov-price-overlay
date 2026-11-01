"""프로모 코드 자동 점검 — 정리 사이트 여러 곳에서 코드별 '활성/만료' 표기를 긁어 guide_data/promo_status.json 에 쓴다.

사람이 관리하는 PROMO_CODES(guide_static.py)는 건드리지 않는다. 페이지는 이 파일로
  · 코드 옆 "활성 n곳"(활성 절에서 보인 출처 수) / "만료 의심"(활성 0곳 + 만료 절에 보임)
  · "자동 감지된 새 코드"(목록에 없는 코드가 3곳 이상 활성 절에 보임)
을 그린다. 매주 scripts/promo_refresh.ps1 이 돌린다(수동: python scripts/promo_check.py).

판정 규칙(단순·보수적):
  - 각 출처 페이지 본문을 "활성" 영역과 "만료" 영역으로 나눈다: 처음으로 expired/inactive/no longer 가 제목(h2/h3)에 나오는 지점 이전 = 활성, 이후 = 만료.
  - 코드는 대문자·숫자 5~20자 토큰. 흔한 대문자 단어(PVE, PVP, EXP …)는 제외.
  - 출처 하나라도 못 받으면 그 출처만 빼고 계속한다(결과에 fetched/failed 기록).
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "guide_data" / "promo_status.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", "Accept-Language": "en-US,en;q=0.8"}
SOURCES = [
    ("dexerto", "https://www.dexerto.com/escape-from-tarkov/all-escape-from-tarkov-promo-codes-and-discounts-1752105/"),
    ("gamesradar", "https://www.gamesradar.com/games/fps/escape-from-tarkov-codes-promo/"),
    ("pcgamesn", "https://www.pcgamesn.com/escape-from-tarkov/codes"),
    ("tarkov.help", "https://tarkov.help/en/article/promocodes-tarkov"),
    ("guided.news", "https://guided.news/en/news/escape-from-tarkov-active-promo-codes-rewards/"),
    ("esports.ru", "https://esports.ru/igrovaya-industriya/articles/promokody-escape-from-tarkov-2026/"),
]
STOP = set("""PVE PVP EXP USEC BEAR BSG EFT PMC FIR TARKOV ESCAPE FROM CODES CODE PROMO ACTIVE EXPIRED REWARDS REWARD HTML HTTP HTTPS JSON
NEW YEAR HALLOWEEN UPDATE PATCH LAUNCHER ACTIVATE REDEEM ITEMS ITEM FREE GAME GAMES PLAYER PLAYERS GUIDE NEWS STEAM ARENA SEASON KORD BREACH
LEVEL ZONE MODE RUB USD EUR ANY ALL WITH AND THE FOR YOU NOT NOW HOW WHAT WHEN WHERE TIPS LIST FAQ RPG FPS AMD NVIDIA RTX GPU CPU RAM SSD
AK AKM M4A1 HK MP5 SKS SVD PM TT GP GPU MOD MODS APP KEKTAPE CALOK SALEWA GRIZZLY CMS IFAK AFAK PMAG MDR ULACH COMTAC
THIS THAT THEY THEM THEN THAN ALSO ONLY INTO OVER MORE MOST SOME EACH BOTH SUCH VERY JUST LIKE WILL MUST NEED HERE THERE READ MORE
PLAY DAILY WEEK WEEKS DAYS HOUR LAST NEXT FIRST OPEN CLICK LOGIN MENU USER NAME MAIL SAVE SHOP CART CASE CRATE CRATES ITEM""".split())
CODE_RE = re.compile(r"(?<![A-Z0-9])[A-Z][A-Z0-9]{3,19}(?![A-Z0-9])")  # 4~20자(WIPE 같은 4글자 코드 포함)


def split_active_expired(html: str) -> tuple[str, str]:
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S | re.I)
    # 제목 태그 안의 만료 표식 위치 찾기
    m = None
    for h in re.finditer(r"<h[1-4][^>]*>(.*?)</h[1-4]>", text, flags=re.S | re.I):
        t = re.sub(r"<[^>]+>", "", h.group(1)).lower()
        if re.search(r"expired|inactive|no longer|not working|past codes|old codes|истек|неактив", t):
            m = h
            break
    body = re.sub(r"<[^>]+>", " ", text)
    if not m:
        return body, ""
    cut = len(re.sub(r"<[^>]+>", " ", text[: m.start()]))
    return body[:cut], body[cut:]


def codes_in(s: str) -> set[str]:
    out = set()
    for tok in CODE_RE.findall(s):
        if tok in STOP or tok.isdigit() or re.fullmatch(r"[0-9]+[A-Z]{1,2}", tok):
            continue
        if re.search(r"[0-9]", tok) and not re.search(r"[A-Z]{3}", tok):
            continue  # 숫자 섞인 모델명(M855A1 등)
        out.add(tok)
    return out


def main() -> int:
    known: set[str] = set()
    try:
        sys.path.insert(0, str(ROOT))
        import guide_static  # noqa: WPS433

        known = {c for c, *_ in guide_static.PROMO_CODES} | {t for c, *_ in guide_static.PROMO_GONE for t in re.split(r"[ ·]+", c) if re.fullmatch(r"[A-Z0-9]{4,}", t)}
    except Exception as ex:  # noqa: BLE001
        print(f"[promo] guide_static 불러오기 실패(계속 진행): {ex}")
    status: dict[str, dict] = {}
    fetched, failed = [], []
    for name, url in SOURCES:
        try:
            r = requests.get(url, headers=UA, timeout=25)
            r.raise_for_status()
            act, exp = split_active_expired(r.text)
            a, x = codes_in(act), codes_in(exp)
            for c in a:
                status.setdefault(c, {"active": [], "expired": []})["active"].append(name)
            for c in x - a:
                status.setdefault(c, {"active": [], "expired": []})["expired"].append(name)
            fetched.append(name)
            print(f"[promo] {name}: 활성 {len(a)} · 만료 {len(x - a)}")
        except Exception as ex:  # noqa: BLE001
            failed.append(name)
            print(f"[promo] {name}: 실패 — {ex}")
        time.sleep(1.0)
    # 알려진 코드는 전부 남기고(0곳이어도), 모르는 코드는 2곳 이상 보일 때만 기록(잡음 제거)
    codes = {c: v for c, v in status.items() if c in known or len(v["active"]) + len(v["expired"]) >= 2}
    result = {"checked": time.strftime("%Y-%m-%d"), "fetched": fetched, "failed": failed, "codes": dict(sorted(codes.items()))}
    OUT.parent.mkdir(exist_ok=True)
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    new = json.dumps(result, ensure_ascii=False, indent=1)
    OUT.write_text(new, encoding="utf-8")
    changed = json.loads(old).get("codes") != result["codes"] if old else True
    print(f"[promo] 출처 {len(fetched)}/{len(SOURCES)} · 코드 {len(codes)}개 · 변경 {'있음' if changed else '없음'} → {OUT}")
    for c in sorted(known):
        v = codes.get(c) or {"active": [], "expired": []}
        print(f"   {c:14} 활성 {len(v['active'])}곳 {v['active']} 만료 {v['expired']}")
    new_codes = [c for c, v in codes.items() if c not in known and len(v["active"]) >= 3]
    if new_codes:
        print(f"[promo] 🆕 새 코드 후보(3곳 이상 활성): {new_codes}")
    return 0 if not changed else 3  # 3 = 바뀜(refresh 스크립트가 재빌드·배포 판단에 씀)


if __name__ == "__main__":
    sys.exit(main())
