// AdSense 승인 후 실제 광고 코드로 교체하는 자리.
// 승인 전에는 레이아웃에 영향 없는 빈 마운트 포인트만 둔다 (PLAN 6장).
export default function AdSlot({ id }: { id: string }) {
  return <div data-ad-slot={id} className="my-6" />;
}
