const uuid=(x:any)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
export function normalizeAddonItems(items:any[],menu:any[],addons:any[],categories:any[]=[]){
 if(!Array.isArray(items)||!items.length||items.length>50)throw Error('Kies één of meerdere gerechten (maximaal 50 regels)');
 const merged=new Map(),totals=new Map();
 for(const item of items){const id=typeof item?.id==='string'?item.id:'',qty=Number(item?.qty),addonId=item?.addon_id||null;if(!id||!Number.isInteger(qty)||qty<1||qty>50||addonId!==null&&!uuid(addonId))throw Error('Ongeldige bestelregel of extra');
  const m=menu.find(x=>x.id===id&&x.active&&!x.deleted_at);if(!m)throw Error('Een gerecht is niet meer beschikbaar. Vernieuw het menu.');
  let addon=null;if(addonId){addon=addons.find(a=>a.id===addonId&&a.active&&!a.deleted_at);if(!addon||!addon.categories?.some((c:any)=>c.category_name===m.category)||(addon.menu_item_id&&(!addon.source?.active||addon.source.deleted_at)))throw Error('Deze extra is niet beschikbaar bij '+m.name+'. Vernieuw het menu.');}
  const sideId=item?.side_id||null,spice=item?.spice_level??0;if(sideId!==null&&typeof sideId!=='string')throw Error('Ongeldig bijgerecht');if(typeof spice!=='number'||!Number.isInteger(spice)||spice<0||spice>3||spice>0&&!m.spice_enabled)throw Error('Ongeldige pittigheid voor '+m.name);let side=null;if(sideId){side=menu.find(x=>x.id===sideId&&x.active&&!x.deleted_at);if(!side||!categories.some(c=>c.name===m.category&&c.allows_sides)||!categories.some(c=>c.name===side.category&&c.is_side))throw Error('Dit bijgerecht is niet beschikbaar bij '+m.name);const sideQty=(totals.get(sideId)||0)+qty;if(sideQty>50)throw Error('Maximaal 50 stuks per gerecht, inclusief bijgerechten');totals.set(sideId,sideQty);}
  const quantity=(totals.get(id)||0)+qty;if(quantity>50)throw Error('Maximaal 50 stuks per gerecht, inclusief alle varianten');totals.set(id,quantity);
  const key=JSON.stringify([id,addonId,sideId,spice]);const existing=merged.get(key);if(existing){existing.qty+=qty;continue;}
  const sideCents=side?Math.round(Number(side.price)*100):0;if(!Number.isSafeInteger(sideCents)||sideCents<0)throw Error('Ongeldige menuprijs');const baseCents=Math.round(Number(m.price)*100),addonCents=addon?Math.round(Number(addon.price)*100):0;if(!Number.isSafeInteger(baseCents)||baseCents<0||!Number.isSafeInteger(addonCents)||addonCents<0)throw Error('Ongeldige menuprijs');
  merged.set(key,{id:m.id,name:m.name+(side?' + '+side.name:'')+(addon?' + '+addon.name:'')+(spice?' · Pittigheid: '+spice+' chili'+(spice===1?'':'’s'):''),side_id:sideId,side_name:side?.name||null,side_price:sideCents/100,spice_level:spice,base_name:m.name,base_price:baseCents/100,price:(baseCents+addonCents+sideCents)/100,qty,addon_id:addon?.id||null,addon_name:addon?.name||null,addon_price:addonCents/100});
 }
 return [...merged.values()];
}
