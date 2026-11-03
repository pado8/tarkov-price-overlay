"use client";

// 공통 점검/오류 화면 — ops/maintenance/Maintenance.tsx 가 원본. 각 사이트의 components/ 에 그대로 복사해서 쓴다(의존성 없음).
//   · 점검 스위치(MAINTENANCE=1) → middleware 가 /maintenance 로 rewrite → 이 화면
//   · app/error.tsx / global-error.tsx / not-found.tsx → 같은 화면(kind 로 문구만 다름)
// 외부 리소스 없음. 60초마다 자동 재시도(점검·오류일 때만).

import { useEffect, useState } from "react";

type Kind = "maintenance" | "error" | "notfound";

const NAMES: Record<string, string> = {
  "tarkov.aquapado.com": "타르코프 시세 오버레이 · 탈콥 가이드",
  "tools.aquapado.com": "뚝딱툴즈",
  "poe.aquapado.com": "PoE 3.29 Tools",
  "alpha-ants.aquapado.com": "알파 개미의 포트폴리오",
  "aquapado.com": "아쿠아파도",
};

const COPY: Record<Kind, { title: string; body: string }> = {
  maintenance: { title: "잠시 점검 중입니다", body: "에 일시적인 문제가 있어 바로잡고 있습니다. 데이터는 안전하며, 대개 몇 분 안에 정상으로 돌아옵니다." },
  error: { title: "문제가 생겼습니다", body: "에서 이 화면을 그리는 중 오류가 났습니다. 새로고침하면 대부분 해결되고, 계속되면 잠시 뒤 다시 시도해 주세요." },
  notfound: { title: "페이지를 찾을 수 없습니다", body: "에 이런 주소는 없습니다. 주소가 바뀌었거나 삭제된 페이지일 수 있어요." },
};

export default function Maintenance({ kind = "maintenance", reset }: { kind?: Kind; reset?: () => void }) {
  const [site, setSite] = useState("아쿠아파도");
  const [left, setLeft] = useState(60);
  const retry = kind !== "notfound";

  useEffect(() => {
    setSite(NAMES[location.hostname] || "아쿠아파도");
    if (!retry) return;
    const t = setInterval(() => setLeft((n) => (n <= 1 ? (location.reload(), 60) : n - 1)), 1000);
    return () => clearInterval(t);
  }, [retry]);

  const c = COPY[kind];
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "#0f1115", color: "#e7eaf0", fontFamily: '-apple-system,BlinkMacSystemFont,"Pretendard","Segoe UI","맑은 고딕",system-ui,sans-serif', lineHeight: 1.6 }}>
      <div style={{ width: "100%", maxWidth: 560, background: "#171a21", border: "1px solid #262b36", borderRadius: 18, padding: "34px 30px 26px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.45)" }}>
        <div style={{ fontSize: 54, lineHeight: 1, marginBottom: 10 }} aria-hidden="true">{kind === "notfound" ? "🧭" : "🌊"}</div>
        <h1 style={{ fontSize: 24, margin: "6px 0 4px" }}>{c.title}</h1>
        <p style={{ margin: "8px 0", color: "#9aa3b2", fontSize: 15 }}>
          <b style={{ color: "#00f2ea" }}>{site}</b>{c.body}
        </p>
        {retry ? (
          <div style={{ marginTop: 14, padding: "12px 14px", background: "#0b0d11", border: "1px solid #262b36", borderRadius: 12, fontSize: 14 }}>
            <b style={{ color: "#00f2ea" }}>{left}</b>초 뒤 자동으로 다시 시도합니다
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
          <button type="button" onClick={() => (reset ? reset() : location.reload())} style={{ background: "#00f2ea", color: "#06211f", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
            {kind === "notfound" ? "홈으로" : "지금 다시 시도"}
          </button>
          <a href={kind === "notfound" ? "/" : "https://aquapado.com/"} style={{ background: "transparent", color: "#e7eaf0", border: "1px solid #262b36", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
            {kind === "notfound" ? "다른 사이트 보기" : "다른 사이트 보기"}
          </a>
        </div>
        <div style={{ marginTop: 16, fontSize: 12, color: "#6b7482" }}>운영자 pado · <a href="https://aquapado.com/privacy/" style={{ color: "#9aa3b2" }}>개인정보처리방침</a></div>
      </div>
    </div>
  );
}
