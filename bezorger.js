/* Bezorgportaal van Mom's Thai Food (/bezorger).
   Bezorgers zien hier de bestellingen die in het beheer aan hen zijn toegewezen, navigeren met Google Maps,
   bellen de klant en melden "gestart" en "afgeleverd". Zolang er een bestelling onderweg is en deze pagina open staat,
   wordt de locatie van de telefoon gedeeld met het restaurant en met de klant van die bestelling.
   Praat met de serverfunctie mtf-bezorging. Inloggen gaat met hetzelfde persoonlijke account als het beheer. */
(()=>{
 const K=window.MTFKaart,esc=K.esc,$=s=>document.querySelector(s);
 const API=SITE_CONFIG.supabaseUrl+'/functions/v1/mtf-bezorging';
 const euro=n=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(Number(n)||0);
 const param=new URLSearchParams(location.search);
 /* Voorbeeldweergave zonder server; kan alleen buiten de echte website (previews en lokaal). */
 const demo=SITE_CONFIG.environment==='test'&&param.has('demo');
 const OPSLAG='mtf_bezorger_sessie';
 let sessie=null,verversBezig=null,ritten=[],bezorgdVandaag=0,vestiging=param.get('location')||'',timer=null;
 let kaart=null,laag=null,ikMarker=null,mijnPlek=null,volgId=null,laatstVerstuurd=0,wakker=null,locatieFout='';

 const toast=t=>{const el=$('#toast');el.textContent=t;el.classList.add('toon');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('toon'),2800);};

 /* ---------- Inloggen (Supabase Auth, net als het beheer) ---------- */
 async function auth(pad,body){
  const r=await fetch(SITE_CONFIG.supabaseUrl+'/auth/v1/'+pad,{method:'POST',headers:{apikey:SITE_CONFIG.publishableKey,'Content-Type':'application/json',...(sessie?{Authorization:'Bearer '+sessie.access_token}:{})},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(/invalid login/i.test(d.msg||d.error_description||'')?'E-mailadres of wachtwoord klopt niet.':(d.msg||d.error_description||d.message||'Inloggen mislukt'));
  return d;
 }
 function bewaar(s){sessie=s;try{if(s)localStorage.setItem(OPSLAG,JSON.stringify(s));else localStorage.removeItem(OPSLAG);}catch{}}
 async function toegang(){
  if(!sessie)return null;
  if(sessie.expires_at*1000<Date.now()+60000){
   if(!verversBezig)verversBezig=auth('token?grant_type=refresh_token',{refresh_token:sessie.refresh_token}).then(bewaar).finally(()=>verversBezig=null);
   await verversBezig;
  }
  return sessie.access_token;
 }
 async function roep(actie,extra={}){
  if(demo)return demoServer(actie,extra);
  const t=await toegang();if(!t)throw Error('Log opnieuw in.');
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:SITE_CONFIG.publishableKey,Authorization:'Bearer '+t},body:JSON.stringify({actie,...(vestiging?{location:vestiging}:{}),...extra})});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){uitloggen(false);throw Error(d.fout||'Log opnieuw in.');}
  if(!r.ok||d.fout)throw Error(d.fout||'Er ging iets mis. Probeer het opnieuw.');
  return d;
 }
 function uitloggen(metMelding=true){
  if(sessie&&metMelding)auth('logout',{}).catch(()=>{});
  bewaar(null);stopDelen();clearInterval(timer);ritten=[];
  $('#portaal').hidden=true;$('#inlog').hidden=false;$('#uitloggen').hidden=true;$('#wie').textContent='Mom’s Thai Food';
 }
 $('#uitloggen').onclick=()=>{if(ritten.some(r=>r.status==='Onderweg')&&!confirm('Je hebt nog een bestelling onderweg. Na uitloggen wordt je locatie niet meer gedeeld. Toch uitloggen?'))return;uitloggen();};
 $('#inlogForm').onsubmit=async e=>{
  e.preventDefault();const knop=e.submitter;knop.disabled=true;$('#inlogFout').textContent='';
  try{bewaar(await auth('token?grant_type=password',{email:$('#email').value.trim(),password:$('#wachtwoord').value}));$('#wachtwoord').value='';await begin();}
  catch(err){bewaar(null);$('#inlogFout').textContent=err.message;}
  finally{knop.disabled=false;}
 };

 async function begin(){
  const ik=await roep('ik');
  if(!ik.bezorger){bewaar(null);throw Error('Dit account is geen bezorger. Vraag de eigenaar om je als bezorger aan te merken.');}
  vestiging=ik.vestiging||vestiging;
  $('#wie').textContent=(ik.naam||'Bezorger')+(ik.vestiging==='oud-beijerland'?' · Oud-Beijerland':'');
  $('#inlog').hidden=true;$('#portaal').hidden=false;$('#uitloggen').hidden=false;
  await laad();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)laad(true);},20000);
 }

 /* ---------- Bestellingen ---------- */
 async function laad(stil=false){
  try{const d=await roep('mijn_bestellingen');ritten=d.bestellingen||[];bezorgdVandaag=d.bezorgd_vandaag||0;teken();regelDelen();if(!$('#tabKaart').hidden)tekenKaart();}
  catch(e){if(!stil)toast(e.message);}
 }
 const tijd=o=>String(o.requested_time||'').slice(0,5);
 function teken(){
  const open=ritten.filter(r=>r.status!=='Onderweg');
  $('#aantal').textContent=ritten.length?'('+ritten.length+')':'';
  $('#startAlles').hidden=open.length<2;$('#startAlles').textContent='▶ Start alle '+open.length+' bezorgingen';
  $('#voet').textContent=bezorgdVandaag?'Vandaag afgeleverd: '+bezorgdVandaag:'';
  if(!ritten.length){$('#ritten').innerHTML='<div class="kaart-vlak leeg"><strong>Geen bestellingen voor jou</strong><p class="zacht">Zodra het restaurant een bezorging aan jou toewijst, verschijnt die hier vanzelf.</p></div>';return;}
  $('#ritten').innerHTML=ritten.map((o,i)=>{
   const onderweg=o.status==='Onderweg',betaald=o.payment_status==='Betaald',items=Array.isArray(o.items)?o.items:[];
   return `<article class="kaart-vlak rit" data-id="${esc(o.id)}">
    <div class="rit-kop"><div><h3>${i+1}. ${esc(o.customer_name)}</h3><span class="tijd">${esc(o.nummer)} · gewenst ${esc(tijd(o))}</span></div><span class="pil ${onderweg?'onderweg':''}">${esc(o.status)}</span></div>
    <p class="adres">${esc(o.address)}<br>${esc(o.city||'')}</p>
    <div class="betaal ${betaald?'ok':'open'}">${betaald?'✓ Al betaald ('+esc(o.payment)+')':'Nog te betalen: '+euro(o.total)+' · '+esc(o.payment)}</div>
    ${o.notes?`<div class="notitie"><strong>Opmerking klant:</strong> ${esc(o.notes)}</div>`:''}
    <div class="duo"><a class="knop licht" href="${esc(K.navigatie(o))}" target="_blank" rel="noopener">📍 Navigeer</a><a class="knop licht" href="tel:${esc(String(o.phone||'').replace(/[^\d+]/g,''))}">📞 Bel klant</a></div>
    <details><summary>Bestelling bekijken (${items.reduce((t,x)=>t+(Number(x.qty)||0),0)} stuks) · ${esc(o.phone)}</summary><ul>${items.map(x=>`<li><span>${esc(x.qty)}× ${esc(x.name)}</span><span>${euro(Number(x.qty)*Number(x.price))}</span></li>`).join('')}<li><span>Bezorgkosten</span><span>${Number(o.delivery_fee||0)>0?euro(o.delivery_fee):'Gratis'}</span></li><li><strong>Totaal</strong><strong>${euro(o.total)}</strong></li></ul></details>
    ${onderweg?`<button type="button" class="knop groen" data-klaar="${esc(o.id)}">✓ Afgeleverd</button>`:`<button type="button" class="knop" data-start="${esc(o.id)}">▶ Start bezorging</button>`}
   </article>`;}).join('');
  document.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>start(b,b.dataset.start));
  document.querySelectorAll('[data-klaar]').forEach(b=>b.onclick=async()=>{
   const o=ritten.find(r=>r.id===b.dataset.klaar);if(!o)return;
   if(!confirm('Bestelling van '+o.customer_name+' afgeleverd?'+(o.payment_status==='Betaald'?'':'\n\nLet op: nog te betalen '+euro(o.total)+' ('+o.payment+').')))return;
   b.disabled=true;try{await roep('afgeleverd',{id:o.id});toast('Afgeleverd bij '+o.customer_name);await laad();}catch(e){toast(e.message);b.disabled=false;}
  });
 }
 async function start(knop,id){
  knop.disabled=true;
  try{
   await vraagLocatie();
   const d=await roep('start',id?{id}:{});
   toast(d.gestart>1?d.gestart+' bezorgingen gestart':'Bezorging gestart. De klant kan je nu volgen.');
   await laad();
  }catch(e){toast(e.message);knop.disabled=false;}
 }
 $('#startAlles').onclick=e=>start(e.currentTarget);

 /* ---------- Locatie delen ---------- */
 /* Vraagt één keer toestemming, zodat de melding van de telefoon komt op het moment dat de bezorger op Start drukt. */
 function vraagLocatie(){
  return new Promise(klaar=>{
   if(!navigator.geolocation){locatieFout='Deze telefoon of browser kan geen locatie delen.';return klaar();}
   navigator.geolocation.getCurrentPosition(p=>{locatieFout='';plek(p);klaar();},f=>{locatieFout=foutTekst(f);klaar();},{enableHighAccuracy:true,timeout:8000,maximumAge:15000});
  });
 }
 const foutTekst=f=>f.code===1?'Locatie delen staat uit. Geef deze pagina toestemming voor je locatie in de instellingen van je browser.':'Je locatie is nu niet te bepalen. Controleer of gps aan staat.';
 function plek(p){
  mijnPlek={lat:p.coords.latitude,lng:p.coords.longitude,nauwkeurigheid:p.coords.accuracy};
  if(ikMarker)ikMarker.setLatLng([mijnPlek.lat,mijnPlek.lng]);else if(kaart)ikMarker=L.marker([mijnPlek.lat,mijnPlek.lng],{icon:K.stip(),zIndexOffset:1000}).bindTooltip('Jij').addTo(kaart);
  if(Date.now()-laatstVerstuurd>8000&&ritten.some(r=>r.status==='Onderweg')){laatstVerstuurd=Date.now();roep('positie',mijnPlek).catch(()=>{});}
 }
 async function regelDelen(){
  const nodig=ritten.some(r=>r.status==='Onderweg'),el=$('#deelStatus');
  if(!nodig){stopDelen();el.hidden=true;return;}
  if(volgId===null&&navigator.geolocation)volgId=navigator.geolocation.watchPosition(p=>{locatieFout='';plek(p);toonDelen();},f=>{locatieFout=foutTekst(f);toonDelen();},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
  if(!navigator.geolocation)locatieFout='Deze telefoon of browser kan geen locatie delen.';
  /* Scherm aan houden: een telefoonbrowser stopt met locatie delen zodra het scherm uit gaat. */
  try{if(!wakker&&navigator.wakeLock&&!document.hidden){wakker=await navigator.wakeLock.request('screen');wakker.addEventListener('release',()=>{wakker=null;});}}catch{}
  toonDelen();
 }
 function toonDelen(){
  const el=$('#deelStatus');el.hidden=false;el.className='melding '+(locatieFout?'uit':'aan');
  el.querySelector('span').textContent=locatieFout||'Je locatie wordt gedeeld met het restaurant en de klant. Laat deze pagina open en het scherm aan tot je klaar bent.';
 }
 function stopDelen(){
  if(volgId!==null){navigator.geolocation.clearWatch(volgId);volgId=null;}
  try{wakker?.release();}catch{}wakker=null;
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&sessie){laad(true);}});

 /* ---------- Kaart ---------- */
 document.querySelectorAll('.tabs [data-tab]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tabs [data-tab]').forEach(x=>x.classList.toggle('actief',x===b));
  $('#tabLijst').hidden=b.dataset.tab!=='lijst';$('#tabKaart').hidden=b.dataset.tab!=='kaart';
  if(b.dataset.tab==='kaart'){if(!kaart){kaart=K.maak('kaart');if(kaart){laag=L.layerGroup().addTo(kaart);if(mijnPlek)ikMarker=L.marker([mijnPlek.lat,mijnPlek.lng],{icon:K.stip(),zIndexOffset:1000}).bindTooltip('Jij').addTo(kaart);}}setTimeout(()=>kaart?.invalidateSize(),80);tekenKaart(true);if(!mijnPlek)vraagLocatie();}
 });
 let kaartBezig=false,kaartSleutel='';
 async function tekenKaart(pasIn=false){
  if(!kaart){$('#kaartInfo').textContent='De kaart kon niet laden. Controleer je internetverbinding.';return;}
  const sleutel=ritten.map(r=>r.id+r.status).join('|');
  if(kaartBezig||(sleutel===kaartSleutel&&!pasIn))return;
  kaartBezig=true;kaartSleutel=sleutel;
  try{
   laag.clearLayers();const punten=[],mis=[];
   $('#kaartInfo').textContent=ritten.length?'Adressen worden opgezocht…':'Geen bestellingen om te tonen.';
   for(const [i,o] of ritten.entries()){
    const p=await K.zoek(K.volAdres(o));if(!p){mis.push(o.nummer);continue;}
    L.marker([p.lat,p.lon],{icon:K.pin(i+1)}).bindPopup(`<strong>${i+1}. ${esc(o.customer_name)}</strong><br>${esc(o.address)}, ${esc(o.city||'')}<br><a href="${esc(K.navigatie(o))}" target="_blank" rel="noopener">Navigeer</a> · <a href="tel:${esc(String(o.phone||'').replace(/[^\d+]/g,''))}">Bel</a>`).addTo(laag);
    punten.push([p.lat,p.lon]);
   }
   if(mijnPlek)punten.push([mijnPlek.lat,mijnPlek.lng]);
   if(punten.length)kaart.fitBounds(punten,{maxZoom:16,padding:[40,40]});
   if(ritten.length)$('#kaartInfo').textContent='De nummers komen overeen met je lijst.'+(mis.length?' Niet gevonden op de kaart: '+mis.join(', ')+'.':'');
  }finally{kaartBezig=false;}
 }

 /* ---------- Voorbeeldgegevens (alleen in de voorbeeldweergave) ---------- */
 const demoData=[
  {id:'d1',nummer:'MTF00284041',status:'Onderweg',customer_name:'Sanne de Vries',phone:'06 12345678',address:'Voorbeeldstraat 12',city:'3201 AB Spijkenisse',requested_time:'18:15:00',payment:'Contant',payment_status:'Open',total:42.5,delivery_fee:0,notes:'Graag aanbellen bij de zijdeur.',items:[{qty:2,name:'Pad Thai kip',price:14.5},{qty:1,name:'Tom Kha Gai',price:7.5},{qty:1,name:'Saté Gai',price:6}]},
  {id:'d2',nummer:'MTF00284042',status:'Klaar',customer_name:'Mark Jansen',phone:'0181 123456',address:'Marktplein 3',city:'3201 CD Spijkenisse',requested_time:'18:30:00',payment:'Online betaald',payment_status:'Betaald',total:31,delivery_fee:2.5,notes:'',items:[{qty:1,name:'Groene curry',price:15},{qty:1,name:'Kip cashewnoten',price:13.5}]},
  {id:'d3',nummer:'MTF00284043',status:'In bereiding',customer_name:'Fatima El Amrani',phone:'06 87654321',address:'Lange Dijk 45',city:'3209 EF Hekelingen',requested_time:'18:45:00',payment:'Betaalverzoek / Tikkie',payment_status:'Betaald',total:55.75,delivery_fee:0,notes:'',items:[{qty:3,name:'Pad Krapow',price:14.75},{qty:2,name:'Popia Tod',price:5.75}]}];
 function demoServer(actie,x){
  if(actie==='ik')return {ok:true,naam:'Daan (voorbeeld)',bezorger:true,vestiging:'spijkenisse'};
  if(actie==='mijn_bestellingen')return {ok:true,bestellingen:demoData.filter(o=>o.status!=='Bezorgd'),bezorgd_vandaag:4+demoData.filter(o=>o.status==='Bezorgd').length};
  if(actie==='start'){const r=demoData.filter(o=>!['Onderweg','Bezorgd'].includes(o.status)&&(!x.id||o.id===x.id));r.forEach(o=>o.status='Onderweg');return {ok:true,gestart:r.length};}
  if(actie==='afgeleverd'){demoData.find(o=>o.id===x.id).status='Bezorgd';return {ok:true};}
  return {ok:true};
 }

 /* ---------- Start ---------- */
 (async()=>{
  if(demo){sessie={access_token:'demo',expires_at:9e9};await begin();return;}
  try{sessie=JSON.parse(localStorage.getItem(OPSLAG)||'null');}catch{}
  /* Net geactiveerd of ingelogd via het beheer in hetzelfde tabblad: neem die sessie over. */
  if(!sessie){try{const s=JSON.parse(sessionStorage.getItem('mtf_personal_session')||'null');if(s?.access_token)bewaar(s);}catch{}}
  if(!sessie){$('#inlog').hidden=false;return;}
  try{await begin();}catch(e){$('#inlog').hidden=false;$('#portaal').hidden=true;$('#inlogFout').textContent=e.message;}
 })();
})();
