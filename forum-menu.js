/* Forum Cateringservice: eigen menukaart.
   Vervangt de standaardsjablonen (zie mtf-templates.js) door een klassieke Chinese menukaart:
   genummerde gerechten met prijs na een stippellijn, een index per groep en een schakelaar
   tussen normale en kleine porties. Laden ná mtf-templates.js en vóór app.js. */
(function(){
 const SMALL='Kleine porties – ';
 const isSmall=c=>c.startsWith(SMALL);
 const slug=c=>'cat-'+c.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 const label=c=>c.replace(SMALL,'').replace('Specialiteiten – ','');
 /* Groepen in de index, met een Chinees teken als zegel. */
 const group=c=>{const n=c.replace(SMALL,'');
  if(n.startsWith('Specialiteiten')||/stijl/.test(n))return['招','Huisspecialiteiten'];
  if(/^(Soepen|Voorgerechten|Specifieke)/.test(n))return['湯','Soepen & dim sum'];
  if(/^(Rijsttafels|Menu's|Kindermenu's|Indische)/.test(n))return['宴','Menu’s & rijsttafels'];
  if(/^(Bijgerechten|Diversen|Niet-Chinese)/.test(n))return['配','Erbij'];
  return['菜','Van de kaart'];};
 const split=name=>{const m=String(name).match(/^(\d+[a-z]?)\.\s*(.*)$/i);return m?[m[1],m[2]]:['',name];};
 let lastGroup='';
 MTF.templates.use({
  categoryPill:(name,active,h)=>{
   if(name==='Alles'){lastGroup='';return '';}
   const g=group(name),head=g[1]!==lastGroup?`<span class="fm-group" data-small="${isSmall(name)?1:0}"><i>${g[0]}</i>${h.esc(g[1])}</span>`:'';
   lastGroup=g[1];
   return `${head}<button type="button" class="fm-pill" data-cat="${h.esc(name)}" data-target="${slug(name)}" data-small="${isSmall(name)?1:0}">${h.esc(label(name))}</button>`;},
  category:(name,note,cards,h)=>{const g=group(name);return `<section class="fm-cat" id="${slug(name)}" data-small="${isSmall(name)?1:0}"><header class="fm-cat-head"><span class="fm-seal" aria-hidden="true">${g[0]}</span><div><small>${h.esc(isSmall(name)?'Kleine portie · '+g[1]:g[1])}</small><h3>${h.esc(label(name))}</h3>${note?`<p>${h.esc(note)}</p>`:''}</div></header><div class="fm-list">${cards}</div></section>`;},
  dishCard:(x,h)=>{const [no,name]=split(x.name);return `<article class="fm-dish">${no?`<span class="fm-no">${h.esc(no)}</span>`:'<span class="fm-no fm-no--x">·</span>'}<div class="fm-body"><div class="fm-line"><h4>${h.esc(name)}${x.spice_enabled?' <span class="fm-hot" title="Pittigheid naar keuze">辣</span>':''}</h4><i aria-hidden="true"></i><b>${h.euro(x.price)}</b></div>${x.description?`<p>${h.esc(x.description)}</p>`:''}</div><button type="button" class="fm-add" data-add="${h.esc(x.id)}" aria-label="${h.esc(name)} toevoegen">+</button></article>`;},
  menuEmpty:()=>'<p class="fm-empty">Geen gerechten gevonden. Probeer een ander woord of nummer.</p>'
 });
 /* Index: klik scrolt naar de categorie in plaats van te filteren. */
 document.addEventListener('click',e=>{const b=e.target.closest('.fm-pill');if(!b)return;e.stopPropagation();e.preventDefault();
  const t=document.getElementById(b.dataset.target);if(t)t.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});},true);
 /* Schakelaar normale / kleine porties. */
 function setPortion(small){document.body.classList.toggle('fm-small',small);document.querySelectorAll('[data-portion]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.portion==='small')===small)));try{sessionStorage.setItem('forum_portion',small?'small':'normal')}catch(e){}}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-portion]');if(b)setPortion(b.dataset.portion==='small');});
 document.addEventListener('DOMContentLoaded',()=>{const bar=document.querySelector('.topbar');if(bar){const fit=()=>document.body.style.setProperty('--fm-top',bar.offsetHeight+'px');fit();if('ResizeObserver' in window)new ResizeObserver(fit).observe(bar);}
  let s=false;try{s=sessionStorage.getItem('forum_portion')==='small'}catch(e){}setPortion(s);
  /* Actieve categorie in de index volgen tijdens scrollen. */
  if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>{es.forEach(en=>{if(!en.isIntersecting)return;document.querySelectorAll('.fm-pill').forEach(p=>{const on=p.dataset.target===en.target.id;p.classList.toggle('is-on',on);if(on&&matchMedia('(max-width:900px)').matches)p.scrollIntoView({block:'nearest',inline:'center'});});});},{rootMargin:'-40% 0px -55% 0px'});
   new MutationObserver(()=>{io.disconnect();document.querySelectorAll('.fm-cat').forEach(s=>io.observe(s));}).observe(document.getElementById('menuGrid'),{childList:true});}
 });
})();
