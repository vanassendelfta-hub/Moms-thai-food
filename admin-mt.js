/* Beheer – onderbalk voor de telefoon en bijhouden van het actieve onderdeel. Gebruikt alleen de bestaande navigatieknoppen. */
(()=>{
 const body=document.body,dash=document.getElementById('dashboard');if(!dash)return;
 const tabBtn=t=>document.querySelector('.admin-tabs [data-tab="'+t+'"]');
 const ICON={
  overviewPanel:'<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  ordersPanel:'<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  tasksPanel:'<path d="m4 7 2 2 4-4"/><path d="M13 7h7M4 15l2 2 4-4M13 15h7"/>',
  menuPanel:'<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M8 7c0-1.5 1-2 1-3M12 7c0-1.5 1-2 1-3M16 7c0-1.5 1-2 1-3"/>',
  more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'};
 const ITEMS=[['overviewPanel','Overzicht'],['ordersPanel','Bestellingen','navOrderCount'],['tasksPanel','Taken','navTaskCount'],['menuPanel','Gerechten'],['more','Meer']];
 const bar=document.createElement('nav');bar.id='mtBottom';bar.setAttribute('aria-label','Snelle navigatie');
 bar.innerHTML=ITEMS.map(([t,l,c])=>`<button type="button" data-mt="${t}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[t]}</svg><span>${l}</span>${c?`<span class="badge" data-badge="${c}"></span>`:''}</button>`).join('');
 document.body.appendChild(bar);
 bar.addEventListener('click',e=>{const b=e.target.closest('[data-mt]');if(!b)return;const t=b.dataset.mt;
  if(t==='more'){document.getElementById('mobileNav')?.click();return;}
  const btn=tabBtn(t);if(btn){btn.click();setActive(t);scrollTo({top:0,behavior:'smooth'});}});
 function setActive(t){if(!t)return;body.dataset.mtTab=t;bar.querySelectorAll('[data-mt]').forEach(b=>b.classList.toggle('on',b.dataset.mt===t));}
 /* actief onderdeel volgen, ook als het via de zijbalk of een snelkoppeling wordt geopend */
 document.addEventListener('click',e=>{const b=e.target.closest('[data-tab],[data-go]');if(b)setTimeout(()=>setActive(b.dataset.tab||b.dataset.go),0);},true);
 const visible=()=>{const a=document.querySelector('.admin-tabs button.active[data-tab]');return a?a.dataset.tab:'overviewPanel';};
 new MutationObserver(()=>setActive(visible())).observe(document.querySelector('.admin-tabs')||dash,{attributes:true,subtree:true,attributeFilter:['class']});
 /* knoppen verbergen waar geen rechten voor zijn; tellers overnemen */
 function sync(){
  bar.querySelectorAll('[data-mt]').forEach(b=>{const t=b.dataset.mt;if(t==='more')return;const src=tabBtn(t);b.hidden=!src||src.hidden;});
  bar.querySelectorAll('[data-badge]').forEach(s=>{const src=document.getElementById(s.dataset.badge);s.textContent=src&&!src.hidden?src.textContent.trim():'';});
  body.classList.toggle('mt-in',!dash.hidden);
 }
 const mo=new MutationObserver(sync);
 mo.observe(dash,{attributes:true,subtree:true,childList:true,characterData:true,attributeFilter:['hidden']});
 ['navOrderCount','navTaskCount'].forEach(id=>{const el=document.getElementById(id);if(el)mo.observe(el,{childList:true,characterData:true,subtree:true,attributes:true});});
 sync();setActive(visible());
})();
