# IndexNow 제출 스크립트 — DNS(tools.aquapado.com) 연결 후 실행
# 사용법: python scripts/indexnow.py
# sitemap.xml에서 URL 목록을 읽어 Bing IndexNow 엔드포인트로 제출한다
# (Bing 제출 → DuckDuckGo·Yandex·네이버 등 IndexNow 참여 엔진에 전파)
import json
import re
import urllib.request

SITE = "https://tools.aquapado.com"
KEY = "147fba7cc5bfaec15992b8c99a0e5a94"

def main():
    with urllib.request.urlopen(f"{SITE}/sitemap.xml", timeout=15) as res:
        xml = res.read().decode("utf-8")
    urls = re.findall(r"<loc>(.*?)</loc>", xml)
    if not urls:
        raise SystemExit("sitemap에서 URL을 찾지 못했습니다")
    print(f"{len(urls)}개 URL 제출:")
    for u in urls:
        print(" -", u)
    body = json.dumps({
        "host": "tools.aquapado.com",
        "key": KEY,
        "keyLocation": f"{SITE}/{KEY}.txt",
        "urlList": urls,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.indexnow.org/indexnow",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        print("응답:", res.status, res.reason)

if __name__ == "__main__":
    main()
