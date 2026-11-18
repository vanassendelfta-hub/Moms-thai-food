/* Winkelmandje en prijsberekening, los van de weergave.
   Rekent in centen; bezorgregels komen uit MTFOrderRules (order-rules.js).
   Laad na order-rules.js en vóór app.js. */
(function(){
 const MTF=window.MTF=window.MTF||{};
 const MAX_PER_ITEM=50;
 const cents=v=>Math.round(Number(v)*100);
 const rules=()=>window.MTFOrderRules;

 /* Unieke sleutel van een regel: gerecht + extra + bijgerecht + pittigheid. */
 const key=x=>JSON.stringify([x.id,x.addon_id||null,x.side_id||null,x.spice_level||0]);

 /* Maak een mandjesregel van een gerecht met optionele extra, bijgerecht en pittigheid. */
 function line(m,extra,qty=1,side=null,spice=0){
  return {...m,base_name:m.name,base_price:Number(m.price),
   name:m.name+(side?' + '+side.name:'')+(extra?' + '+extra.name:'')+(spice?' · Pittigheid: '+spice+' chili'+(spice===1?'':'’s'):''),
   addon_id:extra?.id||null,addon_name:extra?.name||null,addon_price:extra?Number(extra.price):0,
   side_id:side?.id||null,side_name:side?.name||null,side_price:side?Number(side.price):0,
   spice_level:spice,
   price:(cents(m.price)+(extra?cents(extra.price):0)+(side?cents(side.price):0))/100,
   qty};
 }

 const count=lines=>lines.reduce((t,x)=>t+x.qty,0);
 const subtotalCents=lines=>lines.reduce((sum,x)=>sum+cents(x.price)*x.qty,0);

 /* Mag er nog één bij? Maximaal 50 per gerecht, bijgerechten tellen mee. */
 function canIncrease(lines,l){
  const totals=new Map();
  for(const x of [...lines,{...l,qty:1}])for(const id of [x.id,x.side_id].filter(Boolean))totals.set(id,(totals.get(id)||0)+x.qty);
  return [...totals.values()].every(n=>n<=MAX_PER_ITEM);
 }

 /* Wat de server nodig heeft om de bestelling te plaatsen. */
 const items=lines=>lines.map(x=>({id:x.id,qty:x.qty,addon_id:x.addon_id||null,side_id:x.side_id||null,spice_level:x.spice_level||0}));

 function load(storageKey){
  try{
   const c=JSON.parse(localStorage.getItem(storageKey)||'[]');
   if(!Array.isArray(c))return [];
   return c.filter(x=>x&&typeof x.id==='string'&&Number.isInteger(x.qty)&&x.qty>0&&x.qty<=MAX_PER_ITEM);
  }catch{return [];}
 }
 function save(storageKey,lines){
  try{localStorage.setItem(storageKey,JSON.stringify(lines.map(x=>({id:x.id,addon_id:x.addon_id||null,side_id:x.side_id||null,spice_level:x.spice_level||0,qty:x.qty,name:x.name,price:x.price,image_url:x.image_url}))));}catch{}
 }

 /* Prijsoverzicht voor afrekenen. error bevat de reden als bestellen zo niet kan (bijv. onder het minimum). */
 function quote(lines,method){
  const R=rules(),sub=subtotalCents(lines),fee=R.deliveryFeeCents(sub,method);
  let error='';try{R.price(sub,method);}catch(e){error=e.message;}
  return {subtotalCents:sub,deliveryCents:fee,totalCents:sub+fee,toFreeDeliveryCents:fee?R.delivery.freeFromCents-sub:0,error};
 }

 MTF.cart=Object.freeze({MAX_PER_ITEM,key,line,count,subtotalCents,canIncrease,items,load,save,quote});
})();
