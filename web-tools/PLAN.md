# 뚝딱툴즈 — 한국어 클라이언트사이드 웹 도구 모음 실행 계획

> 작성: 2026-07-08. 이 문서가 이 프로젝트의 단일 기준(SSOT)이다.
> 세션을 새로 시작할 때는 이 문서의 "단계별 작업 프롬프트"를 복사해서 시작한다.

## 1. 핵심 컨셉

- **모든 파일 처리는 브라우저 안(WASM/Canvas)에서 끝난다.** 서버 업로드 0 → 서버비 0, "파일이 서버에 올라가지 않습니다"가 곧 차별화 문구.
- **도구 1개 = 페이지 1개 = 타깃 키워드 1개.** 사이트 전체가 프로그래매틱 SEO 구조.
- 수익 = Google AdSense. 유통 = 검색(구글 + 네이버 + 빙/IndexNow).
- 교훈 반영: 타르코프 오버레이의 병목은 유통이었다. 이 프로젝트는 "만들면 검색이 데려오는" 구조가 목적 그 자체다.

## 2. 결정사항 (기본값 — 바꾸려면 이 문서를 수정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 이름 | **뚝딱툴즈** (Phase 0에서 확정) | "툴모아"는 동일 니치 툴스모아(tools-moah.app)와 혼동 위험. 뚝딱툴즈=검색 중복 없음·기억 용이. 차선: 안심툴(알툴즈·안툴즈와 발음 유사), 브라우저툴즈(일반명사) |
| 도메인 | `tools.aquapado.com` | 무료(보유 도메인 서브도메인). 신규 도메인 구매는 "무료" 원칙 위배 |
| 스택 | Next.js 14 App Router + TypeScript + Tailwind, **전 페이지 SSG** | 알파개미에서 검증된 스택, 정적이라 Vercel 무료플랜 부담 최소 |
| 호스팅 | Vercel 무료 (CLI `vercel --prod` 배포, GitHub 연동 불필요) | C:\project는 push 금지 정책(floe9235 예외)과 충돌 없음 |
| 대용량 WASM | ffmpeg.wasm 등은 **jsDelivr CDN에서 로드** | Vercel 무료 대역폭 100GB/월 보호 |
| 저장소 | `C:\project\web-tools\` 모노레포 하위, dev 브랜치 | 스티키 메모와 동일 패턴 |
| 분석 | GA4 (+ Vercel Web Analytics 무료) | AdSense와 시너지. **자체 비콘→Neon 금지** (compute quota 402 전례) |

## 3. 도구 로드맵

### Phase 1 — MVP 7종 (엔진 3개로 커버)

| # | 도구 | 타깃 키워드 | 구현 | 난이도 |
|---|---|---|---|---|
| 1 | HEIC → JPG 변환 | "heic jpg 변환", "아이폰 사진 변환" | `heic2any` (libheif wasm ~1MB), 배치 지원 | 하 |
| 2 | 이미지 용량 줄이기 | "이미지 용량 줄이기", "사진 압축" | Canvas + `browser-image-compression` | 하 |
| 3 | 이미지 형식 변환 (JPG/PNG/WebP) | "webp 변환", "png jpg 변환" | 2번과 같은 엔진, 페이지만 분리 | 하 |
| 4 | PDF 합치기 | "pdf 합치기" | `pdf-lib` | 하 |
| 5 | PDF 분할 / JPG→PDF | "pdf 분할", "jpg pdf 변환" | `pdf-lib` (+ 페이지 분리) | 하 |
| 6 | 동영상 → GIF | "움짤 만들기", "mp4 gif 변환" | `@ffmpeg/ffmpeg` 0.12 **싱글스레드 코어**(하단 함정 참조), 사용자 액션 시 lazy load | 중 |
| 7 | 유튜브 썸네일 추출 | "유튜브 썸네일 추출" | `img.youtube.com` URL 패턴 (처리 없음) | 최하 |

핵심 트릭: 엔진 하나(예: Canvas 이미지 파이프)로 키워드별 페이지 여러 개를 만든다.

### Phase 3 — 확장 후보 (도구 15~20개 목표, 데이터 보고 우선순위 결정)

- 이미지 모자이크(민감정보 가리기), 이미지 → 텍스트 OCR(`tesseract.js` 한국어), PDF → 이미지(`pdf.js`), 영상 용량 줄이기(ffmpeg 재활용), 배경 투명화(`@imgly/background-removal`), ICO/파비콘 변환, QR 코드 생성, 글자수 세기(자소서), 랜덤 뽑기, D-day·퍼센트 계산기
- 각 도구 추가 시: 페이지 + FAQ 콘텐츠 + sitemap 갱신 + 관련도구 내부링크가 한 세트

### Phase 0 경쟁 스캔 결과 (2026-07-08)

| 키워드 | 상위 경쟁 | UX 약점 (우리의 공략점) |
|---|---|---|
| heic jpg 변환 | iLoveIMG, PDF24, Convertio, Canva | 전부 서버 업로드(대기시간·개인정보), Convertio 100MB 제한, Canva 가입 유도 |
| 이미지 용량 줄이기 | iLoveIMG, imgPresso(국산), 산돌캔버스 | 업로드 방식 다수, 배치 제한, 결과 비교 UI 빈약. 산돌은 클라이언트 처리 표방 — 벤치마크 대상 |
| webp/png/jpg 변환 | Adobe Express, FreeConvert, 크롬확장 다수 | 한국어 웹페이지형 클라이언트 처리는 공백에 가까움. 크롬확장이 "로컬 처리" 소구 중 = 수요 검증 |
| pdf 합치기/분할 | iLovePDF, Smallpdf, PDF24, Adobe | 전부 서버 업로드 — 계약서·신분증 등 민감문서 불안 소구 유효. Smallpdf 일일 무료 제한 |
| mp4 gif 변환(움짤) | ezgif(영어·구식 UI), Canva/Adobe(가입) | ezgif 100MB 제한+업로드 대기+영어. 한국어+로컬 처리면 차별화 큼 |
| 유튜브 썸네일 추출 | 소규모 블로그형 툴 다수 | 경쟁 약함(쉬운 승부처), 단 가치도 낮음 — 유입용 롱테일로 활용 |

공통 결론: 상위권 전원이 서버 업로드 모델 → **"파일이 서버에 올라가지 않습니다 + 용량 제한 없음 + 즉시 처리"**가 전 도구 공통 헤드라인.

## 4. 사이트 구조

```
/                      도구 그리드 + 클라이언트 검색
/[tool-slug]/          도구 페이지 (영문 slug: /heic-to-jpg/ 등)
/privacy/  /about/  /contact/   ← AdSense 승인 필수 3종
```

도구 페이지 공통 레이아웃 (컴포넌트 재사용):
1. H1 + 한 줄 설명 ("서버에 업로드되지 않습니다" 뱃지)
2. FileDropzone → 처리 → 다운로드(단일/ZIP은 `jszip`)
3. 광고 슬롯 (승인 전엔 자리만)
4. **사용법 3단계 + FAQ 4개+ (합계 800자 이상)** ← AdSense 승인·SEO용 텍스트 밀도
5. 관련 도구 내부링크 4개

## 5. SEO 계획

- 페이지별 고유 title/description/OG, `FAQPage` + `HowTo` JSON-LD, sitemap.xml, robots.txt, llms.txt (타르코프 랜딩에서 해본 패턴 재사용)
- 색인 등록: IndexNow(빙→DDG·야ンデックス, Claude 실행 가능) / **GSC + 네이버 서치어드바이저는 사용자 몫** (기존 pending_user_actions 패턴)
- 네이버는 일반 사이트 색인이 짜다 → 서치어드바이저 등록 + 필요 시 네이버 블로그 보조 채널(도구 소개 글 → 링크)을 Phase 4 옵션으로
- 성과 기준: 색인 페이지 수 → 노출 → 클릭 순으로 관찰 (GSC)

## 6. AdSense 로드맵

1. **신청 전 요건**: 도구 15개+ & 페이지당 실질 텍스트, privacy/about/contact, 커스텀 도메인, 색인 확인
2. 신청 시점: Phase 3 완료 후 (대략 배포 3~4주 후)
3. 승인 후: `ads.txt` 배치, 자동광고 대신 **수동 슬롯 2개**(도구 아래 + 콘텐츠 사이)로 시작 — 도구 UX 해치면 재방문 죽는다
4. 보조 수익 후보(승인 지연 시): 쿠팡 파트너스 배너

## 7. 단계 및 마일스톤

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **Phase 0** 사전검증 (반나절) | 이름 중복 확인, 키워드별 한국어 경쟁 사이트 스캔(상위 5개 UX 약점 기록), 키워드 우선순위 확정 | 이 문서 3장 표 업데이트 |
| **Phase 1** MVP (1~2주) | 스캐폴드 + 도구 7종 + 공통 레이아웃 + SEO 기반 + privacy 3종 + Vercel 배포 | `tools.aquapado.com` 라이브, Lighthouse SEO 95+ |
| **Phase 2** 색인 (며칠) | IndexNow 제출(Claude) / GSC·네이버 등록(사용자), GA4 부착 | GSC에서 색인 확인 |
| **Phase 3** 확장 (2~4주) | 도구 15~20개, FAQ 콘텐츠 보강, AdSense 신청 | 신청 제출 |
| **Phase 4** 수익화·관찰 | 광고 슬롯 배치, GSC 쿼리 기반 도구 추가, 월간 리뷰 | 첫 수익 발생 |

**KPI**: 색인 페이지 수 → 월 PV(1차 목표 10,000) → AdSense 승인 → 월 수익

## 8. 리스크 및 함정 (구현 전 필독)

- **ffmpeg.wasm 멀티스레드 금지**: 멀티스레드 코어는 SharedArrayBuffer가 필요해 COOP/COEP 헤더(cross-origin isolation)를 강제하는데, 이러면 **AdSense 스크립트·외부 임베드가 깨진다.** 반드시 싱글스레드 코어(`@ffmpeg/core` st) 사용. 느려도 광고와 공존이 우선.
- **Vercel 대역폭**: ffmpeg 코어(~32MB)는 반드시 CDN(jsDelivr) 로드 + 페이지 진입이 아닌 "파일 선택 시" lazy load.
- **대용량 파일 메모리**: 브라우저 탭 메모리 한계(모바일 특히). 파일 크기 상한(예: 이미지 50MB, 영상 500MB) + 초과 시 친절한 안내.
- **Safari/모바일**: heic2any·ffmpeg.wasm 모바일 Safari 동작 확인 필수. 모바일 트래픽이 절반 이상일 것.
- **iLovePDF 등 대형 경쟁**: 영어권 브랜드와 정면승부 금지. 한국어 롱테일 + "업로드 없음" + 속도(서버 왕복 없음)로 포지셔닝.
- **광고 이전 완성도 함정**: AdSense 승인에는 "가치 있는 콘텐츠" 심사가 있다. 도구만 덜렁 있으면 반려됨 — 사용법/FAQ 텍스트가 승인의 핵심.

## 9. 사용자(사람) 몫 체크리스트

- [ ] DNS: hosting.co.kr에서 `tools` CNAME → Vercel 대시보드 고유값 (CNAME은 반드시 대시보드 고유값 — 통계 인프라 때 SSL 함정 전례)
- [ ] Google Search Console + 네이버 서치어드바이저 등록·sitemap 제출
- [ ] GA4 속성 생성 (측정 ID만 전달해주면 부착은 Claude)
- [ ] AdSense 계정 신청 (Phase 3 말)

## 10. 단계별 작업 프롬프트 (세션 시작 시 복사용)

### Phase 0+1 킥오프
```
C:\project\web-tools\PLAN.md 읽고 Phase 0과 Phase 1을 진행해줘.

Phase 0: 웹 검색으로 (1) "툴모아" 이름 중복 확인 — 겹치면 대안 3개 제안하고 제일 나은 걸로 진행,
(2) PLAN 3장의 키워드 7개 각각 한국어 경쟁 상위 사이트를 훑고 UX 약점을 PLAN에 기록.

Phase 1: PLAN 2·3·4·8장대로 Next.js 14 SSG 사이트를 web-tools/에 스캐폴드하고 도구 7종을 구현해줘.
- 함정(8장) 필독: ffmpeg는 싱글스레드 코어 + CDN lazy load
- 도구마다 사용법 3단계 + FAQ 4개(합 800자+) 한국어 카피까지 작성
- privacy/about/contact + sitemap/robots/JSON-LD 포함
- 완료 기준: npm run build 통과 + 로컬에서 7종 전부 실제 파일로 동작 검증(Playwright나 preview로)
- 커밋은 dev 브랜치, push는 하지 마
끝나면 남은 것(배포·DNS 등 사용자 몫)을 정리해서 보고해줘.
```

### Phase 2 배포·색인
```
C:\project\web-tools\PLAN.md의 Phase 2를 진행해줘.
vercel CLI로 프로덕션 배포하고 tools.aquapado.com 도메인을 연결해줘 (DNS CNAME은 내가 등록).
배포 검증 후 IndexNow로 전 페이지 제출하고, GSC/네이버 등록에 필요한 값(소유확인 방법, sitemap URL)을 정리해줘.
```

### Phase 3 확장·AdSense 준비
```
C:\project\web-tools\PLAN.md의 Phase 3를 진행해줘.
GSC 쿼리 데이터(내가 공유)와 PLAN 3장의 확장 후보를 참고해 도구를 15개 이상으로 늘리고,
전 페이지 AdSense 승인 요건(콘텐츠 밀도·필수 페이지·색인)을 점검한 뒤 신청 직전 체크리스트를 만들어줘.
```
