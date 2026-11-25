"""story_progress.py 시험 — 네트워크·게임 없이. 실행: .venv/Scripts/python.exe test_story_progress.py
로그 줄은 2026-11-03 사용자 output_000.log 에서 모양 그대로 가져왔다."""
import sys
import tempfile
from pathlib import Path

import story_progress as sp

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


CH = "68cbd33676fe74b1e80bfd91"  # Tour
CH2 = "68da36cf7cff54fc6109874a"  # Batya
OTHER = "6757f86d00000000000000ff"  # 상인 퀘스트(챕터 아님) — 같은 경고를 내지만 무시해야 한다
L = "{d} {h}.721|1.3.0.0.48484|Warn|output|<b>Quest.</b> Can't find condition for target {t} quest id: {c}"
A, B, C, D = "6895bf1e000000000000000a", "6895bf42000000000000000b", "68c6a4ec000000000000000c", "68caba41000000000000000d"

# 1) 파서 — 같은 초 = 한 묶음, 다른 초 = 다른 묶음, 다른 줄은 무시
text = "\n".join([L.format(d="2026-11-03", h="01:40:32", t=A, c=CH), L.format(d="2026-11-03", h="01:40:32", t=B, c=CH),
                  "2026-11-03 01:40:32.900|x|Info|output|other", L.format(d="2026-11-03", h="01:53:10", t=B, c=CH)])
blocks = sp.parse_output_log(text)
eq("묶음 2개(초 단위)", [(ts, {k: sorted(v) for k, v in s.items()}) for ts, s in blocks],
   [("2026-11-03 01:40:32", {CH: [A, B]}), ("2026-11-03 01:53:10", {CH: [B]})])
eq("폴더 이름 → 시각·버전", sp.folder_meta("log_2026.11.03_1-39-48_1.3.0.0.48484"), ("2026-11-03 01:39:48", "1.3.0.0.48484"))

tmp = Path(tempfile.mkdtemp(prefix="tpo-story-"))


def mk(name, blocks_by_chapter):
    """blocks_by_chapter = [{챕터: [대상…]}…] 묶음 순서대로. 묶음 시각 = 폴더 날짜 01:4i:00"""
    d = tmp / name; d.mkdir()
    date = name[4:14].replace(".", "-")
    lines = []
    for i, blk in enumerate(blocks_by_chapter):
        for ch, ts in blk.items():
            for t in ts:
                lines.append(L.format(d=date, h=f"01:{40 + i:02d}:00", t=t, c=ch))
    (d / f"{name[4:]} output_000.log").write_text("\n".join(lines), encoding="utf-8")
    return d


# 2) 같은 버전 세션 3개: [A,B,C] → 레이드 뒤 묶음에서 A 빠짐([B,C]) → 다음 세션 [C]. 바티야는 3번째 세션에서 시작(D 하나), 상인 퀘스트 경고는 무시
f1 = mk("log_2026.10.25_22-05-10_1.3.0.0.48484", [{CH: [A, B, C], OTHER: [A]}])
f2 = mk("log_2026.10.26_0-32-10_1.3.0.0.48484", [{CH: [A, B, C]}, {OTHER: [B]}, {CH: [B, C]}])
f3 = mk("log_2026.11.03_1-39-48_1.3.0.0.48484", [{CH: [C]}, {CH2: [D]}])
cache = tmp / "cache.json"
s = sp.StoryProgress(cache)
s.scan([f1, f2, f3])
p = s.progress({CH: "tour", CH2: "batya", "ffffffffffffffffffffffff": "boreas"})
eq("하위 전체·남은 것", (p["tour"]["all"], p["tour"]["missing"]), (sorted([A, B, C]), [C]))
eq("받은 순서·시각(세션 안 묶음에서 바로)", [(e["id"], e["at"]) for e in p["tour"]["entered"]], [(A, "2026-10-26 01:42:00"), (B, "2026-11-03 01:40:00")])
eq("방금 시작한 챕터: 받은 것 없음·시작 시각", (p["batya"]["entered"], p["batya"]["missing"], p["batya"]["since"]), ([], [D], "2026-11-03 01:41:00"))
eq("경고 없는 챕터는 빠짐 · 상인 퀘스트 무시", ("boreas" in p, OTHER in p), (False, False))
eq("캐시 파일 생김", cache.exists(), True)

# 3) 캐시: 크기 같으면 다시 안 읽음 — 파일을 지워도 결과 유지
(f2 / "2026.10.26_0-32-10_1.3.0.0.48484 output_000.log").unlink()
s2 = sp.StoryProgress(cache)
s2.scan([f1, f2, f3])
eq("크기 같은 폴더는 캐시 사용", [e["id"] for e in s2.progress({CH: "tour"})["tour"]["entered"]], [A, B])

# 4) 게임 버전이 바뀐 뒤 첫 묶음에 전에 없던 하위(B — 받았던 것)가 나오면 그 챕터를 처음부터 다시 센다(패치로 하위 구성이 달라짐)
f4 = mk("log_2026.11.04_1-00-00_1.3.1.0.49000", [{CH: [B, C]}])
s.scan([f4])
p4 = s.progress({CH: "tour"})
eq("새 버전만 봄 → 받은 것 없음·남은 것 [B,C]", ([e["id"] for e in p4["tour"]["entered"]], p4["tour"]["missing"]), ([], [B, C]))

# 5) 리셋(와이프·프레스티지): 받았다고 본 것이 다시 나타나면 그 챕터 기록을 비운다
f5 = mk("log_2026.11.05_1-00-00_1.3.1.0.49000", [{CH: [C]}])          # B 받음
f6 = mk("log_2026.11.06_1-00-00_1.3.1.0.49000", [{CH: [A, B, C]}])    # 와이프 → 전부 다시
f7 = mk("log_2026.11.07_1-00-00_1.3.1.0.49000", [{CH: [B, C]}])       # 다시 A 받음
s.scan([f5, f6, f7])
p7 = s.progress({CH: "tour"})
eq("리셋 뒤엔 그 뒤 기록만", ([(e["id"], e["at"][:10]) for e in p7["tour"]["entered"]], p7["tour"]["since"]), ([(A, "2026-11-07")], "2026-11-06 01:40:00"))

# 6) 자동 선택: 아직 안 받은 것이 남은 챕터만, 지도 목표 있는 것 중 최근 2개; 방금 시작한 챕터는 빈 목록
prog = {"tour": {"all": [A, B, C, D], "missing": [D], "entered": [{"id": A, "at": "1"}, {"id": B, "at": "2"}, {"id": C, "at": "3"}], "since": "0"},
        "done": {"all": [A], "missing": [], "entered": [{"id": A, "at": "1"}], "since": "0"},
        "fresh": {"all": [A], "missing": [A], "entered": [], "since": "3"}}
eq("최근 2개 + 방금 시작은 빈 목록", sp.pick_auto(prog, recent=2), {"tour": [B, C], "fresh": []})
eq("지도 목표 있는 것만(C 는 없음) → A, B", sp.pick_auto(prog, recent=2, has_marks={A, B}), {"tour": [A, B], "fresh": []})
eq("기본은 최근 1개(11-25 끝낸 앞 단계가 같이 나오던 것)", sp.pick_auto(prog), {"tour": [C], "fresh": []})
prog_all = {"tour": {"all": [A, B], "missing": [], "entered": [{"id": A, "at": "1"}, {"id": B, "at": "2"}], "since": "0", "all_received": True}}
eq("다 받은 챕터(all_received)도 진행 중으로 냄", sp.pick_auto(prog_all), {"tour": [B]})

# 7) 11-24 한 번의 평가가 초 경계에 걸쳐 갈라짐(사용자 로그 바티야 26+6) → 한 묶음으로. 갈라진 앞 조각을 '받음'·뒤를 '리셋'으로 읽으면 안 된다
def line(d, h, t, c=CH):
    return L.format(d=d, h=h, t=t, c=c)


split = "\n".join([line("2026-11-08", "02:53:14", A), line("2026-11-08", "02:53:14", B), "2026-11-08 02:53:14.990|x|Info|output|other",
                   line("2026-11-08", "02:53:15", C)])
eq("초 경계에 갈라진 평가 = 한 묶음", [(ts, {k: sorted(v) for k, v in s_.items()}) for ts, s_ in sp.parse_output_log(split)],
   [("2026-11-08 02:53:14", {CH: sorted([A, B, C])})])
g = tmp / "log_2026.11.08_1-00-00_1.3.0.0.48484"
g.mkdir()
(g / "2026.11.08_1-00-00_1.3.0.0.48484 output_000.log").write_text("\n".join([
    line("2026-11-08", "01:40:00", A), line("2026-11-08", "01:40:00", B), line("2026-11-08", "01:40:00", C),  # 전체
    line("2026-11-08", "01:41:59", A), line("2026-11-08", "01:41:59", B), line("2026-11-08", "01:42:00", C),  # 갈라진 전체
    line("2026-11-08", "01:50:00", B), line("2026-11-08", "01:50:00", C)]), encoding="utf-8")                    # A 받음
s7 = sp.StoryProgress(None)
s7.scan([g])
p7b = s7.progress({CH: "tour"})["tour"]
eq("갈라진 묶음 뒤에도 진행 유지(A 받음 · 시작 시각 그대로)", ([e["id"] for e in p7b["entered"]], p7b["since"]), ([A], "2026-11-08 01:40:00"))

# 8) 11-24 게임 패치 뒤에도 구성이 같으면 받은 기록을 잇는다(전엔 새 버전 세션만 봐서 패치 전에 받은 것이 지워졌다)
h1 = mk("log_2026.11.09_1-00-00_1.3.0.0.48484", [{CH: [A, B, C]}, {CH: [B, C]}])  # A 받음
h2 = mk("log_2026.11.10_1-00-00_1.3.0.2.48779", [{CH: [B, C]}, {CH: [C]}])       # 패치 · 구성 같음 → 이어서 B 받음
s8 = sp.StoryProgress(None)
s8.scan([h1, h2])
p8 = s8.progress({CH: "tour"})["tour"]
eq("패치 뒤 구성 같음 → 패치 전 기록 유지", ([e["id"] for e in p8["entered"]], p8["missing"], p8["since"][:10]), ([A, B], [C], "2026-11-09"))
h3 = mk("log_2026.11.11_1-00-00_1.4.0.0.50000", [{CH: [C, D]}])                  # 다음 패치에서 새 하위 D 가 생김 → 다시 셈
s8.scan([h3])
p8b = s8.progress({CH: "tour"})["tour"]
eq("패치 뒤 새 하위가 생기면 그 챕터만 다시 셈", ([e["id"] for e in p8b["entered"]], p8b["missing"], p8b["since"][:10]), ([], sorted([C, D]), "2026-11-11"))
k1 = mk("log_2026.07.08_1-00-00_1.2.0.0.40000", [{CH2: [D, A]}])                # 옛 버전에서만 나오고 많이 남은 채 끊긴 챕터(와이프 전)
k2 = mk("log_2026.11.12_1-00-00_1.3.0.2.48779", [{CH: [A, B]}])
s9 = sp.StoryProgress(None)
s9.scan([k1, k2])
eq("가장 새 버전 세션에 안 나온 챕터는 뺌", sorted(s9.progress({CH: "tour", CH2: "batya"})), ["tour"])
k3 = tmp / "log_2026.11.25_16-03-28_1.3.5.0.48914"  # 11-25 패치 뒤 첫 접속 — 경고가 찍히기 전(1분 반)
k3.mkdir()
(k3 / "2026.11.25_16-03-28_1.3.5.0.48914 output_000.log").write_text("2026-11-25 16:03:30.000|x|Info|output|start", encoding="utf-8")
s9.scan([k3])
eq("새 버전에 아직 경고가 없으면 직전 버전 기준으로 냄", sorted(s9.progress({CH: "tour", CH2: "batya"})), ["tour"])
# 10) 11-25 사용자 스크린샷(여정): 남은 하위가 1개로 줄고 경고가 끊겼는데 다른 챕터 경고는 계속 → 마지막 하위까지 받음 = 진행 중
m1 = mk("log_2026.11.02_1-00-00_1.3.0.0.48484", [{CH: [A, B], CH2: [C, D]}, {CH: [B], CH2: [C, D]}])  # tour: A 받음, B 하나 남음
m2 = mk("log_2026.11.04_1-00-00_1.3.0.0.48484", [{CH2: [C, D]}])                                    # tour 경고 끊김(B 도 받음)
m3 = mk("log_2026.11.25_1-00-00_1.3.5.0.48914", [{CH2: [C, D]}])
s10 = sp.StoryProgress(None)
s10.scan([m1, m2, m3])
p10 = s10.progress({CH: "tour", CH2: "batya"})
eq("다 받고 끊긴 챕터 = 진행 중(남은 것 없음·마지막 하위까지 받음)",
   ("tour" in p10, p10.get("tour", {}).get("missing"), [e["id"] for e in p10.get("tour", {}).get("entered", [])], p10.get("tour", {}).get("all_received")),
   (True, [], [A, B], True))
eq("다 받음 판정 뒤 지도 자동은 마지막 하위", sp.pick_auto(p10)["tour"], [B])
s11 = sp.StoryProgress(None)
s11.scan([mk("log_2026.11.02_2-00-00_1.3.0.0.48484", [{CH: [A, B]}, {CH: [B]}])])                # 뒤로 아무 경고도 없음
eq("뒤에 다른 경고가 하나도 없으면 다 받음으로 보지 않음(아직 그 세션)", s11.progress({CH: "tour"})["tour"]["missing"], [B])
cache2 = tmp / "v2cache.json"
cache2.write_text('{"folders": {"x": {"size": 1, "blocks": []}}}', encoding="utf-8")
eq("판(v)이 다른 옛 캐시는 버림", sp.StoryProgress(cache2)._folders, {})

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
