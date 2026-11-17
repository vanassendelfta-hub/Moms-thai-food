import { scopedDb } from "./locations.ts";
import { processMail } from "./portal.ts";
const statuses=['Open','In uitvoering','Afgerond','Geannuleerd'];
const uuid=(x:any)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
async function checked(q:any){const r=await q;if(r.error)throw r.error;return r;}
export async function taskAdmin(db:any,body:any,actor:any){
 if(!String(body.action||'').startsWith('task_'))return null;
 if(!actor.owner&&!uuid(actor.user_id))throw Error('Log in met je persoonlijke account');
 if(body.action==='task_summary'){if(actor.global_owner&&db.root){const locations=(await checked(db.root.from('mtf_locations').select('*'))).data;const summaries=await Promise.all(locations.map(async(l:any)=>{const r=await checked(scopedDb(db.root,l).rpc('mtf_task_summary',{p_actor:actor.user_id||null,p_owner:true}));return {...r.data,upcoming:(r.data.upcoming||[]).map((t:any)=>({...t,location_slug:l.slug,location_name:l.name}))};}));return {summary:{total:summaries.reduce((s:number,x:any)=>s+Number(x.total),0),overdue:summaries.reduce((s:number,x:any)=>s+Number(x.overdue),0),upcoming:summaries.flatMap((x:any)=>x.upcoming).sort((a:any,b:any)=>a.deadline.localeCompare(b.deadline)||a.id.localeCompare(b.id)).slice(0,3)}};}const r=await checked(db.rpc('mtf_task_summary',{p_actor:actor.user_id||null,p_owner:actor.owner===true}));return {summary:r.data};}
 if(body.action==='task_users'){return {users:(await checked(db.from('mtf_staff').select('user_id,name,email').eq('active',true).order('name').order('email'))).data};}
 if(body.action==='task_list'){
  const page=Number(body.page??0);if(!Number.isInteger(page)||page<0||page>10000)throw Error('Ongeldige pagina');
  const filter=body.status||'active';if(!['all','active',...statuses].includes(filter))throw Error('Ongeldige statusfilter');
  let q=db.from('mtf_tasks').select('*,assignees:mtf_task_assignees(user_id,person:mtf_staff(name,email,active))',{count:'exact'});
  if(!actor.owner){const ids=(await checked(db.from('mtf_task_assignees').select('task_id').eq('user_id',actor.user_id))).data.map((x:any)=>x.task_id);q=ids.length?q.or('created_by.eq.'+actor.user_id+',id.in.('+ids.join(',')+')'):q.eq('created_by',actor.user_id);}
  if(filter==='active')q=q.in('status',['Open','In uitvoering']);else if(filter!=='all')q=q.eq('status',filter);
  const r=await checked(q.order('deadline').order('created_at').order('id').range(page*50,page*50+49));return {tasks:r.data,total:r.count,page};
 }
 if(body.action==='task_save'||body.action==='task_status'){
  const edit=body.action==='task_save';if(body.id&&!uuid(body.id))throw Error('Ongeldige taak');if(!edit&&!uuid(body.id))throw Error('Ongeldige taak');
  if(body.id&&(!body.version||!Number.isFinite(Date.parse(body.version))))throw Error('Vernieuw de taak en probeer opnieuw');
  if(edit){if(typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>150)throw Error('Vul een titel in van maximaal 150 tekens');if(typeof body.information!=='string'||body.information.length>5000)throw Error('De informatie mag maximaal 5000 tekens bevatten');if(!/^\d{4}-\d{2}-\d{2}$/.test(body.deadline||'')||new Date(body.deadline+'T12:00:00Z').toISOString().slice(0,10)!==body.deadline)throw Error('Kies een geldige deadline');if(!Array.isArray(body.assignees)||!body.assignees.length||body.assignees.length>100||body.assignees.some((id:any)=>!uuid(id))||new Set(body.assignees).size!==body.assignees.length)throw Error('Kies één of meerdere verschillende gebruikers');}
  else if(!statuses.includes(body.status))throw Error('Ongeldige taakstatus');
  const r=await checked(db.rpc('mtf_task_write',{p_mode:edit?'save':'status',p_id:body.id||null,p_actor:actor.user_id||null,p_owner:actor.owner===true,p_title:edit?body.title.trim():null,p_information:edit?body.information.trim():null,p_deadline:edit?body.deadline:null,p_assignees:edit?body.assignees:null,p_status:edit?null:body.status,p_version:body.id?body.version:null}));
  if(!edit)return {id:r.data};
  // The assignment trigger persists every email atomically with the task.
  // Attempt the first few immediately; the existing worker drains the queue.
  try{const jobs=await checked(db.from('mtf_mail_jobs').select('id').eq('kind','task').eq('payload->>task_id',r.data).in('status',['pending','failed']).lt('attempts',5).order('created_at').limit(5));const mail=await Promise.allSettled(jobs.data.map((j:any)=>processMail(db,j.id)));return {id:r.data,mail:mail.every((x:any)=>x.status==='fulfilled'&&['sent','cancelled'].includes(x.value.status))?'processed':'queued'};}catch{return {id:r.data,mail:'queued'};}
 }
 throw Error('Onbekende taakactie');
}
