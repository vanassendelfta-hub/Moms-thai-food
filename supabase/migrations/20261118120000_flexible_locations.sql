-- Fase 4a: vestigingen uit de tabel in plaats van vaste namen.
-- Gedrag voor bestaande vestigingen blijft gelijk:
--   * spijkenisse = hoofdvestiging (schema public), met WELKOM10 en feestdagenmenu;
--   * oud-beijerland = schema mtf_ob.
-- Een nieuwe vestiging is daarna een rij in mtf_locations plus een eigen schema.

-- 1. Hoofdvestiging en extra's per vestiging
alter table public.mtf_locations add column if not exists is_primary boolean not null default false;
alter table public.mtf_locations add column if not exists features text[] not null default '{}';
create unique index if not exists mtf_locations_one_primary on public.mtf_locations (is_primary) where is_primary;

-- Extra's: 'welkom10' (kortingscode), 'seasonal' (feestdagenmenu), 'marketing' (nieuwsbrief-aanmeldingen en campagnes).
update public.mtf_locations set is_primary = true, features = array['welkom10','seasonal','marketing'] where slug = 'spijkenisse' and not is_primary;

-- Bestelnummer zoals klant en beheer het zien: voorvoegsel + nummer aangevuld tot order_pad cijfers.
-- Boven order_max (indien gezet) wordt het kale nummer getoond.
alter table public.mtf_locations add column if not exists order_prefix text not null default '';
alter table public.mtf_locations add column if not exists order_pad integer not null default 0 check (order_pad between 0 and 12);
alter table public.mtf_locations add column if not exists order_max integer;
update public.mtf_locations set order_prefix='MTF00284', order_pad=3, order_max=999 where slug='spijkenisse' and order_prefix='';
update public.mtf_locations set order_prefix='MTFOB', order_pad=5 where slug='oud-beijerland' and order_prefix='';
-- De hoofdvestiging gebruikt altijd het schema public.
alter table public.mtf_locations drop constraint if exists mtf_locations_primary_public;
alter table public.mtf_locations add constraint mtf_locations_primary_public check (not is_primary or schema_name = 'public');

-- 2. Vaste lijsten vervangen door een formaatcontrole
alter table public.mtf_locations drop constraint if exists mtf_locations_slug_check;
alter table public.mtf_locations add constraint mtf_locations_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40);
alter table public.mtf_locations drop constraint if exists mtf_locations_schema_name_check;
alter table public.mtf_locations add constraint mtf_locations_schema_name_check check (schema_name = 'public' or schema_name ~ '^mtf_[a-z0-9_]{1,40}$');
alter table public.mtf_locations drop constraint if exists mtf_locations_features_check;
alter table public.mtf_locations add constraint mtf_locations_features_check check (features <@ array['welkom10','seasonal','marketing']::text[]);

alter table public.mtf_review_mails drop constraint if exists mtf_review_mails_location_slug_check;
alter table public.mtf_review_mails drop constraint if exists mtf_review_mails_location_slug_fkey;
alter table public.mtf_review_mails add constraint mtf_review_mails_location_slug_fkey foreign key (location_slug) references public.mtf_locations(slug) on update cascade;

-- 3. Schema van een vestiging opzoeken (onbekend of leeg = hoofdvestiging)
create or replace function public.mtf_location_schema(p_slug text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select schema_name from public.mtf_locations where slug = p_slug),
    (select schema_name from public.mtf_locations where is_primary),
    'public');
$$;
revoke all on function public.mtf_location_schema(text) from public, anon, authenticated;

-- 4. Populariteit van gerechten per vestiging
create or replace function public.mtf_dish_popularity(p_location text default null)
returns table(dish_id text, n bigint)
language plpgsql stable security definer set search_path = '' as $function$
declare s text := public.mtf_location_schema(p_location);
begin
  return query execute format($q$
    with x as (select e from %I.orders o, jsonb_array_elements(o.items) e where o.status <> 'Geannuleerd' and jsonb_typeof(o.items)='array')
    select c.id, sum(c.q)::bigint from (
      select e->>'id' id, greatest(coalesce((e->>'qty')::int,0),0) q from x
      union all select e->>'side_id', greatest(coalesce((e->>'qty')::int,0),0) from x where e->>'side_id' is not null) c
    where c.id is not null group by c.id$q$, s);
end $function$;

-- 5. Reviewmail: vestiging volgt uit het schema van de bestelling
create or replace function public.mtf_enqueue_review_mail()
returns trigger language plpgsql security definer set search_path = '' as $function$
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
end $function$;
