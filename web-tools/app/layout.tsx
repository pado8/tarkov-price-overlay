import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Analytics from '@/components/Analytics';
import { SITE_DESC, SITE_NAME, SITE_URL } from '@/lib/tools';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — 업로드 없는 무료 웹 도구 모음`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESC,
  alternates: { canonical: '/' },
  openGraph: {
    siteName: SITE_NAME,
    locale: 'ko_KR',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — 업로드 없는 무료 웹 도구 모음`,
    description: SITE_DESC,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
  // 네이버 서치어드바이저 소유 확인 (2026-11-03). <meta name="naver-site-verification"> 로 출력된다.
  verification: { other: { 'naver-site-verification': 'd1d792f4af1596a629c53fe34fb2e190941b6dcc' } },
};

// 사이트 단위 구조화 데이터 — 검색결과에 사이트명·검색창이 잡히게 한다.
// (도구별 FAQPage·HowTo 는 ToolPage 에서 따로 넣는다)
const siteLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESC,
  inLanguage: 'ko-KR',
  publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteLd) }}
        />
        <Header />
        <main>{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
