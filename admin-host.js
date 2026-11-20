/* Beheer via flowsmid.nl/beheer/momsthaifood/: links naar de bestelwebsite wijzen dan naar het eigen adres van Mom's Thai Food. */
(()=>{if(location.hostname!=='flowsmid.nl')return;const site='https://bestellen.momsthaifood.nl/';
 const fix=()=>document.querySelectorAll('a[href="/"]').forEach(a=>{a.href=site;a.target='_blank';a.rel='noopener'});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fix);else fix();})();
