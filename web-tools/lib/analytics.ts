'use client';

// 통계는 Vercel Web Analytics + GA4 두 갈래로만 보낸다.
// 자체 비콘 → Neon 은 금지 (Neon compute 는 타르코프 시세 오버레이 전용).
// 둘 다 클라이언트 스크립트라 output:'export' 정적 사이트에서도 그대로 동작한다.

import { track } from '@vercel/analytics';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** 현재 경로에서 도구 slug 추출. trailingSlash 라 "/pdf-merge/" 형태로 들어온다. */
export function currentTool(): string {
  if (typeof window === 'undefined') return 'unknown';
  const s = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return s === '' ? 'home' : s;
}

/**
 * 같은 이벤트를 Vercel · GA4 양쪽에 보낸다. 켜져 있는 쪽이 받으면 된다.
 * (Vercel 커스텀 이벤트는 요금제에 따라 무시될 수 있어 GA4 를 함께 둔다)
 */
export function trackEvent(name: string, props: Record<string, string | number> = {}) {
  try {
    track(name, props);
  } catch {
    /* 애널리틱스 실패가 도구 동작을 막으면 안 된다 */
  }
  try {
    window.gtag?.('event', name, props);
  } catch {
    /* 위와 동일 */
  }
}
