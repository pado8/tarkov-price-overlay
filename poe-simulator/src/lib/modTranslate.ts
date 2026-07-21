"use client";

// 아이템 모드 텍스트를 카카오 공식 한글 스탯 표기로 번역.
// 데이터: public/data/mods-ko.json (scripts/fetch-mods.mjs 생성) — 정규화 EN → KR 템플릿.
// 한국어일 때만 1회 fetch해서 캐시. 매칭 실패 시 영문 폴백(잘못된 번역보다 안전).

import { useEffect, useState } from "react";

type ModMap = Record<string, string>;

let cache: ModMap | null = null;
let inflight: Promise<ModMap> | null = null;

async function load(): Promise<ModMap> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/data/mods-ko.json")
      .then((r) => (r.ok ? r.json() : { mods: {} }))
      .then((j) => {
        cache = (j.mods ?? {}) as ModMap;
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache;
      });
  }
  return inflight;
}

// 값 토큰: 단일 숫자 또는 괄호 범위 "(60-80)"/"60-80"(소수·부호 포함)을 하나의 #로.
// 유니크 모드는 poe.ninja에서 범위 표기로 오므로(예: "+(154-220)% increased Armour") 범위를 한 토큰으로 처리.
const VALUE = () => /\(?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\)?/g;
// 끝 마커 괄호 제거(빌드 스크립트와 동일 규칙). "(crafted)"/"(implicit)"는 파서가 이미 제거함.
const stripMarker = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
const normalize = (s: string) => stripMarker(s).replace(VALUE(), "#").trim();

/** 단일 모드 라인 번역. 맵 미로드/미매칭이면 원문 반환. */
export function translateModWith(map: ModMap | null, line: string): string {
  if (!map) return line;
  const tpl = map[normalize(line)];
  if (!tpl) return line;
  const nums = line.match(VALUE()) ?? [];
  let i = 0;
  return tpl.replace(/#/g, () => nums[i++] ?? "#");
}

/** 한국어일 때 모드 번역 맵을 로드해 반환. en이면 null. */
export function useModTranslator(lang: string) {
  const [map, setMap] = useState<ModMap | null>(cache);
  useEffect(() => {
    if (lang !== "ko") return;
    let alive = true;
    load().then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, [lang]);
  return lang === "ko" ? map : null;
}

// ---------- 베이스 타입 번역 (bases-ko.json, 정확 매칭) ----------

let baseCache: ModMap | null = null;
let baseInflight: Promise<ModMap> | null = null;

async function loadBases(): Promise<ModMap> {
  if (baseCache) return baseCache;
  if (!baseInflight) {
    baseInflight = fetch("/data/bases-ko.json")
      .then((r) => (r.ok ? r.json() : { bases: {} }))
      .then((j) => {
        baseCache = (j.bases ?? {}) as ModMap;
        return baseCache;
      })
      .catch(() => {
        baseCache = {};
        return baseCache;
      });
  }
  return baseInflight;
}

/** 베이스 타입 영문→한글. 미매칭(이미 한글이거나 미등록)이면 원문 반환. */
export function translateBaseWith(map: ModMap | null, base: string): string {
  if (!map) return base;
  return map[base] ?? base;
}

/** 한국어일 때 베이스 타입 맵을 로드해 반환. en이면 null. */
export function useBaseTranslator(lang: string) {
  const [map, setMap] = useState<ModMap | null>(baseCache);
  useEffect(() => {
    if (lang !== "ko") return;
    let alive = true;
    loadBases().then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, [lang]);
  return lang === "ko" ? map : null;
}
