(function(){
// 顶部分组菜单：无鼠标（触屏）环境或窄屏时，点分组标题展开，再点一次跳转。点击外部则关闭
var noHover=window.matchMedia&&window.matchMedia("(hover: none)").matches;
document.addEventListener("click",function(ev){var gt=ev.target.closest(".top nav .gt");var open=document.querySelectorAll(".top nav .g.open");
if(!gt){open.forEach(function(g){g.classList.remove("open")});return}
var g=gt.parentNode,narrow=window.innerWidth<900;if(!(noHover||narrow))return;
if(!g.classList.contains("open")){ev.preventDefault();open.forEach(function(x){x.classList.remove("open")});g.classList.add("open")}});

document.addEventListener("click",function(ev){document.querySelectorAll("details.lang[open]").forEach(function(d){if(!d.contains(ev.target))d.removeAttribute("open")})});
})();
(function(){
var MK="guide.mode",SK="guide.sync",SE="guide.sync.err";
function gL(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function gS(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}function gmig(){try{var y=localStorage.getItem("guide.quests.synced");if(y==null)return;var s=JSON.parse(y)||{},d=gL("guide.quests",{});Object.keys(s).forEach(function(k){delete d[k]});gS("guide.quests",d);localStorage.removeItem("guide.quests.synced")}catch(e){}}function gsm(){var m=gL("guide.mode","pvp")==="pve"?"pve":"regular",l=gL("guide.sync",null);return (m==="regular"&&l&&l.mode==="season")?"season":m}function gsync(){var w=window.__guideSync;if(w&&w.smode===gsm())return w;return gL("guide.sync.m."+gsm(),null)}function gdone(){gmig();var d=gL("guide.quests",{}),off=gL("guide.quests.off",{}),y=gsync(),o={};Object.keys(d).forEach(function(k){o[k]=1});((y&&y.completed)||[]).forEach(function(k){if(!off[k])o[k]=1});return o}function gllE(){var x=gL("guide.ll.est."+gsm(),null);return (x&&x.est)||{}}function gllM(){return gL("guide.ll.man."+gsm(),{})}function gmyll(t){var m=gllM(),e=gllE();return +(m[t]||e[t]||0)}function gset(id,on){var d=gL("guide.quests",{}),off=gL("guide.quests.off",{}),y=gsync(),inS=((y&&y.completed)||[]).indexOf(id)>=0;if(on){d[id]=1;delete off[id]}else{delete d[id];if(inS)off[id]=1}gS("guide.quests",d);gS("guide.quests.off",off)}
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function ev(n,prm,once){try{if(once){var sk="gsev."+n;if(sessionStorage.getItem(sk))return;sessionStorage.setItem(sk,"1")}if(window.gtag)gtag("event",n,prm||{})}catch(e){}}
function bucket(n){return n<1?"0":n<10?"1-9":n<50?"10-49":n<150?"50-149":"150+"}
function gmode(){return L(MK,"pvp")==="pve"?"pve":"regular"}
function qmode(){var sy=L(SK,null);if(!sy||!sy.ts)return "auto";var g=gmode();if(sy.mode==="season"&&g==="regular")return "season";return g}
function smodeOf(m){return m==="pve"?"pve":m==="season"?"season":"regular"}
var GB=(location.pathname.match(/^\/guide\/(?:en|ru|zh)\//)||["/guide/"])[0],HOME=GB==="/guide/"?"/":GB.replace("/guide/","/");
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top)return;var old=document.querySelector(".sync");if(old)old.remove();var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href=stale?"#":(GB+"quests/");
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0,agoTxt=ago<1?"刚刚":ago<60?ago+" 分钟前":Math.round(ago/60)+" 小时前";
var base="🔗 与覆盖层同步 · 已完成 "+n+" 个 "+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (赛季)":" (PVP)");
a.textContent="🔗 ✓"+n+" · "+(sy.mode==="pve"?"PVE":sy.mode==="season"?"S":"PVP")+(stale?" ↻":"");var long=stale?(base+" · "+agoTxt+" ↻"):base;
var err=L(SE,null);
a.title=stale?("正在使用最后一次收到的进度（"+agoTxt+"）。现在无法直接读取覆盖层 "+(err&&err.msg?" — "+err.msg:"")+"。点击重新读取。"):"正在自动应用 Tarkov Price Overlay 通过游戏日志确认的已完成任务";
if(sy.log_ok===false)a.title+=" — 覆盖层找不到游戏日志文件夹，已完成列表可能为空。请在覆盖层设置中检查日志路径。";
a.title=long+" — "+a.title;
if(stale)a.addEventListener("click",function(ev){ev.preventDefault();if(a.dataset.busy)return;a.dataset.busy="1";a.textContent="正在重试同步…";pull(true).then(function(ok){delete a.dataset.busy;if(ok)return;chip(sy,true);help(L(SE,{}).reason)})});
top.appendChild(a)}
// 收到的进度存入该服务器(PVP/PVE/赛季)的槽位(guide.sync.m.<模式>)中，以 '替换'方式保存 — 不与手动勾选(guide.quests)混合(11-04)。
// 网站模式也跟随覆盖层的服务器（否则下一页的自动读取会拿到另一个服务器的进度）。
// 商人 LL 下限估算(11-04) — 已完成·进行中任务所要求 LL 的最大值（既然接到了，至少是该等级）。ll.json = 构建生成的 任务→[商人, LL]
function llEst(sy,sm){fetch(GB+"ll.json").then(function(r){return r.json()}).then(function(d){var e={},q=(d&&d.q)||{};(sy.completed||[]).concat(sy.started||[]).forEach(function(id){var x=q[id];if(x&&x[1]>(e[x[0]]||0))e[x[0]]=x[1]});S("guide.ll.est."+sm,{ts:Date.now(),est:e});document.dispatchEvent(new CustomEvent("guide-ll"))}).catch(function(){})}
function apply(p,how){var first=!L(SK,null);
if(how)ev("sync_ok_"+how,{sync_mode:p.mode||"",done_bucket:bucket((p.completed||[]).length),first:first?1:0,log_ok:p.log_ok===false?0:1},how==="auto");
if(first)try{if(window.gtag)gtag("set","user_properties",{guide_synced:"1"})}catch(e){}
if(p.mode==="pve"||p.mode==="regular"||p.mode==="pvp"||p.mode==="season"){var nm=p.mode==="pve"?"pve":"pvp";if(L(MK,"pvp")!==nm)S(MK,nm)}
gmig();var sm=smodeOf(p.mode);
var sy={ts:Date.now(),mode:p.mode,smode:sm,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0,promo_used:p.promo_used||[],log_ok:p.log_ok};
S(SK,sy);S("guide.sync.m."+sm,sy);window.__guideSync=sy;chip(sy,false);llEst(sy,sm);
// 兑换码 '已兑换' 勾选 — 把应用（同一台 PC）里保存的列表合并到浏览器勾选中（应用知道得更多时只做添加）
if(p.promo_used&&p.promo_used.length){var PU="guide.promo.used",pu=L(PU,{}),add=0;p.promo_used.forEach(function(c){if(!pu[c]){pu[c]=Date.now();add++}});if(add)S(PU,pu)}
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) 覆盖层的 "打开指南" 按钮通过地址哈希(#sync=base64 JSON)传来的进度 — 与浏览器的本地网络策略无关
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0,"hash");history.replaceState(null,"",location.pathname+location.search)}}catch(e){ev("sync_fail_hash",{reason:"decode"})}}
else if(h.indexOf("#sync-fail")===0){ev("sync_fail_hash",{reason:h.slice(11)||"app"});history.replaceState(null,"",location.pathname+location.search)}
// 2) 从同一台 PC 的 sidecar 直接读取 — 在 https 页面访问 127.0.0.1 时，Chrome 需要 targetAddressSpace:"loopback" ，并且
//    首次会弹出一次 "允许访问本地网络" 窗口。为避免向不使用应用的访客弹出权限窗口，自动尝试
//    仅在至少同步过一次的浏览器中进行，首次访问的浏览器则通过顶部按钮（用户操作）。
var URL0="http://127.0.0.1:8765/progress";
function perm(){try{if(!navigator.permissions||!navigator.permissions.query)return Promise.resolve("na");
return navigator.permissions.query({name:"local-network-access"}).catch(function(){return navigator.permissions.query({name:"loopback-network"})}).then(function(s){return s.state},function(){return "na"})}catch(e){return Promise.resolve("na")}}
// 失败原因：权限被拒 / 应用在运行但为无同步功能的旧版（no-cors 请求能到达）/ 应用关闭·被拦截 / 超时
function classify(why){return perm().then(function(ps){if(ps==="denied")return {reason:"perm_denied",perm:ps};if(why==="timeout")return {reason:"timeout",perm:ps};
var o={mode:"no-cors",cache:"no-store"};o.targetAddressSpace="loopback";
return fetch(URL0,o).then(function(){return {reason:"app_old",perm:ps}},function(){return {reason:"app_off",perm:ps}})})}
function pull(manual){var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},manual?25000:12000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
return fetch(URL0+"?game_mode="+qmode(),opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok){try{localStorage.removeItem(SE)}catch(x){}apply(p,manual?"manual":"auto");return true}throw new Error("响应格式错误")})
.catch(function(e){clearTimeout(tm);var why=(e&&e.name==="AbortError")?"timeout":"net";
return classify(why).then(function(c){ev(manual?"sync_fail_manual":"sync_fail_auto",{reason:c.reason,perm:c.perm},!manual);
S(SE,{ts:Date.now(),reason:c.reason,msg:c.reason==="perm_denied"?"浏览器阻止了本地网络访问":c.reason==="app_old"?"无同步功能的旧版覆盖层":c.reason==="timeout"?"无响应（超时）":"覆盖层未运行或连接被阻止"});
if(manual)return false;if(window.__guideSync)return false;
var old=L("guide.sync.m."+gsm(),null);if(!old){var lg=L(SK,null);if(lg&&lg.ts&&smodeOf(lg.mode)===gsm()){lg.smode=gsm();old=lg}}
if(old&&old.ts){window.__guideSync=old;chip(old,true);document.dispatchEvent(new CustomEvent("guide-sync",{detail:old}))}return false})})}
if(window.__guideSync||L(SK,null)){pull(false);return}
var top=document.querySelector(".top .wrap");if(!top)return;
// 手机·平板（无鼠标）上不可能有同一台 PC 的覆盖层，所以不显示按钮（之前点了总是失败，11-04）
var touch=window.matchMedia&&window.matchMedia("(hover: none)").matches;if(touch&&window.innerWidth<1024)return;
var b=document.createElement("button");b.type="button";b.className="sync btn";b.textContent="🔗 同步";
b.title="把同一台 PC 上运行的 Tarkov Price Overlay（查价工具）的任务进度·藏身处等级导入此浏览器。数据不会离开浏览器。";
ev("sync_btn_view",{touch:touch?1:0},true);
b.addEventListener("click",function(){if(b.disabled)return;ev("sync_click");b.disabled=true;b.textContent="同步中…";
pull(true).then(function(ok){if(ok){b.remove();return}b.disabled=false;b.textContent="🔗 同步";help(L(SE,{}).reason)})});
top.appendChild(b);
function help(reason){var old=document.querySelector(".synchelp");if(old)old.remove();var h=document.createElement("div");h.className="synchelp";
var msg=reason==="perm_denied"?'<b>浏览器阻止了本站访问本地网络。</b> Chrome·Edge： <b>地址栏锁图标 → 网站设置 → 本地网络访问 → 允许</b> ，然后刷新。Brave：打开 <b>brave://settings/content/localhostAccess</b> 并允许此网站。'
:reason==="app_old"?'<b>覆盖层正在运行，但这是没有同步功能的旧版本。</b> 请将覆盖层更新到 <a href="'+HOME+'">最新版本</a> 后再点一次（安装版会在下次启动时自动更新）。'
:'<b>找不到覆盖层。</b> 在同一台电脑上 <a href="'+HOME+'">Tarkov Price Overlay（查价工具）</a>（1.2.6 或更高版本）保持运行后再点一次。如果 Chrome 已将 "本地网络访问"设为阻止，请改为 <b>地址栏锁图标 → 网站设置 → 本地网络访问 → 允许</b>；Brave 则打开 <b>brave://settings/content/localhostAccess</b>.';
h.innerHTML=msg+' 仍然不行的话，用覆盖层的 <b>设置 → 与网站同步</b> 按钮打开本站，进度会一起带过来。 <button type="button" class="x" aria-label="关闭">✕</button>';
h.querySelector(".x").addEventListener("click",function(){h.remove()});document.querySelector(".top").insertAdjacentElement("afterend",h)}
})()