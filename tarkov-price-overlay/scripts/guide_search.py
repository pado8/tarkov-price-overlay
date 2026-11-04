"""가이드 전체 검색 — 언어판 빌드가 끝난 뒤 만들어진 페이지를 훑어 search.json 색인과 search.js 를 쓴다.

- 페이지: 각 index.html 의 <h1>(퀘스트는 한글명 + 영문명) → 그 페이지로 이동
- 필요 아이템: items/ 표의 줄(data-id·이름·data-s 검색어) → /guide/items/?q=이름 (그 줄만 걸러 보임)
- 열쇠: keys/ 템플릿 데이터의 열쇠 → /guide/keys/?q=이름
- 화면 문구는 search.js 안의 ko/en/ru 표에서 고른다(번역 파이프라인을 타지 않게 index.html 이 아닌 별도 파일).
build_guide.main() 끝에서 apply(out_dir, lang, keys_items) 로 부른다.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

KIND = {"quest": "q", "hideout": "h", "maps": "m", "quests": "t"}


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
        if top in ("en", "ru"):
            continue  # ko 빌드에서 하위 언어 폴더는 건너뜀
        txt = f.read_text(encoding="utf-8")
        m = re.search(r"<h1>(.*?)</h1>", txt, re.S)
        if not m:
            continue
        h1 = m.group(1)
        en = re.search(r'<span class="h1en">(.*?)</span>', h1, re.S)
        name = _text(re.sub(r'<span class="h1en">.*?</span>', "", h1, flags=re.S))
        alt = _text(en.group(1)) if en else ""
        kind = KIND.get(top, "p") if rel else "p"
        if top == "quests" and rel == "quests":
            kind = "p"
        rows.append([kind, name, alt, base + (rel + "/" if rel else "")])
    # 필요 아이템 표
    items_html = out_dir / "items" / "index.html"
    if items_html.exists():
        t = items_html.read_text(encoding="utf-8")
        for m in re.finditer(r'<tr data-id="([0-9a-f]{24})" data-s="([^"]*)".*?<span class="itn">.*?<span>(.*?)</span></span>', t, re.S):
            parts = m.group(3).split("<br>")
            name = _text(parts[0])
            alt = _text(parts[1]) if len(parts) > 1 else ""
            rows.append(["i", name, alt, base + "items/?q=" + _q(name), m.group(2)])
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
var P=location.pathname,L=P.indexOf("/guide/en/")===0?"en":P.indexOf("/guide/ru/")===0?"ru":"ko",B=L==="ko"?"/guide/":"/guide/"+L+"/";
var T={ko:{ph:"퀘스트·아이템 검색",none:"결과 없음",q:"퀘스트",i:"필요 아이템",k:"열쇠",h:"은신처",m:"맵",t:"상인",p:"페이지"},
en:{ph:"Search quests, items",none:"No results",q:"Quest",i:"Needed item",k:"Key",h:"Hideout",m:"Map",t:"Trader",p:"Page"},
ru:{ph:"Поиск: квесты, предметы",none:"Ничего не найдено",q:"Квест",i:"Нужный предмет",k:"Ключ",h:"Убежище",m:"Карта",t:"Торговец",p:"Страница"}}[L];
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
var box=document.createElement("div");box.className="gsearch";box.setAttribute("role","search");
var inp=document.createElement("input");inp.type="search";inp.placeholder=T.ph;inp.setAttribute("aria-label",T.ph);inp.autocomplete="off";
var ul=document.createElement("ul");ul.hidden=true;box.appendChild(inp);box.appendChild(ul);
var brand=top.querySelector(".brand");if(brand&&brand.nextSibling)top.insertBefore(box,brand.nextSibling);else top.appendChild(box);
var idx=null,loading=null,hits=[],sel=0;
function norm(s){return String(s||"").toLowerCase().replace(/[\s\-_.,:;'"’()\[\]·…!?]/g,"")}
function load(){if(idx)return Promise.resolve(idx);if(loading)return loading;
loading=fetch(B+"search.json",{cache:"force-cache"}).then(function(r){return r.json()}).then(function(a){idx=a.map(function(r){return{k:r[0],n:r[1],a:r[2],u:r[3],s:norm(r[1]),z:norm(r[2]+" "+(r[4]||""))}});return idx}).catch(function(){idx=[];return idx});return loading}
var ORD={q:0,i:1,k:2,h:3,m:4,t:5,p:6};
function find(q){var nq=norm(q);if(!nq)return[];var out=[];
for(var i=0;i<idx.length;i++){var r=idx[i],sc=-1;
if(r.s===nq)sc=0;else if(r.s.indexOf(nq)===0)sc=1;else if(r.s.indexOf(nq)>=0)sc=2;else if(r.z.indexOf(nq)>=0)sc=3;
if(sc>=0)out.push([sc,ORD[r.k]||9,r.n.length,r])}
out.sort(function(a,b){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2]});return out.slice(0,14).map(function(x){return x[3]})}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function draw(){if(!inp.value.trim()){ul.hidden=true;return}
if(!hits.length){ul.innerHTML='<li class="no">'+T.none+'</li>';ul.hidden=false;return}
ul.innerHTML=hits.map(function(r,i){return'<li><a href="'+esc(r.u)+'"'+(i===sel?' class="on"':'')+'><span class="k">'+esc(T[r.k]||"")+'</span><span>'+esc(r.n)+(r.a&&r.k==="q"?' <span class="a">'+esc(r.a)+'</span>':'')+'</span></a></li>'}).join("");ul.hidden=false}
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
