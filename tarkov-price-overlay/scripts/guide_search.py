"""가이드 전체 검색 — 언어판 빌드가 끝난 뒤 만들어진 페이지를 훑어 search.json 색인과 search.js 를 쓴다.

- 페이지: 각 index.html 의 <h1>(퀘스트는 한글명 + 영문명) → 그 페이지로 이동
- 필요 아이템: items/ 표의 줄(data-id·이름·data-s 검색어) → /guide/items/?q=이름 (그 줄만 걸러 보임)
- 열쇠: keys/ 템플릿 데이터의 열쇠 → /guide/keys/?q=이름
- 화면 문구는 search.js 안의 ko/en/ru/zh 표에서 고른다(번역 파이프라인을 타지 않게 index.html 이 아닌 별도 파일).
build_guide.main() 끝에서 apply(out_dir, lang, keys_items) 로 부른다.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

KIND = {"quest": "q", "hideout": "h", "maps": "m", "quests": "t", "mods": "w"}
# 보스 별칭(음역 차이·영문·별명) — 키 = 데이터 mob 이름(bosses 페이지 앵커 b-<키>)
BOSS_ALIAS = {
    "bossBully": "레샬라 리샬라 르샬라 reshala", "bossKojaniy": "슈트르만 슈투르만 샤투른 shturman", "bossGluhar": "글루하 글루하르 glukhar",
    "bossTagilla": "태길라 타길라 tagilla", "bossKilla": "킬라 killa", "bossSanitar": "세니타 사니타르 sanitar",
    "bossBoar": "카반 kaban", "bossKolontay": "콜론타이 kollontay", "bossZryachiy": "즈리야치 즈랴치 zryachiy",
    "bossKnight": "나이트 knight 군즈 goons", "bossPartisan": "파르티잔 partisan", "bossTagillaAgro": "타길라 tagilla",
}
# 무기 모딩 페이지(w) 별칭 — 영문 이름에 든 말 → 한국 커뮤니티 통칭·음역(데이터 이름엔 '모신'·'글록'이 없어 0건이었다, 11-05)
WEAPON_ALIAS = {
    "Mosin": "모신 모신나강 모나강", "Glock": "글록", "Kalashnikov": "칼라시니코프 칼라쉬니코프", "AK-": "에이케이",
    "SVDS": "드라구노프 SVD", "Vector": "벡터", "MP5": "엠피파이브 엠피5", "MP7": "엠피7", "MP9": "엠피9", "Saiga": "사이가",
    "Remington": "레밍턴", "Benelli": "베넬리", "SIG": "시그", "Desert Eagle": "데글 데저트이글", "HK 416": "416 hk416",
    "SCAR": "스카", "VAL": "발 아스발", "VSS": "빈토레즈", "Makarov": "마카로프", "Tokarev": "토카레프", "M1A": "엠원에이",
    "SA-58": "FAL 팔", "RPK": "알피케이", "PKM": "피케이엠", "PKP": "페체네그", "AXMC": "엑스엠씨", "Mk-18": "마크18",
    "Mk47": "머틴", "MCX": "엠씨엑스", "SR-25": "에스알25", "RSASS": "알사스", "G28": "지28", "UMP": "유엠피", "P90": "피90",
    "KRISS": "크리스", "Five-seveN": "파이브세븐", "Grach": "그라치", "Yarygin": "야리긴", "Rhino": "라이노", "Mateba": "마테바",
    "M700": "엠700", "Model 700": "M700", "SV-98": "에스브이98", "T-5000": "오르시스", "DVL": "디브이엘", "M60": "엠60",
    "M32A1": "유탄 유탄발사기", "FN GL40": "유탄 유탄발사기", "AS VAL": "아스발", "SR-3M": "빅울", "9A-91": "9a91", "TOZ": "토즈",
    "Toy gun": "장난감", "M4A1": "엠포 m4", "ADAR": "아다르", "TX-15": "론스타", "M590": "모스버그", "Mossberg": "모스버그",
    "KS-23": "케이에스23", "SKS": "에스케이에스 sks", "VPO": "몰롯", "Uzi": "우지", "Kedr": "케드르", "Bizon": "비존",
    "PP-91": "케드르", "QBZ": "큐비지", "AUG": "어그", "G36": "지36", "MDR": "엠디알", "AA-12": "에이에이12",
}
# 메뉴 페이지 별칭 — 키 = /guide/ 뒤 경로
PAGE_ALIAS = {
    "kappa/": "kappa 카파템 컬렉터 collector 수집가 카파 컨테이너 каппа коллекционер", "keys/": "열쇠 키 key keys 키카드 keycard",
    "hideout/": "하이드아웃 hideout 은신처 은신처 재료", "crafts/": "제작 crafts craft 크래프트 제작 수익",
    "ammo/": "탄약 ammo 총알 관통력 탄 penetration", "bosses/": "보스 boss bosses 스폰 확률",
    "promo/": "프로모 코드 promo code 쿠폰 리딤", "hunt/": "사냥 킬 퀘스트 처치 hunt", "items/": "필요템 퀘템 퀘스트 아이템 needed items",
    "quest-items/": "퀘스트 전용 아이템 quest items 퀘템 위치", "rewards/": "보상 reward rewards 보상템",
    "prestige/": "프레스티지 prestige 프레", "start/": "초반 입문 뉴비 시작 starter beginner", "gunsmith/": "건스미스 gunsmith 퀘스트 조립",
    "raid/": "출정 준비물 레이드 준비 체크리스트 챙길것 챙길 것 준비물 raid checklist prep 사전 준비 подготовка 出发准备",
    "mods/": "모딩 무기 모딩 개조 커스텀 빌드 조립 반동 인체공학 메타 사기총 weapon build builds mods модинг сборка 改装",
    "maps/": "맵 지도 map maps 탈출구 extract extracts exfil", "maps/factory/": "팩토리 factory 공장",
    "maps/the-lab/": "랩 lab labs 연구소", "maps/streets-of-tarkov/": "스트리트 streets 시내 타르코프 시내",
    "maps/ground-zero/": "그라운드 제로 그제 ground zero", "maps/customs/": "세관 customs 커스텀",
    "maps/woods/": "삼림 woods 우즈", "maps/shoreline/": "해안선 shoreline 쇼어라인", "maps/interchange/": "인터체인지 interchange 울트라",
    "maps/reserve/": "리저브 reserve 군사기지", "maps/lighthouse/": "등대 lighthouse 라이트하우스", "maps/the-labyrinth/": "미궁 labyrinth 라비린스",
    "maps/terminal/": "터미널 terminal", "maps/icebreaker/": "쇄빙선 icebreaker 아이스브레이커 보레아스",
    "patch/": "패치 노트 patch 업데이트 와이프", "event/": "이벤트 event 할로윈 halloween",
}


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def apply(out_dir: Path, lang: str, keys_items: dict) -> int:
    base = "/guide/" if lang == "ko" else f"/guide/{lang}/"
    rows: list[list] = []
    for f in sorted(out_dir.rglob("index.html")):
        rel = f.parent.relative_to(out_dir).as_posix()
        if rel == ".":
            rel = ""
        top = rel.split("/")[0]
        if top in ("en", "ru", "zh"):
            continue  # ko 빌드에서 하위 언어 폴더는 건너뜀
        txt = f.read_text(encoding="utf-8")
        m = re.search(r"<h1>(.*?)</h1>", txt, re.S)
        if not m:
            continue
        h1 = m.group(1)
        en = re.search(r'<span class="h1en">(.*?)</span>', h1, re.S)
        name = _text(re.sub(r'<span class="h1en">.*?</span>', "", h1, flags=re.S))
        wn = re.search(r'<span class="wn">(.*?)</span>', h1, re.S)  # 무기 모딩 페이지: 꼬리('모딩 추천') 빼고 무기 이름만 — 종류 라벨이 따로 붙는다
        if wn:
            name = _text(wn.group(1))
        alt = _text(en.group(1)) if en else ""
        kind = KIND.get(top, "p") if rel else "p"
        if top in ("quests", "mods") and rel == top:
            kind = "p"
        rows.append([kind, name, alt, base + (rel + "/" if rel else "")])
    # 필요 아이템 표
    items_html = out_dir / "items" / "index.html"
    if items_html.exists():
        t = items_html.read_text(encoding="utf-8")
        for m in re.finditer(r'<tr data-id="([0-9a-f]{24})" data-s="([^"]*)".*?<span class="itn">.*?<span>(.*?)</span></span>', t, re.S):
            parts = m.group(3).split("<br>")
            # 이름 옆 배지(카파 등)는 빼야 ?q= 가 행 data-s 와 맞는다 — 11-04 점검: 카파 아이템 44개가 0행이었음
            name = _text(re.sub(r'<span class="badge[^"]*">.*?</span>', "", parts[0], flags=re.S))
            alt = _text(parts[1]) if len(parts) > 1 else ""
            rows.append(["i", name, alt, base + "items/?q=" + _q(name), m.group(2)])
    # ── 11-04 점검: 보스·탄약·탈출구·보상 아이템·퀘스트 아이템·흔한 별칭이 색인에 없어 '태길라'·'M855A1'·'탈출구' 등이 0건이었다 ──
    def read(rel: str) -> str:
        f = out_dir / rel / "index.html"
        return f.read_text(encoding="utf-8") if f.exists() else ""

    t = read("bosses")
    for m in re.finditer(r'<section class="box boss" id="(b-([^"]+))">.*?<h2>(.*?)</h2>', t, re.S):
        rows.append(["b", _text(m.group(3)), "", base + "bosses/#" + m.group(1), BOSS_ALIAS.get(m.group(2), m.group(2).replace("boss", ""))])
    t = read("ammo")
    for sec in re.split(r'(?=id="c-)', t)[1:]:
        cal = re.match(r'id="(c-[^"]+)"', sec).group(1)
        for m in re.finditer(r'<span><b>(.*?)</b><div class="muted small">(.*?)</div></span>', sec, re.S):
            full, short = _text(m.group(2)), _text(m.group(1))
            rows.append(["a", full or short, short, base + "ammo/#" + cal])
    t = read("rewards")
    for m in re.finditer(r'<details class="rw" data-s="([^"]*)"[^>]*><summary>.*?<span class="itn2"><b>(.*?)</b>(?:<span class="muted small">(.*?)</span>)?', t, re.S):
        name = _text(m.group(2))
        rows.append(["r", name, _text(m.group(3) or ""), base + "rewards/?q=" + _q(name), html.unescape(m.group(1))])
    t = read("quest-items")
    for sec in re.split(r'(?=id="m-)', t)[1:]:
        mid = re.match(r'id="(m-[^"]+)"', sec).group(1)
        for m in re.finditer(r'<div class="nm">(.*?)</div>', sec, re.S):
            rows.append(["u", _text(m.group(1)), "", base + "quest-items/#" + mid])
    for f in sorted((out_dir / "maps").glob("*/index.html")) if (out_dir / "maps").exists() else []:
        t = f.read_text(encoding="utf-8")
        i = t.find('id="extracts"')
        if i < 0:
            continue
        mname = _text(re.sub(r'<span class="h1en">.*?</span>', "", (re.search(r"<h1>(.*?)</h1>", t, re.S) or ["", ""])[1], flags=re.S))
        sec = t[i:t.find("</section>", i)]
        for m in re.finditer(r"<li><b>(.*?)</b>", sec, re.S):
            rows.append(["x", _text(m.group(1)), mname, base + f"maps/{f.parent.name}/#extracts"])
    # 페이지 별칭 — 메뉴 이름과 다르게 부르는 말(영문·음역·줄임말)
    for r in rows:
        if r[0] in ("p", "m", "t", "h") and len(r) == 4:
            key = r[3][len(base):]
            if key in PAGE_ALIAS:
                r.append(PAGE_ALIAS[key])
    # 무기 모딩 페이지 — 영문 이름 기준 통칭 별칭 + '모딩·빌드' 말
    for r in rows:
        if r[0] == "w" and len(r) == 4:
            al = [v for k, v in WEAPON_ALIAS.items() if k.lower() in (r[2] or r[1]).lower()]
            words = re.findall(r"[A-Za-z0-9][A-Za-z0-9.\-]*", (r[2] or "") + " " + r[1])  # 'M4A1'·'AK-74' 를 낱말로 — 아이템 행(짧은 이름 별칭)과 같은 점수가 되게
            r.append(" ".join(al + words + ["모딩 빌드 build"]))
    # 열쇠
    for kid, it in (keys_items or {}).items():
        name = (it.get("name") or it.get("n") or "") if isinstance(it, dict) else ""
        short = (it.get("shortName") or it.get("s") or "") if isinstance(it, dict) else ""
        en = (it.get("en") or "") if isinstance(it, dict) else ""
        if name:
            rows.append(["k", name, " ".join(x for x in (short, en) if x and x != name), base + "keys/?q=" + _q(name)])
    (out_dir / "search.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out_dir / "search.js").write_text(SEARCH_JS, encoding="utf-8")
    return len(rows)


def _q(s: str) -> str:
    from urllib.parse import quote
    return quote(s, safe="")


SEARCH_JS = r"""(function(){
var P=location.pathname,L=P.indexOf("/guide/en/")===0?"en":P.indexOf("/guide/ru/")===0?"ru":P.indexOf("/guide/zh/")===0?"zh":"ko",B=L==="ko"?"/guide/":"/guide/"+L+"/";
var T={ko:{ph:"퀘스트·아이템 검색",none:"결과 없음",q:"퀘스트",i:"필요 아이템",k:"열쇠",h:"은신처",m:"맵",t:"상인",p:"페이지",b:"보스",a:"탄약",r:"보상 아이템",u:"퀘스트 아이템",x:"탈출구",w:"무기 모딩",fz:"비슷한 결과"},
en:{ph:"Search quests, items",none:"No results",q:"Quest",i:"Needed item",k:"Key",h:"Hideout",m:"Map",t:"Trader",p:"Page",b:"Boss",a:"Ammo",r:"Reward item",u:"Quest item",x:"Extract",w:"Weapon build",fz:"Similar"},
ru:{ph:"Поиск: квесты, предметы",none:"Ничего не найдено",q:"Квест",i:"Нужный предмет",k:"Ключ",h:"Убежище",m:"Карта",t:"Торговец",p:"Страница",b:"Босс",a:"Патроны",r:"Награда",u:"Квестовый предмет",x:"Выход",w:"Сборка оружия",fz:"Похожие"},
zh:{ph:"搜索任务、物品",none:"没有结果",q:"任务",i:"所需物品",k:"钥匙",h:"藏身处",m:"地图",t:"商人",p:"页面",b:"Boss",a:"弹药",r:"奖励物品",u:"任务物品",x:"撤离点",w:"武器改装",fz:"相似结果"}}[L];
var top=document.querySelector(".top .wrap");if(!top)return;
var st=document.createElement("style");st.textContent=".gsearch{position:relative;flex:0 1 170px;min-width:110px;max-width:170px;margin:0 6px;transition:flex-basis .15s,max-width .15s}.gsearch:focus-within{flex-basis:260px;max-width:260px}@media(max-width:1180px){.gsearch{flex-basis:140px;max-width:140px}}"
+".gsearch input{width:100%;box-sizing:border-box;background:var(--panel2,#1f1f19);border:1px solid var(--line,#3a352b);color:inherit;border-radius:8px;padding:6px 10px;font:inherit;font-size:13.5px}"
+".gsearch input:focus{outline:none;border-color:var(--gold,#c8aa64)}"
+".gsearch ul{position:absolute;left:0;right:auto;min-width:320px;top:calc(100% + 4px);z-index:80;list-style:none;margin:0;padding:4px;background:var(--panel,#17170f);border:1px solid var(--line,#3a352b);border-radius:10px;max-height:60vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.45)}"
+".gsearch li a{display:flex;gap:8px;align-items:baseline;padding:6px 8px;border-radius:6px;color:inherit;text-decoration:none}"
+".gsearch li a.on,.gsearch li a:hover{background:var(--panel2,#262619)}"
+".gsearch ul{overflow-x:hidden;white-space:normal}.gsearch li a>span:last-child{flex:1 1 auto;min-width:0;white-space:normal;overflow-wrap:anywhere}@media(max-width:640px){.gsearch ul{position:fixed;left:8px;right:8px;top:auto;margin-top:4px}}"
+".gsearch .k{flex:none;font-size:11px;color:var(--gold,#c8aa64);min-width:58px}.gsearch .a{color:var(--muted,#9d988b);font-size:12px}"
+".gsearch .no{padding:8px;color:var(--muted,#9d988b);font-size:13px}";document.head.appendChild(st);
// 검색창 자리는 페이지 HTML 에 미리 있다(11-04: 나중에 끼워 넣어 휴대폰 헤더가 밀리던 레이아웃 흔들림 CLS 0.45 → 자리 예약)
var box=top.querySelector(".gsearch"),inp=box&&box.querySelector("input");
if(!box){box=document.createElement("div");box.className="gsearch";box.setAttribute("role","search");var brand=top.querySelector(".brand");if(brand&&brand.nextSibling)top.insertBefore(box,brand.nextSibling);else top.appendChild(box)}
if(!inp){inp=document.createElement("input");inp.type="search";box.appendChild(inp)}
inp.placeholder=T.ph;inp.setAttribute("aria-label",T.ph);inp.autocomplete="off";
var ul=document.createElement("ul");ul.hidden=true;box.appendChild(ul);
var idx=null,loading=null,hits=[],sel=0,fuzzy=false;
function norm(s){return String(s||"").toLowerCase().replace(/[\s\-_.,:;'"’()\[\]·…!?]/g,"")}
// 초성 검색(ㅋㅍ → 카파) — 한글 음절만 초성으로, 나머지 글자는 그대로
var CHO="ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";function cho(s){var o="";for(var i=0;i<s.length;i++){var c=s.charCodeAt(i)-44032;o+=(c>=0&&c<11172)?CHO.charAt(Math.floor(c/588)):s.charAt(i)}return o}
// 한 글자 오타(대뷔 → 데뷔): 같은 길이 구간에서 한 글자만 다르면 비슷한 결과로
function near(s,q){var n=q.length;if(n<2||s.length<n)return false;for(var i=0;i+n<=(n<3?n:s.length);i++){var d=0;for(var j=0;j<n&&d<2;j++)if(s.charCodeAt(i+j)!==q.charCodeAt(j))d++;if(d<2)return true}return false}
function load(){if(idx)return Promise.resolve(idx);if(loading)return loading;
loading=fetch(B+"search.json",{cache:"force-cache"}).then(function(r){return r.json()}).then(function(a){idx=a.map(function(r){var s=norm(r[1]);return{k:r[0],n:r[1],a:r[2],u:r[3],s:s,z:norm(r[2]+" "+(r[4]||"")),c:cho(s),t:String(r[4]||"").split(" ").map(norm)}});return idx}).catch(function(){idx=[];return idx});return loading}
var ORD={q:0,w:0.5,i:1,k:2,b:3,x:4,a:5,r:6,u:7,h:8,m:9,t:10,p:11};
// 게임 커뮤니티 줄임말·음역 → 데이터 표기
var AL={"레덱스":"ledx","레덱":"ledx","아이폭":"ifak","살레와":"salewa","시크":"sicc","씩":"sicc","그카":"그래픽카드","비코":"비트코인","도태":"도그태그","퀘템":"퀘스트아이템","카파템":"카파"};
function rk(k){return k in ORD?ORD[k]:99}
function find(q){var nq=norm(q);if(!nq)return[];if(AL[nq])nq=AL[nq];var out=[];
for(var i=0;i<idx.length;i++){var r=idx[i],sc=-1;
var jamo=/^[ㄱ-ㅎ]+$/.test(nq);
if(r.s===nq)sc=0;else if(r.t.indexOf(nq)>=0)sc=("pmhtb".indexOf(r.k)>=0)?0.5:1;else if(r.s.indexOf(nq)===0)sc=1;else if(r.s.indexOf(nq)>=0)sc=2;else if(r.z.indexOf(nq)>=0)sc=3;else if(jamo&&r.t.some(function(x){return cho(x)===nq}))sc=("pmhtb".indexOf(r.k)>=0)?0.5:1;else if(jamo&&r.c.indexOf(nq)>=0)sc=2;
if(sc>=0)out.push([sc,rk(r.k),r.n.length,r])}
if(!out.length&&nq.length>=2&&!jamo)for(i=0;i<idx.length;i++){r=idx[i];if(near(r.s,nq))out.push([4,rk(r.k),r.n.length,r])}
out.sort(function(a,b){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2]});fuzzy=out.length&&out[0][0]===4;return out.slice(0,14).map(function(x){return x[3]})}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function draw(){if(!inp.value.trim()){ul.hidden=true;return}
if(!hits.length){ul.innerHTML='<li class="no">'+T.none+'</li>';ul.hidden=false;return}
ul.innerHTML=(fuzzy?'<li class="no">'+T.fz+'</li>':'')+hits.map(function(r,i){return'<li><a href="'+esc(r.u)+'"'+(i===sel?' class="on"':'')+'><span class="k">'+esc(T[r.k]||"")+'</span><span>'+esc(r.n)+(r.a&&r.k==="q"?' <span class="a">'+esc(r.a)+'</span>':'')+'</span></a></li>'}).join("");ul.hidden=false}
var sentT=null,lastSent="";
function track(){var q=inp.value.trim().slice(0,60);if(q.length<2||norm(q)===lastSent)return;lastSent=norm(q);var n=find(q).length;
try{if(window.gtag){gtag("event","view_search_results",{search_term:q,results:n});if(!n)gtag("event","search_no_result",{search_term:q})}}catch(e){}}
function run(){load().then(function(){hits=find(inp.value);sel=0;draw();clearTimeout(sentT);sentT=setTimeout(track,1500)})}
function go(r){clearTimeout(sentT);track();try{if(window.gtag)gtag("event","guide_search",{search_term:inp.value.trim().slice(0,60),result_kind:r?r.k:"none"})}catch(e){}if(r)location.href=r.u}
inp.addEventListener("focus",function(){load();if(inp.value)run()});
inp.addEventListener("input",run);
inp.addEventListener("keydown",function(e){if(e.key==="ArrowDown"){e.preventDefault();if(hits.length){sel=(sel+1)%hits.length;draw()}}
else if(e.key==="ArrowUp"){e.preventDefault();if(hits.length){sel=(sel-1+hits.length)%hits.length;draw()}}
else if(e.key==="Enter"){e.preventDefault();load().then(function(){hits=find(inp.value);go(hits[sel]||hits[0])})}
else if(e.key==="Escape"){ul.hidden=true;inp.blur()}});
ul.addEventListener("click",function(e){var a=e.target.closest("a");if(!a)return;var i=[].indexOf.call(ul.querySelectorAll("a"),a);if(hits[i]){e.preventDefault();go(hits[i])}});
document.addEventListener("click",function(e){if(!box.contains(e.target))ul.hidden=true});
document.addEventListener("keydown",function(e){if(e.key==="/"&&!/input|textarea|select/i.test((document.activeElement||{}).tagName||"")){e.preventDefault();inp.focus()}});
})();
"""
