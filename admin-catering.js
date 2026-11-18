/* Beheer: cateringaanvragen (Forum). Leest en wijzigt via databasefuncties met het persoonlijke account
   (mtf_catering_list / mtf_catering_set_status): alleen de eigenaar of medewerkers met recht op bestellingen. */
(()=>{
 const tab=document.querySelector('[data-tab="cateringPanel"]'),list=document.getElementById('cateringList');if(!tab||!list)return;
 const STATUSES=['Nieuw','In behandeling','Offerte verstuurd','Bevestigd','Afgewezen'],OPEN=new Set(['Nieuw','In behandeling','Offerte verstuurd']);
 const st=document.createElement('style');st.textContent='.catering-filters{display:flex;gap:8px;margin:0 0 14px}.chip-btn{border:1px solid rgba(var(--mtf-gold-rgb),.4);background:transparent;color:inherit;border-radius:999px;padding:7px 14px;cursor:pointer;font:inherit}.chip-btn.active{background:rgba(var(--mtf-gold-rgb),.18)}.catering-list{display:grid;gap:12px}.catering-card{border:1px solid rgba(var(--mtf-gold-rgb),.25);border-radius:14px;padding:16px 18px;background:rgba(255,255,255,.02)}.catering-card header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}.catering-card h3{margin:0;font-size:18px}.catering-card dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:12px 0}.catering-card dt{color:var(--mtf-text-muted)}.catering-card dd{margin:0;overflow-wrap:anywhere}.catering-card .cf-msg{white-space:pre-wrap;margin:8px 0 12px}.cf-badge{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;background:rgba(var(--mtf-gold-rgb),.2)}.cf-badge.Nieuw{background:#c80f1a;color:#fff}.catering-card select{font:inherit;padding:6px 8px;border-radius:8px}.catering-card.flash{outline:2px solid var(--mtf-gold);outline-offset:3px}.catering-views{display:flex;gap:8px;margin:0 0 14px}.cal-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}.cal-bar h2{margin:0 12px;font-size:20px;text-transform:capitalize}.cal-legend{margin:0 0 0 auto;display:flex;gap:8px;align-items:center;font-size:13px}.cal-key{display:inline-block;width:14px;height:14px;border-radius:4px}.cal-key.ok,.cal-ev.ok{background:#1f7a45;color:#fff}.cal-key.opt,.cal-ev.opt{background:rgba(var(--mtf-gold-rgb),.15);border:1px dashed var(--mtf-gold)}.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.cal-head{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mtf-text-muted);padding:0 4px}.cal-day{min-height:96px;border:1px solid rgba(var(--mtf-gold-rgb),.2);border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:4px;background:rgba(255,255,255,.02)}.cal-day.out{opacity:.4}.cal-day.today{border-color:var(--mtf-gold);box-shadow:inset 0 0 0 1px var(--mtf-gold)}.cal-num{font-size:12px;font-weight:700}.cal-week .cal-day{min-height:260px}.cal-ev{display:block;width:100%;text-align:left;border:0;border-radius:7px;padding:5px 7px;font:inherit;font-size:12px;line-height:1.3;cursor:pointer;color:inherit}.cal-ev b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cal-ev span{display:block;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cal-ev:focus-visible{outline:2px solid var(--mtf-gold)}.cal-sum{margin-top:10px;font-size:14px;color:var(--mtf-text-muted)}@media(max-width:760px){.cal-grid{grid-template-columns:1fr}.cal-head{display:none}.cal-day{min-height:0}.cal-day.empty-m{display:none}.cal-week .cal-day{min-height:0}.cal-legend{margin:0}}';document.head.append(st);
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const day=d=>new Intl.DateTimeFormat('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
 const when=t=>new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'}).format(new Date(t));
 let rows=[],filter='open';
 /* Zichtbaarheid: eigenaar of recht op bestellingen. */
 const allowed=()=>typeof can==='function'&&!!currentActor&&!currentActor.legacy&&can('orders');
 new MutationObserver(()=>{const want=!allowed();if(tab.hidden!==want)tab.hidden=want;}).observe(tab,{attributes:true,attributeFilter:['hidden']});
 async function rpc(fn,body={}){
  const access=typeof freshAccess==='function'?await freshAccess():null;if(!access)throw Error('Log in met je persoonlijke account om cateringaanvragen te bekijken.');
  const r=await fetch(SITE_CONFIG.supabaseUrl+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:SITE_CONFIG.publishableKey,Authorization:'Bearer '+access},body:JSON.stringify(body)});
  const x=await r.json().catch(()=>null);if(!r.ok)throw Error(x?.message||'Er ging iets mis.');return x;
 }
 function render(){
  const shown=rows.filter(r=>filter==='all'||OPEN.has(r.status));
  const n=rows.filter(r=>r.status==='Nieuw').length,c=document.getElementById('navCateringCount');if(c){c.textContent=n;c.hidden=!n;}
  if(!shown.length){list.innerHTML='<p>'+(filter==='open'?'Geen openstaande aanvragen.':'Nog geen aanvragen.')+'</p>';return;}
  list.innerHTML=shown.map(r=>`<article class="catering-card"><header><h3>${e(r.name)} · ${e(r.persons)} personen</h3><span class="cf-badge ${e(r.status.replace(/\s/g,''))}">${e(r.status)}</span></header>
<dl><dt>Datum event</dt><dd>${e(day(r.event_date))}</dd><dt>Locatie event</dt><dd>${e(r.event_location)}</dd><dt>Telefoon</dt><dd><a href="tel:${e(r.phone.replace(/[^\d+]/g,''))}">${e(r.phone)}</a></dd><dt>E-mail</dt><dd><a href="mailto:${e(r.email)}">${e(r.email)}</a></dd><dt>Adres</dt><dd>${e(r.address)}</dd><dt>Huur borden</dt><dd>${r.rent_plates?'Ja':'Nee'}</dd><dt>Huur bestek</dt><dd>${r.rent_cutlery?'Ja':'Nee'}</dd><dt>Ontvangen</dt><dd>${e(when(r.created_at))}${r.handled_by?' · laatst bijgewerkt door '+e(r.handled_by):''}</dd></dl>
${r.message?`<p class="cf-msg">${e(r.message)}</p>`:''}<label>Status <select data-cid="${e(r.id)}">${STATUSES.map(s=>`<option${s===r.status?' selected':''}>${s}</option>`).join('')}</select></label></article>`).join('');
  list.querySelectorAll('select[data-cid]').forEach(sel=>sel.onchange=async()=>{sel.disabled=true;try{await rpc('mtf_catering_set_status',{p_id:sel.dataset.cid,p_status:sel.value});const r=rows.find(x=>x.id===sel.dataset.cid);if(r)r.status=sel.value;render();if(typeof toast==='function')toast('Status bijgewerkt');}catch(err){sel.disabled=false;if(typeof toast==='function')toast(err.message);else list.insertAdjacentHTML('afterbegin','<p>'+e(err.message)+'</p>');}});
 }

 /* Kalender: ingeplande opdrachten (Bevestigd) en opties (Offerte verstuurd) op datum event. */
 const CAL={ 'Bevestigd':'ok','Offerte verstuurd':'opt' };
 const iso=d=>d.toISOString().slice(0,10);
 const todayIso=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam'}).format(new Date());
 const at=s=>new Date(s+'T12:00:00Z');
 const addDays=(d,n)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;};
 const monday=d=>addDays(d,-((d.getUTCDay()+6)%7));
 let view='list',anchor=at(todayIso());
 const fmt=(o,d)=>new Intl.DateTimeFormat('nl-NL',{...o,timeZone:'UTC'}).format(d);
 function evHtml(r){const k=CAL[r.status];return `<button type="button" class="cal-ev ${k}" data-open="${e(r.id)}" title="${e(r.name+' · '+r.persons+' personen · '+r.event_location+' · '+r.status)}"><b>${e(r.persons)} p. · ${e(r.name)}</b><span>${e(r.event_location)}</span></button>`;}
 function renderCal(){
  const box=document.getElementById('cateringCal'),title=document.getElementById('calTitle');if(!box)return;
  const planned=rows.filter(r=>CAL[r.status]);const byDay={};for(const r of planned)(byDay[r.event_date]=byDay[r.event_date]||[]).push(r);
  const t=todayIso();let start,days,cls='';
  if(view==='week'){start=monday(anchor);days=7;cls=' cal-week';const end=addDays(start,6);title.textContent='Week '+weekNo(start)+' · '+fmt({day:'numeric',month:'short'},start)+' – '+fmt({day:'numeric',month:'short',year:'numeric'},end);}
  else{const first=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth(),1));start=monday(first);const last=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,0));days=Math.ceil((last-start)/864e5+1);days=Math.ceil(days/7)*7;title.textContent=fmt({month:'long',year:'numeric'},first);}
  const heads=['ma','di','wo','do','vr','za','zo'].map(h=>`<div class="cal-head">${h}</div>`).join('');
  let cells='',count=0,persons=0;
  for(let i=0;i<days;i++){const d=addDays(start,i),k=iso(d),list=(byDay[k]||[]).sort((a,b)=>a.status===b.status?0:a.status==='Bevestigd'?-1:1);
   const out=view==='month'&&d.getUTCMonth()!==anchor.getUTCMonth();
   if(!out){count+=list.filter(r=>r.status==='Bevestigd').length;persons+=list.filter(r=>r.status==='Bevestigd').reduce((s,r)=>s+r.persons,0);}
   cells+=`<div class="cal-day${out?' out':''}${k===t?' today':''}${!list.length?' empty-m':''}"><span class="cal-num">${view==='week'?fmt({weekday:'short',day:'numeric',month:'short'},d):fmt({weekday:'short',day:'numeric'},d)}</span>${list.map(evHtml).join('')}</div>`;}
  box.innerHTML=`<div class="cal-grid${cls}">${heads}${cells}</div><p class="cal-sum">${count?`${count} bevestigde opdracht${count===1?'':'en'}, samen ${persons} personen in deze ${view==='week'?'week':'maand'}.`:`Geen bevestigde opdrachten in deze ${view==='week'?'week':'maand'}.`}</p>`;
  box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openCard(b.dataset.open));
 }
 function weekNo(d){const x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));x.setUTCDate(x.getUTCDate()+4-(x.getUTCDay()||7));const y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil(((x-y)/864e5+1)/7);}
 function setView(v){view=v;document.querySelectorAll('[data-cv]').forEach(x=>x.classList.toggle('active',x.dataset.cv===v));document.getElementById('cateringListView').hidden=v!=='list';document.getElementById('cateringCalView').hidden=v==='list';if(v==='list')render();else renderCal();}
 function openCard(id){filter='all';document.querySelectorAll('[data-cf]').forEach(x=>x.classList.toggle('active',x.dataset.cf==='all'));setView('list');const c=list.querySelector(`select[data-cid="${CSS.escape(id)}"]`)?.closest('.catering-card');if(c){c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.add('flash');setTimeout(()=>c.classList.remove('flash'),2200);}}
 document.querySelectorAll('[data-cv]').forEach(b=>b.onclick=()=>setView(b.dataset.cv));
 document.querySelectorAll('[data-cal]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.cal);if(!n)anchor=at(todayIso());else if(view==='week')anchor=addDays(anchor,7*n);else anchor=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+n,1));renderCal();});
 async function load(){list.innerHTML='<p>Aanvragen laden…</p>';try{rows=await rpc('mtf_catering_list');render();if(view!=='list')renderCal();}catch(err){list.innerHTML='<p>'+e(err.message)+'</p>';}}
 tab.addEventListener('click',load);
 document.getElementById('cateringRefresh').onclick=load;
 document.querySelectorAll('[data-cf]').forEach(b=>b.onclick=()=>{filter=b.dataset.cf;document.querySelectorAll('[data-cf]').forEach(x=>x.classList.toggle('active',x===b));render();});
 /* Teller in het menu bijwerken zodra er is ingelogd. */
 const t=setInterval(()=>{if(allowed()){clearInterval(t);tab.hidden=false;rpc('mtf_catering_list').then(r=>{rows=r;render();}).catch(()=>{});}},1500);
})();
