// 11-08 가격 알람 화면 조각 — 카드의 🔔 한 줄과 설정의 알람 목록. 판정·저장은 priceAlarm.ts, 상태는 App.tsx 가 갖는다.
import { useState } from "react";
import type { Strings as LiteralStrings } from "./i18n";
import type { Alarm } from "./priceAlarm";

type Strings = { [K in keyof LiteralStrings]: string };

const won = (n: number) => `${Math.round(n).toLocaleString()} ₽`;

/** 카드의 가격 알람 한 줄: 있으면 '🔔 30,000 ₽ 이상이면 알림 · 지우기', 없으면 🔔 버튼 → 이상/이하·가격 입력. */
export function AlarmLine({ alarm, current, t, onSet, onDelete }: {
  alarm: Alarm | null;
  current: number | null;
  t: Strings;
  onSet: (dir: "above" | "below", price: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"above" | "below">("above");
  const [val, setVal] = useState<string>("");
  if (alarm && !open) {
    return (
      <div className="alarm-line">
        {(alarm.dir === "above" ? t.alarmActiveAbove : t.alarmActiveBelow).replace("{p}", won(alarm.price))}{" "}
        <button type="button" className="radar-link" onClick={() => { setDir(alarm.dir); setVal(String(alarm.price)); setOpen(true); }}>{t.alarmEdit}</button>{" "}
        <button type="button" className="radar-link" onClick={onDelete}>{t.alarmDelete}</button>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="alarm-line">
        <button type="button" className="radar-link" onClick={() => { setVal(current ? String(Math.round(current * 1.1 / 100) * 100) : ""); setOpen(true); }}>
          {t.alarmBtn}
        </button>
      </div>
    );
  }
  const n = Number(val.replace(/[^\d]/g, ""));
  return (
    <div className="alarm-line alarm-edit">
      <span>{t.flea}</span>
      <input inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value)} aria-label={t.alarmPrice} />
      <span>₽</span>
      <select value={dir} onChange={(e) => setDir(e.target.value as "above" | "below")} aria-label={t.alarmDir}>
        <option value="above">{t.alarmAbove}</option>
        <option value="below">{t.alarmBelow}</option>
      </select>
      <button type="button" className="reset-btn" disabled={!(n > 0)} onClick={() => { onSet(dir, n); setOpen(false); }}>{t.alarmSet}</button>
      <button type="button" className="radar-link" onClick={() => setOpen(false)}>✕</button>
    </div>
  );
}

/** 설정의 알람 목록(지금 모드 것만). 기준가를 누르면 그 자리에서 이상/이하·가격을 다시 정한다(11-08 사용자 요청). */
export function AlarmList({ alarms, t, onDelete, onSet }: {
  alarms: Alarm[];
  t: Strings;
  onDelete: (a: Alarm) => void;
  onSet: (a: Alarm, dir: "above" | "below", price: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [dir, setDir] = useState<"above" | "below">("above");
  const [val, setVal] = useState("");
  if (!alarms.length) return <div className="settings-sub">{t.alarmNone}</div>;
  return (
    <div className="alarm-list">
      {alarms.map((a) => {
        const key = a.id + a.mode;
        if (editing === key) {
          const n = Number(val.replace(/[^\d]/g, ""));
          return (
            <div className="alarm-row alarm-edit" key={key}>
              <span className="alarm-name">{a.name}</span>
              <input inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value)} aria-label={t.alarmPrice} autoFocus />
              <span>₽</span>
              <select value={dir} onChange={(e) => setDir(e.target.value as "above" | "below")} aria-label={t.alarmDir}>
                <option value="above">{t.alarmAbove}</option>
                <option value="below">{t.alarmBelow}</option>
              </select>
              <button
                type="button"
                className="reset-btn"
                disabled={!(n > 0)}
                onClick={() => {
                  onSet(a, dir, n);
                  setEditing(null);
                }}
              >
                {t.alarmSet}
              </button>
              <button type="button" className="radar-link" onClick={() => setEditing(null)}>✕</button>
            </div>
          );
        }
        return (
          <div className="alarm-row" key={key}>
            <span className="alarm-name">{a.name}</span>
            <button
              type="button"
              className="radar-link plan-via"
              title={t.alarmEdit}
              onClick={() => {
                setDir(a.dir);
                setVal(String(a.price));
                setEditing(key);
              }}
            >
              {(a.dir === "above" ? t.alarmAbove : t.alarmBelow)} {won(a.price)}
            </button>
            <span className="plan-via" title={t.alarmNow}>{a.last ? won(a.last) : "—"}</span>
            <button type="button" className="radar-link" onClick={() => onDelete(a)}>{t.alarmDelete}</button>
          </div>
        );
      })}
    </div>
  );
}
