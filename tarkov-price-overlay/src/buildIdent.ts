// 11-23 공식 빌드 확인 표식(bp) — 서버 기능(파티·지도 자료·백업·사이트 연동)에 '공식 빌드에서 왔다'는 짧은 값을 붙인다.
// 계산은 Rust build_proof(키는 Rust 에만 있고 웹뷰로 넘기지 않음). 키 없이 빌드한 판은 빈 값. 같은 값·같은 UTC 날짜면 다시 계산하지 않는다.
import { invoke } from "@tauri-apps/api/core";

const cache = new Map<string, { day: string; v: string }>();

export async function buildProofFor(id: string): Promise<string> {
  if (!id) return "";
  const day = new Date().toISOString().slice(0, 10);
  const c = cache.get(id);
  if (c && c.day === day) return c.v;
  let v = "";
  try {
    const r = await invoke<string>("build_proof", { installId: id });
    if (typeof r === "string") v = r;
  } catch {}
  cache.set(id, { day, v });
  return v;
}

// 파티 방 입장 주소에 붙일 값(&iid=&ver=&bp=). 웹소켓은 동기로 만들므로 App 이 미리 채워 둔다(시작 때·30분마다).
let partyIdent = "";
export function setPartyIdent(iid: string, ver: string, bp: string): void {
  partyIdent = `&iid=${encodeURIComponent(iid)}&ver=${encodeURIComponent(ver)}&bp=${encodeURIComponent(bp)}`;
}
export const partyIdentQuery = (): string => partyIdent;
