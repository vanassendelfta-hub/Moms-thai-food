import {materials} from "./materials.ts";
export async function seasonalAdmin(db:any,b:any,actor:any){
 if(!String(b.action||'').startsWith('seasonal_'))return null;
 if(!actor.owner)throw Error('Alleen de eigenaar kan feestdagenacties beheren.');
 if(db.location?.slug!=='spijkenisse')throw Error('Feestdagenacties zijn ingesteld voor Spijkenisse.');
 if(b.action==='seasonal_material'){if(!['team','plan'].includes(b.kind))throw Error('Onbekend materiaal');return {data:materials[b.kind as keyof typeof materials]};}
 if(b.action==='seasonal_contacts'){
 const c=await db.from('mtf_contacts').select('email,name,phone,source,status,created_at,confirmed_at').order('created_at',{ascending:false}).limit(10000);if(c.error)throw c.error;
 const campaigns=await db.from('mtf_marketing_campaigns').select('*').order('created_at',{ascending:false}).limit(50);if(campaigns.error)throw campaigns.error;
 const mails=await db.from('mtf_mail_jobs').select('id,status,kind,last_error,created_at,payload').in('kind',['marketing','marketing_confirm']).order('created_at',{ascending:false}).limit(1000);if(mails.error)throw mails.error;
 return {contacts:c.data,campaigns:campaigns.data,mails:mails.data};
 }
 if(b.action==='seasonal_campaign_save'){
 const subject=String(b.subject||'').trim().replace(/[\r\n]/g,' ').slice(0,150),body=String(b.body||'').trim().slice(0,20000);if(!subject||!body)throw Error('Onderwerp en bericht zijn verplicht.');
 const r=await db.from('mtf_marketing_campaigns').insert({subject,body}).select().single();if(r.error)throw r.error;return {campaign:r.data};
 }
 if(b.action==='seasonal_campaign_send'){
 if(b.confirm!==true)throw Error('Bevestig de verzending.');const r=await db.rpc('mtf_marketing_queue',{p_id:b.id});if(r.error)throw r.error;return {queued:r.data};
 }
 if(b.action==='seasonal_winter_save'){if(typeof b.visible!=='boolean'||typeof b.enabled!=='boolean')throw Error('Ongeldige instelling.');const r=await db.from('mtf_campaign_controls').update({visible:b.visible,enabled:b.enabled}).eq('id','winter');if(r.error)throw r.error;return {ok:true};}
 if(b.action==='seasonal_get'){
  const e=await db.from('mtf_seasonal_events').select('*').order('event_date');if(e.error)throw e.error;
  const events=await Promise.all(e.data.map(async(x:any)=>{const n=await db.rpc('mtf_seasonal_used',{p_event:x.id});if(n.error)throw n.error;return {...x,used:n.data};}));
  const menu=await db.from('menu_items').select('id,name,price,active').eq('active',true).is('deleted_at',null).order('name');if(menu.error)throw menu.error;
  const vouchers=await db.from('mtf_newyear_vouchers').select('code,order_id,email_key,percent,valid_from,valid_until,disabled,redeemed_at').order('created_at',{ascending:false}).limit(100);if(vouchers.error)throw vouchers.error;
  const mails=await db.from('mtf_mail_jobs').select('id,to_email,status,last_error,created_at,payload').eq('kind','newyear').order('created_at',{ascending:false}).limit(100);if(mails.error)throw mails.error;
  const winter=await db.from('mtf_campaign_controls').select('*').eq('id','winter').single();if(winter.error)throw winter.error;const redemptions=await db.from('mtf_welkom10_redemptions').select('*').order('redeemed_at',{ascending:false}).limit(10000);if(redemptions.error)throw redemptions.error;return {events,winter:winter.data,winter_used:redemptions.data.length,menu:menu.data,vouchers:vouchers.data,mails:mails.data};
 }
 if(b.action==='seasonal_save'){
  const s=b.settings||{},n=(k:string)=>Number(s[k]);
  if(!['kerstavond-2026','eerste-kerstdag-2026','tweede-kerstdag-2026','sinterklaas-2026','oudejaar-2026'].includes(s.id))throw Error('Onbekende actie.');
  for(const [k,min,max,int] of [['surcharge_percent',0,100,false],['notice_days',0,365,true],['capacity',0,10000,true],['gift_qty',0,100,true],['voucher_percent',1,100,false]] as const)if(!Number.isFinite(n(k))||n(k)<min||n(k)>max||(int&&!Number.isInteger(n(k))))throw Error('Controleer '+k);
  if(typeof s.visible!=='boolean'||typeof s.enabled!=='boolean')throw Error('Controleer de zichtbaarheid.');
  const validTime=(t:any)=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t);
  if(!validTime(s.start_time)||!validTime(s.end_time)||!validTime(s.cutoff_time)||s.start_time>=s.end_time)throw Error('Controleer de tijdvakken.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s.voucher_from)||!/^\d{4}-\d{2}-\d{2}$/.test(s.voucher_until)||s.voucher_from>s.voucher_until)throw Error('Controleer de coupongeldigheid.');
  if(!Array.isArray(s.menu_ids)||s.menu_ids.length>200||s.menu_ids.some((x:any)=>typeof x!=='string'))throw Error('Ongeldige menuselectie.');
  const update={visible:s.visible,enabled:s.enabled,surcharge_percent:n('surcharge_percent'),notice_days:n('notice_days'),capacity:n('capacity'),gift_qty:n('gift_qty'),menu_ids:s.menu_ids,start_time:s.start_time,end_time:s.end_time,cutoff_time:s.cutoff_time,voucher_percent:n('voucher_percent'),voucher_from:s.voucher_from,voucher_until:s.voucher_until,updated_at:new Date().toISOString()};
  const r=await db.from('mtf_seasonal_events').update(update).eq('id',s.id);if(r.error)throw r.error;return {ok:true};
 }
 throw Error('Onbekende feestdagenactie.');
}

