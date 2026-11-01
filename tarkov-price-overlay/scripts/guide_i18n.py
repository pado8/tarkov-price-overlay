"""탈콥 가이드 언어판(en/ru) — 생성기 소스의 한글 구간을 번역표로 치환한 뒤 모듈로 실행한다.

왜 이렇게 하나: guide_static.py 는 한국어 문구가 f-string 안에 수백 개 박혀 있어 함수마다 번역 인자를 끼우면
생성기 전체를 다시 써야 한다. 대신 소스를 tokenize 로 읽어 문자열 토큰(STRING·FSTRING_MIDDLE) 안의
'한글 구간'(따옴표·꺾쇠·중괄호·줄바꿈·백슬래시로 끊기는 조각)만 번역표(guide_i18n/<lang>.json, ko→번역)로
바꾸고 exec 한다. 데이터 유래 문구(아이템·퀘스트·맵 이름)는 tarkov.dev 해당 로케일이 맡는다.

- 추출: python scripts/guide_i18n.py extract → scripts/guide_i18n/ko_runs.json (번역할 구간 목록, 출현 위치 포함)
- 점검: python scripts/guide_i18n.py check en → 번역표에 없는 구간 목록
- 빌드: GUIDE_LANG=en python scripts/build_guide.py (build_guide 가 load_module 로 번역된 guide_static 을 쓴다)
- 검증: 생성된 /guide/en/ 에 한글이 남아 있으면 번역표 누락 — build_guide 끝에서 센다.

규칙: 구간 안의 HTML 태그·숫자·제품명은 번역문에도 그대로. 독스트링(문장 단독 문자열)과 주석은 건드리지 않는다.
"""
from __future__ import annotations

import io
import json
import re
import sys
import tokenize
import types
from pathlib import Path

RUN = re.compile(r"[^\"'<>{}\n\\`]*[가-힣][^\"'<>{}\n\\`]*")
HAN = re.compile(r"[가-힣]")
ROOT = Path(__file__).resolve().parent
I18N_DIR = ROOT / "guide_i18n"
SOURCES = [ROOT / "guide_static.py", ROOT.parent / "python-core" / "extract_conditions.py"]
TEMPLATES = [ROOT / "guide_templates" / n for n in ("quests.html", "kappa.html", "keys.html")]


def load_table(lang: str) -> dict:
    f = I18N_DIR / f"{lang}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def translate_text(text: str, table: dict, missing: set | None = None, edge_before: str = "", edge_after: str = "") -> str:
    """텍스트 안의 한글 구간을 번역표로 바꾼다. 앞뒤 공백은 그대로 두고, 표에 없으면 원문 유지(+missing 기록).
    edge_before/after = text 바깥 바로 앞뒤 글자(f-string 조각처럼 토큰 하나만 넘길 때 띄어쓰기 판단용)."""
    def rep(m):
        s = m.group(0)
        core = s.strip()
        if not core:
            return s
        t = table.get(core)
        if t is None:
            if missing is not None:
                missing.add(core)
            return s
        lead = s[: len(s) - len(s.lstrip())]
        trail = s[len(s.rstrip()):]
        # 한국어는 "{n}개"·"보스{n}"처럼 자리표시자에 조사를 바로 붙이지만 영어·러시아어는 띄어야 한다.
        # 앞뒤가 자리표시자(})·숫자이고 번역이 글자로 시작/끝나면 공백을 끼운다.
        before = text[m.start() - 1] if m.start() > 0 else edge_before
        after = text[m.end()] if m.end() < len(text) else edge_after
        prev_txt = text[: m.start()] if m.start() > 0 else edge_before
        next_txt = text[m.end():] if m.end() < len(text) else edge_after
        closing_before = before == ">" and re.search(r"</\w+>$", prev_txt or "") is not None   # "</b>텍스트" → 띄움, "<span>텍스트"는 그대로
        opening_after = after == "<" and re.match(r"<(?!/)\w", next_txt or "") is not None       # "텍스트<b>" → 띄움, "텍스트</span>"는 그대로
        if not lead and before and (before == "}" or before.isdigit() or closing_before) and t[:1].isalpha():
            lead = " "
        if not trail and after and (after == "{" or after.isdigit() or opening_after) and t[-1:].isalpha():
            trail = " "
        return lead + t + trail
    return RUN.sub(rep, text)


def _string_spans(src: str):
    """번역 대상 문자열 토큰의 (시작 오프셋, 끝 오프셋). 독스트링은 제외."""
    line_off = [0]
    for line in src.split("\n"):
        line_off.append(line_off[-1] + len(line) + 1)

    def off(pos):
        return line_off[pos[0] - 1] + pos[1]

    prev = None
    for t in tokenize.generate_tokens(io.StringIO(src).readline):
        kind = tokenize.tok_name.get(t.type, "")
        if (t.type == tokenize.STRING or kind == "FSTRING_MIDDLE") and HAN.search(src[off(t.start):off(t.end)]):
            docstring = t.type == tokenize.STRING and prev in (None, "NEWLINE", "INDENT", "DEDENT")
            if not docstring:
                yield off(t.start), off(t.end)
        if kind not in ("NL", "COMMENT"):
            prev = kind


def transform_source(src: str, table: dict, missing: set | None = None) -> str:
    out = []
    last = 0
    for a, b in _string_spans(src):
        out.append(src[last:a])
        out.append(translate_text(src[a:b], table, missing, edge_before=src[a - 1] if a > 0 else "", edge_after=src[b] if b < len(src) else ""))
        last = b
    out.append(src[last:])
    return "".join(out)


def load_module(path: Path, modname: str, table: dict, missing: set | None = None) -> types.ModuleType:
    """소스를 번역해 모듈로 실행하고 sys.modules 에 등록한다(같은 이름의 import 가 이걸 받게)."""
    src = path.read_text(encoding="utf-8")
    new = transform_source(src, table, missing)
    mod = types.ModuleType(modname)
    mod.__file__ = str(path)
    sys.modules[modname] = mod
    exec(compile(new, str(path), "exec"), mod.__dict__)
    return mod


def extract_runs() -> list[dict]:
    """번역할 한글 구간 목록(소스 문자열 토큰 + 템플릿 본문)."""
    segs: dict[str, list[str]] = {}
    for f in SOURCES:
        src = f.read_text(encoding="utf-8")
        for a, b in _string_spans(src):
            line = src.count("\n", 0, a) + 1
            for m in RUN.finditer(src[a:b]):
                core = m.group(0).strip()
                if core:
                    segs.setdefault(core, []).append(f"{f.name}:{line}")
    for f in TEMPLATES:
        for i, line in enumerate(f.read_text(encoding="utf-8").split("\n"), 1):
            if HAN.search(line):
                for m in RUN.finditer(line):
                    core = m.group(0).strip()
                    if core:
                        segs.setdefault(core, []).append(f"{f.name}:{i}")
    return [{"ko": k, "where": v[:4], "n": len(v)} for k, v in segs.items()]


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("extract", "check"):
        print(__doc__)
        return 2
    I18N_DIR.mkdir(exist_ok=True)
    runs = extract_runs()
    if argv[0] == "extract":
        (I18N_DIR / "ko_runs.json").write_text(json.dumps(runs, ensure_ascii=False, indent=0), encoding="utf-8")
        print(f"구간 {len(runs)}개, 글자 {sum(len(r['ko']) for r in runs)} → {I18N_DIR / 'ko_runs.json'}")
        return 0
    lang = argv[1]
    table = load_table(lang)
    miss = [r["ko"] for r in runs if r["ko"] not in table]
    print(f"[{lang}] 구간 {len(runs)} 중 번역 없음 {len(miss)}")
    for k in miss[:60]:
        print("  ", k[:100])
    return 1 if miss else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
