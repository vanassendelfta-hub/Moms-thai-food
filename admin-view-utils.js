/* Pure functies voor zoeken, sorteren en het startoverzicht. */
(function(root){
 const closed=new Set(['Bezorgd','Afgehaald','Geannuleerd']);
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function active(o){return !closed.has(o.status);}
 function matches(o,view,date=today()){
  if(view==='active')return active(o);
  if(view==='today')return o.requested_date===date&&o.status!=='Geannuleerd';
  if(view==='unpaid')return o.status!=='Geannuleerd'&&o.payment_status!=='Betaald';
  return true;
 }
 function nextOrders(list){return list.filter(active).slice().sort((a,b)=>(String(a.requested_date)+' '+a.requested_time).localeCompare(String(b.requested_date)+' '+b.requested_time));}
 function stats(list,date=today()){return {new:list.filter(o=>o.status==='Nieuw').length,active:list.filter(active).length,today:list.filter(o=>matches(o,'today',date)).length,unpaid:list.filter(o=>matches(o,'unpaid')).length};}
 function filterStock(stock,{category='',query='',low=false}={}){const q=query.trim().toLowerCase();return stock.filter(s=>(!category||s.category_id===category)&&(!q||[s.name,s.notes].join(' ').toLowerCase().includes(q))&&(!low||Number(s.quantity)<=Number(s.minimum)));}
 root.MTFAdminViews={today,active,matches,nextOrders,stats,filterStock};
})(globalThis);
