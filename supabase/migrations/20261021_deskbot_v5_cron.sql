-- DeskBot v5 scheduler: runs inside Supabase, 24/7, independent of any laptop or Claude session.
-- Prerequisite (run once, value NOT committed):  select vault.create_secret('<secret>', 'deskbot_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.dbv5_invoke(body jsonb default '{"action":"run"}')
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'deskbot_cron_secret';
  select net.http_post(
    url := 'https://xevymbzgpcsdhygswxlk.supabase.co/functions/v1/deskbot-v5',
    headers := jsonb_build_object('Content-Type','application/json','x-deskbot-key',k),
    body := body,
    timeout_milliseconds := 60000
  ) into rid;
  return rid;
end $$;
revoke all on function public.dbv5_invoke(jsonb) from public, anon, authenticated;

-- every 5 minutes, 1 minute after the 5m candle closes
select cron.schedule('deskbot-v5-run', '1-59/5 * * * *', $$select public.dbv5_invoke('{"action":"run"}'::jsonb)$$);
-- weekly backtest refresh (Sunday 00:20 UTC)
select cron.schedule('deskbot-v5-backtest', '20 0 * * 0', $$select public.dbv5_invoke('{"action":"backtest","days":16}'::jsonb)$$);
-- housekeeping: keep SKIP noise 3 days, other events 60 days, equity points 90 days
select cron.schedule('deskbot-v5-prune', '7 3 * * *', $$
  delete from public.dbv5_events where kind = 'SKIP' and ts < now() - interval '3 days';
  delete from public.dbv5_events where ts < now() - interval '60 days';
  delete from public.dbv5_equity where ts < now() - interval '90 days';
  delete from net._http_response where created < now() - interval '2 days';
$$);

-- edge function reads the same key through this service-role-only RPC
create or replace function public.dbv5_cron_key() returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'deskbot_cron_secret' limit 1
$$;
revoke all on function public.dbv5_cron_key() from public, anon, authenticated;
grant execute on function public.dbv5_cron_key() to service_role;
