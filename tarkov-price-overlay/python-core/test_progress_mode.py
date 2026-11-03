"""가이드 사이트 연동 모드 시험(11-03): 사이트 첫 연동(auto)이 사이트 기본값(PVP)이 아니라 앱이 쓰는 퀘스트 서버를 따른다.
실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_progress_mode.py
상태 폴더(LOCALAPPDATA)를 임시 폴더로 돌려 사용자 은신처 설정·모드 파일을 건드리지 않는다."""
import json
import os
import sys
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="tpo-progress-"))
os.environ["LOCALAPPDATA"] = str(tmp)
os.environ["TPO_CATALOG_DIR"] = str(tmp / "catalog")

import main  # noqa: E402  (환경변수 뒤에)

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


state = tmp / "TarkovPriceOverlay"

# 1) 앱이 아직 모드를 안 알려 줬으면 auto 는 예전처럼 PVP
r = main.progress(None)
eq("앱 모드 모름 → auto 는 pvp", (r["mode"], r["mode_source"], r["app_mode"]), ("pvp", "app", None))
eq("'auto' 문자열도 같은 경로", main.progress("auto")["mode_source"], "app")

# 2) 앱이 은신처 동기화에 모드를 실어 보내면 기억
res = main.sync_hideout(main.HideoutSyncRequest(levels={"5d484fc0654e76006657e0ab": 2}, mode="pve"))
eq("동기화 응답에 모드", (res["ok"], res["count"], res["mode"]), (True, 1, "pve"))
eq("파일로도 저장", json.loads((state / "app_quest_mode.json").read_text(encoding="utf-8")), {"mode": "pve"})
r = main.progress(None)
eq("auto → 앱 모드(pve)", (r["mode"], r["mode_source"], r["app_mode"]), ("pve", "app", "pve"))
eq("은신처도 같이", r["hideout"], {"5d484fc0654e76006657e0ab": 2})

# 3) 사이트가 모드를 명시하면 그대로(연동된 뒤 사용자가 사이트에서 서버를 바꾼 경우)
r = main.progress("regular")
eq("명시 regular → pvp", (r["mode"], r["mode_source"], r["app_mode"]), ("pvp", "request", "pve"))
eq("명시 season", main.progress("season")["mode"], "season")

# 4) 앱 표시 서버 이름(pvp/pve/season)·카탈로그 이름(pvp-season) 모두 흡수, 이상한 값은 pvp
for sent, want in (("season", "season"), ("pvp-season", "season"), ("pvp", "pvp"), ("weird", "pvp")):
    main.sync_hideout(main.HideoutSyncRequest(levels={}, mode=sent))
    eq(f"앱 모드 {sent!r} → {want}", main.progress(None)["mode"], want)

# 5) 모드 없이 온 예전 형식 요청은 기억한 모드를 지우지 않는다
main.sync_hideout(main.HideoutSyncRequest(levels={}, mode="pve"))
main.sync_hideout(main.HideoutSyncRequest(levels={"x": 1}))
eq("모드 없는 동기화는 모드 유지", main.progress(None)["mode"], "pve")

# 6) 사이드카만 다시 떠도(메모리 초기화) 파일에서 복원
main._app_mode_cache = None
eq("재시작 뒤 파일에서 복원", main.progress(None)["app_mode"], "pve")
(state / "app_quest_mode.json").write_text("{broken", encoding="utf-8")
main._app_mode_cache = None
eq("깨진 파일이면 모름 → pvp", (main.progress(None)["mode"], main.progress(None)["app_mode"]), ("pvp", None))

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
