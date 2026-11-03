"""진단용 캡처 저장 시험(개발 PC 전용 기능). 실행: .venv/Scripts/python.exe test_diag_capture.py
플래그 없으면 아무것도 안 쓰고, 플래그 파일이 있으면 PNG + log.jsonl 한 줄이 생겨야 한다."""
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

tmp = Path(tempfile.mkdtemp(prefix="tpo-diag-"))
os.environ["TPO_DIAG_DIR"] = str(tmp)
os.environ.pop("TARKOV_DIAG_CAPTURE", None)
os.environ["TPO_CATALOG_DIR"] = str(tmp / "catalog")

import main  # noqa: E402  (환경변수 뒤에)

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


img = np.zeros((93, 400, 4), dtype=np.uint8)  # mss 모양(BGRA)
img[:, :, 2] = 200  # 붉게
price = {"name": "Salewa first aid kit", "id": "544fb45d4bdc2dee738b4568", "matched_from": "Salewa"}

# 1) 플래그 없음 → 아무것도 안 생김
main._diag_save("primary", 10, 20, 400, 93, img, ["Salewa"], "Salewa", price, "ko", "pve")
eq("플래그 없으면 폴더도 안 생김", (tmp / "diag").exists(), False)

# 2) 플래그 파일 → PNG + jsonl
(tmp / "diag_capture.on").write_text("", encoding="utf-8")
main._diag_save("primary", 10, 20, 400, 93, img, ["Salewa", "응급"], "Salewa 응급", price, "ko", "pve")
pngs = sorted((tmp / "diag").glob("*_primary.png"))
eq("PNG 1장", len(pngs), 1)
rec = json.loads((tmp / "diag" / "log.jsonl").read_text(encoding="utf-8").strip().splitlines()[-1])
eq("기록 내용", (rec["label"], rec["region"], rec["fragments"], rec["matched"], rec["item_id"], rec["lang"]),
   ("primary", [10, 20, 400, 93], ["Salewa", "응급"], "Salewa first aid kit", "544fb45d4bdc2dee738b4568", "ko"))
from PIL import Image  # noqa: E402
im = Image.open(pngs[0]); eq("PNG 크기·색(BGRA→RGB)", (im.size, im.getpixel((0, 0))[:3]), ((400, 93), (200, 0, 0)))

# 3) 못 맞춘 조회도 남긴다(실패 사례가 QA 의 핵심)
main._diag_save("mirror", 0, 0, 400, 93, img, [], "", {"name": None}, "en", "regular")
lines = (tmp / "diag" / "log.jsonl").read_text(encoding="utf-8").strip().splitlines()
eq("실패 조회도 기록", (len(lines), json.loads(lines[-1])["matched"]), (2, None))

# 4) 플래그 지우면 바로 꺼짐
(tmp / "diag_capture.on").unlink()
main._diag_save("primary", 0, 0, 400, 93, img, ["x"], "x", price, "ko", "pve")
eq("플래그 지우면 더 안 씀", len(list((tmp / "diag").glob("*.png"))), 2)

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
