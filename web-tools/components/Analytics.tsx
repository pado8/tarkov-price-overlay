'use client';

import Script from 'next/script';
import { Analytics as VercelAnalytics } from '@vercel/analytics/react';

// GA4 는 측정 ID 가 있을 때만 붙는다. Vercel 환경변수 NEXT_PUBLIC_GA_ID 를 넣고
// 재배포하면 그 순간부터 활성화된다 (빌드 시 인라인되는 값이라 재배포가 필요).
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
// AdSense 도 같은 방식 — 승인 뒤 게시자 ID(ca-pub-…)를 NEXT_PUBLIC_ADSENSE_CLIENT 에 넣고 재배포하면
// 전 페이지에 자동 광고가 켜진다. 그때 public/ads.txt 와 /privacy 3절 "현재 광고 없음" 문구도 함께 갱신.
const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

export default function Analytics() {
  return (
    <>
      <VercelAnalytics />
      {ADSENSE_CLIENT ? (
        <Script
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      ) : null}
      {GA_ID ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${GA_ID}');`}
          </Script>
        </>
      ) : null}
    </>
  );
}
