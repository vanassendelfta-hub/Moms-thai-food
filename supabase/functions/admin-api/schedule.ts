export async function scheduleAdmin(db:any,body:any,actor:any){
 if(!String(body.action||'').startsWith('schedule_'))return null;
 if(!actor.owner&&!actor.permissions?.shop)throw Error('Geen rechten voor openingstijden');
 if(body.action==='schedule_list'){const r=await db.from('mtf_closed_dates').select('day,reason').order('day');if(r.error)throw r.error;return {closures:r.data};}
 const from=String(body.from||''),to=String(body.to||from);const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||to<from)throw Error('Kies een geldige begin- en einddatum');
 const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;if(days>366)throw Error('Kies maximaal 366 dagen per keer');
 if(body.action==='schedule_save'){
  const reason=String(body.reason||'').trim();if(!reason||reason.length>200)throw Error('Vul een reden in van maximaal 200 tekens');
  const rows=[];for(let i=0;i<days;i++){const d=new Date(from+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);rows.push({day:d.toISOString().slice(0,10),reason,updated_at:new Date().toISOString()});}
  const r=await db.from('mtf_closed_dates').upsert(rows,{onConflict:'day'});if(r.error)throw r.error;return {ok:true};
 }
 if(body.action==='schedule_delete'){const r=await db.from('mtf_closed_dates').delete().gte('day',from).lte('day',to);if(r.error)throw r.error;return {ok:true};}
 throw Error('Onbekende openingstijdenactie');
}
