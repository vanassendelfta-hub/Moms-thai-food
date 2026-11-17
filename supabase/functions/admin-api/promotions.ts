export async function promotionAdmin(db:any,body:any,actor:any){
 if(!String(body.action||'').startsWith('promotion_'))return null;
 if(!actor.owner)throw Error('Alleen de eigenaar kan coupons en reviews beheren');
 if(body.action==='promotion_get'){
  const s=await db.from('mtf_promotion_settings').select('*').eq('id',true).single();if(s.error)throw s.error;
  const rows=await db.from('mtf_coupons').select('code,email,kind,amount,minimum,expires_at,redeemed_at,disabled,product_id,product_name').order('created_at',{ascending:false}).limit(100);if(rows.error)throw rows.error;
  const products=await db.from("menu_items").select("id,name,price,active").order("name");if(products.error)throw products.error;const {google_api_key,...settings}=s.data;return {settings,google_key_set:!!google_api_key,coupons:rows.data,products:products.data};
 }
 if(body.action==='promotion_save'){
  const s=body.settings||{};const amount=s.kind==='product'?1:Number(s.amount),minimum=Number(s.minimum),days=Number(s.valid_days);
  if(!['fixed','percent','product'].includes(s.kind)||!Number.isFinite(amount)||amount<=0||amount>1000||(s.kind==='percent'&&amount>100)||!Number.isFinite(minimum)||minimum<0||!Number.isInteger(days)||days<1||days>365||typeof s.enabled!=='boolean')throw Error('Controleer de couponwaardes');
  if(s.kind==='product'){const product=await db.from("menu_items").select("id").eq("id",String(s.product_id||"")).eq("active",true).maybeSingle();if(product.error||!product.data)throw Error("Kies een beschikbaar cadeauproduct");}
  const update:any={product_id:s.kind==='product'?String(s.product_id):null,enabled:s.enabled,kind:s.kind,amount,minimum,valid_days:days,google_place_id:String(s.google_place_id||'').trim().slice(0,250),updated_at:new Date().toISOString()};
  if(typeof s.google_api_key==='string'&&s.google_api_key.trim())update.google_api_key=s.google_api_key.trim().slice(0,300);
  if(s.clear_google_key===true)update.google_api_key='';
  const r=await db.from('mtf_promotion_settings').update(update).eq('id',true);if(r.error)throw r.error;return {ok:true};
 }
 if(body.action==='promotion_disable'){
  const r=await db.from('mtf_coupons').update({disabled:true}).eq('code',String(body.code));if(r.error)throw r.error;return {ok:true};
 }
 throw Error('Onbekende couponactie');
}
