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

 config.locationSlugs=Object.keys(config.locations);
 window.SITE_CONFIG=Object.freeze(config);
})();
