# Vercel + Neon Postgres — Stats Backend Setup

> **참고**: 2024년 말부터 Vercel의 자체 Postgres 서비스는 **Neon**으로 이전됐습니다. 새 DB는 Vercel Marketplace의 Neon 통합으로 만듭니다. 기능/사용감은 거의 동일하지만 SDK가 `@neondatabase/serverless`로 바뀜.



이 문서는 앱이 보내는 익명 사용 통계 (`POST https://api.aquapado.com/priceoverlay/events`)를 받기 위한 Vercel 백엔드 셋업 가이드입니다.

**왜 Vercel?** 무료, 한국에서 차단 위험 사실상 0% (AWS Seoul edge), 이미 계정 보유. 메인 사이트(aquapado.com)는 GitHub Pages 그대로 유지, `api.` 서브도메인만 Vercel로 연결.

**구조:**
```
aquapado.com           → GitHub Pages (변경 X)
api.aquapado.com       → Vercel 신규 프로젝트 (이 가이드)
                         └─ /priceoverlay/events  → Postgres
```

셋업 시간 30분~1시간 (DNS 전파 포함 시 +수 시간).

---

## 0. 사전 준비

- Vercel 계정 (이미 보유)
- 도메인 `aquapado.com` 등록업체 접근 권한 (DNS CNAME 추가용)
- 로컬에 Node.js 18+ 설치 (Vercel CLI 사용)

---

## 1. 새 Vercel 프로젝트 만들기

### 1.1. 로컬 폴더 + 파일 구조

별도 폴더 (Tarkov 프로젝트와 분리, 예: `~/projects/aquapado-api/`):

```bash
mkdir aquapado-api && cd aquapado-api
```

다음 4개 파일만 만들면 됨:

#### `package.json`
```json
{
  "name": "aquapado-api",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@neondatabase/serverless": "^1.0.2"
  }
}
```

#### `api/priceoverlay/events.ts`
```typescript
// Vercel Edge Function — stats ingestion for tarkov-price-overlay
//
// Receives POST https://api.aquapado.com/priceoverlay/events
// Body: { install_id, event_type: "launch"|"lookup", version }
// Stores in Postgres with server-side timestamp + Vercel country (no IP).

import { neon } from "@neondatabase/serverless";

export const config = {
  runtime: "edge",
};

// Neon connection — env var injected when the Marketplace Neon integration
// is linked to this project. DATABASE_URL is Neon-native; POSTGRES_URL is
// kept as fallback for projects migrated from the legacy @vercel/postgres.
const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const { install_id, event_type, version } = body || {};

  // Strict validation — protects DB from junk submissions.
  if (
    typeof install_id !== "string" ||
    install_id.length < 8 ||
    install_id.length > 64
  ) {
    return json(400, { error: "invalid_install_id" });
  }
  if (event_type !== "launch" && event_type !== "lookup") {
    return json(400, { error: "invalid_event_type" });
  }
  const v =
    typeof version === "string" && version.length <= 16 ? version : "unknown";

  // Vercel-provided client country from request headers. We never log
  // or store the IP itself.
  const country = req.headers.get("x-vercel-ip-country") ?? "??";

  try {
    await sql`
      INSERT INTO events (install_id, event_type, version, ts, country)
      VALUES (${install_id}, ${event_type}, ${v}, ${Date.now()}, ${country})
    `;
  } catch (e) {
    return json(500, { error: "db_insert_failed" });
  }

  return json(200, { ok: true });
}
```

#### `.gitignore`
```
node_modules
.vercel
.env*.local
```

#### `vercel.json` (선택 — 라우팅 명시. 없어도 동작)
```json
{
  "rewrites": [
    { "source": "/priceoverlay/events", "destination": "/api/priceoverlay/events" }
  ]
}
```

### 1.2. 의존성 설치

```bash
npm install
```

### 1.3. Vercel CLI 설치 + 로그인

```bash
npm install -g vercel
vercel login
# 브라우저 열려서 로그인 → 인증
```

### 1.4. 프로젝트 첫 배포

```bash
vercel
```

대화형 프롬프트:
- Set up and deploy? **Y**
- Which scope? **(본인 계정)**
- Link to existing project? **N**
- Project name? **aquapado-api** (또는 원하는 이름)
- Directory? **./** (현재 폴더)
- Override settings? **N**

성공 시 출력:
```
✅ Production: https://aquapado-api-xxx.vercel.app
```

---

## 2. Neon Postgres DB 생성 + 연결

### 2.1. Vercel 대시보드에서 Neon 통합 생성

1. https://vercel.com/dashboard → 위에서 만든 `aquapado-api` 프로젝트 클릭
2. **Storage** 탭 → **Create Database**
3. Marketplace에서 **Neon** 선택 (Postgres 카테고리)
4. DB 이름: `stats-db` (또는 원하는 이름)
5. Region: **Asia Pacific (Singapore)** 또는 **Tokyo** — 한국에서 가까운 곳
6. **Create**

### 2.2. 프로젝트에 자동 연결

DB 생성 후 자동으로 묻는 화면: "Connect to this project?" → **Yes**

이렇게 하면 환경 변수 `DATABASE_URL` (및 호환용 `POSTGRES_URL` 등)이 자동으로 Vercel 프로젝트에 주입됩니다. `@neondatabase/serverless` SDK가 이걸 읽어서 연결.

### 2.3. 테이블 생성

Vercel 대시보드 → Storage → 만든 DB 클릭 → **Query** 탭 → 아래 붙여넣고 Run:

```sql
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  install_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  version TEXT NOT NULL,
  ts BIGINT NOT NULL,
  -- Server-derived (not from client). Best-effort country from Vercel
  -- header for geographic distribution. Never store IP itself.
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_install_id ON events(install_id);
CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_event_type ON events(event_type);
```

### 2.4. 환경 변수 로컬에 동기화 (선택 — 로컬 테스트용)

```bash
vercel env pull .env.local
```

이러면 `.env.local`에 `DATABASE_URL` 등이 다운로드됨. 로컬에서 `vercel dev`로 테스트 가능.

### 2.5. 재배포

DB 환경 변수가 추가됐으니 재배포해서 함수가 변수를 읽도록:

```bash
vercel --prod
```

---

## 3. 커스텀 도메인 연결 (`api.aquapado.com`)

### 3.1. Vercel에서 도메인 추가

1. 프로젝트 대시보드 → **Settings** → **Domains**
2. `api.aquapado.com` 입력 → **Add**
3. Vercel이 표시: "Add the following CNAME record to your DNS provider"
   - Type: **CNAME**
   - Name: **api**
   - Value: **cname.vercel-dns.com**

### 3.2. 도메인 등록업체에서 CNAME 추가

aquapado.com 등록업체 (가비아 / 후이즈 / Namecheap / Cloudflare 등) 관리 페이지:
- DNS 설정 → 레코드 추가
- Type: **CNAME**
- Name/Host: **api**
- Value/Target: **cname.vercel-dns.com**
- TTL: 기본값 (300~3600)

> ⚠️ 기존 GitHub Pages 레코드 (root `@`의 A 레코드 또는 `www`의 CNAME)는 건드리지 마세요. `api`만 추가하면 메인 사이트 영향 0.

### 3.3. 검증

```bash
nslookup api.aquapado.com
# → cname.vercel-dns.com 으로 가야 정상
```

DNS 전파 후 (보통 5분~1시간):
```bash
curl -X POST https://api.aquapado.com/priceoverlay/events \
  -H "Content-Type: application/json" \
  -d '{"install_id":"test-uuid-12345678","event_type":"launch","version":"1.0.11"}'
# → {"ok":true}
```

DB에 들어갔는지 확인 — Vercel 대시보드 → Storage → Query 탭:
```sql
SELECT * FROM events ORDER BY ts DESC LIMIT 5;
```

---

## 4. 자주 쓸 분석 SQL 쿼리

Vercel 대시보드 → Storage → DB → **Query** 탭에서 실행.

### DAU (지난 30일)

```sql
SELECT
  to_timestamp(ts/1000)::date AS day,
  COUNT(DISTINCT install_id) AS dau
FROM events
WHERE event_type = 'launch'
  AND ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000
GROUP BY day
ORDER BY day DESC;
```

### MAU (지난 30일 누적 unique users)

```sql
SELECT COUNT(DISTINCT install_id) AS mau
FROM events
WHERE event_type = 'launch'
  AND ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000;
```

### 사용자별 일평균 F2 lookup 수 (지난 7일)

```sql
SELECT AVG(lookups_per_day) AS avg_lookups_per_user_per_day
FROM (
  SELECT install_id,
         to_timestamp(ts/1000)::date AS day,
         COUNT(*) AS lookups_per_day
  FROM events
  WHERE event_type = 'lookup'
    AND ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days') * 1000
  GROUP BY install_id, day
) sub;
```

### 버전별 사용자 분포 (지난 7일 활성)

```sql
SELECT version, COUNT(DISTINCT install_id) AS users
FROM events
WHERE event_type = 'launch'
  AND ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days') * 1000
GROUP BY version
ORDER BY users DESC;
```

### 시간대별 사용 패턴 (한국 시간 KST, UTC+9)

```sql
SELECT
  EXTRACT(HOUR FROM to_timestamp(ts/1000) AT TIME ZONE 'Asia/Seoul') AS hour_kst,
  COUNT(*) AS lookups
FROM events
WHERE event_type = 'lookup'
  AND ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days') * 1000
GROUP BY hour_kst
ORDER BY hour_kst;
```

### 국가별 분포

```sql
SELECT country, COUNT(DISTINCT install_id) AS users
FROM events
WHERE event_type = 'launch'
  AND ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000
GROUP BY country
ORDER BY users DESC;
```

### 신규 vs 재방문 (Cohort — 지난 30일 신규 사용자)

```sql
WITH first_seen AS (
  SELECT install_id, MIN(ts) AS first_ts
  FROM events
  WHERE event_type = 'launch'
  GROUP BY install_id
)
SELECT
  to_timestamp(first_ts/1000)::date AS first_day,
  COUNT(*) AS new_users
FROM first_seen
WHERE first_ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000
GROUP BY first_day
ORDER BY first_day DESC;
```

### 7일 잔존율 (Retention)

```sql
WITH cohort AS (
  SELECT install_id, MIN(to_timestamp(ts/1000)::date) AS first_day
  FROM events WHERE event_type = 'launch'
  GROUP BY install_id
)
SELECT
  c.first_day,
  COUNT(DISTINCT c.install_id) AS cohort_size,
  COUNT(DISTINCT CASE
    WHEN to_timestamp(e.ts/1000)::date BETWEEN c.first_day + 7 AND c.first_day + 8
    THEN c.install_id END) AS day7_retained
FROM cohort c
LEFT JOIN events e ON c.install_id = e.install_id AND e.event_type = 'launch'
WHERE c.first_day > CURRENT_DATE - INTERVAL '30 days'
GROUP BY c.first_day
ORDER BY c.first_day DESC;
```

---

## 5. 운영 / 유지보수

### 데이터 보관 정책 (PIPA 친화 — 90일 자동 삭제)

Vercel은 Cron Jobs를 제공 (Pro 플랜) — 무료 티어에선 다음 옵션:
- **A**: 수동으로 가끔 SQL 실행 (Query 탭에서 한 줄):
  ```sql
  DELETE FROM events WHERE ts < EXTRACT(EPOCH FROM NOW() - INTERVAL '90 days') * 1000;
  ```
- **B**: GitHub Actions에서 매일 한 번 위 SQL 실행 (무료, 5분 셋업)
- **C**: Vercel Cron Jobs (월 ~$20)

500 DAU × 일 10 이벤트 × 90일 = 45만 row → ~50MB. Postgres 무료 한도(256MB) 안 넘어서 보관 정책 안 만들어도 1년+ 버팀.

### Neon Postgres 무료 한도 (Vercel Marketplace 통합)

| 항목 | 한도 | 예상 사용량 (500 DAU, 일 10 lookup) |
|---|---|---|
| Storage | 0.5 GB | 1년 ~50MB (안전) |
| Compute time | 191 시간/월 (50 CU) | 함수가 인서트만 하니 거의 0 |
| Data transfer | 5 GB/월 | 이벤트 100바이트 × 165K = ~16MB |
| Branches | 10 | 1만 사용 |

전부 무료 안에서 여유 있게 들어옴. (한도는 Vercel Marketplace의 Neon Free Plan 기준 — 변경될 수 있음, 가입 시 대시보드에서 최신 값 확인)

### Edge Function 한도

| 항목 | Hobby 무료 | 예상 사용량 |
|---|---|---|
| Invocations | 100K/월 | 165K/월 (살짝 초과 가능 — 사용자 늘면 Pro 검토) |
| Execution duration | 30s/req | 인서트 한 번 ~50ms |

만약 초과되면 Pro ($20/월) 또는 Cloudflare로 이주.

---

## 6. 디버깅

### 함수 로그 보기

Vercel 대시보드 → 프로젝트 → **Logs** 탭
- 실시간 함수 호출 로그, 에러 스택 트레이스 표시

CLI에서:
```bash
vercel logs https://api.aquapado.com --follow
```

### 로컬 테스트

```bash
vercel env pull .env.local   # DB 환경변수 다운로드
vercel dev                    # 로컬에서 함수 실행 (포트 3000)
curl -X POST http://localhost:3000/api/priceoverlay/events \
  -H "Content-Type: application/json" \
  -d '{"install_id":"test12345678","event_type":"launch","version":"1.0.11"}'
```

### 흔한 에러

| 증상 | 원인 | 해결 |
|---|---|---|
| `500 db_insert_failed` | 환경변수 미주입 또는 schema 없음 | DB "Connect to project" 체크 → `vercel --prod` 재배포 → schema SQL 실행 확인 |
| CORS error | OPTIONS 핸들링 X | 위 코드는 이미 처리됨. 다른 메소드면 추가 필요 |
| 404 not_found | 경로 잘못됨 | `api/priceoverlay/events.ts` 파일명/경로 확인 |
| DNS 검증 안 됨 | CNAME 미반영 | 24h 대기 또는 등록업체 측 TTL 확인 |

---

## 7. 스폰서 영업용 대시보드 (옵션)

위 SQL 쿼리를 사람이 보기 좋게 정리한 페이지가 필요하면:

- **간단**: 같은 Vercel 프로젝트에 페이지 라우트 (`/dashboard.html`) + 비공개 key로 보호, fetch로 위 쿼리 결과 표시
- **중간**: Grafana Cloud (무료 티어) — Postgres connector로 직접 차트 그리기
- **풀**: Next.js 페이지 + 차트 라이브러리 (recharts/chart.js) — 1일 작업

영업할 때 보통 SQL 결과 스크린샷 한 장이면 충분합니다.

---

## 부록 A. 앱 측 동작 요약 (참고)

[src/App.tsx](../src/App.tsx) 안의 `reportEvent()`:
- `STATS_ENDPOINT = "https://api.aquapado.com/priceoverlay/events"`
- 사용자가 동의(`tarkov.statsConsent === "true"`)했을 때만 발사
- `install_id` UUID는 첫 실행 시 `crypto.randomUUID()`로 생성, `tarkov.installId`에 저장
- 발사 시점: 앱 launch 1번, F2 lookup 완료 시마다 1번 (성공/실패 무관)
- 실패는 전부 silent (사용자 경험 영향 0)

---

## 부록 B. Cloudflare 이주 옵션 (만약 Vercel 한도 초과 시)

Vercel 무료 한도 (Edge 100K invocations/월) 가까이 가면:
- 옵션 1: Vercel Pro ($20/월)
- 옵션 2: Cloudflare Workers + D1 (10만 요청/일 = 300만/월 무료)

Cloudflare로 옮기려면 Worker 코드 30분 안에 변환 가능 (위 코드는 Web Standard API 기반).
