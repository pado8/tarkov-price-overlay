'use client';

// 페이지 렌더 중 런타임 오류 → 공통 오류 화면(components/Maintenance.tsx, ops/maintenance 가 원본).
// 정적 export 라 서버 로그는 없고, 클라이언트에서 60초마다 자동 재시도 + "지금 다시 시도"(reset) 버튼.
import Maintenance from '@/components/Maintenance';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 오류 원문은 콘솔에만 남긴다(사용자 화면엔 공통 문구만).
  if (typeof console !== 'undefined') console.error(error);
  return <Maintenance kind="error" reset={reset} />;
}
