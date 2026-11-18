/* Instellingen per bedrijf.
   Dit is het enige bestand met bedrijfsgegevens dat de gedeelde scripts (bestellen, betalen, beheer) gebruiken.
   Voor een nieuw restaurant: kopieer dit bestand en vul de eigen waarden in.
   Laad het als eerste script op elke pagina: <script src="/site-config.js"></script> */
(function(){
 const config={
  /* Naam zoals klanten die zien (mails, meldingen, kassabon). */
  name:'Forum Cateringservice',

  /* Supabase-project van dit bedrijf (pilot). De publishable key is openbaar en mag in de browser staan. */
  supabaseUrl:'https://xxctsddwduviiqpzlsij.supabase.co',
  publishableKey:'sb_publishable_ZNy2Vbd111xf9d1W4TpcRg_wjRogtQ1',

  /* Demo: nog geen productiedomein, dus elke host toont het demolabel. */
  productionHosts:[],
  test:null,
  demoLabel:'DEMO · geen echte bestellingen',

  /* Vier favorieten op de homepagina (gerecht-id's = menunummers). */
  favorites:['27','1','7','51'],

  defaultLocation:'spijkenisse',
  locations:{
   'spijkenisse':{
    cartKey:'forum_cart_v1',
    orderNumber:raw=>'FC'+String(raw??'').padStart(5,'0'),
    features:[]
   }
  }
 };

 /* Modules: extra onderdelen die per klant aan of uit staan (pakket Basis of Maatwerk).
    Website: onlinePayment (iDEAL/Wero via Mollie), promotions (coupons en reviews), welkom10, campaigns,
             homeDeals (combideals op home), cinematicMenu (filmische menukaart), game, infoDock, stats.
    Beheer:  tasks, map (bezorgkaart), warehouse (magazijn), finance, receipts (bonnen), seasonal (feestdagen),
             adminPromotions (coupons en reviews beheren), addons (extra's bij gerechten), siteStats (websitestatistieken). */
 config.modules=['cinematicMenu','homeDeals','infoDock',
  'map','receipts','seasonal','addons','tasks','finance'];
 config.module=function(name){return config.modules.includes(name);};
 /* Script van een module alleen laden als de module aan staat. Gebruik tijdens het laden van de pagina:
    <script>SITE_CONFIG.include('campaigns','/campagnes.js')</script> — laadt in dezelfde volgorde als een gewone scripttag. */
 config.include=function(name,src){if(config.module(name)&&typeof document!=='undefined')document.write('<script src="'+String(src).replace(/"/g,'&quot;')+'"><\/script>');};

 const loc=slug=>config.locations[slug]||config.locations[config.defaultLocation];

 /* Bestelnummer zoals klant en beheer het zien. */
 config.orderNumber=function(slug,raw){return loc(slug).orderNumber(raw);};

 /* Heeft deze vestiging een bepaald extraatje (bijv. 'welkom10', 'seasonal')? */
 config.hasFeature=function(slug,name){return (config.locations[slug]?.features||[]).includes(name);};

 /* Bestaat deze vestiging in de instellingen? Zo niet: de hoofdvestiging. */
 config.validLocation=function(slug){return Object.hasOwn(config.locations,slug)?slug:config.defaultLocation;};

 /* Standaardfoto voor een gerecht zonder eigen foto: eerst op woorden in de naam, dan op categorie.
    Inhoud is bedrijfsspecifiek; de volgorde telt (eerste treffer wint). */
 config.fallbackPhotos={
  byName:[
   [['cashew','kong po'],'forum/gerecht-kip-cashew.jpg'],
   [['tjap tjoy','groente','tahoe'],'forum/gerecht-tjap-tjoy.jpg'],
   [['bami','nasi','miehoen','mie'],'forum/gerecht-bami-nasi.jpg']
  ],
  byCategory:[
   [['bami','nasi','miehoen'],'forum/gerecht-bami-nasi.jpg'],
   [['tjap tjoy','vegetarisch','tahoe'],'forum/gerecht-tjap-tjoy.jpg']
  ],
  fallback:'forum/gerecht-kip-cashew.jpg'
 };
 config.fallbackPhoto=function(x){
  const s=(x?.name||'').toLowerCase(),c=(x?.category||'').toLowerCase(),p=config.fallbackPhotos;
  for(const [words,photo] of p.byName)if(words.some(w=>s.includes(w)))return photo;
  for(const [words,photo] of p.byCategory)if(words.some(w=>c.includes(w)))return photo;
  return p.fallback;
 };

 /* Sleutel van het winkelmandje in de browser, per vestiging. */
 config.cartKey=function(slug){
  return loc(slug).cartKey;
 };

 /* Echte database alleen op de productie-adressen; overal anders de testdatabase. */
 const host=(typeof location!=='undefined'&&location.hostname)||'';
 config.environment=config.productionHosts.includes(host)?'live':'test';
 if(config.environment==='test'&&config.test?.supabaseUrl){config.supabaseUrl=config.test.supabaseUrl;config.publishableKey=config.test.publishableKey;}

 config.locationSlugs=Object.keys(config.locations);
 Object.freeze(config.modules);
 window.SITE_CONFIG=Object.freeze(config);

 /* Duidelijk label zodat niemand de testsite voor de echte aanziet. */
 if(config.environment==='test'&&typeof document!=='undefined'){
  document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent=config.demoLabel||'TESTOMGEVING · geen echte bestellingen';b.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99999;background:#c62828;color:#fff;font:700 12px/1 system-ui,sans-serif;padding:7px 10px;border-radius:6px;pointer-events:none;opacity:.92';document.body.appendChild(b);});
 }
})();
