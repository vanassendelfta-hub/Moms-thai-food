(()=>{
 const R=MTFOrderRules,f=document.querySelector('#form'),date=f.elements.date,time=f.elements.time;
 const wrap=document.querySelector('#bookingCalendar'),slots=document.querySelector('#bookingSlots'),banner=document.createElement('section');
 banner.id='specialHours';banner.className='special-hours';banner.hidden=true;banner.setAttribute('aria-label','Aangepaste openingstijden');const homeLogo=document.querySelector('.hero-brand-logo');if(homeLogo){homeLogo.after(banner);banner.classList.add('special-hours-home');}else document.querySelector('.topbar').after(banner);
 let ready=false,fetching=false,month=R.clock().date.slice(0,7),chosenDate='',chosenTime='',rows=[];
 const dateLabel=d=>new Intl.DateTimeFormat('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function choices(d){const h=R.opening(d),c=R.clock();if(!h||d<c.date||d===c.date&&c.seconds>R.cutoff(d)*60)return [];const out=[];for(let m=h[0];m<=h[1];m+=15)if(d!==c.date||m*60>c.seconds)out.push(R.formatTime(m));return out;}
 function addMonth(m,n){const d=new Date(m+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);}
 function draw(){
  if(!wrap)return;
  if(!ready){wrap.innerHTML='<p role="status">Beschikbare dagen ophalen…</p>';slots.innerHTML='';date.value='';time.value='';return;}
  if(chosenDate&&!choices(chosenDate).length){chosenDate='';chosenTime='';}
  const oldScroll=slots.querySelector('.booking-times')?.scrollTop||0;
  const today=R.clock().date,base=today.slice(0,7),max=addMonth(base,12),first=new Date(month+'-01T12:00:00Z'),offset=(first.getUTCDay()+6)%7,last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);const total=last.getUTCDate();
  let cells=Array.from({length:offset},()=>'<span aria-hidden="true"></span>').join('');
  for(let i=1;i<=total;i++){const d=month+'-'+String(i).padStart(2,'0'),available=choices(d).length>0,reason=R.closedReason(d),label=dateLabel(d)+(reason?' · Gesloten: '+reason:available?' · Beschikbaar':' · Niet beschikbaar');cells+=`<button type="button" data-bookdate="${d}" ${available?'':'disabled'} aria-label="${esc(label)}" title="${esc(reason||(!available?'Niet beschikbaar':''))}" aria-pressed="${d===chosenDate}">${i}${reason?'<span class="calendar-closed-dot" aria-hidden="true"></span>':''}</button>`;}
  wrap.innerHTML=`<div class="calendar-header"><button type="button" id="calendarPrev" aria-label="Vorige maand" ${month<=base?'disabled':''}>‹</button><strong aria-live="polite">${esc(new Intl.DateTimeFormat('nl-NL',{month:'long',year:'numeric',timeZone:'UTC'}).format(first))}</strong><button type="button" id="calendarNext" aria-label="Volgende maand" ${month>=max?'disabled':''}>›</button></div><div class="calendar-week" aria-hidden="true">${['Ma','Di','Wo','Do','Vr','Za','Zo'].map(x=>'<span>'+x+'</span>').join('')}</div><div class="calendar-days" role="group" aria-label="Kies een beschikbare dag">${cells}</div><p class="calendar-key">Lichte dagen zijn beschikbaar · Grijs is gesloten</p>`;
  wrap.querySelector('#calendarPrev').onclick=()=>{month=addMonth(month,-1);draw();};wrap.querySelector('#calendarNext').onclick=()=>{month=addMonth(month,1);draw();};
  wrap.querySelectorAll('[data-bookdate]').forEach(b=>b.onclick=()=>{chosenDate=b.dataset.bookdate;chosenTime='';draw();updateCheckout();wrap.querySelector('[data-bookdate="'+chosenDate+'"]')?.focus({preventScroll:true});});
  if(chosenDate&&!choices(chosenDate).length){chosenDate='';chosenTime='';}
  const available=chosenDate?choices(chosenDate):[];if(!available.includes(chosenTime))chosenTime='';date.value=chosenDate;time.value=chosenTime;
  slots.innerHTML=chosenDate?`<p class="booking-date">${esc(dateLabel(chosenDate))}</p><div class="booking-times" role="group" aria-label="Kies een tijdvak">${available.map(t=>`<button type="button" data-booktime="${t}" aria-pressed="${t===chosenTime}">${t}</button>`).join('')}</div>`:'<p>Kies eerst een beschikbare dag in de kalender.</p>';
  if(slots.querySelector('.booking-times'))slots.querySelector('.booking-times').scrollTop=oldScroll;
  slots.querySelectorAll('[data-booktime]').forEach(b=>b.onclick=()=>{chosenTime=b.dataset.booktime;time.value=chosenTime;draw();updateCheckout();slots.querySelector('[data-booktime="'+chosenTime+'"]')?.focus({preventScroll:true});});
  const hint=document.querySelector('#scheduleHint');hint.textContent=chosenTime?'Gekozen: '+dateLabel(chosenDate)+' om '+chosenTime+'.':(()=>{const i=cutoffInfo();return 'Kies een beschikbare dag en tik daarna op een tijdvak. Voor dezelfde dag bestel je tot '+i.base+(i.laterDays?', op '+i.laterDays+' tot '+i.laterTime:'')+'.';})();
 }
 const previousUpdate=updateCheckout;updateCheckout=function(){previousUpdate();if(!ready||!date.value||!time.value)document.querySelector('#submitOrder').disabled=true;};
 updateSchedule=function(reset=false){if(reset){chosenDate=ready?R.nextDate()||'':'';chosenTime='';if(chosenDate)month=chosenDate.slice(0,7);}draw();updateCheckout();};
 const previousSubmit=f.onsubmit;f.onsubmit=async e=>{if(!ready||!date.value||!time.value){e.preventDefault();return toast('Kies een beschikbare dag en tijd in de kalender.');}return previousSubmit(e);};
 function showClosures(){const today=R.clock().date,upcoming=rows.filter(x=>x.day>=today).sort((a,b)=>a.day.localeCompare(b.day)),groups=[];
  for(const row of upcoming){const last=groups[groups.length-1],d=new Date(row.day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);if(last&&last.reason===row.reason&&last.to===d.toISOString().slice(0,10))last.to=row.day;else groups.push({from:row.day,to:row.day,reason:row.reason});}
  banner.hidden=!groups.length;if(!groups.length){banner.innerHTML='';return;}
  const label=d=>new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
  const line=g=>`<li><strong>${esc(label(g.from))}${g.to!==g.from?' t/m '+esc(label(g.to)):''}</strong> · Gesloten: ${esc(g.reason)}</li>`;
  banner.innerHTML='<div><p class="eyebrow">AANGEPASTE OPENINGSTIJDEN</p><h2>Even goed om te weten</h2><ul>'+groups.slice(0,3).map(line).join('')+'</ul>'+(groups.length>3?'<details><summary>Alle sluitingsdagen bekijken</summary><ul>'+groups.slice(3).map(line).join('')+'</ul></details>':'')+'<p>Op de overige dagen gelden onze normale openingstijden. In de bestelkalender zie je alle beschikbare momenten.</p></div>';
 }
 async function refresh(){if(fetching)return;fetching=true;try{const r=await MTF.fetch(SITE_CONFIG.supabaseUrl+'/functions/v1/place-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'schedule'})});const d=await r.json();if(!r.ok||!d.ok||!Array.isArray(d.closures))throw Error('Beschikbaarheid kon niet worden opgehaald.');rows=d.closures;R.setClosures(rows);if(Array.isArray(d.hours)&&R.setHours(d.hours)){rewriteTexts();lateOrder();}const first=!ready;ready=true;if(first){chosenDate=R.nextDate()||'';if(chosenDate)month=chosenDate.slice(0,7);}showClosures();draw();updateCheckout();lateOrder();}catch{ready=false;date.value='';time.value='';if(wrap)wrap.innerHTML='<p role="alert">Beschikbaarheid niet bereikbaar. <button type="button" id="retrySchedule">Opnieuw proberen</button></p>';document.querySelector('#retrySchedule')?.addEventListener('click',refresh);slots.innerHTML='';updateCheckout();}finally{fetching=false;}}

 /* Laat bestellen op vrijdag en zondag tot 19:30: aankondiging en duidelijke teksten op elke pagina. */
 const style=document.createElement('style');
 style.textContent='.late-order{display:flex;align-items:center;justify-content:space-between;gap:20px;max-width:1160px;width:calc(100% - 40px);box-sizing:border-box;margin:20px auto;padding:22px 26px;background:linear-gradient(110deg,var(--mtf-maroon),var(--mtf-red));border:1px solid var(--mtf-bronze);border-radius:16px;color:var(--mtf-cream-warm)}.late-order strong{display:block;font-size:20px;color:var(--mtf-cream-warm)}.late-order p{margin:8px 0 0;font-size:13px;color:var(--mtf-cream-warm)}.late-order .late-badge{display:inline-block;margin-right:10px;padding:3px 9px;border-radius:999px;background:var(--mtf-gold);color:var(--mtf-wine-2);font-size:12px;font-weight:800;letter-spacing:.04em;vertical-align:3px}.late-order a.btn-red{white-space:nowrap;font-weight:800;box-shadow:0 6px 16px rgba(0,0,0,.3);background:var(--mtf-gold)!important;color:var(--mtf-wine-2)!important;border:2px solid #ffe3a3!important}.late-order a.btn-red:hover,.late-order a.btn-red:focus-visible{background:#ffd97f!important}@media(max-width:700px){.late-order{flex-direction:column;align-items:flex-start}}.opening-list .order-until{display:block;font-size:13px;opacity:.8}.opening-list .order-until.is-late{opacity:1;font-weight:700;color:#d8a43a}';
 document.head.append(style);
 const ann=document.createElement('section');ann.className='late-order';ann.setAttribute('aria-label','Laat bestellen op vrijdag en zondag');
 (document.querySelector('.welcome-banner')||document.querySelector('.topbar')).after(ann);
 const onMenu=!!document.querySelector('#menu');
 /* Teksten over besteltijden komen uit de openingstijden (database). Standaard: tot 18:00, op vrijdag en zondag tot 19:30. */
 const dayName=['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
 const joinEn=a=>a.length>1?a.slice(0,-1).join(', ')+' en '+a.at(-1):(a[0]||'');
 function cutoffInfo(){
  const w=R.weekHours(),days=[1,2,3,4,5,6,0].filter(d=>w.hours[d]),count={};
  for(const d of days){const c=w.cutoffs[d];count[c]=(count[c]||0)+1;}
  const base=Number(Object.keys(count).sort((a,b)=>count[b]-count[a]||a-b)[0]??1080),later=days.filter(d=>w.cutoffs[d]>base);
  return {days,w,base:R.formatTime(base),laterDays:joinEn(later.map(d=>dayName[d])),laterTime:later.length?R.formatTime(Math.max(...later.map(d=>w.cutoffs[d]))):'',isLate:d=>w.cutoffs[d]>base};
 }
 function lateOrder(){
  const c=R.clock(),wd=new Date(c.date+'T12:00:00Z').getUTCDay(),info=cutoffInfo(),late=info.isLate(wd),cut=R.cutoff(c.date)*60,left=cut-c.seconds;
  const L=info.laterDays,LT=info.laterTime,B=info.base;
  const openToday=!!R.opening(c.date);
  const cta=`<a class="btn-red" href="${onMenu?'#menu':'/menu.html'}">Bestel nu →</a>`;
  if(openToday&&left>0){
   const h=Math.floor(left/3600),m=Math.floor(left%3600/60);
   const rest=h?`nog ${h} uur${m?' en '+m+' min':''}`:`nog ${Math.max(m,1)} min`;
   const until=R.formatTime(R.cutoff(c.date));
   ann.innerHTML=`<div><strong><span class="late-badge">NIEUW</span>Vandaag nog Thais eten? Bestel tot ${until} uur</strong><p>${late?`Op ${L} bestel je voor dezelfde dag zelfs tot ${LT}`:`Voortaan bestel je voor dezelfde dag tot ${B}${L?`, op ${L} tot ${LT}`:''}`} · ${rest}</p></div>${cta}`;
  }else{
   ann.innerHTML=`<div><strong><span class="late-badge">NIEUW</span>Voortaan bestellen tot ${B} uur voor dezelfde dag</strong><p>${L?`Op ${L} zelfs tot ${LT} uur. `:''}Vooruitbestellen voor een volgende openingsdag kan altijd.</p></div>${cta}`;
  }
 }
 function renderOpeningList(info){
  const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
  document.querySelectorAll('.opening-list').forEach(list=>{
   list.innerHTML=info.days.map(d=>{const [o,cl]=info.w.hours[d],late=info.isLate(d);return `<div><dt>${cap(dayName[d])}</dt><dd>${R.formatTime(o)} – ${R.formatTime(cl)} uur<span class="order-until${late?' is-late':''}">Bestellen voor vandaag tot ${R.formatTime(info.w.cutoffs[d])}</span></dd></div>`;}).join('');
  });
 }
 function rewriteTexts(){
  const oldLine='Bestel uiterlijk om 16:00 voor dezelfde dag',info=cutoffInfo(),L=info.laterDays,LT=info.laterTime,B=info.base;
  document.querySelectorAll('p').forEach(p=>{
   if(p.closest('.late-order'))return;
   if(p.dataset.cutoffText==='long'||p.textContent.startsWith('Bestel uiterlijk om 16:00 uur voor dezelfde dag')){p.dataset.cutoffText='long';p.innerHTML=`Bestellen voor dezelfde dag kan tot <strong>${B} uur</strong>${L?`, op <strong>${L} tot ${LT} uur</strong>`:''}. Kies altijd vooraf een bezorg- of afhaalmoment binnen onze openingstijden. Vooruitbestellen voor een volgende openingsdag kan ook.`;return;}
   if(p.dataset.cutoffText==='short'||(p.textContent.includes(oldLine)&&p.children.length===0)){if(!p.dataset.cutoffText){p.dataset.cutoffText='short';p.dataset.cutoffTemplate=p.textContent;}p.textContent=p.dataset.cutoffTemplate.replace(oldLine,`Bestel voor dezelfde dag tot ${B}${L?` (${L} tot ${LT})`:''}`);}
  });
  renderOpeningList(info);
 }
 rewriteTexts();lateOrder();setInterval(lateOrder,30000);
 /* Oude zinnen 'uiterlijk om 16:00' (bv. uit app.js of beheer) direct bijwerken naar de nieuwe besteltijd. */
 const fixOld=root=>{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(/uiterlijk om 16:00/.test(n.nodeValue))n.nodeValue=n.nodeValue.replace(/uiterlijk om 16:00( uur)?/g,'tot 18:00 (vrijdag en zondag tot 19:30)');}};
 fixOld(document.body);new MutationObserver(ms=>{for(const m of ms){if(m.type==='characterData'){if(/uiterlijk om 16:00/.test(m.target.nodeValue||''))fixOld(m.target.parentNode||document.body);}else m.addedNodes.forEach(x=>{if(x.nodeType===3?/uiterlijk om 16:00/.test(x.nodeValue):x.nodeType===1&&/uiterlijk om 16:00/.test(x.textContent))fixOld(x.nodeType===3?x.parentNode:x);});}}).observe(document.body,{childList:true,subtree:true,characterData:true});

 draw();updateCheckout();refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();

/* Online betalen via Mollie (iDEAL | Wero): extra keuze in de checkout, alleen zichtbaar als Mollie is ingesteld. */
(async()=>{
 const API=SITE_CONFIG.supabaseUrl+'/functions/v1/mollie-pay',LABEL='Online betalen (iDEAL | Wero)';
 const form=document.querySelector('#form'),sel=form?.elements.payment;if(!sel)return;
 let cfg=null;try{cfg=await (await MTF.fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'config'})})).json();}catch{return;}
 const preview=/[?&]mollietest=1/.test(location.search);
 if(!cfg?.enabled||(cfg.test&&!preview))return;
 const current=sel.value;sel.prepend(new Option(LABEL+(cfg.test?' · testmodus':''),LABEL));sel.value=current;
 const hint=document.createElement('p');hint.className='checkout-hint';hint.hidden=true;hint.textContent='Na het plaatsen ga je direct door naar je bankapp om veilig te betalen met iDEAL | Wero.';sel.closest('label').after(hint);
 sel.addEventListener('change',()=>{hint.hidden=sel.value!==LABEL;});
 /* Na een geplaatste bestelling met online betalen: betaling aanmaken en doorsturen naar de bank. */
 MTF.onOrderPlaced(async({order,payment})=>{
  if(payment!==LABEL||!order?.id)return;
  const loc=window.MTFLocation?.slug||SITE_CONFIG.defaultLocation;
  const c=await (await MTF.fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',order_id:order.id,origin:location.origin})})).json().catch(()=>({}));
  if(c.ok&&(c.checkout||c.paid)){try{localStorage.removeItem(SITE_CONFIG.cartKey(loc));}catch{}location.href=c.checkout||('/betaald?order='+order.id+'&location='+loc);return 'redirect';}
  setTimeout(()=>{try{toast('Online betalen lukte niet. Je bestelling is wel ontvangen; je kunt bij ontvangst betalen.');}catch{}},300);
 });
})();
