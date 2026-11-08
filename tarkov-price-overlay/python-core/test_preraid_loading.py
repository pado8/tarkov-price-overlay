"""맵 로딩 화면에서 맵 미리 알기(11-08) 시험. 실행: PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe test_preraid_loading.py"""
import radar

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))


NOW = 1_000_000.0
cus = (NOW - 60, "customs_preset", "bigmap")
city = (NOW - 3000, "city_preset", "tarkovstreets")
evs = [city, cus]

eq("스크린샷 없음 + 1분 전 로딩 → 그 로딩", radar.loading_after(evs, None, NOW), cus)
eq("로딩 전에 찍은 스크린샷 → 새 레이드 로딩", radar.loading_after(evs, NOW - 600, NOW), cus)
eq("로딩 뒤에 찍은 스크린샷 → 없음(이미 레이드 안)", radar.loading_after(evs, NOW - 30, NOW), None)
eq("스크린샷이 로딩 5초 전 안쪽 → 그 스크린샷 레이드로(map_event_at 과 같은 경계)", radar.loading_after(evs, NOW - 64, NOW), None)
eq("스크린샷이 로딩 6초 전 → 새 레이드", radar.loading_after(evs, NOW - 66, NOW), cus)
eq("2시간 넘은 로딩 → 없음", radar.loading_after([(NOW - 2 * 3600 - 1, "customs_preset", "bigmap")], None, NOW), None)
eq("맵 이름 모르는 로딩(slug 빈칸) → 없음", radar.loading_after([(NOW - 10, "hideout_preset", "")], None, NOW), None)
eq("로그 없음 → 없음", radar.loading_after([], None, NOW), None)
eq("순서 섞여 있어도 가장 늦은 로딩", radar.loading_after([cus, city], NOW - 600, NOW), cus)

# 진영 줄은 이번 레이드 로딩 뒤 것만(11-08 실측: 세관 레이드에 40분 전 시내 레이드 줄이 쓰이던 것)
SEL, OTHER = "a" * 24, "b" * 24
sides = [(NOW - 3000, "sel", SEL), (NOW - 2900, "raid", OTHER)]  # 지난 레이드 = 스캐브
eq("since 없음 → 지난 레이드 줄 그대로(옛 동작)", radar.raid_side_at(sides, NOW, None), "scav")
eq("이번 로딩 뒤 진영 줄 없음 → None", radar.raid_side_at(sides, NOW, since=NOW - 60), None)
eq("이번 로딩 뒤 진영 줄(본 프로필) → pmc", radar.raid_side_at(sides + [(NOW - 30, "raid", SEL)], NOW, since=NOW - 60), "pmc")

# 실제 로그(이 PC) — 있으면 마지막 로딩이 맵 slug 로 읽히는지만 본다
try:
    import quest_tracker as qt

    inst = qt.get_tracker()._effective_install_path()
    folders = qt._list_log_folders(inst)[-3:] if inst else []
    real = radar._LogMaps().events(folders)
    if real:
        last = max(real)
        import time

        print(f"   (실제 로그 마지막 로딩: {time.strftime('%m-%d %H:%M:%S', time.localtime(last[0]))} {last[1]} → {last[2]!r})")
        eq("실제 로그 마지막 로딩에 맵 slug 있음", bool(last[2]), True)
    else:
        print("   (실제 로그 없음 — 건너뜀)")
except Exception as e:  # noqa: BLE001
    print(f"   (실제 로그 확인 건너뜀: {e!r})")

print("\n" + ("전부 통과" if not fails else f"실패 {fails}"))
raise SystemExit(1 if fails else 0)
