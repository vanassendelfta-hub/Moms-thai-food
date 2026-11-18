/* Sjablonen voor wat de klant ziet: gerechtkaarten, categorieën en mandjesregels.
   app.js bepaalt WAT er getoond wordt (welke gerechten, filters, aantallen);
   deze sjablonen bepalen HOE het eruitziet. Een restaurant met een eigen ontwerp
   vervangt één of meer sjablonen, bijvoorbeeld in een eigen script na dit bestand:

     MTF.templates.use({
       dishCard:(x,h)=>`<div class="mijn-kaart">…<button data-add="${h.esc(x.id)}">Bestel</button></div>`
     });

   Vaste afspraken (zie ELEMENT-CONTRACT.md):
   - een knop om te bestellen heeft data-add="<gerecht-id>";
   - mandjesknoppen hebben data-plus / data-minus / data-remove="<regelnummer>";
   - een categorieknop heeft data-cat="<categorie>".
   Elk sjabloon krijgt als laatste argument h = {esc, euro, photo}. Teksten altijd via h.esc. */
(function(){
 const MTF=window.MTF=window.MTF||{};
 const defaults={
  /* Favorietenkaart op de homepage. */
  favoriteCard:(x,h)=>`<article class="dish"><img class="dish-image" src="${h.esc(x.image_url||h.photo(x))}" alt="${h.esc(x.name)}"><div class="dish-desc"><h3>${h.esc(x.name.replace(/\*$/, ''))}</h3><p>${h.esc(x.description)}</p><div class="dish-footer"><b>${h.euro(x.price)}</b><button type="button" data-add="${h.esc(x.id)}" ${h.shopOpen?'':'disabled'}>＋ Toevoegen</button></div></div></article>`,
  /* Gerechtkaart op de menukaart. */
  dishCard:(x,h)=>{const im=x.image_url||h.photo(x);return `<article class="dish">${im?`<img class="dish-image" src="${im}" alt="">`:'<div class="dish-image fallback" aria-hidden="true">✺</div>'}<div class="dish-desc"><h4>${h.esc(x.name)}</h4><p>${h.esc(x.description)}</p><div class="dish-footer"><b>${h.euro(x.price)}</b><button type="button" data-add="${h.esc(x.id)}">＋ Toevoegen</button></div></div></article>`;},
  /* Categorieblok met de kaarten erin (cards is al opgebouwde HTML). */
  category:(name,note,cards,h)=>`<section class="category"><div class="cat-title"><h3>${h.esc(name)}</h3></div>${note?`<p class="category-note">${h.esc(note)}</p>`:''}<div class="menu-grid">${cards}</div></section>`,
  categoryPill:(name,active,h)=>`<button type="button" class="chip ${active?'active':''}" data-cat="${h.esc(name)}">${h.esc(name)}</button>`,
  menuEmpty:()=>'<p class="loading">Geen gerechten gevonden.</p>',
  /* Eén regel in het mandje; i is het regelnummer voor de knoppen. */
  cartLine:(x,i,h)=>{const img=x.image_url||h.photo(x);return `<div class="cart-line">${img?`<img src="${h.esc(img)}" alt="">`:''}<div class="cart-line-main"><strong>${h.esc(x.base_name||x.name)}</strong>${x.side_name?`<small class="cart-addon-label">Bijgerecht: ${h.esc(x.side_name)} (+ ${h.euro(x.side_price)})</small>`:''}${x.spice_level?`<small class="cart-addon-label">Pittigheid: ${'🌶️'.repeat(x.spice_level)} (${x.spice_level})</small>`:''}${x.addon_name?`<small class="cart-addon-label">+ ${h.esc(x.addon_name)} (${h.euro(x.addon_price)} per portie)</small>`:''}<small>${h.euro(x.price)} per stuk</small><div class="quantity"><button type="button" data-minus="${i}" aria-label="Eén minder">−</button>${x.qty}<button type="button" data-plus="${i}" aria-label="Eén meer">＋</button></div></div><button type="button" class="remove" data-remove="${i}" aria-label="Verwijder ${h.esc(x.name)}">×</button></div>`;},
  cartEmpty:()=>'<p style="color:#b5b8c6">Je winkelmandje is nog leeg.</p>'
 };
 const active={...defaults};
 MTF.templates={
  get:name=>active[name],
  /* Vervang sjablonen; onbekende namen worden geweigerd zodat een typfout opvalt. */
  use(overrides){for(const [k,fn] of Object.entries(overrides||{})){if(!(k in defaults))throw Error('Onbekend sjabloon: '+k);if(typeof fn!=='function')throw Error('Sjabloon '+k+' moet een functie zijn');active[k]=fn;}},
  reset(){Object.assign(active,defaults);},
  names:()=>Object.keys(defaults)
 };
})();
