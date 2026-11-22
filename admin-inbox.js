/* Inbox in het beheer: mails van info@momsthaifood.nl lezen, beantwoorden en losse mails aan klanten sturen.
   Zelfde opzet als de inbox van Mijn Flowsmid. Praat met de serverfunctie mtf-inbox; alleen voor eigenaars. */
(()=>{
 const API=SITE_CONFIG.supabaseUrl+'/functions/v1/mtf-inbox';
 const staat={map:'inbox',berichten:[],data:null,open:null,adres:'info@momsthaifood.nl',bezig:false};
 viewNames.inboxPanel='Inbox';

 const style=document.createElement('style');
 style.textContent=`
 #inboxPanel .inbox-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0}
 #inboxPanel .inbox-list{display:grid;gap:8px}
 #inboxPanel .inbox-row{display:flex;justify-content:space-between;align-items:center;gap:14px;width:100%;text-align:left;padding:14px 18px;border-radius:14px;border:1px solid var(--fs-lijn,#d3a85355);background:var(--fs-vlak,#161b2d);color:var(--fs-tekst,#f6f2ec);cursor:pointer;font:inherit}
 #inboxPanel .inbox-row:hover{background:var(--fs-vlak-2,#1d2340);border-color:var(--fs-lijn-sterk,#d3a85388)}
 #inboxPanel .inbox-row>div:first-child{min-width:0;flex:1}
 #inboxPanel .inbox-row strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;font-size:15px}
 #inboxPanel .inbox-row.nieuw strong{font-weight:800}
 #inboxPanel .inbox-row small{display:flex;gap:6px 14px;flex-wrap:wrap;margin-top:4px;font-size:13px;color:var(--fs-zacht,#b2bbd0)}
 #inboxPanel .inbox-tag{flex:none;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;background:rgba(196,181,253,.16);color:var(--fs-lavendel,#ffcf74)}
 #inboxPanel .inbox-msg{padding:22px 24px;border-radius:16px;border:1px solid var(--fs-lijn,#d3a85355);background:var(--fs-vlak,#161b2d)}
 #inboxPanel .inbox-msg h2{margin:0 0 6px;font-size:20px;overflow-wrap:anywhere}
 #inboxPanel .inbox-meta{display:flex;gap:4px 16px;flex-wrap:wrap;font-size:13px;color:var(--fs-zacht,#b2bbd0);margin-bottom:14px;overflow-wrap:anywhere}
 #inboxPanel .inbox-meta b{color:var(--fs-tekst,#f6f2ec)}
 #inboxPanel .inbox-text{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid var(--fs-lijn,#d3a85355);padding-top:14px;font-size:15px;line-height:1.6;color:var(--fs-tekst,#f6f2ec)}
 #inboxPanel .inbox-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
 #inboxPanel .inbox-back{background:none;border:0;padding:0;margin:0 0 12px;color:var(--fs-lavendel,#ffcf74);font:inherit;font-weight:700;cursor:pointer}
 #inboxPanel .inbox-setup{padding:22px 24px;border-radius:16px;border:1px dashed var(--fs-lijn-sterk,#d3a85388);color:var(--fs-zacht,#b2bbd0);line-height:1.6}
 #inboxPanel .inbox-setup strong{display:block;color:var(--fs-tekst,#f6f2ec);font-size:16px;margin-bottom:4px}
 #inboxPanel .inbox-setup code{background:rgba(196,181,253,.14);padding:1px 6px;border-radius:6px;color:var(--fs-tekst,#f6f2ec)}
 #inboxDialog{width:min(640px,calc(100vw - 24px))}
 #inboxDialog label{display:block;margin:12px 0 0}
 #inboxDialog input,#inboxDialog textarea{width:100%;margin-top:6px}
 #inboxDialog textarea{min-height:240px;resize:vertical;font:inherit;line-height:1.5}
 #inboxDialog .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;border:0!important;background:none!important}
 #inboxError{color:var(--fs-rood,#F87171);min-height:1em;margin:10px 0 0}
 .order-footer .inbox-mail-klant{margin-left:auto}
 @media(max-width:580px){#inboxPanel .inbox-msg{padding:16px}#inboxPanel .inbox-row{padding:12px 14px}}`;
 document.head.append(style);

 /* Menuknop (onder Bestellingen) en het onderdeel zelf */
 const nav=document.createElement('button');nav.type='button';nav.dataset.tab='inboxPanel';nav.hidden=true;
 nav.innerHTML='Inbox <span id="navInboxCount" class="nav-count" hidden></span>';
 (document.querySelector('[data-tab="ordersPanel"]')||document.querySelector('[data-tab="overviewPanel"]'))?.after(nav);
 const sec=document.createElement('section');sec.id='inboxPanel';sec.hidden=true;
 sec.innerHTML=`<div class="admin-title"><div><h1>Inbox</h1><p class="hint" id="inboxSub">Mails van klanten lezen en beantwoorden.</p></div><div class="toolbar-actions"><button class="secondary-button" type="button" id="inboxRefresh">↻ Vernieuwen</button><button class="btn-red" type="button" id="inboxNew">＋ Nieuwe mail</button></div></div>
 <div id="inboxListView"><div class="inbox-bar"><div class="segmented" id="inboxMaps" role="group" aria-label="Map"><button type="button" data-map="inbox" class="active">Inbox</button><button type="button" data-map="verzonden">Verzonden</button></div><p class="hint" id="inboxCount" role="status"></p></div><div id="inboxList"></div><div id="inboxMore" style="margin-top:14px" hidden><button class="secondary-button" type="button" id="inboxMoreBtn">Oudere mails laden</button></div></div>
 <div id="inboxMsgView" hidden><button type="button" class="inbox-back" id="inboxBack">← Terug</button><div class="inbox-msg" id="inboxMsg"></div></div>`;
 document.querySelector('#dashboard').append(sec);
 const dialog=document.createElement('dialog');dialog.id='inboxDialog';dialog.className='edit-modal';dialog.setAttribute('aria-labelledby','inboxDialogTitle');
 dialog.innerHTML=`<h2 id="inboxDialogTitle">Nieuwe mail</h2><p class="hint" id="inboxDialogSub"></p><form id="inboxForm" novalidate><label>Aan<input name="aan" type="email" maxlength="200" autocapitalize="none" spellcheck="false" required></label><label>Onderwerp<input name="onderwerp" maxlength="250" required></label><label>Bericht<textarea name="tekst" maxlength="50000" required></textarea></label><p id="inboxError" role="alert"></p><div class="actions"><button type="button" class="secondary-button" id="inboxCancel">Annuleren</button><button type="submit" class="btn-red" id="inboxSend">Versturen</button></div></form>`;
 document.body.append(dialog);

 const q=s=>sec.querySelector(s);
 const magInbox=()=>!!(currentActor?.owner&&!currentActor.legacy);
 const wie=a=>a?(a.naam||a.adres):'(onbekend)';
 const moment=d=>{const x=d?new Date(d):null;return x&&!isNaN(x)?x.toLocaleString('nl-NL',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';};

 async function roep(body,ruw=false){
  try{
   const access=typeof freshAccess==='function'?await freshAccess():null;
   if(!access)return {fout:'Log in met je persoonlijke account om de inbox te gebruiken.'};
   const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(body)});
   if(ruw&&r.ok)return {blob:await r.blob()};
   const x=await r.json().catch(()=>({}));
   if(!r.ok&&!x.fout)x.fout=r.status===404?'De inbox is nog niet geactiveerd op de server.':'Verzoek mislukt ('+r.status+')';
   return x;
  }catch{return {fout:'Geen verbinding met de server. Probeer het zo opnieuw.'};}
 }

 function teller(n){const el=document.getElementById('navInboxCount');el.textContent=n;el.hidden=!n;}
 async function ongelezen(){if(!magInbox())return;const r=await roep({actie:'ongelezen'});if(!r.fout&&r.ok)teller(Number(r.ongelezen)||0);}

 function toonLijst(){q('#inboxMsgView').hidden=true;q('#inboxListView').hidden=false;staat.open=null;}
 function tekenLijst(){
  const d=staat.data||{},lijst=q('#inboxList');q('#inboxMore').hidden=true;q('#inboxCount').textContent='';
  if(d.ok===false&&d.ingesteld===false){lijst.innerHTML=`<div class="inbox-setup"><strong>De mailbox is nog niet gekoppeld</strong>Zet het wachtwoord van ${esc(staat.adres)} in Supabase onder Edge Functions, Secrets, met de naam <code>MTF_MAIL_WACHTWOORD</code>. Daarna verschijnen je mails hier. Een nieuwe mail versturen kan nu al met de knop Nieuwe mail.</div>`;return;}
  if(d.fout){lijst.innerHTML=emptyState('De inbox kon niet worden geladen',d.fout);return;}
  const b=staat.berichten;
  if(!b.length){lijst.innerHTML=emptyState(staat.map==='inbox'?'Geen mails':'Nog niets verzonden',staat.map==='inbox'?'Nieuwe mails van klanten verschijnen hier.':'Mails die je hier verstuurt komen in deze map.');return;}
  lijst.innerHTML='<div class="inbox-list">'+b.map(m=>{const naam=staat.map==='inbox'?wie(m.van):'Aan: '+(m.aan||[]).map(wie).join(', ');
   return `<button type="button" class="inbox-row${m.gelezen?'':' nieuw'}" data-uid="${esc(m.uid)}"><div><strong>${esc(m.onderwerp||'(geen onderwerp)')}</strong><small><span>${esc(naam)}</span><span>${esc(moment(m.datum))}</span>${m.beantwoord?'<span>Beantwoord</span>':''}</small></div>${m.gelezen?'':'<span class="inbox-tag">Nieuw</span>'}</button>`;}).join('')+'</div>';
  lijst.querySelectorAll('[data-uid]').forEach(k=>k.onclick=()=>openBericht(Number(k.dataset.uid)));
  const n=b.filter(m=>!m.gelezen).length;
  q('#inboxCount').textContent=staat.map==='inbox'?(n?`${n} ongelezen in de laatste ${b.length} mails`:`${b.length} ${b.length===1?'mail':'mails'}`):`${b.length} verzonden`;
  q('#inboxMore').hidden=!d.meer;
 }
 async function laad(meer=false){
  if(staat.bezig)return;staat.bezig=true;q('#inboxRefresh').disabled=true;
  if(!meer)q('#inboxList').innerHTML='<p class="hint">Mails ophalen…</p>';
  const map=staat.map,r=await roep({actie:'lijst',map,voor:meer&&staat.berichten.length?staat.berichten[staat.berichten.length-1].uid:undefined});
  staat.bezig=false;q('#inboxRefresh').disabled=false;
  if(map!==staat.map)return laad();
  if(!r.fout&&r.ok!==false){staat.berichten=meer?staat.berichten.concat(r.berichten||[]):(r.berichten||[]);if(r.adres){staat.adres=r.adres;q('#inboxSub').textContent='Mails van '+r.adres+' lezen en beantwoorden.';}}
  if(meer&&r.fout){toast(r.fout);return;}
  staat.data=r;tekenLijst();
  if(map==='inbox'&&!r.fout&&r.ok!==false)ongelezen();
 }

 async function openBericht(uid){
  const map=staat.map,doel=q('#inboxMsg');q('#inboxListView').hidden=true;q('#inboxMsgView').hidden=false;
  q('#inboxBack').textContent='← Terug naar '+(map==='inbox'?'inbox':'verzonden');doel.innerHTML='<p class="hint">Mail openen…</p>';scrollTo({top:0});
  const m=await roep({actie:'lees',uid,map});
  if(q('#inboxMsgView').hidden)return;
  if(m.fout||m.ok===false){doel.innerHTML=emptyState('Openen lukte niet',m.fout||'Probeer het opnieuw.');return;}
  staat.open=m;const inLijst=staat.berichten.find(x=>x.uid===uid),wasNieuw=inLijst&&!inLijst.gelezen;if(inLijst)inLijst.gelezen=true;
  if(wasNieuw&&map==='inbox'){const el=document.getElementById('navInboxCount');teller(Math.max(0,(Number(el.textContent)||0)-1));}
  doel.innerHTML=`<h2>${esc(m.onderwerp||'(geen onderwerp)')}</h2><div class="inbox-meta"><span><b>${esc(wie(m.van))}</b>${m.van?.naam?' &lt;'+esc(m.van.adres)+'&gt;':''}</span><span>aan ${esc((m.aan||[]).map(a=>a.adres).join(', '))}</span>${(m.cc||[]).length?`<span>cc ${esc(m.cc.map(a=>a.adres).join(', '))}</span>`:''}<span>${esc(moment(m.datum))}</span></div>${m.wasHtml?'<p class="hint" style="margin:0 0 10px">Opgemaakte mail, hier getoond als tekst.</p>':''}<div class="inbox-text">${esc(m.tekst||'(geen tekst)')}</div>${(m.bijlagen||[]).length?`<div class="inbox-actions">${m.bijlagen.map(b=>`<button type="button" class="secondary-button" data-bijlage="${esc(b.nr)}">📎 ${esc(b.naam)} (${Math.max(1,Math.round(b.grootte/1024))} kB)</button>`).join('')}</div>`:''}${map==='inbox'?'<div class="inbox-actions"><button type="button" class="btn-red" id="inboxReply">Beantwoorden</button><button type="button" class="secondary-button" id="inboxUnread">Markeer als ongelezen</button></div>':''}`;
  doel.querySelectorAll('[data-bijlage]').forEach(k=>k.onclick=async()=>{const b=m.bijlagen.find(x=>String(x.nr)===k.dataset.bijlage);k.disabled=true;const r=await roep({actie:'bijlage',uid,nr:b.nr,map},true);k.disabled=false;if(!r.blob)return toast(r.fout||'Downloaden lukte niet');const url=URL.createObjectURL(r.blob),a=document.createElement('a');a.href=url;a.download=b.naam;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);});
  const reply=doel.querySelector('#inboxReply');if(reply)reply.onclick=()=>opstellen({orig:m});
  const unread=doel.querySelector('#inboxUnread');if(unread)unread.onclick=async()=>{unread.disabled=true;const r=await roep({actie:'markeer',uid,gelezen:false,map});if(r.fout){unread.disabled=false;return toast(r.fout);}if(inLijst)inLijst.gelezen=false;toast('Gemarkeerd als ongelezen');toonLijst();tekenLijst();ongelezen();};
 }

 /* Nieuwe mail of antwoord. o = {orig} bij beantwoorden, of {aan,onderwerp,tekst} om velden vooraf in te vullen. */
 let sleutel='';
 function opstellen(o={}){
  const f=dialog.querySelector('#inboxForm'),orig=o.orig||null;sleutel=crypto.randomUUID();
  dialog.querySelector('#inboxDialogTitle').textContent=orig?'Beantwoorden':'Nieuwe mail';
  dialog.querySelector('#inboxDialogSub').textContent='Verstuurd namens Mom’s Thai Food. Antwoorden komen binnen op '+staat.adres+' en verschijnen in deze inbox.';
  f.aan.value=orig?((orig.antwoordAan||orig.van||{}).adres||''):(o.aan||'');
  f.onderwerp.value=orig?(/^(re|antw):/i.test(orig.onderwerp||'')?orig.onderwerp:'Re: '+(orig.onderwerp||'')):(o.onderwerp||'');
  f.tekst.value=orig?'\n\n\nOp '+moment(orig.datum)+' schreef '+wie(orig.van)+':\n'+String(orig.tekst||'').split('\n').slice(0,200).map(r=>'> '+r).join('\n'):(o.tekst||'');
  dialog.querySelector('#inboxError').textContent='';dialog.querySelector('#inboxSend').disabled=false;
  f.onsubmit=async e=>{e.preventDefault();const fout=dialog.querySelector('#inboxError'),knop=dialog.querySelector('#inboxSend'),aan=f.aan.value.trim(),onderwerp=f.onderwerp.value.trim(),tekst=f.tekst.value;
   if(!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(aan)){fout.textContent='Vul een geldig e-mailadres in.';return;}
   if(!onderwerp){fout.textContent='Vul een onderwerp in.';return;}
   if(!tekst.trim()){fout.textContent='Schrijf een bericht.';return;}
   knop.disabled=true;knop.textContent='Versturen…';fout.textContent='';
   const r=await roep({actie:'versturen',aan,onderwerp,tekst,sleutel,uid:orig?orig.uid:undefined,in_reply_to:orig?orig.messageId:undefined,references:orig?orig.references:undefined});
   knop.disabled=false;knop.textContent='Versturen';
   if(r.fout||!r.ok){fout.textContent=r.fout||'Versturen lukte niet.';return;}
   dialog.close();toast('Mail verstuurd naar '+aan);
   if(orig){const x=staat.berichten.find(b=>b.uid===orig.uid);if(x)x.beantwoord=true;}
   if(!sec.hidden&&staat.map==='verzonden'&&!q('#inboxListView').hidden)laad();
  };
  dialog.showModal();
  setTimeout(()=>{const t=f.tekst;if(orig||f.aan.value){t.focus();t.setSelectionRange(0,0);t.scrollTop=0;}else f.aan.focus();},40);
 }
 dialog.querySelector('#inboxCancel').onclick=()=>dialog.close();

 q('#inboxMaps').querySelectorAll('[data-map]').forEach(k=>k.onclick=()=>{staat.map=k.dataset.map;staat.berichten=[];staat.data=null;q('#inboxMaps').querySelectorAll('[data-map]').forEach(x=>x.classList.toggle('active',x===k));laad();});
 q('#inboxRefresh').onclick=()=>{toonLijst();laad();};
 q('#inboxNew').onclick=()=>opstellen();
 q('#inboxMoreBtn').onclick=async e=>{e.target.disabled=true;await laad(true);e.target.disabled=false;};
 q('#inboxBack').onclick=()=>{toonLijst();tekenLijst();};
 nav.addEventListener('click',()=>{panel('inboxPanel');toonLijst();laad();});

 /* Knop "Mail klant" bij elke bestelling: opent een nieuwe mail aan die klant. */
 const basisRender=render;render=function(){
  basisRender();if(!magInbox())return;
  document.querySelectorAll('#orders .order-card').forEach(card=>{
   const id=card.querySelector('[data-save]')?.dataset.save,o=orders.find(x=>String(x.id)===String(id)),voet=card.querySelector('.order-footer');
   if(!o?.customer_email||!voet||voet.querySelector('.inbox-mail-klant'))return;
   const k=document.createElement('button');k.type='button';k.className='secondary-button inbox-mail-klant';k.textContent='✉ Mail klant';
   k.onclick=()=>opstellen({aan:o.customer_email,onderwerp:'Je bestelling '+formatNo(o.order_number)+' bij Mom’s Thai Food',tekst:'Hoi '+String(o.customer_name||'').trim().split(/\s+/)[0]+',\n\n\n\nMet vriendelijke groet,\nMom’s Thai Food'});
   voet.append(k);
  });
 };

 const basisRechten=applyRights;applyRights=function(){basisRechten();nav.hidden=!magInbox();if(magInbox())ongelezen();else teller(0);};
 if(currentActor)applyRights();
 setInterval(()=>{if(!document.hidden&&magInbox())ongelezen();},300000);
})();
