/* Instellingen per bedrijf.
   Dit is het enige bestand met bedrijfsgegevens dat de gedeelde scripts (bestellen, betalen, beheer) gebruiken.
   Voor een nieuw restaurant: kopieer dit bestand en vul de eigen waarden in.
   Laad het als eerste script op elke pagina: <script src="/site-config.js"></script> */
(function(){
 const config={
  /* Naam zoals klanten die zien (mails, meldingen, kassabon). */
  name:'Mom’s Thai Food',

  /* Supabase-project van dit bedrijf. De publishable key is openbaar en mag in de browser staan. */
  supabaseUrl:'https://uywydquzvdbpfjjrwsbt.supabase.co',
  publishableKey:'sb_publishable_J1Ewyl4he9-KRj_jv8fIPA_S8vZ2v5_',

  /* Vestigingen. De eerste is de standaard. */
  /* Testomgeving: gebruikt op de testlink van de platform-tak en lokaal, nooit op de echte site. */
  test:{
   supabaseUrl:'https://ipbvjszctqgtidcouidc.supabase.co',
   publishableKey:'sb_publishable_vgBUmNL3a1fShF4jMOzT8g_eTPTaQyE'
  },

  defaultLocation:'spijkenisse',
  locations:{
   'spijkenisse':{cartKey:'mtf_cart_v1'},
   'oud-beijerland':{cartKey:'mtf_cart_ob_v1'}
  }
 };

 /* Bestelnummer zoals klant en beheer het zien. Spijkenisse houdt de bestaande nummering (MTF00284001 t/m MTF00284999). */
 config.orderNumber=function(slug,raw){
  const n=Number(raw);
  if(slug==='oud-beijerland')return 'MTFOB'+String(raw??'').padStart(5,'0');
  return Number.isSafeInteger(n)&&n>=1&&n<=999?'MTF00284'+String(raw).padStart(3,'0'):String(raw??'');
 };

 /* Sleutel van het winkelmandje in de browser, per vestiging. */
 config.cartKey=function(slug){
  return (config.locations[slug]||config.locations[config.defaultLocation]).cartKey;
 };

 /* Kies de testdatabase alleen op de testlink van de platform-tak (…-git-platform-….vercel.app) of lokaal. */
 const host=(typeof location!=='undefined'&&location.hostname)||'';
 config.environment=/^(localhost|127\.0\.0\.1)$/.test(host)||host.includes('-git-platform-')?'test':'live';
 if(config.environment==='test'){config.supabaseUrl=config.test.supabaseUrl;config.publishableKey=config.test.publishableKey;}

 config.locationSlugs=Object.keys(config.locations);
 window.SITE_CONFIG=Object.freeze(config);

 /* Duidelijk label zodat niemand de testsite voor de echte aanziet. */
 if(config.environment==='test'&&typeof document!=='undefined'){
  document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='TESTOMGEVING · geen echte bestellingen';b.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99999;background:#c62828;color:#fff;font:700 12px/1 system-ui,sans-serif;padding:7px 10px;border-radius:6px;pointer-events:none;opacity:.92';document.body.appendChild(b);});
 }
})();
