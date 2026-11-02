import type { Metadata } from 'next';
import { SITE_NAME } from '@/lib/tools';

export const metadata: Metadata = {
  title: '개인정보처리방침',
  description: `${SITE_NAME} 개인정보처리방침 — 파일은 서버로 전송되지 않으며 어떤 파일도 수집·저장하지 않습니다.`,
};

export default function Privacy() {
  return (
    <article className="prose-sm mx-auto max-w-3xl px-4 py-10 text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">개인정보처리방침</h1>
      <p className="mt-2 text-sm text-gray-500">시행일: 2026년 7월 8일 · 최종 갱신: 2026년 10월 27일</p>

      <h2 className="mt-8 text-lg font-bold text-gray-900">1. 파일 처리에 관하여</h2>
      <p className="mt-2 leading-relaxed">
        {SITE_NAME}의 모든 도구는 사용자가 선택한 파일을 <strong>서버로 전송하지 않습니다</strong>.
        변환·압축·병합 등 모든 처리는 사용자의 웹 브라우저 안에서 이루어지며, 운영자는 사용자의
        파일에 접근할 수 없고 어떤 파일도 수집·저장하지 않습니다. 페이지를 닫으면 처리 중이던
        데이터는 브라우저 메모리에서 사라집니다.
      </p>

      <h2 className="mt-8 text-lg font-bold text-gray-900">2. 수집하는 정보</h2>
      <p className="mt-2 leading-relaxed">
        본 사이트는 회원가입이 없으며 이름, 이메일 등 개인정보를 직접 수집하지 않습니다. 다만
        서비스 개선을 위해 방문 통계 도구(Google Analytics)를 사용하며, 이 과정에서 쿠키를 통해
        비식별 방문 정보(방문 페이지, 브라우저 종류, 대략적 지역)가 Google로 전달됩니다. 원하지 않으면{' '}
        <a href="https://tools.google.com/dlpage/gaoptout" className="underline" rel="noopener">
          Google 애널리틱스 차단 도구
        </a>
        로 끌 수 있습니다.
      </p>

      <h2 className="mt-8 text-lg font-bold text-gray-900">3. 광고에 관하여</h2>
      <p className="mt-2 leading-relaxed">
        본 사이트는 Google AdSense 광고를 게재할 수 있습니다. Google을 포함한 제3자 광고
        사업자는 쿠키를 사용해 사용자의 이전 방문 기록에 기반한 광고를 표시할 수 있습니다.
        사용자는{' '}
        <a href="https://adssettings.google.com" className="text-brand-600 underline" rel="noreferrer" target="_blank">
          Google 광고 설정
        </a>
        에서 맞춤 광고를 해제할 수 있고, 다른 광고 사업자의 쿠키는{' '}
        <a href="https://optout.aboutads.info" className="text-brand-600 underline" rel="noreferrer" target="_blank">
          aboutads.info
        </a>
        에서 관리할 수 있습니다. 유럽경제지역·영국·스위스 방문자에게는 광고 전에 동의 창을 띄웁니다.
        현재(2026-10-27 기준) 본 사이트에는 제3자 광고가 게재되어 있지 않으며, 게재를 시작하면 이 항목을 먼저 갱신합니다.
      </p>

      <h2 className="mt-8 text-lg font-bold text-gray-900">4. 문의</h2>
      <p className="mt-2 leading-relaxed">
        개인정보 처리에 관한 문의는 <a href="/contact/" className="text-brand-600 underline">문의 페이지</a>를
        통해 연락해 주세요.
      </p>
    </article>
  );
}
