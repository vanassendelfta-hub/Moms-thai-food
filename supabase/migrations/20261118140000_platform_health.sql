-- Fase 4d: gezondheid van een klantdatabase in één leesfunctie, voor het platformbeheer.
-- Alleen leesbaar voor de service-rol en de databasebeheerder (via de Supabase-koppeling van de platformeigenaar).
create or replace function public.mtf_platform_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $f$
declare
  loc record; locs jsonb := '[]'::jsonb; one jsonb; cron_info jsonb := '[]'::jsonb;
  today date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  for loc in select * from public.mtf_locations order by is_primary desc, created_at loop
    if loc.schema_name !~ '^(public|mtf_[a-z0-9_]{1,40})$' then continue; end if;
    execute format($q$
      select jsonb_build_object(
        'shop_open', (select is_open from %1$I.shop_settings where id),
        'orders_today', (select count(*) from %1$I.orders where (created_at at time zone 'Europe/Amsterdam')::date = $1 and status <> 'Geannuleerd'),
        'orders_7d', (select count(*) from %1$I.orders where created_at > now() - interval '7 days' and status <> 'Geannuleerd'),
        'revenue_7d', (select coalesce(sum(total),0) from %1$I.orders where created_at > now() - interval '7 days' and status <> 'Geannuleerd'),
        'last_order_at', (select max(created_at) from %1$I.orders),
        'open_orders', (select count(*) from %1$I.orders where status in ('Nieuw','In bereiding','Klaar','Onderweg')),
        'outbox_pending', (select count(*) from %1$I.order_email_outbox where status in ('pending','processing') and created_at < now() - interval '5 minutes'),
        'outbox_failed', (select count(*) from %1$I.order_email_outbox where status = 'failed' and attempts >= 5),
        'mail_jobs_failed', (select count(*) from %1$I.mtf_mail_jobs where status = 'failed' and created_at > now() - interval '7 days')
      )$q$, loc.schema_name) using today into one;
    locs := locs || jsonb_build_array(one || jsonb_build_object(
      'slug', loc.slug, 'name', loc.name, 'published', loc.published, 'is_primary', loc.is_primary, 'features', to_jsonb(loc.features)));
  end loop;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'active', j.active, 'last_status', r.status, 'last_run', r.end_time) order by j.jobname), '[]'::jsonb)
      into cron_info
      from cron.job j
      left join lateral (select status, end_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true;
  exception when others then cron_info := '[]'::jsonb;
  end;
  return jsonb_build_object(
    'checked_at', now(),
    'locations', locs,
    'review_pending', (select count(*) from public.mtf_review_mails where status in ('pending','failed') and send_after < now() - interval '1 hour'),
    'review_failed', (select count(*) from public.mtf_review_mails where status = 'failed' and attempts >= 5),
    'cron', cron_info
  );
end $f$;
revoke all on function public.mtf_platform_health() from public, anon, authenticated;
grant execute on function public.mtf_platform_health() to service_role;
