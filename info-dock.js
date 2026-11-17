/* Info-dock: drie subtiele knopjes aan de zijkant (aangepaste openingstijden, acties, bestellen tot).
   De bestaande blokken worden hierin verplaatst en klappen over de pagina heen open. */
(()=>{
 if(window.__mtfDock)return;window.__mtfDock=1;
 const ICON={
  uren:'<span class="mtf-ico mtf-ex" aria-hidden="true">!</span>',
  actie:'<span class="mtf-ico" aria-hidden="true">10%</span>',
  laat:'<span class="mtf-ico mtf-new" aria-hidden="true">New!</span>'
 };
 const DEFS=[
  {key:'uren',label:'Aangepaste openingstijden',sel:['.special-hours']},
  {key:'actie',label:'Acties',sel:['.welcome-banner','.campaign-links']},
  {key:'laat',label:'Tot hoe laat bestellen',sel:['.late-order']}
 ];
 const css=`
.mtf-dock{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:45;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.mtf-dock button.mtf-tab{pointer-events:auto;position:relative;display:flex;align-items:center;justify-content:center;width:42px;height:44px;padding:0;border-radius:12px 0 0 12px;border:1px solid rgba(var(--mtf-gold-rgb),.45);border-right:0;background:rgba(12,16,34,.86);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:var(--mtf-gold);cursor:pointer;box-shadow:-4px 6px 18px rgba(0,0,0,.35);transition:width .2s ease,background .2s ease}
.mtf-dock button.mtf-tab:hover,.mtf-dock button.mtf-tab[aria-expanded="true"]{width:50px;background:rgba(20,25,47,.96)}
.mtf-dock button.mtf-tab:focus-visible{outline:3px solid var(--mtf-cream-warm);outline-offset:2px}
.mtf-dock button.mtf-tab[hidden]{display:none}
.mtf-dock .mtf-ico{font:800 14px/1 Arial,Helvetica,sans-serif;color:var(--mtf-gold);letter-spacing:-.02em;white-space:nowrap}.mtf-dock .mtf-ex{font-size:24px;font-family:Georgia,serif}.mtf-dock .mtf-new{font-size:11.5px;letter-spacing:0}
.mtf-dock .mtf-dot{position:absolute;top:7px;left:7px;width:8px;height:8px;border-radius:50%;background:#39d98a;box-shadow:0 0 0 2px rgba(12,16,34,.9)}
.mtf-dock .mtf-dot.red{background:#e4363c}
.mtf-dock .mtf-tip{position:absolute;right:calc(100% + 8px);top:50%;transform:translate(6px,-50%);white-space:nowrap;padding:6px 10px;border-radius:8px;background:var(--mtf-navy);border:1px solid rgba(var(--mtf-gold-rgb),.35);color:var(--mtf-cream);font:600 13px Arial,sans-serif;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}
@media(hover:hover){.mtf-dock button.mtf-tab:hover .mtf-tip{opacity:1;transform:translate(0,-50%)}}
.mtf-scrim{position:fixed;inset:0;z-index:43;background:rgba(5,7,16,.35);opacity:0;pointer-events:none;transition:opacity .2s}
.mtf-scrim.open{opacity:1;pointer-events:auto}
.mtf-dp{position:fixed;z-index:44;right:58px;top:50%;width:min(420px,calc(100vw - 74px));max-height:min(78vh,640px);overflow:auto;-webkit-overflow-scrolling:touch;transform:translate(16px,-50%);opacity:0;visibility:hidden;transition:opacity .2s ease,transform .25s ease,visibility 0s .25s;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.55)}
.mtf-dp.open{opacity:1;visibility:visible;transform:translate(0,-50%);transition:opacity .2s ease,transform .25s ease}
.mtf-dp .mtf-close{position:sticky;top:0;float:right;z-index:2;margin:8px 8px -40px 0;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(12,16,34,.75);color:#fff;font:700 18px/1 Arial;cursor:pointer}
.mtf-dp .mtf-close:focus-visible{outline:3px solid var(--mtf-cream-warm);outline-offset:2px}
.mtf-dp>section,.mtf-dp>div:not(.mtf-x){margin:0!important;width:100%!important;max-width:none!important;box-sizing:border-box}
.mtf-dp>.late-order,.mtf-dp>.welcome-banner{display:flex!important;flex-direction:column;align-items:flex-start!important;gap:16px;padding-right:52px!important}
.mtf-dp>.special-hours{display:block!important;padding-right:52px!important}
.mtf-dp>.special-hours[hidden]{display:none!important}
.mtf-dp>.campaign-links{display:flex!important;flex-direction:column;gap:8px;margin-top:10px!important;padding:12px!important;background:#14192b;border:1px solid rgba(203,162,92,.25);border-radius:14px}
.mtf-dp>.campaign-links a{margin:0!important}
@media(max-width:560px){.mtf-dock button.mtf-tab{width:36px;height:40px}.mtf-dock button.mtf-tab:hover,.mtf-dock button.mtf-tab[aria-expanded="true"]{width:42px}.mtf-dock .mtf-ico{font-size:13px}.mtf-dock .mtf-ex{font-size:22px}.mtf-dock .mtf-new{font-size:10.5px}.mtf-dp{right:48px;width:calc(100vw - 60px)}}
@media(prefers-reduced-motion:reduce){.mtf-dp,.mtf-scrim,.mtf-dock button.mtf-tab{transition:none}}
`;
 function build(){
  if(document.querySelector('.mtf-dock'))return;
  const st=document.createElement('style');st.id='mtfDockStyle';st.textContent=css;document.head.append(st);
  const dock=document.createElement('nav');dock.className='mtf-dock';dock.setAttribute('aria-label','Informatie');
  const scrim=document.createElement('div');scrim.className='mtf-scrim';
  document.body.append(scrim,dock);
  const items={};
  for(const d of DEFS){
   const b=document.createElement('button');b.type='button';b.className='mtf-tab';b.hidden=true;
   b.setAttribute('aria-label',d.label);b.setAttribute('aria-expanded','false');b.setAttribute('aria-controls','mtf-dp-'+d.key);
   b.innerHTML=ICON[d.key]+'<span class="mtf-tip">'+d.label+'</span>';
   const p=document.createElement('div');p.className='mtf-dp';p.id='mtf-dp-'+d.key;p.setAttribute('role','dialog');p.setAttribute('aria-label',d.label);
   const x=document.createElement('button');x.type='button';x.className='mtf-close';x.setAttribute('aria-label','Sluiten');x.textContent='×';p.append(x);
   dock.append(b);document.body.append(p);
   items[d.key]={d,b,p};
   b.addEventListener('click',()=>toggle(d.key));
   x.addEventListener('click',()=>close(true));
  }
  let openKey=null;
  function toggle(k){openKey===k?close(true):open(k);}
  function open(k){
   close(false);openKey=k;const it=items[k];
   it.p.classList.add('open');it.b.setAttribute('aria-expanded','true');scrim.classList.add('open');
   it.p.querySelector('.mtf-close').focus({preventScroll:true});
  }
  function close(focus){
   if(!openKey)return;const it=items[openKey];openKey=null;
   it.p.classList.remove('open');it.b.setAttribute('aria-expanded','false');scrim.classList.remove('open');
   if(focus)it.b.focus({preventScroll:true});
  }
  scrim.addEventListener('click',()=>close(false));
  addEventListener('keydown',e=>{if(e.key==='Escape')close(true);});
  /* Links in een paneel (bv. 'Bestel nu' naar #menu) sluiten het paneel */
  document.addEventListener('click',e=>{if(openKey&&e.target.closest('.mtf-dp a'))close(false);});

  function sync(){
   for(const k in items){
    const {d,b,p}=items[k];
    for(const s of d.sel){
     document.querySelectorAll(s).forEach(el=>{if(el.closest('.mtf-dp')!==p)p.append(el);});
    }
    const visible=[...p.children].some(c=>!c.classList.contains('mtf-close')&&!c.hidden&&c.textContent.trim());
    if(b.hidden===visible)b.hidden=!visible;
    if(!visible&&openKey===k)close(false);
   }
   const late=items.laat.p.querySelector('.late-order');
   setDot(items.laat.b,late&&/Vandaag nog/.test(late.textContent)?'green':'');
  }
  function setDot(b,c){let s=b.querySelector('.mtf-dot');if(!c){s&&s.remove();return;}if(!s){s=document.createElement('span');s.className='mtf-dot';b.append(s);}s.classList.toggle('red',c==='red');}
  let q=0;new MutationObserver(()=>{if(q)return;q=setTimeout(()=>{q=0;sync();},40);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden'],characterData:true});
  sync();
 }
 if(document.body)build();else document.addEventListener('DOMContentLoaded',build);
})();
