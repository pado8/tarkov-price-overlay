(function(){
// Top group menu: on touch devices or narrow screens, tapping a group title expands it and tapping again navigates. Clicking outside closes it
var noHover=window.matchMedia&&window.matchMedia("(hover: none)").matches;
document.addEventListener("click",function(ev){var gt=ev.target.closest(".top nav .gt");var open=document.querySelectorAll(".top nav .g.open");
if(!gt){open.forEach(function(g){g.classList.remove("open")});return}
var g=gt.parentNode,narrow=window.innerWidth<900;if(!(noHover||narrow))return;
if(!g.classList.contains("open")){ev.preventDefault();open.forEach(function(x){x.classList.remove("open")});g.classList.add("open")}});

document.addEventListener("click",function(ev){document.querySelectorAll("details.lang[open]").forEach(function(d){if(!d.contains(ev.target))d.removeAttribute("open")})});
})();
(function(){
var MK="guide.mode",KEY="guide.quests",SK="guide.sync",SYNCED="guide.quests.synced",SE="guide.sync.err";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function ev(n,prm,once){try{if(once){var sk="gsev."+n;if(sessionStorage.getItem(sk))return;sessionStorage.setItem(sk,"1")}if(window.gtag)gtag("event",n,prm||{})}catch(e){}}
function bucket(n){return n<1?"0":n<10?"1-9":n<50?"10-49":n<150?"50-149":"150+"}
function gmode(){return L(MK,"pvp")==="pve"?"pve":"regular"}
function qmode(){var sy=L(SK,null);if(!sy||!sy.ts)return "auto";var g=gmode();if(sy.mode==="season"&&g==="regular")return "season";return g}
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top)return;var old=document.querySelector(".sync");if(old)old.remove();var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href=stale?"#":((location.pathname.match(/^\/guide\/(?:en|ru)\//)||["/guide/"])[0]+"quests/");
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0,agoTxt=ago<1?"just now":ago<60?ago+" min ago":Math.round(ago/60)+" h ago";
var base="🔗 Overlay sync · done: "+n+" "+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (seasonal)":" (PVP)");
a.textContent="🔗 ✓"+n+" · "+(sy.mode==="pve"?"PVE":sy.mode==="season"?"S":"PVP")+(stale?" ↻":"");var long=stale?(base+" · "+agoTxt+" ↻"):base;
var err=L(SE,null);
a.title=stale?("Using the last received progress ("+agoTxt+"). Could not read the overlay directly right now "+(err&&err.msg?" — "+err.msg:"")+". Click to read again. If Chrome has blocked 'local network access', go to the address bar lock → Site settings → Local network access → Allow"):"Automatically applying quests the Price Overlay confirmed as completed from the game log";a.title=long+" — "+a.title;
if(stale)a.addEventListener("click",function(ev){ev.preventDefault();if(a.dataset.busy)return;a.dataset.busy="1";a.textContent="Retrying sync…";pull(true).then(function(ok){delete a.dataset.busy;if(ok)return;chip(sy,true);help()})});
top.appendChild(a)}
// Match the site mode to the server (PVE/PVP) the overlay reported — otherwise the next page auto-read pulls progress from the other server and the "n completed"count changes
function apply(p,how){if(how)ev("sync_ok_"+how,{sync_mode:p.mode||"",done_bucket:bucket((p.completed||[]).length)},how==="auto");if(p.mode==="pve"||p.mode==="regular"||p.mode==="pvp"||p.mode==="season"){var nm=p.mode==="pve"?"pve":"pvp";if(L(MK,"pvp")!==nm)S(MK,nm)}
var done=L(KEY,{}),syn=L(SYNCED,{}),changed=0;(p.completed||[]).forEach(function(id){if(!done[id]){done[id]=1;changed++}syn[id]=1});if(changed)S(KEY,done);S(SYNCED,syn);
var sy={ts:Date.now(),mode:p.mode,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0,promo_used:p.promo_used||[]};S(SK,sy);window.__guideSync=sy;chip(sy,false);
// promo codes 'redeemed' check — merge the list stored in the app (same PC) into the browser checks (add only)
if(p.promo_used&&p.promo_used.length){var PU="guide.promo.used",pu=L(PU,{}),add=0;p.promo_used.forEach(function(c){if(!pu[c]){pu[c]=Date.now();add++}});if(add)S(PU,pu)}
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) progress passed by the overlay "Open guide" button via the URL hash (#sync=base64 JSON) — works regardless of the browser local network policy
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0,"hash");history.replaceState(null,"",location.pathname+location.search)}}catch(e){}}
// 2) read directly from the sidecar on the same PC — reaching 127.0.0.1 from an https page requires targetAddressSpace:"loopback" in Chrome, and
//    the first time a "Allow local network access" prompt appears. If denied or unsupported, quietly show only the last synced value.
//    To avoid showing a permission prompt to visitors who do not use the app, auto-attempt only in browsers that have synced at least once,
//    and for first-time browsers place a "Overlay sync" button at the top and attempt only when the user clicks it (user gesture).
function pull(manual){var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},manual?25000:12000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
return fetch("http://127.0.0.1:8765/progress?game_mode="+qmode(),opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok){try{localStorage.removeItem(SE)}catch(x){}apply(p,manual?"manual":"auto");return true}throw new Error("Malformed response")})
.catch(function(e){clearTimeout(tm);var why=(e&&e.name==="AbortError")?"timeout":(e&&e.name)||"error";ev(manual?"sync_fail_manual":"sync_fail_auto",{reason:why},!manual);S(SE,{ts:Date.now(),msg:(e&&e.name==="AbortError")?"No response (timed out)":String(e&&e.message||e)});if(manual)return false;if(window.__guideSync)return false;var old=L(SK,null);if(old&&old.ts){window.__guideSync=old;chip(old,true);document.dispatchEvent(new CustomEvent("guide-sync",{detail:old}))}return false})}
if(window.__guideSync||L(SK,null)){pull(false);return}
var top=document.querySelector(".top .wrap");if(!top)return;
var b=document.createElement("button");b.type="button";b.className="sync btn";b.textContent="🔗 Sync";
b.title="Brings quest progress and Hideout levels from the Price Overlay running on this PC into this browser. Data never leaves your browser.";
b.addEventListener("click",function(){if(b.disabled)return;ev("sync_click");b.disabled=true;b.textContent="Syncing…";
pull(true).then(function(ok){if(ok){b.remove();return}b.disabled=false;b.textContent="🔗 Sync";help()})});
top.appendChild(b);
function help(){var old=document.querySelector(".synchelp");if(old)old.remove();var h=document.createElement("div");h.className="synchelp";
h.innerHTML='<b>Could not find the overlay.</b> On the same PC, run <a href="/">Price Overlay</a>(latest version with sync support) must be running — start it and click again. If Chrome has blocked "local network access", change it to <b>address bar lock → Site settings → Local network access → Allow</b> and refresh. If it still fails, open this site with the overlay <b>Settings → Sync with site</b> button and your progress comes along. <button type="button" class="x" aria-label="Close">✕</button>';
h.querySelector(".x").addEventListener("click",function(){h.remove()});document.querySelector(".top").insertAdjacentElement("afterend",h)}
})();