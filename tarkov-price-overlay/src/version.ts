// 버전 비교(업데이트·최소 버전) — "1.2.10" vs "1.2.9" 같은 숫자 비교 + 미리보기 꼬리("-rc2"). 음수 = a 가 낮음.
// 11-12 QA: 예전엔 점으로만 나눠 parseInt("2-rc1") = 2 → 1.3.2-rc1 과 1.3.2-rc2 를 같다고 봐서, 받아 둔 rc2 표시를 rc1 실행 때 지웠다.
// 같은 숫자면 정식판(꼬리 없음)이 미리보기보다 높고, 미리보기끼리는 꼬리를 숫자 인식 비교(rc2 < rc10).
export function cmpVersion(a: string, b: string): number {
  const split = (v: string) => {
    const s = v.trim().replace(/^v/i, "");
    const i = s.indexOf("-");
    return { core: (i < 0 ? s : s.slice(0, i)).split(".").map((x) => parseInt(x, 10) || 0), pre: i < 0 ? "" : s.slice(i + 1) };
  };
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < Math.max(A.core.length, B.core.length); i++) {
    const d = (A.core[i] ?? 0) - (B.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre.localeCompare(B.pre, undefined, { numeric: true });
}
