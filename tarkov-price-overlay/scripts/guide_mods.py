"""무기 모딩(/guide/mods/) 계산 — 언어와 무관한 부분(호환 트리·기본 조립 복원·추천 조립 최적화·수치).

수치 공식(2026-11-05 tarkov.dev 기본 프리셋 164개 전부와 ±1 이내로 일치 확인):
  인체공학 = 무기 기본 ergonomics + Σ 부품 ergonomics
  수직/수평 반동 = 무기 기본 recoilVertical/Horizontal × (1 + Σ 부품 recoilModifier)   (recoilModifier 는 -0.05 = -5%)
  무게 = 무기 weight + Σ 부품 weight
탄약의 반동 보정·숙련도·무게 초과 페널티는 넣지 않는다(페이지에 적는다).

추천 조립 = 칸마다 '그 부품 + 그 아래 칸들의 최선' 점수가 가장 높은 것(트리 DP). 점수 = 반동 감소(%p) + λ × 인체공학.
인체공학·반동 보정이 둘 다 합이라 충돌(conflictingItems)이 없으면 그 λ 에서 정확한 최적이다. 충돌은 고르는 순서대로
이미 고른 부품과 부딪히는 후보를 건너뛰어 피한다(근사).
목표: rec(반동 최소 — λ=0.01, 인체공학은 동점 깨기만)
      erg(인체공학을 낼 수 있는 최대까지(100 넘으면 100) 올린 것 중 반동 최소 — 게임 상한은 공식 확인 못 해 100 초과는 쳐주지 않음)
      bal(인체공학을 기본 조립 이상·최소 60 으로 지키며 반동 최소)
erg·bal 은 λ 를 사다리(LAMS)로 올려 가며 인체공학 조건을 처음 만족하는 조립 = 그 조건에서 반동을 가장 적게 포기한 조립.
구하는 곳: all(플리마켓 또는 상인 현금 구매) · trader(상인 현금 구매만, 등급 무관). 둘 다 못 사는 부품은 추천에서 뺀다.
기본 조립(총을 사면 딸려 오는 부품)은 구하는 곳과 상관없이 쓸 수 있고 값은 0₽ 으로 친다.
필수 칸(required)과 탄창 칸은 반드시 채운다 — 탄창은 기본 조립 탄창보다 용량이 작지 않은 것 중에서(10발 탄창으로 인체공학만 올리는 것 방지).
"""
from __future__ import annotations

import math
from collections import Counter

MOD_TYPES = {"ItemPropertiesWeaponMod", "ItemPropertiesBarrel", "ItemPropertiesScope", "ItemPropertiesMagazine"}
OBJS = ("rec", "erg", "bal")
LAMS = (0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10, 100)
BAL_MIN_ERGO = 60
SRCS = ("all", "trader")
MAX_DEPTH = 12


def _props(it):
    return (it or {}).get("properties") or {}


def is_weapon(it) -> bool:
    p = _props(it)
    return (p.get("propertiesType") == "ItemPropertiesWeapon" and "gun" in (it.get("types") or [])
            and "ergonomics" in p and bool(p.get("slots")))


def is_mod(it) -> bool:
    return _props(it).get("propertiesType") in MOD_TYPES


def slots_of(it) -> list[tuple[str, bool, list[str]]]:
    out = []
    for s in _props(it).get("slots") or []:
        f = s.get("filters") or {}
        ex = set(f.get("excludedItems") or [])
        out.append((s.get("nameId") or "", bool(s.get("required")), [x for x in f.get("allowedItems") or [] if x not in ex]))
    return out


def mod_e(it) -> float:
    p = _props(it)
    v = p.get("ergonomics")
    return float(v if v is not None else (it.get("ergonomicsModifier") or 0))


def mod_r(it) -> float:
    return float(_props(it).get("recoilModifier") or 0)


def flea_price(it):
    if "noFlea" in (it.get("types") or []):
        return None
    return it.get("avg24hPrice") or it.get("lastLowPrice") or None


def trader_offer(it):
    """상인 현금 구매 — 가장 낮은 등급, 같은 등급이면 싼 것. (trader id, LL, 가격₽, 퀘스트 해금 여부)"""
    offs = [o for o in it.get("buyFromTrader") or [] if o.get("priceRUB")]
    if not offs:
        return None
    o = min(offs, key=lambda o: (o.get("minTraderLevel") or 1, o.get("priceRUB")))
    return (o.get("trader"), o.get("minTraderLevel") or 1, int(o["priceRUB"]), 1 if o.get("taskUnlock") else 0)


def is_slot_mag(name: str) -> bool:
    return name.startswith("mod_magazine")


class Modder:
    def __init__(self, items: dict):
        self.items = items
        self.slots = {}
        self.conf: dict[str, set] = {}
        for iid, it in items.items():
            if is_mod(it) or is_weapon(it):
                self.slots[iid] = slots_of(it)
            if it.get("conflictingItems"):
                self.conf[iid] = set(it["conflictingItems"])
        self.weapons = [iid for iid, it in items.items() if is_weapon(it)]
        self._avail = {}
        self.free: set = set()  # 지금 계산 중인 무기의 기본 조립 부품(weapon_report 가 정한다)

    # ── 구하는 곳 ──
    def avail(self, iid, src) -> bool:
        k = (iid, src)
        if k not in self._avail:
            it = self.items.get(iid) or {}
            t = trader_offer(it)
            self._avail[k] = bool(t) if src == "trader" else bool(t or flea_price(it))
        return self._avail[k]

    def cost(self, iid, src):
        if iid in self.free:
            return 0
        it = self.items.get(iid) or {}
        t = trader_offer(it)
        f = flea_price(it) if src == "all" else None
        c = [x for x in ((t[2] if t else None), f) if x]
        return min(c) if c else None

    def cap(self, iid):
        return _props(self.items.get(iid)).get("capacity") or 0

    def conflicts(self, a, chosen) -> bool:
        ca = self.conf.get(a)
        if ca and ca & chosen:
            return True
        return any(a in self.conf.get(x, ()) for x in chosen)

    # ── 점수 ──
    @staticmethod
    def score(e, r, lam):
        return -r * 100 + lam * e

    def own(self, iid, obj):
        it = self.items.get(iid) or {}
        return self.score(mod_e(it), mod_r(it), obj)

    def cands(self, allowed):
        return [c for c in allowed if c in self.slots and is_mod(self.items.get(c))]

    # ── 트리 DP ──
    def run(self, wid, obj, src, min_cap=0):
        memo: dict[str, float] = {}

        def best(iid, stack):
            if iid in memo:
                return memo[iid]
            if len(stack) > MAX_DEPTH:
                return self.own(iid, obj)
            stack = stack | {iid}
            v = self.own(iid, obj)
            for name, req, allowed in self.slots.get(iid, []):
                vs = [best(c, stack) for c in self.slot_pool(name, allowed, src, min_cap) if c not in stack]
                must = req or is_slot_mag(name)
                if vs:
                    v += max(vs) if must else max(0.0, max(vs))
            memo[iid] = v
            return v

        chosen: set = set()
        flags = {"unavail": []}

        def choose(host, stack, depth):
            out = {}
            for idx, (name, req, allowed) in enumerate(self.slots.get(host, [])):
                must = req or is_slot_mag(name)
                pool = [c for c in self.slot_pool(name, allowed, src, min_cap) if c not in stack]
                fallback = False
                if not pool and must:  # 구할 수 있는 게 없으면 아무거나(표시만) — 필수 칸을 비우면 총이 안 된다
                    pool = [c for c in self.cands(allowed) if c not in stack]
                    fallback = True
                ranked = sorted(pool, key=lambda c: (-best(c, stack | {host}), self.cost(c, "all") or 9e9, c))
                for c in ranked:
                    if self.conflicts(c, chosen):
                        continue
                    if not must and best(c, stack | {host}) <= 0:
                        break
                    chosen.add(c)
                    sub = choose(c, stack | {host, c}, depth + 1) if depth < MAX_DEPTH else {}
                    if not must and self.tree_score({0: [c, sub]}, obj) <= 0:  # 충돌로 하위 칸이 비어 이득이 사라졌으면 뺀다
                        chosen.discard(c)
                        self._drop(sub, chosen)
                        continue
                    if fallback:
                        flags["unavail"].append(c)
                    out[idx] = [c, sub]
                    break
            return out

        tree = choose(wid, frozenset({wid}), 0)
        return tree, flags

    def _drop(self, sub, chosen):
        for c, s in sub.values():
            chosen.discard(c)
            self._drop(s, chosen)

    def slot_pool(self, name, allowed, src, min_cap):
        pool = [c for c in self.cands(allowed) if c in self.free or self.avail(c, src)]
        if is_slot_mag(name) and min_cap:
            big = [c for c in pool if self.cap(c) >= min_cap]
            pool = big or pool
        return pool

    # ── 기본 조립 복원(평평한 containsItems → 칸 트리) ──
    def preset_tree(self, wid, contains):
        pool = Counter()
        for c in contains:
            if c.get("item") != wid and c.get("item") in self.items:
                pool[c["item"]] += c.get("count") or 1

        def fill(host, depth):
            out = {}
            for idx, (name, req, allowed) in enumerate(self.slots.get(host, [])):
                al = set(allowed)
                hit = next((c for c in pool if pool[c] > 0 and c in al), None)
                if hit:
                    pool[hit] -= 1
                    out[idx] = [hit, fill(hit, depth + 1) if depth < MAX_DEPTH else {}]
            return out

        t = fill(wid, 0)
        return t, sum(v for v in pool.values() if v > 0)

    def default_preset(self, wid):
        best = None
        for pid, p in self.items.items():
            pp = _props(p)
            if pp.get("propertiesType") == "ItemPropertiesPreset" and pp.get("baseItem") == wid:
                if pp.get("default") or best is None:
                    best = (pid, p)
                    if pp.get("default"):
                        break
        return best

    # ── 수치 ──
    def walk(self, tree, depth=0):
        for idx in sorted(tree, key=int):
            c, sub = tree[idx]
            yield int(idx), c, depth
            yield from self.walk(sub, depth + 1)

    def tree_score(self, tree, obj):
        e = r = 0.0
        for _, c, _ in self.walk(tree):
            it = self.items.get(c) or {}
            e += mod_e(it)
            r += mod_r(it)
        return self.score(e, r, obj)

    def stats(self, wid, tree, src="all"):
        w = self.items[wid]
        p = _props(w)
        e = float(p.get("ergonomics") or 0)
        r = 0.0
        wt = float(w.get("weight") or 0)
        cost = 0
        unknown = 0
        n = 0
        for _, c, _ in self.walk(tree):
            it = self.items.get(c) or {}
            e += mod_e(it)
            r += mod_r(it)
            wt += float(it.get("weight") or 0)
            pr = self.cost(c, src)
            if pr is None:
                unknown += 1
            else:
                cost += pr
            n += 1
        # e 반올림은 조립기(JS Math.round)와 같게 — round() 는 107.25 → 107.2(은행가 반올림)라 페이지와 조립기가 0.1 어긋났다
        return {"e": math.floor(e * 10 + 0.5) / 10, "rv": round((p.get("recoilVertical") or 0) * (1 + r)), "rh": round((p.get("recoilHorizontal") or 0) * (1 + r)),
                "r": round(r * 100, 1), "wt": round(wt, 2), "cost": int(cost), "unk": unknown, "n": n}

    def weapon_report(self, wid):
        """무기 하나: 기본 조립 + 추천 6종(목표 3 × 구하는 곳 2)"""
        dp = self.default_preset(wid)
        dtree, left = self.preset_tree(wid, (dp[1].get("containsItems") or []) if dp else [])
        self.free = {c for _, c, _ in self.walk(dtree)}
        def_stats = self.stats(wid, dtree)
        min_cap = max([self.cap(c) for _, c, _ in self.walk(dtree) if self.cap(c)] or [0])
        builds = {}
        for src in SRCS:
            ladder = []
            for lam in LAMS:
                tree, flags = self.run(wid, lam, src, min_cap)
                ladder.append((lam, tree, flags, self.stats(wid, tree, src)))
            top = min(100.0, max(x[3]["e"] for x in ladder))

            def first_with(target):
                for x in ladder:
                    if x[3]["e"] >= target - 0.05:
                        return x
                return ladder[-1]
            picks = {"rec": ladder[0], "erg": first_with(top),
                     "bal": first_with(min(top, max(def_stats["e"], BAL_MIN_ERGO)))}
            for obj, (lam, tree, flags, st) in picks.items():
                builds[f"{obj}-{src}"] = {"tree": tree, "stats": st, "unavail": flags["unavail"], "lam": lam}
        return {"id": wid, "preset": dp[0] if dp else None, "preset_left": left, "def": dtree,
                "def_stats": def_stats, "builds": builds, "min_cap": min_cap}


def validate(items: dict) -> tuple[int, int, list]:
    """기본 프리셋 수치(tarkov.dev 가 준 ergonomics·recoilVertical)와 우리 공식이 맞는지 — (검사 수, 어긋난 수, 예시)"""
    md = Modder(items)
    n = bad = 0
    ex = []
    for wid in md.weapons:
        dp = md.default_preset(wid)
        if not dp:
            continue
        pp = _props(dp[1])
        if pp.get("ergonomics") is None:
            continue
        tree, left = md.preset_tree(wid, dp[1].get("containsItems") or [])
        s = md.stats(wid, tree)
        n += 1
        if left or abs(s["e"] - pp["ergonomics"]) > 1 or abs(s["rv"] - (pp.get("recoilVertical") or 0)) > 1:
            bad += 1
            if len(ex) < 8:
                ex.append((items[wid].get("normalizedName"), s["e"], pp["ergonomics"], s["rv"], pp.get("recoilVertical"), left))
    return n, bad, ex
