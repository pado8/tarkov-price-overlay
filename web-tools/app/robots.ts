import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/tools';

export const dynamic = 'force-static';

/**
 * 차단 목록 (2026-11-03 저녁, 사용자 결정: AI 검색용·학습용 모두 허용).
 * 검색엔진·광고·AI 비서(OAI-SearchBot·ChatGPT-User·PerplexityBot·Claude-*)와 AI 학습·근거 수집기
 * (GPTBot·ClaudeBot·Google-Extended·CCBot·Applebot-Extended·meta-externalagent 등)는 * 규칙대로 허용
 * — 모델이 사이트를 알고 추천하는 쪽이 이득. 여기 목록(AI 와 무관한 대량 긁기·데이터 중개·이미지 수집기,
 * 경쟁 분석용 SEO 크롤러)만 전부 차단된다. robots 는 규칙을 지키는 봇에게만 효력이 있다.
 */
const BLOCKED_BOTS = [
  // 대량 긁기·데이터 중개·이미지 수집
  'Bytespider', 'img2dataset', 'Scrapy', 'Diffbot', 'omgili', 'omgilibot', 'webzio-extended', 'ImagesiftBot',
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
