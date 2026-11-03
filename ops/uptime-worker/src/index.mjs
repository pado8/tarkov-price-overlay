// aquapado 외부 감시 Worker — 매분(cron) 공개 사이트를 찔러 보고, 죽거나 살아나면 ntfy 로 휴대폰 푸시.
//   · 상태는 KV(UPTIME)에 저장해 같은 장애로 반복 알림하지 않는다. 2회 연속 실패해야 '다운'(일시 오류 무시).
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

async function check(env) {
  const now = new Date().toISOString();
  const results = [];
  for (const t of TARGETS) {
    const r = await probe(t);
    const key = `s:${t.url}`;
    const prev = (await env.UPTIME.get(key, "json")) || { down: false, fails: 0 };
    let next = { ...prev, last: now, why: r.why, ms: r.ms };
    if (r.ok) {
      if (prev.down) await notify(env, `✅ 복구: ${t.name}`, `${t.url}\n${r.why} · ${r.ms}ms · 다운 시작 ${prev.since || "?"}`, "white_check_mark");
      next = { ...next, down: false, fails: 0, since: null };
    } else {
      next.fails = (prev.fails || 0) + 1;
      if (!prev.down && next.fails >= FAILS_TO_ALERT) {
        next.down = true; next.since = now;
        await notify(env, `🔴 다운: ${t.name}`, `${t.url}\n${r.why}\n${FAILS_TO_ALERT}분 연속 실패`, "rotating_light");
      }
    }
    await env.UPTIME.put(key, JSON.stringify(next));
    results.push({ name: t.name, url: t.url, ok: r.ok, why: r.why, ms: r.ms, down: next.down, since: next.since || null });
  }
  await env.UPTIME.put("summary", JSON.stringify({ at: now, results }));
  return results;
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(check(env)); },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/run" && env.RUN_KEY && u.searchParams.get("key") === env.RUN_KEY) {
      return Response.json(await check(env));  // 수동 실행(시험용)
    }
    const s = (await env.UPTIME.get("summary", "json")) || { at: null, results: [] };
    return Response.json(s, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  },
};
