-- Sjabloon voor een extra vestiging: vervang __LOCATION_SCHEMA__ door bijv. mtf_rotterdam (patroon mtf_[a-z0-9_]).
-- Daarna: rij in public.mtf_locations toevoegen en het schema toevoegen aan pgrst.db_schemas (zie PLATFORM-NIEUWE-KLANT.md).
-- Schema __LOCATION_SCHEMA__ (bron: mtf_ob), gegenereerd 2026-11-18
set check_function_bodies = off;
create schema if not exists "__LOCATION_SCHEMA__";

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".enqueue_order_emails()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO '__LOCATION_SCHEMA__'
AS $function$ begin insert into __LOCATION_SCHEMA__.order_email_outbox(order_id,kind) values(new.id,'restaurant'),(new.id,'customer') on conflict(order_id,kind) do nothing; return new; end; $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_adjust_stock(p_id uuid, p_delta numeric, p_reason text, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
 if p_delta=0 or p_reason is null or length(trim(p_reason))=0 then raise exception 'Aantal en reden verplicht'; end if;
 update __LOCATION_SCHEMA__.mtf_stock set quantity=quantity+p_delta where id=p_id and active;
 if not found then raise exception 'Artikel niet gevonden';end if;
 insert into __LOCATION_SCHEMA__.mtf_movements(stock_id,delta,reason,actor) values(p_id,p_delta,p_reason,p_actor);
end$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_apply_order_coupon()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 new.coupon_code:=nullif(upper(trim(new.coupon_code)),'');new.discount_amount:=0;
 if new.coupon_code is not null then
 perform 1 from __LOCATION_SCHEMA__.mtf_coupons where code=new.coupon_code for update;
 new.discount_amount:=__LOCATION_SCHEMA__.mtf_coupon_discount_items(new.coupon_code,new.customer_email,new.subtotal,new.items);
 update __LOCATION_SCHEMA__.mtf_coupons set redeemed_at=now(),redeemed_order_id=new.id where code=new.coupon_code;
 end if;
 new.total:=new.subtotal+new.delivery_fee-new.discount_amount;return new;
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_archive_order(p_id uuid, p_folder integer, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o __LOCATION_SCHEMA__.orders;r __LOCATION_SCHEMA__.mtf_receipts; snap jsonb;
begin
 if p_folder is null or p_folder not between 1 and 3 then raise exception 'Kies Map 1, 2 of 3';end if;
 select * into o from __LOCATION_SCHEMA__.orders where id=p_id for update;if not found then raise exception 'Bestelling niet gevonden';end if;
 if o.status not in ('Afgehaald','Bezorgd') then raise exception 'Rond de bestelling eerst af';end if;
 snap=jsonb_build_object('order_number',o.order_number,'customer_name',o.customer_name,'address',o.address,'city',o.city,'method',o.method,'requested_date',o.requested_date,'requested_time',o.requested_time,'payment',o.payment,'payment_status',o.payment_status,'items',o.items,'subtotal',o.subtotal,'delivery_fee',o.delivery_fee,'discount_amount',coalesce(to_jsonb(o)->'discount_amount','0'::jsonb),'total',o.total);
 insert into __LOCATION_SCHEMA__.mtf_receipts(folder,document_date,kind,description,amount,order_id,snapshot,created_by)
 values(p_folder,o.requested_date,'order','Bestelbon '||o.order_number,o.total,o.id,snap,p_actor)
 on conflict(order_id) do update set folder=excluded.folder,updated_at=now() returning * into r;
 return to_jsonb(r);
end$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_capture_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare line jsonb; c __LOCATION_SCHEMA__.mtf_dish_costs; sc __LOCATION_SCHEMA__.mtf_dish_costs; pack jsonb; s __LOCATION_SCHEMA__.mtf_stock; snap jsonb='[]'; packs jsonb; recipes jsonb; cost numeric=0; linecost numeric; known boolean=true; qty numeric; extra_cost numeric;
begin
 for line in select value from jsonb_array_elements(new.items) loop
  select * into c from __LOCATION_SCHEMA__.mtf_dish_costs where dish_id=line->>'id';
  if not found or c.ingredient_cost is null then known=false; end if;
  linecost=coalesce(c.ingredient_cost,0);recipes=coalesce(c.packaging,'[]');
  if nullif(line->>'side_id','') is not null then
   select * into sc from __LOCATION_SCHEMA__.mtf_dish_costs where dish_id=line->>'side_id';
   if not found or sc.ingredient_cost is null then known=false;end if;
   linecost=linecost+coalesce(sc.ingredient_cost,0);recipes=recipes||coalesce(sc.packaging,'[]');
  end if;
  if nullif(line->>'addon_id','') is not null then
   select a.cost into extra_cost from __LOCATION_SCHEMA__.mtf_addons a where a.id=(line->>'addon_id')::uuid;
   if not found or extra_cost is null then known=false;else linecost=linecost+extra_cost;end if;
  end if;
  packs='[]';qty=(line->>'qty')::numeric;
  for pack in select value from jsonb_array_elements(recipes) loop
   select * into s from __LOCATION_SCHEMA__.mtf_stock where id=(pack->>'id')::uuid and packaging and active;
   if not found then known=false;continue;end if;
   linecost=linecost+s.unit_cost*(pack->>'qty')::numeric;
   packs=packs||jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name,'qty',(pack->>'qty')::numeric,'unit_cost',s.unit_cost));
  end loop;
  snap=snap||jsonb_build_array(jsonb_build_object('id',line->>'id','name',line->>'name','qty',qty,'unit_cost',linecost,'packaging',packs));
  cost=cost+linecost*qty;
 end loop;
 insert into __LOCATION_SCHEMA__.mtf_order_costs(order_id,snapshot,cost,complete) values(new.id,snap,cost,known);
 return new;
end$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_confirm_coupon(p_hash text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m __LOCATION_SCHEMA__.mtf_coupon_members;s __LOCATION_SCHEMA__.mtf_promotion_settings;c __LOCATION_SCHEMA__.mtf_coupons;pn text;
begin
 select * into m from __LOCATION_SCHEMA__.mtf_coupon_members where token_hash=p_hash for update;
 if not found or m.token_expires<=now() then raise exception 'Bevestigingslink ongeldig of verlopen. Meld je opnieuw aan.';end if;
 select * into c from __LOCATION_SCHEMA__.mtf_coupons where email=m.email;
 if found then return to_jsonb(c)-'email'-'redeemed_order_id';end if;
 select * into s from __LOCATION_SCHEMA__.mtf_promotion_settings where id=true;
 if not s.enabled then raise exception 'De couponactie is momenteel niet actief';end if;
 if s.kind='product' then select name into pn from __LOCATION_SCHEMA__.menu_items where id=s.product_id and active=true;if not found then raise exception 'Het cadeauproduct is momenteel niet beschikbaar';end if;end if;
 update __LOCATION_SCHEMA__.mtf_coupon_members set confirmed_at=now(),subscribed=true where email=m.email;
 insert into __LOCATION_SCHEMA__.mtf_coupons(code,email,kind,amount,minimum,expires_at,product_id,product_name) values(p_code,m.email,s.kind,s.amount,s.minimum,now()+make_interval(days=>s.valid_days),case when s.kind='product' then s.product_id else null end,pn) returning * into c;
 return to_jsonb(c)-'email'-'redeemed_order_id';
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_consume_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c __LOCATION_SCHEMA__.mtf_order_costs; l jsonb;p jsonb; factor int; delta numeric;
begin
 select * into c from __LOCATION_SCHEMA__.mtf_order_costs where order_id=new.id for update;
 if not found then return new;end if;
 if new.status in ('Bezorgd','Afgehaald') and not c.consumed then factor=-1;
 elsif new.status not in ('Bezorgd','Afgehaald') and c.consumed then factor=1;
 else return new;end if;
 for l in select value from jsonb_array_elements(c.snapshot) loop
  for p in select value from jsonb_array_elements(l->'packaging') loop
   delta=factor*(p->>'qty')::numeric*(l->>'qty')::numeric;
   update __LOCATION_SCHEMA__.mtf_stock set quantity=quantity+delta where id=(p->>'id')::uuid;
   insert into __LOCATION_SCHEMA__.mtf_movements(stock_id,delta,reason,order_id,actor) values((p->>'id')::uuid,delta,case when factor=-1 then 'Verbruik afgeronde bestelling' else 'Terugboeking bestelling' end,new.id,'orderstatus');
  end loop;
 end loop;
 update __LOCATION_SCHEMA__.mtf_order_costs set consumed=(factor=-1) where order_id=new.id;
 return new;
end$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_coupon_discount(p_code text, p_email text, p_subtotal numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c __LOCATION_SCHEMA__.mtf_coupons; begin
 if nullif(trim(p_code),'') is null then return 0; end if;
 select * into c from __LOCATION_SCHEMA__.mtf_coupons where code=upper(trim(p_code));
 if not found or c.email<>lower(trim(p_email)) or c.disabled or c.redeemed_at is not null or c.expires_at<=now() then raise exception 'Coupon ongeldig, verlopen, gebruikt of gekoppeld aan een ander e-mailadres'; end if;
 if p_subtotal<c.minimum then raise exception 'Voor deze coupon is minimaal € % aan gerechten nodig',c.minimum; end if;
 return least(p_subtotal,case when c.kind='percent' then round(p_subtotal*c.amount/100,2) else c.amount end);
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_coupon_discount_items(p_code text, p_email text, p_subtotal numeric, p_items jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c __LOCATION_SCHEMA__.mtf_coupons;product_price numeric;product_active boolean;begin
 if nullif(trim(p_code),'') is null then return 0;end if;
 select * into c from __LOCATION_SCHEMA__.mtf_coupons where code=upper(trim(p_code));
 if not found or c.email<>lower(trim(p_email)) or c.disabled or c.redeemed_at is not null or c.expires_at<=now() then raise exception 'Coupon ongeldig, verlopen, gebruikt of gekoppeld aan een ander e-mailadres';end if;
 if p_subtotal<c.minimum then raise exception 'Voor deze coupon is minimaal € % aan gerechten nodig',c.minimum;end if;
 if c.kind<>'product' then return __LOCATION_SCHEMA__.mtf_coupon_discount(p_code,p_email,p_subtotal);end if;
 select price,active into product_price,product_active from __LOCATION_SCHEMA__.menu_items where id=c.product_id;
 if not found or not product_active then raise exception 'Het cadeauproduct is momenteel niet beschikbaar. Neem contact op met ons.';end if;
 if not exists(select 1 from jsonb_array_elements(p_items) x where x->>'id'=c.product_id and (x->>'qty')::numeric>=1) then raise exception 'Voeg % toe aan je winkelmandje om deze coupon te gebruiken',c.product_name;end if;
 return least(p_subtotal,product_price);
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_finish_order(p_id uuid, p_status text, p_folder integer, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o __LOCATION_SCHEMA__.orders;
begin
 if p_status is null or p_status not in ('Nieuw','In bereiding','Klaar','Onderweg','Afgehaald','Bezorgd','Geannuleerd') then raise exception 'Ongeldige status';end if;
 if p_folder is not null and (p_folder not between 1 and 3 or p_status not in ('Afgehaald','Bezorgd')) then raise exception 'Een bestelbon kan alleen bij afronden worden bewaard in Map 1, 2 of 3';end if;
 update __LOCATION_SCHEMA__.orders set status=p_status,updated_at=now() where id=p_id returning * into o;
 if not found then raise exception 'Bestelling niet gevonden';end if;
 if p_folder is not null then perform __LOCATION_SCHEMA__.mtf_archive_order(p_id,p_folder,p_actor);end if;
 return to_jsonb(o);
end$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_home_favorites()
 RETURNS TABLE(dish_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with seeds(id,position) as (values ('tom-kha-kai',1),('groene-curry-rund',2),('loempia-per-2',3),('pastei-per-4',4)),
counts as (select i->>'id' as id,sum((i->>'qty')::numeric) as qty from __LOCATION_SCHEMA__.orders o cross join lateral jsonb_array_elements(o.items) i where o.status<>'Geannuleerd' and o.created_at>=(select favorites_since from __LOCATION_SCHEMA__.mtf_home_settings where id=true) and o.created_at>=now()-interval '30 days' group by i->>'id')
select m.id from __LOCATION_SCHEMA__.menu_items m left join counts c on c.id=m.id left join seeds s on s.id=m.id where m.active and (c.qty>0 or s.position is not null) order by coalesce(c.qty,0) desc,coalesce(s.position,99),m.id limit 4;
$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_promotion_rate(p_bucket text, p_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n integer;begin
 insert into __LOCATION_SCHEMA__.mtf_promotion_limits(bucket) values(p_bucket)
 on conflict(bucket) do update set count=case when mtf_promotion_limits.started_at<now()-interval '1 hour' then 1 else mtf_promotion_limits.count+1 end,started_at=case when mtf_promotion_limits.started_at<now()-interval '1 hour' then now() else mtf_promotion_limits.started_at end returning count into n;
 return n<=p_limit;
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_queue_task_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into __LOCATION_SCHEMA__.mtf_mail_jobs(dedupe,kind,to_email,payload)
 select 'task-assignment-'||gen_random_uuid()::text,'task',s.email,jsonb_build_object('task_id',t.id,'user_id',s.user_id,'name',s.name,'title',t.title,'information',t.information,'deadline',t.deadline,'creator',t.created_by_label)
 from __LOCATION_SCHEMA__.mtf_tasks t join __LOCATION_SCHEMA__.mtf_staff s on s.user_id=new.user_id and s.active where t.id=new.task_id;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_receipt_periods()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select folder,year,quarter,count(*) as count,coalesce(sum(amount) filter(where kind='order'),0) as orders_total,coalesce(sum(amount) filter(where kind='upload'),0) as uploads_total,coalesce(sum(amount) filter(where expense_id is not null),0) as expenses_total from __LOCATION_SCHEMA__.mtf_receipts group by folder,year,quarter order by year desc,quarter desc,folder)t;
$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_save_addon(p_id uuid, p_name text, p_price numeric, p_cost numeric, p_menu_item_id text, p_active boolean, p_categories text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid;
begin
 if p_name is null or char_length(trim(p_name)) not between 1 and 100 or p_price is null or p_price<0 or p_price>1000 or round(p_price,2)<>p_price or p_active is null or (p_cost is not null and p_cost<0) then raise exception 'Controleer naam, prijs en kostprijs';end if;
 if coalesce(cardinality(p_categories),0)=0 or cardinality(p_categories)<>(select count(distinct c) from unnest(p_categories)c) or exists(select 1 from unnest(p_categories)c where not exists(select 1 from __LOCATION_SCHEMA__.mtf_menu_categories where name=c)) then raise exception 'Kies één of meerdere bestaande categorieën';end if;
 if p_menu_item_id is not null and not exists(select 1 from __LOCATION_SCHEMA__.menu_items where id=p_menu_item_id and (not p_active or (active and deleted_at is null))) then raise exception 'Kies een zichtbaar gerecht of kies Eigen extra';end if;
 if p_id is null then insert into __LOCATION_SCHEMA__.mtf_addons(name,price,cost,menu_item_id,active) values(trim(p_name),p_price,p_cost,p_menu_item_id,p_active) returning id into uid;
 else uid=p_id;update __LOCATION_SCHEMA__.mtf_addons set name=trim(p_name),price=p_price,cost=p_cost,menu_item_id=p_menu_item_id,active=p_active,updated_at=clock_timestamp() where id=uid and deleted_at is null; if not found then raise exception 'Deze extra bestaat niet meer. Vernieuw de lijst.';end if;end if;
 delete from __LOCATION_SCHEMA__.mtf_addon_categories where addon_id=uid and not(category_name=any(p_categories));
 insert into __LOCATION_SCHEMA__.mtf_addon_categories(addon_id,category_name) select uid,c from unnest(p_categories)c on conflict do nothing;
 return uid;
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_save_menu_order(categories jsonb, items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO '__LOCATION_SCHEMA__', 'pg_temp'
AS $function$
begin
 if jsonb_typeof(categories) is distinct from 'array' or jsonb_typeof(items) is distinct from 'array' then raise exception 'Ongeldige menuvolgorde'; end if;
 lock table __LOCATION_SCHEMA__.mtf_menu_categories,__LOCATION_SCHEMA__.menu_items in share row exclusive mode;
 if exists(select 1 from jsonb_array_elements(categories) v where jsonb_typeof(v) <> 'string') or exists(select 1 from jsonb_array_elements(items) v where jsonb_typeof(v) <> 'string') then raise exception 'Ongeldige menuvolgorde'; end if;
 if jsonb_array_length(categories)<>(select count(*) from __LOCATION_SCHEMA__.mtf_menu_categories) or jsonb_array_length(categories)<>(select count(distinct v) from jsonb_array_elements_text(categories) v) or exists(select 1 from jsonb_array_elements_text(categories) v where not exists(select 1 from __LOCATION_SCHEMA__.mtf_menu_categories c where c.name=v)) then raise exception 'De categorieën zijn intussen gewijzigd. Open de volgorde opnieuw.'; end if;
 if jsonb_array_length(items)<>(select count(*) from __LOCATION_SCHEMA__.menu_items where deleted_at is null) or jsonb_array_length(items)<>(select count(distinct v) from jsonb_array_elements_text(items) v) or exists(select 1 from jsonb_array_elements_text(items) v where not exists(select 1 from __LOCATION_SCHEMA__.menu_items m where m.id=v and m.deleted_at is null)) then raise exception 'Het menu is intussen gewijzigd. Open de volgorde opnieuw.'; end if;
 update __LOCATION_SCHEMA__.mtf_menu_categories c set sort_order=o.n::integer*10 from jsonb_array_elements_text(categories) with ordinality o(name,n) where c.name=o.name;
 update __LOCATION_SCHEMA__.menu_items m set sort_order=o.n::integer*10,updated_at=now() from jsonb_array_elements_text(items) with ordinality o(id,n) where m.id=o.id;
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_save_receipt_upload(p_id uuid, p_folder integer, p_date date, p_description text, p_amount numeric, p_path text, p_name text, p_mime text, p_book_expense boolean, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e uuid;r __LOCATION_SCHEMA__.mtf_receipts;
begin
 if p_book_expense then insert into __LOCATION_SCHEMA__.mtf_expenses(date,description,amount) values(p_date,p_description,p_amount) returning id into e;end if;
 insert into __LOCATION_SCHEMA__.mtf_receipts(id,folder,document_date,kind,description,amount,file_path,file_name,mime,expense_id,created_by)
 values(p_id,p_folder,p_date,'upload',p_description,p_amount,p_path,p_name,p_mime,e,p_actor) returning * into r;
 return to_jsonb(r);
end$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_task_summary(p_actor uuid, p_owner boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with relevant as (select t.id,t.title,t.deadline from __LOCATION_SCHEMA__.mtf_tasks t where t.status in ('Open','In uitvoering') and (p_owner or t.created_by=p_actor or exists(select 1 from __LOCATION_SCHEMA__.mtf_task_assignees a where a.task_id=t.id and a.user_id=p_actor))),
 totals as (select count(*) as total,count(*) filter(where deadline<(now() at time zone 'Europe/Amsterdam')::date) as overdue from relevant)
 select jsonb_build_object('total',totals.total,'overdue',totals.overdue,'upcoming',coalesce((select jsonb_agg(x) from (select * from relevant order by deadline,id limit 3) x),'[]'::jsonb)) from totals;
$function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_task_write(p_mode text, p_id uuid, p_actor uuid, p_owner boolean, p_title text, p_information text, p_deadline date, p_assignees uuid[], p_status text, p_version timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t __LOCATION_SCHEMA__.mtf_tasks; label text; uid uuid;
begin
 if p_actor is null then
  if not coalesce(p_owner,false) then raise exception 'Geen toegang'; end if;
  label='Eigenaar';
 else
  select coalesce(nullif(name,''),email) into label from __LOCATION_SCHEMA__.mtf_staff where user_id=p_actor and active;
  if not found then raise exception 'Account heeft geen toegang';end if;
 end if;
 if p_mode not in ('save','status') or p_mode is null then raise exception 'Ongeldige taakactie';end if;
 if p_id is not null then
  select * into t from __LOCATION_SCHEMA__.mtf_tasks where id=p_id for update;
  if not found then raise exception 'Taak niet gevonden'; end if;
  if p_mode='save' then
   if not coalesce(p_owner,false) and (p_actor is null or t.created_by is distinct from p_actor) then raise exception 'Alleen de aanmaker of eigenaar kan de taak bewerken'; end if;
  elsif not coalesce(p_owner,false) and (p_actor is null or (t.created_by is distinct from p_actor and not exists(select 1 from __LOCATION_SCHEMA__.mtf_task_assignees where task_id=p_id and user_id=p_actor))) then raise exception 'Je bent niet betrokken bij deze taak';end if;
  if p_version is distinct from t.updated_at then raise exception 'De taak is intussen gewijzigd. Vernieuw de lijst en probeer opnieuw.';end if;
 elsif p_mode<>'save' then raise exception 'Taak niet gevonden';end if;
 if p_mode='save' then
  if p_title is null or char_length(trim(p_title)) not between 1 and 150 or p_information is null or char_length(p_information)>5000 or p_deadline is null then raise exception 'Vul een titel, deadline en geldige informatie in';end if;
  if coalesce(cardinality(p_assignees),0) not between 1 and 100 or cardinality(p_assignees)<>(select count(distinct a) from unnest(p_assignees) a) then raise exception 'Kies minimaal één en maximaal 100 verschillende gebruikers';end if;
  perform user_id from __LOCATION_SCHEMA__.mtf_staff where user_id=any(p_assignees) and active order by user_id for share;
  if (select count(*) from __LOCATION_SCHEMA__.mtf_staff where user_id=any(p_assignees) and active)<>cardinality(p_assignees) then raise exception 'Een geselecteerde gebruiker is niet meer actief';end if;
  if p_id is null then
   insert into __LOCATION_SCHEMA__.mtf_tasks(title,information,deadline,created_by,created_by_label,updated_by_label) values(trim(p_title),trim(p_information),p_deadline,p_actor,label,label) returning id into uid;
  else
   uid=p_id;
   update __LOCATION_SCHEMA__.mtf_tasks set title=trim(p_title),information=trim(p_information),deadline=p_deadline,updated_at=clock_timestamp(),updated_by_label=label where id=uid;
  end if;
  delete from __LOCATION_SCHEMA__.mtf_task_assignees where task_id=uid and not(user_id=any(p_assignees));
  insert into __LOCATION_SCHEMA__.mtf_task_assignees(task_id,user_id) select uid,a from unnest(p_assignees) a on conflict do nothing;
 else
  if p_status is null or p_status not in ('Open','In uitvoering','Afgerond','Geannuleerd') then raise exception 'Ongeldige taakstatus';end if;
  uid=p_id;
  update __LOCATION_SCHEMA__.mtf_tasks set status=p_status,updated_at=clock_timestamp(),updated_by_label=label where id=uid;
 end if;
 return uid;
end $function$
;

CREATE OR REPLACE FUNCTION "__LOCATION_SCHEMA__".mtf_validate_new_order_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare local_now timestamp:=clock_timestamp() at time zone 'Europe/Amsterdam';r text;h record;begin
 select reason into r from __LOCATION_SCHEMA__.mtf_closed_dates where day=new.requested_date;
 if found then raise exception 'Op % zijn we gesloten: %',new.requested_date,r;end if;
 select open_time,close_time,order_cutoff into h from __LOCATION_SCHEMA__.mtf_opening_hours where weekday=extract(dow from new.requested_date)::smallint;
 if not found then raise exception 'Op deze dag zijn we gesloten';end if;
 if new.requested_date<local_now::date or (new.requested_date=local_now::date and local_now::time>h.order_cutoff) then raise exception 'Kies een volgende openingsdag; voor vandaag bestel je uiterlijk om %',to_char(h.order_cutoff,'HH24:MI');end if;
 if new.requested_time<h.open_time or new.requested_time>h.close_time or extract(minute from new.requested_time)::int%15<>0 or extract(second from new.requested_time)<>0 or (new.requested_date=local_now::date and new.requested_time<=local_now::time) then raise exception 'Kies een beschikbaar tijdvak binnen onze openingstijden';end if;
 return new;
end $function$
;

create table if not exists "__LOCATION_SCHEMA__".menu_items (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_addon_categories (
  addon_id uuid not null,
  category_name text not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_addons (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_categories (
  id uuid default gen_random_uuid() not null,
  name text not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_closed_dates (
  day date not null,
  reason text not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_coupon_members (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_coupons (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_dish_costs (
  dish_id text not null,
  ingredient_cost numeric(12,4),
  packaging jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_expenses (
  id uuid default gen_random_uuid() not null,
  date date not null,
  description text not null,
  amount numeric(12,2) not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_home_settings (
  id boolean default true not null,
  favorites_since timestamp with time zone default now() not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_mail_jobs (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_menu_categories (
  name text not null,
  created_at timestamp with time zone default now() not null,
  sort_order integer default 2147483647 not null,
  note text default ''::text not null,
  allows_sides boolean default false not null,
  is_side boolean default false not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_movements (
  id uuid default gen_random_uuid() not null,
  stock_id uuid not null,
  delta numeric(12,3) not null,
  reason text not null,
  order_id uuid,
  actor text,
  created_at timestamp with time zone default now() not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_opening_hours (
  weekday smallint not null,
  open_time time without time zone not null,
  close_time time without time zone not null,
  order_cutoff time without time zone not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_order_costs (
  order_id uuid not null,
  snapshot jsonb not null,
  cost numeric(12,4) not null,
  complete boolean not null,
  consumed boolean default false not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_promotion_limits (
  bucket text not null,
  started_at timestamp with time zone default now() not null,
  count integer default 1 not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_promotion_settings (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_receipts (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_staff (
  user_id uuid not null,
  email text not null,
  name text default ''::text not null,
  owner boolean default false not null,
  active boolean default true not null,
  permissions jsonb default '{}'::jsonb not null,
  invited_at timestamp with time zone default now() not null,
  claimed_at timestamp with time zone
);
create table if not exists "__LOCATION_SCHEMA__".mtf_stock (
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
create table if not exists "__LOCATION_SCHEMA__".mtf_suppliers (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text,
  phone text,
  website text,
  notes text
);
create table if not exists "__LOCATION_SCHEMA__".mtf_task_assignees (
  task_id uuid not null,
  user_id uuid not null
);
create table if not exists "__LOCATION_SCHEMA__".mtf_tasks (
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
create table if not exists "__LOCATION_SCHEMA__".order_email_outbox (
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
create table if not exists "__LOCATION_SCHEMA__".orders (
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
  mollie_payment_id text,
  online_payment_state text
);
create table if not exists "__LOCATION_SCHEMA__".shop_settings (
  id boolean default true not null,
  is_open boolean default true not null,
  message text default 'Momenteel nemen wij geen online bestellingen aan. Probeer het later opnieuw.'::text not null,
  updated_at timestamp with time zone default now() not null
);

alter table "__LOCATION_SCHEMA__".menu_items add constraint menu_items_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_addon_categories add constraint mtf_addon_categories_pkey PRIMARY KEY (addon_id, category_name);
alter table "__LOCATION_SCHEMA__".mtf_addons add constraint mtf_addons_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_categories add constraint mtf_categories_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_closed_dates add constraint mtf_closed_dates_pkey PRIMARY KEY (day);
alter table "__LOCATION_SCHEMA__".mtf_coupon_members add constraint mtf_coupon_members_pkey PRIMARY KEY (email);
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_pkey PRIMARY KEY (code);
alter table "__LOCATION_SCHEMA__".mtf_dish_costs add constraint mtf_dish_costs_pkey PRIMARY KEY (dish_id);
alter table "__LOCATION_SCHEMA__".mtf_expenses add constraint mtf_expenses_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_home_settings add constraint mtf_home_settings_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_mail_jobs add constraint mtf_mail_jobs_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_menu_categories add constraint mtf_menu_categories_pkey PRIMARY KEY (name);
alter table "__LOCATION_SCHEMA__".mtf_movements add constraint mtf_movements_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_opening_hours add constraint mtf_opening_hours_pkey PRIMARY KEY (weekday);
alter table "__LOCATION_SCHEMA__".mtf_order_costs add constraint mtf_order_costs_pkey PRIMARY KEY (order_id);
alter table "__LOCATION_SCHEMA__".mtf_promotion_limits add constraint mtf_promotion_limits_pkey PRIMARY KEY (bucket);
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_staff add constraint mtf_staff_pkey PRIMARY KEY (user_id);
alter table "__LOCATION_SCHEMA__".mtf_stock add constraint mtf_stock_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_suppliers add constraint mtf_suppliers_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_task_assignees add constraint mtf_task_assignees_pkey PRIMARY KEY (task_id, user_id);
alter table "__LOCATION_SCHEMA__".mtf_tasks add constraint mtf_tasks_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".order_email_outbox add constraint order_email_outbox_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".orders add constraint orders_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".shop_settings add constraint shop_settings_pkey PRIMARY KEY (id);
alter table "__LOCATION_SCHEMA__".mtf_categories add constraint mtf_categories_name_key UNIQUE (name);
alter table "__LOCATION_SCHEMA__".mtf_coupon_members add constraint mtf_coupon_members_token_hash_key UNIQUE (token_hash);
alter table "__LOCATION_SCHEMA__".mtf_coupon_members add constraint mtf_coupon_members_unsubscribe_hash_key UNIQUE (unsubscribe_hash);
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_email_key UNIQUE (email);
alter table "__LOCATION_SCHEMA__".mtf_mail_jobs add constraint mtf_mail_jobs_dedupe_key UNIQUE (dedupe);
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_expense_id_key UNIQUE (expense_id);
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_file_path_key UNIQUE (file_path);
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_order_id_key UNIQUE (order_id);
alter table "__LOCATION_SCHEMA__".mtf_staff add constraint mtf_staff_email_key UNIQUE (email);
alter table "__LOCATION_SCHEMA__".order_email_outbox add constraint order_email_outbox_order_id_kind_key UNIQUE (order_id, kind);
alter table "__LOCATION_SCHEMA__".orders add constraint orders_order_number_key UNIQUE (order_number);
alter table "__LOCATION_SCHEMA__".menu_items add constraint menu_items_price_check CHECK ((price >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_addons add constraint mtf_addons_cost_check CHECK ((cost >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_addons add constraint mtf_addons_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 100)));
alter table "__LOCATION_SCHEMA__".mtf_addons add constraint mtf_addons_price_check CHECK (((price >= (0)::numeric) AND (price <= (1000)::numeric)));
alter table "__LOCATION_SCHEMA__".mtf_categories add constraint mtf_categories_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table "__LOCATION_SCHEMA__".mtf_closed_dates add constraint mtf_closed_dates_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 200)));
alter table "__LOCATION_SCHEMA__".mtf_coupon_members add constraint mtf_coupon_members_email_check CHECK ((email = lower(TRIM(BOTH FROM email))));
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_amount_check CHECK ((amount > (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_kind_check CHECK ((kind = ANY (ARRAY['fixed'::text, 'percent'::text, 'product'::text])));
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_minimum_check CHECK ((minimum >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_product_coupon_required CHECK (((kind <> 'product'::text) OR (product_id IS NOT NULL)));
alter table "__LOCATION_SCHEMA__".mtf_dish_costs add constraint mtf_dish_costs_ingredient_cost_check CHECK ((ingredient_cost >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_expenses add constraint mtf_expenses_amount_check CHECK ((amount >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_home_settings add constraint mtf_home_settings_id_check CHECK (id);
alter table "__LOCATION_SCHEMA__".mtf_mail_jobs add constraint mtf_mail_jobs_kind_check CHECK ((kind = ANY (ARRAY['payment'::text, 'invite'::text, 'task'::text])));
alter table "__LOCATION_SCHEMA__".mtf_mail_jobs add constraint mtf_mail_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
alter table "__LOCATION_SCHEMA__".mtf_menu_categories add constraint mtf_menu_categories_name_check CHECK (((name = TRIM(BOTH FROM name)) AND ((length(name) >= 1) AND (length(name) <= 80))));
alter table "__LOCATION_SCHEMA__".mtf_menu_categories add constraint mtf_menu_categories_note_check CHECK ((char_length(note) <= 500));
alter table "__LOCATION_SCHEMA__".mtf_movements add constraint mtf_movements_delta_check CHECK ((delta <> (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_opening_hours add constraint mtf_opening_hours_order CHECK (((open_time < close_time) AND (order_cutoff <= close_time)));
alter table "__LOCATION_SCHEMA__".mtf_opening_hours add constraint mtf_opening_hours_quarter CHECK (((((EXTRACT(minute FROM open_time))::integer % 15) = 0) AND (EXTRACT(second FROM open_time) = (0)::numeric) AND (((EXTRACT(minute FROM close_time))::integer % 15) = 0) AND (EXTRACT(second FROM close_time) = (0)::numeric) AND (EXTRACT(second FROM order_cutoff) = (0)::numeric)));
alter table "__LOCATION_SCHEMA__".mtf_opening_hours add constraint mtf_opening_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)));
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_product_setting_required CHECK (((kind <> 'product'::text) OR (product_id IS NOT NULL)));
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_amount_check CHECK (((amount > (0)::numeric) AND (amount <= (1000)::numeric)));
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_check CHECK (((kind <> 'percent'::text) OR (amount <= (100)::numeric)));
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_id_check CHECK (id);
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_kind_check CHECK ((kind = ANY (ARRAY['fixed'::text, 'percent'::text, 'product'::text])));
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_minimum_check CHECK ((minimum >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_valid_days_check CHECK (((valid_days >= 1) AND (valid_days <= 365)));
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_amount_check CHECK ((amount >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_check CHECK ((((kind = 'order'::text) AND (order_id IS NOT NULL) AND (snapshot IS NOT NULL) AND (file_path IS NULL) AND (expense_id IS NULL)) OR ((kind = 'upload'::text) AND (order_id IS NULL) AND (snapshot IS NULL) AND (file_path IS NOT NULL) AND (file_name IS NOT NULL) AND (mime = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))));
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_description_check CHECK (((length(TRIM(BOTH FROM description)) >= 1) AND (length(TRIM(BOTH FROM description)) <= 200)));
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_folder_check CHECK (((folder >= 1) AND (folder <= 3)));
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_kind_check CHECK ((kind = ANY (ARRAY['order'::text, 'upload'::text])));
alter table "__LOCATION_SCHEMA__".mtf_stock add constraint mtf_stock_minimum_check CHECK ((minimum >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_stock add constraint mtf_stock_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table "__LOCATION_SCHEMA__".mtf_stock add constraint mtf_stock_unit_cost_check CHECK ((unit_cost >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".mtf_suppliers add constraint mtf_suppliers_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table "__LOCATION_SCHEMA__".mtf_tasks add constraint mtf_tasks_information_check CHECK ((char_length(information) <= 5000));
alter table "__LOCATION_SCHEMA__".mtf_tasks add constraint mtf_tasks_status_check CHECK ((status = ANY (ARRAY['Open'::text, 'In uitvoering'::text, 'Afgerond'::text, 'Geannuleerd'::text])));
alter table "__LOCATION_SCHEMA__".mtf_tasks add constraint mtf_tasks_title_check CHECK (((char_length(TRIM(BOTH FROM title)) >= 1) AND (char_length(TRIM(BOTH FROM title)) <= 150)));
alter table "__LOCATION_SCHEMA__".order_email_outbox add constraint order_email_outbox_kind_check CHECK ((kind = ANY (ARRAY['restaurant'::text, 'customer'::text])));
alter table "__LOCATION_SCHEMA__".order_email_outbox add constraint order_email_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text])));
alter table "__LOCATION_SCHEMA__".orders add constraint delivery_address_required CHECK (((method <> 'Bezorgen'::text) OR ((char_length(TRIM(BOTH FROM COALESCE(address, ''::text))) >= 3) AND (char_length(TRIM(BOTH FROM COALESCE(city, ''::text))) >= 2))));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_customer_email_check CHECK ((POSITION(('@'::text) IN (customer_email)) > 1));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_customer_name_check CHECK ((char_length(TRIM(BOTH FROM customer_name)) >= 2));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_delivery_fee_check CHECK ((delivery_fee >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_discount_amount_check CHECK ((discount_amount >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_items_check CHECK ((jsonb_typeof(items) = 'array'::text));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_method_check CHECK ((method = ANY (ARRAY['Bezorgen'::text, 'Afhalen'::text])));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['Open'::text, 'Betaald'::text])));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_phone_check CHECK ((char_length(TRIM(BOTH FROM phone)) >= 6));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['Nieuw'::text, 'In bereiding'::text, 'Klaar'::text, 'Onderweg'::text, 'Afgehaald'::text, 'Bezorgd'::text, 'Geannuleerd'::text])));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_subtotal_check CHECK ((subtotal >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".orders add constraint orders_total_check CHECK ((total >= (0)::numeric));
alter table "__LOCATION_SCHEMA__".shop_settings add constraint shop_settings_id_check CHECK (id);
alter table "__LOCATION_SCHEMA__".menu_items add constraint mtf_menu_category_fk FOREIGN KEY (category) REFERENCES "__LOCATION_SCHEMA__".mtf_menu_categories(name) ON UPDATE CASCADE;
alter table "__LOCATION_SCHEMA__".mtf_addon_categories add constraint mtf_addon_categories_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES "__LOCATION_SCHEMA__".mtf_addons(id) ON DELETE CASCADE;
alter table "__LOCATION_SCHEMA__".mtf_addon_categories add constraint mtf_addon_categories_category_name_fkey FOREIGN KEY (category_name) REFERENCES "__LOCATION_SCHEMA__".mtf_menu_categories(name) ON UPDATE CASCADE ON DELETE CASCADE;
alter table "__LOCATION_SCHEMA__".mtf_addons add constraint mtf_addons_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES "__LOCATION_SCHEMA__".menu_items(id);
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_email_fkey FOREIGN KEY (email) REFERENCES "__LOCATION_SCHEMA__".mtf_coupon_members(email);
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_product_id_fkey FOREIGN KEY (product_id) REFERENCES "__LOCATION_SCHEMA__".menu_items(id);
alter table "__LOCATION_SCHEMA__".mtf_coupons add constraint mtf_coupons_redeemed_order_id_fkey FOREIGN KEY (redeemed_order_id) REFERENCES "__LOCATION_SCHEMA__".orders(id) DEFERRABLE INITIALLY DEFERRED;
alter table "__LOCATION_SCHEMA__".mtf_dish_costs add constraint mtf_dish_costs_dish_id_fkey FOREIGN KEY (dish_id) REFERENCES "__LOCATION_SCHEMA__".menu_items(id);
alter table "__LOCATION_SCHEMA__".mtf_movements add constraint mtf_movements_stock_id_fkey FOREIGN KEY (stock_id) REFERENCES "__LOCATION_SCHEMA__".mtf_stock(id);
alter table "__LOCATION_SCHEMA__".mtf_order_costs add constraint mtf_order_costs_order_id_fkey FOREIGN KEY (order_id) REFERENCES "__LOCATION_SCHEMA__".orders(id);
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings add constraint mtf_promotion_settings_product_id_fkey FOREIGN KEY (product_id) REFERENCES "__LOCATION_SCHEMA__".menu_items(id);
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES "__LOCATION_SCHEMA__".mtf_expenses(id);
alter table "__LOCATION_SCHEMA__".mtf_receipts add constraint mtf_receipts_order_id_fkey FOREIGN KEY (order_id) REFERENCES "__LOCATION_SCHEMA__".orders(id);
alter table "__LOCATION_SCHEMA__".mtf_staff add constraint mtf_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table "__LOCATION_SCHEMA__".mtf_stock add constraint mtf_stock_category_id_fkey FOREIGN KEY (category_id) REFERENCES "__LOCATION_SCHEMA__".mtf_categories(id);
alter table "__LOCATION_SCHEMA__".mtf_stock add constraint mtf_stock_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES "__LOCATION_SCHEMA__".mtf_suppliers(id);
alter table "__LOCATION_SCHEMA__".mtf_task_assignees add constraint mtf_task_assignees_task_id_fkey FOREIGN KEY (task_id) REFERENCES "__LOCATION_SCHEMA__".mtf_tasks(id) ON DELETE CASCADE;
alter table "__LOCATION_SCHEMA__".mtf_task_assignees add constraint mtf_task_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES "__LOCATION_SCHEMA__".mtf_staff(user_id);
alter table "__LOCATION_SCHEMA__".mtf_tasks add constraint mtf_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES "__LOCATION_SCHEMA__".mtf_staff(user_id);
alter table "__LOCATION_SCHEMA__".order_email_outbox add constraint order_email_outbox_order_id_fkey FOREIGN KEY (order_id) REFERENCES "__LOCATION_SCHEMA__".orders(id) ON DELETE CASCADE;

CREATE INDEX menu_items_category_sort_order_idx ON "__LOCATION_SCHEMA__".menu_items USING btree (category, sort_order);
CREATE INDEX mtf_addon_categories_category_name_addon_id_idx ON "__LOCATION_SCHEMA__".mtf_addon_categories USING btree (category_name, addon_id);
CREATE INDEX mtf_addons_menu_item_id_idx ON "__LOCATION_SCHEMA__".mtf_addons USING btree (menu_item_id);
CREATE UNIQUE INDEX mtf_menu_categories_lower_idx ON "__LOCATION_SCHEMA__".mtf_menu_categories USING btree (lower(name));
CREATE INDEX mtf_movements_stock_id_created_at_idx ON "__LOCATION_SCHEMA__".mtf_movements USING btree (stock_id, created_at);
CREATE INDEX mtf_receipts_folder_period ON "__LOCATION_SCHEMA__".mtf_receipts USING btree (folder, year, quarter, document_date DESC, id);
CREATE INDEX mtf_task_assignees_user_id_task_id_idx ON "__LOCATION_SCHEMA__".mtf_task_assignees USING btree (user_id, task_id);
CREATE INDEX mtf_tasks_created_by_idx ON "__LOCATION_SCHEMA__".mtf_tasks USING btree (created_by);
CREATE INDEX mtf_tasks_deadline_id_idx ON "__LOCATION_SCHEMA__".mtf_tasks USING btree (deadline, id);
CREATE INDEX orders_created_at_idx ON "__LOCATION_SCHEMA__".orders USING btree (created_at DESC);
CREATE INDEX orders_mollie_payment_id_idx ON "__LOCATION_SCHEMA__".orders USING btree (mollie_payment_id);
CREATE INDEX orders_status_idx ON "__LOCATION_SCHEMA__".orders USING btree (status);

CREATE TRIGGER mtf_task_assignment_mail AFTER INSERT ON "__LOCATION_SCHEMA__".mtf_task_assignees FOR EACH ROW EXECUTE FUNCTION "__LOCATION_SCHEMA__".mtf_queue_task_assignment();
CREATE TRIGGER mtf_apply_order_coupon BEFORE INSERT ON "__LOCATION_SCHEMA__".orders FOR EACH ROW EXECUTE FUNCTION "__LOCATION_SCHEMA__".mtf_apply_order_coupon();
CREATE TRIGGER mtf_capture_costs AFTER INSERT ON "__LOCATION_SCHEMA__".orders FOR EACH ROW EXECUTE FUNCTION "__LOCATION_SCHEMA__".mtf_capture_costs();
CREATE TRIGGER mtf_consume_stock AFTER UPDATE OF status ON "__LOCATION_SCHEMA__".orders FOR EACH ROW EXECUTE FUNCTION "__LOCATION_SCHEMA__".mtf_consume_stock();
CREATE TRIGGER mtf_review_mail AFTER UPDATE OF status ON "__LOCATION_SCHEMA__".orders FOR EACH ROW EXECUTE FUNCTION public.mtf_enqueue_review_mail();
CREATE TRIGGER mtf_validate_new_order_date BEFORE INSERT ON "__LOCATION_SCHEMA__".orders FOR EACH ROW EXECUTE FUNCTION "__LOCATION_SCHEMA__".mtf_validate_new_order_date();
CREATE TRIGGER trg_enqueue_order_emails AFTER INSERT ON "__LOCATION_SCHEMA__".orders FOR EACH ROW EXECUTE FUNCTION "__LOCATION_SCHEMA__".enqueue_order_emails();

alter table "__LOCATION_SCHEMA__".menu_items enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_addon_categories enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_addons enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_categories enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_closed_dates enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_coupon_members enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_coupons enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_dish_costs enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_expenses enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_home_settings enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_mail_jobs enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_menu_categories enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_movements enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_opening_hours enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_order_costs enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_promotion_limits enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_promotion_settings enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_receipts enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_staff enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_stock enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_suppliers enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_task_assignees enable row level security;
alter table "__LOCATION_SCHEMA__".mtf_tasks enable row level security;
alter table "__LOCATION_SCHEMA__".order_email_outbox enable row level security;
alter table "__LOCATION_SCHEMA__".orders enable row level security;
alter table "__LOCATION_SCHEMA__".shop_settings enable row level security;

revoke all on all tables in schema "__LOCATION_SCHEMA__" from anon, authenticated;
revoke all on all functions in schema "__LOCATION_SCHEMA__" from public, anon, authenticated;
grant DELETE on "__LOCATION_SCHEMA__".menu_items to service_role;
grant INSERT on "__LOCATION_SCHEMA__".menu_items to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".menu_items to service_role;
grant SELECT on "__LOCATION_SCHEMA__".menu_items to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".menu_items to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".menu_items to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".menu_items to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_addon_categories to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_addon_categories to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_addon_categories to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_addon_categories to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_addon_categories to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_addon_categories to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_addon_categories to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_addons to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_addons to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_addons to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_addons to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_addons to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_addons to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_addons to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_categories to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_categories to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_categories to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_categories to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_categories to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_categories to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_categories to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_closed_dates to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_closed_dates to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_closed_dates to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_closed_dates to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_closed_dates to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_closed_dates to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_closed_dates to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_coupon_members to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_coupon_members to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_coupon_members to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_coupon_members to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_coupon_members to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_coupon_members to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_coupon_members to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_coupons to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_coupons to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_coupons to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_coupons to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_coupons to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_coupons to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_coupons to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_dish_costs to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_dish_costs to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_dish_costs to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_dish_costs to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_dish_costs to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_dish_costs to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_dish_costs to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_expenses to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_expenses to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_expenses to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_expenses to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_expenses to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_expenses to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_expenses to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_home_settings to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_home_settings to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_home_settings to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_home_settings to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_home_settings to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_home_settings to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_home_settings to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_mail_jobs to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_mail_jobs to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_mail_jobs to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_mail_jobs to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_mail_jobs to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_mail_jobs to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_mail_jobs to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_menu_categories to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_menu_categories to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_menu_categories to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_menu_categories to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_menu_categories to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_menu_categories to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_menu_categories to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_movements to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_movements to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_movements to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_movements to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_movements to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_movements to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_movements to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_opening_hours to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_opening_hours to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_opening_hours to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_opening_hours to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_opening_hours to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_opening_hours to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_opening_hours to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_order_costs to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_order_costs to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_order_costs to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_order_costs to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_order_costs to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_order_costs to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_order_costs to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_promotion_limits to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_promotion_limits to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_promotion_limits to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_promotion_limits to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_promotion_limits to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_promotion_limits to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_promotion_limits to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_promotion_settings to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_promotion_settings to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_promotion_settings to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_promotion_settings to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_promotion_settings to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_promotion_settings to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_promotion_settings to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_receipts to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_receipts to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_receipts to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_receipts to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_receipts to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_receipts to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_receipts to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_staff to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_staff to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_staff to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_staff to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_staff to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_staff to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_staff to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_stock to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_stock to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_stock to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_stock to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_stock to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_stock to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_stock to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_suppliers to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_suppliers to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_suppliers to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_suppliers to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_suppliers to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_suppliers to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_suppliers to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_task_assignees to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_task_assignees to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_task_assignees to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_task_assignees to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_task_assignees to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_task_assignees to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_task_assignees to service_role;
grant DELETE on "__LOCATION_SCHEMA__".mtf_tasks to service_role;
grant INSERT on "__LOCATION_SCHEMA__".mtf_tasks to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".mtf_tasks to service_role;
grant SELECT on "__LOCATION_SCHEMA__".mtf_tasks to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".mtf_tasks to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".mtf_tasks to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".mtf_tasks to service_role;
grant DELETE on "__LOCATION_SCHEMA__".order_email_outbox to service_role;
grant INSERT on "__LOCATION_SCHEMA__".order_email_outbox to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".order_email_outbox to service_role;
grant SELECT on "__LOCATION_SCHEMA__".order_email_outbox to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".order_email_outbox to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".order_email_outbox to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".order_email_outbox to service_role;
grant DELETE on "__LOCATION_SCHEMA__".orders to service_role;
grant INSERT on "__LOCATION_SCHEMA__".orders to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".orders to service_role;
grant SELECT on "__LOCATION_SCHEMA__".orders to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".orders to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".orders to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".orders to service_role;
grant DELETE on "__LOCATION_SCHEMA__".shop_settings to service_role;
grant INSERT on "__LOCATION_SCHEMA__".shop_settings to service_role;
grant REFERENCES on "__LOCATION_SCHEMA__".shop_settings to service_role;
grant SELECT on "__LOCATION_SCHEMA__".shop_settings to service_role;
grant TRIGGER on "__LOCATION_SCHEMA__".shop_settings to service_role;
grant TRUNCATE on "__LOCATION_SCHEMA__".shop_settings to service_role;
grant UPDATE on "__LOCATION_SCHEMA__".shop_settings to service_role;
grant execute on function "__LOCATION_SCHEMA__".enqueue_order_emails() to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_adjust_stock(p_id uuid, p_delta numeric, p_reason text, p_actor text) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_apply_order_coupon() to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_archive_order(p_id uuid, p_folder integer, p_actor text) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_capture_costs() to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_confirm_coupon(p_hash text, p_code text) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_consume_stock() to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_coupon_discount(p_code text, p_email text, p_subtotal numeric) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_coupon_discount_items(p_code text, p_email text, p_subtotal numeric, p_items jsonb) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_finish_order(p_id uuid, p_status text, p_folder integer, p_actor text) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_home_favorites() to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_promotion_rate(p_bucket text, p_limit integer) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_queue_task_assignment() to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_receipt_periods() to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_save_addon(p_id uuid, p_name text, p_price numeric, p_cost numeric, p_menu_item_id text, p_active boolean, p_categories text[]) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_save_menu_order(categories jsonb, items jsonb) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_save_receipt_upload(p_id uuid, p_folder integer, p_date date, p_description text, p_amount numeric, p_path text, p_name text, p_mime text, p_book_expense boolean, p_actor text) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_task_summary(p_actor uuid, p_owner boolean) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_task_write(p_mode text, p_id uuid, p_actor uuid, p_owner boolean, p_title text, p_information text, p_deadline date, p_assignees uuid[], p_status text, p_version timestamp with time zone) to service_role;
grant execute on function "__LOCATION_SCHEMA__".mtf_validate_new_order_date() to service_role;
grant usage on schema "__LOCATION_SCHEMA__" to anon, authenticated, service_role;
