/* Gedeelde kaarthulpjes voor het bezorgportaal en de volgpagina: adres opzoeken, markers en links. */
window.MTFKaart=(()=>{
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const geheugen=new Map();let laatste=0;
 /* Adres -> coördinaten via OpenStreetMap (zelfde dienst en dezelfde opslag als de bezorgkaart in het beheer). Hooguit één zoekvraag per seconde. */
 async function zoek(adres){
  if(!adres)return null;if(geheugen.has(adres))return geheugen.get(adres);
  const sleutel='mtf_geocode_'+adres;
  try{const v=JSON.parse(localStorage.getItem(sleutel)||'null');if(v&&Number.isFinite(v.lat)&&Number.isFinite(v.lon)){geheugen.set(adres,v);return v;}}catch{}
  const wacht=laatste+1100-Date.now();laatste=Math.max(Date.now(),laatste+1100);if(wacht>0)await new Promise(r=>setTimeout(r,wacht));
  try{
   const r=await fetch('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q:adres,format:'json',limit:'1',countrycodes:'nl'}),{headers:{Accept:'application/json'}});
   if(!r.ok)return null;const z=await r.json();const v=z?.length?{lat:Number(z[0].lat),lon:Number(z[0].lon)}:null;
   if(v&&Number.isFinite(v.lat)&&Number.isFinite(v.lon)){geheugen.set(adres,v);try{localStorage.setItem(sleutel,JSON.stringify(v));}catch{}return v;}
  }catch{}
  return null;
 }
 const volAdres=o=>[o.address,o.city,'Nederland'].map(x=>String(x||'').trim()).filter(Boolean).join(', ');
 const navigatie=o=>'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+encodeURIComponent(volAdres(o));
 function maak(id){
  if(typeof L==='undefined')return null;
  const k=L.map(id,{scrollWheelZoom:false,zoomControl:true}).setView([51.85,4.33],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(k);
  return k;
 }
 const stip=()=>L.divIcon({className:'',html:'<div class="stip puls"></div>',iconSize:[22,22],iconAnchor:[11,11]});
 const pin=(tekst,soort='')=>L.divIcon({className:'',html:`<div class="pin ${soort}"><b>${esc(tekst)}</b></div>`,iconSize:[30,30],iconAnchor:[4,30]});
 /* Hemelsbrede afstand in meters. */
 function afstand(a,b){const R=6371000,r=x=>x*Math.PI/180,dLat=r(b.lat-a.lat),dLng=r(b.lng-a.lng),h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
 return {esc,zoek,volAdres,navigatie,maak,stip,pin,afstand};
})();
