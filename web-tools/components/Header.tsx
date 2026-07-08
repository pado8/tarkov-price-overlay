import Link from 'next/link';
import { SITE_NAME } from '@/lib/tools';

export default function Header() {
  return (
    <header className="border-b border-gray-100 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-xl font-extrabold tracking-tight text-brand-600">🔨 {SITE_NAME}</span>
          <span className="hidden text-sm text-gray-500 sm:inline">설치 없이 브라우저에서 뚝딱</span>
        </Link>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          파일 업로드 없음
        </span>
      </div>
    </header>
  );
}
