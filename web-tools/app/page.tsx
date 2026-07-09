import Link from 'next/link';
import {
  CATEGORY_LABELS,
  SITE_DESC,
  SITE_NAME,
  SITE_URL,
  TOOLS,
  type ToolCategory,
} from '@/lib/tools';

const CATEGORY_ORDER: ToolCategory[] = ['image', 'pdf', 'video', 'life'];

export default function Home() {
  const siteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESC,
    inLanguage: 'ko',
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteLd) }} />

      <section className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
          설치 없이, 업로드 없이. <span className="text-brand-600">브라우저에서 뚝딱.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-gray-600">
          {SITE_NAME}의 모든 도구는 파일을 서버로 보내지 않습니다. 변환·압축이 내 컴퓨터 안에서
          바로 처리되니 개인 사진과 문서도 안심하고 사용하세요.
        </p>
      </section>

      {CATEGORY_ORDER.map((cat) => (
        <section key={cat} className="mt-10">
          <h2 className="text-lg font-bold text-gray-900">{CATEGORY_LABELS[cat]}</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.filter((t) => t.category === cat).map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/${t.slug}/`}
                  className="block h-full rounded-2xl border border-gray-200 p-5 transition-all hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-md"
                >
                  <span className="text-2xl" aria-hidden>{t.icon}</span>
                  <h3 className="mt-2 text-lg font-bold text-gray-900">{t.name}</h3>
                  <p className="mt-1 text-sm text-gray-500">{t.short}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-14 rounded-2xl bg-gray-50 p-6">
        <h2 className="text-lg font-bold text-gray-900">왜 {SITE_NAME}인가요?</h2>
        <ul className="mt-3 grid gap-3 text-sm text-gray-700 sm:grid-cols-3">
          <li>
            <strong className="block text-gray-900">🔒 업로드 없음</strong>
            파일이 서버로 전송되지 않아 유출 걱정이 없습니다.
          </li>
          <li>
            <strong className="block text-gray-900">⚡ 대기 없음</strong>
            업로드·다운로드 대기가 없어 대용량도 즉시 처리됩니다.
          </li>
          <li>
            <strong className="block text-gray-900">🆓 제한 없음</strong>
            가입·설치·용량 제한 없이 전부 무료입니다.
          </li>
        </ul>
      </section>
    </div>
  );
}
