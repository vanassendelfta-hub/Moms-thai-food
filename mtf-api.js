/* Verbinding met de motor (Supabase-serverfuncties). Laad direct na site-config.js.
   MTF.fetch: zoals fetch(), maar voegt bij POST-verzoeken naar /functions/v1/ de gekozen vestiging toe
   (window.MTFLocation, gezet door branch.js). Expliciet per aanroep; vervangt de oude onderschepping
   van window.fetch. Op pagina's zonder vestigingskeuze gedraagt het zich als gewone fetch.
   MTF.onOrderPlaced / MTF.orderPlaced: haken die na een geplaatste bestelling draaien (bijv. online betalen). */
(function(){
 const MTF=window.MTF=window.MTF||{};
 MTF.fetch=function(input,options){
  const loc=window.MTFLocation;
  if(loc&&typeof input==='string'&&input.startsWith(SITE_CONFIG.supabaseUrl+'/functions/v1/')&&options?.method?.toUpperCase()==='POST'&&typeof options.body==='string'){
   try{const body=JSON.parse(options.body);if(body&&typeof body==='object'&&!Array.isArray(body))options={...options,body:JSON.stringify({...body,location:loc.slug})};}catch{}
  }
  return window.fetch(input,options);
 };
 const placed=[];
 MTF.onOrderPlaced=fn=>{placed.push(fn);};
 /* Geeft true terug als een haak de klant doorstuurt (bijvoorbeeld naar de bank). */
 MTF.orderPlaced=async info=>{for(const fn of placed){try{if(await fn(info)==='redirect')return true;}catch{}}return false;};
})();
