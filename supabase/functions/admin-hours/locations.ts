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
