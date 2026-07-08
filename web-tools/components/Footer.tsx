import Link from 'next/link';
import { SITE_NAME } from '@/lib/tools';

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-gray-100 bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-gray-500">
        <p className="mb-3">
          {SITE_NAME}의 모든 도구는 파일을 서버로 전송하지 않습니다. 처리 과정 전체가 사용자의
          브라우저 안에서 이루어집니다.
        </p>
        <nav className="flex flex-wrap gap-4">
          <Link href="/about/" className="hover:text-brand-600">
            소개
          </Link>
          <Link href="/privacy/" className="hover:text-brand-600">
            개인정보처리방침
          </Link>
          <Link href="/contact/" className="hover:text-brand-600">
            문의
          </Link>
        </nav>
        <p className="mt-4">© {new Date().getFullYear()} {SITE_NAME}</p>
      </div>
    </footer>
  );
}
