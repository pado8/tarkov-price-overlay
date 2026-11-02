// 헤더·배너용 단색 SVG 아이콘 세트(11-02 UI 점검 — 컬러 이모지(🕒🗺️⚙✕📌⌨︎↩)와 SVG 가 섞여 톤이 안 맞던 것 통일).
// 전부 stroke: currentColor 라 버튼 색(.settings-btn 금색 / .exit-btn 빨강 / .active 밝은 금색)을 그대로 따른다.
// 크기는 글자 크기(em) 기준이라 카드 폰트 설정에 같이 커진다. 스타일은 App.css 의 .ui-icon.
import type { ReactNode } from "react";

export type IconName = "clock" | "map" | "wideMap" | "gear" | "x" | "pin" | "keyboard" | "back";

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
