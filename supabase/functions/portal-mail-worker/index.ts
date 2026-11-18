import { scopedDb, authorizedService } from "./locations.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { processMail } from "./portal.ts";
// Verwerkt de mailwachtrij (betaalverzoeken, uitnodigingen, taken, campagnes) van alle vestigingen.
Deno.serve(async(req:Request)=>{
 const json=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(req.method!=='POST')return json({error:'POST verplicht'},405);
 if(!key||!await authorizedService(req))return json({error:'Geen toegang'},403);
 const root=createClient(Deno.env.get('SUPABASE_URL')!,key);
 const locations=await root.from('mtf_locations').select('*').order('created_at');if(locations.error)return json({error:'Vestigingen niet beschikbaar'},500);
 const results=[];for(const location of locations.data||[]){const db=scopedDb(root,location);
 const reset=await db.from('mtf_mail_jobs').update({status:'failed',last_error:'Verwerking onderbroken; opnieuw proberen'}).eq('status','processing').lt('started_at',new Date(Date.now()-5*60*1000).toISOString());
 if(reset.error)return json({error:'Wachtrij niet beschikbaar'},500);
 const {data,error}=await db.from('mtf_mail_jobs').select('id').in('status',['pending','failed']).lt('attempts',5).gte('created_at',new Date(Date.now()-23*3600*1000).toISOString()).order('created_at').limit(10);
 if(error)return json({error:'Wachtrij niet beschikbaar'},500);
 for(const job of data||[])results.push(await processMail(db,job.id));
 }
 return json({ok:true,results});
});
