/* Hoofdpagina: categorie Combi-deals boven de favorieten. Toont alle actieve gerechten uit die categorie; verborgen als er geen zijn. */
(()=>{
 const sec=document.getElementById('combiDeals'),grid=document.getElementById('dealsGrid');if(!sec||!grid||typeof renderMenu!=='function')return;
 const isDeal=x=>String(x.category||'').toLowerCase().replace(/[^a-z]/g,'')==='combideals';
 const draw=()=>{
  const items=(typeof menu!=='undefined'?menu:[]).filter(isDeal);
  sec.hidden=!items.length;if(!items.length)return;
  grid.innerHTML=items.map(x=>`<article class="dish"><img class="dish-image" src="${escapeHTML(x.image_url||photoFor(x)||'')}" alt="${escapeHTML(x.name)}"><div class="dish-desc"><h3>${escapeHTML(x.name)}</h3><p>${escapeHTML(x.description||'')}</p><div class="dish-footer"><b>${euro(x.price)}</b><button type="button" data-add="${escapeHTML(x.id)}" ${shopOpen?'':'disabled'}>＋ Toevoegen</button></div></div></article>`).join('');
  grid.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(b.dataset.add));
 };
 const orig=renderMenu;renderMenu=function(){const r=orig.apply(this,arguments);try{draw()}catch(e){console.warn(e)}return r};
 draw();
})();
