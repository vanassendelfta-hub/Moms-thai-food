-- Bezorgportaal: bezorgers, toewijzing van bestellingen en live locatie.
-- Geldt voor beide vestigingen (public = Spijkenisse, mtf_ob = Oud-Beijerland).
-- Alles is aanvullend: bestaande kolommen en gegevens blijven ongewijzigd.
do $$
declare s text;
begin
  foreach s in array array['public','mtf_ob'] loop
    -- Medewerker mag het bezorgportaal gebruiken. Los van de rechten, zodat "Rechten wijzigen" dit niet overschrijft.
    execute format('alter table %I.mtf_staff add column if not exists driver boolean not null default false', s);
    -- Aan wie de bestelling is toegewezen en wanneer de bezorging is gestart.
    execute format('alter table %I.orders add column if not exists driver_id uuid', s);
    execute format('alter table %I.orders add column if not exists delivery_started_at timestamptz', s);
    execute format('create index if not exists orders_driver_idx on %I.orders(driver_id) where driver_id is not null', s);
    -- Laatste bekende plek van een bezorger. Eén rij per bezorger; wordt gewist zodra de ronde klaar is.
    execute format('create table if not exists %I.mtf_driver_positions(
      user_id uuid primary key,
      lat double precision not null check (lat between -90 and 90),
      lng double precision not null check (lng between -180 and 180),
      accuracy real,
      updated_at timestamptz not null default now())', s);
    -- Geen policies: alleen de serverfuncties (servicesleutel) kunnen erbij.
    execute format('alter table %I.mtf_driver_positions enable row level security', s);
    execute format('revoke all on %I.mtf_driver_positions from anon, authenticated', s);
  end loop;
end $$;
