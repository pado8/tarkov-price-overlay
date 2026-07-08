import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, TOOLS } from '@/lib/tools';

export const metadata: Metadata = {
  title: '소개',
  description: `${SITE_NAME}는 파일이 서버에 올라가지 않는 무료 웹 도구 모음입니다. 만든 이유와 동작 원리를 소개합니다.`,
};

export default function About() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">{SITE_NAME} 소개</h1>

      <p className="mt-4 leading-relaxed">
        {SITE_NAME}는 이미지 변환, PDF 편집, 움짤 만들기 같은 일상적인 파일 작업을{' '}
        <strong>설치 없이, 가입 없이, 그리고 파일 업로드 없이</strong> 해결하기 위해 만든 무료 웹
        도구 모음입니다.
      </p>

      <h2 className="mt-8 text-lg font-bold text-gray-900">왜 &ldquo;업로드 없음&rdquo;인가요?</h2>
      <p className="mt-2 leading-relaxed">
        대부분의 온라인 변환 사이트는 파일을 자신들의 서버로 업로드한 뒤 처리해서 돌려주는
        방식입니다. 빠른 인터넷에서도 대기 시간이 생기고, 무엇보다 신분증 사본이나 계약서, 개인
        사진 같은 민감한 파일을 남의 서버에 올린다는 찜찜함이 남습니다. {SITE_NAME}는 웹어셈블리
        (WebAssembly) 기술로 변환 엔진 자체를 브라우저 안에서 실행합니다. 파일이 내 컴퓨터를
        떠나지 않으므로 유출 가능성이 원천적으로 없고, 업로드 대기 시간도 0초입니다.
      </p>

      <h2 className="mt-8 text-lg font-bold text-gray-900">제공하는 도구</h2>
      <ul className="mt-2 list-inside list-disc space-y-1">
        {TOOLS.map((t) => (
          <li key={t.slug}>
            <Link href={`/${t.slug}/`} className="text-brand-600 underline">
              {t.name}
            </Link>{' '}
            — {t.short}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg font-bold text-gray-900">운영 원칙</h2>
      <ul className="mt-2 list-inside list-disc space-y-1 leading-relaxed">
        <li>모든 도구는 무료이며, 개수·용량 제한을 두지 않습니다.</li>
        <li>파일을 수집하거나 저장하지 않습니다. 기술적으로 불가능한 구조를 유지합니다.</li>
        <li>운영비는 페이지 광고로 충당하되, 도구 사용을 방해하는 광고는 넣지 않습니다.</li>
      </ul>
    </article>
  );
}
