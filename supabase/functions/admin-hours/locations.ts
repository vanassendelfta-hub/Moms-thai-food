export const locationSchemas:Record<string,string>={'spijkenisse':'public','oud-beijerland':'mtf_ob'};
export async function checked(q:any){const r=await q;if(r.error)throw r.error;return r.data;}
export function publicLocation(l:any){return {slug:l.slug,name:l.name,address:l.address,order_email:l.order_email,published:l.published,mailbox_ready:l.mailbox_ready,delivery_limit_m:l.delivery_limit_m,routing_configured:!!l.routing_api_key};}
export async function getLocation(root:any,slug:any='spijkenisse'){
 if(!Object.hasOwn(locationSchemas,slug))throw Error('Onbekende vestiging');const l=await checked(root.from('mtf_locations').select('*').eq('slug',slug).single());
 if(l.schema_name!==locationSchemas[l.slug])throw Error('Ongeldige vestigingsconfiguratie');return l;
}
export function scopedDb(root:any,l:any){const db=l.schema_name==='public'?root:root.schema(l.schema_name);return {from:(t:string)=>db.from(t),rpc:(n:string,p:any)=>db.rpc(n,p),auth:root.auth,storage:root.storage,location:l,root};}
export async function selectAdminLocation(root:any,body:any,user:any,legacy=false){
 const all=await checked(root.from('mtf_locations').select('*').order('created_at').order('slug'));
 const memberships=legacy?[]:await Promise.all(all.map(async(l:any)=>({location:l,member:await checked(scopedDb(root,l).from('mtf_staff').select('*').eq('user_id',user.id).maybeSingle())})));
 const primary=memberships.find((x:any)=>x.location.slug==='spijkenisse')?.member;
 if(primary?.owner&&!primary.active)throw Error('Account heeft geen toegang');
 const owner=legacy||!!(primary?.owner&&primary.active);
 const allowed=owner?all:memberships.filter((x:any)=>x.member?.active).map((x:any)=>x.location);
 if(!allowed.length)throw Error('Account heeft geen toegang');
 let selected=allowed.find((l:any)=>l.slug===(body.location||'spijkenisse'));
 if(!selected){if(body.action==='whoami')selected=allowed[0];else throw Error('Geen toegang tot deze vestiging');}
 const db=scopedDb(root,selected);let actor:any;
 if(legacy)actor={owner:true,legacy:true,permissions:{}};
 else if(owner){actor={...primary,owner:true};if(selected.slug!=='spijkenisse')await checked(db.from('mtf_staff').upsert({user_id:primary.user_id,email:primary.email,name:primary.name,owner:true,active:true,permissions:primary.permissions}));if(!primary.claimed_at)await checked(root.from('mtf_staff').update({claimed_at:new Date().toISOString()}).eq('user_id',user.id));}
 else actor={...memberships.find((x:any)=>x.location.slug===selected.slug).member,owner:false};
 actor.global_owner=owner;actor.location=publicLocation(selected);actor.locations=allowed.map(publicLocation);return {db,actor};
}
