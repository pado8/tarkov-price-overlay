(function(){
// 상단 그룹 메뉴: 마우스가 없는(터치) 환경이나 좁은 화면에선 그룹 제목을 누르면 펼치고, 다시 누르면 이동. 바깥 클릭이면 닫힘
var noHover=window.matchMedia&&window.matchMedia("(hover: none)").matches;
document.addEventListener("click",function(ev){var gt=ev.target.closest(".top nav .gt");var open=document.querySelectorAll(".top nav .g.open");
if(!gt){open.forEach(function(g){g.classList.remove("open")});return}
var g=gt.parentNode,narrow=window.innerWidth<900;if(!(noHover||narrow))return;
if(!g.classList.contains("open")){ev.preventDefault();open.forEach(function(x){x.classList.remove("open")});g.classList.add("open")}});

document.addEventListener("click",function(ev){document.querySelectorAll("details.lang[open]").forEach(function(d){if(!d.contains(ev.target))d.removeAttribute("open")})});
})();
(function(){
var MK="guide.mode",SK="guide.sync",SE="guide.sync.err";
function gL(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function gS(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}function gmig(){try{var y=localStorage.getItem("guide.quests.synced");if(y==null)return;var s=JSON.parse(y)||{},d=gL("guide.quests",{});Object.keys(s).forEach(function(k){delete d[k]});gS("guide.quests",d);localStorage.removeItem("guide.quests.synced")}catch(e){}}function gsm(){var m=gL("guide.mode","pvp")==="pve"?"pve":"regular",l=gL("guide.sync",null);return (m==="regular"&&l&&l.mode==="season")?"season":m}function gsync(){var w=window.__guideSync;if(w&&w.smode===gsm())return w;return gL("guide.sync.m."+gsm(),null)}function gdone(){gmig();var d=gL("guide.quests",{}),off=gL("guide.quests.off",{}),y=gsync(),o={};Object.keys(d).forEach(function(k){o[k]=1});((y&&y.completed)||[]).forEach(function(k){if(!off[k])o[k]=1});return o}function gset(id,on){var d=gL("guide.quests",{}),off=gL("guide.quests.off",{}),y=gsync(),inS=((y&&y.completed)||[]).indexOf(id)>=0;if(on){d[id]=1;delete off[id]}else{delete d[id];if(inS)off[id]=1}gS("guide.quests",d);gS("guide.quests.off",off)}
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function ev(n,prm,once){try{if(once){var sk="gsev."+n;if(sessionStorage.getItem(sk))return;sessionStorage.setItem(sk,"1")}if(window.gtag)gtag("event",n,prm||{})}catch(e){}}
function bucket(n){return n<1?"0":n<10?"1-9":n<50?"10-49":n<150?"50-149":"150+"}
function gmode(){return L(MK,"pvp")==="pve"?"pve":"regular"}
function qmode(){var sy=L(SK,null);if(!sy||!sy.ts)return "auto";var g=gmode();if(sy.mode==="season"&&g==="regular")return "season";return g}
function smodeOf(m){return m==="pve"?"pve":m==="season"?"season":"regular"}
var GB=(location.pathname.match(/^\/guide\/(?:en|ru)\//)||["/guide/"])[0],HOME=GB==="/guide/"?"/":GB.replace("/guide/","/");
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top)return;var old=document.querySelector(".sync");if(old)old.remove();var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href=stale?"#":(GB+"quests/");
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0,agoTxt=ago<1?"방금":ago<60?ago+"분 전":Math.round(ago/60)+"시간 전";
var base="🔗 오버레이 연동 · 완료 "+n+"개"+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (시즌)":" (PVP)");
a.textContent="🔗 ✓"+n+" · "+(sy.mode==="pve"?"PVE":sy.mode==="season"?"S":"PVP")+(stale?" ↻":"");var long=stale?(base+" · "+agoTxt+" 기준 ↻"):base;
var err=L(SE,null);
a.title=stale?("마지막으로 받은 진행도("+agoTxt+")를 쓰고 있어요. 지금은 오버레이를 직접 읽지 못했어요"+(err&&err.msg?" — "+err.msg:"")+". 눌러서 다시 읽기."):"시세 오버레이가 게임 로그로 확인한 완료 퀘스트를 자동 반영 중";
if(sy.log_ok===false)a.title+=" — 오버레이가 게임 로그 폴더를 찾지 못해 완료 목록이 비어 있을 수 있어요. 오버레이 설정에서 로그 경로를 확인하세요.";
a.title=long+" — "+a.title;
if(stale)a.addEventListener("click",function(ev){ev.preventDefault();if(a.dataset.busy)return;a.dataset.busy="1";a.textContent="연동 다시 시도 중…";pull(true).then(function(ok){delete a.dataset.busy;if(ok)return;chip(sy,true);help(L(SE,{}).reason)})});
top.appendChild(a)}
// 받은 진행도는 그 서버(PVP/PVE/시즌)의 칸(guide.sync.m.<모드>)에 '교체'로 저장한다 — 직접 체크(guide.quests)와 섞지 않는다(11-04).
// 사이트 모드도 오버레이 서버로 맞춘다(안 맞추면 다음 페이지의 자동 읽기가 다른 서버 진행도를 가져온다).
function apply(p,how){var first=!L(SK,null);
if(how)ev("sync_ok_"+how,{sync_mode:p.mode||"",done_bucket:bucket((p.completed||[]).length),first:first?1:0,log_ok:p.log_ok===false?0:1},how==="auto");
if(first)try{if(window.gtag)gtag("set","user_properties",{guide_synced:"1"})}catch(e){}
if(p.mode==="pve"||p.mode==="regular"||p.mode==="pvp"||p.mode==="season"){var nm=p.mode==="pve"?"pve":"pvp";if(L(MK,"pvp")!==nm)S(MK,nm)}
gmig();var sm=smodeOf(p.mode);
var sy={ts:Date.now(),mode:p.mode,smode:sm,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0,promo_used:p.promo_used||[],log_ok:p.log_ok};
S(SK,sy);S("guide.sync.m."+sm,sy);window.__guideSync=sy;chip(sy,false);
// 프로모 코드 '등록함' 체크 — 앱(같은 PC)에 저장된 목록을 브라우저 체크에 합친다(앱 쪽이 더 많이 알고 있으면 추가만)
if(p.promo_used&&p.promo_used.length){var PU="guide.promo.used",pu=L(PU,{}),add=0;p.promo_used.forEach(function(c){if(!pu[c]){pu[c]=Date.now();add++}});if(add)S(PU,pu)}
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) 오버레이의 "가이드 열기" 버튼이 주소 해시(#sync=base64 JSON)로 넘긴 진행도 — 브라우저의 로컬 네트워크 정책과 무관하게 동작
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0,"hash");history.replaceState(null,"",location.pathname+location.search)}}catch(e){ev("sync_fail_hash",{reason:"decode"})}}
else if(h.indexOf("#sync-fail")===0){ev("sync_fail_hash",{reason:h.slice(11)||"app"});history.replaceState(null,"",location.pathname+location.search)}
// 2) 같은 PC의 사이드카에서 직접 읽기 — https 페이지에서 127.0.0.1 로 가려면 크롬은 targetAddressSpace:"loopback" 이 필요하고,
//    처음 한 번 "로컬 네트워크 접근 허용" 창이 뜬다. 앱을 안 쓰는 방문자에게 권한 창을 띄우지 않도록 자동 시도는
//    한 번이라도 연동된 브라우저에서만, 처음인 브라우저엔 상단 버튼(사용자 동작)으로.
var URL0="http://127.0.0.1:8765/progress";
function perm(){try{if(!navigator.permissions||!navigator.permissions.query)return Promise.resolve("na");
return navigator.permissions.query({name:"local-network-access"}).catch(function(){return navigator.permissions.query({name:"loopback-network"})}).then(function(s){return s.state},function(){return "na"})}catch(e){return Promise.resolve("na")}}
// 실패 이유: 권한 거부 / 앱은 떠 있는데 연동 없는 예전 버전(no-cors 요청은 닿음) / 앱 꺼짐·차단 / 시간 초과
function classify(why){return perm().then(function(ps){if(ps==="denied")return {reason:"perm_denied",perm:ps};if(why==="timeout")return {reason:"timeout",perm:ps};
var o={mode:"no-cors",cache:"no-store"};o.targetAddressSpace="loopback";
return fetch(URL0,o).then(function(){return {reason:"app_old",perm:ps}},function(){return {reason:"app_off",perm:ps}})})}
function pull(manual){var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},manual?25000:12000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
return fetch(URL0+"?game_mode="+qmode(),opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok){try{localStorage.removeItem(SE)}catch(x){}apply(p,manual?"manual":"auto");return true}throw new Error("응답 형식 오류")})
.catch(function(e){clearTimeout(tm);var why=(e&&e.name==="AbortError")?"timeout":"net";
return classify(why).then(function(c){ev(manual?"sync_fail_manual":"sync_fail_auto",{reason:c.reason,perm:c.perm},!manual);
S(SE,{ts:Date.now(),reason:c.reason,msg:c.reason==="perm_denied"?"브라우저가 로컬 네트워크 접근을 막음":c.reason==="app_old"?"연동이 없는 예전 버전 오버레이":c.reason==="timeout"?"응답 없음(시간 초과)":"오버레이가 꺼져 있거나 연결이 막힘"});
if(manual)return false;if(window.__guideSync)return false;
var old=L("guide.sync.m."+gsm(),null);if(!old){var lg=L(SK,null);if(lg&&lg.ts&&smodeOf(lg.mode)===gsm()){lg.smode=gsm();old=lg}}
if(old&&old.ts){window.__guideSync=old;chip(old,true);document.dispatchEvent(new CustomEvent("guide-sync",{detail:old}))}return false})})}
if(window.__guideSync||L(SK,null)){pull(false);return}
var top=document.querySelector(".top .wrap");if(!top)return;
// 휴대폰·태블릿(마우스 없음)에선 같은 PC의 오버레이가 있을 수 없으니 버튼을 내지 않는다(누르면 항상 실패하던 것, 11-04)
var touch=window.matchMedia&&window.matchMedia("(hover: none)").matches;if(touch&&window.innerWidth<1024)return;
var b=document.createElement("button");b.type="button";b.className="sync btn";b.textContent="🔗 연동";
b.title="같은 PC에서 켜 둔 시세 오버레이의 퀘스트 진행도·은신처 단계를 이 브라우저에 가져옵니다. 데이터는 브라우저 밖으로 나가지 않아요.";
ev("sync_btn_view",{touch:touch?1:0},true);
b.addEventListener("click",function(){if(b.disabled)return;ev("sync_click");b.disabled=true;b.textContent="연동 중…";
pull(true).then(function(ok){if(ok){b.remove();return}b.disabled=false;b.textContent="🔗 연동";help(L(SE,{}).reason)})});
top.appendChild(b);
function help(reason){var old=document.querySelector(".synchelp");if(old)old.remove();var h=document.createElement("div");h.className="synchelp";
var msg=reason==="perm_denied"?'<b>브라우저가 이 사이트의 로컬 네트워크 접근을 막아 두었어요.</b> 크롬·엣지: <b>주소창 자물쇠 → 사이트 설정 → 로컬 네트워크 접근 → 허용</b> 후 새로고침. 브레이브: <b>brave://settings/content/localhostAccess</b> 에서 이 사이트 허용.'
:reason==="app_old"?'<b>오버레이는 켜져 있지만 연동 기능이 없는 예전 버전이에요.</b> 오버레이를 <a href="'+HOME+'">최신 버전</a>으로 업데이트한 뒤 다시 눌러 주세요(설치판은 다음 실행 때 자동 업데이트).'
:'<b>오버레이를 찾지 못했어요.</b> 같은 PC에서 <a href="'+HOME+'">시세 오버레이</a>(1.2.6 이상)를 켜 두고 다시 눌러 주세요. 크롬이 "로컬 네트워크 접근"을 차단해 두었다면 <b>주소창 자물쇠 → 사이트 설정 → 로컬 네트워크 접근 → 허용</b>, 브레이브는 <b>brave://settings/content/localhostAccess</b>.';
h.innerHTML=msg+' 그래도 안 되면 오버레이 <b>설정 → 사이트 연동하기</b> 버튼으로 이 사이트를 열면 진행도가 같이 넘어옵니다. <button type="button" class="x" aria-label="닫기">✕</button>';
h.querySelector(".x").addEventListener("click",function(){h.remove()});document.querySelector(".top").insertAdjacentElement("afterend",h)}
})()