(function(){
// Верхнее меню групп: на тач-устройствах без мыши или узких экранах нажатие на заголовок группы раскрывает её, повторное — переходит. Клик снаружи закрывает
var noHover=window.matchMedia&&window.matchMedia("(hover: none)").matches;
document.addEventListener("click",function(ev){var gt=ev.target.closest(".top nav .gt");var open=document.querySelectorAll(".top nav .g.open");
if(!gt){open.forEach(function(g){g.classList.remove("open")});return}
var g=gt.parentNode,narrow=window.innerWidth<900;if(!(noHover||narrow))return;
if(!g.classList.contains("open")){ev.preventDefault();open.forEach(function(x){x.classList.remove("open")});g.classList.add("open")}});
})();
(function(){
var MK="guide.mode",KEY="guide.quests",SK="guide.sync",SYNCED="guide.quests.synced",SE="guide.sync.err";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function ev(n,prm,once){try{if(once){var sk="gsev."+n;if(sessionStorage.getItem(sk))return;sessionStorage.setItem(sk,"1")}if(window.gtag)gtag("event",n,prm||{})}catch(e){}}
function bucket(n){return n<1?"0":n<10?"1-9":n<50?"10-49":n<150?"50-149":"150+"}
function gmode(){return L(MK,"pvp")==="pve"?"pve":"regular"}
function qmode(){var sy=L(SK,null);if(!sy||!sy.ts)return "auto";var g=gmode();if(sy.mode==="season"&&g==="regular")return "season";return g}
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top)return;var old=document.querySelector(".sync");if(old)old.remove();var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href=stale?"#":"/guide/quests/";
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0,agoTxt=ago<1?"только что":ago<60?ago+" мин назад":Math.round(ago/60)+" ч назад";
var base="🔗 Связь с оверлеем · выполнено "+n+""+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (сезон)":" (PVP)");
a.textContent=stale?(base+" · "+agoTxt+" по данным ↻"):base;
var err=L(SE,null);
a.title=stale?("Используется последний полученный прогресс ("+agoTxt+"). Сейчас прочитать оверлей напрямую не удалось"+(err&&err.msg?" — "+err.msg:"")+". Нажмите, чтобы прочитать снова. Если Chrome блокирует 'доступ к локальной сети': замок в адресной строке → Настройки сайта → Доступ к локальной сети → Разрешить"):"Автоматически учитываются квесты, выполнение которых оверлей цен определил по логам игры";
if(stale)a.addEventListener("click",function(ev){ev.preventDefault();if(a.dataset.busy)return;a.dataset.busy="1";a.textContent="Повторная попытка связи…";pull(true).then(function(ok){delete a.dataset.busy;if(ok)return;chip(sy,true);help()})});
top.appendChild(a)}
// Переключаем режим сайта на сервер (PVE/PVP), который сообщил оверлей — иначе автозагрузка на следующей странице возьмёт прогресс другого сервера и "выполнено n"изменится
function apply(p,how){if(how)ev("sync_ok_"+how,{sync_mode:p.mode||"",done_bucket:bucket((p.completed||[]).length)},how==="auto");if(p.mode==="pve"||p.mode==="regular"||p.mode==="pvp"||p.mode==="season"){var nm=p.mode==="pve"?"pve":"pvp";if(L(MK,"pvp")!==nm)S(MK,nm)}
var done=L(KEY,{}),syn=L(SYNCED,{}),changed=0;(p.completed||[]).forEach(function(id){if(!done[id]){done[id]=1;changed++}syn[id]=1});if(changed)S(KEY,done);S(SYNCED,syn);
var sy={ts:Date.now(),mode:p.mode,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0,promo_used:p.promo_used||[]};S(SK,sy);window.__guideSync=sy;chip(sy,false);
// промокоды 'активирован' отметки — объединяем список из приложения (тот же ПК) с отметками браузера (только добавление)
if(p.promo_used&&p.promo_used.length){var PU="guide.promo.used",pu=L(PU,{}),add=0;p.promo_used.forEach(function(c){if(!pu[c]){pu[c]=Date.now();add++}});if(add)S(PU,pu)}
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
// 1) Прогресс, переданный кнопкой "Открыть гайд" оверлея через хеш адреса (#sync=base64 JSON) — работает независимо от политики браузера по локальной сети
var h=location.hash||"";if(h.indexOf("#sync=")===0){try{var raw=decodeURIComponent(h.slice(6)),p0=JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g,"+").replace(/_/g,"/")))));
if(p0&&p0.completed){p0.ok=true;apply(p0,"hash");history.replaceState(null,"",location.pathname+location.search)}}catch(e){}}
// 2) Прямое чтение из сайдкара на том же ПК — чтобы с https-страницы обратиться к 127.0.0.1, Chrome требует targetAddressSpace:"loopback"  и
//    в первый раз показывает окно "Разрешить доступ к локальной сети" . При отказе·отсутствии поддержки молча показываем только последнее значение связи.
//    Чтобы не показывать окно разрешения посетителям без приложения, автопопытка делается только в браузере, где связь уже была хотя бы раз,
//    а в новом браузере сверху ставим кнопку "Синхронизация с оверлеем" и пробуем только по нажатию пользователя (пользовательское действие).
function pull(manual){var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},manual?25000:12000);
var opt={signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"};opt.targetAddressSpace="loopback";
return fetch("http://127.0.0.1:8765/progress?game_mode="+qmode(),opt).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok){try{localStorage.removeItem(SE)}catch(x){}apply(p,manual?"manual":"auto");return true}throw new Error("Неверный формат ответа")})
.catch(function(e){clearTimeout(tm);var why=(e&&e.name==="AbortError")?"timeout":(e&&e.name)||"error";ev(manual?"sync_fail_manual":"sync_fail_auto",{reason:why},!manual);S(SE,{ts:Date.now(),msg:(e&&e.name==="AbortError")?"Нет ответа (тайм-аут)":String(e&&e.message||e)});if(manual)return false;if(window.__guideSync)return false;var old=L(SK,null);if(old&&old.ts){window.__guideSync=old;chip(old,true);document.dispatchEvent(new CustomEvent("guide-sync",{detail:old}))}return false})}
if(window.__guideSync||L(SK,null)){pull(false);return}
var top=document.querySelector(".top .wrap");if(!top)return;
var b=document.createElement("button");b.type="button";b.className="sync btn";b.textContent="🔗 Связь с оверлеем";
b.title="Загружает в этот браузер прогресс квестов·уровни убежища из оверлея цен, запущенного на этом же ПК. Данные не покидают браузер.";
b.addEventListener("click",function(){if(b.disabled)return;ev("sync_click");b.disabled=true;b.textContent="Подключение…";
pull(true).then(function(ok){if(ok){b.remove();return}b.disabled=false;b.textContent="🔗 Связь с оверлеем";help()})});
top.appendChild(b);
function help(){var old=document.querySelector(".synchelp");if(old)old.remove();var h=document.createElement("div");h.className="synchelp";
h.innerHTML='<b>Оверлей не найден.</b> Запустите на этом же ПК <a href="/">Оверлей цен</a>(последняя версия с функцией связи) должен быть запущен — затем нажмите снова. Если Chrome блокирует "доступ к локальной сети", измените: <b>замок в адресной строке → Настройки сайта → Доступ к локальной сети → Разрешить</b> и обновите страницу. Если не помогло, откройте этот сайт кнопкой <b>Настройки → Связать с сайтом</b> в оверлее — прогресс передастся вместе с переходом. <button type="button" class="x" aria-label="Закрыть">✕</button>';
h.querySelector(".x").addEventListener("click",function(){h.remove()});document.querySelector(".top").insertAdjacentElement("afterend",h)}
})();