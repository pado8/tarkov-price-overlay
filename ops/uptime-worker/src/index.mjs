// aquapado 외부 감시 Worker — 매분(cron) 공개 사이트를 찔러 보고, 죽거나 살아나면 ntfy 로 휴대폰 푸시.
//   · 상태는 KV(UPTIME) 키 하나에 저장해 같은 장애로 반복 알림하지 않는다. 2회 연속 실패해야 '다운'(일시 오류 무시).
//     KV 쓰기는 상태가 바뀔 때·30분마다만(무료 한도 하루 1,000회 — check() 위 설명).
//   · GET /  → 현재 상태 JSON (상태 페이지·콘솔에서 읽기용)
//   · 비밀값: NTFY_TOPIC (wrangler secret). 토픽은 휴대폰 ntfy 앱이 구독 중인 것.
// 배포: ops/uptime-worker 에서 `npx wrangler@4 deploy`

const TARGETS = [
  { name: "타르코프 랜딩", url: "https://tarkov.aquapado.com/", expect: "타르코프" },
  { name: "탈콥 가이드", url: "https://tarkov.aquapado.com/guide/", expect: "탈콥" },
  { name: "뚝딱툴즈", url: "https://tools.aquapado.com/", expect: "뚝딱" },
  { name: "PoE Tools", url: "https://poe.aquapado.com/", expect: "PoE" },
  { name: "알파 개미", url: "https://alpha-ants.aquapado.com/", expect: "알파" },
  { name: "아쿠아파도 허브", url: "https://aquapado.com/", expect: "aquapado" },
  { name: "API 헬스", url: "https://api.aquapado.com/priceoverlay/health", expect: "" },
];
const FAILS_TO_ALERT = 2;

async function probe(t) {
  const started = Date.now();
  try {
    const r = await fetch(t.url, { redirect: "follow", signal: AbortSignal.timeout(12000), headers: { "User-Agent": "aquapado-uptime/1.0 (+https://aquapado.com)", "Cache-Control": "no-cache" } });
    const ms = Date.now() - started;
    if (r.status >= 500) return { ok: false, why: `HTTP ${r.status}`, ms };
    if (t.expect) {
      const body = (await r.text()).slice(0, 200000);
      if (!body.includes(t.expect)) return { ok: false, why: `HTTP ${r.status} 인데 본문에 '${t.expect}' 없음(점검 페이지/빈 화면?)`, ms };
    }
    return { ok: true, why: `HTTP ${r.status}`, ms };
  } catch (e) {
    return { ok: false, why: (e && e.name === "TimeoutError") ? "12초 응답 없음" : `연결 실패: ${e && e.message ? e.message : e}`, ms: Date.now() - started };
  }
}

async function notify(env, title, body, tags) {
  if (!env.NTFY_TOPIC) return;
  await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
    method: "POST", body,
    headers: { "Title": title, "Priority": "high", "Tags": tags, "Click": "https://console.aquapado.com/" },
  }).catch(() => {});
}

// KV 무료 한도 = 하루 쓰기 1,000회(읽기 10만). 예전엔 매분 사이트 7곳 + 요약 = 분당 8회(하루 11,520회) 써서
// 매일 오전에 한도 경고 메일이 오고 한도가 차면 감시가 멈췄다(2026-11-04). 이제 상태를 키 하나(STATE_KEY)에 모아
// 분당 1번 읽고, **상태가 바뀔 때(실패 횟수·다운·복구)와 30분 하트비트에만** 쓴다 → 평소 하루 약 48회.
// 매분 결과(응답 ms 등)는 Cache API(무료, KV 아님)에 두고 GET / 가 먼저 읽는다(다른 지역이면 KV 값으로 대체).
const STATE_KEY = "state";
const HEARTBEAT_MS = 30 * 60 * 1000;
const LATEST_URL = "https://aquapado-uptime.internal/latest";

async function check(env) {
  const now = new Date().toISOString();
  const saved = (await env.UPTIME.get(STATE_KEY, { type: "json", cacheTtl: 30 })) || { sites: {}, at: null, results: [] };
  const sites = { ...(saved.sites || {}) };
  let changed = false;
  const results = [];
  for (const t of TARGETS) {
    const r = await probe(t);
    const prev = sites[t.url] || { down: false, fails: 0, since: null };
    const next = { down: prev.down, fails: prev.fails || 0, since: prev.since || null };
    if (r.ok) {
      if (prev.down) await notify(env, `✅ 복구: ${t.name}`, `${t.url}\n${r.why} · ${r.ms}ms · 다운 시작 ${prev.since || "?"}`, "white_check_mark");
      next.down = false; next.fails = 0; next.since = null;
    } else {
      next.fails = Math.min(FAILS_TO_ALERT, next.fails + 1); // 다운 뒤엔 더 세지 않는다 — 장애 중 매분 쓰기 방지
      if (!prev.down && next.fails >= FAILS_TO_ALERT) {
        next.down = true; next.since = now;
        await notify(env, `🔴 다운: ${t.name}`, `${t.url}\n${r.why}\n${FAILS_TO_ALERT}분 연속 실패`, "rotating_light");
      }
    }
    if (next.down !== !!prev.down || next.fails !== (prev.fails || 0) || (next.since || null) !== (prev.since || null)) changed = true;
    sites[t.url] = next;
    results.push({ name: t.name, url: t.url, ok: r.ok, why: r.why, ms: r.ms, down: next.down, since: next.since });
  }
  const stale = !saved.at || Date.now() - Date.parse(saved.at) >= HEARTBEAT_MS;
  if (changed || stale) await env.UPTIME.put(STATE_KEY, JSON.stringify({ sites, at: now, results }));
  try {
    await caches.default.put(LATEST_URL, new Response(JSON.stringify({ at: now, results }), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" } }));
  } catch {}
  return { at: now, results, wrote: changed || stale };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(check(env)); },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/run" && env.RUN_KEY && u.searchParams.get("key") === env.RUN_KEY) {
      return Response.json(await check(env));  // 수동 실행(시험용)
    }
    let s = null;
    try {
      const hit = await caches.default.match(LATEST_URL);
      if (hit) s = await hit.json();
    } catch {}
    if (!s) {
      const st = (await env.UPTIME.get(STATE_KEY, { type: "json", cacheTtl: 60 })) || { at: null, results: [] };
      s = { at: st.at, results: st.results || [] };
    }
    return Response.json(s, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  },
};
