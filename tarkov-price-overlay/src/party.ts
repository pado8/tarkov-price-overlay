// 지도 '파티 방' — 친구끼리 스크린샷 위치 공유(11-05). 중계 = Cloudflare Workers + Durable Objects(ops/party-worker).
// 게임 메모리는 읽지 않는다: 각자 게임에서 스크린샷을 찍을 때(radar.py 가 파일명 좌표를 읽은 순간) 그 위치만 방으로 보낸다.
// 웹소켓은 WebView 에서 바로 연다(사이드카·Rust 변경 없음). 프로토콜은 ops/party-worker/README.md.
import { useCallback, useEffect, useRef, useState } from "react";

export const PARTY_URL = "wss://aquapado-party.aquapado.workers.dev"; // localStorage tarkov.party.url 로 바꿀 수 있다(로컬 시험용)
const K = {
  url: "tarkov.party.url",
  code: "tarkov.party.code",
  name: "tarkov.party.name",
  mid: "tarkov.party.mid",
  at: "tarkov.party.joinedAt", // 마지막으로 방에 있었던 시각 — 6시간 안이면 앱을 다시 켤 때 자동 재참가
  share: "tarkov.party.share",
};
export const PARTY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 헷갈리는 0/O/1/I/L 제외(서버와 같은 집합)
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const REJOIN_MS = 6 * 3600 * 1000;
const PING = '{"t":"ping"}'; // 서버가 글자 그대로 자동 응답(객체를 깨우지 않음)

export type PartyStatus = "off" | "connecting" | "on" | "full" | "error";
export type Friend = {
  mid: string;
  name: string;
  color: string;
  online: boolean;
  map?: string;
  x?: number;
  z?: number;
  yaw?: number; // 라디안
  at?: number; // 그 사람이 스크린샷을 찍은 시각(ms)
  rx?: number; // 내가 받은 시각(ms) — 반짝임용
};

const rand = (n: number) => Array.from({ length: n }, () => PARTY_ALPHABET[Math.floor(Math.random() * PARTY_ALPHABET.length)]).join("");
export const newPartyCode = () => rand(6);
export const normCode = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);
export const validCode = (s: string) => CODE_RE.test(s);
const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};
function memberId(): string {
  let m = get(K.mid);
  if (!m || !/^[A-Za-z0-9_-]{4,40}$/.test(m)) {
    m = "m" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    set(K.mid, m);
  }
  return m;
}
export function defaultPartyName(): string {
  return `Player-${memberId().slice(-4).toUpperCase()}`;
}

type Opts = { onCount?: (key: "pc" | "pj" | "ps" | "pr") => void; onHello?: () => void };

export function useParty({ onCount, onHello }: Opts = {}) {
  const [code, setCode] = useState<string | null>(null);
  const [name, setNameState] = useState<string>(() => get(K.name) || "");
  const [share, setShareState] = useState<boolean>(() => get(K.share) !== "0");
  const [status, setStatus] = useState<PartyStatus>("off");
  const [me, setMe] = useState<{ mid: string; color: string } | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const codeRef = useRef<string | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number>(0);
  const pingRef = useRef<number>(0);
  const cbRef = useRef({ onCount, onHello });
  cbRef.current = { onCount, onHello };
  const nameRef = useRef(name);
  nameRef.current = name;

  const stopSocket = () => {
    window.clearTimeout(timerRef.current);
    window.clearInterval(pingRef.current);
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try {
        ws.close(1000);
      } catch {}
    }
  };

  const connect = useCallback((c: string) => {
    stopSocket();
    codeRef.current = c;
    setStatus("connecting");
    const base = (get(K.url) || PARTY_URL).replace(/\/$/, "");
    const nm = (nameRef.current || "").trim() || defaultPartyName();
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${base}/room/${c}?name=${encodeURIComponent(nm)}&mid=${encodeURIComponent(memberId())}`);
    } catch {
      setStatus("error");
      return;
    }
    wsRef.current = ws;
    let full = false;
    ws.onopen = () => {
      retryRef.current = 0;
      window.clearInterval(pingRef.current);
      pingRef.current = window.setInterval(() => {
        try {
          ws.send(PING);
        } catch {}
      }, 30000);
    };
    ws.onmessage = (e) => {
      let d: any;
      try {
        d = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!d || typeof d !== "object") return;
      if (d.t === "hello") {
        setStatus("on");
        setMe(d.you ?? null);
        set(K.at, String(Date.now()));
        setFriends(
          (Array.isArray(d.members) ? d.members : []).map((m: any) => ({
            mid: String(m.mid),
            name: String(m.name),
            color: String(m.color),
            online: true,
            ...(m.last ? { map: m.last.map, x: m.last.x, z: m.last.z, yaw: m.last.yaw, at: m.last.at } : {}),
          })),
        );
        cbRef.current.onHello?.();
      } else if (d.t === "join") {
        setFriends((F) => [...F.filter((f) => f.mid !== d.mid), { mid: String(d.mid), name: String(d.name), color: String(d.color), online: true, ...(F.find((f) => f.mid === d.mid) ? pickPos(F.find((f) => f.mid === d.mid)!) : {}) }]);
      } else if (d.t === "leave") {
        setFriends((F) => F.map((f) => (f.mid === d.mid ? { ...f, online: false } : f)));
      } else if (d.t === "pos") {
        if (![d.x, d.z, d.yaw, d.at].every((v) => typeof v === "number" && Number.isFinite(v)) || typeof d.map !== "string") return;
        cbRef.current.onCount?.("pr");
        set(K.at, String(Date.now()));
        setFriends((F) => {
          const rest = F.filter((f) => f.mid !== d.mid);
          return [...rest, { mid: String(d.mid), name: String(d.name), color: String(d.color), online: true, map: d.map, x: d.x, z: d.z, yaw: d.yaw, at: d.at, rx: Date.now() }];
        });
      } else if (d.t === "full") {
        full = true;
        setStatus("full");
      }
    };
    ws.onclose = () => {
      window.clearInterval(pingRef.current);
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (full || codeRef.current !== c) {
        if (full) {
          codeRef.current = null;
          setCode(null);
          set(K.code, null);
        }
        return;
      }
      // 끊김 → 2·4·8…최대 30초 간격으로 다시 접속(방 코드는 그대로)
      setStatus("connecting");
      const wait = Math.min(30000, 2000 * 2 ** retryRef.current);
      retryRef.current = Math.min(retryRef.current + 1, 5);
      timerRef.current = window.setTimeout(() => {
        if (codeRef.current === c) connect(c);
      }, wait);
    };
    ws.onerror = () => {};
  }, []);

  const join = useCallback(
    (raw: string, created = false) => {
      const c = normCode(raw);
      if (!validCode(c)) return false;
      setCode(c);
      set(K.code, c);
      set(K.at, String(Date.now()));
      setFriends([]);
      cbRef.current.onCount?.(created ? "pc" : "pj");
      retryRef.current = 0;
      connect(c);
      return true;
    },
    [connect],
  );
  const create = useCallback(() => join(newPartyCode(), true), [join]);
  const leave = useCallback(() => {
    codeRef.current = null;
    stopSocket();
    setCode(null);
    setStatus("off");
    setMe(null);
    setFriends([]);
    set(K.code, null);
    set(K.at, null);
  }, []);

  /** 새 스크린샷 위치 — 방에 있고 공유가 켜져 있을 때만. yaw = 라디안 */
  const sendPos = useCallback(
    (map: string, x: number, z: number, yaw: number, at: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !share) return false;
      if (![x, z, yaw, at].every(Number.isFinite) || !map) return false;
      try {
        ws.send(JSON.stringify({ t: "pos", map: map.slice(0, 40), x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(yaw * 1000) / 1000, at: Math.round(at) }));
        cbRef.current.onCount?.("ps");
        return true;
      } catch {
        return false;
      }
    },
    [share],
  );

  const setName = useCallback((v: string) => {
    const t = [...v.replace(/[\u0000-\u001f\u007f]/g, "")].slice(0, 16).join("");
    setNameState(t);
    set(K.name, t);
  }, []);
  const setShare = useCallback((v: boolean) => {
    setShareState(v);
    set(K.share, v ? "1" : "0");
  }, []);

  // 앱을 다시 켤 때: 6시간 안에 있던 방이면 자동 재참가
  useEffect(() => {
    const c = get(K.code);
    const at = Number(get(K.at) || 0);
    if (c && validCode(c) && Date.now() - at < REJOIN_MS) {
      setCode(c);
      connect(c);
    } else if (c) {
      set(K.code, null);
    }
    return () => {
      codeRef.current = null;
      stopSocket();
    };
  }, [connect]);

  return { code, name, setName, share, setShare, status, me, friends, create, join, leave, sendPos };
}

function pickPos(f: Friend): Partial<Friend> {
  return f.map != null ? { map: f.map, x: f.x, z: f.z, yaw: f.yaw, at: f.at } : {};
}
