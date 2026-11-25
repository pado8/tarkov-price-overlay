"""같은 퀘스트의 서로 다른 목표가 같은 자리에 있으면 지도 점 하나로(radar._merge_same_task_spots) — 네트워크·게임 없이.
실행: .venv/Scripts/python.exe test_quest_merge.py"""
import sys

import radar

fails = 0


def eq(name, got, want):
    global fails
    ok = got == want
    fails += 0 if ok else 1
    print(("OK   " if ok else "FAIL ") + name)
    if not ok:
        print("     got ", got)
        print("     want", want)


def q(task, x, z, objective, obj, y=0.0, optional=False, keys=None):
    return {"kind": "quest", "name": task, "task": task, "x": x, "y": y, "z": z, "dist": 0.0,
            "objective": objective, "obj": obj, "optional": optional, "keys": keys}


# 11-25 세관 '써스티 - 배달': 은닉 장소 찾기 + 프로판 탱크 숨기기가 같은 자리(0m) → 한 점
m = radar._merge_same_task_spots([q("thirsty", 10, 10, "은닉 장소 찾기", "o1"), q("thirsty", 10, 10, "프로판 탱크 숨기기", "o2")])
eq("같은 퀘스트·같은 자리 → 한 점", len(m), 1)
eq("목표 문구는 ' / ' 로 이음", m[0]["objective"], "은닉 장소 찾기 / 프로판 탱크 숨기기")
eq("목표 id 는 objs 에 다", m[0]["objs"], ["o1", "o2"])

# 3m 넘게 떨어지면 따로(약사 3.7m 같은 경우는 다른 자리일 수 있다)
eq("3m 넘게 떨어지면 따로", len(radar._merge_same_task_spots([q("t", 0, 0, "a", "o1"), q("t", 3.7, 0, "b", "o2")])), 2)
# 다른 퀘스트는 같은 자리여도 따로(이름표·숨기기가 퀘스트 단위)
eq("다른 퀘스트는 같은 자리여도 따로", len(radar._merge_same_task_spots([q("a", 0, 0, "x", "o1"), q("b", 0, 0, "y", "o2")])), 2)
# 다른 층(높이 2m 넘게)은 따로
eq("높이가 다르면 따로", len(radar._merge_same_task_spots([q("t", 0, 0, "a", "o1", y=0), q("t", 0, 0, "b", "o2", y=5)])), 2)
# 선택 목표는 둘 다 선택일 때만 선택 · 열쇠는 합침(중복 없이)
m = radar._merge_same_task_spots([q("t", 0, 0, "a", "o1", optional=True, keys=["K1"]), q("t", 1, 0, "b", "o2", optional=False, keys=["K1", "K2"])])
eq("선택 여부·열쇠 합침", (m[0]["optional"], m[0]["keys"]), (False, ["K1", "K2"]))
# 같은 문구는 두 번 안 붙임 · 퀘스트 아닌 대상은 손대지 않음
m = radar._merge_same_task_spots([q("t", 0, 0, "a", "o1"), q("t", 0, 0, "a", "o2"), {"kind": "extract", "name": "E", "x": 0, "y": 0, "z": 0}])
eq("같은 문구 한 번 · 탈출구는 그대로", (len(m), m[0]["objective"], m[1]["kind"]), (2, "a", "extract"))

print("\n" + ("전부 통과" if not fails else f"{fails}건 실패"))
sys.exit(1 if fails else 0)
