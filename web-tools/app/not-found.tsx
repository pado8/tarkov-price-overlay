import type { Metadata } from 'next';
import Maintenance from '@/components/Maintenance';

// 404 → 공통 "페이지를 찾을 수 없습니다" 화면. 정적 export 에서는 out/404.html 로 떨어진다(Vercel 이 없는 경로에 이 파일을 준다).
// layout 의 robots(index, follow) 를 상속받지 않도록 명시적으로 noindex(Next 자동 noindex 메타와 겹치지만 모순은 없다).
export const metadata: Metadata = {
  title: '페이지를 찾을 수 없습니다',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return <Maintenance kind="notfound" />;
}
