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
  /* Alleen deze adressen gebruiken de echte database. Elk ander adres (previews, losse testversies, lokaal) gebruikt de testdatabase. */
  productionHosts:['momsthaifood.nl','www.momsthaifood.nl','bestellen.momsthaifood.nl','moms-thai-food-bestellen.vercel.app','flowsmid.nl'],

  /* Testomgeving */
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

 /* Standaardfoto voor een gerecht zonder eigen foto: eerst op woorden in de naam, dan op categorie.
    Inhoud is bedrijfsspecifiek; de volgorde telt (eerste treffer wint). */
 config.fallbackPhotos={
  byName:[
   [['popia','loempia'],'popia-tod.jpg'],
   [['saté','sate'],'sate-gai.jpg'],
   [['thod man','viskoek'],'thod-man-pla.jpg'],
   [['goong chiang','garnalen op toast'],'goong-chiang.jpg'],
   [['tom kha'],'soup.jpg'],
   [['tom yum','tom yam'],'tom-yum.jpg'],
   [['groene curry'],'curry.jpg'],
   [['rode curry','red curry','panang','massaman'],'red-curry.jpg'],
   [['cashew','cashewnoten'],'cashew-chicken.jpg'],
   [['pad thai'],'pad-thai.jpg'],
   [['krapow','basil','heilige basilicum'],'pad-krapow.jpg'],
   [['fried rice','gebakken rijst','khao pad'],'fried-rice.jpg'],
   [['noedel','noodle','pad see ew','mie'],'pad-thai.jpg']
  ],
  byCategory:[
   [['soep'],'soup.jpg'],
   [['curry'],'curry.jpg'],
   [['rijst'],'fried-rice.jpg'],
   [['noedel'],'pad-thai.jpg'],
   [['voorgerecht'],'popia-tod.jpg']
  ],
  fallback:'hero-food.jpg'
 };
 config.fallbackPhoto=function(x){
  const s=(x?.name||'').toLowerCase(),c=(x?.category||'').toLowerCase(),p=config.fallbackPhotos;
  for(const [words,photo] of p.byName)if(words.some(w=>s.includes(w)))return photo;
  for(const [words,photo] of p.byCategory)if(words.some(w=>c.includes(w)))return photo;
  return p.fallback;
 };

 /* Gerechten waarbij geen bijgerecht (rijst of nasi) wordt aangeboden: op woorden in de naam. Extra's blijven wel beschikbaar. */
 config.noSidesFor=['pad thai'];
 config.noSides=function(x){
  const s=(x?.name||'').toLowerCase();
  return config.noSidesFor.some(w=>s.includes(w));
 };

 /* Sleutel van het winkelmandje in de browser, per vestiging. */
 config.cartKey=function(slug){
  return (config.locations[slug]||config.locations[config.defaultLocation]).cartKey;
 };

 /* Echte database alleen op de productie-adressen; overal anders de testdatabase. */
 const host=(typeof location!=='undefined'&&location.hostname)||'';
 config.environment=config.productionHosts.includes(host)?'live':'test';
 if(config.environment==='test'){config.supabaseUrl=config.test.supabaseUrl;config.publishableKey=config.test.publishableKey;}

 config.locationSlugs=Object.keys(config.locations);
 window.SITE_CONFIG=Object.freeze(config);

 /* Duidelijk label zodat niemand de testsite voor de echte aanziet. */
 if(config.environment==='test'&&typeof document!=='undefined'){
  document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='TESTOMGEVING · geen echte bestellingen';b.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99999;background:#c62828;color:#fff;font:700 12px/1 system-ui,sans-serif;padding:7px 10px;border-radius:6px;pointer-events:none;opacity:.92';document.body.appendChild(b);});
 }
})();
