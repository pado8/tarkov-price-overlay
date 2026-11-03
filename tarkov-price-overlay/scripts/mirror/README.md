# json.tarkov.dev 일일 미러 (2026-11-03)

- 왜: api.tarkov.dev GraphQL 이 2026-07-21부터 죽어(the-hideout/tarkov-api#474) json.tarkov.dev 가 시세의 단일 출처가 됐다.
- 무엇: `data-mirror.yml` 을 PUBLIC 배포 저장소 `pado8/tarkov-price-overlay-releases` 의 `.github/workflows/` 에 두면
  매일 12:17 KST 에 json.tarkov.dev 문서(모드 3 × 문서 7 × 언어 4 + 시즌·상태)를 받아 `data-mirror` **사전 릴리즈** 자산으로 올린다.
  사전 릴리즈라 업데이터의 `releases/latest` 에는 영향이 없다.
- 앱: `python-core/tarkov_json_fallback.py` `_get()` 이 json.tarkov.dev 실패(404 제외) 시
  `https://github.com/pado8/tarkov-price-overlay-releases/releases/download/data-mirror/<경로의 / 를 __ 로>.json` 을 읽는다.
- 설치(한 번): 아래를 실행하면 파일을 올리고 첫 실행까지 한다.
  ```
  gh api -X PUT repos/pado8/tarkov-price-overlay-releases/contents/.github/workflows/data-mirror.yml \
    -f message="ci: json.tarkov.dev 일일 미러" -f branch=main \
    -f content="$(base64 -w0 scripts/mirror/data-mirror.yml)"
  gh workflow run data-mirror.yml -R pado8/tarkov-price-overlay-releases
  ```
- 확인: `gh release view data-mirror -R pado8/tarkov-price-overlay-releases` 에 `regular__items.json` 등이 보이면 끝.
