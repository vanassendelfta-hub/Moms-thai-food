import { normalizeAddonItems } from "./addon-rules.ts";
import { getLocation, scopedDb, hasFeature } from "./locations.ts";
import { brand } from "./brand.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,apikey,authorization','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const consent='Ik wil de aanmeldcoupon per e-mail ontvangen. Mijn adres wordt hiervoor opgeslagen. Versie 2026-10-16.';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Alleen POST'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>5000)throw Error('Verzoek te groot');
  const b=await req.json();const root=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);const location=await getLocation(root,b.location||null);if(!location.published)return reply({ok:false,error:'Deze vestiging is niet beschikbaar.'},404);const db=scopedDb(root,location);
  const result=await db.from('mtf_promotion_settings').select('*').eq('id',true).single();if(result.error)throw Error('Instellingen niet beschikbaar');const s=result.data;
  if(b.action==='config'){let product_name='';if(s.kind==='product'){const p=await db.from('menu_items').select('name,active').eq('id',s.product_id).maybeSingle();if(!p.data?.active)return reply({ok:true,enabled:false});product_name=p.data.name;}return reply({ok:true,enabled:location.published&&s.enabled&&!!Deno.env.get('RESEND_API_KEY'),kind:s.kind,amount:s.amount,minimum:s.minimum,valid_days:s.valid_days,product_name});}
  if(b.action==='reviews'){
   if(!s.google_api_key||!s.google_place_id)return reply({ok:false,configured:false});
   const r=await fetch('https://places.googleapis.com/v1/places/'+encodeURIComponent(s.google_place_id)+'?languageCode=nl',{headers:{'X-Goog-Api-Key':s.google_api_key,'X-Goog-FieldMask':'displayName,rating,userRatingCount,reviews,googleMapsUri'},signal:AbortSignal.timeout(10000)});
   if(!r.ok)return reply({ok:false,configured:true,error:'Google-reviews konden niet worden opgehaald. Controleer Places API en de sleutel.'},502);
   const d=await r.json();return reply({ok:true,configured:true,name:d.displayName?.text,rating:d.rating,count:d.userRatingCount,url:d.googleMapsUri,reviews:(d.reviews||[]).map((x:any)=>({name:x.authorAttribution?.displayName,author_url:x.authorAttribution?.uri,rating:x.rating,text:x.text?.text,date:x.relativePublishTimeDescription,url:x.googleMapsUri}))});
  }
  if(b.action==='confirm'){
   if(!/^[a-f0-9]{64}$/.test(String(b.token||'')))throw Error('Bevestigingslink ongeldig');
   const r=await db.rpc('mtf_confirm_coupon',{p_hash:await hash(b.token),p_code:'MTF-'+random().slice(0,16).toUpperCase()});if(r.error)throw Error(r.error.message);return reply({ok:true,coupon:r.data});
  }
  if(b.action==='unsubscribe'){
   if(!/^[a-f0-9]{64}$/.test(String(b.token||'')))throw Error('Link ongeldig');
   const r=await db.from('mtf_coupon_members').update({subscribed:false}).eq('unsubscribe_hash',await hash(b.token));if(r.error)throw Error('Afmelden niet gelukt');return reply({ok:true});
  }
  if(b.action==='discount'&&String(b.code||'').trim().toUpperCase()==='WELKOM10'){
   if(!hasFeature(location,'welkom10'))throw Error('WELKOM10 is niet geldig bij deze vestiging.');
   const ip=await hash(req.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown');
   const rate=await db.rpc('mtf_promotion_rate',{p_bucket:'welkom10:'+ip,p_limit:60});if(rate.error||!rate.data)throw Error('Te veel controles. Probeer het later opnieuw.');
   const items=Array.isArray(b.items)?b.items:[];if(!items.length||items.length>50)throw Error('Voeg eerst gerechten toe aan je mandje.');
   const ids=[...new Set(items.flatMap((x:any)=>[String(x.id||''),...(x.side_id?[String(x.side_id)]:[])]))];
   const addonIds=[...new Set(items.map((x:any)=>x.addon_id).filter(Boolean))];
   const m=await db.from('menu_items').select('id,name,price,active,category,deleted_at,spice_enabled').in('id',ids).eq('active',true).is('deleted_at',null);if(m.error)throw m.error;
   const a=addonIds.length?await db.from('mtf_addons').select('*,categories:mtf_addon_categories(category_name),source:menu_items(active,deleted_at)').in('id',addonIds):{data:[],error:null};if(a.error)throw a.error;
   const cats=await db.from('mtf_menu_categories').select('name,allows_sides,is_side');if(cats.error)throw cats.error;
   const normalized=normalizeAddonItems(items,m.data,a.data,cats.data);const subtotal=normalized.reduce((v:number,x:any)=>v+Math.round(x.price*100)*x.qty,0)/100;
   const r=await db.rpc('mtf_welkom10_check',{p_email:String(b.email||'').slice(0,254),p_phone:String(b.phone||'').slice(0,50),p_name:String(b.name||'').slice(0,150),p_subtotal:subtotal});if(r.error)throw Error(r.error.message);return reply({ok:true,discount:Number(r.data)});
  }
  if(b.action==='discount'){
   const subtotal=Number(b.subtotal);if(!Number.isFinite(subtotal)||subtotal<0||subtotal>100000)throw Error('Ongeldig bedrag');
   const r=await db.rpc('mtf_coupon_discount_items',{p_code:String(b.code||'').slice(0,80),p_email:String(b.email||'').toLowerCase().trim().slice(0,254),p_subtotal:subtotal,p_items:Array.isArray(b.items)?b.items.slice(0,50).map((x:any)=>({id:String(x.id),qty:Number(x.qty)})):[]});if(r.error)throw Error(r.error.message);return reply({ok:true,discount:Number(r.data)});
  }
  if(b.action!=='signup')throw Error('Onbekende actie');
  if(!location.published)throw Error('Deze vestiging is nog niet geopend');
  if(!s.enabled)throw Error('De couponactie is momenteel niet actief');
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('E-mail is nog niet beschikbaar');
  const email=String(b.email||'').trim().toLowerCase();if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||b.consent!==true)throw Error('Vul je e-mailadres in en geef toestemming voor de couponmail');
  if(b.website)return reply({ok:true});
  const ip=await hash(req.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown');
  for(const [bucket,limit] of [['ip:'+ip,10],['email:'+await hash(email),3],['global',100]] as const){const r=await db.rpc('mtf_promotion_rate',{p_bucket:bucket,p_limit:limit});if(r.error||!r.data)throw Error('Probeer het later nog eens.');}
  const existing=await db.from('mtf_coupon_members').select('confirmed_at,requested_at,mail_status').eq('email',email).maybeSingle();if(existing.error)throw existing.error;
  // Zelfde antwoord voor bestaande adressen: geen adressen raden en geen herhaalde coupons.
  if(existing.data?.confirmed_at||existing.data&&Date.now()-Date.parse(existing.data.requested_at)<60000)return reply({ok:true});
  const token=random(),unsub=random();const row={email,token_hash:await hash(token),unsubscribe_hash:await hash(unsub),token_expires:new Date(Date.now()+86400000).toISOString(),requested_at:new Date().toISOString(),consent_text:consent,mail_status:'pending'};
  const saved=await db.from('mtf_coupon_members').upsert(row,{onConflict:'email'});if(saved.error)throw saved.error;
  const url=brand.siteUrl+'/coupon?location='+location.slug+'#confirm='+token,unsubUrl=brand.siteUrl+'/coupon?location='+location.slug+'#unsubscribe='+unsub;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'coupon-confirm-'+row.token_hash},body:JSON.stringify({from:brand.mailName+' <'+brand.mailFrom+'>',to:[email],subject:'Bevestig je e-mailadres voor jouw '+brand.name+'-coupon',text:`Je hebt een coupon aangevraagd bij ${brand.name}. Bevestig je e-mailadres: ${url}\nDe link is 24 uur geldig. Geen aanvraag gedaan? Negeer deze mail.\nAfmelden: ${unsubUrl}`,html:`<!doctype html><html lang="nl"><body style="font-family:Arial;color:#202330;padding:24px"><h1>Jouw aanmeldcoupon</h1><p>Bevestig je e-mailadres om jouw persoonlijke coupon te ontvangen.</p><p><a style="display:inline-block;background:${brand.color};color:white;padding:15px 22px;border-radius:8px" href="${url}">E-mailadres bevestigen</a></p><p>Deze link is 24 uur geldig. Je hoeft geen review te schrijven.</p><p>Niet aangevraagd? Negeer deze mail.</p><p><a href="${unsubUrl}">Afmelden voor de couponactie</a></p><p>${brand.name} · ${brand.address}<br>${brand.replyTo}</p></body></html>`}),signal:AbortSignal.timeout(10000)});
  await db.from('mtf_coupon_members').update({mail_status:r.ok?'sent':'failed'}).eq('email',email).eq('token_hash',row.token_hash);
  if(!r.ok)throw Error('De bevestigingsmail kon niet worden verstuurd. Probeer later opnieuw.');return reply({ok:true});
 }catch(e){return reply({ok:false,error:e instanceof Error?e.message:'Verzoek mislukt'},400);}
});
