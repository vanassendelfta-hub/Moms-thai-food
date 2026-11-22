export const locationSchemas:Record<string,string>={'spijkenisse':'public','oud-beijerland':'mtf_ob'};
export async function checked(q:any){const r=await q;if(r.error)throw r.error;return r.data;}
export function scopedDb(root:any,l:any){const db=l.schema_name==='public'?root:root.schema(l.schema_name);return {from:(t:string)=>db.from(t),rpc:(n:string,p:any)=>db.rpc(n,p),auth:root.auth,storage:root.storage,location:l,root};}

export async function authorizedService(req:Request){
 const key=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!key||key.length>5000)return false;
 if(key===Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))return true;
 // Rotated/older valid service credentials are verified by the Data API.
 // Anonymous and personal accounts cannot read this private registry.
 try{const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/mtf_locations?select=slug&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(5000)});if(!r.ok)return false;const d=await r.json();return Array.isArray(d)&&d.length===1&&Object.hasOwn(locationSchemas,d[0].slug);}catch{return false;}
}
