export async function menuCategoryAdmin(db:any,body:any,actor:any){
 if(!String(body.action||'').startsWith('menu_category_'))return null;
 if(!actor.owner&&!actor.permissions?.menu)throw Error('Geen rechten voor menucategorieën');
 if(body.action==='menu_category_list'){const r=await db.from('mtf_menu_categories').select('name,sort_order,note').order('sort_order').order('name');if(r.error)throw r.error;return {categories:r.data};}
 if(body.action==='menu_category_reorder'){
  if(!Array.isArray(body.categories)||!Array.isArray(body.items))throw Error('Ongeldige menuvolgorde');
  const r=await db.rpc('mtf_save_menu_order',{categories:body.categories,items:body.items});if(r.error)throw r.error;return {saved:true};
 }
 if(body.action==='menu_category_save'){
  const name=String(body.name||'').trim(),original=String(body.original||'').trim();if(!name||name.length>80)throw Error('Vul een categorienaam in van maximaal 80 tekens');
  if(body.note!==undefined&&(typeof body.note!=='string'||body.note.trim().length>500))throw Error('De opmerking mag maximaal 500 tekens bevatten');
  const changes={name,...(body.note!==undefined?{note:body.note.trim()}:{})};
  const r=original?await db.from('mtf_menu_categories').update(changes).eq('name',original).select('name,note').single():await db.from('mtf_menu_categories').insert(changes).select('name,note').single();
  if(r.error){if(r.error.code==='23505')throw Error('Deze categorie bestaat al. Kies een andere naam.');throw r.error;}return {category:r.data};
 }
 throw Error('Onbekende categorieactie');
}
