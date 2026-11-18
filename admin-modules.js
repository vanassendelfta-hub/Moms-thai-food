/* Beheer: onderdelen van uitgeschakelde modules (SITE_CONFIG.modules) verbergen.
   Laadt als laatste beheerscript, zodat het na alle rechtencontroles draait. Met alle modules aan verandert er niets. */
(()=>{
 const M=n=>SITE_CONFIG.module(n);
 /* module -> tabbladen (data-tab) en overige elementen die verdwijnen als de module uit staat */
 const parts={
  tasks:{tabs:['tasksPanel']},
  map:{tabs:['mapPanel']},
  warehouse:{tabs:['warehousePanel']},
  finance:{tabs:['financePanel']},
  receipts:{tabs:['receiptsPanel']},
  seasonal:{tabs:['seasonalPanel']},
  adminPromotions:{tabs:['promotionsPanel']},
  addons:{selectors:['#addonManager','#openAddonManager']},
  siteStats:{tabs:['statsPanel']}
 };
 const off=Object.keys(parts).filter(n=>!M(n));
 if(!off.length)return;
 const tabs=new Set(off.flatMap(n=>parts[n].tabs||[]));
 /* Alleen zetten als het nog niet verborgen is, anders roept de observer zichzelf steeds opnieuw aan. */
 const hide=()=>{
  for(const t of tabs){document.querySelectorAll('[data-tab="'+t+'"]').forEach(b=>{if(!b.hidden)b.hidden=true;});const panel=document.getElementById(t);if(panel&&!panel.hidden)panel.hidden=true;}
  for(const n of off)for(const s of parts[n].selectors||[])document.querySelectorAll(s).forEach(e=>{if(!e.hidden)e.hidden=true;});
  /* Snelkoppelingen op het overzicht naar verborgen onderdelen */
  document.querySelectorAll('#overviewActions [data-overview]').forEach(b=>{if(tabs.has(b.dataset.overview)&&!b.hidden)b.hidden=true;});
 };
 if(typeof applyRights==='function'){const base=applyRights;applyRights=function(){const r=base.apply(this,arguments);hide();return r;};}
 if(typeof refreshOverview==='function'){const base=refreshOverview;refreshOverview=async function(){const r=await base.apply(this,arguments);hide();return r;};}
 /* Tabbladen die later (asynchroon) worden toegevoegd, zoals Statistieken */
 new MutationObserver(hide).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
 hide();
})();
