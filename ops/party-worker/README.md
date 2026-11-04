# aquapado-party — 지도 "파티 방" 중계 (Cloudflare Workers + Durable Objects)

탈콥 시세 오버레이 지도에서 친구끼리 위치를 보는 기능의 중계 서버. 2026-11-05 첫 배포.

- 주소: `https://aquapado-party.aquapado.workers.dev` (웹소켓 `wss://…/room/<CODE>`)
- 배포: 이 폴더에서 `npx wrangler@4 deploy` · 로컬: `npx wrangler@4 dev --port 8787 --ip 127.0.0.1`
- 시험: `node test/sim.mjs <주소>` — 2~6명 시뮬레이션 30항목(로컬·운영 모두 30/30, 2026-11-05)
- 앱 쪽: `tarkov-price-overlay/src/party.ts`(연결·재접속·전송) · `Radar.tsx`(파티 패널) · `RadarMap.tsx`(친구 점)

## 왜 여기(Vercel 아님)

api.aquapado.com(Vercel Hobby)은 Fluid Active CPU 월 4시간 한도가 이미 63%라 웹소켓 중계를 붙이지 않는다.
Neon 도 쓰지 않는다(타르코프 통계 전용).

## 위치는 어디서 오나

게임 메모리는 읽지 않는다. 각자 게임에서 스크린샷 키를 누르면 EFT 가 파일명에 좌표·방향을 넣고, 앱 사이드카(radar.py)가 그 파일명을 읽는다.
앱은 그 순간의 위치만 방에 보낸다 → **실시간이 아니라 스크린샷을 찍을 때만** 갱신. 앱이 대신 스크린샷 키를 누르는 일(입력 주입)은 안티치트 위험이라 하지 않는다.

## 구조

- 방 코드 하나 = Durable Object `PartyRoom` 하나(`idFromName(code)`). 방 만들기 API 는 없다 — 앱이 코드를 무작위로 만들어 바로 접속.
- 웹소켓 Hibernation API(`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`, `getWebSockets`). 조용하면 객체가 잠들어 시간 과금이 안 든다.
- **저장소(storage)를 쓰지 않는다.** 각 소켓의 `serializeAttachment` 에 `{id, name, color, last}` 만 둔다 → 모두 나가면 방이 사라진다. 위치를 디스크·DB 에 남기지 않는다.
- 핑 `{"t":"ping"}` 은 `setWebSocketAutoResponse` 로 런타임이 바로 `{"t":"pong"}` 을 돌려준다(객체를 안 깨움).
- Origin 검사는 하지 않는다(Tauri WebView 출처가 환경마다 다름) — 방 코드가 곧 비밀.

## 프로토콜

접속: `GET wss://aquapado-party.aquapado.workers.dev/room/<CODE>?name=<닉네임>&mid=<멤버ID>`

- CODE = 6자, 문자 집합 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`(0/O/1/I/L 제외). 형식이 틀리면 HTTP 400, 웹소켓이 아니면 426.
- 닉네임: 제어문자·보이지 않는 문자 제거, 16자. 비면 `Player`. 멤버 ID: `[A-Za-z0-9_-]{4,40}`, 아니면 서버가 무작위 배정.
- 같은 멤버 ID 로 다시 들어오면(재접속) 옛 소켓을 닫고 자리·색을 넘긴다(다른 멤버에게 leave 안 감).
- 방당 최대 5명(EFT 파티 최대). 6번째는 `{t:"full", max:5}` 후 종료(코드 4001).

| 방향 | 메시지 |
|---|---|
| 앱→서버 | `{t:"pos", map, x, z, yaw, at}` — map ≤40자, 숫자는 유한값(\|x\|,\|z\| ≤ 1e5), yaw 라디안, at = 스크린샷 시각(ms) |
| 서버→다른 멤버 | `{t:"pos", mid, name, color, map, x, z, yaw, at}` (보낸 사람에게는 안 감) |
| 서버→새 멤버 | `{t:"hello", you:{mid,color}, members:[{mid,name,color,last}]}` (last = 마지막 위치 또는 null) |
| 서버→다른 멤버 | `{t:"join", mid, name, color}` · 나가면 `{t:"leave", mid}` |
| 앱↔서버 | 30초마다 `{"t":"ping"}` → `{"t":"pong"}` |

방어: 1KB 초과·JSON 아님·잘못된 숫자/맵은 무시, 멤버당 pos 초당 1개(넘으면 버림), 색은 서버가 5색 팔레트에서 배정.

## 한도 (Cloudflare 공식 문서, 2026-11-05 확인 — developers.cloudflare.com/durable-objects/platform/pricing/)

- **Workers Free 에서 Durable Objects 사용 가능 — SQLite 백엔드만**(그래서 `new_sqlite_classes`). 결제 수단 없이 배포됨.
- 무료 일일 한도: 요청 100,000 · Duration 13,000 GB-s · 행 읽기 500만 · 행 쓰기 10만 · 저장 5GB(총). 00:00 UTC 초기화.
- 웹소켓: 연결 1번 = 요청 1건, **수신 메시지는 20개 = 요청 1건**(송신·프로토콜 핑은 무과금). Hibernation 은 Duration 을 줄인다.
- 한도를 넘으면 그날은 해당 작업이 오류로 실패 → 앱은 '연결할 수 없어요'/재접속 반복. 대략 계산: 스크린샷 1장 = 수신 1개(=0.05건),
  앱 핑은 자동 응답이라 객체를 깨우지 않음 → 하루 10만 건이면 접속 수만 번 수준이라 현재 규모(지도 사용자 90명)에서 여유.

## 계측

서버는 아무것도 남기지 않는다. 앱의 하루 요약(daily) 누적기에 `pc`(방 만들기)·`pj`(참가)·`ps`(위치 전송)·`pr`(수신) 횟수만 더한다.
