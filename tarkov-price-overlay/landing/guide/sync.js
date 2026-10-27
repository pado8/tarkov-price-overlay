(function(){
// 상단 그룹 메뉴: 마우스가 없는(터치) 환경이나 좁은 화면에선 그룹 제목을 누르면 펼치고, 다시 누르면 이동. 바깥 클릭이면 닫힘
var noHover=window.matchMedia&&window.matchMedia("(hover: none)").matches;
document.addEventListener("click",function(ev){var gt=ev.target.closest(".top nav .gt");var open=document.querySelectorAll(".top nav .g.open");
if(!gt){open.forEach(function(g){g.classList.remove("open")});return}
var g=gt.parentNode,narrow=window.innerWidth<900;if(!(noHover||narrow))return;
if(!g.classList.contains("open")){ev.preventDefault();open.forEach(function(x){x.classList.remove("open")});g.classList.add("open")}});
})();
(function(){
var MK="guide.mode",KEY="guide.quests",SK="guide.sync",SYNCED="guide.quests.synced";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var mode=L(MK,"pvp"),gm=mode==="pve"?"pve":"regular";
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top||document.querySelector(".sync"))return;var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href="/guide/quests/";
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0;a.textContent=stale?("오버레이 연동 끊김 · 마지막 "+(ago<60?ago+"분 전":Math.round(ago/60)+"시간 전")):("🔗 오버레이 연동 · 완료 "+n+"개"+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (시즌)":" (PVP)"));
a.title=stale?"시세 오버레이가 꺼져 있어요. 켜 두면 깬 퀘스트가 자동 반영됩니다.":"시세 오버레이가 게임 로그로 확인한 완료 퀘스트를 자동 반영 중";top.appendChild(a)}
function apply(p){var done=L(KEY,{}),syn=L(SYNCED,{}),changed=0;(p.completed||[]).forEach(function(id){if(!done[id]){done[id]=1;changed++}syn[id]=1});if(changed)S(KEY,done);S(SYNCED,syn);
var sy={ts:Date.now(),mode:p.mode,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0};S(SK,sy);window.__guideSync=sy;chip(sy,false);
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) 오버레이의 "가이드 열기" 버튼이 주소 해시(#sync=base64 JSON)로 넘긴 진행도 — 브라우저의 로컬 네트워크 정책과 무관하게 동작
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0);history.replaceState(null,"",location.pathname+location.search)}}catch(e){}}
// 2) 같은 PC의 사이드카에서 직접 읽기 — https 페이지에서 127.0.0.1 로 가려면 크롬은 targetAddressSpace:"loopback" 이 필요하고,
//    처음 한 번 "로컬 네트워크 접근 허용" 창이 뜬다. 거부·미지원이면 조용히 마지막 연동 값만 보여 준다.
//    앱을 안 쓰는 방문자에게 권한 창을 띄우지 않도록, 1)로 한 번이라도 연동된 브라우저에서만 시도한다.
if(!window.__guideSync&&!L(SK,null))return;
var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},4000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
fetch("http://127.0.0.1:8765/progress?game_mode="+gm,opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok)apply(p)})
.catch(function(){clearTimeout(tm);if(window.__guideSync)return;var old=L(SK,null);if(old&&old.ts){window.__guideSync=old;chip(old,true)}});
})();