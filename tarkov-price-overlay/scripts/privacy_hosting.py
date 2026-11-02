"""landing/privacy/index.html 의 '광고(5번)'·'방문 집계'·'제3자 서비스(6번)' 문구를 호스팅/광고 상태에 맞춘다.

  python scripts/privacy_hosting.py on    # Cloudflare 이전 + 가이드 광고 게재 문구(오늘 날짜)
  python scripts/privacy_hosting.py off   # 원래 문구(Vercel 호스팅, 광고 없음)

cutover_cloudflare.ps1 이 부른다. 문구 쌍을 정확히 바꿔 끼우므로 몇 번 돌려도 같은 결과(멱등). 바꿀 문구를 못 찾으면 실패(exit 1).
"""
from __future__ import annotations

import datetime as dt
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "landing" / "privacy" / "index.html"

ADS_OFF = ('<p><b>현재 이 사이트와 앱에는 제3자 광고가 없습니다.</b> 운영비를 위해 탈콥 가이드 등 웹페이지에 Google AdSense 광고를 '
           '도입할 수 있으며, 도입하면 이 항목을 먼저 갱신합니다. 도입 시 적용되는 내용은 다음과 같습니다.</p>')
ADS_ON_RE = re.compile(r'<p><b>\d{4}년 \d{1,2}월 \d{1,2}일부터 탈콥 가이드\(tarkov\.aquapado\.com/guide/\) 페이지에 Google AdSense 광고를 게재합니다\.</b>.*?</p>', re.S)


def ads_on(d: dt.date) -> str:
    return (f'<p><b>{d.year}년 {d.month}월 {d.day}일부터 탈콥 가이드(tarkov.aquapado.com/guide/) 페이지에 Google AdSense 광고를 게재합니다.</b> '
            '운영비를 위한 것이며, 다운로드 페이지(메인)·상태·소개 페이지, 건스미스 페이지와 오버레이 앱에는 광고가 없습니다. '
            '광고에는 다음 내용이 적용됩니다.</p>')


PAIRS = [  # (off, on) — 정확히 일치하는 줄 단위 치환
    ('<tr><td>방문 집계(Vercel Web Analytics)</td><td>페이지뷰·방문자 수·국가·기기 종류 같은 통계. 쿠키를 쓰지 않고 개인을 추적하지 않습니다.</td><td class="no">식별 불가(집계만)</td></tr>\n',
     ''),
    ('<tr><td>서버 접속 기록</td><td>호스팅(Vercel)이 표준 접속 로그를 남깁니다. 운영자는 이를 개인 식별에 쓰지 않습니다.</td><td>호스팅 사업자 정책에 따름</td></tr>',
     '<tr><td>서버 접속 기록</td><td>호스팅(Cloudflare·Vercel)이 표준 접속 로그를 남깁니다. 운영자는 이를 개인 식별에 쓰지 않습니다.</td><td>호스팅 사업자 정책에 따름</td></tr>'),
    ('<tr><td>Vercel</td><td>사이트·API 호스팅, 방문 집계</td><td>표준 접속 정보, 익명 집계</td></tr>',
     '<tr><td>Cloudflare</td><td>사이트 호스팅(tarkov.aquapado.com)</td><td>표준 접속 정보</td></tr>\n'
     '<tr><td>Vercel</td><td>API 호스팅(api.aquapado.com)</td><td>표준 접속 정보</td></tr>'),
    ('<tr><td>Google(도입 시)</td><td>광고</td><td>5번 참고</td></tr>',
     '<tr><td>Google AdSense</td><td>가이드 페이지 광고</td><td>5번 참고</td></tr>'),
]


def main(mode: str) -> int:
    s = F.read_text(encoding="utf-8")
    o = s
    if mode == "on":
        if ADS_OFF in s:
            s = s.replace(ADS_OFF, ads_on(dt.date.today()))
        elif not ADS_ON_RE.search(s):
            print("[privacy] 광고 문단을 못 찾음"); return 1
        for off, on in PAIRS:
            if off and off in s:
                s = s.replace(off, on)
    elif mode == "off":
        s = ADS_ON_RE.sub(ADS_OFF, s)
        if ADS_OFF not in s:
            print("[privacy] 광고 문단을 못 찾음"); return 1
        for off, on in PAIRS:
            if on and on in s:
                s = s.replace(on, off)
            elif not on and off not in s:
                # 지운 줄(Vercel Web Analytics 행)은 GA 행 앞에 되살린다
                s = s.replace('<tr><td>방문 집계(Google Analytics)</td>', off + '<tr><td>방문 집계(Google Analytics)</td>', 1)
    else:
        print("사용법: privacy_hosting.py on|off"); return 2
    if s != o:
        F.write_text(s, encoding="utf-8")
    print(f"[privacy] {mode} · {'바뀜' if s != o else '이미 그 상태'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ""))
