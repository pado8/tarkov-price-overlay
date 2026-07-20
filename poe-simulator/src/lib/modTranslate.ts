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

// 끝 마커 괄호 제거(빌드 스크립트와 동일 규칙). "(crafted)"/"(implicit)"는 파서가 이미 제거함.
const stripMarker = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
const normalize = (s: string) => stripMarker(s).replace(/\d+(?:\.\d+)?/g, "#").trim();

/** 단일 모드 라인 번역. 맵 미로드/미매칭이면 원문 반환. */
export function translateModWith(map: ModMap | null, line: string): string {
  if (!map) return line;
  const tpl = map[normalize(line)];
  if (!tpl) return line;
  const nums = line.match(/\d+(?:\.\d+)?/g) ?? [];
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
