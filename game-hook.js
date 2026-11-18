/* Wok Challenge: link op de website + tab in het beheerscherm. Wordt geladen via branch.js. */
(()=>{
const API=SITE_CONFIG.supabaseUrl+'/functions/v1/game';
const admin=location.pathname.includes('admin');
const call=async(action,params={},auth)=>{const r=await MTF.fetch(API,{method:'POST',headers:{'Content-Type':'application/json',...(auth||{})},body:JSON.stringify({action,...params})});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Verzoek mislukt');return d;};
const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Publieke website ---------- */
if(!admin){
 const ready=f=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',f):f();
 ready(async()=>{
  if(location.pathname.startsWith('/game'))return;
  let d;try{d=await call('config');}catch{return;}
  if(!d.visible)return;
  const nav=document.querySelector('.topbar .nav, header .nav, nav');
  if(nav&&!nav.querySelector('[data-game-link]')){const a=document.createElement('a');a.href='/game';a.dataset.gameLink='';a.textContent='🎮 Wok Challenge';nav.prepend(a);}
  const home=location.pathname==='/'||location.pathname==='/index'||location.pathname==='/index.html';
  let closed=false;try{closed=sessionStorage.getItem('mtf_game_pill')==='closed';}catch{}
  if(home&&!closed){
   const s=document.createElement('style');s.textContent='.mtf-game-pill{position:fixed;left:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:6px;background:var(--mtf-red);color:#fff;border:2px solid #f2c14e;border-radius:999px;padding:10px 12px 10px 16px;font:700 15px/1.2 system-ui,Arial;box-shadow:0 8px 20px rgba(0,0,0,.25)}.mtf-game-pill a{color:#fff;text-decoration:none}.mtf-game-pill button{background:none;border:0;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:0 4px;opacity:.8}';
   const p=document.createElement('div');p.className='mtf-game-pill';p.innerHTML='<a href="/game">🎮 Speel de Wok Challenge</a><button type="button" aria-label="Sluiten">×</button>';
   p.querySelector('button').onclick=()=>{p.remove();try{sessionStorage.setItem('mtf_game_pill','closed');}catch{}};
   document.head.append(s);document.body.append(p);
  }
 });
 return;
}

/* ---------- Beheerscherm ---------- */
window.addEventListener('load',()=>{
 if(typeof panel!=='function'||!document.querySelector('.admin-tabs'))return;
 viewNames.gamePanel='Wok Challenge';
 const btn=document.createElement('button');btn.type='button';btn.dataset.tab='gamePanel';btn.hidden=true;btn.textContent='Wok Challenge';
 const anchor=document.querySelector('[data-tab="promotionsPanel"]');anchor?anchor.after(btn):document.querySelector('.admin-tabs .sidebar-bottom').before(btn);
 const sec=document.createElement('section');sec.id='gamePanel';sec.hidden=true;
 sec.innerHTML=`<div class="admin-title"><div><h1>Wok Challenge</h1><p class="hint">Zet de game aan of uit op de website en volg spelers en scores.</p></div><div class="toolbar-actions"><button type="button" class="secondary-button" id="gameRefresh">↻ Verversen</button><a class="secondary-button" href="/game#preview" target="_blank" rel="noopener">Game bekijken ↗</a></div></div>
 <div class="shop-panel"><div><strong id="gameState">Status laden…</strong><p id="gameStateSub">Onzichtbaar: geen link op de website en de game neemt geen scores aan.</p></div><button id="gameToggle" class="switch-btn" type="button" disabled>…</button></div>
 <div id="gameStats" class="dashstats"></div>
 <div class="action-row"><button type="button" class="btn-red" id="gameExport">Alle spelers downloaden (CSV)</button></div>
 <p class="hint">Spelers die “acties en nieuws” aanvinken, krijgen een bevestigingsmail en komen na bevestiging in je nieuwsbrieflijst (Feestdagen & marketing). Stuur alleen reclame naar bevestigde abonnees.</p>
 <h2>Ranglijst (beste score per speler)</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>Naam</th><th>E-mail</th><th>Beste score</th><th>Gespeeld</th><th>Reclame</th><th>Laatst</th></tr></thead><tbody id="gameTop"></tbody></table></div>
 <h2>Laatste inzendingen</h2><div class="table-wrap"><table><thead><tr><th>Moment</th><th>Naam</th><th>E-mail</th><th>Score</th><th>Mail</th></tr></thead><tbody id="gameRecent"></tbody></table></div>`;
 const after=document.getElementById('promotionsPanel')||document.getElementById('usersPanel');after.after(sec);
 const q=s=>sec.querySelector(s);let state=null,busy=false;
 const when=t=>new Date(t).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 const news={subscribed:'Ja (bevestigd)',pending:'Aangevraagd',unsubscribed:'Afgemeld',none:'Nee'};
 async function token(){const t=typeof freshAccess==='function'?await freshAccess():null;if(t)return {Authorization:'Bearer '+t};let k='';try{k=sessionStorage.getItem('mtf_admin_session')||'';}catch{}if(k)return {'x-admin-key':k};throw Error('Log opnieuw in om de game te beheren.');}
 function draw(){const s=state.settings,st=state.stats;
  q('#gameState').textContent=s.visible?'De game is zichtbaar op de website':'De game is onzichtbaar';
  q('#gameStateSub').textContent=s.visible?'Bezoekers zien de link en kunnen scores insturen op momsthaifood.nl/game.':'Geen link op de website en de game neemt geen scores aan.';
  const t=q('#gameToggle');t.disabled=false;t.textContent=s.visible?'Game verbergen':'Game zichtbaar maken';t.classList.toggle('open',s.visible);
  q('#gameStats').innerHTML=[[st.players,'Spelers (mailadressen)'],[st.plays,'Ingestuurde scores'],[st.plays_24h,'Laatste 24 uur'],[st.optins,'Wil reclame ontvangen'],[st.mail_failed,'Mislukte scoremails']].map(([n,l])=>`<div class="metric"><strong>${h(n)}</strong><span>${h(l)}</span></div>`).join('');
  q('#gameTop').innerHTML=state.top.map((x,i)=>`<tr><td>${i+1}</td><td>${h(x.name)}</td><td>${h(x.email)}</td><td><strong>${h(x.best_score)}</strong></td><td>${h(x.plays)}×</td><td>${h(x.marketing_optin?news[x.newsletter]||'Aangevraagd':'Nee')}</td><td>${h(when(x.last_played_at))}</td></tr>`).join('')||'<tr><td colspan="7">Nog geen spelers.</td></tr>';
  q('#gameRecent').innerHTML=state.recent.map(x=>`<tr><td>${h(when(x.created_at))}</td><td>${h(x.name)}</td><td>${h(x.email)}</td><td>${h(x.score)}</td><td>${x.mail_status==='sent'?'Verstuurd':x.mail_status==='failed'?'<span class="low">Mislukt</span>':'Bezig'}</td></tr>`).join('')||'<tr><td colspan="5">Nog geen inzendingen.</td></tr>';}
 async function load(silent){if(busy)return;busy=true;try{state=await call('admin_overview',{},await token());draw();}catch(e){q('#gameState').textContent=e.message;if(!silent)toast(e.message);}finally{busy=false;}}
 q('#gameRefresh').onclick=()=>load();
 q('#gameToggle').onclick=async()=>{if(!state)return;const next=!state.settings.visible;if(next&&!confirm('Game zichtbaar maken op momsthaifood.nl?'))return;const t=q('#gameToggle');t.disabled=true;try{await call('admin_toggle',{visible:next},await token());toast(next?'Game staat live':'Game is verborgen');await load(true);}catch(e){toast(e.message);t.disabled=false;}};
 q('#gameExport').onclick=async()=>{const b=q('#gameExport');b.disabled=true;try{const d=await call('admin_export',{},await token());const blob=new Blob(['﻿'+d.csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='wok-challenge-spelers-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast(d.count+' spelers gedownload');}catch(e){toast(e.message);}finally{b.disabled=false;}};
 const prevPanel=panel;panel=function(id){prevPanel(id);sec.hidden=id!=='gamePanel';btn.classList.toggle('active',id==='gamePanel');if(id==='gamePanel')document.querySelectorAll('.admin-main section[id$="Panel"]').forEach(x=>{if(x!==sec)x.hidden=true;});};
 btn.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===btn));panel('gamePanel');load();});
 const allowed=()=>typeof currentActor!=='undefined'&&currentActor&&(currentActor.legacy||currentActor.owner||currentActor.permissions?.shop);
 const prevRights=applyRights;applyRights=function(){prevRights();btn.hidden=!allowed();};
 btn.hidden=!allowed();
 setInterval(()=>{if(!sec.hidden&&!document.hidden)load(true);},30000);
});
})();
