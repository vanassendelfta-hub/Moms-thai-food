import {brand} from "./brand.ts";
import {hasFeature,orderNumber} from "./locations.ts";
export function paymentLink(value:any){
 let u:URL;try{if(typeof value!=='string'||!value.trim())throw Error();u=new URL(value.trim());}catch{throw Error('Vul een geldige betaallink in, beginnend met http:// of https://');}
 if(!['http:','https:'].includes(u.protocol)||!u.hostname)throw Error('Vul een geldige betaallink in, beginnend met http:// of https://');
 return u;
}
const rights=['orders','menu','warehouse','costs','finance','users','shop','payments'];
export function requireRight(actor:any,key:string){if(!actor.owner&&!actor.permissions?.[key])throw Error('Geen rechten voor dit onderdeel');}
function positive(x:any,optional=false){if(optional&&(x===null||x===''))return null;const n=Number(x);if(!Number.isFinite(n)||n<0)throw Error('Vul een geldig positief bedrag in');return n;}
function text(x:any,max=1000){return String(x??'').trim().slice(0,max);}
const escapeHTML=(s:any)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function checked(q:any){const r=await q;if(r.error)throw r.error;return r.data;}
async function allRows(build:any){let rows:any[]=[];for(let start=0;start<=10000;start+=500){const page=await checked(build().range(start,start+499));rows.push(...page);if(page.length<500)return rows;}throw Error('Kies een kortere periode');}
const website=brand.adminUrl;
export async function processMail(db:any,id:string){
 const job=await checked(db.from('mtf_mail_jobs').select('*').eq('id',id).single());
 if(['sent','cancelled'].includes(job.status))return {status:job.status};
 if(job.status==='processing')return {status:'processing'};
 if(job.attempts>=5||Date.now()-Date.parse(job.created_at)>23*3600*1000)return {status:'failed'};
 const claimed=await checked(db.from('mtf_mail_jobs').update({status:'processing',started_at:new Date().toISOString(),attempts:job.attempts+1}).eq('id',id).eq('status',job.status).eq('attempts',job.attempts).select('id').maybeSingle());
 if(!claimed)return {status:job.status};
 try{
  const p=job.payload;let subject,body,plain;
  if(job.kind==='payment'&&db.location&&!db.location.is_primary&&!db.location.published)throw Error('Vestigingsmail is nog niet vrijgegeven');
  if(job.kind==='payment'){
   const order=await checked(db.from('orders').select('status,payment_url,payment_status').eq('id',p.order_id).single());
   if(order.status==='Geannuleerd'||order.payment_status==='Betaald'||order.payment_url!==p.url)throw Error('Betaalverzoek is vervallen');
   subject=`Betaalverzoek ${p.number} – ${brand.name}`;
   const amount=new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(p.total);
   body=`<p>Hoi ${escapeHTML(p.name)},</p><p>Hier is het betaalverzoek voor bestelling <strong>${escapeHTML(p.number)}</strong> van <strong>${amount}</strong>.</p><p><a style="background:#940c0d;color:white;padding:14px 20px;display:inline-block;border-radius:8px" href="${escapeHTML(p.url)}">Betaal je bestelling</a></p><p>Werkt de knop niet? ${escapeHTML(p.url)}</p>`;
   plain=`Hoi ${p.name}, betaalverzoek ${p.number}, ${amount}: ${p.url}`;
  }else if(['newyear','marketing','marketing_confirm'].includes(job.kind)){
   if(!hasFeature(db.location,'marketing'))throw Error('Campagne niet beschikbaar bij deze vestiging');
   const cancel=async()=>{await checked(db.from('mtf_mail_jobs').update({status:'cancelled',last_error:'Toestemming of actie niet meer geldig'}).eq('id',id));return {status:'cancelled'};};
   if(job.kind==='newyear'){
    const v=await checked(db.from('mtf_newyear_vouchers').select('*').eq('code',p.code).maybeSingle());
    const o=v?await checked(db.from('orders').select('status,customer_email').eq('id',v.order_id).single()):null;
    if(!v||v.disabled||!o||o.status==='Geannuleerd'||o.customer_email.toLowerCase()!==job.to_email.toLowerCase())return await cancel();
    subject='Jouw nieuwjaarscadeau: '+v.percent+'% korting';
    plain=`Bedankt voor je borrelpakket! Gebruik ${v.code} voor ${v.percent}% korting op eten van ${v.valid_from} t/m ${v.valid_until}. Eenmalig, gekoppeld aan je e-mail en telefoonnummer. Niet combineerbaar. Bezorgkosten uitgesloten. Bestel via ${brand.siteUrl}/menu`;
    body=`<p>Bedankt voor je borrelpakket!</p><h2>Jouw persoonlijke code: ${escapeHTML(v.code)}</h2><p>${escapeHTML(v.percent)}% korting op eten van ${escapeHTML(v.valid_from)} t/m ${escapeHTML(v.valid_until)}. Eenmalig met hetzelfde e-mailadres en telefoonnummer. Niet combineerbaar; bezorgkosten uitgesloten.</p><p><a href="${brand.siteUrl}/menu">Bestel je favoriete gerechten</a></p>`;
   }else{
    const c=await checked(db.from('mtf_contacts').select('*').eq('email',job.to_email).maybeSingle());
    if(!c)return await cancel();
    if(job.kind==='marketing_confirm'){
     if(c.status!=='pending'||c.confirm_token!==p.token||Date.now()-Date.parse(c.requested_at)>7*86400000)return await cancel();
     const url=brand.siteUrl+'/nieuwsbrief#confirm='+c.confirm_token;
     subject='Bevestig je nieuwsbriefinschrijving';plain='Bevestig je inschrijving voor aanbiedingen van '+brand.name+': '+url+' . Geen aanvraag gedaan? Negeer deze mail.';
     body=`<p>Je hebt je aangemeld voor aanbiedingen en nieuws van ${escapeHTML(brand.name)}.</p><p><a href="${url}">Ja, bevestig mijn inschrijving</a></p><p>Deze link is 7 dagen geldig. Geen aanvraag gedaan? Negeer deze mail.</p>`;
    }else{
     if(c.status!=='subscribed')return await cancel();
     const campaign=await checked(db.from('mtf_marketing_campaigns').select('*').eq('id',p.campaign_id).single());
     const url=brand.siteUrl+'/nieuwsbrief#unsubscribe='+c.unsubscribe_token;
     subject=campaign.subject;plain=campaign.body+'\n\n'+brand.name+', '+brand.place+'. Contact: '+brand.replyTo+'\nAfmelden: '+url;
     body=`<p>Hoi ${escapeHTML(c.name)},</p><div style="white-space:pre-wrap">${escapeHTML(campaign.body)}</div><p>${escapeHTML(brand.name)} · ${escapeHTML(brand.place)} · <a href="${brand.siteUrl}/contact">Contact en bedrijfsgegevens</a></p><p><a href="${url}">Afmelden voor marketingmails</a></p>`;
    }
   }
  }else if(job.kind==='task'){
   const task=await checked(db.from('mtf_tasks').select('status').eq('id',p.task_id).maybeSingle());
   const assignment=await checked(db.from('mtf_task_assignees').select('user_id').eq('task_id',p.task_id).eq('user_id',p.user_id).maybeSingle());
   const user=await checked(db.from('mtf_staff').select('active,email').eq('user_id',p.user_id).maybeSingle());
   if(!task||!['Open','In uitvoering'].includes(task.status)||!assignment||!user?.active||user.email!==job.to_email){await checked(db.from('mtf_mail_jobs').update({status:'cancelled',last_error:'Toewijzing niet meer actief'}).eq('id',id));return {status:'cancelled'};}
   const url=brand.siteUrl+'/admin?section=taken&location='+encodeURIComponent(db.location?.slug||'');
   const deadline=new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(p.deadline+'T12:00:00Z'));
   subject='Taak toegewezen: '+String(p.title).replace(/[\r\n]/g,' ');
   body=`<p>Hoi ${escapeHTML(p.name||'collega')},</p><p>Er is een taak aan jou toegewezen bij ${escapeHTML(brand.name)}.</p><h2>${escapeHTML(p.title)}</h2><p><strong>Deadline: ${escapeHTML(deadline)}</strong></p><p style="white-space:pre-wrap">${escapeHTML(p.information||'Geen aanvullende informatie.')}</p><p>Aangemaakt door ${escapeHTML(p.creator)}. Alle betrokken gebruikers kunnen de status aanpassen.</p><p><a style="background:#940c0d;color:white;padding:14px 20px;display:inline-block;border-radius:8px" href="${url}">Bekijk de takenlijst</a></p><p>Log in met je persoonlijke account.<br>${url}</p>`;
   plain=`Hoi ${p.name||'collega'}, er is een taak aan jou toegewezen: ${p.title}. Deadline: ${deadline}.\n\n${p.information||''}\n\nAangemaakt door ${p.creator}. Bekijk de taak en wijzig de status via je persoonlijke account: ${url}`;
  }else{subject='Uitnodiging voor '+(db.location?.name||brand.name);body=`<p>Hoi ${escapeHTML(p.name)},</p><p>Je bent uitgenodigd voor ${escapeHTML(db.location?.name||brand.name)} in de portal. Kies een eigen wachtwoord om je account te activeren.</p><p><a href="${escapeHTML(p.url)}">Account activeren</a></p><p>Deze persoonlijke link is tijdelijk geldig. Deel hem niet.</p>`;plain=`Activeer je ${brand.name}-account: ${p.url}`;}
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('E-mailservice ontbreekt');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`mtf-portal-${job.id}`},body:JSON.stringify({from:job.kind==='payment'&&db.location&&!db.location.is_primary?String(db.location.name).replace(/’/g,"'")+" <"+db.location.order_email+">":brand.mailName+" <"+brand.mailFrom+">",to:[job.to_email],reply_to:db.location?.mailbox_ready?db.location.order_email:brand.replyTo ,subject,text:plain,html:`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${escapeHTML(subject)}</title></head><body style="background:#fffaf4;color:#262222;font-family:Arial;padding:24px;line-height:1.6"><h1 style="color:${brand.color}">${escapeHTML(brand.name)}</h1>${body}<p>${escapeHTML(brand.tagline)}</p></body></html>`})});
  const result=await r.json();if(!r.ok)throw Error('E-mailservice gaf fout '+r.status);
  await checked(db.from('mtf_mail_jobs').update({status:'sent',resend_id:result.id,sent_at:new Date().toISOString(),last_error:null}).eq('id',id));return {status:'sent'};
 }catch(e){await checked(db.from('mtf_mail_jobs').update({status:'failed',last_error:String(e).slice(0,300)}).eq('id',id));return {status:'failed'};}
}
export async function portalAction(db:any,body:any,actor:any){
 const a=body.action;
 if(a==='whoami')return {actor};
 if(a==='warehouse_list'){
  requireRight(actor,'warehouse');const [categories,suppliers,stock,movements]=await Promise.all([checked(db.from('mtf_categories').select('*').order('name')),checked(db.from('mtf_suppliers').select('*').order('name')),checked(db.from('mtf_stock').select('*').eq('active',true).order('name')),checked(db.from('mtf_movements').select('*').order('created_at',{ascending:false}).limit(100))]);return {categories,suppliers,stock,movements};
 }
 if(a==='packaging_list'){requireRight(actor,'costs');return {stock:await checked(db.from('mtf_stock').select('id,name,unit_cost,unit,quantity').eq('packaging',true).eq('active',true).order('name'))};}
 if(a==='category_save'){requireRight(actor,'warehouse');const name=text(body.name,100);if(!name)throw Error('Naam verplicht');return {category:await checked(db.from('mtf_categories').upsert({...body.id?{id:body.id}:{},name}).select().single())};}
 if(a==='supplier_save'){requireRight(actor,'warehouse');const p=body.item||{};if(!text(p.name))throw Error('Naam verplicht');return {supplier:await checked(db.from('mtf_suppliers').upsert({...p.id?{id:p.id}:{},name:text(p.name,100),email:text(p.email,200),phone:text(p.phone,100),website:text(p.website),notes:text(p.notes)}).select().single())};}
 if(a==='stock_save'){
  requireRight(actor,'warehouse');const p=body.item||{};if(!text(p.name))throw Error('Naam verplicht');
  // Voorraad wijzigen gaat apart en atomair via een mutatie.
  const row={...p.id?{id:p.id}:{},name:text(p.name,100),category_id:p.category_id||null,supplier_id:p.supplier_id||null,unit:text(p.unit,30)||'stuk',unit_cost:positive(p.unit_cost),minimum:positive(p.minimum),packaging:p.packaging===true,notes:text(p.notes)};
  if(p.id&&p.packaging!==true){const costs=await checked(db.from('mtf_dish_costs').select('packaging'));if(costs.some((c:any)=>c.packaging.some((x:any)=>x.id===p.id)))throw Error('Dit artikel is gekoppeld aan een gerecht als verpakking');}
  return {stock:await checked(db.from('mtf_stock').upsert(row).select().single())};
 }
 if(a==='stock_adjust'){requireRight(actor,'warehouse');const delta=Number(body.delta);if(!Number.isFinite(delta)||delta===0||!text(body.reason))throw Error('Aantal en reden verplicht');await checked(db.rpc('mtf_adjust_stock',{p_id:body.id,p_delta:delta,p_reason:text(body.reason),p_actor:actor.email||'beheer'}));return {ok:true};}
 if(a==='stock_archive'){requireRight(actor,'warehouse');const costs=await checked(db.from('mtf_dish_costs').select('packaging'));if(costs.some((c:any)=>c.packaging.some((x:any)=>x.id===body.id)))throw Error('Verwijder eerst de verpakkingskoppeling bij de gerechten');await checked(db.from('mtf_stock').update({active:false}).eq('id',body.id));return {ok:true};}
 if(a==='dish_cost_get'){requireRight(actor,'costs');return {cost:await checked(db.from('mtf_dish_costs').select('*').eq('dish_id',body.id).maybeSingle())};}
 if(a==='dish_cost_save'){
  requireRight(actor,'costs');const packs=body.packaging||[];if(!Array.isArray(packs)||packs.length>20)throw Error('Ongeldige verpakkingen');const ids=new Set();
  for(const p of packs){if(ids.has(p.id)||!p.id||positive(p.qty)===0)throw Error('Verpakking of aantal ongeldig');ids.add(p.id);const s=await checked(db.from('mtf_stock').select('id').eq('id',p.id).eq('packaging',true).eq('active',true).maybeSingle());if(!s)throw Error('Verpakking niet beschikbaar');}
  return {cost:await checked(db.from('mtf_dish_costs').upsert({dish_id:body.id,ingredient_cost:positive(body.ingredient_cost,true),packaging:packs.map((p:any)=>({id:p.id,qty:Number(p.qty)})),updated_at:new Date().toISOString()}).select().single())};
 }
 if(a==='finance'){
  requireRight(actor,'finance');if(!/^\d{4}-\d{2}-\d{2}$/.test(body.from)||!/^\d{4}-\d{2}-\d{2}$/.test(body.to)||body.from>body.to)throw Error('Ongeldige periode');
  const rows=await allRows(()=>db.from('orders').select('id,order_number,created_at,requested_date,status,total,payment_status').gte('requested_date',body.from).lte('requested_date',body.to).order('requested_date').order('id'));if(rows.length>10000)throw Error('Kies een kortere periode');
  const costs:any[]=[];for(let i=0;i<rows.length;i+=200)costs.push(...await checked(db.from('mtf_order_costs').select('*').in('order_id',rows.slice(i,i+200).map((x:any)=>x.id))));
  const expenses=await allRows(()=>db.from('mtf_expenses').select('*').gte('date',body.from).lte('date',body.to).order('date',{ascending:false}).order('id'));
  const stock=await allRows(()=>db.from('mtf_stock').select('quantity,unit_cost').eq('active',true).order('id'));
  return {orders:rows.map((x:any)=>({...x,cost:costs.find((c:any)=>c.order_id===x.id)||null})),expenses,stock_value:stock.reduce((s:number,x:any)=>s+Number(x.quantity)*Number(x.unit_cost),0)};
 }
 if(a==='expense_save'){requireRight(actor,'finance');if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date)||!text(body.description))throw Error('Datum en omschrijving verplicht');return {expense:await checked(db.from('mtf_expenses').insert({date:body.date,description:text(body.description,200),amount:positive(body.amount)}).select().single())};}
 if(a==='staff_list'){requireRight(actor,'users');return {staff:await checked(db.from('mtf_staff').select('*').order('invited_at'))};}
 if(a==='staff_invite'){
  requireRight(actor,'users');const email=text(body.email,200).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Ongeldig e-mailadres');
  const permissions=Object.fromEntries(rights.map(k=>[k,body.permissions?.[k]===true]));const owner=body.owner===true;if(owner&&!actor.owner)throw Error('Alleen de eigenaar kan een eigenaar uitnodigen');
  const existing=await checked(db.from('mtf_staff').select('*').eq('email',email).maybeSingle());if(existing)throw Error('Dit account bestaat al. Gebruik Opnieuw uitnodigen of wijzig de rechten.');
  const {data,error}=await db.auth.admin.generateLink({type:'invite',email});if(error)throw error;
  await checked(db.from('mtf_staff').insert({user_id:data.user.id,email,name:text(body.name,100),owner,permissions}));
  const url=website+'?location='+encodeURIComponent(db.location?.slug||'')+'&token_hash='+encodeURIComponent(data.properties.hashed_token)+'&type=invite';
  const job=await checked(db.from('mtf_mail_jobs').insert({dedupe:'invite-'+data.user.id+'-'+data.properties.hashed_token,kind:'invite',to_email:email,payload:{name:text(body.name,100),url}}).select('id').single());return {ok:true,mail:await processMail(db,job.id)};
 }
 if(a==='staff_reinvite'){
  requireRight(actor,'users');const user=await checked(db.from('mtf_staff').select('*').eq('user_id',body.id).single());if(!user.active)throw Error('Activeer eerst het account');
  const {data,error}=await db.auth.admin.generateLink({type:'magiclink',email:user.email});if(error)throw error;
  const job=await checked(db.from('mtf_mail_jobs').insert({dedupe:'invite-'+user.user_id+'-'+data.properties.hashed_token,kind:'invite',to_email:user.email,payload:{name:user.name,url:website+'?location='+encodeURIComponent(db.location?.slug||'')+'&token_hash='+encodeURIComponent(data.properties.hashed_token)+'&type=magiclink'}}).select('id').single());return {mail:await processMail(db,job.id)};
 }
 if(a==='staff_update'){
  requireRight(actor,'users');const user=await checked(db.from('mtf_staff').select('*').eq('user_id',body.id).single());if(user.owner)throw Error('Het eigenaarsaccount blijft actief en behoudt alle rechten');
  const permissions=Object.fromEntries(rights.map(k=>[k,body.permissions?.[k]===true]));await checked(db.from('mtf_staff').update({permissions,active:body.active===true}).eq('user_id',body.id));return {ok:true};
 }
 if(a==='payment_send'){
  requireRight(actor,'payments');const o=await checked(db.from('orders').select('*').eq('id',body.id).single());if(!/betaalverzoek/i.test(o.payment)||o.status==='Geannuleerd'||o.payment_status==='Betaald')throw Error('Deze bestelling kan geen betaalverzoek ontvangen');
  const u=paymentLink(body.url);
  await checked(db.from('orders').update({payment_url:u.href}).eq('id',o.id));const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(u.href)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const dedupe='pay-'+o.id+'-'+hash;let job=await checked(db.from('mtf_mail_jobs').select('id').eq('dedupe',dedupe).maybeSingle());
  if(!job){const number=orderNumber(db.location,o.order_number);const insert=await db.from('mtf_mail_jobs').insert({dedupe,kind:'payment',to_email:o.customer_email,payload:{order_id:o.id,number,name:o.customer_name,total:Number(o.total),url:u.href}}).select('id').single();if(insert.error?.code==='23505')job=await checked(db.from('mtf_mail_jobs').select('id').eq('dedupe',dedupe).single());else{if(insert.error)throw insert.error;job=insert.data;}}
  return {mail:await processMail(db,job.id)};
 }
 if(a==='payment_status'){requireRight(actor,'payments');if(!['Open','Betaald'].includes(body.status))throw Error('Ongeldige betaalstatus');await checked(db.from('orders').update({payment_status:body.status}).eq('id',body.id));return {ok:true};}
 if(a==='mail_list'){requireRight(actor,'payments');return {jobs:await checked(db.from('mtf_mail_jobs').select('id,kind,status,created_at,last_error,payload').eq('kind','payment').order('created_at',{ascending:false}).limit(200))};}
 if(a==='mail_retry'){const job=await checked(db.from('mtf_mail_jobs').select('kind').eq('id',body.id).single());requireRight(actor,job.kind==='invite'?'users':'payments');return {mail:await processMail(db,body.id)};}
 return null;
}
