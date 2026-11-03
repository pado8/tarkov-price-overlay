'use client';

// 루트 layout 자체가 깨졌을 때의 최후 보루 — layout 을 대체하므로 <html><body> 를 직접 그린다.
// (app/error.tsx 는 layout 안쪽 오류만 잡는다)
import Maintenance from '@/components/Maintenance';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  if (typeof console !== 'undefined') console.error(error);
  return (
    <html lang="ko">
      <body>
        <Maintenance kind="error" reset={reset} />
      </body>
    </html>
  );
}
