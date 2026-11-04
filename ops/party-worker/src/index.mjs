// aquapado-party — 탈콥 시세 오버레이 지도 '파티 방'(친구 위치 공유) 중계.
//
// GET  /                         → {ok:true, rooms:"memory-only"}
// GET  /room/<CODE>?name=&mid=   → 웹소켓(Upgrade 필수). CODE = 6자, 23456789ABCDEFGHJKMNPQRSTUVWXYZ
//
// 방 코드 하나 = Durable Object 하나(PartyRoom, idFromName(code)). 웹소켓 Hibernation API 를 써서 조용할 땐 과금 시간이 안 든다.
// 위치는 각 소켓의 serializeAttachment 에만 둔다 — 저장소(storage)·DB 에 쓰지 않으므로 모두 나가면 방이 사라진다.
// Origin 검사는 하지 않는다(Tauri WebView 출처가 환경마다 다름) — 방 코드가 곧 비밀이다. 프로토콜은 README.md.
import { DurableObject } from "cloudflare:workers";

const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const MAX_MEMBERS = 5; // EFT 파티 최대 인원
const MAX_MSG = 1024; // 이보다 긴 메시지는 무시
const POS_MIN_MS = 1000; // 멤버당 위치는 초당 1개
const PALETTE = ["#4fc3f7", "#ffb74d", "#ba68c8", "#81c784", "#f06292"]; // 하늘·주황·보라·초록·분홍(내 위치 초록 화살표와 겹치지 않게 초록은 4번째)
const PING = '{"t":"ping"}';
const PONG = '{"t":"pong"}';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function cleanName(s) {
  const t = String(s || "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  return [...t].slice(0, 16).join("") || "Player";
}
function cleanMid(s) {
  const t = String(s || "");
  return /^[A-Za-z0-9_-]{4,40}$/.test(t) ? t : "m" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
const finite = (v) => typeof v === "number" && Number.isFinite(v);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "") return json({ ok: true, rooms: "memory-only" });
    const m = url.pathname.match(/^\/room\/([^/]+)\/?$/);
    if (!m) return json({ ok: false, error: "not found" }, 404);
    const code = decodeURIComponent(m[1]);
    if (!CODE_RE.test(code)) return json({ ok: false, error: "bad code" }, 400);
    if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ ok: false, error: "websocket only" }, 426);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(req);
  },
};

export class PartyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // 앱의 30초 핑은 객체를 깨우지 않고 런타임이 바로 답한다(과금·깨움 없음)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  /** 지금 열린 멤버 소켓 [{ws, a}] — 닫히는 중이거나 첨부가 없는 것은 뺀다 */
  members(except) {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      const a = ws.deserializeAttachment();
      if (a && a.id) out.push({ ws, a });
    }
    return out;
  }

  send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const { ws } of this.members(except)) {
      try {
        ws.send(s);
      } catch {}
    }
  }

  async fetch(req) {
    const url = new URL(req.url);
    const name = cleanName(url.searchParams.get("name"));
    const mid = cleanMid(url.searchParams.get("mid"));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 같은 멤버 ID 로 다시 들어오면(재접속) 옛 소켓을 닫고 자리를 넘긴다 — 색도 그대로
    let keepColor = null;
    for (const { ws, a } of this.members()) {
      if (a.id === mid) {
        keepColor = a.color;
        a.replaced = true;
        try {
          ws.serializeAttachment(a);
          ws.close(4000, "replaced");
        } catch {}
      }
    }
    const others = this.members().filter(({ a }) => a.id !== mid);
    if (others.length >= MAX_MEMBERS) {
      // 거절은 Hibernation 없이 받아서 알리고 닫는다(getWebSockets 에 안 잡히게)
      server.accept();
      server.send(JSON.stringify({ t: "full", max: MAX_MEMBERS }));
      server.close(4001, "full");
      return new Response(null, { status: 101, webSocket: client });
    }
    const used = new Set(others.map(({ a }) => a.color));
    const color = keepColor && !used.has(keepColor) ? keepColor : PALETTE.find((c) => !used.has(c)) || PALETTE[others.length % PALETTE.length];
    const att = { id: mid, name, color, last: null };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(att);
    this.send(server, {
      t: "hello",
      you: { mid, color },
      members: others.map(({ a }) => ({ mid: a.id, name: a.name, color: a.color, last: a.last })),
    });
    this.broadcast({ t: "join", mid, name, color }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== "string" || msg.length > MAX_MSG) return;
    let d;
    try {
      d = JSON.parse(msg);
    } catch {
      return;
    }
    if (!d || typeof d !== "object") return;
    if (d.t === "ping") return this.send(ws, { t: "pong" }); // 자동 응답과 글자가 조금 다를 때(공백 등)
    if (d.t !== "pos") return;
    const a = ws.deserializeAttachment();
    if (!a || !a.id) return;
    const map = typeof d.map === "string" ? d.map.trim() : "";
    if (!map || map.length > 40 || /[\u0000-\u001f]/.test(map)) return;
    if (![d.x, d.z, d.yaw, d.at].every(finite)) return;
    if (Math.abs(d.x) > 1e5 || Math.abs(d.z) > 1e5 || Math.abs(d.yaw) > 100) return;
    const now = Date.now();
    if (a.last && now - a.last.ts < POS_MIN_MS) return; // 초당 1개 넘으면 버림
    a.last = { map, x: d.x, z: d.z, yaw: d.yaw, at: d.at, ts: now };
    ws.serializeAttachment(a);
    this.broadcast({ t: "pos", mid: a.id, name: a.name, color: a.color, map, x: d.x, z: d.z, yaw: d.yaw, at: d.at }, ws);
  }

  async webSocketClose(ws, code) {
    this.leave(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {}
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const a = ws.deserializeAttachment();
    if (!a || !a.id || a.replaced || a.left) return; // 재접속으로 밀려난 소켓은 '나감'을 알리지 않는다
    a.left = true;
    try {
      ws.serializeAttachment(a);
    } catch {}
    if (this.members(ws).some(({ a: b }) => b.id === a.id)) return;
    this.broadcast({ t: "leave", mid: a.id }, ws);
  }
}
