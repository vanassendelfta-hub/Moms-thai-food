/* Bezorgen in het beheer: bestellingen toewijzen aan een bezorger, bezorgers live op de bezorgkaart
   en medewerkers aanmerken als bezorger (Gebruikers). Praat met de serverfunctie mtf-bezorging.
   Bezorgers zelf werken in het bezorgportaal (/bezorger). */
(()=>{
 const API=SITE_CONFIG.supabaseUrl+'/functions/v1/mtf-bezorging';
 let bezorgers=[],geladen=false,bezorgerLaag=null;
 const actief=()=>!!(currentActor&&!currentActor.legacy&&can('orders'));
 const open=o=>o.method==='Bezorgen'&&!['Bezorgd','Afgehaald','Geannuleerd'].includes(o.status);
 const naamVan=id=>bezorgers.find(b=>b.id===id)?.naam||'';

 const style=document.createElement('style');
 style.textContent=`
 .bezorger-kies{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 0;font-size:14px;font-weight:600}
 .bezorger-kies select{min-width:190px;flex:1;max-width:320px}
 .bezorger-kies .hint{margin:0;font-weight:400}
 .bezorger-stip{width:22px;height:22px;border-radius:50%;background:#2f7bf0;border:4px solid #fff;box-shadow:0 0 0 2px #2f7bf0,0 2px 8px rgba(0,0,0,.45)}
 .bezorger-naam{background:#2f7bf0!important;color:#fff!important;border:0!important;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.3)!important}
 .bezorger-naam::before{display:none!important}
 #bezorgerLijst{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}
 #bezorgerLijst span{border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600;border:1px solid var(--fs-lijn,#d3a85355);background:var(--fs-vlak,#161b2d);color:var(--fs-tekst,#f6f2ec)}
 #bezorgerLijst span.live{border-color:#2f7bf0;box-shadow:inset 0 0 0 1px #2f7bf0}
 #bezorgerLijst span i{display:inline-block;width:9px;height:9px;border-radius:50%;background:#7c8598;margin-right:7px}
 #bezorgerLijst span.live i{background:#2f7bf0}
 .bezorger-uitleg{margin:0 0 14px}`;
 document.head.append(style);

 async function roep(actie,extra={}){
  const access=typeof freshAccess==='function'?await freshAccess():null;
  if(!access)throw Error('Log in met je persoonlijke account om bezorgers te beheren.');
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:SITE_CONFIG.publishableKey,Authorization:'Bearer '+access},body:JSON.stringify({actie,location:window.MTFLocation?.slug,...extra})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.fout)throw Error(d.fout||'Er ging iets mis. Probeer het opnieuw.');
  return d;
 }
 async function laadBezorgers(){
  if(!actief())return;
  try{bezorgers=(await roep('bezorgers')).bezorgers||[];const eerste=!geladen;geladen=true;if(eerste)render();tekenBezorgers();}catch(e){console.warn('Bezorgers laden',e);}
 }

 /* Keuzelijst "Bezorger" voor één bestelling. */
 function kiezer(o){
  const box=document.createElement('label');box.className='bezorger-kies';
  if(!bezorgers.length&&!o.driver_id){box.innerHTML='Bezorger <span class="hint">Nog geen bezorgers. Merk een medewerker aan als bezorger bij Gebruikers.</span>';return box;}
  const onbekend=o.driver_id&&!naamVan(o.driver_id);
  box.innerHTML=`Bezorger <select aria-label="Bezorger voor deze bestelling"><option value="">Niet toegewezen</option>${bezorgers.map(b=>`<option value="${esc(b.id)}" ${b.id===o.driver_id?'selected':''}>${esc(b.naam)}${b.onderweg?' · onderweg ('+b.onderweg+')':''}</option>`).join('')}${onbekend?`<option value="${esc(o.driver_id)}" selected>Niet meer actieve bezorger</option>`:''}</select>`;
  const s=box.querySelector('select');
  s.onchange=async()=>{
   const vorige=o.driver_id||'';s.disabled=true;
   try{await roep('toewijzen',{id:o.id,bezorger:s.value||null});o.driver_id=s.value||null;toast(s.value?formatNo(o.order_number)+' toegewezen aan '+naamVan(s.value):'Toewijzing verwijderd');}
   catch(e){s.value=vorige;toast(e.message);}
   finally{s.disabled=false;}
  };
  return box;
 }

 /* Bestellingenlijst */
 const basisRender=render;render=function(){
  basisRender();if(!actief()||!geladen)return;
  document.querySelectorAll('#orders .order-card').forEach(card=>{
   const id=card.querySelector('[data-save]')?.dataset.save,o=orders.find(x=>String(x.id)===String(id)),voet=card.querySelector('.order-footer');
   if(!o||!voet||card.querySelector('.bezorger-kies'))return;
   if(open(o))voet.before(kiezer(o));
   else if(o.method==='Bezorgen'&&o.driver_id&&naamVan(o.driver_id)){const p=document.createElement('p');p.className='hint bezorger-kies';p.textContent='Bezorgd door '+naamVan(o.driver_id);voet.before(p);}
  });
 };

 /* Bezorgkaart: bezorgers als blauwe stip met naam, plus een regel per bezorger onder de kaart. */
 const sinds=d=>{const s=Math.max(0,Math.round((Date.now()-Date.parse(d))/1000));return s<60?s+' sec geleden':Math.round(s/60)+' min geleden';};
 function tekenBezorgers(){
  if(typeof leafletMap==='undefined'||!leafletMap||$('#mapPanel').hidden)return;
  if(!bezorgerLaag)bezorgerLaag=L.layerGroup().addTo(leafletMap);
  bezorgerLaag.clearLayers();
  for(const b of bezorgers){
   if(b.lat===null||b.lng===null)continue;
   L.marker([b.lat,b.lng],{zIndexOffset:1000,icon:L.divIcon({className:'',html:'<div class="bezorger-stip"></div>',iconSize:[22,22],iconAnchor:[11,11]})})
    .bindTooltip(esc(b.naam),{permanent:true,direction:'top',offset:[0,-12],className:'bezorger-naam'}).addTo(bezorgerLaag);
  }
  let lijst=$('#bezorgerLijst');
  if(!lijst){lijst=document.createElement('div');lijst.id='bezorgerLijst';lijst.setAttribute('aria-label','Bezorgers');$('#mapInfo').after(lijst);}
  lijst.innerHTML=bezorgers.map(b=>{const live=b.lat!==null;return `<span class="${live?'live':''}"><i aria-hidden="true"></i>${esc(b.naam)} · ${live?'live, '+esc(sinds(b.bijgewerkt)):b.onderweg?'onderweg, geen live locatie':'niet onderweg'}${b.onderweg?' · '+b.onderweg+(b.onderweg===1?' bestelling':' bestellingen'):''}</span>`;}).join('');
 }
 const basisKaart=renderActiveMap;renderActiveMap=async function(){
  await basisKaart();tekenBezorgers();
  /* Bezorgers die live zijn horen ook in beeld. */
  const live=bezorgers.filter(b=>b.lat!==null&&b.lng!==null);if(!live.length||!leafletMap||!locationMarkers)return;
  const punten=live.map(b=>[b.lat,b.lng]);locationMarkers.eachLayer(l=>{const p=l.getLatLng();punten.push([p.lat,p.lng]);});
  leafletMap.fitBounds(punten,{maxZoom:15,padding:[45,45]});
 };
 const basisDetail=showMapOrder;showMapOrder=function(id){
  basisDetail(id);const o=orders.find(x=>x.id===id);
  if(o&&actief()&&geladen&&open(o)&&!$('#mapDetails').querySelector('.bezorger-kies'))$('#mapDetails').append(kiezer(o));
 };
 document.querySelector('[data-tab="mapPanel"]')?.addEventListener('click',()=>laadBezorgers());
 /* Live: iedere 10 seconden zolang de kaart open staat, anders eens per minuut voor de keuzelijsten. */
 let tik=0;
 setInterval(()=>{tik++;if(document.hidden||$('#dashboard').hidden||!actief())return;if(!$('#mapPanel').hidden||tik%6===0)laadBezorgers();},10000);

 /* Gebruikers: medewerker aan- of uitzetten als bezorger. */
 const basisStaff=loadStaff;loadStaff=async function(){
  await basisStaff();
  if(!currentActor||currentActor.legacy||!can('users'))return;
  let staf=[];try{staf=(await request('staff_list')).staff||[];}catch{return;}
  const lijst=$('#staffList');
  if(!lijst.previousElementSibling?.classList.contains('bezorger-uitleg')){const p=document.createElement('p');p.className='hint bezorger-uitleg';p.innerHTML='Bezorgers loggen met hun eigen account in op het bezorgportaal: <a href="bezorger" target="_blank" rel="noopener">bestellen.momsthaifood.nl/bezorger</a>. Een bezorger heeft verder geen rechten nodig.';lijst.before(p);}
  lijst.querySelectorAll('[data-reinvite]').forEach(k=>{
   const s=staf.find(x=>x.user_id===k.dataset.reinvite);if(!s||k.parentElement.querySelector('[data-bezorger]'))return;
   const b=document.createElement('button');b.type='button';b.className='secondary-button';b.dataset.bezorger=s.user_id;
   const zet=()=>{b.textContent=s.driver?'🛵 Bezorger: aan':'Maak bezorger';b.setAttribute('aria-pressed',s.driver?'true':'false');};zet();
   b.onclick=async()=>{b.disabled=true;try{await roep('bezorger_instellen',{id:s.user_id,bezorger:!s.driver});s.driver=!s.driver;zet();toast(s.driver?(s.name||s.email)+' is nu bezorger':(s.name||s.email)+' is geen bezorger meer');geladen=false;laadBezorgers();}catch(e){toast(e.message);}finally{b.disabled=false;}};
   k.after(' ',b);
  });
  if(typeof filterStaff==='function')filterStaff();
 };
 $('#refreshStaff').onclick=()=>loadStaff();

 /* Wie alleen bezorger is (geen beheerrechten) hoort in het bezorgportaal. */
 const basisRechten=applyRights;applyRights=function(){
  const a=currentActor;
  if(a&&!a.owner&&!a.legacy&&a.driver&&!Object.values(a.permissions||{}).some(Boolean)){location.replace('bezorger');return;}
  basisRechten();if(actief())laadBezorgers();
 };
 if(currentActor)applyRights();
})();
