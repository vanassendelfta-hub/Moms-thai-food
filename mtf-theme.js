/* Mom's Thai Food – huisstijl: actieve pagina in de navigatie en inklappen van de navigatie tijdens scrollen (menu). */
(()=>{
 const p=location.pathname.replace(/\.html$/,'').replace(/\/$/,'')||'/home';
 const key=p==='/'||p===''||p==='/home'?'/':p==='/menu'?'/menu':p;
 document.querySelectorAll('.topbar .nav a').forEach(a=>{const h=(a.getAttribute('href')||'').replace(/\.html$/,'').replace(/\/$/,'')||'/';if(h===key||(key==='/'&&h===''))a.setAttribute('aria-current','page');});
 let on=false;const upd=()=>{const s=scrollY>140;if(s!==on){on=s;document.body.classList.toggle('mt-scrolled',s);}};
 addEventListener('scroll',upd,{passive:true});upd();
})();
