-- Opstartgedeelte voor een nieuwe klantdatabase: extensies, opslag, startinstellingen, hoofdvestiging en geplande taken.
-- Vul de {{...}}-waarden in (zie PLATFORM-NIEUWE-KLANT.md) en draai dit NA 0001_schema_public.sql.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Opslagmappen
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('logo', 'logo', true, null, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('menu-images', 'menu-images', true, 5242880, '{image/jpeg,image/png,image/webp}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('mtf-receipts', 'mtf-receipts', false, 5242880, '{application/pdf,image/jpeg,image/png,image/webp}'::text[]) on conflict (id) do nothing;

-- Startinstellingen (één rij per tabel; geheimen leeg, extra's uit)
insert into public.shop_settings (id, is_open, message) select id, is_open, message from jsonb_populate_record(null::public.shop_settings, '{"id": true, "is_open": false, "message": "Momenteel nemen wij geen online bestellingen aan. Probeer het later opnieuw."}'::jsonb) on conflict do nothing;
insert into public.mtf_promotion_settings (amount, enabled, google_api_key, google_place_id, id, kind, minimum, product_id, valid_days) select amount, enabled, google_api_key, google_place_id, id, kind, minimum, product_id, valid_days from jsonb_populate_record(null::public.mtf_promotion_settings, '{"id": true, "kind": "fixed", "amount": 5.00, "enabled": false, "minimum": 25.00, "product_id": null, "valid_days": 30, "google_api_key": "", "google_place_id": ""}'::jsonb) on conflict do nothing;
insert into public.mtf_game_settings (id, title, visible) select id, title, visible from jsonb_populate_record(null::public.mtf_game_settings, '{"id": true, "title": "Game", "visible": false}'::jsonb) on conflict do nothing;
insert into public.mtf_home_settings (id) select id from jsonb_populate_record(null::public.mtf_home_settings, '{"id": true}'::jsonb) on conflict do nothing;
insert into public.mtf_campaign_controls (enabled, id, visible) select enabled, id, visible from jsonb_populate_record(null::public.mtf_campaign_controls, '{"id": "winter", "enabled": false, "visible": false}'::jsonb) on conflict do nothing;
insert into public.mtf_opening_hours (close_time, open_time, order_cutoff, weekday) select close_time, open_time, order_cutoff, weekday from jsonb_populate_record(null::public.mtf_opening_hours, '{"weekday": 1, "open_time": "16:00:00", "close_time": "20:30:00", "order_cutoff": "18:00:00"}'::jsonb) on conflict do nothing;
insert into public.mtf_opening_hours (close_time, open_time, order_cutoff, weekday) select close_time, open_time, order_cutoff, weekday from jsonb_populate_record(null::public.mtf_opening_hours, '{"weekday": 2, "open_time": "16:00:00", "close_time": "20:30:00", "order_cutoff": "18:00:00"}'::jsonb) on conflict do nothing;
insert into public.mtf_opening_hours (close_time, open_time, order_cutoff, weekday) select close_time, open_time, order_cutoff, weekday from jsonb_populate_record(null::public.mtf_opening_hours, '{"weekday": 4, "open_time": "16:00:00", "close_time": "20:30:00", "order_cutoff": "18:00:00"}'::jsonb) on conflict do nothing;
insert into public.mtf_opening_hours (close_time, open_time, order_cutoff, weekday) select close_time, open_time, order_cutoff, weekday from jsonb_populate_record(null::public.mtf_opening_hours, '{"weekday": 5, "open_time": "16:00:00", "close_time": "21:00:00", "order_cutoff": "19:30:00"}'::jsonb) on conflict do nothing;
insert into public.mtf_opening_hours (close_time, open_time, order_cutoff, weekday) select close_time, open_time, order_cutoff, weekday from jsonb_populate_record(null::public.mtf_opening_hours, '{"weekday": 0, "open_time": "16:00:00", "close_time": "20:30:00", "order_cutoff": "19:30:00"}'::jsonb) on conflict do nothing;

-- Hoofdvestiging
insert into public.mtf_locations (slug, schema_name, name, address, order_email, published, mailbox_ready, is_primary, features, order_prefix, order_pad, order_max)
values ('{{SLUG}}', 'public', '{{NAAM}}', '{{ADRES}}', '{{ORDERMAIL}}', false, false, true, '{}', '{{BESTELNUMMER_VOORVOEGSEL}}', 5, null)
on conflict (slug) do nothing;

-- Geplande taken (de service-sleutel staat in de kluis als mtf_service_role_key)
select vault.create_secret('{{SERVICE_ROLE_KEY}}', 'mtf_service_role_key') where not exists (select 1 from vault.secrets where name = 'mtf_service_role_key');
select cron.schedule('mtf-send-order-emails', '* * * * *', $c$select net.http_post(url := '{{SUPABASE_URL}}/functions/v1/dynamic-handler', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mtf_service_role_key' limit 1)), body := '{"limit":10}'::jsonb);$c$);
select cron.schedule('mtf-portal-mail-retry', '*/2 * * * *', $c$select net.http_post(url := '{{SUPABASE_URL}}/functions/v1/portal-mail-worker', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mtf_service_role_key' limit 1)), body := '{}'::jsonb);$c$);
select cron.schedule('mtf-review-mails', '*/5 * * * *', $c$select net.http_post(url := '{{SUPABASE_URL}}/functions/v1/review-mail-worker', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mtf_service_role_key' limit 1)), body := '{}'::jsonb);$c$);
