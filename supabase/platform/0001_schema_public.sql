-- Basisschema voor een nieuwe klantdatabase (schema public = hoofdvestiging). Vervang {{MERKNAAM}} door de merknaam.
-- Schema public (bron: public), gegenereerd 2026-11-18
set check_function_bodies = off;
create schema if not exists public;

CREATE OR REPLACE FUNCTION public.enqueue_order_emails()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin insert into public.order_email_outbox(order_id,kind) values(new.id,'restaurant'),(new.id,'customer') on conflict(order_id,kind) do nothing; return new; end; $function$
;

CREATE OR REPLACE FUNCTION public.mtf_adjust_stock(p_id uuid, p_delta numeric, p_reason text, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
 if p_delta=0 or p_reason is null or length(trim(p_reason))=0 then raise exception 'Aantal en reden verplicht'; end if;
 update public.mtf_stock set quantity=quantity+p_delta where id=p_id and active;
 if not found then raise exception 'Artikel niet gevonden';end if;
 insert into public.mtf_movements(stock_id,delta,reason,actor) values(p_id,p_delta,p_reason,p_actor);
end$function$
;

CREATE OR REPLACE FUNCTION public.mtf_apply_order_coupon()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k bigint;
begin
 for k in select distinct x from unnest(array[hashtextextended('mtf-email:'||coalesce(public.mtf_identity_email(new.customer_email),''),0),hashtextextended('mtf-phone:'||coalesce(public.mtf_identity_phone(new.phone),''),0)]) x order by x loop perform pg_advisory_xact_lock(k);end loop;
 new.coupon_code:=nullif(upper(trim(new.coupon_code)),'');new.discount_amount:=0;
 if new.coupon_code='WELKOM3' then
  raise exception 'De loempia-actie is vervangen. Gebruik WELKOM10 voor 10 procent korting boven €35.';
 elsif new.coupon_code='WELKOM10' then
  new.discount_amount:=public.mtf_welkom10_check(new.customer_email,new.phone,new.customer_name,new.subtotal);
  insert into public.mtf_welkom10_redemptions(order_id,email_key,phone_key) values(new.id,public.mtf_identity_email(new.customer_email),public.mtf_identity_phone(new.phone));
 elsif new.coupon_code like 'NIEUW-%' then
 perform 1 from public.mtf_newyear_vouchers where code=new.coupon_code for update;
 new.discount_amount:=public.mtf_newyear_discount(new.coupon_code,new.customer_email,new.subtotal);
 if not exists(select 1 from public.mtf_newyear_vouchers where code=new.coupon_code and phone_key=public.mtf_identity_phone(new.phone)) then raise exception 'Gebruik het telefoonnummer van je borrelpakketbestelling.';end if;
 update public.mtf_newyear_vouchers set redeemed_at=now(),redeemed_order_id=new.id where code=new.coupon_code;
 elsif new.coupon_code is not null then
  perform 1 from public.mtf_coupons where code=new.coupon_code for update;
  new.discount_amount:=public.mtf_coupon_discount_items(new.coupon_code,new.customer_email,new.subtotal,new.items);
  update public.mtf_coupons set redeemed_at=now(),redeemed_order_id=new.id where code=new.coupon_code;
 end if;
 new.total:=new.subtotal+new.delivery_fee-new.discount_amount;return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_archive_order(p_id uuid, p_folder integer, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.orders;r public.mtf_receipts; snap jsonb;
begin
 if p_folder is null or p_folder not between 1 and 3 then raise exception 'Kies Map 1, 2 of 3';end if;
 select * into o from public.orders where id=p_id for update;if not found then raise exception 'Bestelling niet gevonden';end if;
 if o.status not in ('Afgehaald','Bezorgd') then raise exception 'Rond de bestelling eerst af';end if;
 snap=jsonb_build_object('order_number',o.order_number,'customer_name',o.customer_name,'address',o.address,'city',o.city,'method',o.method,'requested_date',o.requested_date,'requested_time',o.requested_time,'payment',o.payment,'payment_status',o.payment_status,'items',o.items,'subtotal',o.subtotal,'delivery_fee',o.delivery_fee,'discount_amount',coalesce(to_jsonb(o)->'discount_amount','0'::jsonb),'total',o.total);
 insert into public.mtf_receipts(folder,document_date,kind,description,amount,order_id,snapshot,created_by)
 values(p_folder,o.requested_date,'order','Bestelbon '||o.order_number,o.total,o.id,snap,p_actor)
 on conflict(order_id) do update set folder=excluded.folder,updated_at=now() returning * into r;
 return to_jsonb(r);
end$function$
;

CREATE OR REPLACE FUNCTION public.mtf_capture_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare line jsonb; c public.mtf_dish_costs; sc public.mtf_dish_costs; pack jsonb; s public.mtf_stock; snap jsonb='[]'; packs jsonb; recipes jsonb; cost numeric=0; linecost numeric; known boolean=true; qty numeric; extra_cost numeric;
begin
 for line in select value from jsonb_array_elements(new.items) loop
  select * into c from public.mtf_dish_costs where dish_id=line->>'id';
  if not found or c.ingredient_cost is null then known=false; end if;
  linecost=coalesce(c.ingredient_cost,0);recipes=coalesce(c.packaging,'[]');
  if nullif(line->>'side_id','') is not null then
   select * into sc from public.mtf_dish_costs where dish_id=line->>'side_id';
   if not found or sc.ingredient_cost is null then known=false;end if;
   linecost=linecost+coalesce(sc.ingredient_cost,0);recipes=recipes||coalesce(sc.packaging,'[]');
  end if;
  if nullif(line->>'addon_id','') is not null then
   select a.cost into extra_cost from public.mtf_addons a where a.id=(line->>'addon_id')::uuid;
   if not found or extra_cost is null then known=false;else linecost=linecost+extra_cost;end if;
  end if;
  packs='[]';qty=(line->>'qty')::numeric;
  for pack in select value from jsonb_array_elements(recipes) loop
   select * into s from public.mtf_stock where id=(pack->>'id')::uuid and packaging and active;
   if not found then known=false;continue;end if;
   linecost=linecost+s.unit_cost*(pack->>'qty')::numeric;
   packs=packs||jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name,'qty',(pack->>'qty')::numeric,'unit_cost',s.unit_cost));
  end loop;
  snap=snap||jsonb_build_array(jsonb_build_object('id',line->>'id','name',line->>'name','qty',qty,'unit_cost',linecost,'packaging',packs));
  cost=cost+linecost*qty;
 end loop;
 insert into public.mtf_order_costs(order_id,snapshot,cost,complete) values(new.id,snap,cost,known);
 return new;
end$function$
;

CREATE OR REPLACE FUNCTION public.mtf_capture_order_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
insert into public.mtf_contacts(email,name,phone,source) values(lower(trim(new.customer_email)),left(new.customer_name,100),left(new.phone,40),'bestelling') on conflict(email) do update set name=excluded.name,phone=excluded.phone;return new;end;$function$
;

CREATE OR REPLACE FUNCTION public.mtf_confirm_coupon(p_hash text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.mtf_coupon_members;s public.mtf_promotion_settings;c public.mtf_coupons;pn text;
begin
 select * into m from public.mtf_coupon_members where token_hash=p_hash for update;
 if not found or m.token_expires<=now() then raise exception 'Bevestigingslink ongeldig of verlopen. Meld je opnieuw aan.';end if;
 select * into c from public.mtf_coupons where email=m.email;
 if found then return to_jsonb(c)-'email'-'redeemed_order_id';end if;
 select * into s from public.mtf_promotion_settings where id=true;
 if not s.enabled then raise exception 'De couponactie is momenteel niet actief';end if;
 if s.kind='product' then select name into pn from public.menu_items where id=s.product_id and active=true;if not found then raise exception 'Het cadeauproduct is momenteel niet beschikbaar';end if;end if;
 update public.mtf_coupon_members set confirmed_at=now(),subscribed=true where email=m.email;
 insert into public.mtf_coupons(code,email,kind,amount,minimum,expires_at,product_id,product_name) values(p_code,m.email,s.kind,s.amount,s.minimum,now()+make_interval(days=>s.valid_days),case when s.kind='product' then s.product_id else null end,pn) returning * into c;
 return to_jsonb(c)-'email'-'redeemed_order_id';
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_consume_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.mtf_order_costs; l jsonb;p jsonb; factor int; delta numeric;
begin
 select * into c from public.mtf_order_costs where order_id=new.id for update;
 if not found then return new;end if;
 if new.status in ('Bezorgd','Afgehaald') and not c.consumed then factor=-1;
 elsif new.status not in ('Bezorgd','Afgehaald') and c.consumed then factor=1;
 else return new;end if;
 for l in select value from jsonb_array_elements(c.snapshot) loop
  for p in select value from jsonb_array_elements(l->'packaging') loop
   delta=factor*(p->>'qty')::numeric*(l->>'qty')::numeric;
   update public.mtf_stock set quantity=quantity+delta where id=(p->>'id')::uuid;
   insert into public.mtf_movements(stock_id,delta,reason,order_id,actor) values((p->>'id')::uuid,delta,case when factor=-1 then 'Verbruik afgeronde bestelling' else 'Terugboeking bestelling' end,new.id,'orderstatus');
  end loop;
 end loop;
 update public.mtf_order_costs set consumed=(factor=-1) where order_id=new.id;
 return new;
end$function$
;

CREATE OR REPLACE FUNCTION public.mtf_contact_capture(p_name text, p_email text, p_phone text, p_consent boolean DEFAULT false, p_source text DEFAULT 'formulier'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.mtf_contacts;begin
p_email:=lower(trim(p_email));if p_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(p_email)>254 or length(trim(p_name))<2 or length(regexp_replace(p_phone,'[^0-9]','','g'))<8 then raise exception 'Controleer naam, e-mail en telefoonnummer.';end if;
insert into public.mtf_contacts(email,name,phone,source) values(p_email,left(trim(p_name),100),left(p_phone,40),left(p_source,80)) on conflict(email) do update set name=excluded.name,phone=excluded.phone;
select * into c from public.mtf_contacts where email=p_email for update;
if p_consent and c.status not in('subscribed','pending') then
update public.mtf_contacts set status='pending',confirm_token=encode(extensions.gen_random_bytes(32),'hex'),requested_at=now(),consent_text='Ik ontvang graag aanbiedingen en nieuws van {{MERKNAAM}} per e-mail. Afmelden kan altijd.' where email=p_email returning * into c;
insert into public.mtf_mail_jobs(dedupe,kind,to_email,payload) values('confirm:'||c.confirm_token,'marketing_confirm',p_email,jsonb_build_object('email',p_email,'token',c.confirm_token));
end if;return jsonb_build_object('ok',true,'message',case when p_consent then 'Controleer je inbox om je nieuwsbriefinschrijving te bevestigen.' else 'Gegevens ontvangen.' end);end;$function$
;

CREATE OR REPLACE FUNCTION public.mtf_contact_token(p_token text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
if p_token!~'^[0-9a-f]{64}$' then raise exception 'Ongeldige link.';end if;
if p_action='confirm' then
update public.mtf_contacts set status='subscribed',confirmed_at=now(),unsubscribed_at=null where confirm_token=p_token and status='pending' and requested_at>now()-interval '7 days';
if not found then raise exception 'Deze bevestigingslink is verlopen of al gebruikt.';end if;
elsif p_action='unsubscribe' then update public.mtf_contacts set status='unsubscribed',unsubscribed_at=now() where unsubscribe_token=p_token;if not found then raise exception 'Ongeldige afmeldlink.';end if;
else raise exception 'Ongeldige actie.';end if;return jsonb_build_object('ok',true);end;$function$
;

CREATE OR REPLACE FUNCTION public.mtf_coupon_discount(p_code text, p_email text, p_subtotal numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.mtf_coupons; begin
 if nullif(trim(p_code),'') is null then return 0; end if;
 select * into c from public.mtf_coupons where code=upper(trim(p_code));
 if not found or c.email<>lower(trim(p_email)) or c.disabled or c.redeemed_at is not null or c.expires_at<=now() then raise exception 'Coupon ongeldig, verlopen, gebruikt of gekoppeld aan een ander e-mailadres'; end if;
 if p_subtotal<c.minimum then raise exception 'Voor deze coupon is minimaal € % aan gerechten nodig',c.minimum; end if;
 return least(p_subtotal,case when c.kind='percent' then round(p_subtotal*c.amount/100,2) else c.amount end);
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_coupon_discount_items(p_code text, p_email text, p_subtotal numeric, p_items jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.mtf_coupons;product_price numeric;product_active boolean;begin
 if upper(trim(p_code)) like 'NIEUW-%' then return public.mtf_newyear_discount(p_code,p_email,p_subtotal);end if;
 if nullif(trim(p_code),'') is null then return 0;end if;
 select * into c from public.mtf_coupons where code=upper(trim(p_code));
 if not found or c.email<>lower(trim(p_email)) or c.disabled or c.redeemed_at is not null or c.expires_at<=now() then raise exception 'Coupon ongeldig, verlopen, gebruikt of gekoppeld aan een ander e-mailadres';end if;
 if p_subtotal<c.minimum then raise exception 'Voor deze coupon is minimaal € % aan gerechten nodig',c.minimum;end if;
 if c.kind<>'product' then return public.mtf_coupon_discount(p_code,p_email,p_subtotal);end if;
 select price,active into product_price,product_active from public.menu_items where id=c.product_id;
 if not found or not product_active then raise exception 'Het cadeauproduct is momenteel niet beschikbaar. Neem contact op met ons.';end if;
 if not exists(select 1 from jsonb_array_elements(p_items) x where x->>'id'=c.product_id and (x->>'qty')::numeric>=1) then raise exception 'Voeg % toe aan je winkelmandje om deze coupon te gebruiken',c.product_name;end if;
 return least(p_subtotal,product_price);
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_dish_popularity(p_location text DEFAULT NULL::text)
 RETURNS TABLE(dish_id text, n bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s text := public.mtf_location_schema(p_location);
begin
  return query execute format($q$
    with x as (select e from %I.orders o, jsonb_array_elements(o.items) e where o.status <> 'Geannuleerd' and jsonb_typeof(o.items)='array')
    select c.id, sum(c.q)::bigint from (
      select e->>'id' id, greatest(coalesce((e->>'qty')::int,0),0) q from x
      union all select e->>'side_id', greatest(coalesce((e->>'qty')::int,0),0) from x where e->>'side_id' is not null) c
    where c.id is not null group by c.id$q$, s);
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_enqueue_review_mail()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_slug text;
begin
  if new.status in ('Bezorgd','Afgehaald') and old.status is distinct from new.status
     and coalesce(trim(new.customer_email),'') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    select slug into v_slug from public.mtf_locations where schema_name = tg_table_schema;
    if v_slug is null then return new; end if;
    insert into public.mtf_review_mails(location_slug, order_id, to_email, name, send_after)
    values (v_slug, new.id, trim(new.customer_email), coalesce(new.customer_name,''), now() + interval '1 hour')
    on conflict (location_slug, order_id) do nothing;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_finish_order(p_id uuid, p_status text, p_folder integer, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.orders;
begin
 if p_status is null or p_status not in ('Nieuw','In bereiding','Klaar','Onderweg','Afgehaald','Bezorgd','Geannuleerd') then raise exception 'Ongeldige status';end if;
 if p_folder is not null and (p_folder not between 1 and 3 or p_status not in ('Afgehaald','Bezorgd')) then raise exception 'Een bestelbon kan alleen bij afronden worden bewaard in Map 1, 2 of 3';end if;
 update public.orders set status=p_status,updated_at=now() where id=p_id returning * into o;
 if not found then raise exception 'Bestelling niet gevonden';end if;
 if p_folder is not null then perform public.mtf_archive_order(p_id,p_folder,p_actor);end if;
 return to_jsonb(o);
end$function$
;

CREATE OR REPLACE FUNCTION public.mtf_game_contact_optin(p_email text, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.mtf_contacts;
begin
 insert into public.mtf_contacts(email,name,phone,source) values(p_email,left(p_name,100),'','game')
 on conflict(email) do nothing;
 select * into c from public.mtf_contacts where email=p_email for update;
 if c.status in('subscribed') then return null; end if;
 if c.status='pending' and c.requested_at>now()-interval '10 minutes' then return null; end if;
 update public.mtf_contacts set status='pending',confirm_token=encode(extensions.gen_random_bytes(32),'hex'),requested_at=now(),
  consent_text='Game: Ja, stuur mij ook acties en nieuws van {{MERKNAAM}} per e-mail. Afmelden kan altijd.'
 where email=p_email returning * into c;
 insert into public.mtf_mail_jobs(dedupe,kind,to_email,payload,status) values('confirm:'||c.confirm_token,'marketing_confirm',p_email,jsonb_build_object('email',p_email,'token',c.confirm_token,'source','game'),'processing');
 return c.confirm_token;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_game_record(p_email text, p_name text, p_score integer, p_optin boolean, p_consent text, p_ip text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid uuid;
begin
 insert into public.mtf_game_players(email,name,plays,best_score,last_score,marketing_optin,marketing_consent_text,marketing_requested_at)
 values(p_email,p_name,1,p_score,p_score,p_optin,case when p_optin then p_consent end,case when p_optin then now() end)
 on conflict(email) do update set name=excluded.name,plays=public.mtf_game_players.plays+1,
  best_score=greatest(public.mtf_game_players.best_score,excluded.best_score),last_score=excluded.last_score,last_played_at=now(),
  marketing_optin=public.mtf_game_players.marketing_optin or excluded.marketing_optin,
  marketing_consent_text=coalesce(excluded.marketing_consent_text,public.mtf_game_players.marketing_consent_text),
  marketing_requested_at=coalesce(excluded.marketing_requested_at,public.mtf_game_players.marketing_requested_at);
 insert into public.mtf_game_scores(email,name,score,ip_hash) values(p_email,p_name,p_score,p_ip) returning id into sid;
 return sid;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_home_favorites()
 RETURNS TABLE(dish_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with seeds(id,position) as (values ('tom-kha-kai',1),('groene-curry-rund',2),('loempia-per-2',3),('pastei-per-4',4)),
counts as (select i->>'id' as id,sum((i->>'qty')::numeric) as qty from public.orders o cross join lateral jsonb_array_elements(o.items) i where o.status<>'Geannuleerd' and o.created_at>=(select favorites_since from public.mtf_home_settings where id=true) and o.created_at>=now()-interval '30 days' group by i->>'id')
select m.id from public.menu_items m left join counts c on c.id=m.id left join seeds s on s.id=m.id where m.active and (c.qty>0 or s.position is not null) order by coalesce(c.qty,0) desc,coalesce(s.position,99),m.id limit 4;
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_identity_email(v text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
 select case when split_part(lower(trim(v)),'@',2) in ('gmail.com','googlemail.com') then replace(split_part(split_part(lower(trim(v)),'@',1),'+',1),'.','')||'@gmail.com' else lower(trim(v)) end
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_identity_phone(v text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
 select case when left(n,2)='00' then substring(n from 3) when left(n,1)='0' then '31'||substring(n from 2) else n end from (select regexp_replace(v,'[^0-9]','','g') n) s
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_location_schema(p_slug text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select schema_name from public.mtf_locations where slug = p_slug),
    (select schema_name from public.mtf_locations where is_primary),
    'public');
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_marketing_queue(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n integer;begin
perform 1 from public.mtf_marketing_campaigns where id=p_id and status='draft' for update;if not found then raise exception 'Deze campagne is al ingepland.';end if;
insert into public.mtf_mail_jobs(dedupe,kind,to_email,payload) select 'marketing:'||p_id||':'||email,'marketing',email,jsonb_build_object('campaign_id',p_id,'email',email) from public.mtf_contacts where status='subscribed' on conflict(dedupe) do nothing;get diagnostics n=row_count;
update public.mtf_marketing_campaigns set status='queued' where id=p_id;return n;end;$function$
;

CREATE OR REPLACE FUNCTION public.mtf_newyear_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin if new.status='Geannuleerd' and old.status<>'Geannuleerd' then update public.mtf_newyear_vouchers set disabled=true where order_id=new.id;update public.mtf_mail_jobs set status='cancelled',last_error='Bestelling geannuleerd' where kind='newyear' and payload->>'order_id'=new.id::text and status<>'sent';end if;return new;end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_newyear_discount(p_code text, p_email text, p_subtotal numeric, p_at timestamp with time zone DEFAULT now())
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v public.mtf_newyear_vouchers;d date=(p_at at time zone 'Europe/Amsterdam')::date;
begin select * into v from public.mtf_newyear_vouchers where code=upper(trim(p_code));
 if not found or v.disabled or v.redeemed_at is not null or v.email_key<>public.mtf_identity_email(p_email) or d<v.valid_from or d>v.valid_until or not exists(select 1 from public.orders where id=v.order_id and status<>'Geannuleerd') then raise exception 'Nieuwjaarscode ongeldig, nog niet geldig, verlopen of al gebruikt. Gebruik het e-mailadres van je borrelpakketbestelling.';end if;
 if p_subtotal is null or p_subtotal<=0 then raise exception 'Kies je gerechten.';end if;return round(p_subtotal*v.percent/100,2);end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_newyear_issue()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e public.mtf_seasonal_events;c text;v public.mtf_newyear_vouchers;
begin
 select * into e from public.mtf_seasonal_events where kind='newyear' and event_date=new.requested_date and enabled;
 if not found or not exists(select 1 from jsonb_array_elements(new.items) x where x->>'id'=e.product_id and (x->>'qty')::numeric>=1) then return new;end if;
 c='NIEUW-'||upper(replace(gen_random_uuid()::text,'-',''));
 insert into public.mtf_newyear_vouchers(code,order_id,email_key,phone_key,percent,valid_from,valid_until) values(c,new.id,public.mtf_identity_email(new.customer_email),public.mtf_identity_phone(new.phone),e.voucher_percent,e.voucher_from,e.voucher_until) on conflict do nothing returning * into v;
 if found then insert into public.mtf_mail_jobs(dedupe,kind,to_email,payload) values('newyear:'||v.code,'newyear',new.customer_email,jsonb_build_object('code',v.code,'order_id',new.id,'name',new.customer_name,'percent',v.percent,'valid_from',v.valid_from,'valid_until',v.valid_until));end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_promotion_rate(p_bucket text, p_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n integer;begin
 insert into public.mtf_promotion_limits(bucket) values(p_bucket)
 on conflict(bucket) do update set count=case when mtf_promotion_limits.started_at<now()-interval '1 hour' then 1 else mtf_promotion_limits.count+1 end,started_at=case when mtf_promotion_limits.started_at<now()-interval '1 hour' then now() else mtf_promotion_limits.started_at end returning count into n;
 return n<=p_limit;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_queue_task_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into public.mtf_mail_jobs(dedupe,kind,to_email,payload)
 select 'task-assignment-'||gen_random_uuid()::text,'task',s.email,jsonb_build_object('task_id',t.id,'user_id',s.user_id,'name',s.name,'title',t.title,'information',t.information,'deadline',t.deadline,'creator',t.created_by_label)
 from public.mtf_tasks t join public.mtf_staff s on s.user_id=new.user_id and s.active where t.id=new.task_id;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_receipt_periods()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select folder,year,quarter,count(*) as count,coalesce(sum(amount) filter(where kind='order'),0) as orders_total,coalesce(sum(amount) filter(where kind='upload'),0) as uploads_total,coalesce(sum(amount) filter(where expense_id is not null),0) as expenses_total from public.mtf_receipts group by folder,year,quarter order by year desc,quarter desc,folder)t;
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_save_addon(p_id uuid, p_name text, p_price numeric, p_cost numeric, p_menu_item_id text, p_active boolean, p_categories text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid;
begin
 if p_name is null or char_length(trim(p_name)) not between 1 and 100 or p_price is null or p_price<0 or p_price>1000 or round(p_price,2)<>p_price or p_active is null or (p_cost is not null and p_cost<0) then raise exception 'Controleer naam, prijs en kostprijs';end if;
 if coalesce(cardinality(p_categories),0)=0 or cardinality(p_categories)<>(select count(distinct c) from unnest(p_categories)c) or exists(select 1 from unnest(p_categories)c where not exists(select 1 from public.mtf_menu_categories where name=c)) then raise exception 'Kies één of meerdere bestaande categorieën';end if;
 if p_menu_item_id is not null and not exists(select 1 from public.menu_items where id=p_menu_item_id and (not p_active or (active and deleted_at is null))) then raise exception 'Kies een zichtbaar gerecht of kies Eigen extra';end if;
 if p_id is null then insert into public.mtf_addons(name,price,cost,menu_item_id,active) values(trim(p_name),p_price,p_cost,p_menu_item_id,p_active) returning id into uid;
 else uid=p_id;update public.mtf_addons set name=trim(p_name),price=p_price,cost=p_cost,menu_item_id=p_menu_item_id,active=p_active,updated_at=clock_timestamp() where id=uid and deleted_at is null; if not found then raise exception 'Deze extra bestaat niet meer. Vernieuw de lijst.';end if;end if;
 delete from public.mtf_addon_categories where addon_id=uid and not(category_name=any(p_categories));
 insert into public.mtf_addon_categories(addon_id,category_name) select uid,c from unnest(p_categories)c on conflict do nothing;
 return uid;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_save_menu_order(categories jsonb, items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if jsonb_typeof(categories) is distinct from 'array' or jsonb_typeof(items) is distinct from 'array' then raise exception 'Ongeldige menuvolgorde'; end if;
 lock table public.mtf_menu_categories,public.menu_items in share row exclusive mode;
 if exists(select 1 from jsonb_array_elements(categories) v where jsonb_typeof(v) <> 'string') or exists(select 1 from jsonb_array_elements(items) v where jsonb_typeof(v) <> 'string') then raise exception 'Ongeldige menuvolgorde'; end if;
 if jsonb_array_length(categories)<>(select count(*) from public.mtf_menu_categories) or jsonb_array_length(categories)<>(select count(distinct v) from jsonb_array_elements_text(categories) v) or exists(select 1 from jsonb_array_elements_text(categories) v where not exists(select 1 from public.mtf_menu_categories c where c.name=v)) then raise exception 'De categorieën zijn intussen gewijzigd. Open de volgorde opnieuw.'; end if;
 if jsonb_array_length(items)<>(select count(*) from public.menu_items where deleted_at is null) or jsonb_array_length(items)<>(select count(distinct v) from jsonb_array_elements_text(items) v) or exists(select 1 from jsonb_array_elements_text(items) v where not exists(select 1 from public.menu_items m where m.id=v and m.deleted_at is null)) then raise exception 'Het menu is intussen gewijzigd. Open de volgorde opnieuw.'; end if;
 update public.mtf_menu_categories c set sort_order=o.n::integer*10 from jsonb_array_elements_text(categories) with ordinality o(name,n) where c.name=o.name;
 update public.menu_items m set sort_order=o.n::integer*10,updated_at=now() from jsonb_array_elements_text(items) with ordinality o(id,n) where m.id=o.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_save_receipt_upload(p_id uuid, p_folder integer, p_date date, p_description text, p_amount numeric, p_path text, p_name text, p_mime text, p_book_expense boolean, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e uuid;r public.mtf_receipts;
begin
 if p_book_expense then insert into public.mtf_expenses(date,description,amount) values(p_date,p_description,p_amount) returning id into e;end if;
 insert into public.mtf_receipts(id,folder,document_date,kind,description,amount,file_path,file_name,mime,expense_id,created_by)
 values(p_id,p_folder,p_date,'upload',p_description,p_amount,p_path,p_name,p_mime,e,p_actor) returning * into r;
 return to_jsonb(r);
end$function$
;

CREATE OR REPLACE FUNCTION public.mtf_seasonal_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q jsonb;
begin
 if new.seasonal_event is null then
  if exists(select 1 from public.mtf_seasonal_events where event_date=new.requested_date and kind<>'newyear') then raise exception 'Bestel voor deze datum via het aparte feestdagenmenu.';end if;
  new.seasonal_surcharge=0;new.seasonal_base_subtotal=null;return new;
 end if;
 perform 1 from public.mtf_seasonal_events where id=new.seasonal_event for update;
 if new.coupon_code is not null and trim(new.coupon_code)<>'' then raise exception 'Feestdagenacties zijn niet combineerbaar met kortingscodes.';end if;
 q=public.mtf_seasonal_quote(new.seasonal_event,new.requested_date,new.requested_time,new.items,new.customer_email,new.phone);
 new.items=q->'items';new.subtotal=(q->>'subtotal')::numeric;new.seasonal_base_subtotal=(q->>'base_subtotal')::numeric;new.seasonal_surcharge=(q->>'surcharge')::numeric;
 if new.method='Bezorgen' then if new.subtotal<20 then raise exception 'Bezorgen vanaf €20 aan eten.';end if;new.delivery_fee=case when new.subtotal<35 then 2.50 else 0 end;else new.delivery_fee=0;end if;
 new.total=new.subtotal+new.delivery_fee;
 new.notes=left(coalesce(new.notes,'')||E'\n'||(q->>'title')||' | Feestdagtoeslag '||(q->>'surcharge_percent')||'%: EUR '||(q->>'surcharge')||' (inbegrepen)',1500);
 insert into public.mtf_seasonal_reservations values(new.id,new.seasonal_event,public.mtf_identity_email(new.customer_email),public.mtf_identity_phone(new.phone));
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_seasonal_public()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'title',e.title,'date',e.event_date,'surcharge_percent',e.surcharge_percent,'notice_days',e.notice_days,'deadline',(e.event_date-e.notice_days)::text,'cutoff_time',e.cutoff_time,'start_time',e.start_time,'end_time',e.end_time,'gift_qty',e.gift_qty,'product_id',e.product_id,'menu_ids',e.menu_ids,'voucher_percent',e.voucher_percent,'voucher_from',e.voucher_from,'voucher_until',e.voucher_until,'available',e.enabled and public.mtf_seasonal_used(e.id)<e.capacity and (now() at time zone 'Europe/Amsterdam')<=((e.event_date-e.notice_days)+e.cutoff_time),'remaining',case when e.kind='sinterklaas' then greatest(0,e.capacity-public.mtf_seasonal_used(e.id)) else null end,'limit',case when e.kind='sinterklaas' then e.capacity else null end) order by e.event_date),'[]'::jsonb) from public.mtf_seasonal_events e where e.visible
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_seasonal_quote(p_event text, p_date date, p_time time without time zone, p_items jsonb, p_email text, p_phone text, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e public.mtf_seasonal_events;x jsonb;m public.menu_items;unit numeric;extra numeric;qty integer;base numeric=0;subtotal numeric=0;priced jsonb='[]';emailkey text=public.mtf_identity_email(p_email);phonekey text=public.mtf_identity_phone(p_phone);local_now timestamp=p_at at time zone 'Europe/Amsterdam';
begin
 select * into e from public.mtf_seasonal_events where id=p_event;
 if not found or not e.visible or not e.enabled then raise exception 'Deze feestdagenactie is niet beschikbaar.';end if;
 if p_date<>e.event_date or p_date is null then raise exception 'Kies de datum van deze feestdagenactie.';end if;
 if exists(select 1 from public.mtf_closed_dates where day=p_date) then raise exception 'Op deze datum zijn wij gesloten.';end if;
 if local_now>((e.event_date-e.notice_days)+e.cutoff_time) then raise exception 'De besteltermijn voor % is verstreken.',e.title;end if;
 if p_time is null or p_time<e.start_time or p_time>e.end_time or extract(minute from p_time)::int%15<>0 or extract(second from p_time)<>0 or p_date<local_now::date or (p_date=local_now::date and p_time<=local_now::time) then raise exception 'Kies een beschikbaar tijdvak.';end if;
 if public.mtf_seasonal_used(e.id)>=e.capacity then raise exception 'Deze actiedag is volgeboekt.';end if;
 if emailkey is null or emailkey!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(emailkey)>254 or phonekey is null or phonekey!~'^[1-9][0-9]{7,14}$' then raise exception 'Vul een geldig e-mailadres en telefoonnummer in.';end if;
 if e.kind='sinterklaas' and exists(select 1 from public.mtf_seasonal_reservations r join public.orders o on o.id=r.order_id where r.event_id=e.id and o.status<>'Geannuleerd' and (r.email_key=emailkey or r.phone_key=phonekey)) then raise exception 'Deze pakjesavondactie is eenmalig per klant.';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'Kies je gerechten.';end if;
 for x in select value from jsonb_array_elements(p_items) loop
  select * into m from public.menu_items where id=x->>'id' and active and deleted_at is null;
  if not found or (e.kind='sinterklaas' and m.id<>e.product_id) or (e.kind='christmas' and cardinality(e.menu_ids)>0 and not(m.id=any(e.menu_ids))) then raise exception 'Dit gerecht staat niet in het feestdagenmenu.';end if;
  qty=(x->>'qty')::integer;if qty<1 or qty>50 then raise exception 'Ongeldig aantal.';end if;unit=m.price;
  if nullif(x->>'side_id','') is not null then select price into extra from public.menu_items where id=x->>'side_id' and active and deleted_at is null;if not found then raise exception 'Bijgerecht niet beschikbaar.';end if;unit=unit+extra;end if;
  if nullif(x->>'addon_id','') is not null then select price into extra from public.mtf_addons where id=(x->>'addon_id')::uuid and active and deleted_at is null;if not found then raise exception 'Extra niet beschikbaar.';end if;unit=unit+extra;end if;
  base=base+unit*qty;unit=round(unit*(1+e.surcharge_percent/100),2);subtotal=subtotal+unit*qty;
  priced=priced||jsonb_build_array(x||jsonb_build_object('price',unit));
 end loop;
 if e.kind='newyear' and not exists(select 1 from jsonb_array_elements(p_items) as entries(item) where entries.item->>'id'=e.product_id) then raise exception 'Kies een borrelpakket voor deze actie.';end if;
 if e.kind='sinterklaas' and e.gift_qty>0 then priced=priced||jsonb_build_array(jsonb_build_object('id','sinterklaas-wontons','name',e.gift_qty||' gratis wontons - Pakjesavond','qty',1,'price',0,'base_price',0));end if;
 return jsonb_build_object('items',priced,'subtotal',subtotal,'base_subtotal',base,'surcharge',subtotal-base,'surcharge_percent',e.surcharge_percent,'title',e.title);
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_seasonal_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e public.mtf_seasonal_events;r public.mtf_seasonal_reservations;
begin
 if new.seasonal_event is distinct from old.seasonal_event then raise exception 'De feestdag van een bestaande bestelling kan niet worden gewijzigd.';end if;
 if new.seasonal_event is null then return new;end if;
 select * into e from public.mtf_seasonal_events where id=new.seasonal_event for update;
 if old.status='Geannuleerd' and new.status<>'Geannuleerd' then
  if public.mtf_seasonal_used(e.id)>=e.capacity then raise exception 'Deze actiedag is volgeboekt.';end if;
  select * into r from public.mtf_seasonal_reservations where order_id=new.id;
  if e.kind='sinterklaas' and exists(select 1 from public.mtf_seasonal_reservations x join public.orders o on o.id=x.order_id where x.event_id=e.id and x.order_id<>new.id and o.status<>'Geannuleerd' and (x.email_key=r.email_key or x.phone_key=r.phone_key)) then raise exception 'Deze klant heeft al een actieve actieorder.';end if;
 end if;return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_seasonal_used(p_event text)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$select count(*)::integer from public.mtf_seasonal_reservations r join public.orders o on o.id=r.order_id where r.event_id=p_event and o.status<>'Geannuleerd'$function$
;

CREATE OR REPLACE FUNCTION public.mtf_site_hourly(p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with hours as (select generate_series(0, 23) as h),
  agg as (
    select extract(hour from created_at at time zone 'Europe/Amsterdam')::int as h, count(*) as views, count(distinct visitor) as visitors
    from mtf_pageviews where day = p_day group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', hours.h, 'views', coalesce(agg.views, 0), 'visitors', coalesce(agg.visitors, 0)) order by hours.h), '[]'::jsonb)
  from hours left join agg using (h);
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_site_report(p_from date, p_to date, p_unit text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with unit as (select case when p_unit in ('day','week','month') then p_unit else 'day' end as u),
  buckets as (
    select gs::date as bucket
    from unit, generate_series(date_trunc((select u from unit), p_from::timestamp), p_to::timestamp, ('1 ' || (select u from unit))::interval) gs
  ),
  agg as (
    select date_trunc((select u from unit), day::timestamp)::date as bucket, count(*) as views, count(distinct visitor) as visitors
    from mtf_pageviews where day between p_from and p_to group by 1
  )
  select jsonb_build_object(
    'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'views', coalesce(a.views,0), 'visitors', coalesce(a.visitors,0)) order by b.bucket) from buckets b left join agg a using (bucket)), '[]'::jsonb),
    'totals', (select jsonb_build_object('views', count(*), 'visitors', count(distinct visitor)) from mtf_pageviews where day between p_from and p_to),
    'pages', coalesce((select jsonb_agg(x) from (select path, count(*) as views from mtf_pageviews where day between p_from and p_to group by path order by 2 desc limit 8) x), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(x) from (select coalesce(referrer_host,'Direct') as source, count(*) as views from mtf_pageviews where day between p_from and p_to group by 1 order by 2 desc limit 6) x), '[]'::jsonb),
    'first_day', (select min(day) from mtf_pageviews)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_task_summary(p_actor uuid, p_owner boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with relevant as (select t.id,t.title,t.deadline from public.mtf_tasks t where t.status in ('Open','In uitvoering') and (p_owner or t.created_by=p_actor or exists(select 1 from public.mtf_task_assignees a where a.task_id=t.id and a.user_id=p_actor))),
 totals as (select count(*) as total,count(*) filter(where deadline<(now() at time zone 'Europe/Amsterdam')::date) as overdue from relevant)
 select jsonb_build_object('total',totals.total,'overdue',totals.overdue,'upcoming',coalesce((select jsonb_agg(x) from (select * from relevant order by deadline,id limit 3) x),'[]'::jsonb)) from totals;
$function$
;

CREATE OR REPLACE FUNCTION public.mtf_task_write(p_mode text, p_id uuid, p_actor uuid, p_owner boolean, p_title text, p_information text, p_deadline date, p_assignees uuid[], p_status text, p_version timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.mtf_tasks; label text; uid uuid;
begin
 if p_actor is null then
  if not coalesce(p_owner,false) then raise exception 'Geen toegang'; end if;
  label='Eigenaar';
 else
  select coalesce(nullif(name,''),email) into label from public.mtf_staff where user_id=p_actor and active;
  if not found then raise exception 'Account heeft geen toegang';end if;
 end if;
 if p_mode not in ('save','status') or p_mode is null then raise exception 'Ongeldige taakactie';end if;
 if p_id is not null then
  select * into t from public.mtf_tasks where id=p_id for update;
  if not found then raise exception 'Taak niet gevonden'; end if;
  if p_mode='save' then
   if not coalesce(p_owner,false) and (p_actor is null or t.created_by is distinct from p_actor) then raise exception 'Alleen de aanmaker of eigenaar kan de taak bewerken'; end if;
  elsif not coalesce(p_owner,false) and (p_actor is null or (t.created_by is distinct from p_actor and not exists(select 1 from public.mtf_task_assignees where task_id=p_id and user_id=p_actor))) then raise exception 'Je bent niet betrokken bij deze taak';end if;
  if p_version is distinct from t.updated_at then raise exception 'De taak is intussen gewijzigd. Vernieuw de lijst en probeer opnieuw.';end if;
 elsif p_mode<>'save' then raise exception 'Taak niet gevonden';end if;
 if p_mode='save' then
  if p_title is null or char_length(trim(p_title)) not between 1 and 150 or p_information is null or char_length(p_information)>5000 or p_deadline is null then raise exception 'Vul een titel, deadline en geldige informatie in';end if;
  if coalesce(cardinality(p_assignees),0) not between 1 and 100 or cardinality(p_assignees)<>(select count(distinct a) from unnest(p_assignees) a) then raise exception 'Kies minimaal één en maximaal 100 verschillende gebruikers';end if;
  perform user_id from public.mtf_staff where user_id=any(p_assignees) and active order by user_id for share;
  if (select count(*) from public.mtf_staff where user_id=any(p_assignees) and active)<>cardinality(p_assignees) then raise exception 'Een geselecteerde gebruiker is niet meer actief';end if;
  if p_id is null then
   insert into public.mtf_tasks(title,information,deadline,created_by,created_by_label,updated_by_label) values(trim(p_title),trim(p_information),p_deadline,p_actor,label,label) returning id into uid;
  else
   uid=p_id;
   update public.mtf_tasks set title=trim(p_title),information=trim(p_information),deadline=p_deadline,updated_at=clock_timestamp(),updated_by_label=label where id=uid;
  end if;
  delete from public.mtf_task_assignees where task_id=uid and not(user_id=any(p_assignees));
  insert into public.mtf_task_assignees(task_id,user_id) select uid,a from unnest(p_assignees) a on conflict do nothing;
 else
  if p_status is null or p_status not in ('Open','In uitvoering','Afgerond','Geannuleerd') then raise exception 'Ongeldige taakstatus';end if;
  uid=p_id;
  update public.mtf_tasks set status=p_status,updated_at=clock_timestamp(),updated_by_label=label where id=uid;
 end if;
 return uid;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_validate_new_order_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare local_now timestamp:=clock_timestamp() at time zone 'Europe/Amsterdam';r text;h record;begin
 if new.seasonal_event is not null then return new;end if;
 select reason into r from public.mtf_closed_dates where day=new.requested_date;
 if found then raise exception 'Op % zijn we gesloten: %',new.requested_date,r;end if;
 select open_time,close_time,order_cutoff into h from public.mtf_opening_hours where weekday=extract(dow from new.requested_date)::smallint;
 if not found then raise exception 'Op deze dag zijn we gesloten';end if;
 if new.requested_date<local_now::date or (new.requested_date=local_now::date and local_now::time>h.order_cutoff) then raise exception 'Kies een volgende openingsdag; voor vandaag bestel je uiterlijk om %',to_char(h.order_cutoff,'HH24:MI');end if;
 if new.requested_time<h.open_time or new.requested_time>h.close_time or extract(minute from new.requested_time)::int%15<>0 or extract(second from new.requested_time)<>0 or (new.requested_date=local_now::date and new.requested_time<=local_now::time) then raise exception 'Kies een beschikbaar tijdvak binnen onze openingstijden';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_welkom10_check(p_email text, p_phone text, p_name text, p_subtotal numeric, p_at timestamp with time zone DEFAULT now())
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e text=public.mtf_identity_email(p_email);p text=public.mtf_identity_phone(p_phone);d date=(p_at at time zone 'Europe/Amsterdam')::date;
begin
 if not exists(select 1 from public.mtf_campaign_controls where id='winter' and enabled and visible) then raise exception 'Deze winteractie is niet beschikbaar.';end if;
 if d<'2026-11-01'::date or d>'2026-12-31'::date then raise exception 'WELKOM10 is geldig van 1 november t/m 31 december 2026.';end if;
 if length(trim(coalesce(p_name,'')))<2 or length(p_name)>150 then raise exception 'Vul je volledige naam in.';end if;
 if e is null or length(e)>254 or e!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Vul een geldig e-mailadres in.';end if;
 if p is null or p!~'^[1-9][0-9]{7,14}$' then raise exception 'Vul een geldig telefoonnummer in (buiten Nederland met landcode).';end if;
 if p_subtotal is null or p_subtotal<=35 or p_subtotal>100000 then raise exception 'WELKOM10 geldt bij meer dan €35 aan eten, exclusief bezorgkosten.';end if;
 if exists(select 1 from public.mtf_welkom10_redemptions where email_key=e or phone_key=p) then raise exception 'WELKOM10 is al gebruikt met dit e-mailadres of telefoonnummer. De actie is eenmalig per klant.';end if;
 return round(p_subtotal*0.10,2);
end $function$
;

CREATE OR REPLACE FUNCTION public.mtf_welkom3_check(p_email text, p_phone text, p_name text, p_subtotal numeric, p_at timestamp with time zone DEFAULT now())
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'De loempia-actie is vervangen. Gebruik WELKOM10 voor 10 procent korting boven €35.';end $function$
;

create table if not exists public.menu_items (
  id text not null,
  name text not null,
  description text default ''::text not null,
  price numeric(10,2) not null,
  category text not null,
  active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  image_url text,
  deleted_at timestamp with time zone,
  spice_enabled boolean default false not null
);
create table if not exists public.mtf_addon_categories (
  addon_id uuid not null,
  category_name text not null
);
create table if not exists public.mtf_addons (
  id uuid default gen_random_uuid() not null,
  name text not null,
  price numeric(10,2) not null,
  cost numeric(12,4),
  menu_item_id text,
  active boolean default true not null,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_campaign_controls (
  id text not null,
  visible boolean default true not null,
  enabled boolean default true not null
);
create table if not exists public.mtf_categories (
  id uuid default gen_random_uuid() not null,
  name text not null
);
create table if not exists public.mtf_closed_dates (
  day date not null,
  reason text not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_contacts (
  email text not null,
  name text not null,
  phone text not null,
  source text default 'formulier'::text not null,
  status text default 'none'::text not null,
  confirm_token text default encode(extensions.gen_random_bytes(32), 'hex'::text),
  unsubscribe_token text default encode(extensions.gen_random_bytes(32), 'hex'::text),
  consent_text text,
  requested_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  unsubscribed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_coupon_members (
  email text not null,
  token_hash text not null,
  token_expires timestamp with time zone not null,
  requested_at timestamp with time zone default now() not null,
  confirmed_at timestamp with time zone,
  consent_text text not null,
  subscribed boolean default false not null,
  unsubscribe_hash text not null,
  mail_status text default 'pending'::text not null
);
create table if not exists public.mtf_coupons (
  code text not null,
  email text not null,
  kind text not null,
  amount numeric not null,
  minimum numeric not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null,
  redeemed_order_id uuid,
  redeemed_at timestamp with time zone,
  disabled boolean default false not null,
  product_id text,
  product_name text
);
create table if not exists public.mtf_dish_costs (
  dish_id text not null,
  ingredient_cost numeric(12,4),
  packaging jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_expenses (
  id uuid default gen_random_uuid() not null,
  date date not null,
  description text not null,
  amount numeric(12,2) not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_game_players (
  email text not null,
  name text not null,
  plays integer default 0 not null,
  best_score integer default 0 not null,
  last_score integer,
  marketing_optin boolean default false not null,
  marketing_consent_text text,
  marketing_requested_at timestamp with time zone,
  first_played_at timestamp with time zone default now() not null,
  last_played_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_game_scores (
  id uuid default gen_random_uuid() not null,
  email text not null,
  name text not null,
  score integer not null,
  mail_status text default 'pending'::text not null,
  mail_error text,
  ip_hash text,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_game_settings (
  id boolean default true not null,
  visible boolean default false not null,
  title text default '{{MERKNAAM}} Game'::text not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text
);
create table if not exists public.mtf_home_settings (
  id boolean default true not null,
  favorites_since timestamp with time zone default now() not null
);
create table if not exists public.mtf_locations (
  slug text not null,
  schema_name text not null,
  name text not null,
  address text not null,
  order_email text not null,
  published boolean default false not null,
  mailbox_ready boolean default false not null,
  delivery_limit_m integer,
  routing_api_key text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  review_url text default ''::text not null,
  is_primary boolean default false not null,
  features text[] default '{}'::text[] not null,
  order_prefix text default ''::text not null,
  order_pad integer default 0 not null,
  order_max integer
);
create table if not exists public.mtf_mail_jobs (
  id uuid default gen_random_uuid() not null,
  dedupe text not null,
  kind text not null,
  to_email text not null,
  payload jsonb not null,
  status text default 'pending'::text not null,
  attempts integer default 0 not null,
  last_error text,
  resend_id text,
  created_at timestamp with time zone default now() not null,
  sent_at timestamp with time zone,
  started_at timestamp with time zone
);
create table if not exists public.mtf_marketing_campaigns (
  id uuid default gen_random_uuid() not null,
  subject text not null,
  body text not null,
  status text default 'draft'::text not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_menu_categories (
  name text not null,
  created_at timestamp with time zone default now() not null,
  sort_order integer default 2147483647 not null,
  note text default ''::text not null,
  allows_sides boolean default false not null,
  is_side boolean default false not null
);
create table if not exists public.mtf_movements (
  id uuid default gen_random_uuid() not null,
  stock_id uuid not null,
  delta numeric(12,3) not null,
  reason text not null,
  order_id uuid,
  actor text,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_newyear_vouchers (
  code text not null,
  order_id uuid not null,
  email_key text not null,
  phone_key text not null,
  percent numeric not null,
  valid_from date not null,
  valid_until date not null,
  disabled boolean default false not null,
  redeemed_at timestamp with time zone,
  redeemed_order_id uuid,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_opening_hours (
  weekday smallint not null,
  open_time time without time zone not null,
  close_time time without time zone not null,
  order_cutoff time without time zone not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_order_costs (
  order_id uuid not null,
  snapshot jsonb not null,
  cost numeric(12,4) not null,
  complete boolean not null,
  consumed boolean default false not null
);
create table if not exists public.mtf_pageviews (
  id bigint generated always as identity not null,
  created_at timestamp with time zone default now() not null,
  day date default ((now() AT TIME ZONE 'Europe/Amsterdam'::text))::date not null,
  path text not null,
  visitor text not null,
  referrer_host text,
  location text default 'spijkenisse'::text not null
);
create table if not exists public.mtf_promotion_limits (
  bucket text not null,
  started_at timestamp with time zone default now() not null,
  count integer default 1 not null
);
create table if not exists public.mtf_promotion_settings (
  id boolean default true not null,
  enabled boolean default false not null,
  kind text default 'fixed'::text not null,
  amount numeric(10,2) default 5 not null,
  minimum numeric(10,2) default 25 not null,
  valid_days integer default 30 not null,
  google_place_id text default ''::text not null,
  google_api_key text default ''::text not null,
  updated_at timestamp with time zone default now() not null,
  product_id text
);
create table if not exists public.mtf_receipts (
  id uuid default gen_random_uuid() not null,
  folder smallint not null,
  document_date date not null,
  year integer generated always as ((EXTRACT(year FROM document_date))::integer) stored,
  quarter integer generated always as ((EXTRACT(quarter FROM document_date))::integer) stored,
  kind text not null,
  description text not null,
  amount numeric(12,2) not null,
  order_id uuid,
  snapshot jsonb,
  file_path text,
  file_name text,
  mime text,
  expense_id uuid,
  created_by text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_review_mails (
  id uuid default gen_random_uuid() not null,
  location_slug text not null,
  order_id uuid not null,
  to_email text not null,
  name text default ''::text not null,
  send_after timestamp with time zone not null,
  status text default 'pending'::text not null,
  attempts integer default 0 not null,
  last_error text,
  resend_id text,
  created_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  sent_at timestamp with time zone
);
create table if not exists public.mtf_seasonal_events (
  id text not null,
  kind text not null,
  title text not null,
  event_date date not null,
  visible boolean default true not null,
  enabled boolean default true not null,
  surcharge_percent numeric default 0 not null,
  notice_days integer default 14 not null,
  capacity integer not null,
  gift_qty integer default 0 not null,
  product_id text,
  menu_ids text[] default '{}'::text[] not null,
  start_time time without time zone default '16:00:00'::time without time zone not null,
  end_time time without time zone default '20:30:00'::time without time zone not null,
  cutoff_time time without time zone default '23:59:59'::time without time zone not null,
  voucher_percent numeric default 15 not null,
  voucher_from date default '2027-01-04'::date not null,
  voucher_until date default '2027-01-18'::date not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_seasonal_reservations (
  order_id uuid not null,
  event_id text not null,
  email_key text not null,
  phone_key text not null
);
create table if not exists public.mtf_staff (
  user_id uuid not null,
  email text not null,
  name text default ''::text not null,
  owner boolean default false not null,
  active boolean default true not null,
  permissions jsonb default '{}'::jsonb not null,
  invited_at timestamp with time zone default now() not null,
  claimed_at timestamp with time zone
);
create table if not exists public.mtf_stock (
  id uuid default gen_random_uuid() not null,
  name text not null,
  category_id uuid,
  supplier_id uuid,
  unit text default 'stuk'::text not null,
  unit_cost numeric(12,4) default 0 not null,
  quantity numeric(12,3) default 0 not null,
  minimum numeric(12,3) default 0 not null,
  packaging boolean default false not null,
  notes text,
  active boolean default true not null
);
create table if not exists public.mtf_suppliers (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text,
  phone text,
  website text,
  notes text
);
create table if not exists public.mtf_task_assignees (
  task_id uuid not null,
  user_id uuid not null
);
create table if not exists public.mtf_tasks (
  id uuid default gen_random_uuid() not null,
  title text not null,
  information text default ''::text not null,
  deadline date not null,
  status text default 'Open'::text not null,
  created_by uuid,
  created_by_label text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by_label text not null
);
create table if not exists public.mtf_welkom10_redemptions (
  order_id uuid not null,
  email_key text not null,
  phone_key text not null,
  redeemed_at timestamp with time zone default now() not null
);
create table if not exists public.mtf_welkom3_redemptions (
  order_id uuid not null,
  email_key text not null,
  phone_key text not null,
  redeemed_at timestamp with time zone default now() not null
);
create table if not exists public.order_email_outbox (
  id bigint generated always as identity not null,
  order_id uuid not null,
  kind text not null,
  status text default 'pending'::text not null,
  attempts integer default 0 not null,
  last_error text,
  resend_id text,
  created_at timestamp with time zone default now() not null,
  sent_at timestamp with time zone
);
create table if not exists public.orders (
  id uuid default gen_random_uuid() not null,
  order_number bigint generated always as identity not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  status text default 'Nieuw'::text not null,
  customer_name text not null,
  customer_email text not null,
  phone text not null,
  method text not null,
  address text,
  city text,
  requested_date date not null,
  requested_time time without time zone not null,
  payment text not null,
  notes text default ''::text not null,
  total numeric(10,2) not null,
  items jsonb not null,
  payment_url text,
  payment_status text default 'Open'::text not null,
  subtotal numeric(12,2),
  delivery_fee numeric(12,2) default 0 not null,
  coupon_code text,
  discount_amount numeric default 0 not null,
  seasonal_event text,
  seasonal_base_subtotal numeric,
  seasonal_surcharge numeric default 0 not null,
  mollie_payment_id text,
  online_payment_state text
);
create table if not exists public.shop_settings (
  id boolean default true not null,
  is_open boolean default true not null,
  message text default 'Momenteel nemen wij geen online bestellingen aan. Probeer het later opnieuw.'::text not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.menu_items add constraint menu_items_pkey PRIMARY KEY (id);
alter table public.mtf_addon_categories add constraint mtf_addon_categories_pkey PRIMARY KEY (addon_id, category_name);
alter table public.mtf_addons add constraint mtf_addons_pkey PRIMARY KEY (id);
alter table public.mtf_campaign_controls add constraint mtf_campaign_controls_pkey PRIMARY KEY (id);
alter table public.mtf_categories add constraint mtf_categories_pkey PRIMARY KEY (id);
alter table public.mtf_closed_dates add constraint mtf_closed_dates_pkey PRIMARY KEY (day);
alter table public.mtf_contacts add constraint mtf_contacts_pkey PRIMARY KEY (email);
alter table public.mtf_coupon_members add constraint mtf_coupon_members_pkey PRIMARY KEY (email);
alter table public.mtf_coupons add constraint mtf_coupons_pkey PRIMARY KEY (code);
alter table public.mtf_dish_costs add constraint mtf_dish_costs_pkey PRIMARY KEY (dish_id);
alter table public.mtf_expenses add constraint mtf_expenses_pkey PRIMARY KEY (id);
alter table public.mtf_game_players add constraint mtf_game_players_pkey PRIMARY KEY (email);
alter table public.mtf_game_scores add constraint mtf_game_scores_pkey PRIMARY KEY (id);
alter table public.mtf_game_settings add constraint mtf_game_settings_pkey PRIMARY KEY (id);
alter table public.mtf_home_settings add constraint mtf_home_settings_pkey PRIMARY KEY (id);
alter table public.mtf_locations add constraint mtf_locations_pkey PRIMARY KEY (slug);
alter table public.mtf_mail_jobs add constraint mtf_mail_jobs_pkey PRIMARY KEY (id);
alter table public.mtf_marketing_campaigns add constraint mtf_marketing_campaigns_pkey PRIMARY KEY (id);
alter table public.mtf_menu_categories add constraint mtf_menu_categories_pkey PRIMARY KEY (name);
alter table public.mtf_movements add constraint mtf_movements_pkey PRIMARY KEY (id);
alter table public.mtf_newyear_vouchers add constraint mtf_newyear_vouchers_pkey PRIMARY KEY (code);
alter table public.mtf_opening_hours add constraint mtf_opening_hours_pkey PRIMARY KEY (weekday);
alter table public.mtf_order_costs add constraint mtf_order_costs_pkey PRIMARY KEY (order_id);
alter table public.mtf_pageviews add constraint mtf_pageviews_pkey PRIMARY KEY (id);
alter table public.mtf_promotion_limits add constraint mtf_promotion_limits_pkey PRIMARY KEY (bucket);
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_pkey PRIMARY KEY (id);
alter table public.mtf_receipts add constraint mtf_receipts_pkey PRIMARY KEY (id);
alter table public.mtf_review_mails add constraint mtf_review_mails_pkey PRIMARY KEY (id);
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_pkey PRIMARY KEY (id);
alter table public.mtf_seasonal_reservations add constraint mtf_seasonal_reservations_pkey PRIMARY KEY (order_id);
alter table public.mtf_staff add constraint mtf_staff_pkey PRIMARY KEY (user_id);
alter table public.mtf_stock add constraint mtf_stock_pkey PRIMARY KEY (id);
alter table public.mtf_suppliers add constraint mtf_suppliers_pkey PRIMARY KEY (id);
alter table public.mtf_task_assignees add constraint mtf_task_assignees_pkey PRIMARY KEY (task_id, user_id);
alter table public.mtf_tasks add constraint mtf_tasks_pkey PRIMARY KEY (id);
alter table public.mtf_welkom10_redemptions add constraint mtf_welkom10_redemptions_pkey PRIMARY KEY (order_id);
alter table public.mtf_welkom3_redemptions add constraint mtf_welkom3_redemptions_pkey PRIMARY KEY (order_id);
alter table public.order_email_outbox add constraint order_email_outbox_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.shop_settings add constraint shop_settings_pkey PRIMARY KEY (id);
alter table public.mtf_categories add constraint mtf_categories_name_key UNIQUE (name);
alter table public.mtf_contacts add constraint mtf_contacts_confirm_token_key UNIQUE (confirm_token);
alter table public.mtf_contacts add constraint mtf_contacts_unsubscribe_token_key UNIQUE (unsubscribe_token);
alter table public.mtf_coupon_members add constraint mtf_coupon_members_token_hash_key UNIQUE (token_hash);
alter table public.mtf_coupon_members add constraint mtf_coupon_members_unsubscribe_hash_key UNIQUE (unsubscribe_hash);
alter table public.mtf_coupons add constraint mtf_coupons_email_key UNIQUE (email);
alter table public.mtf_locations add constraint mtf_locations_schema_name_key UNIQUE (schema_name);
alter table public.mtf_mail_jobs add constraint mtf_mail_jobs_dedupe_key UNIQUE (dedupe);
alter table public.mtf_newyear_vouchers add constraint mtf_newyear_vouchers_email_key_key UNIQUE (email_key);
alter table public.mtf_newyear_vouchers add constraint mtf_newyear_vouchers_order_id_key UNIQUE (order_id);
alter table public.mtf_newyear_vouchers add constraint mtf_newyear_vouchers_phone_key_key UNIQUE (phone_key);
alter table public.mtf_receipts add constraint mtf_receipts_expense_id_key UNIQUE (expense_id);
alter table public.mtf_receipts add constraint mtf_receipts_file_path_key UNIQUE (file_path);
alter table public.mtf_receipts add constraint mtf_receipts_order_id_key UNIQUE (order_id);
alter table public.mtf_review_mails add constraint mtf_review_mails_location_slug_order_id_key UNIQUE (location_slug, order_id);
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_event_date_key UNIQUE (event_date);
alter table public.mtf_staff add constraint mtf_staff_email_key UNIQUE (email);
alter table public.mtf_welkom10_redemptions add constraint mtf_welkom10_redemptions_email_key_key UNIQUE (email_key);
alter table public.mtf_welkom10_redemptions add constraint mtf_welkom10_redemptions_phone_key_key UNIQUE (phone_key);
alter table public.mtf_welkom3_redemptions add constraint mtf_welkom3_redemptions_email_key_key UNIQUE (email_key);
alter table public.mtf_welkom3_redemptions add constraint mtf_welkom3_redemptions_phone_key_key UNIQUE (phone_key);
alter table public.order_email_outbox add constraint order_email_outbox_order_id_kind_key UNIQUE (order_id, kind);
alter table public.orders add constraint orders_order_number_key UNIQUE (order_number);
alter table public.menu_items add constraint menu_items_price_check CHECK ((price >= (0)::numeric));
alter table public.mtf_addons add constraint mtf_addons_cost_check CHECK ((cost >= (0)::numeric));
alter table public.mtf_addons add constraint mtf_addons_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 100)));
alter table public.mtf_addons add constraint mtf_addons_price_check CHECK (((price >= (0)::numeric) AND (price <= (1000)::numeric)));
alter table public.mtf_categories add constraint mtf_categories_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public.mtf_closed_dates add constraint mtf_closed_dates_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 200)));
alter table public.mtf_contacts add constraint mtf_contacts_status_check CHECK ((status = ANY (ARRAY['none'::text, 'pending'::text, 'subscribed'::text, 'unsubscribed'::text])));
alter table public.mtf_coupon_members add constraint mtf_coupon_members_email_check CHECK ((email = lower(TRIM(BOTH FROM email))));
alter table public.mtf_coupons add constraint mtf_coupons_amount_check CHECK ((amount > (0)::numeric));
alter table public.mtf_coupons add constraint mtf_coupons_kind_check CHECK ((kind = ANY (ARRAY['fixed'::text, 'percent'::text, 'product'::text])));
alter table public.mtf_coupons add constraint mtf_coupons_minimum_check CHECK ((minimum >= (0)::numeric));
alter table public.mtf_coupons add constraint mtf_product_coupon_required CHECK (((kind <> 'product'::text) OR (product_id IS NOT NULL)));
alter table public.mtf_dish_costs add constraint mtf_dish_costs_ingredient_cost_check CHECK ((ingredient_cost >= (0)::numeric));
alter table public.mtf_expenses add constraint mtf_expenses_amount_check CHECK ((amount >= (0)::numeric));
alter table public.mtf_game_players add constraint mtf_game_players_email_check CHECK (((email = lower(email)) AND (length(email) <= 254)));
alter table public.mtf_game_scores add constraint mtf_game_scores_score_check CHECK (((score >= 0) AND (score <= 100000000)));
alter table public.mtf_game_settings add constraint mtf_game_settings_id_check CHECK (id);
alter table public.mtf_home_settings add constraint mtf_home_settings_id_check CHECK (id);
alter table public.mtf_locations add constraint mtf_locations_delivery_limit_m_check CHECK (((delivery_limit_m > 0) AND (delivery_limit_m <= 100000)));
alter table public.mtf_locations add constraint mtf_locations_features_check CHECK ((features <@ ARRAY['welkom10'::text, 'seasonal'::text, 'marketing'::text]));
alter table public.mtf_locations add constraint mtf_locations_order_pad_check CHECK (((order_pad >= 0) AND (order_pad <= 12)));
alter table public.mtf_locations add constraint mtf_locations_primary_public CHECK (((NOT is_primary) OR (schema_name = 'public'::text)));
alter table public.mtf_locations add constraint mtf_locations_schema_name_check CHECK (((schema_name = 'public'::text) OR (schema_name ~ '^mtf_[a-z0-9_]{1,40}$'::text)));
alter table public.mtf_locations add constraint mtf_locations_slug_check CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 40)));
alter table public.mtf_mail_jobs add constraint mtf_mail_jobs_kind_check CHECK ((kind = ANY (ARRAY['payment'::text, 'invite'::text, 'task'::text, 'newyear'::text, 'marketing'::text, 'marketing_confirm'::text])));
alter table public.mtf_mail_jobs add constraint mtf_mail_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
alter table public.mtf_marketing_campaigns add constraint mtf_marketing_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'queued'::text])));
alter table public.mtf_menu_categories add constraint mtf_menu_categories_name_check CHECK (((name = TRIM(BOTH FROM name)) AND ((length(name) >= 1) AND (length(name) <= 80))));
alter table public.mtf_menu_categories add constraint mtf_menu_categories_note_check CHECK ((char_length(note) <= 500));
alter table public.mtf_movements add constraint mtf_movements_delta_check CHECK ((delta <> (0)::numeric));
alter table public.mtf_opening_hours add constraint mtf_opening_hours_order CHECK (((open_time < close_time) AND (order_cutoff <= close_time)));
alter table public.mtf_opening_hours add constraint mtf_opening_hours_quarter CHECK (((((EXTRACT(minute FROM open_time))::integer % 15) = 0) AND (EXTRACT(second FROM open_time) = (0)::numeric) AND (((EXTRACT(minute FROM close_time))::integer % 15) = 0) AND (EXTRACT(second FROM close_time) = (0)::numeric) AND (EXTRACT(second FROM order_cutoff) = (0)::numeric)));
alter table public.mtf_opening_hours add constraint mtf_opening_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)));
alter table public.mtf_pageviews add constraint mtf_pageviews_path_check CHECK (((char_length(path) >= 1) AND (char_length(path) <= 200)));
alter table public.mtf_pageviews add constraint mtf_pageviews_referrer_host_check CHECK (((referrer_host IS NULL) OR (char_length(referrer_host) <= 200)));
alter table public.mtf_pageviews add constraint mtf_pageviews_visitor_check CHECK ((char_length(visitor) = 64));
alter table public.mtf_promotion_settings add constraint mtf_product_setting_required CHECK (((kind <> 'product'::text) OR (product_id IS NOT NULL)));
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_amount_check CHECK (((amount > (0)::numeric) AND (amount <= (1000)::numeric)));
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_check CHECK (((kind <> 'percent'::text) OR (amount <= (100)::numeric)));
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_id_check CHECK (id);
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_kind_check CHECK ((kind = ANY (ARRAY['fixed'::text, 'percent'::text, 'product'::text])));
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_minimum_check CHECK ((minimum >= (0)::numeric));
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_valid_days_check CHECK (((valid_days >= 1) AND (valid_days <= 365)));
alter table public.mtf_receipts add constraint mtf_receipts_amount_check CHECK ((amount >= (0)::numeric));
alter table public.mtf_receipts add constraint mtf_receipts_check CHECK ((((kind = 'order'::text) AND (order_id IS NOT NULL) AND (snapshot IS NOT NULL) AND (file_path IS NULL) AND (expense_id IS NULL)) OR ((kind = 'upload'::text) AND (order_id IS NULL) AND (snapshot IS NULL) AND (file_path IS NOT NULL) AND (file_name IS NOT NULL) AND (mime = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))));
alter table public.mtf_receipts add constraint mtf_receipts_description_check CHECK (((length(TRIM(BOTH FROM description)) >= 1) AND (length(TRIM(BOTH FROM description)) <= 200)));
alter table public.mtf_receipts add constraint mtf_receipts_folder_check CHECK (((folder >= 1) AND (folder <= 3)));
alter table public.mtf_receipts add constraint mtf_receipts_kind_check CHECK ((kind = ANY (ARRAY['order'::text, 'upload'::text])));
alter table public.mtf_review_mails add constraint mtf_review_mails_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_capacity_check CHECK (((capacity >= 0) AND (capacity <= 10000)));
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_check CHECK ((start_time < end_time));
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_gift_qty_check CHECK (((gift_qty >= 0) AND (gift_qty <= 100)));
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_kind_check CHECK ((kind = ANY (ARRAY['christmas'::text, 'sinterklaas'::text, 'newyear'::text])));
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_notice_days_check CHECK (((notice_days >= 0) AND (notice_days <= 365)));
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_surcharge_percent_check CHECK (((surcharge_percent >= (0)::numeric) AND (surcharge_percent <= (100)::numeric)));
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_voucher_percent_check CHECK (((voucher_percent > (0)::numeric) AND (voucher_percent <= (100)::numeric)));
alter table public.mtf_stock add constraint mtf_stock_minimum_check CHECK ((minimum >= (0)::numeric));
alter table public.mtf_stock add constraint mtf_stock_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public.mtf_stock add constraint mtf_stock_unit_cost_check CHECK ((unit_cost >= (0)::numeric));
alter table public.mtf_suppliers add constraint mtf_suppliers_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public.mtf_tasks add constraint mtf_tasks_information_check CHECK ((char_length(information) <= 5000));
alter table public.mtf_tasks add constraint mtf_tasks_status_check CHECK ((status = ANY (ARRAY['Open'::text, 'In uitvoering'::text, 'Afgerond'::text, 'Geannuleerd'::text])));
alter table public.mtf_tasks add constraint mtf_tasks_title_check CHECK (((char_length(TRIM(BOTH FROM title)) >= 1) AND (char_length(TRIM(BOTH FROM title)) <= 150)));
alter table public.order_email_outbox add constraint order_email_outbox_kind_check CHECK ((kind = ANY (ARRAY['restaurant'::text, 'customer'::text])));
alter table public.order_email_outbox add constraint order_email_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text])));
alter table public.orders add constraint delivery_address_required CHECK (((method <> 'Bezorgen'::text) OR ((char_length(TRIM(BOTH FROM COALESCE(address, ''::text))) >= 3) AND (char_length(TRIM(BOTH FROM COALESCE(city, ''::text))) >= 2))));
alter table public.orders add constraint orders_customer_email_check CHECK ((POSITION(('@'::text) IN (customer_email)) > 1));
alter table public.orders add constraint orders_customer_name_check CHECK ((char_length(TRIM(BOTH FROM customer_name)) >= 2));
alter table public.orders add constraint orders_delivery_fee_check CHECK ((delivery_fee >= (0)::numeric));
alter table public.orders add constraint orders_discount_amount_check CHECK ((discount_amount >= (0)::numeric));
alter table public.orders add constraint orders_items_check CHECK ((jsonb_typeof(items) = 'array'::text));
alter table public.orders add constraint orders_method_check CHECK ((method = ANY (ARRAY['Bezorgen'::text, 'Afhalen'::text])));
alter table public.orders add constraint orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['Open'::text, 'Betaald'::text])));
alter table public.orders add constraint orders_phone_check CHECK ((char_length(TRIM(BOTH FROM phone)) >= 6));
alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['Nieuw'::text, 'In bereiding'::text, 'Klaar'::text, 'Onderweg'::text, 'Afgehaald'::text, 'Bezorgd'::text, 'Geannuleerd'::text])));
alter table public.orders add constraint orders_subtotal_check CHECK ((subtotal >= (0)::numeric));
alter table public.orders add constraint orders_total_check CHECK ((total >= (0)::numeric));
alter table public.shop_settings add constraint shop_settings_id_check CHECK (id);
alter table public.menu_items add constraint mtf_menu_category_fk FOREIGN KEY (category) REFERENCES public.mtf_menu_categories(name) ON UPDATE CASCADE;
alter table public.mtf_addon_categories add constraint mtf_addon_categories_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES public.mtf_addons(id) ON DELETE CASCADE;
alter table public.mtf_addon_categories add constraint mtf_addon_categories_category_name_fkey FOREIGN KEY (category_name) REFERENCES public.mtf_menu_categories(name) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.mtf_addons add constraint mtf_addons_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id);
alter table public.mtf_coupons add constraint mtf_coupons_email_fkey FOREIGN KEY (email) REFERENCES public.mtf_coupon_members(email);
alter table public.mtf_coupons add constraint mtf_coupons_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.menu_items(id);
alter table public.mtf_coupons add constraint mtf_coupons_redeemed_order_id_fkey FOREIGN KEY (redeemed_order_id) REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED;
alter table public.mtf_dish_costs add constraint mtf_dish_costs_dish_id_fkey FOREIGN KEY (dish_id) REFERENCES public.menu_items(id);
alter table public.mtf_game_scores add constraint mtf_game_scores_email_fkey FOREIGN KEY (email) REFERENCES public.mtf_game_players(email) ON DELETE CASCADE;
alter table public.mtf_movements add constraint mtf_movements_stock_id_fkey FOREIGN KEY (stock_id) REFERENCES public.mtf_stock(id);
alter table public.mtf_newyear_vouchers add constraint mtf_newyear_vouchers_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
alter table public.mtf_newyear_vouchers add constraint mtf_newyear_vouchers_redeemed_order_id_fkey FOREIGN KEY (redeemed_order_id) REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED;
alter table public.mtf_order_costs add constraint mtf_order_costs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
alter table public.mtf_promotion_settings add constraint mtf_promotion_settings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.menu_items(id);
alter table public.mtf_receipts add constraint mtf_receipts_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.mtf_expenses(id);
alter table public.mtf_receipts add constraint mtf_receipts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
alter table public.mtf_review_mails add constraint mtf_review_mails_location_slug_fkey FOREIGN KEY (location_slug) REFERENCES public.mtf_locations(slug) ON UPDATE CASCADE;
alter table public.mtf_seasonal_events add constraint mtf_seasonal_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.menu_items(id);
alter table public.mtf_seasonal_reservations add constraint mtf_seasonal_reservations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.mtf_seasonal_events(id);
alter table public.mtf_seasonal_reservations add constraint mtf_seasonal_reservations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED;
alter table public.mtf_staff add constraint mtf_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.mtf_stock add constraint mtf_stock_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.mtf_categories(id);
alter table public.mtf_stock add constraint mtf_stock_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.mtf_suppliers(id);
alter table public.mtf_task_assignees add constraint mtf_task_assignees_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.mtf_tasks(id) ON DELETE CASCADE;
alter table public.mtf_task_assignees add constraint mtf_task_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.mtf_staff(user_id);
alter table public.mtf_tasks add constraint mtf_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.mtf_staff(user_id);
alter table public.mtf_welkom10_redemptions add constraint mtf_welkom10_redemptions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED;
alter table public.mtf_welkom3_redemptions add constraint mtf_welkom3_redemptions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED;
alter table public.order_email_outbox add constraint order_email_outbox_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
alter table public.orders add constraint orders_seasonal_event_fkey FOREIGN KEY (seasonal_event) REFERENCES public.mtf_seasonal_events(id);

CREATE INDEX menu_items_category_sort_idx ON public.menu_items USING btree (category, sort_order);
CREATE INDEX mtf_addon_categories_name ON public.mtf_addon_categories USING btree (category_name, addon_id);
CREATE INDEX mtf_addons_source ON public.mtf_addons USING btree (menu_item_id);
CREATE INDEX mtf_game_scores_created_idx ON public.mtf_game_scores USING btree (created_at DESC);
CREATE INDEX mtf_game_scores_email_idx ON public.mtf_game_scores USING btree (email);
CREATE INDEX mtf_game_scores_score_idx ON public.mtf_game_scores USING btree (score DESC, created_at);
CREATE UNIQUE INDEX mtf_locations_one_primary ON public.mtf_locations USING btree (is_primary) WHERE is_primary;
CREATE UNIQUE INDEX mtf_menu_categories_lower_name ON public.mtf_menu_categories USING btree (lower(name));
CREATE INDEX mtf_movements_stock ON public.mtf_movements USING btree (stock_id, created_at);
CREATE INDEX mtf_orders_email_identity ON public.orders USING btree (public.mtf_identity_email(customer_email));
CREATE INDEX mtf_orders_phone_identity ON public.orders USING btree (public.mtf_identity_phone(phone));
CREATE INDEX mtf_pageviews_day_idx ON public.mtf_pageviews USING btree (day);
CREATE INDEX mtf_receipts_folder_period ON public.mtf_receipts USING btree (folder, year, quarter, document_date DESC, id);
CREATE INDEX mtf_review_mails_due ON public.mtf_review_mails USING btree (status, send_after);
CREATE INDEX mtf_review_mails_email ON public.mtf_review_mails USING btree (lower(to_email), sent_at);
CREATE INDEX mtf_seasonal_identity ON public.mtf_seasonal_reservations USING btree (event_id, email_key, phone_key);
CREATE INDEX mtf_task_assignees_user ON public.mtf_task_assignees USING btree (user_id, task_id);
CREATE INDEX mtf_tasks_creator ON public.mtf_tasks USING btree (created_by);
CREATE INDEX mtf_tasks_deadline ON public.mtf_tasks USING btree (deadline, id);
CREATE INDEX orders_created_at_idx ON public.orders USING btree (created_at DESC);
CREATE INDEX orders_mollie_payment_id_idx ON public.orders USING btree (mollie_payment_id);
CREATE INDEX orders_status_idx ON public.orders USING btree (status);

CREATE TRIGGER mtf_task_assignment_mail AFTER INSERT ON public.mtf_task_assignees FOR EACH ROW EXECUTE FUNCTION public.mtf_queue_task_assignment();
CREATE TRIGGER mtf_00_seasonal_order BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_seasonal_order();
CREATE TRIGGER mtf_00_seasonal_status BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_seasonal_status();
CREATE TRIGGER mtf_apply_order_coupon BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_apply_order_coupon();
CREATE TRIGGER mtf_capture_costs AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_capture_costs();
CREATE TRIGGER mtf_consume_stock AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_consume_stock();
CREATE TRIGGER mtf_contact_order AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_capture_order_contact();
CREATE TRIGGER mtf_newyear_cancel AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_newyear_cancel();
CREATE TRIGGER mtf_newyear_issue AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_newyear_issue();
CREATE TRIGGER mtf_review_mail AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_enqueue_review_mail();
CREATE TRIGGER mtf_validate_new_order_date BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mtf_validate_new_order_date();
CREATE TRIGGER trg_enqueue_order_emails AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enqueue_order_emails();

alter table public.menu_items enable row level security;
alter table public.mtf_addon_categories enable row level security;
alter table public.mtf_addons enable row level security;
alter table public.mtf_campaign_controls enable row level security;
alter table public.mtf_categories enable row level security;
alter table public.mtf_closed_dates enable row level security;
alter table public.mtf_contacts enable row level security;
alter table public.mtf_coupon_members enable row level security;
alter table public.mtf_coupons enable row level security;
alter table public.mtf_dish_costs enable row level security;
alter table public.mtf_expenses enable row level security;
alter table public.mtf_game_players enable row level security;
alter table public.mtf_game_scores enable row level security;
alter table public.mtf_game_settings enable row level security;
alter table public.mtf_home_settings enable row level security;
alter table public.mtf_locations enable row level security;
alter table public.mtf_mail_jobs enable row level security;
alter table public.mtf_marketing_campaigns enable row level security;
alter table public.mtf_menu_categories enable row level security;
alter table public.mtf_movements enable row level security;
alter table public.mtf_newyear_vouchers enable row level security;
alter table public.mtf_opening_hours enable row level security;
alter table public.mtf_order_costs enable row level security;
alter table public.mtf_pageviews enable row level security;
alter table public.mtf_promotion_limits enable row level security;
alter table public.mtf_promotion_settings enable row level security;
alter table public.mtf_receipts enable row level security;
alter table public.mtf_review_mails enable row level security;
alter table public.mtf_seasonal_events enable row level security;
alter table public.mtf_seasonal_reservations enable row level security;
alter table public.mtf_staff enable row level security;
alter table public.mtf_stock enable row level security;
alter table public.mtf_suppliers enable row level security;
alter table public.mtf_task_assignees enable row level security;
alter table public.mtf_tasks enable row level security;
alter table public.mtf_welkom10_redemptions enable row level security;
alter table public.mtf_welkom3_redemptions enable row level security;
alter table public.order_email_outbox enable row level security;
alter table public.orders enable row level security;
alter table public.shop_settings enable row level security;
create policy "public can read active menu" on public.menu_items as PERMISSIVE for SELECT to anon, authenticated using ((active = true));
create policy "Public menu category order" on public.mtf_menu_categories as PERMISSIVE for SELECT to anon, authenticated using (true);

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant DELETE on public.menu_items to anon;
grant INSERT on public.menu_items to anon;
grant REFERENCES on public.menu_items to anon;
grant SELECT on public.menu_items to anon;
grant TRIGGER on public.menu_items to anon;
grant TRUNCATE on public.menu_items to anon;
grant UPDATE on public.menu_items to anon;
grant DELETE on public.menu_items to authenticated;
grant INSERT on public.menu_items to authenticated;
grant REFERENCES on public.menu_items to authenticated;
grant SELECT on public.menu_items to authenticated;
grant TRIGGER on public.menu_items to authenticated;
grant TRUNCATE on public.menu_items to authenticated;
grant UPDATE on public.menu_items to authenticated;
grant DELETE on public.menu_items to service_role;
grant INSERT on public.menu_items to service_role;
grant REFERENCES on public.menu_items to service_role;
grant SELECT on public.menu_items to service_role;
grant TRIGGER on public.menu_items to service_role;
grant TRUNCATE on public.menu_items to service_role;
grant UPDATE on public.menu_items to service_role;
grant DELETE on public.mtf_addon_categories to service_role;
grant INSERT on public.mtf_addon_categories to service_role;
grant REFERENCES on public.mtf_addon_categories to service_role;
grant SELECT on public.mtf_addon_categories to service_role;
grant TRIGGER on public.mtf_addon_categories to service_role;
grant TRUNCATE on public.mtf_addon_categories to service_role;
grant UPDATE on public.mtf_addon_categories to service_role;
grant DELETE on public.mtf_addons to service_role;
grant INSERT on public.mtf_addons to service_role;
grant REFERENCES on public.mtf_addons to service_role;
grant SELECT on public.mtf_addons to service_role;
grant TRIGGER on public.mtf_addons to service_role;
grant TRUNCATE on public.mtf_addons to service_role;
grant UPDATE on public.mtf_addons to service_role;
grant DELETE on public.mtf_campaign_controls to service_role;
grant INSERT on public.mtf_campaign_controls to service_role;
grant REFERENCES on public.mtf_campaign_controls to service_role;
grant SELECT on public.mtf_campaign_controls to service_role;
grant TRIGGER on public.mtf_campaign_controls to service_role;
grant TRUNCATE on public.mtf_campaign_controls to service_role;
grant UPDATE on public.mtf_campaign_controls to service_role;
grant DELETE on public.mtf_categories to service_role;
grant INSERT on public.mtf_categories to service_role;
grant REFERENCES on public.mtf_categories to service_role;
grant SELECT on public.mtf_categories to service_role;
grant TRIGGER on public.mtf_categories to service_role;
grant TRUNCATE on public.mtf_categories to service_role;
grant UPDATE on public.mtf_categories to service_role;
grant DELETE on public.mtf_closed_dates to service_role;
grant INSERT on public.mtf_closed_dates to service_role;
grant REFERENCES on public.mtf_closed_dates to service_role;
grant SELECT on public.mtf_closed_dates to service_role;
grant TRIGGER on public.mtf_closed_dates to service_role;
grant TRUNCATE on public.mtf_closed_dates to service_role;
grant UPDATE on public.mtf_closed_dates to service_role;
grant DELETE on public.mtf_contacts to service_role;
grant INSERT on public.mtf_contacts to service_role;
grant REFERENCES on public.mtf_contacts to service_role;
grant SELECT on public.mtf_contacts to service_role;
grant TRIGGER on public.mtf_contacts to service_role;
grant TRUNCATE on public.mtf_contacts to service_role;
grant UPDATE on public.mtf_contacts to service_role;
grant DELETE on public.mtf_coupon_members to service_role;
grant INSERT on public.mtf_coupon_members to service_role;
grant REFERENCES on public.mtf_coupon_members to service_role;
grant SELECT on public.mtf_coupon_members to service_role;
grant TRIGGER on public.mtf_coupon_members to service_role;
grant TRUNCATE on public.mtf_coupon_members to service_role;
grant UPDATE on public.mtf_coupon_members to service_role;
grant DELETE on public.mtf_coupons to service_role;
grant INSERT on public.mtf_coupons to service_role;
grant REFERENCES on public.mtf_coupons to service_role;
grant SELECT on public.mtf_coupons to service_role;
grant TRIGGER on public.mtf_coupons to service_role;
grant TRUNCATE on public.mtf_coupons to service_role;
grant UPDATE on public.mtf_coupons to service_role;
grant DELETE on public.mtf_dish_costs to service_role;
grant INSERT on public.mtf_dish_costs to service_role;
grant REFERENCES on public.mtf_dish_costs to service_role;
grant SELECT on public.mtf_dish_costs to service_role;
grant TRIGGER on public.mtf_dish_costs to service_role;
grant TRUNCATE on public.mtf_dish_costs to service_role;
grant UPDATE on public.mtf_dish_costs to service_role;
grant DELETE on public.mtf_expenses to service_role;
grant INSERT on public.mtf_expenses to service_role;
grant REFERENCES on public.mtf_expenses to service_role;
grant SELECT on public.mtf_expenses to service_role;
grant TRIGGER on public.mtf_expenses to service_role;
grant TRUNCATE on public.mtf_expenses to service_role;
grant UPDATE on public.mtf_expenses to service_role;
grant DELETE on public.mtf_game_players to service_role;
grant INSERT on public.mtf_game_players to service_role;
grant REFERENCES on public.mtf_game_players to service_role;
grant SELECT on public.mtf_game_players to service_role;
grant TRIGGER on public.mtf_game_players to service_role;
grant TRUNCATE on public.mtf_game_players to service_role;
grant UPDATE on public.mtf_game_players to service_role;
grant DELETE on public.mtf_game_scores to service_role;
grant INSERT on public.mtf_game_scores to service_role;
grant REFERENCES on public.mtf_game_scores to service_role;
grant SELECT on public.mtf_game_scores to service_role;
grant TRIGGER on public.mtf_game_scores to service_role;
grant TRUNCATE on public.mtf_game_scores to service_role;
grant UPDATE on public.mtf_game_scores to service_role;
grant DELETE on public.mtf_game_settings to service_role;
grant INSERT on public.mtf_game_settings to service_role;
grant REFERENCES on public.mtf_game_settings to service_role;
grant SELECT on public.mtf_game_settings to service_role;
grant TRIGGER on public.mtf_game_settings to service_role;
grant TRUNCATE on public.mtf_game_settings to service_role;
grant UPDATE on public.mtf_game_settings to service_role;
grant DELETE on public.mtf_home_settings to service_role;
grant INSERT on public.mtf_home_settings to service_role;
grant REFERENCES on public.mtf_home_settings to service_role;
grant SELECT on public.mtf_home_settings to service_role;
grant TRIGGER on public.mtf_home_settings to service_role;
grant TRUNCATE on public.mtf_home_settings to service_role;
grant UPDATE on public.mtf_home_settings to service_role;
grant DELETE on public.mtf_locations to service_role;
grant INSERT on public.mtf_locations to service_role;
grant REFERENCES on public.mtf_locations to service_role;
grant SELECT on public.mtf_locations to service_role;
grant TRIGGER on public.mtf_locations to service_role;
grant TRUNCATE on public.mtf_locations to service_role;
grant UPDATE on public.mtf_locations to service_role;
grant DELETE on public.mtf_mail_jobs to service_role;
grant INSERT on public.mtf_mail_jobs to service_role;
grant REFERENCES on public.mtf_mail_jobs to service_role;
grant SELECT on public.mtf_mail_jobs to service_role;
grant TRIGGER on public.mtf_mail_jobs to service_role;
grant TRUNCATE on public.mtf_mail_jobs to service_role;
grant UPDATE on public.mtf_mail_jobs to service_role;
grant DELETE on public.mtf_marketing_campaigns to service_role;
grant INSERT on public.mtf_marketing_campaigns to service_role;
grant REFERENCES on public.mtf_marketing_campaigns to service_role;
grant SELECT on public.mtf_marketing_campaigns to service_role;
grant TRIGGER on public.mtf_marketing_campaigns to service_role;
grant TRUNCATE on public.mtf_marketing_campaigns to service_role;
grant UPDATE on public.mtf_marketing_campaigns to service_role;
grant DELETE on public.mtf_menu_categories to service_role;
grant INSERT on public.mtf_menu_categories to service_role;
grant REFERENCES on public.mtf_menu_categories to service_role;
grant SELECT on public.mtf_menu_categories to service_role;
grant TRIGGER on public.mtf_menu_categories to service_role;
grant TRUNCATE on public.mtf_menu_categories to service_role;
grant UPDATE on public.mtf_menu_categories to service_role;
grant DELETE on public.mtf_movements to service_role;
grant INSERT on public.mtf_movements to service_role;
grant REFERENCES on public.mtf_movements to service_role;
grant SELECT on public.mtf_movements to service_role;
grant TRIGGER on public.mtf_movements to service_role;
grant TRUNCATE on public.mtf_movements to service_role;
grant UPDATE on public.mtf_movements to service_role;
grant DELETE on public.mtf_newyear_vouchers to service_role;
grant INSERT on public.mtf_newyear_vouchers to service_role;
grant REFERENCES on public.mtf_newyear_vouchers to service_role;
grant SELECT on public.mtf_newyear_vouchers to service_role;
grant TRIGGER on public.mtf_newyear_vouchers to service_role;
grant TRUNCATE on public.mtf_newyear_vouchers to service_role;
grant UPDATE on public.mtf_newyear_vouchers to service_role;
grant DELETE on public.mtf_opening_hours to service_role;
grant INSERT on public.mtf_opening_hours to service_role;
grant REFERENCES on public.mtf_opening_hours to service_role;
grant SELECT on public.mtf_opening_hours to service_role;
grant TRIGGER on public.mtf_opening_hours to service_role;
grant TRUNCATE on public.mtf_opening_hours to service_role;
grant UPDATE on public.mtf_opening_hours to service_role;
grant DELETE on public.mtf_order_costs to service_role;
grant INSERT on public.mtf_order_costs to service_role;
grant REFERENCES on public.mtf_order_costs to service_role;
grant SELECT on public.mtf_order_costs to service_role;
grant TRIGGER on public.mtf_order_costs to service_role;
grant TRUNCATE on public.mtf_order_costs to service_role;
grant UPDATE on public.mtf_order_costs to service_role;
grant DELETE on public.mtf_pageviews to service_role;
grant INSERT on public.mtf_pageviews to service_role;
grant REFERENCES on public.mtf_pageviews to service_role;
grant SELECT on public.mtf_pageviews to service_role;
grant TRIGGER on public.mtf_pageviews to service_role;
grant TRUNCATE on public.mtf_pageviews to service_role;
grant UPDATE on public.mtf_pageviews to service_role;
grant DELETE on public.mtf_promotion_limits to service_role;
grant INSERT on public.mtf_promotion_limits to service_role;
grant REFERENCES on public.mtf_promotion_limits to service_role;
grant SELECT on public.mtf_promotion_limits to service_role;
grant TRIGGER on public.mtf_promotion_limits to service_role;
grant TRUNCATE on public.mtf_promotion_limits to service_role;
grant UPDATE on public.mtf_promotion_limits to service_role;
grant DELETE on public.mtf_promotion_settings to service_role;
grant INSERT on public.mtf_promotion_settings to service_role;
grant REFERENCES on public.mtf_promotion_settings to service_role;
grant SELECT on public.mtf_promotion_settings to service_role;
grant TRIGGER on public.mtf_promotion_settings to service_role;
grant TRUNCATE on public.mtf_promotion_settings to service_role;
grant UPDATE on public.mtf_promotion_settings to service_role;
grant DELETE on public.mtf_receipts to service_role;
grant INSERT on public.mtf_receipts to service_role;
grant REFERENCES on public.mtf_receipts to service_role;
grant SELECT on public.mtf_receipts to service_role;
grant TRIGGER on public.mtf_receipts to service_role;
grant TRUNCATE on public.mtf_receipts to service_role;
grant UPDATE on public.mtf_receipts to service_role;
grant DELETE on public.mtf_review_mails to service_role;
grant INSERT on public.mtf_review_mails to service_role;
grant REFERENCES on public.mtf_review_mails to service_role;
grant SELECT on public.mtf_review_mails to service_role;
grant TRIGGER on public.mtf_review_mails to service_role;
grant TRUNCATE on public.mtf_review_mails to service_role;
grant UPDATE on public.mtf_review_mails to service_role;
grant DELETE on public.mtf_seasonal_events to service_role;
grant INSERT on public.mtf_seasonal_events to service_role;
grant REFERENCES on public.mtf_seasonal_events to service_role;
grant SELECT on public.mtf_seasonal_events to service_role;
grant TRIGGER on public.mtf_seasonal_events to service_role;
grant TRUNCATE on public.mtf_seasonal_events to service_role;
grant UPDATE on public.mtf_seasonal_events to service_role;
grant DELETE on public.mtf_seasonal_reservations to service_role;
grant INSERT on public.mtf_seasonal_reservations to service_role;
grant REFERENCES on public.mtf_seasonal_reservations to service_role;
grant SELECT on public.mtf_seasonal_reservations to service_role;
grant TRIGGER on public.mtf_seasonal_reservations to service_role;
grant TRUNCATE on public.mtf_seasonal_reservations to service_role;
grant UPDATE on public.mtf_seasonal_reservations to service_role;
grant DELETE on public.mtf_staff to service_role;
grant INSERT on public.mtf_staff to service_role;
grant REFERENCES on public.mtf_staff to service_role;
grant SELECT on public.mtf_staff to service_role;
grant TRIGGER on public.mtf_staff to service_role;
grant TRUNCATE on public.mtf_staff to service_role;
grant UPDATE on public.mtf_staff to service_role;
grant DELETE on public.mtf_stock to service_role;
grant INSERT on public.mtf_stock to service_role;
grant REFERENCES on public.mtf_stock to service_role;
grant SELECT on public.mtf_stock to service_role;
grant TRIGGER on public.mtf_stock to service_role;
grant TRUNCATE on public.mtf_stock to service_role;
grant UPDATE on public.mtf_stock to service_role;
grant DELETE on public.mtf_suppliers to service_role;
grant INSERT on public.mtf_suppliers to service_role;
grant REFERENCES on public.mtf_suppliers to service_role;
grant SELECT on public.mtf_suppliers to service_role;
grant TRIGGER on public.mtf_suppliers to service_role;
grant TRUNCATE on public.mtf_suppliers to service_role;
grant UPDATE on public.mtf_suppliers to service_role;
grant DELETE on public.mtf_task_assignees to service_role;
grant INSERT on public.mtf_task_assignees to service_role;
grant REFERENCES on public.mtf_task_assignees to service_role;
grant SELECT on public.mtf_task_assignees to service_role;
grant TRIGGER on public.mtf_task_assignees to service_role;
grant TRUNCATE on public.mtf_task_assignees to service_role;
grant UPDATE on public.mtf_task_assignees to service_role;
grant DELETE on public.mtf_tasks to service_role;
grant INSERT on public.mtf_tasks to service_role;
grant REFERENCES on public.mtf_tasks to service_role;
grant SELECT on public.mtf_tasks to service_role;
grant TRIGGER on public.mtf_tasks to service_role;
grant TRUNCATE on public.mtf_tasks to service_role;
grant UPDATE on public.mtf_tasks to service_role;
grant DELETE on public.mtf_welkom10_redemptions to service_role;
grant INSERT on public.mtf_welkom10_redemptions to service_role;
grant REFERENCES on public.mtf_welkom10_redemptions to service_role;
grant SELECT on public.mtf_welkom10_redemptions to service_role;
grant TRIGGER on public.mtf_welkom10_redemptions to service_role;
grant TRUNCATE on public.mtf_welkom10_redemptions to service_role;
grant UPDATE on public.mtf_welkom10_redemptions to service_role;
grant DELETE on public.mtf_welkom3_redemptions to service_role;
grant INSERT on public.mtf_welkom3_redemptions to service_role;
grant REFERENCES on public.mtf_welkom3_redemptions to service_role;
grant SELECT on public.mtf_welkom3_redemptions to service_role;
grant TRIGGER on public.mtf_welkom3_redemptions to service_role;
grant TRUNCATE on public.mtf_welkom3_redemptions to service_role;
grant UPDATE on public.mtf_welkom3_redemptions to service_role;
grant DELETE on public.order_email_outbox to service_role;
grant INSERT on public.order_email_outbox to service_role;
grant REFERENCES on public.order_email_outbox to service_role;
grant SELECT on public.order_email_outbox to service_role;
grant TRIGGER on public.order_email_outbox to service_role;
grant TRUNCATE on public.order_email_outbox to service_role;
grant UPDATE on public.order_email_outbox to service_role;
grant DELETE on public.orders to anon;
grant INSERT on public.orders to anon;
grant REFERENCES on public.orders to anon;
grant SELECT on public.orders to anon;
grant TRIGGER on public.orders to anon;
grant TRUNCATE on public.orders to anon;
grant UPDATE on public.orders to anon;
grant DELETE on public.orders to authenticated;
grant INSERT on public.orders to authenticated;
grant REFERENCES on public.orders to authenticated;
grant SELECT on public.orders to authenticated;
grant TRIGGER on public.orders to authenticated;
grant TRUNCATE on public.orders to authenticated;
grant UPDATE on public.orders to authenticated;
grant DELETE on public.orders to service_role;
grant INSERT on public.orders to service_role;
grant REFERENCES on public.orders to service_role;
grant SELECT on public.orders to service_role;
grant TRIGGER on public.orders to service_role;
grant TRUNCATE on public.orders to service_role;
grant UPDATE on public.orders to service_role;
grant DELETE on public.shop_settings to anon;
grant INSERT on public.shop_settings to anon;
grant REFERENCES on public.shop_settings to anon;
grant SELECT on public.shop_settings to anon;
grant TRIGGER on public.shop_settings to anon;
grant TRUNCATE on public.shop_settings to anon;
grant UPDATE on public.shop_settings to anon;
grant DELETE on public.shop_settings to authenticated;
grant INSERT on public.shop_settings to authenticated;
grant REFERENCES on public.shop_settings to authenticated;
grant SELECT on public.shop_settings to authenticated;
grant TRIGGER on public.shop_settings to authenticated;
grant TRUNCATE on public.shop_settings to authenticated;
grant UPDATE on public.shop_settings to authenticated;
grant DELETE on public.shop_settings to service_role;
grant INSERT on public.shop_settings to service_role;
grant REFERENCES on public.shop_settings to service_role;
grant SELECT on public.shop_settings to service_role;
grant TRIGGER on public.shop_settings to service_role;
grant TRUNCATE on public.shop_settings to service_role;
grant UPDATE on public.shop_settings to service_role;
grant execute on function public.enqueue_order_emails() to service_role;
grant execute on function public.mtf_adjust_stock(p_id uuid, p_delta numeric, p_reason text, p_actor text) to service_role;
grant execute on function public.mtf_apply_order_coupon() to service_role;
grant execute on function public.mtf_archive_order(p_id uuid, p_folder integer, p_actor text) to service_role;
grant execute on function public.mtf_capture_costs() to service_role;
grant execute on function public.mtf_capture_order_contact() to service_role;
grant execute on function public.mtf_confirm_coupon(p_hash text, p_code text) to service_role;
grant execute on function public.mtf_consume_stock() to service_role;
grant execute on function public.mtf_contact_capture(p_name text, p_email text, p_phone text, p_consent boolean, p_source text) to service_role;
grant execute on function public.mtf_contact_token(p_token text, p_action text) to service_role;
grant execute on function public.mtf_coupon_discount(p_code text, p_email text, p_subtotal numeric) to service_role;
grant execute on function public.mtf_coupon_discount_items(p_code text, p_email text, p_subtotal numeric, p_items jsonb) to service_role;
grant execute on function public.mtf_dish_popularity(p_location text) to anon;
grant execute on function public.mtf_dish_popularity(p_location text) to authenticated;
grant execute on function public.mtf_dish_popularity(p_location text) to service_role;
grant execute on function public.mtf_enqueue_review_mail() to service_role;
grant execute on function public.mtf_finish_order(p_id uuid, p_status text, p_folder integer, p_actor text) to service_role;
grant execute on function public.mtf_game_contact_optin(p_email text, p_name text) to service_role;
grant execute on function public.mtf_game_record(p_email text, p_name text, p_score integer, p_optin boolean, p_consent text, p_ip text) to service_role;
grant execute on function public.mtf_home_favorites() to anon;
grant execute on function public.mtf_home_favorites() to authenticated;
grant execute on function public.mtf_home_favorites() to service_role;
grant execute on function public.mtf_identity_email(v text) to service_role;
grant execute on function public.mtf_identity_phone(v text) to service_role;
grant execute on function public.mtf_location_schema(p_slug text) to service_role;
grant execute on function public.mtf_marketing_queue(p_id uuid) to service_role;
grant execute on function public.mtf_newyear_cancel() to service_role;
grant execute on function public.mtf_newyear_discount(p_code text, p_email text, p_subtotal numeric, p_at timestamp with time zone) to service_role;
grant execute on function public.mtf_newyear_issue() to service_role;
grant execute on function public.mtf_promotion_rate(p_bucket text, p_limit integer) to service_role;
grant execute on function public.mtf_queue_task_assignment() to service_role;
grant execute on function public.mtf_receipt_periods() to service_role;
grant execute on function public.mtf_save_addon(p_id uuid, p_name text, p_price numeric, p_cost numeric, p_menu_item_id text, p_active boolean, p_categories text[]) to service_role;
grant execute on function public.mtf_save_menu_order(categories jsonb, items jsonb) to service_role;
grant execute on function public.mtf_save_receipt_upload(p_id uuid, p_folder integer, p_date date, p_description text, p_amount numeric, p_path text, p_name text, p_mime text, p_book_expense boolean, p_actor text) to service_role;
grant execute on function public.mtf_seasonal_order() to service_role;
grant execute on function public.mtf_seasonal_public() to service_role;
grant execute on function public.mtf_seasonal_quote(p_event text, p_date date, p_time time without time zone, p_items jsonb, p_email text, p_phone text, p_at timestamp with time zone) to service_role;
grant execute on function public.mtf_seasonal_status() to service_role;
grant execute on function public.mtf_seasonal_used(p_event text) to service_role;
grant execute on function public.mtf_site_hourly(p_day date) to service_role;
grant execute on function public.mtf_site_report(p_from date, p_to date, p_unit text) to service_role;
grant execute on function public.mtf_task_summary(p_actor uuid, p_owner boolean) to service_role;
grant execute on function public.mtf_task_write(p_mode text, p_id uuid, p_actor uuid, p_owner boolean, p_title text, p_information text, p_deadline date, p_assignees uuid[], p_status text, p_version timestamp with time zone) to service_role;
grant execute on function public.mtf_validate_new_order_date() to service_role;
grant execute on function public.mtf_welkom10_check(p_email text, p_phone text, p_name text, p_subtotal numeric, p_at timestamp with time zone) to service_role;
grant execute on function public.mtf_welkom3_check(p_email text, p_phone text, p_name text, p_subtotal numeric, p_at timestamp with time zone) to service_role;
