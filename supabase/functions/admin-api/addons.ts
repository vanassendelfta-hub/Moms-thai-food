const uuid=(x:any)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
export async function addonAdmin(db:any,body:any,actor:any){
 if(!String(body.action||'').startsWith('addon_'))return null;
 if(!actor.owner&&!actor.permissions?.menu)throw Error('Geen rechten om extra’s te beheren');
 if(body.action==='addon_list'){const r=await db.from('mtf_addons').select('*,categories:mtf_addon_categories(category_name)').is('deleted_at',null).order('created_at').order('id');if(r.error)throw r.error;return {addons:actor.owner||actor.permissions?.costs?r.data:r.data.map(({cost,...a}:any)=>a)};}
 if(body.action==='addon_save'){
  const p=body.item||{},price=Number(p.price),costInput=p.cost===null||p.cost===''||p.cost===undefined?null:Number(p.cost);
  let cost=costInput;if(!actor.owner&&!actor.permissions?.costs){cost=null;if(p.id&&uuid(p.id)){const old=await db.from('mtf_addons').select('cost').eq('id',p.id).is('deleted_at',null).maybeSingle();if(old.error)throw old.error;cost=old.data?.cost??null;}}
  if(p.id&&!uuid(p.id))throw Error('Ongeldige extra');
  if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>100||!Number.isFinite(price)||price<0||price>1000||Math.abs(price*100-Math.round(price*100))>0.000001||typeof p.active!=='boolean'||(cost!==null&&(!Number.isFinite(cost)||cost<0)))throw Error('Controleer naam, prijs en kostprijs');
  if(!Array.isArray(p.categories)||p.categories.length<1||p.categories.length>100||p.categories.some((c:any)=>typeof c!=='string'||!c.trim())||new Set(p.categories).size!==p.categories.length)throw Error('Kies één of meerdere categorieën');
  const r=await db.rpc('mtf_save_addon',{p_id:p.id||null,p_name:p.name.trim(),p_price:price,p_cost:cost,p_menu_item_id:p.menu_item_id||null,p_active:p.active,p_categories:p.categories});if(r.error)throw r.error;return {id:r.data};
 }
 if(body.action==='addon_delete'){if(!uuid(body.id))throw Error('Ongeldige extra');const r=await db.from('mtf_addons').update({active:false,deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',body.id);if(r.error)throw r.error;return {ok:true};}
 throw Error('Onbekende actie voor extra’s');
}
