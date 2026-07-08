import Link from 'next/link';
import type { Metadata } from 'next';
import { getTool, SITE_NAME, SITE_URL, TOOLS } from '@/lib/tools';
import AdSlot from '@/components/AdSlot';

export function toolMetadata(slug: string): Metadata {
  const t = getTool(slug);
  return {
    title: t.title,
    description: t.description,
    alternates: { canonical: `${SITE_URL}/${t.slug}/` },
    openGraph: {
      title: t.title,
      description: t.description,
      url: `${SITE_URL}/${t.slug}/`,
      siteName: SITE_NAME,
      locale: 'ko_KR',
      type: 'website',
    },
  };
}

export default function ToolPage({ slug, children }: { slug: string; children: React.ReactNode }) {
  const t = getTool(slug);
  const related = t.related.map((s) => getTool(s));

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: t.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  const howtoLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: `${t.name} 사용법`,
    step: t.howto.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
  };

  return (
    <article className="mx-auto max-w-3xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howtoLd) }} />

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          <span aria-hidden className="mr-2">{t.icon}</span>
          {t.name}
        </h1>
        <p className="mt-2 text-gray-600">{t.description}</p>
      </header>

      {children}

      <AdSlot id={`${t.slug}-below-tool`} />

      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">사용 방법</h2>
        <ol className="mt-3 space-y-3">
          {t.howto.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
                {i + 1}
              </span>
              <p className="text-gray-700">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <p className="leading-relaxed text-gray-700">{t.intro}</p>
      </section>

      <AdSlot id={`${t.slug}-mid-content`} />

      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">자주 묻는 질문</h2>
        <dl className="mt-3 space-y-5">
          {t.faqs.map((f, i) => (
            <div key={i}>
              <dt className="font-semibold text-gray-900">Q. {f.q}</dt>
              <dd className="mt-1 leading-relaxed text-gray-700">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">함께 쓰면 좋은 도구</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {related.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/${r.slug}/`}
                className="block h-full rounded-xl border border-gray-200 p-4 transition-colors hover:border-brand-500 hover:bg-brand-50"
              >
                <span className="text-lg" aria-hidden>{r.icon}</span>
                <p className="mt-1 font-semibold text-gray-900">{r.name}</p>
                <p className="mt-1 text-sm text-gray-500">{r.short}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
