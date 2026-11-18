-- Cateringaanvragen (Forum-demo). Klanten sturen een aanvraag via de website; medewerkers zien ze in het beheer onder Catering.
create table if not exists public.mtf_catering_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and char_length(email) <= 200),
  phone text not null check (char_length(phone) between 6 and 40),
  address text not null check (char_length(address) between 3 and 200),
  event_date date not null,
  event_location text not null check (char_length(event_location) between 2 and 200),
  persons integer not null check (persons between 1 and 5000),
  rent_plates boolean not null default false,
  rent_cutlery boolean not null default false,
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'Nieuw' check (status in ('Nieuw','In behandeling','Offerte verstuurd','Bevestigd','Afgewezen')),
  handled_by text,
  updated_at timestamptz not null default now()
);
alter table public.mtf_catering_requests enable row level security;
revoke all on public.mtf_catering_requests from anon, authenticated;
create index if not exists mtf_catering_requests_created on public.mtf_catering_requests (created_at desc);

-- Aanvraag indienen (openbaar, met eenvoudige limiet tegen misbruik).
create or replace function public.mtf_catering_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.mtf_catering_requests; em text := lower(trim(coalesce(p->>'email','')));
begin
  if (select count(*) from public.mtf_catering_requests where lower(email)=em and created_at > now()-interval '10 minutes') >= 3
     or (select count(*) from public.mtf_catering_requests where created_at > now()-interval '1 hour') >= 60 then
    raise exception 'Er zijn net veel aanvragen verstuurd. Probeer het later opnieuw of bel ons.';
  end if;
  if (p->>'event_date')::date < (now() at time zone 'Europe/Amsterdam')::date then
    raise exception 'Kies een datum in de toekomst.';
  end if;
  insert into public.mtf_catering_requests (name,email,phone,address,event_date,event_location,persons,rent_plates,rent_cutlery,message)
  values (trim(p->>'name'), em, trim(p->>'phone'), trim(p->>'address'), (p->>'event_date')::date, trim(p->>'event_location'),
          (p->>'persons')::int, coalesce((p->>'rent_plates')::boolean,false), coalesce((p->>'rent_cutlery')::boolean,false), left(trim(coalesce(p->>'message','')),2000))
  returning * into r;
  return jsonb_build_object('ok',true,'id',r.id);
end $$;

-- Alleen actieve medewerkers met recht op bestellingen (of de eigenaar).
create or replace function public.mtf_catering_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.mtf_staff s where s.user_id = auth.uid() and s.active
    and (s.owner or coalesce((s.permissions->>'orders')::boolean,false)));
$$;

create or replace function public.mtf_catering_list()
returns setof public.mtf_catering_requests language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mtf_catering_staff() then raise exception 'Geen toegang.'; end if;
  return query select * from public.mtf_catering_requests order by (status in ('Nieuw','In behandeling')) desc, event_date, created_at desc limit 500;
end $$;

create or replace function public.mtf_catering_set_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.mtf_catering_staff() then raise exception 'Geen toegang.'; end if;
  update public.mtf_catering_requests set status=p_status, updated_at=now(),
    handled_by=(select coalesce(nullif(name,''),email) from public.mtf_staff where user_id=auth.uid())
  where id=p_id;
  if not found then raise exception 'Aanvraag niet gevonden.'; end if;
end $$;

revoke all on function public.mtf_catering_submit(jsonb) from public;
revoke all on function public.mtf_catering_staff() from public;
revoke all on function public.mtf_catering_list() from public;
revoke all on function public.mtf_catering_set_status(uuid,text) from public;
-- Supabase geeft anon/authenticated standaard uitvoerrecht; expliciet intrekken.
revoke execute on function public.mtf_catering_list() from anon;
revoke execute on function public.mtf_catering_set_status(uuid,text) from anon;
revoke execute on function public.mtf_catering_staff() from anon, authenticated;
grant execute on function public.mtf_catering_submit(jsonb) to anon, authenticated;
grant execute on function public.mtf_catering_list() to authenticated;
grant execute on function public.mtf_catering_set_status(uuid,text) to authenticated;
