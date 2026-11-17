/* Gedeelde bestelregels voor browser en server. Tijdzone: Nederland. */
(function(root){
 function create(){
 let closures=new Map();
 const setClosures=rows=>{closures=new Map(rows.map(x=>[x.day,x.reason]));};
 const closedReason=date=>closures.get(date)||'';
 /* Standaardtijden (in minuten) tot de database ze levert via setHours(). Weekdag: 0 = zondag … 6 = zaterdag. */
 let hours={1:[960,1230],2:[960,1230],4:[960,1230],5:[960,1260],0:[960,1230]};
 /* Uiterste besteltijd voor dezelfde dag, in minuten. Vrijdag (5) en zondag (0): 19:30, overige open dagen: 18:00. */
 let cutoffs={5:1170,0:1170},defaultCutoff=1080;
 /* Openingstijden uit de database: [{weekday, open_time:'16:00:00', close_time, order_cutoff}]. */
 const toMin=t=>{const m=/^(\d{1,2}):(\d{2})/.exec(String(t||''));return m?Number(m[1])*60+Number(m[2]):NaN;};
 function setHours(rows){
  if(!Array.isArray(rows))return false;
  const h={},c={};
  for(const r of rows){const d=Number(r.weekday),o=toMin(r.open_time),cl=toMin(r.close_time),cu=toMin(r.order_cutoff);if(!Number.isInteger(d)||d<0||d>6||![o,cl,cu].every(Number.isFinite)||o>=cl)return false;h[d]=[o,cl];c[d]=cu;}
  hours=h;cutoffs=c;return true;
 }
 const dayNames=['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
 /* Bijvoorbeeld: 'maandag, dinsdag, donderdag, vrijdag of zondag' (week begint op maandag). Met word='en': '… vrijdag en zondag'. */
 function openDaysText(word='of'){const days=[1,2,3,4,5,6,0].filter(d=>hours[d]).map(d=>dayNames[d]);return days.length>1?days.slice(0,-1).join(', ')+' '+word+' '+days.at(-1):(days[0]||'');}
 function cutoff(date){const d=new Date(String(date)+'T12:00:00Z');if(!Number.isFinite(d.getTime()))return defaultCutoff;return cutoffs[d.getUTCDay()]??defaultCutoff;}
 function clock(now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,seconds:Number(p.hour)*3600+Number(p.minute)*60+Number(p.second)};
 }
 function opening(date){
  if(closures.has(date))return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))return null;
  const d=new Date(date+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)return null;
  return hours[d.getUTCDay()]||null;
 }
 function validateMoment(date,time,now=new Date()){
  const c=clock(now),h=opening(date);
  if(closedReason(date))throw Error('Op deze dag zijn we gesloten: '+closedReason(date));
  if(!h)throw Error('Kies '+openDaysText()+' voor afhalen of bezorgen.');
  if(date<c.date)throw Error('Kies een datum in de toekomst.');
  if(date===c.date&&c.seconds>cutoff(date)*60)throw Error('Na '+formatTime(cutoff(date))+' kun je alleen voor een volgende openingsdag bestellen.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time)))throw Error('Kies een geldig afhaal- of bezorgmoment.');
  const [hour,minute]=time.split(':').map(Number),m=hour*60+minute;
  if(m%15!==0)throw Error('Kies een tijdvak van een kwartier.');
  if(m<h[0]||m>h[1])throw Error('Het afhaal- of bezorgmoment moet binnen de openingstijden vallen.');
  if(date===c.date&&m*60<=c.seconds)throw Error('Kies een afhaal- of bezorgmoment dat nog in de toekomst ligt.');
  return true;
 }
 function price(subtotalCents,method){
  if(!Number.isSafeInteger(subtotalCents)||subtotalCents<0)throw Error('Ongeldig bestelbedrag.');
  if(!['Afhalen','Bezorgen'].includes(method))throw Error('Kies afhalen of bezorgen.');
  if(method==='Bezorgen'&&subtotalCents<2000)throw Error('Voor bezorgen geldt een minimale bestelwaarde van € 20,00, exclusief bezorgkosten.');
  const deliveryCents=method==='Bezorgen'&&subtotalCents<3500?250:0;
  return {subtotal:subtotalCents/100,delivery_fee:deliveryCents/100,total:(subtotalCents+deliveryCents)/100};
 }
 function nextDate(now=new Date()){
  const c=clock(now),d=new Date(c.date+'T12:00:00Z');
  for(let i=0;i<366;i++){const date=d.toISOString().slice(0,10);if(opening(date)&&(date!==c.date||c.seconds<=cutoff(date)*60))return date;d.setUTCDate(d.getUTCDate()+1);}
 }
 const formatTime=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
 return {clock,opening,validateMoment,price,nextDate,formatTime,setClosures,closedReason,cutoff,setHours,openDaysText,weekHours:()=>JSON.parse(JSON.stringify({hours,cutoffs}))};
 }
 root.MTFOrderRules=Object.assign(create(),{create});
})(globalThis);
