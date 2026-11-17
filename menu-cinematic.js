/* Mom's Thai Food – filmische menukaart ("Uit de keuken").
   Bouwt voort op app.js: gebruikt menu, add(), renderCart() enz. en verandert alleen de weergave.
   - Per categorie: meest bestelde gerechten eerst (live via mtf_dish_popularity), daarna de vaste volgorde.
   - Lijstknop en zoeken tonen een compacte lijst.
   - Stoom bij binnenkomst vanaf het titelscherm. */
(()=>{
 if(!document.body.classList.contains('mc')||typeof renderMenu!=='function'||!document.getElementById('menuGrid'))return;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const grid=$('#menuGrid'),search=$('#search'),pills=$('#pills'),listBtn=$('#mcList'),hero=$('#mcHero');
 let pop=new Map(),listMode=false,dishEls=[],catEls=[];

 /* hoogte van de kop, zodat de zoekbalk er netjes onder plakt */
 const topbar=document.querySelector('.topbar');
 const setTop=()=>document.documentElement.style.setProperty('--mc-top',(topbar&&getComputedStyle(topbar).position==='sticky'?topbar.offsetHeight:0)+'px');
 setTop();addEventListener('resize',setTop);if(topbar&&window.ResizeObserver)new ResizeObserver(setTop).observe(topbar);

 /* populariteit: meest bestelde eerst */
 const loc=(window.MTFLocation&&window.MTFLocation.slug)||SITE_CONFIG.defaultLocation;
 fetch(SUPA+'/rest/v1/rpc/mtf_dish_popularity',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({p_location:loc})})
  .then(r=>r.ok?r.json():[]).then(rows=>{if(Array.isArray(rows)&&rows.length){pop=new Map(rows.map(r=>[String(r.dish_id),Number(r.n)||0]));if(menu.length)renderMenu();}}).catch(()=>{});

 const catRank=c=>{const i=menuCategoryOrder.indexOf(c);return i<0?999999:i;};
 const categories=()=>[...new Set(menu.map(x=>x.category||'Overig'))].sort((a,b)=>catRank(a)-catRank(b));
 const dishesIn=c=>menu.map((x,i)=>[x,i]).filter(([x])=>(x.category||'Overig')===c).sort((a,b)=>(pop.get(b[0].id)||0)-(pop.get(a[0].id)||0)||a[1]-b[1]).map(a=>a[0]);
 const img=x=>x.image_url||photoFor(x);
 const needsChoice=m=>menuAddons.some(a=>a.categories.some(c=>c.category_name===m.category))||sideOptions(m).length>0||!!m.spice_enabled;

 renderMenu=function(){
  const q=(search?.value||'').trim().toLowerCase(),cats=categories();
  pills.innerHTML=cats.map((c,i)=>`<button type="button" class="chip" data-mc-cat="${i}">${escapeHTML(c)}</button>`).join('');
  if(listMode||q){
   grid.className='mc-list';
   const html=cats.map((c,ci)=>{const list=dishesIn(c).filter(x=>!q||x.name.toLowerCase().includes(q)||String(x.description||'').toLowerCase().includes(q));if(!list.length)return '';
    return `<h2 id="mc-cat-${ci}">${escapeHTML(c)}</h2>`+list.map(x=>`<div class="mc-row"><img src="${escapeHTML(img(x))}" alt="" loading="lazy"><div class="t"><b>${escapeHTML(x.name)}</b><small>${escapeHTML(x.description||'')}</small></div><span class="p">${euro(x.price)}</span><button type="button" class="mc-plus" data-add="${escapeHTML(x.id)}" aria-label="${escapeHTML(x.name)} toevoegen">+</button></div>`).join('');}).join('');
   grid.innerHTML=html||'<p class="mc-none">Geen gerechten gevonden.</p>';
   dishEls=[];catEls=[...grid.querySelectorAll('h2')];
  }else{
   grid.className='mc-scenes';let n=0;
   grid.innerHTML=cats.map((c,ci)=>{const list=dishesIn(c);if(!list.length)return '';const note=menuCategoryNotes.get(c);
    return `<section class="mc-cat" id="mc-cat-${ci}" data-ci="${ci}"><span class="mc-no">${String(ci+1).padStart(2,'0')} — ${list.length} ${list.length===1?'gerecht':'gerechten'}</span><h2>${escapeHTML(c)}</h2>${note?`<p>${escapeHTML(note)}</p>`:''}</section>`+
     list.map(x=>`<article class="mc-dish${(n++)%2?' flip':''}" data-ci="${ci}"><div class="mc-stage"><div class="mc-glow"></div><div class="mc-wisps"><span></span><span></span><span></span></div><img class="mc-photo" src="${escapeHTML(img(x))}" alt="${escapeHTML(x.name)}" loading="lazy"></div><div class="mc-info"><span class="mc-tag">${escapeHTML(c)}</span><h3>${escapeHTML(x.name)}</h3>${x.description?`<p class="mc-desc">${escapeHTML(x.description)}</p>`:''}<div class="mc-price">${euro(x.price)}</div>${x.spice_enabled?'<p class="mc-spice">🌶 Pittigheid naar keuze</p>':''}<button type="button" class="mc-add" data-add="${escapeHTML(x.id)}">＋ Toevoegen</button></div></article>`).join('');}).join('')||'<p class="mc-none">Het menu is nog leeg.</p>';
   dishEls=[...grid.querySelectorAll('.mc-dish')];catEls=[...grid.querySelectorAll('.mc-cat')];
   catEls.forEach(el=>io.observe(el));
  }
  all('#menuGrid [data-add]').forEach(b=>{b.disabled=!shopOpen;b.onclick=()=>clickAdd(b);});
  all('[data-mc-cat]').forEach(b=>b.onclick=()=>{const t=document.getElementById('mc-cat-'+b.dataset.mcCat);if(t)t.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});});
  frame();
 };

 /* toevoegen: echte add() uit app.js; bij gerechten zonder keuzes vliegt het bakje naar het mandje */
 function clickAdd(b){
  const m=menu.find(x=>x.id===b.dataset.add);if(!m)return;
  const direct=shopOpen&&!needsChoice(m);
  if(direct){const from=b.closest('.mc-dish,.mc-row')?.querySelector('.mc-photo,img');fly(m,from);}
  add(m.id);
  if(direct&&b.classList.contains('mc-add')){b.classList.add('done');b.textContent='✓ In je mandje';setTimeout(()=>{b.classList.remove('done');b.textContent='＋ Toevoegen';},1600);}
 }
 function bump(){const cb=$('#cartBtn');if(!cb)return;cb.classList.remove('mc-bump');void cb.offsetWidth;cb.classList.add('mc-bump');}
 function fly(m,fromEl){
  const cb=$('#cartBtn');if(reduce||!fromEl||!cb)return;
  const a=fromEl.getBoundingClientRect(),b=cb.getBoundingClientRect();if(!a.width)return;
  const size=Math.min(a.width,a.height,160),f=document.createElement('img');f.className='mc-fly';f.src=fromEl.currentSrc||fromEl.src;f.alt='';
  f.style.width=f.style.height=size+'px';const x0=a.left+a.width/2-size/2,y0=a.top+a.height/2-size/2,x1=b.left+b.width/2-size/2,y1=b.top+b.height/2-size/2;
  f.style.left=x0+'px';f.style.top=y0+'px';document.body.appendChild(f);
  f.animate([{transform:'translate(0,0) scale(1)'},{transform:`translate(${(x1-x0)*.45}px,${(y1-y0)*.45-120}px) scale(.7) rotate(-12deg)`,offset:.5},{transform:`translate(${x1-x0}px,${y1-y0}px) scale(.12) rotate(-30deg)`,opacity:.6}],{duration:850,easing:'cubic-bezier(.5,0,.3,1)'}).onfinish=()=>f.remove();
 }
 /* mandje laat een sprongetje zien als er iets bij komt (ook na het keuzevenster) */
 const count=()=>cart.reduce((t,x)=>t+x.qty,0);let lastN=count();
 const baseRenderCart=renderCart;
 renderCart=function(){const r=baseRenderCart.apply(this,arguments);const n=count();if(n>lastN)setTimeout(bump,reduce?0:700);lastN=n;return r;};

 /* zoeken en lijstknop */
 if(search)search.oninput=()=>renderMenu();
 if(listBtn)listBtn.onclick=()=>{listMode=!listMode;listBtn.setAttribute('aria-pressed',String(listMode));listBtn.querySelector('span').textContent=listMode?'Keuken':'Lijst';renderMenu();const tb=document.querySelector('.mc-toolbar');if(tb)scrollTo({top:tb.getBoundingClientRect().top+scrollY-(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mc-top'))||0),behavior:'auto'});};

 /* scroll-regie: elk gerecht zweeft uit het donker; categorieknop volgt mee */
 const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in');}),{threshold:.3});
 let ticking=false,activeCi=null;
 function frame(){
  ticking=false;const vh=innerHeight;let cur=null;
  for(const s of dishEls){
   const r=s.getBoundingClientRect();if(r.bottom<-vh*.2||r.top>vh*1.2)continue;
   const c=(r.top+r.height/2-vh/2)/vh,a=Math.min(1,Math.abs(c)*1.6),st=s.firstElementChild,inf=s.lastElementChild;
   if(!reduce){st.style.transform=`translateY(${c*-60}px) scale(${1-a*.22}) rotate(${c*-8}deg)`;st.style.opacity=String(1-a*.85);st.style.filter=a>.02?`blur(${a*6}px) brightness(${1-a*.5})`:'none';inf.style.transform=`translateY(${c*90}px)`;inf.style.opacity=String(1-a);}
   s.classList.toggle('active',Math.abs(c)<.3);if(Math.abs(c)<.5)cur=s.dataset.ci;
  }
  for(const el of catEls){const r=el.getBoundingClientRect();if(r.top<vh*.55&&r.bottom>vh*.2)cur=el.dataset.ci??el.id.replace('mc-cat-','');}
  if(cur!==null&&cur!==activeCi){activeCi=cur;all('[data-mc-cat]').forEach(ch=>{const on=ch.dataset.mcCat===cur;ch.classList.toggle('active',on);if(on)ch.scrollIntoView({inline:'center',block:'nearest',behavior:reduce?'auto':'smooth'});});}
 }
 addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(frame);}},{passive:true});
 addEventListener('resize',frame);
 if(hero)requestAnimationFrame(()=>hero.classList.add('in'));

 /* stoom bij binnenkomst vanaf het titelscherm */
 if(document.documentElement.classList.contains('steam-in')){
  try{sessionStorage.removeItem('mtf_steam');}catch{}
  const cv=document.createElement('canvas');cv.id='mcSteam';document.body.appendChild(cv);const ctx=cv.getContext('2d'),dpr=Math.min(2,devicePixelRatio||1);
  const size=()=>{cv.width=innerWidth*dpr;cv.height=innerHeight*dpr;};size();
  const sprite=document.createElement('canvas');sprite.width=sprite.height=256;{const g=sprite.getContext('2d'),gr=g.createRadialGradient(128,128,0,128,128,128);gr.addColorStop(0,'rgba(255,248,236,.55)');gr.addColorStop(.45,'rgba(250,240,225,.22)');gr.addColorStop(1,'rgba(250,240,225,0)');g.fillStyle=gr;g.fillRect(0,0,256,256);}
  let puffs=[];const W=innerWidth,H=innerHeight;
  for(let i=0;i<26;i++)puffs.push({x:Math.random()*W,y:H*(Math.random()*1.1),r:(.22+Math.random()*.35)*Math.max(W,H),vy:-(H*(.45+Math.random()*.5)),vx:(Math.random()-.5)*80,life:Math.random()*.5,max:1.1+Math.random()*.6});
  let t0=0,last=0;
  const loop=ts=>{if(!t0){t0=ts;last=ts;document.documentElement.classList.add('steam-run');}const dt=Math.min(.05,(ts-last)/1000),el=(ts-t0)/1000;last=ts;
   ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);
   const veil=Math.max(0,1-el/1.0);
   if(veil>0){const g=ctx.createLinearGradient(0,innerHeight,0,0);g.addColorStop(0,`rgba(240,232,220,${.92*veil})`);g.addColorStop(1,`rgba(236,228,216,${.86*veil})`);ctx.fillStyle=g;ctx.fillRect(0,0,innerWidth,innerHeight);}
   puffs=puffs.filter(p=>p.life<p.max);
   for(const p of puffs){p.life+=dt;p.y+=p.vy*dt;p.x+=p.vx*dt;p.r*=1+dt*.5;ctx.globalAlpha=Math.sin(Math.PI*Math.min(1,p.life/p.max))*.6;ctx.drawImage(sprite,p.x-p.r,p.y-p.r,p.r*2,p.r*2);}
   ctx.globalAlpha=1;
   if(veil<=0&&!puffs.length){cv.remove();document.documentElement.classList.remove('steam-in','steam-run');return;}
   requestAnimationFrame(loop);};
  if(reduce){cv.remove();document.documentElement.classList.remove('steam-in');}else requestAnimationFrame(loop);
 }
 /* v2: kop zoals het voorbeeld – naam, Lijst-knop in de kop, kortingsbanner in de hero, zoekpil */
 const strong=document.querySelector('.topbar .mark strong');if(strong)strong.textContent=SITE_CONFIG.name;
 const cartBtn=$('#cartBtn');if(listBtn&&cartBtn)cartBtn.before(listBtn);
 const promo=document.querySelector('.welcome-banner'),slot=$('#mcPromoSlot');
 if(promo&&slot){const c=promo.cloneNode(true);c.className='mc-promo';c.removeAttribute('aria-label');slot.replaceWith(c);
  new MutationObserver(()=>{c.hidden=promo.hidden;}).observe(promo,{attributes:true,attributeFilter:['hidden']});c.hidden=promo.hidden;}
 const openSearch=()=>{document.body.classList.add('mc-searching');if(!listMode)listBtn?.click();setTimeout(()=>{search?.focus({preventScroll:true});const tb=document.querySelector('.mc-toolbar');if(tb){const top=tb.parentElement.offsetTop+tb.offsetTop-(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mc-top'))||0);scrollTo({top:Math.max(0,grid.getBoundingClientRect().top+scrollY-tb.offsetHeight-(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mc-top'))||0)-8)});}},60);};
 $('#mcSearchBtn')?.addEventListener('click',openSearch);
 listBtn?.addEventListener('click',()=>{document.body.classList.toggle('mc-searching',listMode);if(!listMode&&search&&search.value){search.value='';renderMenu();}});
 requestAnimationFrame(setTop);
 if(menu.length)renderMenu();
})();
