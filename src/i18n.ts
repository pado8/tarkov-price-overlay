export type Lang = "ko" | "en";

export const T = {
  ko: {
    title: "타르코프 시세",
    hintIdle: "아이템 위에 마우스 올리고 F2",
    hintLoading: "조회 중…",
    hintFirstLoad: "첫 호출은 OCR 모델 다운로드로 1~5분 걸려요",
    timeout: "시간 초과 (120초). 첫 호출이면 OCR 모델 다운로드 중. Python 콘솔 확인.",
    noMatch: "검색 결과 없음",
    flea: "플리",
    trader: "상인",
    ocr: "OCR",
    settings: "설정",
    language: "언어",
    offsetX: "X 오프셋",
    offsetY: "Y 오프셋",
    width: "너비",
    height: "높이",
    captureHint: "캡처 영역 = (마우스X + X오프셋, 마우스Y + Y오프셋) ~ 너비/높이",
    reset: "초기화",
  },
  en: {
    title: "Tarkov Price",
    hintIdle: "Hover an item, press F2",
    hintLoading: "Looking up…",
    hintFirstLoad: "First call: OCR model download may take 1~5 min",
    timeout: "Timeout (120s). First call may be downloading OCR model. Check Python console.",
    noMatch: "no match",
    flea: "Flea",
    trader: "Trader",
    ocr: "OCR",
    settings: "Settings",
    language: "Language",
    offsetX: "offsetX",
    offsetY: "offsetY",
    width: "width",
    height: "height",
    captureHint: "capture = (cursor.x + offsetX, cursor.y + offsetY) ~ width/height",
    reset: "Reset",
  },
} as const;

export type Strings = typeof T.en;
