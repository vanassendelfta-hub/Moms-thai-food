/* Websitestatistieken in het beheer: bezoeken en unieke bezoekers per dag, week en maand. */
(()=>{
 const API=SITE_CONFIG.supabaseUrl+'/functions/v1/site-stats';
 const C={views:'#c28628',visitors:'#4f93d6'};
 let unit='day',data=null,loading=false,hourDay='';
 viewNames.statsPanel='Websitestatistieken';

 /* Bezorgkaart: de opmaak van Leaflet werd geblokkeerd door een verkeerde controlecode in admin.html. Laad hem opnieuw met de juiste code. */
 document.querySelectorAll('link[href*="leaflet@1.9.4/dist/leaflet.css"]').forEach(old=>{const l=document.createElement('link');l.rel='stylesheet';l.href=old.href;l.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';l.crossOrigin='';old.replaceWith(l);});

 /* Openingstijden-tekst in het beheer gelijk trekken met de nieuwe bestelgrens. */
 document.querySelectorAll('#schedulePanel p').forEach(p=>{if(p.textContent.startsWith('Bestellen voor dezelfde dag kan uiterlijk om 16:00'))p.textContent='Bestellen voor dezelfde dag kan tot 16:00, op vrijdag en zondag tot 19:30. Klanten kiezen tijdvakken van 15 minuten.';});

 const style=document.createElement('style');
 style.textContent=`
 #statsPanel .stats-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:18px 0}
 #statsPanel .stats-kpi{padding:18px 20px;border-radius:14px;background:linear-gradient(110deg,var(--mtf-maroon),var(--mtf-red));color:var(--mtf-cream-warm);border:1px solid var(--mtf-bronze)}
 #statsPanel .stats-kpi small{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85}
 #statsPanel .stats-kpi strong{display:block;font-size:34px;line-height:1.15;margin-top:6px;font-variant-numeric:tabular-nums}
 #statsPanel .stats-kpi span{font-size:13px;opacity:.9}
 #statsPanel .stats-card{background:var(--mtf-navy);color:#f6f2ec;border:1px solid rgba(211,168,83,.33);border-radius:14px;padding:18px 20px;margin:16px 0}
 #statsPanel .stats-card h2{margin:0 0 4px;font-size:18px;color:#f6f2ec}
 #statsPanel .stats-card p.hint{margin:0;color:#b2bbd0}
 #statsPanel .stats-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
 #statsPanel .stats-legend{display:flex;gap:16px;font-size:13px;color:#d9dce6;align-items:center}
 #statsPanel .stats-legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
 #statsPanel .stats-chart{position:relative;margin-top:12px}
 #statsPanel .stats-chart svg{display:block;width:100%;height:auto;overflow:visible}
 #statsPanel .stats-tip{position:absolute;pointer-events:none;background:#f6f2ec;color:var(--mtf-navy);border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.45;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.25);transform:translate(-50%,-110%);opacity:0;transition:opacity .12s}
 #statsPanel .stats-tip b{display:block;margin-bottom:2px}
 #statsPanel .stats-tip i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
 #statsPanel .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
 #statsPanel .stats-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;margin:10px 0;font-size:14px;color:#f6f2ec}
 #statsPanel .stats-bar div{grid-column:1/-1;height:8px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
 #statsPanel .stats-bar div span{display:block;height:100%;border-radius:4px;background:#c28628}
 #statsPanel .stats-bar strong{font-variant-numeric:tabular-nums}
 #statsPanel table{width:100%;border-collapse:collapse;font-size:14px;color:#f6f2ec}
 #statsPanel td,#statsPanel th{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}
 #statsPanel td:not(:first-child),#statsPanel th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
 #statsPanel details summary{cursor:pointer;margin-top:12px;color:#b2bbd0}
 #statsPanel .stats-empty{padding:40px 10px;text-align:center;color:#b2bbd0}
 #statsPanel .stats-daynav{display:flex;align-items:center;gap:8px;margin-top:10px}
 #statsPanel .stats-daynav[hidden]{display:none}
 #statsPanel .stats-daynav button{min-width:40px}
 #statsPanel .stats-daynav strong{min-width:190px;text-align:center;color:#f6f2ec}`;
 document.head.append(style);

 const nav=document.createElement('button');nav.type='button';nav.dataset.tab='statsPanel';nav.textContent='Statistieken';nav.hidden=true;
 (document.querySelector('[data-tab="financePanel"]')||document.querySelector('.admin-tabs .sidebar-bottom'))?.after(nav);
 const sec=document.createElement('section');sec.id='statsPanel';sec.hidden=true;
 sec.innerHTML=`<div class="admin-title"><div><h1>Websitestatistieken</h1><p class="hint">Bezoeken van je bestelwebsite. Zonder cookies; een unieke bezoeker wordt per maand herkend.</p></div><button type="button" class="secondary-button" id="statsRefresh">↻ Verversen</button></div>
 <div class="stats-kpis" id="statsKpis"></div>
 <div class="segmented" id="statsUnits"><button type="button" data-unit="hour">Per uur</button><button type="button" data-unit="day" class="active">Per dag</button><button type="button" data-unit="week">Per week</button><button type="button" data-unit="month">Per maand</button></div>
 <section class="stats-card"><div class="stats-head"><div><h2 id="statsTitle">Bezoeken per dag</h2><p class="hint" id="statsRange"></p><div class="stats-daynav" id="statsDayNav" hidden><button type="button" class="secondary-button" id="statsPrevDay" aria-label="Vorige dag">‹</button><strong id="statsDayLabel"></strong><button type="button" class="secondary-button" id="statsNextDay" aria-label="Volgende dag">›</button><button type="button" class="secondary-button" id="statsToday">Vandaag</button></div></div><div class="stats-legend"><span><i style="background:${C.views}"></i>Bezoeken</span><span><i style="background:${C.visitors}"></i>Unieke bezoekers</span></div></div><div class="stats-chart" id="statsChart"></div><details><summary>Bekijk als tabel</summary><div id="statsTable"></div></details></section>
 <div class="stats-grid"><section class="stats-card"><h2>Meest bekeken pagina's</h2><p class="hint">In de gekozen periode</p><div id="statsPages"></div></section><section class="stats-card"><h2>Waar komen bezoekers vandaan?</h2><p class="hint">Direct = adres ingetypt, bladwijzer of app</p><div id="statsSources"></div></section></div>
 <p class="hint" id="statsSince"></p>`;
 document.querySelector('#dashboard').append(sec);

 const nf=n=>new Intl.NumberFormat('nl-NL').format(Number(n)||0);
 const pageName=p=>({'/':'Home','/menu':'Menu','/catering-paketten':'Catering & pakketten','/contact':'Contact','/actie':'Actie','/privacy':'Privacy','/game':'Wok Challenge','/kerst':'Kerst','/sinterklaas':'Sinterklaas','/oudejaarsdag':'Oudejaarsdag','/nieuwsbrief':'Nieuwsbrief','/coupon':'Coupon'})[p]||p;
 const d=s=>new Date(s+'T12:00:00Z');
 const fmt=(o,s)=>new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',...o}).format(d(s));
 function label(s,long=false){if(unit==='hour'){const h=Number(s),hh=String(h).padStart(2,'0');return long?`${hh}:00 – ${String((h+1)%24).padStart(2,'0')}:00`:hh+':00';}if(unit==='month')return fmt({month:long?'long':'short',year:'numeric'},s);if(unit==='week'){const e=new Date(d(s));e.setUTCDate(e.getUTCDate()+6);return (long?'Week van ':'')+fmt({day:'numeric',month:'short'},s)+(long?' t/m '+fmt({day:'numeric',month:'short'},e.toISOString().slice(0,10)):'');}return fmt(long?{weekday:'long',day:'numeric',month:'long'}:{day:'numeric',month:'short'},s);}

 function kpis(k){const tile=(t,x)=>`<div class="stats-kpi"><small>${t}</small><strong>${nf(x?.views)}</strong><span>bezoeken · ${nf(x?.visitors)} uniek</span></div>`;$('#statsKpis').innerHTML=tile('Vandaag',k.today)+tile('Deze week',k.week)+tile('Deze maand',k.month);}

 function chart(series){
  const box=$('#statsChart');if(!series.length||series.every(x=>!x.views)){box.innerHTML='<div class="stats-empty">Nog geen bezoeken in deze periode. De teller loopt sinds 13 november 2026.</div>';return;}
  const W=Math.max(320,box.clientWidth||800),H=300,m={l:44,r:18,t:16,b:34},iw=W-m.l-m.r,ih=H-m.t-m.b;
  const max=Math.max(4,...series.map(x=>Number(x.views)));const step=Math.pow(10,Math.floor(Math.log10(max)))/(max/Math.pow(10,Math.floor(Math.log10(max)))<2.5?2:1);const top=Math.ceil(max/step)*step;
  const X=i=>m.l+(series.length===1?iw/2:i*iw/(series.length-1)),Y=v=>m.t+ih-(v/top)*ih;
  const line=k=>series.map((x,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(Number(x[k])).toFixed(1)).join('');
  const area=line('views')+` L${X(series.length-1).toFixed(1)} ${Y(0)} L${X(0).toFixed(1)} ${Y(0)} Z`;
  const ticks=[];for(let v=0;v<=top+1e-9;v+=step)ticks.push(v);
  const every=Math.ceil(series.length/(W<520?5:9));
  const last=series.length-1;
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafiek: bezoeken en unieke bezoekers">
   <defs><linearGradient id="statsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.views}" stop-opacity=".35"/><stop offset="1" stop-color="${C.views}" stop-opacity="0"/></linearGradient></defs>
   ${ticks.map(v=>`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.08)" stroke-width="1"/><text x="${m.l-8}" y="${Y(v)+4}" text-anchor="end" font-size="11" fill="#b2bbd0">${nf(v)}</text>`).join('')}
   ${series.map((x,i)=>i%every===0||i===last?`<text x="${X(i)}" y="${H-10}" text-anchor="middle" font-size="11" fill="#b2bbd0">${label(x.bucket)}</text>`:'').join('')}
   <path d="${area}" fill="url(#statsFill)"/>
   <path d="${line('views')}" fill="none" stroke="${C.views}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
   <path d="${line('visitors')}" fill="none" stroke="${C.visitors}" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round" stroke-linecap="round"/>
   <circle cx="${X(last)}" cy="${Y(series[last].views)}" r="4.5" fill="${C.views}" stroke="#14192f" stroke-width="2"/>
   <circle cx="${X(last)}" cy="${Y(series[last].visitors)}" r="4" fill="${C.visitors}" stroke="#14192f" stroke-width="2"/>
   <g id="statsHover" opacity="0"><line id="statsCross" y1="${m.t}" y2="${m.t+ih}" stroke="rgba(255,255,255,.35)" stroke-width="1"/><circle id="statsDotV" r="5" fill="${C.views}" stroke="#14192f" stroke-width="2"/><circle id="statsDotU" r="4.5" fill="${C.visitors}" stroke="#14192f" stroke-width="2"/></g>
   <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="statsHit"/>
  </svg><div class="stats-tip" id="statsTip"></div>`;
  const svg=box.querySelector('svg'),hit=box.querySelector('#statsHit'),g=box.querySelector('#statsHover'),tip=box.querySelector('#statsTip');
  const show=e=>{const r=svg.getBoundingClientRect(),sx=(e.clientX-r.left)*W/r.width;let i=series.length===1?0:Math.round((sx-m.l)/(iw/(series.length-1)));i=Math.max(0,Math.min(last,i));const x=series[i];
   g.setAttribute('opacity','1');box.querySelector('#statsCross').setAttribute('x1',X(i));box.querySelector('#statsCross').setAttribute('x2',X(i));
   const v=box.querySelector('#statsDotV'),u=box.querySelector('#statsDotU');v.setAttribute('cx',X(i));v.setAttribute('cy',Y(x.views));u.setAttribute('cx',X(i));u.setAttribute('cy',Y(x.visitors));
   tip.innerHTML=`<b>${label(x.bucket,true)}</b><i style="background:${C.views}"></i>${nf(x.views)} bezoeken<br><i style="background:${C.visitors}"></i>${nf(x.visitors)} unieke bezoekers`;
   tip.style.left=Math.min(Math.max(X(i)*r.width/W,70),r.width-70)+'px';tip.style.top=(Math.min(Y(x.views),Y(x.visitors))*r.height/H)+'px';tip.style.opacity='1';};
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerdown',show);hit.addEventListener('pointerleave',()=>{g.setAttribute('opacity','0');tip.style.opacity='0';});
 }

 function bars(el,rows,key,name){const max=Math.max(1,...rows.map(r=>Number(r.views)));el.innerHTML=rows.length?rows.map(r=>`<div class="stats-bar"><span>${esc(name(r[key]))}</span><strong>${nf(r.views)}</strong><div><span style="width:${(Number(r.views)/max*100).toFixed(1)}%"></span></div></div>`).join(''):'<p class="hint">Nog geen gegevens.</p>';}

 function render(){
  if(!data)return;kpis(data.kpis);
  $('#statsTitle').textContent={hour:'Bezoeken per uur',day:'Bezoeken per dag',week:'Bezoeken per week',month:'Bezoeken per maand'}[unit];
  const isHour=unit==='hour';$('#statsDayNav').hidden=!isHour;
  if(isHour){hourDay=data.from;$('#statsDayLabel').textContent=data.from===data.today?'Vandaag · '+fmt({day:'numeric',month:'long'},data.from):fmt({weekday:'long',day:'numeric',month:'long',year:'numeric'},data.from);$('#statsNextDay').disabled=data.from>=data.today;$('#statsToday').disabled=data.from===data.today;}
  let series=data.series||[];if(isHour&&data.from===data.today){const nowHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'}).format(new Date()));series=series.filter(x=>Number(x.bucket)<=nowHour);}
  $('#statsRange').textContent=`${isHour?fmt({weekday:'long',day:'numeric',month:'long',year:'numeric'},data.from):fmt({day:'numeric',month:'long',year:'numeric'},data.from)+' t/m '+fmt({day:'numeric',month:'long',year:'numeric'},data.to)} · totaal ${nf(data.totals.views)} bezoeken, ${nf(data.totals.visitors)} uniek`;
  chart(series);
  $('#statsTable').innerHTML=`<table><thead><tr><th>${isHour?'Uur':'Periode'}</th><th>Bezoeken</th><th>Uniek</th></tr></thead><tbody>${[...series].reverse().map(x=>`<tr><td>${label(x.bucket,true)}</td><td>${nf(x.views)}</td><td>${nf(x.visitors)}</td></tr>`).join('')}</tbody></table>`;
  bars($('#statsPages'),data.pages||[],'path',pageName);bars($('#statsSources'),data.sources||[],'source',s=>s);
  $('#statsSince').textContent=data.first_day?'Statistieken worden bijgehouden sinds '+fmt({day:'numeric',month:'long',year:'numeric'},data.first_day)+'.':'De teller is net gestart.';
 }

 async function load(){if(loading)return;loading=true;$('#statsRefresh').disabled=true;try{
  const access=typeof freshAccess==='function'?await freshAccess():null;
  const r=await MTF.fetch(API,{method:'POST',headers:{'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{'x-admin-key':token})},body:JSON.stringify({action:'report',unit,...(unit==='hour'&&hourDay?{day:hourDay}:{})})});
  const x=await r.json();if(!r.ok||!x.ok)throw Error(x.error||'Statistieken konden niet worden geladen');data=x;render();
 }catch(e){toast(e.message);}finally{loading=false;$('#statsRefresh').disabled=false;}}

 document.querySelectorAll('#statsUnits [data-unit]').forEach(b=>b.onclick=()=>{unit=b.dataset.unit;document.querySelectorAll('#statsUnits [data-unit]').forEach(x=>x.classList.toggle('active',x===b));load();});
 $('#statsRefresh').onclick=load;
 const shiftDay=n=>{const x=new Date((hourDay||data?.today||new Date().toISOString().slice(0,10))+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);hourDay=x.toISOString().slice(0,10);load();};
 $('#statsPrevDay').onclick=()=>shiftDay(-1);$('#statsNextDay').onclick=()=>shiftDay(1);$('#statsToday').onclick=()=>{hourDay='';load();};
 nav.addEventListener('click',()=>{panel('statsPanel');load();});
 let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!sec.hidden&&data)render();},150);});
 const prevRights=applyRights;applyRights=function(){prevRights();nav.hidden=!can('finance');};
 if(currentActor)nav.hidden=!can('finance');
})();
