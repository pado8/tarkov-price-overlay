// 나란히 보기와 함께 띄우는 미니맵 창(index.html?window=minimap, 11-12 피드백 #61-5 '게임 위엔 작은 미니맵, 옆 모니터엔 큰 지도를 같이')
// 지도 데이터는 본 창(App.tsx)이 받아 이벤트로 넘겨 준다 — 이 창은 사이드카를 따로 부르지 않고 그리기·끌기·크기만 한다.
// 클릭 투과는 본 창과 같은 방식(set_click_through, 활성화 없이 스타일 비트만) — 커서가 올라와 있을 때만 마우스를 받는다(#55).
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { RadarPanel, type RadarState, RADAR_MAP_ALPHA_KEY, RADAR_MINI_SIZE_KEY, RADAR_PIP_POS_KEY, loadMapAlpha, loadMiniSize } from "./Radar";
import { T, type Lang } from "./i18n";
import { snapToWorkArea } from "./miniSnap";

export const MINI_LABEL = "minimap";

/** 본 창 → 미니맵 창 */
export type MiniPayload = {
  data: RadarState | null;
  lang: Lang;
  showScav: boolean;
  snap: boolean; // 자석(설정 '미니맵을 화면 모서리에 붙이기')
  fontSize: number;
  opacity: number; // %
  bgOpacity: number; // %
};

export function MiniWindow() {
  const [p, setP] = useState<MiniPayload | null>(null);
  const [miniSize, setMiniSize] = useState<number>(loadMiniSize);
  const [mapAlpha, setMapAlpha] = useState<number>(loadMapAlpha);
  const snapRef = useRef(true);
  snapRef.current = p?.snap ?? true;

  useEffect(() => {
    const un = listen<MiniPayload>("mini-data", (e) => setP(e.payload));
    void emitTo("main", "mini-ready"); // 본 창이 지금 데이터를 다시 보낸다(창이 늦게 뜬 경우)
    return () => {
      un.then((f) => f());
    };
  }, []);

  // 창 크기 = 지도 크기(본 창 미니맵과 같은 정사각형)
  useEffect(() => {
    getCurrentWindow().setSize(new LogicalSize(miniSize, miniSize)).catch(() => {});
  }, [miniSize]);

  // 끌기가 멈추면(0.25초, 버튼을 놓은 뒤) 자리 저장 + 자석 — 본 창 미니맵과 같은 자리 키(RADAR_PIP_POS_KEY)
  useEffect(() => {
    const win = getCurrentWindow();
    let timer = 0;
    let armedAt = 0;
    const settle = async () => {
      try {
        const cur = await invoke<{ left?: boolean }>("get_cursor_position").catch(() => ({ left: false }));
        if (cur.left) {
          timer = window.setTimeout(() => void settle(), 250);
          return;
        }
        const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
        const at = snapRef.current ? snapToWorkArea(pos, size, await availableMonitors()) : { x: pos.x, y: pos.y };
        if (at.x !== pos.x || at.y !== pos.y) {
          armedAt = Date.now() + 400;
          await win.setPosition(new PhysicalPosition(at.x, at.y));
          void emitTo("main", "mini-snapped"); // 계측(하루 요약 msn)은 본 창이 센다
        }
        localStorage.setItem(RADAR_PIP_POS_KEY, JSON.stringify(at));
      } catch {}
    };
    const un = win.onMoved(() => {
      if (Date.now() < armedAt) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void settle(), 250);
    });
    return () => {
      window.clearTimeout(timer);
      un.then((f) => f());
    };
  }, []);

  // 클릭 투과 — 커서가 이 창 위일 때만 마우스를 받는다(0.1초마다 커서·창 자리 비교, 값이 바뀔 때 + 0.5초마다 다시 맞춤)
  useEffect(() => {
    const win = getCurrentWindow();
    let last: boolean | null = null;
    let since = 0;
    const iv = window.setInterval(async () => {
      try {
        const [c, pos, size] = await Promise.all([invoke<{ x: number; y: number }>("get_cursor_position"), win.outerPosition(), win.outerSize()]);
        const ignore = !(c.x >= pos.x && c.x < pos.x + size.width && c.y >= pos.y && c.y < pos.y + size.height);
        since++;
        if (ignore !== last || since >= 5) {
          last = ignore;
          since = 0;
          await invoke("set_click_through", { ignore, label: MINI_LABEL });
        }
      } catch {}
    }, 100);
    return () => window.clearInterval(iv);
  }, []);

  if (!p) return null;
  const t = T[p.lang];
  return (
    <div className="overlay pip">
      <div
        className="card card-mini"
        style={
          {
            "--card-fs": `${p.fontSize}px`,
            width: `${miniSize}px`,
            ["--card-op" as string]: String(p.opacity / 100),
            ["--card-bg-alpha" as string]: String(p.bgOpacity / 100),
          } as React.CSSProperties
        }
      >
        <RadarPanel
          data={p.data}
          loading={false}
          t={t}
          lang={p.lang}
          showScav={p.showScav}
          onToggleScav={() => {}}
          onPickMap={() => {}}
          onClose={() => {}}
          story=""
          onPickStory={() => {}}
          size={miniSize}
          onSize={() => {}}
          mini
          miniSize={miniSize}
          onMiniSize={(px) => {
            setMiniSize(px);
            try {
              localStorage.setItem(RADAR_MINI_SIZE_KEY, String(px));
            } catch {}
          }}
          mapAlpha={mapAlpha}
          onMapAlpha={(v) => {
            setMapAlpha(v);
            try {
              localStorage.setItem(RADAR_MAP_ALPHA_KEY, String(v));
            } catch {}
          }}
          dragRegion
          onMiniClose={() => void emitTo("main", "mini-close")}
        />
      </div>
    </div>
  );
}
