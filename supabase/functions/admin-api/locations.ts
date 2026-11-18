import {brand} from "./brand.ts";
/* Vestigingen komen uit public.mtf_locations. Eén vestiging is de hoofdvestiging (is_primary, schema public).
   Extra's per vestiging staan in features ('welkom10', 'seasonal', 'marketing'). */
const SLUG_RE=/^[a-z0-9]+(-[a-z0-9]+)*$/,SCHEMA_RE=/^(public|mtf_[a-z0-9_]{1,40})$/;
export const hasFeature=(l:any,f:string)=>Array.isArray(l?.features)&&l.features.includes(f);
export function orderNumber(l:any,raw:any){const n=Number(raw);if(!l?.order_prefix||(l.order_max!=null&&!(n<=l.order_max)))return String(raw??'');return l.order_prefix+String(raw??'').padStart(l.order_pad||0,'0');}
export async function checked(q:any){const r=await q;if(r.error)throw r.error;return r.data;}
export function publicLocation(l:any){return {slug:l.slug,name:l.name,address:l.address,order_email:l.order_email,published:l.published,mailbox_ready:l.mailbox_ready,delivery_limit_m:l.delivery_limit_m,routing_configured:!!l.routing_api_key};}
/* Zonder slug: de hoofdvestiging. */
export async function getLocation(root:any,slug:any=null){
 if(slug!=null&&slug!==''&&(typeof slug!=='string'||slug.length>40||!SLUG_RE.test(slug)))throw Error('Onbekende vestiging');
 const q=root.from('mtf_locations').select('*');const l=await checked(slug?q.eq('slug',slug).maybeSingle():q.eq('is_primary',true).maybeSingle());
 if(!l)throw Error('Onbekende vestiging');
 if(!SCHEMA_RE.test(l.schema_name)||(l.is_primary&&l.schema_name!=='public'))throw Error('Ongeldige vestigingsconfiguratie');return l;
}
export function scopedDb(root:any,l:any){const db=l.schema_name==='public'?root:root.schema(l.schema_name);return {from:(t:string)=>db.from(t),rpc:(n:string,p:any)=>db.rpc(n,p),auth:root.auth,storage:root.storage,location:l,root};}
export async function selectAdminLocation(root:any,body:any,user:any,legacy=false){
 const all=await checked(root.from('mtf_locations').select('*').order('created_at').order('slug'));
 const memberships=legacy?[]:await Promise.all(all.map(async(l:any)=>({location:l,member:await checked(scopedDb(root,l).from('mtf_staff').select('*').eq('user_id',user.id).maybeSingle())})));
 const primaryLocation=all.find((l:any)=>l.is_primary);const primary=memberships.find((x:any)=>x.location.is_primary)?.member;
 if(primary?.owner&&!primary.active)throw Error('Account heeft geen toegang');
 const owner=legacy||!!(primary?.owner&&primary.active);
 const allowed=owner?all:memberships.filter((x:any)=>x.member?.active).map((x:any)=>x.location);
 if(!allowed.length)throw Error('Account heeft geen toegang');
 let selected=allowed.find((l:any)=>l.slug===(body.location||primaryLocation?.slug));
 if(!selected){if(body.action==='whoami')selected=allowed[0];else throw Error('Geen toegang tot deze vestiging');}
 const db=scopedDb(root,selected);let actor:any;
 if(legacy)actor={owner:true,legacy:true,permissions:{}};
 else if(owner){actor={...primary,owner:true};if(!selected.is_primary)await checked(db.from('mtf_staff').upsert({user_id:primary.user_id,email:primary.email,name:primary.name,owner:true,active:true,permissions:primary.permissions}));if(!primary.claimed_at)await checked(root.from('mtf_staff').update({claimed_at:new Date().toISOString()}).eq('user_id',user.id));}
 else actor={...memberships.find((x:any)=>x.location.slug===selected.slug).member,owner:false};
 actor.global_owner=owner;actor.location=publicLocation(selected);actor.locations=allowed.map(publicLocation);return {db,actor};
}
export async function driveDistance(l:any,address:string){
 if(!l.routing_api_key)throw Error('De rijafstandcontrole voor deze vestiging is nog niet ingesteld. Bezorgen is nog niet beschikbaar.');
 const r=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':l.routing_api_key,'X-Goog-FieldMask':'routes.distanceMeters,geocodingResults.destination.partialMatch,geocodingResults.destination.geocoderStatus'},body:JSON.stringify({origin:{address:l.address+', Nederland'},destination:{address:address+', Nederland'},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',computeAlternativeRoutes:false,languageCode:'nl-NL',units:'METRIC'}),signal:AbortSignal.timeout(12000)});
 const d=await r.json();const partial=d.geocodingResults?.destination?.partialMatch;const distance=d.routes?.[0]?.distanceMeters;
 if(!r.ok||partial||!Number.isFinite(distance)||distance<0)throw Error('Het bezorgadres kon niet betrouwbaar via de autoroute worden gecontroleerd. Controleer straat, huisnummer, postcode en plaats.');
 return distance;
}
export async function verifiedSender(email:string){
 const key=Deno.env.get('RESEND_API_KEY');if(!key)return false;
 const r=await fetch('https://api.resend.com/domains',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});if(!r.ok)return false;
 const d=await r.json();return (d.data||[]).some((x:any)=>x.name===email.split('@')[1]&&x.status==='verified');
}
export async function locationAdmin(db:any,body:any,actor:any){
 if(!String(body.action||'').startsWith('location_'))return null;
 if(!actor.global_owner)throw Error('Alleen de eigenaar kan vestigingen beheren');
 const root=db.root;
 if(body.action==='location_overview'){
  const rows=await checked(root.from('mtf_locations').select('*').order('created_at').order('slug'));
  return {locations:await Promise.all(rows.map(async(l:any)=>{const scoped=scopedDb(root,l);const [orders,unpaid,tasks]=await Promise.all([scoped.from('orders').select('id',{count:'exact',head:true}).in('status',['Nieuw','In bereiding','Klaar','Onderweg']),scoped.from('orders').select('id',{count:'exact',head:true}).neq('payment_status','Betaald').neq('status','Geannuleerd'),scoped.from('mtf_tasks').select('id',{count:'exact',head:true}).in('status',['Open','In uitvoering'])]);for(const r of [orders,unpaid,tasks])if(r.error)throw r.error;return {...publicLocation(l),active_orders:orders.count||0,unpaid:unpaid.count||0,tasks:tasks.count||0};}))};
 }
 const l=await getLocation(root,body.slug||db.location.slug);
 if(body.action==='location_get')return {location:publicLocation(l)};
 if(body.action==='location_save'){
  if(l.is_primary)throw Error('De hoofdvestiging behoudt haar huidige instellingen');
  const update:any={mailbox_ready:body.mailbox_ready===true,published:body.published===true};
  if(body.routing_api_key!==undefined){if(typeof body.routing_api_key!=='string'||body.routing_api_key.length>300)throw Error('Ongeldige API-sleutel');if(body.routing_api_key.trim())update.routing_api_key=body.routing_api_key.trim();}
  if(body.clear_routing_key===true)update.routing_api_key='';
  if(update.published){if(!update.mailbox_ready||!(update.routing_api_key??l.routing_api_key))throw Error('Richt eerst de Hostnet-mailbox en rijafstandcontrole in');if(!await verifiedSender(l.order_email))throw Error('De afzender op '+brand.mailDomain+' is nog niet geverifieerd bij de maildienst');}
  const saved=await checked(root.from('mtf_locations').update(update).eq('slug',l.slug).select('*').single());return {location:publicLocation(saved)};
 }
 if(body.action==='location_test_route'){const distance=await driveDistance(l,l.address);return {ok:true,distance_m:distance};}
 if(body.action==='location_sender_check')return {verified:await verifiedSender(l.order_email)};
 throw Error('Onbekende vestigingsactie');
}

export async function authorizedService(req:Request){
 const key=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!key||key.length>5000)return false;
 if(key===Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))return true;
 // Rotated/older valid service credentials are verified by the Data API.
 // Anonymous and personal accounts cannot read this private registry.
 try{const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/mtf_locations?select=slug&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(5000)});if(!r.ok)return false;const d=await r.json();return Array.isArray(d)&&d.length===1&&typeof d[0].slug==='string'&&SLUG_RE.test(d[0].slug);}catch{return false;}
}
