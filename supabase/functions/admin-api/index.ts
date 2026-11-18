import { seasonalAdmin } from "./seasonal.ts";
import { receiptAdmin, receiptFolder } from './receipts.ts';
import { addonAdmin } from "./addons.ts";
import { selectAdminLocation, locationAdmin, authorizedService, getLocation } from "./locations.ts";
import { brand } from "./brand.ts";
import { taskAdmin } from "./tasks.ts";
import { menuCategoryAdmin } from "./menu-categories.ts";
import { scheduleAdmin } from "./schedule.ts";
import { promotionAdmin } from "./promotions.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { portalAction, requireRight, processMail } from "./portal.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Oude gedeelde beheersleutel: alleen actief als het Supabase-geheim MTF_ADMIN_KEY is ingesteld (nooit in de code).
const ADMIN_KEY = Deno.env.get("MTF_ADMIN_KEY") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-admin-key,authorization",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(data: unknown, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type":"application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:corsHeaders});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);


  const root = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json();
    const action = body?.action;
    if(action==='location_provision_manager'&&await authorizedService(req)){
      /* Beheerder voor een (nieuwe) vestiging uitnodigen. Alleen met de service-sleutel. */
      const email=String(body.email||'').trim().toLowerCase(),managerName=String(body.name||'').trim();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!managerName)throw Error('Geef e-mail en naam van de beheerder op');
      const location={data:await getLocation(root,body.slug)};if(location.data.is_primary)throw Error('Gebruik voor de hoofdvestiging het gewone uitnodigen');
      const scoped=root.schema(location.data.schema_name);
      const existing=await scoped.from('mtf_staff').select('user_id').eq('email',email).maybeSingle();if(existing.error)throw existing.error;
      if(existing.data&&body.prepare_only===true)return json({ok:true,prepared:true,existing:true});
      let invite=await root.auth.admin.generateLink({type:existing.data?'magiclink':'invite',email});let type=existing.data?'magiclink':'invite';
      if(invite.error){invite=await root.auth.admin.generateLink({type:'magiclink',email});type='magiclink';}
      if(invite.error)throw invite.error;
      const permissions=Object.fromEntries(['orders','menu','warehouse','costs','finance','users','shop','payments'].map(k=>[k,true]));
      const user=invite.data.user;const staff=existing.data?{error:null}:await scoped.from('mtf_staff').insert({user_id:user.id,email,name:managerName,owner:false,active:true,permissions});if(staff.error)throw staff.error;
      if(body.prepare_only===true)return json({ok:true,prepared:true});
      const url=brand.siteUrl+'/admin?location='+encodeURIComponent(location.data.slug)+'&token_hash='+encodeURIComponent(invite.data.properties.hashed_token)+'&type='+type;
      const job=await scoped.from('mtf_mail_jobs').insert({dedupe:'manager-'+location.data.slug+'-'+user.id+'-'+invite.data.properties.hashed_token,kind:'invite',to_email:email,payload:{name:managerName.split(' ')[0],url}}).select('id').single();if(job.error)throw job.error;
      const db={from:(t:string)=>scoped.from(t),rpc:(n:string,p:any)=>scoped.rpc(n,p),auth:root.auth,location:location.data};
      return json({ok:true,mail:await processMail(db,job.data.id)});
    }
    let user:any=null,legacy=false;
    const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
    if(bearer){const {data,error}=await root.auth.getUser(bearer);if(error||!data.user)return json({error:"Log opnieuw in"},401);user=data.user;}
    else if(ADMIN_KEY.length>=24&&req.headers.get("x-admin-key")===ADMIN_KEY){
      const owners=await root.from("mtf_staff").select("user_id").eq("owner",true).eq("active",true).not("claimed_at","is",null).limit(1);if(owners.error)throw owners.error;if(owners.data?.length)return json({error:"Log in met je persoonlijke eigenaarsaccount"},401);legacy=true;
    }else return json({error:"Geen toegang"},401);
    const {db:supabase,actor}=await selectAdminLocation(root,body,user,legacy);
    const locationResult=await locationAdmin(supabase,body,actor);if(locationResult!==null)return json(locationResult);
    const receiptResult=await receiptAdmin(supabase,body,actor);if(receiptResult!==null)return json(receiptResult);
    const addonResult=await addonAdmin(supabase,body,actor);if(addonResult!==null)return json(addonResult);
    const task=await taskAdmin(supabase,body,actor);if(task!==null)return json(task);
    const categoryAction=await menuCategoryAdmin(supabase,body,actor);if(categoryAction!==null)return json(categoryAction);
    const schedule=await scheduleAdmin(supabase,body,actor);if(schedule!==null)return json(schedule);
    const seasonal=await seasonalAdmin(supabase,body,actor);if(seasonal!==null)return json(seasonal);
    const promotion=await promotionAdmin(supabase,body,actor);if(promotion!==null)return json(promotion);
    const portal=await portalAction(supabase,body,actor);
    if(portal!==null)return json(portal);
    const required:any={get_shop_settings:"shop",set_shop_open:"shop",upload_menu_image:"menu",list_orders:"orders",update_status:"orders",upsert_menu:"menu",delete_menu:"menu"};
    if(action==="list_menu"){
      if(!actor.owner&&!actor.permissions?.menu&&!actor.permissions?.costs)return json({error:"Geen menurechten"},403);
    }else if(required[action])requireRight(actor,required[action]);
    else return json({error:"Onbekende actie"},400);

    if (action === "get_shop_settings") {
      const {data,error}=await supabase.from("shop_settings").select("*").eq("id",true).single();
      if(error) throw error;
      return json({settings:data});
    }
    if (action === "set_shop_open") {
      if(body.is_open===true&&!actor.location.published)return json({error:"Deze vestiging staat nog in voorbereiding. Rond eerst de vestigingsinstellingen af."},400);
      if(typeof body.is_open !== "boolean") return json({error:"Ongeldige winkelstatus"},400);
      const {data,error}=await supabase.from("shop_settings").update({is_open:body.is_open,updated_at:new Date().toISOString()}).eq("id",true).select("*").single();
      if(error) throw error;
      return json({settings:data});
    }
    if (action === "upload_menu_image") {
      const raw=String(body.data||"");
      const mime=String(body.mime||"");
      if(!["image/jpeg","image/png","image/webp"].includes(mime)) return json({error:"Gebruik JPG, PNG of WEBP"},400);
      if(raw.length>7_100_000 || raw.length<32) return json({error:"Afbeelding te groot of ontbreekt (maximaal 5 MB)"},400);
      const bin=atob(raw);if(bin.length>5_242_880)return json({error:"Afbeelding te groot"},400);
      const bytes=Uint8Array.from(bin,ch=>ch.charCodeAt(0));
      const ext=mime==="image/jpeg"?"jpg":mime==="image/png"?"png":"webp";
      const fileName=crypto.randomUUID()+"."+ext;
      const {error}=await supabase.storage.from("menu-images").upload(fileName,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});
      if(error)throw error;
      const {data}=supabase.storage.from("menu-images").getPublicUrl(fileName);
      return json({url:data.publicUrl});
    }
    if (action === "list_orders") {
      const { data, error } = await supabase.from("orders").select("*,receipt:mtf_receipts(folder,year,quarter)").order("created_at",{ascending:false}).limit(500);
      if (error) throw error;
      return json({orders:data});
    }

    if (action === "update_status") {
      const allowed = ["Nieuw","In bereiding","Klaar","Onderweg","Afgehaald","Bezorgd","Geannuleerd"];
      if (!body.id || !allowed.includes(body.status)) throw new Error("Ongeldige status");
      const folder=body.receipt_folder===undefined||body.receipt_folder===null?null:receiptFolder(body.receipt_folder);
      const { data, error } = await supabase.rpc('mtf_finish_order',{p_id:body.id,p_status:body.status,p_folder:folder,p_actor:actor.user_id||'eigenaar'});
      if (error) throw error;
      return json({order:data});
    }

    if (action === "list_menu") {
      const { data, error } = await supabase.from("menu_items").select("*").is("deleted_at",null).order("sort_order",{ascending:true});
      if (error) throw error;
      return json({menu:data});
    }

    if (action === "upsert_menu") {
      const item = body.item ?? {};
      if (!item.id || !item.name || !item.category || Number(item.price) < 0) throw new Error("Ongeldig menu-item");
      if(!Number.isFinite(Number(item.price)))throw new Error("Vul een geldige prijs in");
      const categoryCheck=await supabase.from("mtf_menu_categories").select("name").eq("name",String(item.category).trim()).maybeSingle();if(categoryCheck.error||!categoryCheck.data)throw new Error("Kies een bestaande categorie; maak die eerst aan bij Categorieën beheren.");
      const previousItem=await supabase.from("menu_items").select("deleted_at,spice_enabled").eq("id",String(item.id)).maybeSingle();if(previousItem.error)throw previousItem.error;if(previousItem.data?.deleted_at)throw new Error("Dit gerecht is verwijderd");
      if(item.spice_enabled!==undefined&&typeof item.spice_enabled!=="boolean")throw Error("Ongeldige pittigheidsinstelling");
      const payload = {
        id:String(item.id),
        name:String(item.name).trim(),
        description:String(item.description ?? ""),
        price:Number(item.price),
        category:String(item.category).trim(),
        image_url:item.image_url ? String(item.image_url).slice(0,1000) : null,
        active:item.active !== false,
        spice_enabled:item.spice_enabled??previousItem.data?.spice_enabled??false,
        sort_order:Number.isInteger(item.sort_order) ? item.sort_order : 0,
        updated_at:new Date().toISOString()
      };
      const { data, error } = await supabase.from("menu_items").upsert(payload).select("*").single();
      if (error) throw error;
      return json({item:data});
    }

    if (action === "delete_menu") {
      if (!body.id) throw new Error("Menu-item ontbreekt");
      const { error } = await supabase.from("menu_items").update({active:false,deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",body.id);
      if (error) throw error;
      return json({ok:true});
    }

    return json({error:"Onbekende actie"},400);
  } catch (e) {
    return json({error:e instanceof Error ? e.message : "Onbekende fout"},400);
  }
});
