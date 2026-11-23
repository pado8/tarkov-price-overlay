// 설치 점검 + 안전 안내(11-13). 점검은 사이드카 /diag/setup 이 이 PC 의 폴더·설정만 보고 돌려준다(밖으로 보내지 않음).
import { useState } from "react";
import { PYTHON_API } from "./engine";
import { stat } from "./statBus";

type Strings = { [k: string]: string };
type Item = { id: string; ok: boolean | null; n?: number; age_min?: number | null; wrong_tool?: boolean; steam?: boolean; mode?: number | null };

export function SetupCheck({ t }: { t: Strings }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const run = () => {
    setBusy(true);
    setErr(false);
    stat("sck");
    fetch(`${PYTHON_API}/diag/setup`)
      .then((r) => r.json())
      .then((j: { items?: Item[] }) => {
        const list = j.items ?? [];
        setItems(list);
        if (list.some((x) => x.ok === false)) stat("scf"); // 문제가 하나라도 나온 점검
      })
      .catch(() => setErr(true))
      .finally(() => setBusy(false));
  };
  const fix = (x: Item): string => {
    if (x.id === "shots_named" && x.wrong_tool) return t.setupFix_shots_wrong;
    if (x.id === "install" && x.ok && x.steam) return t.setupNote_steam;
    return x.ok === false ? t[`setupFix_${x.id}`] ?? "" : "";
  };
  return (
    <div className="setup-check">
      <button type="button" className="reset-btn" onClick={run} disabled={busy}>{busy ? t.setupRunning : t.setupRun}</button>
      {err && <div className="setup-row bad">{t.setupErr}</div>}
      {items && (
        <ul>
          {items.map((x) => (
            <li key={x.id} className={x.ok === false ? "bad" : x.ok === null ? "unk" : "ok"}>
              <span className="mk">{x.ok === false ? "⚠" : x.ok === null ? "?" : "✓"}</span>
              <span className="nm">{t[`setup_${x.id}`] ?? x.id}{x.id === "shots_named" && x.n ? ` (${x.n})` : ""}</span>
              {fix(x) && <div className="fx">{fix(x)}</div>}
            </li>
          ))}
          <li className="unk"><span className="mk">i</span><span className="nm">{t.setup_admin}</span></li>
        </ul>
      )}
    </div>
  );
}

/** 안전 안내: 이 앱이 읽는 것과 읽지 않는 것. 과장 없이 — 게임사 공식 확인은 없다는 점까지 적는다 */
export function SafetyNote({ t }: { t: Strings }) {
  return (
    <div className="safety-note">
      <div><b>{t.safetyReads}</b> {t.safetyReadsList}</div>
      <div><b>{t.safetyNever}</b> {t.safetyNeverList}</div>
      <div className="dim">{t.safetyCaveat}</div>
    </div>
  );
}
