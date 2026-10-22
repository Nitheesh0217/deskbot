# Operating DeskBot v5

Everything below runs in the Supabase SQL editor for project `xevymbzgpcsdhygswxlk`, or through Claude with the Supabase connector.

## Is it running?

```sql
select updated_at, now() - updated_at as age, last_run->>'action' as action, last_run->>'source' as source,
       state->>'equity' as equity, state->'pos' is not null as in_position
from dbv5_state where id = 'main';
select jobname, schedule, active from cron.job where jobname like 'deskbot-v5%';
select status, count(*) from cron.job_run_details where start_time > now() - interval '1 day' group by 1;
```
Healthy = `age` under 10 minutes.

## Run one iteration now

```sql
select public.dbv5_invoke('{"action":"run"}'::jsonb);
```

## Change a setting (no redeploy)

Overrides live in `state.cfg`. Example: switch SESSION_BO off and give HTF_TREND half size.
```sql
update dbv5_state set state = jsonb_set(state, '{cfg,RISK_SCALE}',
  '{"D_BEARTRAP":1,"D_THRUST":1,"HTF_TREND":0.5,"TREND_MTF":0.25,"SWEEP_REV":0,"VWAP_REVERT":0.25,"SESSION_BO":0}'::jsonb)
where id = 'main';
```

## Backtest

```sql
-- one strategy, 1 year of Binance history
select public.dbv5_invoke('{"action":"backtest","source":"binance","days":360,"only":"HTF_TREND","label":"my-test"}'::jsonb);
-- the whole live mix with a config change
select public.dbv5_invoke('{"action":"backtest","source":"binance","days":360,"combinedOnly":true,"label":"mix-test","cfg":{"HTF_DONCHIAN":40}}'::jsonb);
-- results
select results->>'label', results->'combined'->'all' from dbv5_backtests order by id desc limit 5;
```
A year of all seven strategies at once exceeds the function's compute limit; use `only` or `combinedOnly`.

## Pause and resume

```sql
select cron.unschedule('deskbot-v5-run');                                                   -- pause
select cron.schedule('deskbot-v5-run', '1-59/5 * * * *', $$select public.dbv5_invoke('{"action":"run"}'::jsonb)$$); -- resume
```

## Reset paper equity (starts a new run; old trades stay)

```sql
delete from dbv5_state where id = 'main';   -- next run re-initialises from the v3 balance
```

## Phone alerts (optional)

Set an Edge Function secret `DESKBOT_NTFY_TOPIC` to a private, hard-to-guess topic name and subscribe to it in the ntfy app. Every open, win and loss is pushed.
