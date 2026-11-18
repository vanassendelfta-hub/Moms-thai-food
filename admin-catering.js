/* Beheer: cateringaanvragen (Forum). Leest en wijzigt via databasefuncties met het persoonlijke account
   (mtf_catering_list / mtf_catering_set_status): alleen de eigenaar of medewerkers met recht op bestellingen. */
(()=>{
 const tab=document.querySelector('[data-tab="cateringPanel"]'),list=document.getElementById('cateringList');if(!tab||!list)return;
 const STATUSES=['Nieuw','In behandeling','Offerte verstuurd','Bevestigd','Afgewezen'],OPEN=new Set(['Nieuw','In behandeling','Offerte verstuurd']);
 const st=document.createElement('style');st.textContent='.catering-filters{display:flex;gap:8px;margin:0 0 14px}.chip-btn{border:1px solid rgba(var(--mtf-gold-rgb),.4);background:transparent;color:inherit;border-radius:999px;padding:7px 14px;cursor:pointer;font:inherit}.chip-btn.active{background:rgba(var(--mtf-gold-rgb),.18)}.catering-list{display:grid;gap:12px}.catering-card{border:1px solid rgba(var(--mtf-gold-rgb),.25);border-radius:14px;padding:16px 18px;background:rgba(255,255,255,.02)}.catering-card header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}.catering-card h3{margin:0;font-size:18px}.catering-card dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:12px 0}.catering-card dt{color:var(--mtf-text-muted)}.catering-card dd{margin:0;overflow-wrap:anywhere}.catering-card .cf-msg{white-space:pre-wrap;margin:8px 0 12px}.cf-badge{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;background:rgba(var(--mtf-gold-rgb),.2)}.cf-badge.Nieuw{background:#c80f1a;color:#fff}.catering-card select{font:inherit;padding:6px 8px;border-radius:8px}';document.head.append(st);
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
 async function load(){list.innerHTML='<p>Aanvragen laden…</p>';try{rows=await rpc('mtf_catering_list');render();}catch(err){list.innerHTML='<p>'+e(err.message)+'</p>';}}
 tab.addEventListener('click',load);
 document.getElementById('cateringRefresh').onclick=load;
 document.querySelectorAll('[data-cf]').forEach(b=>b.onclick=()=>{filter=b.dataset.cf;document.querySelectorAll('[data-cf]').forEach(x=>x.classList.toggle('active',x===b));render();});
 /* Teller in het menu bijwerken zodra er is ingelogd. */
 const t=setInterval(()=>{if(allowed()){clearInterval(t);tab.hidden=false;rpc('mtf_catering_list').then(r=>{rows=r;render();}).catch(()=>{});}},1500);
})();
