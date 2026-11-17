-- Fase 1b: openingstijden en uiterste besteltijden uit de code naar de database.
-- Per vestiging (schema public = Spijkenisse, mtf_ob = Oud-Beijerland) één rij per open weekdag.
-- weekday: 0 = zondag … 6 = zaterdag (zoals extract(dow) en JavaScript getUTCDay()).
-- Geen rij = gesloten op die weekdag. Startwaarden zijn exact de huidige tijden.

do $m$
declare s text;
begin
  foreach s in array array['public','mtf_ob'] loop
    execute format($f$
      create table if not exists %I.mtf_opening_hours (
        weekday smallint primary key check (weekday between 0 and 6),
        open_time time not null,
        close_time time not null,
        order_cutoff time not null,
        updated_at timestamptz not null default now(),
        constraint mtf_opening_hours_order check (open_time < close_time and order_cutoff <= close_time),
        constraint mtf_opening_hours_quarter check (
          extract(minute from open_time)::int %% 15 = 0 and extract(second from open_time) = 0 and
          extract(minute from close_time)::int %% 15 = 0 and extract(second from close_time) = 0 and
          extract(second from order_cutoff) = 0)
      )$f$, s);
    execute format('alter table %I.mtf_opening_hours enable row level security', s);
    execute format('revoke all on %I.mtf_opening_hours from anon, authenticated', s);
    execute format('grant all on %I.mtf_opening_hours to service_role', s);
    execute format($f$
      insert into %I.mtf_opening_hours (weekday, open_time, close_time, order_cutoff) values
        (1, '16:00', '20:30', '18:00'),
        (2, '16:00', '20:30', '18:00'),
        (4, '16:00', '20:30', '18:00'),
        (5, '16:00', '21:00', '19:30'),
        (0, '16:00', '20:30', '19:30')
      on conflict (weekday) do nothing$f$, s);
  end loop;
end $m$;

-- Controle bij elke nieuwe bestelling: leest nu de tabel in plaats van vaste tijden.
create or replace function public.mtf_validate_new_order_date()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare local_now timestamp:=clock_timestamp() at time zone 'Europe/Amsterdam';r text;h record;begin
 if new.seasonal_event is not null then return new;end if;
 select reason into r from public.mtf_closed_dates where day=new.requested_date;
 if found then raise exception 'Op % zijn we gesloten: %',new.requested_date,r;end if;
 select open_time,close_time,order_cutoff into h from public.mtf_opening_hours where weekday=extract(dow from new.requested_date)::smallint;
 if not found then raise exception 'Op deze dag zijn we gesloten';end if;
 if new.requested_date<local_now::date or (new.requested_date=local_now::date and local_now::time>h.order_cutoff) then raise exception 'Kies een volgende openingsdag; voor vandaag bestel je uiterlijk om %',to_char(h.order_cutoff,'HH24:MI');end if;
 if new.requested_time<h.open_time or new.requested_time>h.close_time or extract(minute from new.requested_time)::int%15<>0 or extract(second from new.requested_time)<>0 or (new.requested_date=local_now::date and new.requested_time<=local_now::time) then raise exception 'Kies een beschikbaar tijdvak binnen onze openingstijden';end if;
 return new;
end $function$;

create or replace function mtf_ob.mtf_validate_new_order_date()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare local_now timestamp:=clock_timestamp() at time zone 'Europe/Amsterdam';r text;h record;begin
 select reason into r from mtf_ob.mtf_closed_dates where day=new.requested_date;
 if found then raise exception 'Op % zijn we gesloten: %',new.requested_date,r;end if;
 select open_time,close_time,order_cutoff into h from mtf_ob.mtf_opening_hours where weekday=extract(dow from new.requested_date)::smallint;
 if not found then raise exception 'Op deze dag zijn we gesloten';end if;
 if new.requested_date<local_now::date or (new.requested_date=local_now::date and local_now::time>h.order_cutoff) then raise exception 'Kies een volgende openingsdag; voor vandaag bestel je uiterlijk om %',to_char(h.order_cutoff,'HH24:MI');end if;
 if new.requested_time<h.open_time or new.requested_time>h.close_time or extract(minute from new.requested_time)::int%15<>0 or extract(second from new.requested_time)<>0 or (new.requested_date=local_now::date and new.requested_time<=local_now::time) then raise exception 'Kies een beschikbaar tijdvak binnen onze openingstijden';end if;
 return new;
end $function$;
