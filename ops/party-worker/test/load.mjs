// 파티 방 부하 시험 — 5명이 동시에 1초마다 위치 전송(30초) + 한 명이 초당 20개 폭주(10초).
//   node test/load.mjs https://aquapado-party.aquapado.workers.dev
// 비용: 수신 메시지 ≈ 5×30 + 200 + 핑 ≈ 360개(20개=요청 1건 → 약 18건) + 접속 6건. 무료 하루 10만 건의 0.03%.
const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "").replace(/^http/, "ws");
const ALPH = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const room = Array.from({ length: 6 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const join = (name, mid) =>
  new Promise((res) => {
    const ws = new WebSocket(`${BASE}/room/${room}?name=${name}&mid=${mid}`);
    const c = { ws, mid, got: [], lat: [] };
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      c.got.push(d);
      if (d.t === "pos" && typeof d.sent === "undefined") c.lat.push(Date.now() - d.at); // at = 보낸 시각(이 시험에선 전송 시각)
    };
    ws.onclose = (e) => (c.closed = e.code);
    ws.onopen = () => res(c);
  });
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);

console.log(`방 ${room} @ ${BASE}`);
const M = [];
for (let i = 0; i < 5; i++) M.push(await join(`P${i}`, `midLOAD000${i}`));
await sleep(800);

// 1) 5명 동시 — 각자 1초마다(같은 순간에 몰리게 지터 0~50ms) 30초
const T = 30;
const sent = new Map(M.map((c) => [c.mid, 0]));
// 앱(src/party.ts)과 같은 방식: 마지막 전송 1.1초 안이면 모아 두었다가 최신 것만 보낸다
for (const c of M) { c.last = 0; c.pend = null; c.timer = 0; }
const flush = (c) => { c.timer = 0; if (!c.pend) return; c.ws.send(c.pend); c.pend = null; c.last = Date.now(); sent.set(c.mid, sent.get(c.mid) + 1); };
const appSend = (c, s) => {
  c.pend = JSON.stringify({ t: "pos", map: "customs", x: s, z: -s, yaw: 1, at: Date.now() });
  const wait = c.last + 1100 - Date.now();
  if (wait <= 0) flush(c);
  else if (!c.timer) c.timer = setTimeout(() => flush(c), wait);
};
for (let s = 0; s < T; s++) {
  for (const c of M) setTimeout(() => appSend(c, s), Math.random() * 50);
  await sleep(1020); // 새 위치가 1초마다 생김(서버 제한 경계)
}
await sleep(2500);
console.log("\n[1] 5명 동시 전송(1초마다 30초)");
for (const c of M) {
  const from = {};
  for (const m of c.got.filter((m) => m.t === "pos")) from[m.mid] = (from[m.mid] ?? 0) + 1;
  const others = M.filter((o) => o !== c).map((o) => from[o.mid] ?? 0);
  const lastX = M.filter((o) => o !== c).map((o) => Math.max(...c.got.filter((m) => m.t === "pos" && m.mid === o.mid).map((m) => m.x)));
  console.log(`  ${c.mid}: 다른 4명에게서 받음 ${others.join("/")} (보낸 수 ${M.filter((o) => o !== c).map((o) => sent.get(o.mid)).join("/")}) · 마지막 위치 x=${lastX.join("/")}(최신=${T - 1}) · 자기 것 ${from[c.mid] ?? 0}개 · 지연 p50 ${pct(c.lat, 0.5)}ms p95 ${pct(c.lat, 0.95)}ms`);
}
const all = M.flatMap((c) => c.lat);
const recvTotal = M.reduce((n, c) => n + c.got.filter((m) => m.t === "pos").length, 0);
const sentTotal = [...sent.values()].reduce((a, b) => a + b, 0);
console.log(`  합계: 받음 ${recvTotal}/${sentTotal * 4}(보낸 것×4) · 버려짐 ${sentTotal * 4 - recvTotal} · 전체 지연 p50 ${pct(all, 0.5)}ms · p95 ${pct(all, 0.95)}ms · 최대 ${Math.max(...all)}ms`);

// 2) 한 명 폭주 — 초당 20개 10초(200개). 나머지 4명이 받는 건 초당 1개로 깎여야 한다
for (const c of M) c.got.length = 0;
const F = M[0];
const t0 = Date.now();
for (let i = 0; i < 200; i++) {
  F.ws.send(JSON.stringify({ t: "pos", map: "customs", x: i, z: i, yaw: 0, at: Date.now() }));
  await sleep(50);
}
await sleep(1500);
const dur = (Date.now() - t0) / 1000;
console.log(`\n[2] 한 명이 초당 20개 폭주(${dur.toFixed(1)}초, 200개)`);
for (const c of M.slice(1)) {
  const n = c.got.filter((m) => m.t === "pos" && m.mid === F.mid).length;
  console.log(`  ${c.mid}: 폭주자 것 ${n}개 받음(초당 1개면 ≈${Math.round(dur)}개)`);
}
// 폭주 중에도 다른 사람 위치는 정상인지
const P1 = M[1];
for (const c of M) c.got.length = 0;
P1.ws.send(JSON.stringify({ t: "pos", map: "customs", x: 999, z: 999, yaw: 0, at: Date.now() }));
await sleep(800);
console.log(`  폭주 직후 다른 사람 위치: ${M.filter((c) => c !== P1 && c !== F).every((c) => c.got.some((m) => m.t === "pos" && m.x === 999)) ? "남은 3명 모두 받음" : "일부 못 받음"}`);
console.log(`  폭주자 연결: ${F.ws.readyState === 1 ? "열림" : "끊김(코드 " + F.closed + ")"} · 받은 slow 알림 ${F.got.filter((m) => m.t === "slow").length}`);
for (const c of M) c.ws.close(1000);
await sleep(300);
process.exit(0);
