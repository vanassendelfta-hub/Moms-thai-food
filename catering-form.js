/* Cateringaanvraag: formulier op /catering-paketten. Slaat de aanvraag op via de databasefunctie mtf_catering_submit;
   medewerkers zien de aanvraag in het beheer onder Catering. */
(()=>{
 const f=document.getElementById('cateringForm');if(!f)return;
 const st=document.getElementById('cateringStatus'),btn=f.querySelector('[type=submit]');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam'}).format(new Date());
 f.elements.event_date.min=today;
 const say=(t,bad)=>{st.textContent=t;st.classList.toggle('checkout-error',!!bad);};
 f.addEventListener('submit',async e=>{
  e.preventDefault();
  f.querySelectorAll('.is-invalid').forEach(x=>x.classList.remove('is-invalid'));
  const bad=[...f.querySelectorAll('input,textarea')].filter(x=>!x.checkValidity());
  if(bad.length){bad.forEach(x=>x.classList.add('is-invalid'));bad[0].focus();return say('Vul de gemarkeerde velden in.',true);}
  const d=Object.fromEntries(new FormData(f).entries());
  d.persons=Number(d.persons);d.rent_plates=d.rent_plates==='true';d.rent_cutlery=d.rent_cutlery==='true';
  btn.disabled=true;say('Aanvraag versturen…');
  try{
   const r=await fetch(SITE_CONFIG.supabaseUrl+'/rest/v1/rpc/mtf_catering_submit',{method:'POST',headers:{'Content-Type':'application/json',apikey:SITE_CONFIG.publishableKey},body:JSON.stringify({p:d})});
   const x=await r.json().catch(()=>({}));
   if(!r.ok||!x.ok)throw Error(x.message||'Versturen is niet gelukt. Probeer het opnieuw of bel ons.');
   f.reset();f.elements.event_date.min=today;
   say('Bedankt! Uw aanvraag is ontvangen. Wij nemen zo snel mogelijk contact met u op.');
  }catch(err){say(err.message,true);}finally{btn.disabled=false;}
 });
})();
