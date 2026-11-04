(function(){
// Верхнее меню групп: на тач-устройствах без мыши или узких экранах нажатие на заголовок группы раскрывает её, повторное — переходит. Клик снаружи закрывает
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
var GB=(location.pathname.match(/^\/guide\/(?:en|ru)\//)||["/guide/"])[0],HOME=GB==="/guide/"?"/":GB.replace("/guide/","/");
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top)return;var old=document.querySelector(".sync");if(old)old.remove();var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href=stale?"#":(GB+"quests/");
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0,agoTxt=ago<1?"только что":ago<60?ago+" мин назад":Math.round(ago/60)+" ч назад";
var base="🔗 Связь с оверлеем · выполнено "+n+" "+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (сезон)":" (PVP)");
a.textContent="🔗 ✓"+n+" · "+(sy.mode==="pve"?"PVE":sy.mode==="season"?"S":"PVP")+(stale?" ↻":"");var long=stale?(base+" · "+agoTxt+" по данным ↻"):base;
var err=L(SE,null);
a.title=stale?("Используется последний полученный прогресс ("+agoTxt+"). Сейчас прочитать оверлей напрямую не удалось "+(err&&err.msg?" — "+err.msg:"")+". Нажмите, чтобы прочитать снова."):"Автоматически учитываются квесты, выполнение которых оверлей цен определил по логам игры";
if(sy.log_ok===false)a.title+=" — Оверлей не нашёл папку логов игры, поэтому список выполненного может быть пустым. Проверьте путь к логам в настройках оверлея.";
a.title=long+" — "+a.title;
if(stale)a.addEventListener("click",function(ev){ev.preventDefault();if(a.dataset.busy)return;a.dataset.busy="1";a.textContent="Повторная попытка связи…";pull(true).then(function(ok){delete a.dataset.busy;if(ok)return;chip(sy,true);help(L(SE,{}).reason)})});
top.appendChild(a)}
// Полученный прогресс хранится в ячейке своего сервера (PVP/PVE/сезон) (guide.sync.m.<Режим>) с 'заменой' — без смешивания с ручными отметками (guide.quests) (11-04).
// Режим сайта тоже следует серверу оверлея (иначе автозагрузка на следующей странице возьмёт прогресс другого сервера).
// нижняя граница LL торговца (11-04) — наибольший LL среди выполненных и начатых заданий (вы их получили, значит не ниже). ll.json = задание → [торговец, LL] из сборки
function llEst(sy,sm){fetch(GB+"ll.json").then(function(r){return r.json()}).then(function(d){var e={},q=(d&&d.q)||{};(sy.completed||[]).concat(sy.started||[]).forEach(function(id){var x=q[id];if(x&&x[1]>(e[x[0]]||0))e[x[0]]=x[1]});S("guide.ll.est."+sm,{ts:Date.now(),est:e});document.dispatchEvent(new CustomEvent("guide-ll"))}).catch(function(){})}
function apply(p,how){var first=!L(SK,null);
if(how)ev("sync_ok_"+how,{sync_mode:p.mode||"",done_bucket:bucket((p.completed||[]).length),first:first?1:0,log_ok:p.log_ok===false?0:1},how==="auto");
if(first)try{if(window.gtag)gtag("set","user_properties",{guide_synced:"1"})}catch(e){}
if(p.mode==="pve"||p.mode==="regular"||p.mode==="pvp"||p.mode==="season"){var nm=p.mode==="pve"?"pve":"pvp";if(L(MK,"pvp")!==nm)S(MK,nm)}
gmig();var sm=smodeOf(p.mode);
var sy={ts:Date.now(),mode:p.mode,smode:sm,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0,promo_used:p.promo_used||[],log_ok:p.log_ok};
S(SK,sy);S("guide.sync.m."+sm,sy);window.__guideSync=sy;chip(sy,false);llEst(sy,sm);
// промокоды 'активирован' отметки — объединяем список из приложения (тот же ПК) с отметками браузера (только добавление)
if(p.promo_used&&p.promo_used.length){var PU="guide.promo.used",pu=L(PU,{}),add=0;p.promo_used.forEach(function(c){if(!pu[c]){pu[c]=Date.now();add++}});if(add)S(PU,pu)}
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) Прогресс, переданный кнопкой "Открыть гайд" оверлея через хеш адреса (#sync=base64 JSON) — работает независимо от политики браузера по локальной сети
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0,"hash");history.replaceState(null,"",location.pathname+location.search)}}catch(e){ev("sync_fail_hash",{reason:"decode"})}}
else if(h.indexOf("#sync-fail")===0){ev("sync_fail_hash",{reason:h.slice(11)||"app"});history.replaceState(null,"",location.pathname+location.search)}
// 2) Прямое чтение из сайдкара на том же ПК — чтобы с https-страницы обратиться к 127.0.0.1, Chrome требует targetAddressSpace:"loopback"  и
//    в первый раз показывает окно "Разрешить доступ к локальной сети" запрос появляется один раз. Чтобы не показывать его посетителям без приложения, автоматическая попытка выполняется
//    только в браузерах, которые уже синхронизировались; в новых браузерах — кнопка вверху (действие пользователя).
var URL0="http://127.0.0.1:8765/progress";
function perm(){try{if(!navigator.permissions||!navigator.permissions.query)return Promise.resolve("na");
return navigator.permissions.query({name:"local-network-access"}).catch(function(){return navigator.permissions.query({name:"loopback-network"})}).then(function(s){return s.state},function(){return "na"})}catch(e){return Promise.resolve("na")}}
// Причины сбоя: доступ запрещён / приложение запущено, но это старая версия без синхронизации (запрос no-cors доходит) / приложение выключено или заблокировано / тайм-аут
function classify(why){return perm().then(function(ps){if(ps==="denied")return {reason:"perm_denied",perm:ps};if(why==="timeout")return {reason:"timeout",perm:ps};
var o={mode:"no-cors",cache:"no-store"};o.targetAddressSpace="loopback";
return fetch(URL0,o).then(function(){return {reason:"app_old",perm:ps}},function(){return {reason:"app_off",perm:ps}})})}
function pull(manual){var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},manual?25000:12000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
return fetch(URL0+"?game_mode="+qmode(),opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok){try{localStorage.removeItem(SE)}catch(x){}apply(p,manual?"manual":"auto");return true}throw new Error("Неверный формат ответа")})
.catch(function(e){clearTimeout(tm);var why=(e&&e.name==="AbortError")?"timeout":"net";
return classify(why).then(function(c){ev(manual?"sync_fail_manual":"sync_fail_auto",{reason:c.reason,perm:c.perm},!manual);
S(SE,{ts:Date.now(),reason:c.reason,msg:c.reason==="perm_denied"?"Браузер блокирует доступ к локальной сети":c.reason==="app_old"?"Старая версия оверлея без синхронизации":c.reason==="timeout"?"Нет ответа (тайм-аут)":"Оверлей выключен или соединение заблокировано"});
if(manual)return false;if(window.__guideSync)return false;
var old=L("guide.sync.m."+gsm(),null);if(!old){var lg=L(SK,null);if(lg&&lg.ts&&smodeOf(lg.mode)===gsm()){lg.smode=gsm();old=lg}}
if(old&&old.ts){window.__guideSync=old;chip(old,true);document.dispatchEvent(new CustomEvent("guide-sync",{detail:old}))}return false})})}
if(window.__guideSync||L(SK,null)){pull(false);return}
var top=document.querySelector(".top .wrap");if(!top)return;
// На телефонах и планшетах (без мыши) кнопки нет: оверлей не может быть на том же ПК (нажатие всегда давало ошибку, 11-04)
var touch=window.matchMedia&&window.matchMedia("(hover: none)").matches;if(touch&&window.innerWidth<1024)return;
var b=document.createElement("button");b.type="button";b.className="sync btn";b.textContent="🔗 Связь";
b.title="Загружает в этот браузер прогресс квестов·уровни убежища из оверлея цен, запущенного на этом же ПК. Данные не покидают браузер.";
ev("sync_btn_view",{touch:touch?1:0},true);
b.addEventListener("click",function(){if(b.disabled)return;ev("sync_click");b.disabled=true;b.textContent="Подключение…";
pull(true).then(function(ok){if(ok){b.remove();return}b.disabled=false;b.textContent="🔗 Связь";help(L(SE,{}).reason)})});
top.appendChild(b);
function help(reason){var old=document.querySelector(".synchelp");if(old)old.remove();var h=document.createElement("div");h.className="synchelp";
var msg=reason==="perm_denied"?'<b>Браузер блокирует этому сайту доступ к локальной сети.</b> Chrome/Edge: <b>замок в адресной строке → Настройки сайта → Доступ к локальной сети → Разрешить</b> затем обновите страницу. Brave: <b>brave://settings/content/localhostAccess</b> и разрешите этот сайт.'
:reason==="app_old"?'<b>Оверлей запущен, но это старая версия без синхронизации.</b> Обновите оверлей до <a href="'+HOME+'">последней версии</a> и нажмите снова (установленная версия обновится сама при следующем запуске).'
:'<b>Оверлей не найден.</b> Запустите на этом же ПК <a href="'+HOME+'">Оверлей цен</a>(1.2.6 или новее) на этом ПК и нажмите снова. Если Chrome "доступ к локальной сети", измените: <b>замок в адресной строке → Настройки сайта → Доступ к локальной сети → Разрешить</b>, в Brave <b>brave://settings/content/localhostAccess</b>.';
h.innerHTML=msg+' Если не получилось, откройте сайт кнопкой оверлея <b>Настройки → Связать с сайтом</b> в оверлее — прогресс передастся вместе с переходом. <button type="button" class="x" aria-label="Закрыть">✕</button>';
h.querySelector(".x").addEventListener("click",function(){h.remove()});document.querySelector(".top").insertAdjacentElement("afterend",h)}
})()