/* Hoofdpagina: tijdelijk blok "Nieuw gerecht" boven de combi-deals. Verdwijnt vanzelf na de einddatum. */
(()=>{
 const NIEUW={ids:['pad-mama-kip','pad-mama-garnalen'],tot:'2026-12-05T00:00:00+01:00'}; // zichtbaar t/m vrijdag 4 december 2026
 const sec=document.getElementById('nieuwGerecht'),grid=document.getElementById('nieuwGrid');if(!sec||!grid||typeof renderMenu!=='function')return;
 const draw=()=>{
  const list=typeof menu!=='undefined'?menu:[];
  const items=Date.now()<Date.parse(NIEUW.tot)?NIEUW.ids.map(id=>list.find(m=>m.id===id)).filter(Boolean):[];
  sec.hidden=!items.length;if(!items.length)return;
  grid.innerHTML=items.map(x=>`<article class="dish nieuw-dish"><span class="nieuw-label">Nieuw</span><img class="dish-image" src="${escapeHTML(x.image_url||photoFor(x)||'')}" alt="${escapeHTML(x.name)}"><div class="dish-desc"><h3>${escapeHTML(x.name)}</h3><p>${escapeHTML(x.description||'')}</p><div class="dish-footer"><b>${euro(x.price)}</b><button type="button" data-add="${escapeHTML(x.id)}" ${shopOpen?'':'disabled'}>＋ Toevoegen</button></div></div></article>`).join('');
  grid.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(b.dataset.add));
 };
 const orig=renderMenu;renderMenu=function(){const r=orig.apply(this,arguments);try{draw()}catch(e){console.warn(e)}return r};
 draw();
})();
