(function(){
var MK="guide.mode",KEY="guide.quests",SK="guide.sync",SYNCED="guide.quests.synced";
function L(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}function S(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var mode=L(MK,"pvp"),gm=mode==="pve"?"pve":"regular";
function chip(sy,stale){var top=document.querySelector(".top .wrap");if(!top||document.querySelector(".sync"))return;var a=document.createElement("a");a.className="sync"+(stale?" stale":"");a.href="/guide/sync/";
var n=(sy.completed||[]).length,ago=stale?Math.round((Date.now()-sy.ts)/60000):0;a.textContent=stale?("오버레이 연동 끊김 · 마지막 "+(ago<60?ago+"분 전":Math.round(ago/60)+"시간 전")):("🔗 오버레이 연동 · 완료 "+n+"개"+(sy.mode==="pve"?" (PVE)":sy.mode==="season"?" (시즌)":" (PVP)"));
a.title=stale?"시세 오버레이가 꺼져 있어요. 켜 두면 깬 퀘스트가 자동 반영됩니다.":"시세 오버레이가 게임 로그로 확인한 완료 퀘스트를 자동 반영 중";top.appendChild(a)}
function apply(p){var done=L(KEY,{}),syn=L(SYNCED,{}),changed=0;(p.completed||[]).forEach(function(id){if(!done[id]){done[id]=1;changed++}syn[id]=1});if(changed)S(KEY,done);S(SYNCED,syn);
var sy={ts:Date.now(),mode:p.mode,completed:p.completed||[],started:p.started||[],hideout:p.hideout||{},quest_count:p.quest_count||0};S(SK,sy);window.__guideSync=sy;chip(sy,false);
document.dispatchEvent(new CustomEvent("guide-sync",{detail:sy}))}
var ctrl=("AbortController" in window)?new AbortController():null,tm=setTimeout(function(){if(ctrl)ctrl.abort()},2500);
fetch("http://127.0.0.1:8765/progress?game_mode="+gm,{signal:ctrl&&ctrl.signal,cache:"no-store",mode:"cors"}).then(function(r){return r.json()}).then(function(p){clearTimeout(tm);if(p&&p.ok)apply(p)})
.catch(function(){clearTimeout(tm);var old=L(SK,null);if(old&&old.ts){window.__guideSync=old;chip(old,true)}});
})();