import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/tools';

export const dynamic = 'force-static';

/**
 * AI 학습용 수집기·SEO 분석 크롤러 (2026-11-03 보안 점검).
 * 검색엔진(Googlebot·Yeti·Bingbot)·광고(Mediapartners-Google)·AI 비서(OAI-SearchBot·ChatGPT-User·
 * Claude-User·PerplexityBot)는 * 규칙대로 허용되고, 여기 목록만 전부 차단된다.
 */
const BLOCKED_BOTS = [
  // AI 학습 데이터 수집
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'CCBot', 'Bytespider',
  'Applebot-Extended', 'meta-externalagent', 'Amazonbot', 'Diffbot', 'cohere-ai',
  'cohere-training-data-crawler', 'ImagesiftBot', 'omgili', 'omgilibot', 'webzio-extended',
  'PetalBot', 'Timpibot', 'AI2Bot', 'Ai2Bot-Dolma', 'PanguBot', 'img2dataset', 'Scrapy',
  // SEO 분석 수집기 (경쟁 분석용, 검색 순위와 무관)
  'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'DataForSeoBot', 'BLEXBot',
  'serpstatbot', 'Barkrowler', 'ZoominfoBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: BLOCKED_BOTS, disallow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
