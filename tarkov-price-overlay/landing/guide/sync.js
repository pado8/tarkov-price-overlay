(function(){
// 상단 그룹 메뉴: 마우스가 없는(터치) 환경이나 좁은 화면에선 그룹 제목을 누르면 펼치고, 다시 누르면 이동. 바깥 클릭이면 닫힘
var noHover=window.matchMedia&&window.matchMedia("(hover: none)").matches;
document.addEventListener("click",function(ev){var gt=ev.target.closest(".top nav .gt");var open=document.querySelectorAll(".top nav .g.open");
if(!gt){open.forEach(function(g){g.classList.remove("open")});return}
var g=gt.parentNode,narrow=window.innerWidth<900;if(!(noHover||narrow))return;
if(!g.classList.contains("open")){ev.preventDefault();open.forEach(function(x){x.classList.remove("open")});g.classList.add("open")}});
})();
(function(){
var MK="guide.mode",KEY="guide.quests",SK="guide.sync",SYNCED="guide.quests.synced",SE="guide.sync.err";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function gmode(){return L(MK,"pvp")==="pve"?"pve":"regular"}
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top)return;var old=document.querySelector(".sync");if(old)old.remove();var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href=stale?"#":"/guide/quests/";
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0,agoTxt=ago<1?"방금":ago<60?ago+"분 전":Math.round(ago/60)+"시간 전";
var base="🔗 오버레이 연동 · 완료 "+n+"개"+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (시즌)":" (PVP)");
a.textContent=stale?(base+" · "+agoTxt+" 기준 ↻"):base;
var err=L(SE,null);
a.title=stale?("마지막으로 받은 진행도("+agoTxt+")를 쓰고 있어요. 지금은 오버레이를 직접 읽지 못했어요"+(err&&err.msg?" — "+err.msg:"")+". 눌러서 다시 읽기. 크롬이 '로컬 네트워크 접근'을 차단해 두었다면 주소창 자물쇠 → 사이트 설정 → 로컬 네트워크 접근 → 허용"):"시세 오버레이가 게임 로그로 확인한 완료 퀘스트를 자동 반영 중";
if(stale)a.addEventListener("click",function(ev){ev.preventDefault();if(a.dataset.busy)return;a.dataset.busy="1";a.textContent="연동 다시 시도 중…";pull(true).then(function(ok){delete a.dataset.busy;if(ok)return;chip(sy,true);help()})});
top.appendChild(a)}
// 오버레이가 알려 준 서버(PVE/PVP)로 사이트 모드를 맞춘다 — 안 맞추면 다음 페이지의 자동 읽기가 다른 서버 진행도를 가져와 "완료 n개"가 바뀐다
function apply(p){if(p.mode==="pve"||p.mode==="regular"||p.mode==="pvp"||p.mode==="season"){var nm=p.mode==="pve"?"pve":"pvp";if(L(MK,"pvp")!==nm)S(MK,nm)}
var done=L(KEY,{}),syn=L(SYNCED,{}),changed=0;(p.completed||[]).forEach(function(id){if(!done[id]){done[id]=1;changed++}syn[id]=1});if(changed)S(KEY,done);S(SYNCED,syn);
var sy={ts:Date.now(),mode:p.mode,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0,promo_used:p.promo_used||[]};S(SK,sy);window.__guideSync=sy;chip(sy,false);
// 프로모 코드 '등록함' 체크 — 앱(같은 PC)에 저장된 목록을 브라우저 체크에 합친다(앱 쪽이 더 많이 알고 있으면 추가만)
if(p.promo_used&&p.promo_used.length){var PU="guide.promo.used",pu=L(PU,{}),add=0;p.promo_used.forEach(function(c){if(!pu[c]){pu[c]=Date.now();add++}});if(add)S(PU,pu)}
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) 오버레이의 "가이드 열기" 버튼이 주소 해시(#sync=base64 JSON)로 넘긴 진행도 — 브라우저의 로컬 네트워크 정책과 무관하게 동작
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0);history.replaceState(null,"",location.pathname+location.search)}}catch(e){}}
// 2) 같은 PC의 사이드카에서 직접 읽기 — https 페이지에서 127.0.0.1 로 가려면 크롬은 targetAddressSpace:"loopback" 이 필요하고,
//    처음 한 번 "로컬 네트워크 접근 허용" 창이 뜬다. 거부·미지원이면 조용히 마지막 연동 값만 보여 준다.
//    앱을 안 쓰는 방문자에게 권한 창을 띄우지 않도록, 자동 시도는 한 번이라도 연동된 브라우저에서만 하고,
//    처음인 브라우저에는 상단에 "오버레이 연동" 버튼을 두어 사용자가 눌렀을 때(사용자 동작) 시도한다.
function pull(manual){var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},manual?25000:12000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
return fetch("http://127.0.0.1:8765/progress?game_mode="+gmode(),opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok){try{localStorage.removeItem(SE)}catch(x){}apply(p);return true}throw new Error("응답 형식 오류")})
.catch(function(e){clearTimeout(tm);S(SE,{ts:Date.now(),msg:(e&&e.name==="AbortError")?"응답 없음(시간 초과)":String(e&&e.message||e)});if(manual)return false;if(window.__guideSync)return false;var old=L(SK,null);if(old&&old.ts){window.__guideSync=old;chip(old,true);document.dispatchEvent(new CustomEvent("guide-sync",{detail:old}))}return false})}
if(window.__guideSync||L(SK,null)){pull(false);return}
var top=document.querySelector(".top .wrap");if(!top)return;
var b=document.createElement("button");b.type="button";b.className="sync btn";b.textContent="🔗 오버레이 연동 (다음 버전부터)";
b.title="다음 버전부터 쓸 수 있어요. 같은 PC에서 켜 둔 시세 오버레이의 퀘스트 진행도·은신처 단계를 이 브라우저에 가져옵니다. 데이터는 브라우저 밖으로 나가지 않아요.";
b.addEventListener("click",function(){if(b.disabled)return;b.disabled=true;b.textContent="연동 중…";
pull(true).then(function(ok){if(ok){b.remove();return}b.disabled=false;b.textContent="🔗 오버레이 연동 (다음 버전부터)";help()})});
top.appendChild(b);
function help(){var old=document.querySelector(".synchelp");if(old)old.remove();var h=document.createElement("div");h.className="synchelp";
h.innerHTML='<b>오버레이 연동은 다음 버전부터 쓸 수 있어요.</b> 지금 버전의 앱에는 아직 이 기능이 없습니다. 새 버전을 설치했다면 같은 PC에서 <a href="/">시세 오버레이</a>(연동 기능이 들어간 최신 버전)를 켜 두고 다시 눌러 주세요. 크롬이 "로컬 네트워크 접근"을 차단해 두었다면 <b>주소창 자물쇠 → 사이트 설정 → 로컬 네트워크 접근 → 허용</b>으로 바꾼 뒤 새로고침하세요. 그래도 안 되면 오버레이 <b>설정 → 사이트 연동하기</b> 버튼으로 이 사이트를 열면 진행도가 같이 넘어옵니다. <button type="button" class="x" aria-label="닫기">✕</button>';
h.querySelector(".x").addEventListener("click",function(){h.remove()});document.querySelector(".top").insertAdjacentElement("afterend",h)}
})();