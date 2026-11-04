// 파티 방 시뮬레이션 — Node 22+ 내장 WebSocket 으로 2~6명을 흉내 내 프로토콜을 확인한다.
//   node test/sim.mjs http://127.0.0.1:8787          (wrangler dev)
//   node test/sim.mjs https://aquapado-party.aquapado.workers.dev
const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const WS = BASE.replace(/^http/, "ws");
const ALPH = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const code = () => Array.from({ length: 6 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"}  ${name}${detail ? "  — " + detail : ""}`);
};

function join(room, name, mid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/room/${room}?name=${encodeURIComponent(name)}&mid=${encodeURIComponent(mid)}`);
    const c = { ws, name, mid, got: [], closed: null };
    ws.onmessage = (e) => {
      try {
        c.got.push(JSON.parse(e.data));
      } catch {
        c.got.push({ raw: e.data });
      }
    };
    ws.onclose = (e) => (c.closed = { code: e.code, reason: e.reason });
    ws.onopen = () => resolve(c);
    ws.onerror = () => resolve(c);
  });
}
const of = (c, t) => c.got.filter((m) => m.t === t);
const send = (c, o) => c.ws.send(typeof o === "string" ? o : JSON.stringify(o));
const pos = (x) => ({ t: "pos", map: "customs_preset", x, z: -x, yaw: 1.25, at: Date.now() });

const room = code();
console.log(`방 ${room} @ ${BASE}`);

// 0) 상태·잘못된 코드
{
  const r = await fetch(`${BASE}/`);
  const j = await r.json().catch(() => null);
  check("GET / 상태 응답", r.status === 200 && j?.ok === true && j?.rooms === "memory-only", JSON.stringify(j));
  for (const bad of ["ABC12", "ABCDE0", "abcdef", "ABCDEFG", "ABCDE%21"]) {
    const rr = await fetch(`${BASE}/room/${bad}`); // 코드 검사가 웹소켓 검사보다 먼저(Node fetch 는 Upgrade 헤더를 못 붙인다)
    check(`잘못된 코드 ${bad} → 400`, rr.status === 400, String(rr.status));
  }
  const nu = await fetch(`${BASE}/room/${room}`);
  check("웹소켓 아닌 요청 → 426", nu.status === 426, String(nu.status));
}

// 1) 입장·hello·join
const A = await join(room, "알파\u0007\u200bAAAAAAAAAAAAAAAAAAAA", "midAAAA01");
await sleep(400);
const hA = of(A, "hello")[0];
check("A hello(멤버 0)", !!hA && hA.members.length === 0 && hA.you.mid === "midAAAA01" && /^#/.test(hA.you.color), JSON.stringify(hA));
const B = await join(room, "Bravo", "midBBBB02");
await sleep(400);
const hB = of(B, "hello")[0];
check("B hello(멤버 A 1명)", !!hB && hB.members.length === 1 && hB.members[0].mid === "midAAAA01", JSON.stringify(hB?.members));
const nameA = hB?.members[0]?.name || "";
check("이름 정리(제어문자 제거·16자)", [...nameA].length === 16 && !/[\u0000-\u001f\u200b]/.test(nameA), JSON.stringify(nameA));
const jA = of(A, "join");
check("A 가 B join 받음", jA.length === 1 && jA[0].mid === "midBBBB02" && jA[0].name === "Bravo", JSON.stringify(jA));
check("A·B 색이 다름", hA && hB && hA.you.color !== hB.you.color, `${hA?.you.color} / ${hB?.you.color}`);

// 2) pos 브로드캐스트·자기 제외·초당 1개
send(A, pos(10));
await sleep(500);
const pB = of(B, "pos");
check("B 가 A 위치 받음", pB.length === 1 && pB[0].mid === "midAAAA01" && pB[0].x === 10 && pB[0].map === "customs_preset" && pB[0].color === hA?.you.color, JSON.stringify(pB[0]));
check("A 는 자기 위치를 안 받음", of(A, "pos").length === 0);
send(A, pos(11)); // 1초 안 → 버림
await sleep(300);
check("초당 1개 제한(1초 안 두 번째 버림)", of(B, "pos").length === 1, `B 수신 ${of(B, "pos").length}`);
await sleep(900);
send(A, pos(12));
await sleep(500);
check("1초 뒤 다음 위치는 전달", of(B, "pos").length === 2 && of(B, "pos")[1].x === 12, `B 수신 ${of(B, "pos").length}`);

// 3) 잘못된 메시지 무시
await sleep(1100);
const before = of(B, "pos").length;
send(A, { t: "pos", map: "customs", x: "abc", z: 1, yaw: 0, at: 1 });
send(A, { t: "pos", map: "customs", x: null, z: 1, yaw: 0, at: 1 }); // JSON 의 Infinity/NaN = null
send(A, { t: "pos", map: "", x: 1, z: 1, yaw: 0, at: 1 });
send(A, { t: "pos", map: "x".repeat(41), x: 1, z: 1, yaw: 0, at: 1 });
send(A, "{not json");
send(A, JSON.stringify({ t: "pos", map: "customs", x: 1, z: 1, yaw: 0, at: 1, pad: "x".repeat(1100) }));
await sleep(600);
check("잘못된 숫자·맵·JSON·1KB 초과 무시", of(B, "pos").length === before, `B 수신 ${of(B, "pos").length - before}개 추가`);

// 4) 핑
send(A, '{"t":"ping"}');
send(A, '{ "t": "ping" }');
await sleep(500);
check("핑 → 퐁(자동 응답 + 일반 응답)", of(A, "pong").length === 2, `퐁 ${of(A, "pong").length}`);

// 5) 5명까지, 6번째 거절
const C = await join(room, "Charlie", "midCCCC03");
const D = await join(room, "Delta", "midDDDD04");
const E = await join(room, "Echo", "midEEEE05");
await sleep(500);
check("5명 입장(E hello 멤버 4명)", of(E, "hello")[0]?.members.length === 4, String(of(E, "hello")[0]?.members.length));
const colors = new Set([hA, hB, of(C, "hello")[0], of(D, "hello")[0], of(E, "hello")[0]].map((h) => h?.you.color));
check("5명 색이 모두 다름", colors.size === 5, [...colors].join(","));
const F = await join(room, "Foxtrot", "midFFFF06");
await sleep(800);
check("6번째 거절 {t:full} + 종료", of(F, "full").length === 1 && F.closed !== null && of(F, "hello").length === 0, JSON.stringify({ got: F.got, closed: F.closed }));
check("6번째는 다른 멤버에게 join 안 감", of(A, "join").every((j) => j.mid !== "midFFFF06"));

// 6) 재접속(같은 mid) — leave 없음·색 유지
const colorB = hB?.you.color;
const B2 = await join(room, "Bravo", "midBBBB02");
await sleep(800);
check("재접속: 새 소켓 hello·같은 색", of(B2, "hello")[0]?.you.color === colorB, `${of(B2, "hello")[0]?.you.color} / ${colorB}`);
check("재접속: 옛 소켓은 닫힘(닫는 중 포함)", B.closed !== null || B.ws.readyState >= 2, JSON.stringify(B.closed) + " readyState=" + B.ws.readyState);
check("재접속: 다른 멤버에게 leave 안 감", of(A, "leave").every((l) => l.mid !== "midBBBB02"), JSON.stringify(of(A, "leave")));
check("재접속: 멤버 수 그대로(5명이라 거절 안 됨)", of(B2, "full").length === 0 && of(B2, "hello")[0]?.members.length === 4, String(of(B2, "hello")[0]?.members.length));

// 7) 나가기 → leave
C.ws.close(1000);
await sleep(800);
check("나가면 다른 멤버에게 leave", of(A, "leave").some((l) => l.mid === "midCCCC03") && of(E, "leave").some((l) => l.mid === "midCCCC03"), JSON.stringify(of(A, "leave")));
const G = await join(room, "Golf", "midGGGG07");
await sleep(500);
check("한 명 나간 뒤 새 멤버 입장 가능", of(G, "hello").length === 1 && of(G, "full").length === 0);
check("새 멤버 hello 에 마지막 위치(last) 포함", of(G, "hello")[0]?.members.find((m) => m.mid === "midAAAA01")?.last?.x === 12, JSON.stringify(of(G, "hello")[0]?.members.find((m) => m.mid === "midAAAA01")?.last));

for (const c of [A, B2, D, E, G]) c.ws.close(1000);
await sleep(500);
// 8) 모두 나간 뒤 같은 방 = 빈 방
const H = await join(room, "Hotel", "midHHHH08");
await sleep(500);
check("모두 나가면 방이 비어 있음(새 hello 멤버 0)", of(H, "hello")[0]?.members.length === 0, String(of(H, "hello")[0]?.members.length));
H.ws.close(1000);
await sleep(200);

const fail = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - fail.length}/${results.length} 통과`);
process.exit(fail.length ? 1 : 0);
