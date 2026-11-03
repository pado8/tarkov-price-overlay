# IndexNow 제출 — tarkov.aquapado.com 사이트맵의 URL을 검색엔진에 알린다
# 사용법: python scripts/indexnow.py            (운영 사이트맵 전체)
#         python scripts/indexnow.py /guide/    (경로가 이걸로 시작하는 것만)
# api.indexnow.org 한 번이면 IndexNow 참여 엔진(Bing·Yandex·Naver·Seznam 등)에 전달된다.
# 키 파일: landing/19b5a7e601f746bfb29e5c622006ae8e.txt (사이트 루트에 배포돼 있어야 함)
import json
import re
import sys
import urllib.request

SITE = "https://tarkov.aquapado.com"
KEY = "19b5a7e601f746bfb29e5c622006ae8e"
BATCH = 1000  # 프로토콜 상한 10,000 — 넉넉히 나눈다
UA = "Mozilla/5.0 (compatible; aquapado-indexnow/1.0; +https://tarkov.aquapado.com)"


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else ""
    # 11-03: Cloudflare 가 Python-urllib 기본 UA 를 403 으로 막는다 → UA 지정
    sm = urllib.request.Request(f"{SITE}/sitemap.xml", headers={"User-Agent": UA})
    with urllib.request.urlopen(sm, timeout=20) as res:
        xml = res.read().decode("utf-8")
    urls = [u for u in re.findall(r"<loc>(.*?)</loc>", xml) if u.startswith(SITE + prefix)]
    if not urls:
        raise SystemExit("sitemap에서 URL을 찾지 못했습니다")
    print(f"{len(urls)}개 URL 제출")
    for i in range(0, len(urls), BATCH):
        body = json.dumps({"host": "tarkov.aquapado.com", "key": KEY,
                           "keyLocation": f"{SITE}/{KEY}.txt", "urlList": urls[i:i + BATCH]}).encode("utf-8")
        req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                                     headers={"Content-Type": "application/json; charset=utf-8",
                                              # 11-03: urllib 기본 UA(Python-urllib)는 api.indexnow.org 가 403 으로 막는다
                                              "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as res:
            print(f"  {i + 1}~{min(i + BATCH, len(urls))}: 응답 {res.status} {res.reason}")


if __name__ == "__main__":
    main()
