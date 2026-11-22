/* Volgpagina voor klanten (/volg). Bestelnummer + telefoonnummer van de bestelling geven de status,
   en zodra de bezorger is vertrokken ook waar die is. De link in de mail "Je bestelling wordt bereid"
   vult het bestelnummer al in (?b=MTF00284012). Praat met de serverfunctie mtf-bezorging (actie "volg"). */
(()=>{
 const K=window.MTFKaart,$=s=>document.querySelector(s);
 const API=SITE_CONFIG.supabaseUrl+'/functions/v1/mtf-bezorging';
 const param=new URLSearchParams(location.search);
 const demo=SITE_CONFIG.environment==='test'&&param.has('demo');
 const OPSLAG='mtf_volg';
 let gegevens=null,timer=null,kaart=null,bezorgerMarker=null,huisMarker=null,huis=null,ingepast=false,demoStap=0;

 async function vraag(g){
  if(demo)return demoAntwoord();
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:SITE_CONFIG.publishableKey},body:JSON.stringify({actie:'volg',nummer:g.nummer,telefoon:g.telefoon})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.fout){const e=Error(d.fout||'Het lukt nu even niet. Probeer het zo opnieuw.');e.status=r.status;throw e;}
  return d;
 }
 const stappenBezorgen=[['Nieuw','Bestelling ontvangen','We hebben je bestelling binnen.'],['In bereiding','In bereiding','De keuken is voor je aan het koken.'],['Klaar','Klaar voor vertrek','Je bestelling wacht op de bezorger.'],['Onderweg','Onderweg','De bezorger is naar je onderweg.'],['Bezorgd','Bezorgd','Eet smakelijk!']];
 const stappenAfhalen=[['Nieuw','Bestelling ontvangen','We hebben je bestelling binnen.'],['In bereiding','In bereiding','De keuken is voor je aan het koken.'],['Klaar','Klaar om af te halen','Je kunt je bestelling komen ophalen.'],['Afgehaald','Afgehaald','Eet smakelijk!']];

 function toon(d){
  const b=d.bestelling,bez=d.bezorger,afhalen=b.methode==='Afhalen';
  $('#zoek').hidden=true;$('#volg').hidden=false;
  $('#volgNummer').textContent='Bestelling '+b.nummer+(b.tijd?' · gewenste tijd '+b.tijd:'');
  const titel={'Nieuw':'We hebben je bestelling ontvangen','In bereiding':'Je bestelling wordt bereid','Klaar':afhalen?'Je bestelling staat klaar':'Je bestelling is klaar voor vertrek','Onderweg':(bez?.naam||'Je bezorger')+' is onderweg','Bezorgd':'Je bestelling is bezorgd','Afgehaald':'Je bestelling is afgehaald','Geannuleerd':'Deze bestelling is geannuleerd'}[b.status]||b.status;
  $('#volgTitel').textContent=titel;
  $('#volgTekst').textContent=b.status==='Geannuleerd'?'Heb je hier vragen over? Neem dan contact met ons op.':afhalen?'Je haalt deze bestelling zelf af.':b.status==='Onderweg'?'We bezorgen op '+b.adres+'.':['Bezorgd','Afgehaald'].includes(b.status)?'Bedankt voor je bestelling. Eet smakelijk!':'Zodra de bezorger vertrekt, zie je hier live waar die is. We bezorgen op '+b.adres+'.';
  const stappen=afhalen?stappenAfhalen:stappenBezorgen,nu=stappen.findIndex(s=>s[0]===b.status),laatste=nu===stappen.length-1;
  $('#stappen').innerHTML=b.status==='Geannuleerd'?'':stappen.map((s,i)=>`<li class="${i<nu||(i===nu&&laatste)?'gedaan':i===nu?'nu':''}"${i===nu?' aria-current="step"':''}><div><b>${K.esc(s[1])}</b><span>${K.esc(s[2])}</span></div></li>`).join('');
  $('#stappen').parentElement.hidden=b.status==='Geannuleerd';
  toonKaart(b,bez);
  /* Afgeronde bestellingen hoeven niet meer te verversen. */
  if(['Bezorgd','Afgehaald','Geannuleerd'].includes(b.status)){clearInterval(timer);timer=null;}
 }
 async function toonKaart(b,bez){
  const vlak=$('#kaartVlak');
  if(b.status!=='Onderweg'||!bez){vlak.hidden=true;return;}
  vlak.hidden=false;
  if(!kaart){kaart=K.maak('kaart');if(!kaart){$('#kaartTekst').textContent='De kaart kon niet laden.';return;}}
  setTimeout(()=>kaart.invalidateSize(),60);
  if(!huis&&b.adres){huis=await K.zoek(b.adres+', Nederland');if(huis&&!huisMarker)huisMarker=L.marker([huis.lat,huis.lon],{icon:K.pin('⌂','huis')}).bindTooltip('Jouw adres').addTo(kaart);}
  if(bez.lat===null||bez.lng===null){
   if(bezorgerMarker){kaart.removeLayer(bezorgerMarker);bezorgerMarker=null;}
   if(huis&&!ingepast)kaart.setView([huis.lat,huis.lon],14);
   $('#kaartTekst').textContent=bez.naam+' is onderweg. De locatie is op dit moment even niet beschikbaar; we tonen hem zodra er weer verbinding is.';return;
  }
  const p=[bez.lat,bez.lng];
  if(bezorgerMarker)bezorgerMarker.setLatLng(p);else bezorgerMarker=L.marker(p,{icon:K.stip(),zIndexOffset:1000}).bindTooltip(bez.naam).addTo(kaart);
  if(!ingepast){ingepast=true;if(huis)kaart.fitBounds([p,[huis.lat,huis.lon]],{maxZoom:16,padding:[45,45]});else kaart.setView(p,15);}
  else if(!kaart.getBounds().pad(-0.1).contains(p)){if(huis)kaart.fitBounds([p,[huis.lat,huis.lon]],{maxZoom:16,padding:[45,45]});else kaart.panTo(p);}
  const m=huis?K.afstand({lat:bez.lat,lng:bez.lng},{lat:huis.lat,lng:huis.lon}):null;
  $('#kaartTekst').textContent=bez.naam+' is '+(m===null?'onderweg':m<150?'er bijna':m<1000?'nog ongeveer '+Math.round(m/50)*50+' meter bij je vandaan (hemelsbreed)':'nog ongeveer '+(m/1000).toFixed(1).replace('.',',')+' km bij je vandaan (hemelsbreed)')+'. De bezorger kan onderweg ook bij andere adressen stoppen.';
 }
 async function ververs(){
  if(document.hidden||!gegevens)return;
  try{toon(await vraag(gegevens));}catch(e){if(e.status===404||e.status===429){stop();$('#zoekFout').textContent=e.message;}}
 }
 function start(d){
  toon(d);clearInterval(timer);
  if(!['Bezorgd','Afgehaald','Geannuleerd'].includes(d.bestelling.status))timer=setInterval(ververs,demo?3000:10000);
 }
 function stop(){
  clearInterval(timer);timer=null;gegevens=null;try{sessionStorage.removeItem(OPSLAG);}catch{}
  $('#volg').hidden=true;$('#zoek').hidden=false;ingepast=false;huis=null;
  if(kaart){if(bezorgerMarker)kaart.removeLayer(bezorgerMarker);if(huisMarker)kaart.removeLayer(huisMarker);bezorgerMarker=huisMarker=null;}
 }
 $('#andere').onclick=()=>{stop();$('#nummer').focus();};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)ververs();});
 $('#zoekForm').onsubmit=async e=>{
  e.preventDefault();const knop=e.submitter||e.target.querySelector('button'),g={nummer:$('#nummer').value.trim(),telefoon:$('#telefoon').value.trim()};
  $('#zoekFout').textContent='';
  if(!g.nummer){$('#zoekFout').textContent='Vul je bestelnummer in.';$('#nummer').focus();return;}
  if(g.telefoon.replace(/\D/g,'').length<9){$('#zoekFout').textContent='Vul het telefoonnummer van je bestelling in.';$('#telefoon').focus();return;}
  knop.disabled=true;knop.textContent='Bezig…';
  try{const d=await vraag(g);gegevens=g;try{sessionStorage.setItem(OPSLAG,JSON.stringify(g));}catch{}start(d);}
  catch(err){$('#zoekFout').textContent=err.message;}
  finally{knop.disabled=false;knop.textContent='Bekijk mijn bestelling';}
 };

 /* Voorbeeldweergave (alleen buiten de echte website): loopt vanzelf door de stappen. */
 function demoAntwoord(){
  demoStap++;const status=demoStap<2?'In bereiding':demoStap<3?'Klaar':demoStap<14?'Onderweg':'Bezorgd',t=Math.min(1,Math.max(0,(demoStap-3)/10));
  return {ok:true,bestelling:{nummer:'MTF00284041',status,methode:'Bezorgen',naam:'Sanne',adres:'Marktplein 3, Spijkenisse',tijd:'18:15'},bezorger:status==='Onderweg'?{naam:'Daan',lat:51.8610+(51.8460-51.8610)*t,lng:4.3080+(4.3290-4.3080)*t,bijgewerkt:new Date().toISOString()}:null};
 }

 /* Start: bestelnummer uit de link, of een eerder ingevulde bestelling in dit tabblad. */
 const uitLink=(param.get('b')||'').slice(0,20);if(uitLink)$('#nummer').value=uitLink;
 if(demo){gegevens={nummer:'demo',telefoon:'demo'};vraag(gegevens).then(start);return;}
 try{const g=JSON.parse(sessionStorage.getItem(OPSLAG)||'null');if(g?.nummer&&g?.telefoon&&(!uitLink||uitLink.toUpperCase()===g.nummer.toUpperCase())){gegevens=g;$('#nummer').value=g.nummer;vraag(g).then(start).catch(()=>stop());}}catch{}
 if(uitLink&&!gegevens)$('#telefoon').focus();
})();
