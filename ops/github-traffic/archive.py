"""GitHub 레포 방문 기록 보관 — GitHub 은 트래픽을 최근 14일만 보여 주고 그 전은 지운다(2026-11-06).

하루 한 번(예약 작업 GitHubTrafficArchive) 이 PC 에 로그인된 gh 로 받아 data/ 에 합쳐 둔다.
- 일별 조회·클론(views/clones): 날짜별로 덮어쓰기 — 같은 날을 다시 받으면 최신 값이 이긴다(GitHub 이 하루 늦게 채움)
- 리퍼러·인기 경로(14일 합계): 받은 날짜별 스냅샷으로 남긴다(일별 값이 없어서)
PC 가 며칠 꺼져 있어도 14일 안에 한 번만 돌면 빠짐없이 채워진다.
data/ 는 git 에 넣지 않는다(.gitignore) — 공개 저장소라서.

수동 실행: python C:\\project\\ops\\github-traffic\\archive.py
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

REPOS = ["pado8/tarkov-price-overlay-releases", "pado8/tarkov-price-overlay"]
GH = r"C:\Program Files\GitHub CLI\gh.exe"
ROOT = Path(__file__).resolve().parent / "data"


def gh(path: str):
    # 예약 작업(pythonw, 창 없음)에서 gh 콘솔 창이 번쩍이지 않게 CREATE_NO_WINDOW
    out = subprocess.run([GH, "api", path], capture_output=True, timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if out.returncode != 0:
        raise RuntimeError(f"gh api {path} 실패: {out.stderr.decode('utf-8', 'replace').strip()[:200]}")
    return json.loads(out.stdout.decode("utf-8"))


def load(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(p)


def archive(repo: str, today: str) -> str:
    d = ROOT / repo.replace("/", "__")
    daily_p = d / "daily.json"
    daily = load(daily_p, {})
    views = gh(f"repos/{repo}/traffic/views")
    clones = gh(f"repos/{repo}/traffic/clones")
    for v in views.get("views", []):
        day = v["timestamp"][:10]
        row = daily.setdefault(day, {})
        row.update({"views": v["count"], "view_uniques": v["uniques"]})
    for c in clones.get("clones", []):
        day = c["timestamp"][:10]
        row = daily.setdefault(day, {})
        row.update({"clones": c["count"], "clone_uniques": c["uniques"]})
    save(daily_p, daily)
    snap = {
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "views_14d": {"count": views.get("count"), "uniques": views.get("uniques")},
        "clones_14d": {"count": clones.get("count"), "uniques": clones.get("uniques")},
        "referrers_14d": gh(f"repos/{repo}/traffic/popular/referrers"),
        "paths_14d": gh(f"repos/{repo}/traffic/popular/paths"),
    }
    save(d / "snapshots" / f"{today}.json", snap)
    days = sorted(daily)
    return f"{repo}: 일별 {len(daily)}일 보관({days[0]}~{days[-1]}) · 14일 조회 {views.get('count')}/{views.get('uniques')}"


def main() -> int:
    today = dt.datetime.now().strftime("%Y-%m-%d")
    lines, ok = [], True
    for r in REPOS:
        try:
            lines.append(archive(r, today))
        except Exception as e:  # 한 레포가 실패해도 나머지는 받는다
            ok = False
            lines.append(f"{r}: 실패 — {e}")
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / "archive.log").open("a", encoding="utf-8") as f:
        for ln in lines:
            f.write(f"{stamp} {ln}\n")
    if sys.stdout is not None:  # pythonw 로 돌면 stdout 이 없다
        sys.stdout.reconfigure(encoding="utf-8")
        print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
