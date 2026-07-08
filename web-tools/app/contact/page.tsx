import type { Metadata } from 'next';
import { SITE_NAME } from '@/lib/tools';

export const metadata: Metadata = {
  title: '문의',
  description: `${SITE_NAME}에 대한 버그 제보, 새 도구 제안, 제휴 문의를 받습니다.`,
};

export default function Contact() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">문의</h1>
      <p className="mt-4 leading-relaxed">
        버그 제보, 새 도구 제안, 제휴 문의 모두 환영합니다. 아래 이메일로 연락해 주세요.
      </p>
      <p className="mt-4 rounded-xl bg-gray-50 px-5 py-4 font-semibold text-gray-900">
        📮 floe9235@gmail.com
      </p>
      <p className="mt-4 text-sm leading-relaxed text-gray-500">
        &ldquo;이런 변환 도구도 있으면 좋겠다&rdquo; 하는 제안을 특히 환영합니다. 요청이 많은
        도구부터 우선적으로 추가하고 있습니다.
      </p>
    </article>
  );
}
