import { normalizeAddonItems } from "./addon-rules.ts";
import { getLocation, scopedDb, publicLocation, driveDistance } from "./locations.ts";
import "./order-rules.js";
const RuleFactory=(globalThis as any).MTFOrderRules;
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const Rules=RuleFactory.create();
    const body = await req.json();
    const root = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if(body.action==='locations'){const r=await root.from('mtf_locations').select('*').eq('published',true).order('created_at').order('slug');if(r.error)throw r.error;return new Response(JSON.stringify({ok:true,locations:r.data.map(publicLocation)}),{headers:{...corsHeaders,'Content-Type':'application/json'}});}
    const location=await getLocation(root,body.location||'spijkenisse');const supabase=scopedDb(root,location);
    if(!location.published)return new Response(JSON.stringify({ok:false,error:'Deze vestiging is niet beschikbaar.'}),{status:404,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if(body.action==='catalog'){const [m,c,a]=await Promise.all([supabase.from('menu_items').select('id,name,description,price,category,sort_order,image_url,spice_enabled').eq('active',true).is('deleted_at',null).order('sort_order').order('id'),supabase.from('mtf_menu_categories').select('name,sort_order,note,allows_sides,is_side').order('sort_order').order('name'),supabase.from('mtf_addons').select('id,name,price,menu_item_id,categories:mtf_addon_categories(category_name),source:menu_items(active,deleted_at)').eq('active',true).is('deleted_at',null).order('created_at').order('id')]);if(m.error||c.error||a.error)throw Error('Menu kon niet worden geladen');return new Response(JSON.stringify({ok:true,menu:m.data,categories:c.data,addons:a.data.filter((x:any)=>!x.menu_item_id||(x.source?.active&&!x.source.deleted_at)).map(({source,...x}:any)=>x),location:publicLocation(location)}),{headers:{...corsHeaders,'Content-Type':'application/json'}});}
    if(body.action==='seasonal_config'){const r=location.slug==='spijkenisse'?await supabase.rpc('mtf_seasonal_public',{}):{data:[],error:null};if(r.error)throw r.error;const winter=location.slug==='spijkenisse'?await supabase.from('mtf_campaign_controls').select('visible,enabled').eq('id','winter').single():{data:{visible:false,enabled:false},error:null};if(winter.error)throw winter.error;return new Response(JSON.stringify({ok:true,winter:winter.data,events:r.data}),{headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});}
    if(['contact_capture','contact_confirm','contact_unsubscribe'].includes(body.action)){
      if(location.slug!=='spijkenisse')throw Error('Niet beschikbaar bij deze vestiging.');
      const ip=req.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const limit=await supabase.rpc('mtf_promotion_rate',{p_bucket:'contacts:'+hash,p_limit:20});if(limit.error||!limit.data)throw Error('Probeer het later opnieuw.');
      const r=body.action==='contact_capture'?await supabase.rpc('mtf_contact_capture',{p_name:String(body.name||''),p_email:String(body.email||''),p_phone:String(body.phone||''),p_consent:body.consent===true,p_source:String(body.source||'formulier')}):await supabase.rpc('mtf_contact_token',{p_token:String(body.token||''),p_action:body.action==='contact_confirm'?'confirm':'unsubscribe'});if(r.error)throw Error(r.error.message);return new Response(JSON.stringify(r.data),{headers:{...corsHeaders,'Content-Type':'application/json'}});
    }
    if(body.action==='favorites'){const r=await supabase.rpc('mtf_home_favorites',{});if(r.error)throw r.error;return new Response(JSON.stringify(r.data),{headers:{...corsHeaders,'Content-Type':'application/json'}});}
    const closureRows=await supabase.from("mtf_closed_dates").select("day,reason").gte("day",Rules.clock().date).order("day");if(closureRows.error)throw new Error("Beschikbaarheid tijdelijk niet bereikbaar");const holidays=location.slug==='spijkenisse'?await supabase.from('mtf_seasonal_events').select('event_date,kind'): {data:[],error:null};if(holidays.error)throw holidays.error;Rules.setClosures([...(closureRows.data||[]),...(holidays.data||[]).filter((x:any)=>x.kind!=='newyear').map((x:any)=>({day:x.event_date,reason:'Bestel via het aparte feestdagenmenu'}))]);
    // Openingstijden per weekdag uit de database (fase 1b).
    const hoursRows=await supabase.from("mtf_opening_hours").select("weekday,open_time,close_time,order_cutoff").order("weekday");if(hoursRows.error)throw new Error("Openingstijden tijdelijk niet bereikbaar");Rules.setHours(hoursRows.data||[]);
    if(body?.action==="schedule")return new Response(JSON.stringify({ok:true,closures:closureRows.data,hours:hoursRows.data||[]}),{headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});
    if (body?.action === "shop_status") {
      const {data, error} = await supabase.from("shop_settings").select("is_open,message").eq("id",true).single();
      if(error) throw error;
      return new Response(JSON.stringify({ok:true,is_open:data.is_open&&location.published,message:location.published?data.message:"Deze vestiging is nog in voorbereiding."}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }
    if(!location.published)throw new Error("Deze vestiging is nog niet geopend voor bestellingen.");
    const {data: currentShop, error: shopError} = await supabase.from("shop_settings").select("is_open,message").eq("id",true).single();
    if(shopError) throw shopError;
    if(!currentShop?.is_open) return new Response(JSON.stringify({ok:false,error:currentShop?.message || "Online bestellen is momenteel gesloten."}),{status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});
    const {
      name, email, phone, method, address, city,
      date, time, payment, notes = "", items
    } = body ?? {};

    if (!name || String(name).trim().length < 2) throw new Error("Naam ontbreekt");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) throw new Error("Ongeldig e-mailadres");
    if (!phone || String(phone).trim().length < 6) throw new Error("Telefoonnummer ontbreekt");
    if (!["Bezorgen","Afhalen"].includes(method)) throw new Error("Ongeldige bestelwijze");
    if (method === "Bezorgen" && (!address || !city)) throw new Error("Bezorgadres ontbreekt");
    if(!body.seasonal_event&&location.slug==='spijkenisse'){const e=await supabase.from('mtf_seasonal_events').select('id,product_id').eq('kind','newyear').eq('event_date',date).maybeSingle();if(e.error)throw e.error;if(e.data&&Array.isArray(items)&&items.some((x:any)=>x.id===e.data.product_id))body.seasonal_event=e.data.id;}
    if(body.seasonal_event&&location.slug!=='spijkenisse')throw Error('Feestdagenmenu is alleen beschikbaar bij Spijkenisse.');
    if(!body.seasonal_event)Rules.validateMoment(date,time);
    if (!Array.isArray(items) || items.length === 0) throw new Error("Bestelling is leeg");
    if (items.length > 50) throw new Error("Te veel bestelregels");

    const ids=[...new Set(items.flatMap((x:any)=>[typeof x?.id==='string'?x.id:'',...(typeof x?.side_id==='string'?[x.side_id]:[])]))];
    const addonIds=[...new Set(items.map((x:any)=>x?.addon_id).filter(Boolean))];
    if(addonIds.some((id:any)=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))throw Error('Ongeldige extra');
    const menuResult=await supabase.from('menu_items').select('id,name,price,active,category,deleted_at,spice_enabled').in('id',ids).eq('active',true).is('deleted_at',null);if(menuResult.error)throw menuResult.error;
    const addonResult=addonIds.length?await supabase.from('mtf_addons').select('*,categories:mtf_addon_categories(category_name),source:menu_items(active,deleted_at)').in('id',addonIds):{data:[],error:null};if(addonResult.error)throw addonResult.error;
    const categoryResult=await supabase.from('mtf_menu_categories').select('name,allows_sides,is_side');if(categoryResult.error)throw categoryResult.error;
    const normalizedItems=normalizeAddonItems(items,menuResult.data,addonResult.data,categoryResult.data);

    const subtotalCents=normalizedItems.reduce((sum:number,i:any)=>sum+Math.round(i.price*100)*i.qty,0);
    const {subtotal,delivery_fee,total}=Rules.price(subtotalCents,method);
    if(method==='Bezorgen'&&location.delivery_limit_m){if(!/\d/.test(String(address)))throw Error('Vul straat en huisnummer in');const ip=req.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';const hashed=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)))).map(x=>x.toString(16).padStart(2,'0')).join('');for(const [bucket,limit] of [['route:'+hashed,20],['route:global',500]] as const){const r=await supabase.rpc('mtf_promotion_rate',{p_bucket:bucket,p_limit:limit});if(r.error||!r.data)throw Error('Te veel adrescontroles. Probeer het later opnieuw.');}const distance=await driveDistance(location,String(address).trim()+', '+String(city).trim());if(distance>location.delivery_limit_m)throw new Error('Dit adres ligt buiten het bezorggebied van '+(location.delivery_limit_m/1000)+' km rijafstand ('+(distance/1000).toFixed(1)+' km). Kies afhalen of een andere vestiging.');}
    let seasonal:any=null;if(body.seasonal_event){if(String(body.coupon_code||'').trim())throw Error('Feestdagenacties zijn niet combineerbaar met kortingscodes.');const r=await supabase.rpc('mtf_seasonal_quote',{p_event:String(body.seasonal_event),p_date:date,p_time:time,p_items:normalizedItems,p_email:String(email),p_phone:String(phone)});if(r.error)throw Error(r.error.message);seasonal=r.data;}
    let discount=0;if(String(body.coupon_code||'').trim().toUpperCase()==='WELKOM10'){if(location.slug!=='spijkenisse')throw Error('WELKOM10 is alleen geldig bij Spijkenisse.');const c=await supabase.rpc('mtf_welkom10_check',{p_email:String(email),p_phone:String(phone),p_name:String(name),p_subtotal:subtotal});if(c.error)throw Error(c.error.message);discount=Number(c.data);}else if(body.coupon_code){const c=await supabase.rpc("mtf_coupon_discount_items",{p_code:String(body.coupon_code).slice(0,80),p_email:String(email).trim().toLowerCase(),p_subtotal:subtotal,p_items:normalizedItems});if(c.error)throw new Error(c.error.message);discount=Number(c.data);}
    if(body.action==="quote")return new Response(JSON.stringify({ok:true,quote:seasonal?{...seasonal,...Rules.price(Math.round(Number(seasonal.subtotal)*100),method),discount_amount:0}: {subtotal,delivery_fee,discount_amount:discount,total:total-discount}}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    // Opnieuw controleren vlak voor opslag, ook bij overschrijden van de bestelgrens tijdens een verzoek.
    if(!body.seasonal_event)Rules.validateMoment(date,time);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        ...(location.slug==='spijkenisse'?{seasonal_event:body.seasonal_event||null}:{}),
        coupon_code: String(body.coupon_code||"").trim().toUpperCase().slice(0,80)||null,
        customer_name: String(name).trim(),
        customer_email: String(email).trim().toLowerCase(),
        phone: String(phone).trim(),
        method,
        address: method === "Bezorgen" ? String(address).trim() : null,
        city: method === "Bezorgen" ? String(city).trim() : null,
        requested_date: date,
        requested_time: time,
        payment: String(payment ?? "Contant"),
        notes: String(notes ?? "").slice(0, 1000),
        subtotal,
        delivery_fee,
        total,
        items: normalizedItems
      })
      .select("id,order_number,created_at,subtotal,delivery_fee,total,discount_amount,coupon_code")
      .single();

    if (orderError) throw orderError;

    return new Response(JSON.stringify({ ok: true, order }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Onbekende fout" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
