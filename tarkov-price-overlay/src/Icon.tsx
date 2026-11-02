// 헤더·배너용 단색 SVG 아이콘 세트(11-02 UI 점검 — 컬러 이모지(🕒🗺️⚙✕📌⌨︎↩)와 SVG 가 섞여 톤이 안 맞던 것 통일).
// 전부 stroke: currentColor 라 버튼 색(.settings-btn 금색 / .exit-btn 빨강 / .active 밝은 금색)을 그대로 따른다.
// 크기는 글자 크기(em) 기준이라 카드 폰트 설정에 같이 커진다. 스타일은 App.css 의 .ui-icon.
import type { ReactNode } from "react";

export type IconName =
  | "clock" | "map" | "wideMap" | "gear" | "x" | "pin" | "keyboard" | "back"
  // 본문 섹션(11-02 2차): 구매처·교환으로 얻기·이 아이템으로 교환·은신처 제작·재료로 쓰이는 제작·건스미스·은신처 업그레이드·탄약 비교·퀘스트·칸·무게·위키·잠금·완료·열쇠
  | "store" | "exchange" | "send" | "hammer" | "flask" | "wrench" | "hideout" | "target" | "quests" | "box" | "scale" | "book" | "lock" | "check" | "key";

const PATHS: Record<Exclude<IconName, "wideMap">, ReactNode> = {
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.4 1.5" />
    </>
  ),
  map: (
    <>
      <path d="M1.5 3.5 6 1.5l4 2 4.5-2v11l-4.5 2-4-2-4.5 2z" />
      <path d="M6 1.5v11M10 3.5v11" />
    </>
  ),
  // 톱니 윤곽(Lucide 'settings', ISC) — 24 좌표계라 16 으로 축소해 넣는다(선 굵기는 scale 로 같이 줄어 2.4 → 1.6)
  gear: (
    <g transform="scale(0.6667)" strokeWidth="2.4">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  pin: (
    <path d="M10 1.5l4.5 4.5-1.3 1.3-.9-.3-2.6 2.6.3 2.8-1.3 1.3L5.9 11 2 14.9l-.9-.9L5 10.1 2.2 7.3l1.3-1.3 2.8.3 2.6-2.6-.3-.9z" />
  ),
  keyboard: (
    <>
      <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" />
      <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M4 9.5h.01M11.5 9.5h.01M6 9.5h4" />
    </>
  ),
  back: <path d="M9 3 4 8l5 5M4 8h10" />,
  // 구매처: 차양 달린 가게
  store: <path d="M2 6l1.5-4h9L14 6M2 6v1.5a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0V6M3.5 9.5V14h9V9.5M6.5 14v-4h3v4" />,
  // 교환으로 얻기: 양방향 화살표
  exchange: <path d="M3 5.5h9.5L10 3M13 10.5H3.5L6 13" />,
  // 이 아이템으로 교환: 상자에서 밖으로 나가는 화살표
  send: <path d="M13 9.5V13.5H2.5V3h4M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />,
  // 은신처 제작: 망치
  hammer: <path d="M2.5 13.5 8 8M8.5 2.5l5 5-2 2-5-5zM6.5 4.5 9 2" />,
  // 재료로 쓰이는 제작: 플라스크
  flask: <path d="M6 2h4M6.5 2v4.5L3 12.5a1.2 1.2 0 0 0 1 1.8h8a1.2 1.2 0 0 0 1-1.8L9.5 6.5V2M5 10.5h6" />,
  // 건스미스: 렌치(Lucide 'wrench', ISC)
  wrench: (
    <g transform="scale(0.6667)" strokeWidth="2.4">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </g>
  ),
  // 은신처 업그레이드: 집
  hideout: <path d="M2 8 8 2.5 14 8M3.5 6.8V14h9V6.8M6.5 14v-4h3v4" />,
  // 탄약 비교: 조준점
  target: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
    </>
  ),
  // 퀘스트: 체크 표시 달린 클립보드
  quests: <path d="M5.5 2.5h5v2h-5zM4 3.5H3v11h10v-11h-1M5.5 9.5l1.8 1.8L10.8 8" />,
  // 칸·가격: 상자
  box: <path d="M2 5.5 8 2.5l6 3v5.5l-6 3-6-3zM2 5.5l6 3 6-3M8 8.5v6" />,
  // 무게: 저울
  scale: <path d="M8 2v12M4 14h8M8 4 3.5 5.5M8 4l4.5 1.5M1.5 10a2 2 0 0 0 4 0L3.5 5.5zM10.5 10a2 2 0 0 0 4 0l-2-4.5z" />,
  // 위키: 펼친 책
  book: <path d="M2.5 2.5h4A1.5 1.5 0 0 1 8 4v9.5a1.5 1.5 0 0 0-1.5-1.5h-4zM13.5 2.5h-4A1.5 1.5 0 0 0 8 4v9.5a1.5 1.5 0 0 1 1.5-1.5h4z" />,
  // 잠김(퀘스트 미완·시설 레벨 부족·FiR)
  lock: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  // 완료·해금
  check: <path d="M3 8.5l3 3 7-7" />,
  // 열쇠
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M7.6 8.4 14 2M11 5l2 2M9 7l1.5 1.5" />
    </>
  ),
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const cls = `ui-icon${name === "wideMap" ? " ui-icon-wide" : ""}${className ? ` ${className}` : ""}`;
  if (name === "wideMap") {
    // 지도 나란히: 루블 동전 + 지도 (10-28 사용자 결정, 색만 단색으로)
    return (
      <svg className={cls} viewBox="0 0 36 16" aria-hidden="true">
        <circle cx="6.5" cy="8" r="5.5" />
        <path d="M5.6 11.5V5.2h1.7a1.6 1.6 0 0 1 0 3.2H4.6M4.6 10h3" />
        <path d="M15 8h4M17 6v4" />
        <g transform="translate(20 1.5)">
          <path d="M1 3 6 1l5 2 5-2v9l-5 2-5-2-5 2z" />
          <path d="M6 1v9M11 3v9" />
        </g>
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
