(function(){
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
