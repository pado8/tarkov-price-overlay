import type { MetadataRoute } from 'next';
import { SITE_URL, TOOLS } from '@/lib/tools';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    ...TOOLS.map((t) => ({
      url: `${SITE_URL}/${t.slug}/`,
      lastModified: now,
      priority: 0.9,
    })),
    { url: `${SITE_URL}/about/`, lastModified: now, priority: 0.3 },
    { url: `${SITE_URL}/privacy/`, lastModified: now, priority: 0.1 },
    { url: `${SITE_URL}/contact/`, lastModified: now, priority: 0.3 },
  ];
}
