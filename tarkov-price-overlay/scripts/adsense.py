"""AdSense 코드 넣기·빼기 — tarkov.aquapado.com(landing/) 전체 HTML에.

게시자 ID는 scripts/adsense_client.txt 한 줄(예: ca-pub-1234567890123456). 파일이 없거나 비어 있으면
모든 페이지에서 코드를 지우고 ads.txt도 지운다(= 광고 끔). build_guide.py가 끝날 때 자동으로 불러
가이드를 다시 만들어도 코드가 유지된다.

넣는 것(애드센스 '사이트 연결' 문서의 세 방법 중 코드 스니펫 + 메타 태그 + ads.txt 전부):
  <head> 끝: google-adsense-account 메타 + adsbygoogle.js(자동 광고 겸 사이트 확인)
  landing/ads.txt: google.com, pub-…, DIRECT, f08c47fec0942fa0

광고 자리는 애드센스 '자동 광고'로 시작한다. 본문 가리는 형식(전면·앵커)은 애드센스 화면에서 끈다.
실행: python scripts/adsense.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANDING = ROOT / "landing"
CLIENT_FILE = ROOT / "scripts" / "adsense_client.txt"
START, END = "<!--adsense-->", "<!--/adsense-->"
BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(END) + r"\n?", re.S)
# 애드블록 안내(2026-11-03): 광고 페이지 </body> 앞에 넣는 두 번째 블록. 우회·강제 없음 — 감지되면 작은 안내 바 하나(7일 닫기).
AB_START, AB_END = "<!--adblock-->", "<!--/adblock-->"
AB_RE = re.compile(re.escape(AB_START) + r".*?" + re.escape(AB_END) + r"\n?", re.S)
# 구글 공식 '광고 차단 복구' 태그(애드센스 → 개인정보보호 및 메시지 → 광고 차단 복구에서 메시지를 '게시'한 뒤에만 의미 있음).
# scripts/adblock_recovery.txt 가 "on" 이면 <head> 에 넣는다. 메시지 미게시 상태에서 넣어도 해는 없지만 아무것도 안 뜬다.
RECOVERY_FILE = ROOT / "scripts" / "adblock_recovery.txt"
# 우리 안내 바 스위치. "on" 일 때만 넣는다(파일 없으면 끔). 복구 태그가 켜져 있으면 '보조 모드' — Google 메시지
# 스크립트까지 막혀 Google 안내가 못 뜨는 경우(uBlock Origin 등)에만 뜬다(2026-11-04 사용자 결정: uBO 만 우리 바로).
BAR_FILE = ROOT / "scripts" / "adblock_bar.txt"
# Google '오류 보호'(2026-11-04): 메시지 스크립트(fundingchoices)가 막혔을 때 대체 안내를 띄우는 Google 제공 스크립트.
# AdSense → 개인정보 보호 및 메시지 → 광고 차단 복구 → 오류 보호에서 받은 원문 그대로(게시자별 설정이 마지막 줄에 인코딩).
# 복구 태그가 켜졌을 때만 같은 <head> 블록 안에 붙인다. 대체 안내 문구는 Google 고정 영어.
ERRPROT_FILE = ROOT / "scripts" / "adblock_errorprot.html"


def bar_on() -> bool:
    return BAR_FILE.exists() and BAR_FILE.read_text(encoding="utf-8").strip().lower() == "on"


def bar_fallback() -> bool:
    """복구 태그가 켜져 있으면 우리 바는 보조 — Google 메시지 스크립트까지 막힌 경우(uBlock Origin 등)에만 뜬다."""
    return recovery_on()
CLIENT_RE = re.compile(r"^ca-pub-\d{10,20}$")


def client_id() -> str | None:
    if not CLIENT_FILE.exists():
        return None
    v = CLIENT_FILE.read_text(encoding="utf-8").strip()
    if not v:
        return None
    if not CLIENT_RE.match(v):
        raise SystemExit(f"[adsense] 게시자 ID 형식이 아님: {v!r} (예: ca-pub-1234567890123456)")
    return v


def snippet(cid: str, recovery: bool = False) -> str:
    """<head> 블록. 복구 태그도 마커 안에 넣어 재실행 때 통째로 제자리 치환되게 한다(마커 밖이면 돌릴 때마다 중복)."""
    return (f'{START}<meta name="google-adsense-account" content="{cid}" />'
            f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={cid}" '
            f'crossorigin="anonymous"></script>' + (recovery_snippet(cid) + ("" if bar_on() else errprot_snippet()) if recovery else "") + f'{END}\n')


def errprot_snippet() -> str:
    return ERRPROT_FILE.read_text(encoding="utf-8").strip() if ERRPROT_FILE.exists() else ""


def recovery_on() -> bool:
    return RECOVERY_FILE.exists() and RECOVERY_FILE.read_text(encoding="utf-8").strip().lower() == "on"


def recovery_snippet(cid: str) -> str:
    """Funding Choices(광고 차단 복구) 표준 태그 — 애드센스가 주는 것과 같은 형식. pub ID 만 다르다."""
    pub = cid.replace("ca-", "")
    return (f'<script async src="https://fundingchoicesmessages.google.com/i/{pub}?ers=1"></script>'
            '<script>(function(){function signalGooglefcPresent(){if(!window.frames["googlefcPresent"]){if(document.body){'
            'const iframe=document.createElement("iframe");iframe.style="width:0;height:0;border:none;z-index:-1000;left:-1000px;top:-1000px;";'
            'iframe.style.display="none";iframe.name="googlefcPresent";document.body.appendChild(iframe);}else{setTimeout(signalGooglefcPresent,0);}}}'
            'signalGooglefcPresent();})();</script>')


AB_TEXT = {  # 안내 바 문구: [제목, 본문, '허용 방법' 버튼, 닫기, 방법 설명] — 페이지 언어 것만 심는다(en/ru 산출물에 한글 0)
    "ko": ["광고가 차단돼 있어요.", "탈콥 가이드는 광고 수익으로 운영됩니다. 광고는 최소한으로만 넣고 전면·고정 광고는 쓰지 않아요. 이 사이트만 허용 목록에 넣어 주시면 큰 힘이 됩니다.", "허용하는 법", "닫기", "uBlock Origin: 주소창 옆 uBlock 아이콘 → 큰 전원 버튼(이 사이트에서 끄기) → 새로고침. 다른 차단 확장도 같은 방식으로 이 사이트만 꺼 주세요. 휴대폰·공유기의 광고 차단 DNS(AdGuard DNS 등)를 쓰면 그쪽에서 이 사이트를 허용해야 합니다."],
    "en": ["Ads are blocked.", "This guide runs on ad revenue. We keep ads to a minimum and never use pop-ups or sticky ads. Allowing ads on this site only would help a lot.", "How to allow", "Close", "uBlock Origin: click the uBlock icon next to the address bar → the big power button (disable on this site) → reload. Other blockers work the same way — turn them off for this site only. If you use an ad-blocking DNS on your phone or router (AdGuard DNS etc.), allow this site there."],
    "ru": ["Реклама заблокирована.", "Гайд существует на доходы от рекламы. Рекламы минимум, без всплывающих и закреплённых блоков. Разрешите рекламу только для этого сайта — это очень поможет.", "Как разрешить", "Закрыть", "uBlock Origin: нажмите значок uBlock рядом с адресной строкой → большую кнопку питания (отключить на этом сайте) → обновите страницу. Другие блокировщики отключаются так же — только для этого сайта. Если используете DNS с блокировкой рекламы на телефоне или роутере (AdGuard DNS и т. п.), разрешите этот сайт там."],
}

def adblock_snippet(lang: str = "ko", fallback: bool = False) -> str:
    """경량 감지 + 정중한 안내 바. adsbygoogle.js 가 안 실렸거나(스크립트 차단) 미끼 요소가 숨겨지면(코스메틱 필터) 하단에 한 줄.
    닫으면 7일 숨김(localStorage). GA4 가 있으면 adblock_on 이벤트 1회. 콘텐츠를 가리거나 막지 않는다."""
    return (AB_START + '<style>#tgab{position:fixed;left:0;right:0;bottom:0;z-index:60;background:#1f1f19;border-top:1px solid #3a352b;'
            'color:#e9e7e0;font-size:13.5px;line-height:1.5;padding:10px 14px;display:none;box-shadow:0 -6px 20px rgba(0,0,0,.35)}'
            '#tgab .in{max-width:1100px;margin:0 auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}#tgab b{color:#c8aa64}'
            '#tgab .sp{flex:1;min-width:200px}#tgab button{background:none;border:1px solid #3a352b;color:#e9e7e0;border-radius:8px;padding:5px 10px;'
            'font:inherit;font-size:12.5px;cursor:pointer}#tgab button.y{border-color:#c8aa64;color:#c8aa64}#tgab .how{display:none;width:100%;color:#9d988b;font-size:12.5px}'
            '#tgab.open .how{display:block}</style>'
            '<div id="tgab" role="note"><div class="in"><span class="sp"><b id="tgab-t"></b> <span id="tgab-m"></span></span>'
            '<button class="y" id="tgab-h"></button><button id="tgab-x"></button><div class="how" id="tgab-w"></div></div></div>'
            '<script>(function(){var P=location.pathname;'
            'var T=' + json.dumps(AB_TEXT.get(lang) or AB_TEXT["ko"], ensure_ascii=False) + ';'
            'var K="tg_adblk_hide";try{if(+localStorage.getItem(K)>Date.now())return;}catch(e){}'
            'function bait(){var b=document.createElement("div");b.className="ad adsbox ad-placement textads banner-ads";b.style.cssText="position:absolute;left:-9999px;top:0;height:10px;width:10px";b.innerHTML="&nbsp;";document.body.appendChild(b);'
            'var hid=b.offsetHeight===0||getComputedStyle(b).display==="none";b.parentNode.removeChild(b);return hid;}'
            'function scriptOk(){return !!(window.adsbygoogle&&window.adsbygoogle.loaded);}'
            # Google 메시지 스크립트가 실리면 googlefc.AdBlockerStatusEnum 이 생긴다(googlefc 자체는 광고 스크립트도 만들어서 근거가 못 됨 — 11-04 실측)
            'function fcOk(){return !!(window.googlefc&&window.googlefc.AdBlockerStatusEnum);}'
            # 보조 모드는 adsbygoogle.loaded 를 믿지 않는다 — uBlock Origin 은 광고 스크립트를 가짜(googlesyndication_adsbygoogle.js)로
            # 바꿔 끼우고 그 가짜가 loaded:true 를 세워 차단 감지를 속인다(11-04 사용자 실측: uBO 에서 바가 안 뜸). 대신 광고가 실제로 채워졌는지 본다
            "function filled(){return !!document.querySelector('ins.adsbygoogle[data-ad-status=\"filled\"]');}"
            'function show(){var el=document.getElementById("tgab");if(!el)return;document.getElementById("tgab-t").textContent=T[0];document.getElementById("tgab-m").textContent=T[1];'
            'document.getElementById("tgab-h").textContent=T[2];document.getElementById("tgab-x").textContent=T[3];document.getElementById("tgab-w").textContent=T[4];el.style.display="block";'
            'document.getElementById("tgab-h").onclick=function(){el.classList.toggle("open");};'
            'document.getElementById("tgab-x").onclick=function(){el.style.display="none";try{localStorage.setItem(K,String(Date.now()+7*864e5));}catch(e){}};'
            'try{if(window.gtag)gtag("event","adblock_on",{page_path:P});}catch(e){}}'
            # 2026-11-04 '차단을 껐는데도 안내가 뜬다' 제보: 예전엔 로드 2.5초 뒤 한 번만 봐서 느린 회선에서 스크립트가 늦게 실리면
            # 차단으로 오판할 수 있었다 → 미끼가 숨겨지면 바로, 스크립트는 1초 간격으로 최대 10번 기다린 뒤에만 '차단'.
            'window.addEventListener("load",function(){var n=0;setTimeout(function tick(){' + ("if(fcOk()||filled())return;" if fallback else "if(n===0&&bait()){show();return;}if(scriptOk())return;") + 'if(++n>=10){show();return;}setTimeout(tick,1000);},1500);});})();</script>' + AB_END + "\n")


def ad_page(f: Path) -> bool:
    """광고를 싣는 페이지 = 탈콥 가이드(/guide/ 아래, ko·en·ru)만. 다운로드 페이지(메인)·상태·소개·방침에는 싣지 않는다
    (2026-10-27 광고 전략 결정: 광고는 가이드에만 — 무료 도구 다운로드 화면에 광고를 띄우지 않는다). 사이트 확인은
    aquapado.com 루트 ads.txt 로 끝났으므로 메인에 코드가 없어도 된다."""
    rel = f.relative_to(LANDING).as_posix()
    # 건스미스(ko·en·ru)는 제외 — 위키(escapefromtarkov.fandom.com, CC BY-NC-SA = 비상업) 예시 조립을 옮겨 온 페이지라
    # 광고를 달면 비상업 조건과 충돌할 수 있다(2026-11-02 라이선스 확인: api.php siteinfo rightsinfo).
    if re.match(r"guide/(?:(?:en|ru)/)?gunsmith/", rel):
        return False
    return rel.startswith("guide/")


def _place(t: str, rx: "re.Pattern[str]", new: str, anchor: str) -> str:
    """블록이 이미 있으면 그 자리에서 바꾸고, 없으면 anchor 앞에 넣는다 — 빌드가 만든 산출물에 다시 돌려도 바이트가 같게(멱등)."""
    if rx.search(t):
        return rx.sub(lambda m: new, t, count=1)
    return t.replace(anchor, new + anchor, 1)


def apply() -> tuple[int, str | None]:
    cid = client_id()
    rec = recovery_on()
    bar = bar_on()
    changed = 0
    for f in LANDING.rglob("*.html"):
        s = f.read_text(encoding="utf-8")
        if cid and ad_page(f) and "</head>" in s:
            t = _place(s, BLOCK_RE, snippet(cid, rec), "</head>")
            rel = f.relative_to(LANDING).as_posix()
            lang = "en" if rel.startswith("guide/en/") else "ru" if rel.startswith("guide/ru/") else "ko"
            t = _place(t, AB_RE, adblock_snippet(lang, bar_fallback()), "</body>") if bar and "</body>" in t else AB_RE.sub("", t)
        else:
            t = AB_RE.sub("", BLOCK_RE.sub("", s))
        if t != s:
            for _i in range(20):  # 방금 쓴 파일을 Windows(백신 검사 등)가 잠깐 잡으면 OSError 22/13 — 잠시 뒤 다시
                try:
                    f.write_text(t, encoding="utf-8", newline="\n")  # 빌드(LF)와 같게 — 기본값이면 Windows 에서 CRLF 로 바뀌어 전 파일이 더러워진다
                    break
                except OSError as ex:
                    if ex.errno not in (13, 22) or _i == 19:
                        raise
                    __import__("time").sleep(0.25)
            changed += 1
    ads = LANDING / "ads.txt"
    if cid:
        ads.write_text(f"google.com, {cid.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n", encoding="utf-8")
    elif ads.exists():
        ads.unlink()
    return changed, cid


if __name__ == "__main__":
    n, cid = apply()
    print(f"[adsense] {'게시자 ' + cid if cid else '끔(ID 없음)'} · 바뀐 페이지 {n}개 · ads.txt {'있음' if cid else '없음'} · 애드블록 안내 {'있음' if cid and bar_on() else '없음'} · 복구 태그 {'on' if recovery_on() else 'off'}")
    sys.exit(0)
