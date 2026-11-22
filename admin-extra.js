function menuPhotoFallback(x){return SITE_CONFIG.fallbackPhoto(x);}
/* Extra beheerfuncties Mom's Thai Food v3 */
let shopState=true,menuAdmin=[],editingDish=null,leafletMap=null,locationMarkers=null,mapIsLoading=false;
const closedStatuses=new Set(['Bezorgd','Afgehaald','Geannuleerd']);
const mapCache=new Map();
function adminError(e){toast(e?.message||'Er is iets misgegaan')}
async function refreshShop(){if(typeof currentActor!=='undefined'&&currentActor&&!can('shop'))return;
 try{const d=await request('get_shop_settings');shopState=!!d.settings.is_open;
 $('#shopIndicator').textContent=shopState?'🟢 Online winkel is OPEN':'🔴 Online winkel is GESLOTEN';
 $('#shopIndicatorSub').textContent=shopState?'Klanten kunnen bestellingen plaatsen.':'Nieuwe bestellingen worden door de server geweigerd.';
 const b=$('#toggleShop');b.textContent=shopState?'Winkel sluiten':'Winkel openen';b.classList.toggle('closed',shopState);b.disabled=false;
 }catch(e){adminError(e)}
}
$('#toggleShop').onclick=async()=>{
 const next=!shopState;
 if(!confirm(next?'Online bestellen openen voor klanten?':'Online bestellen direct sluiten? Reeds geplaatste bestellingen blijven bestaan.'))return;
 const b=$('#toggleShop');b.disabled=true;
 try{await request('set_shop_open',{is_open:next});await refreshShop();toast(next?'Online winkel geopend':'Online winkel gesloten')}catch(e){b.disabled=false;adminError(e)}
};
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',async()=>{
 document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));
 for(const id of ['ordersPanel','menuPanel','mapPanel'])$('#'+id).hidden=id!==b.dataset.tab;
 if(b.dataset.tab==='menuPanel')await refreshMenuAdmin();
 if(b.dataset.tab==='mapPanel'){initMap();setTimeout(()=>leafletMap?.invalidateSize(),120);await renderActiveMap()}
});
function menuPreviewUrl(x){return x?.image_url || (typeof photoFor==='function'?photoFor(x):menuPhotoFallback(x)) || 'logo.png'}
async function refreshMenuAdmin(){
 try{const d=await request('list_menu');menuAdmin=d.menu||[];
 $('#menuAdminList').innerHTML=menuAdmin.map(x=>`<div class="menu-admin-card"><img src="${esc(menuPreviewUrl(x))}" alt=""><div class="menu-data"><h3>${esc(x.name)}</h3><p>${esc(x.category)} · ${euro(x.price)} · ${x.active?'Actief':'Verborgen'}</p><button type="button" class="secondary-button" data-editdish="${esc(x.id)}">Bewerken</button></div></div>`).join('')||'<p class="hint">Nog geen gerechten gevonden.</p>';
 document.querySelectorAll('[data-editdish]').forEach(b=>b.onclick=()=>openDish(menuAdmin.find(x=>x.id===b.dataset.editdish)));
 }catch(e){adminError(e)}
}
function openDish(d=null){editingDish=d;$('#dishModalTitle').textContent=d?'Gerecht bewerken':'Nieuw gerecht';$('#dishForm').reset();$('#dishName').value=d?.name||'';$('#dishDesc').value=d?.description||'';$('#dishPrice').value=d?.price??'';$('#dishCategory').value=d?.category||'';$('#dishSort').value=d?.sort_order??0;$('#dishActive').checked=d?.active!==false;$('#dishSpice').checked=d?.spice_enabled===true;$('#dishPreview').src=d?menuPreviewUrl(d):'';$('#dishPreview').style.display=d?'block':'none';$('#dishModal').hidden=false}
$('#newDish').onclick=()=>openDish();$('#cancelDish').onclick=()=>$('#dishModal').hidden=true;$('#refreshMenu').onclick=()=>refreshMenuAdmin();
$('#dishPhoto').onchange=()=>{const file=$('#dishPhoto').files[0];if(!file)return;const u=URL.createObjectURL(file);$('#dishPreview').src=u;$('#dishPreview').style.display='block';$('#dishPreview').onload=()=>URL.revokeObjectURL(u)};
function base64FromFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Afbeelding niet leesbaar'));r.readAsDataURL(file)})}
$('#dishForm').onsubmit=async ev=>{
 ev.preventDefault();const b=$('#saveDish');b.disabled=true;
 try{
 let image_url=editingDish?.image_url||null;
 const file=$('#dishPhoto').files?.[0];if(file){if(file.size>5*1024*1024)throw Error('Afbeelding mag maximaal 5 MB zijn');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Gebruik een JPG, PNG of WEBP afbeelding');
 const x=await request('upload_menu_image',{mime:file.type,data:await base64FromFile(file)});if(!x.url)throw Error('Foto upload gaf geen URL terug');image_url=x.url;
 }
 const name=$('#dishName').value.trim(),price=Number($('#dishPrice').value);
 if(!name||!Number.isFinite(price)||price<0)throw Error('Vul naam en een geldige prijs in');
 const id=editingDish?.id || ('menu-'+crypto.randomUUID());
 await request('upsert_menu',{item:{id,name,description:$('#dishDesc').value.trim(),price,category:$('#dishCategory').value.trim(),active:$('#dishActive').checked,spice_enabled:$('#dishSpice').checked,sort_order:parseInt($('#dishSort').value,10)||0,image_url}});
 $('#dishModal').hidden=true;toast('Gerecht opgeslagen');await refreshMenuAdmin();
 }catch(e){adminError(e)}finally{b.disabled=false}
};
function initMap(){
 if(leafletMap)return true;
 if(typeof L==='undefined'){$('#mapInfo').textContent='Kaartbibliotheek kon niet laden. Vernieuw de pagina of controleer de internetverbinding.';return false}
 try{leafletMap=L.map('activeMap',{scrollWheelZoom:false}).setView([51.87,4.36],11);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(leafletMap);
 locationMarkers=L.layerGroup().addTo(leafletMap);
 setTimeout(()=>leafletMap?.invalidateSize(),220);return true;
 }catch(e){$('#mapInfo').textContent='Kaart laden mislukt: '+e.message;return false}
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function orderAddress(o){return [o.address,o.city,'Nederland'].filter(Boolean).join(', ')}
async function getLocation(o){
 const addr=orderAddress(o);if(mapCache.has(addr))return mapCache.get(addr);
 const key='mtf_geocode_'+addr;
 try{const val=JSON.parse(localStorage.getItem(key)||'null');if(val&&Number.isFinite(val.lat)&&Number.isFinite(val.lon)){mapCache.set(addr,val);return val}}catch{}
 const q=new URLSearchParams({q:addr,format:'json',limit:'1',countrycodes:'nl',addressdetails:'1'});
 try{
  const r=await fetch('https://nominatim.openstreetmap.org/search?'+q.toString(),{headers:{'Accept':'application/json'}});
  if(!r.ok)throw Error('Locatieservice HTTP '+r.status);
  const z=await r.json();const val=z?.length?{lat:Number(z[0].lat),lon:Number(z[0].lon)}:null;
  if(val&&Number.isFinite(val.lat)&&Number.isFinite(val.lon)){mapCache.set(addr,val);try{localStorage.setItem(key,JSON.stringify(val))}catch{}return val}
  return null;
 }catch(err){console.warn('Adres niet bepaald',addr,err);return null}
}
async function renderActiveMap(){
 if(!initMap()||mapIsLoading)return;
 mapIsLoading=true;
 const active=orders.filter(o=>o.method==='Bezorgen'&&!closedStatuses.has(o.status));
 let found=0,missing=[];const bounds=[];
 try{
  locationMarkers.clearLayers();$('#mapDetails').hidden=true;
  $('#mapInfo').textContent=active.length+' actieve bezorgbestellingen; adressen worden geladen…';
  for(let i=0;i<active.length;i++){
   const o=active[i];if(i>=35){missing.push('Meer dan 35 bestellingen');break}
   const loc=await getLocation(o);
   if(!loc){missing.push(formatNo(o.order_number));continue}
   const marker=L.marker([loc.lat,loc.lon]);
   marker.bindTooltip(esc(formatNo(o.order_number))+' · '+esc(o.customer_name));
   marker.on('click',()=>showMapOrder(o.id));marker.addTo(locationMarkers);found++;bounds.push([loc.lat,loc.lon]);
   if(i<active.length-1&&!mapCache.has(orderAddress(active[i+1])))await wait(1100);
  }
  if(bounds.length)leafletMap.fitBounds(bounds,{maxZoom:15,padding:[35,35]});else leafletMap.setView([51.87,4.36],11);
  $('#mapInfo').textContent=active.length===0?'Er zijn momenteel geen actieve bezorgbestellingen.':found+' van '+active.length+' actieve bezorgbestellingen op de kaart'+(missing.length?' · Locatie niet gevonden voor: '+missing.join(', '):'');
 }catch(e){$('#mapInfo').textContent='Fout bij het bijwerken van de kaart: '+e.message;console.error(e)}
 finally{mapIsLoading=false;setTimeout(()=>leafletMap?.invalidateSize(),100)}
}
function showMapOrder(id){const o=orders.find(o=>o.id===id);if(!o)return;const items=Array.isArray(o.items)?o.items:[];
 $('#mapDetails').innerHTML=`<button class="secondary-button" type="button" id="closeMapDetails">✕</button><h3>${esc(formatNo(o.order_number))}</h3><p><strong>${esc(o.customer_name)}</strong><br>${o.address?mapsLink(o,esc(o.address)+'<br>'+esc(o.city||'')):esc(o.city||'')}<br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></p><p><strong>Status:</strong> ${esc(o.status)}<br><strong>Bezorgmoment:</strong> ${esc(o.requested_date)} ${esc(String(o.requested_time||'').slice(0,5))}</p><div class="order-items">${items.map(x=>`<div class="itemline"><span>${esc(x.qty)} × ${esc(x.name)}</span><span>${euro(Number(x.qty)*Number(x.price))}</span></div>`).join('')}${o.method==='Bezorgen'?`<div class="itemline"><span>Bezorgkosten</span><span>${Number(o.delivery_fee||0)>0?euro(o.delivery_fee):'Gratis'}</span></div>`:''}<div class="order-total"><span>Totaal</span><span>${euro(o.total)}</span></div></div>${o.notes?`<p><strong>Opmerkingen:</strong> ${esc(o.notes)}</p>`:''}`;
 $('#mapDetails').hidden=false;$('#closeMapDetails').onclick=()=>$('#mapDetails').hidden=true;
}
$('#refreshMap').onclick=async()=>{await refresh(true);await renderActiveMap()};
const oldEnter=enter;enter=function(){oldEnter();refreshShop()};
const oldRefresh=refresh;refresh=async function(...args){await oldRefresh(...args);if(!$('#mapPanel').hidden)await renderActiveMap()};

setInterval(()=>{if(!$('#dashboard').hidden)refreshShop()},30000);
