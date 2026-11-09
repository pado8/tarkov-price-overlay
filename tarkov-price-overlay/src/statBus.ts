// 하루 요약(App.tsx 의 dailyAdd)으로 가는 통로 — App 밖 컴포넌트(Radar 등)가 App 을 import 하지 않고 횟수를 더할 수 있게.
// App 이 시작할 때 setStatSink(dailyAdd) 로 연결한다. 연결 전 호출은 버린다(통계라 잃어도 무해).
type Sink = (key: string, n?: number) => void;
let sink: Sink = () => {};

export function setStatSink(fn: Sink): void {
  sink = fn;
}

/** 하루 요약 키에 n 을 더한다(키는 짧게, 영문 소문자 2~4자). */
export function stat(key: string, n = 1): void {
  try {
    sink(key, n);
  } catch {}
}
