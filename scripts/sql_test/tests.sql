\set d `cat @@W@@/d.json`
\set inp `cat @@W@@/inputs.json`
\set d2 `cat @@W@@/d2.json`
\set inp2 `cat @@W@@/inputs2.json`
\set dconf `cat @@W@@/d_conflict.json`
create schema t; grant usage on schema t to anon, authenticated, service_role;
create function t.pass(name text) returns void language plpgsql as $$ begin raise notice 'PASS  %', name; end $$;
create function t.must(name text, cond boolean) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAIL  %', name; end if; raise notice 'PASS  %', name; end $$;
-- runs sql as role (null = owner); expects an error whose message matches pat
create function t.raises(name text, as_role text, stmt text, pat text) returns void language plpgsql as $$
begin
  begin
    if as_role is not null then execute format('set local role %I', as_role); end if;
    execute stmt; reset role;
    raise exception 'FAIL  % (statement succeeded)', name;
  exception when others then
    reset role;
    if sqlerrm like 'FAIL  %' then raise; end if;
    if sqlerrm !~* pat then raise exception 'FAIL  % (wrong error: %)', name, sqlerrm; end if;
    raise notice 'PASS  % [%]', name, left(sqlerrm, 70);
  end;
end $$;
create function t.counts() returns text language sql as $$ select (select count(*) from public.dbv5_decisions) || '/' || (select count(*) from public.dbv5_decision_inputs) $$;
create function t.call(dj jsonb, ij jsonb) returns boolean language sql as $$ select public.dbv5_record_decision(dj, ij) $$;
grant execute on function t.call(jsonb, jsonb) to anon, authenticated, service_role;

-- 1. RLS and grants
select t.must('RLS enabled on both tables', (select bool_and(relrowsecurity) from pg_class where relname in ('dbv5_decisions','dbv5_decision_inputs')));
select t.must('no RLS policies defined', (select count(*) from pg_policies where tablename like 'dbv5_decision%') = 0);
select t.raises('anon cannot select decisions', 'anon', 'select * from public.dbv5_decisions', 'permission denied');
select t.raises('authenticated cannot select inputs', 'authenticated', 'select * from public.dbv5_decision_inputs', 'permission denied');
select t.raises('anon cannot call the writer', 'anon', format('select public.dbv5_record_decision(%L::jsonb, %L::jsonb)', :'d', :'inp'), 'permission denied');
select t.raises('authenticated cannot call the writer', 'authenticated', format('select public.dbv5_record_decision(%L::jsonb, %L::jsonb)', :'d', :'inp'), 'permission denied');
select t.raises('service_role cannot insert directly', 'service_role', $$insert into public.dbv5_decisions(id,sym,ts,record,record_sha256) values ('D-x','BTC',now(),'{}',repeat('a',64))$$, 'permission denied');
select t.raises('service_role cannot update', 'service_role', $$update public.dbv5_decisions set sym='X'$$, 'permission denied');
select t.raises('service_role cannot delete', 'service_role', $$delete from public.dbv5_decisions$$, 'permission denied');
select t.must('counts start at 0/0', t.counts() = '0/0');

-- 2. validation failures leave nothing behind (each runs as service_role through the real writer)
select t.raises('3 input rows rejected', 'service_role', format('select public.dbv5_record_decision(%L::jsonb, (%L::jsonb) - 3)', :'d', :'inp'), 'exactly 4 input rows');
select t.raises('5 input rows rejected', 'service_role', format('select public.dbv5_record_decision(%L::jsonb, (%L::jsonb) || (%L::jsonb)->0)', :'d', :'inp', :'inp'), 'exactly 4 input rows');
select t.raises('duplicate timeframe (4 rows, m5 twice)', 'service_role', format($q$select public.dbv5_record_decision(%L::jsonb, jsonb_set(%L::jsonb, '{1,tf}', '"m5"'))$q$, :'d', :'inp'), 'timeframe .* exactly once');
select t.raises('input row for another decision id', 'service_role', format($q$select public.dbv5_record_decision(%L::jsonb, jsonb_set(%L::jsonb, '{0,decision_id}', '"D-other"'))$q$, :'d', :'inp'), 'decision_id does not match');
select t.raises('input hash differs from record reference', 'service_role', format($q$select public.dbv5_record_decision(%L::jsonb, jsonb_set(%L::jsonb, '{2,bars_sha256}', to_jsonb(repeat('b',64))))$q$, :'d', :'inp'), 'does not match the record reference');
select t.raises('input source differs from record reference', 'service_role', format($q$select public.dbv5_record_decision(%L::jsonb, jsonb_set(%L::jsonb, '{0,source}', '"somewhere-else"'))$q$, :'d', :'inp'), 'does not match the record reference');
select t.raises('bar count differs from record reference', 'service_role', format($q$select public.dbv5_record_decision(%L::jsonb, jsonb_set(%L::jsonb, '{0,bars}', ((%L::jsonb)#>'{0,bars}') - 0))$q$, :'d', :'inp', :'inp'), 'does not match the record reference');
select t.raises('empty bars rejected', 'service_role', format($q$select public.dbv5_record_decision(%L::jsonb, jsonb_set(%L::jsonb, '{0,bars}', '[]'))$q$, :'d', :'inp'), 'bars missing');
select t.raises('wrong schema rejected', 'service_role', format($q$select public.dbv5_record_decision(jsonb_set(%L::jsonb, '{record,schema}', '"other/9"'), %L::jsonb)$q$, :'d', :'inp'), 'unsupported decision schema');
select t.raises('record decisionId must equal id', 'service_role', format($q$select public.dbv5_record_decision(jsonb_set(%L::jsonb, '{record,decisionId}', '"D-zzz"'), %L::jsonb)$q$, :'d', :'inp'), 'does not match id');
select t.raises('decidedAt must equal ts', 'service_role', format($q$select public.dbv5_record_decision(jsonb_set(%L::jsonb, '{ts}', '"2001-01-01T00:00:00Z"'), %L::jsonb)$q$, :'d', :'inp'), 'decidedAt does not match ts');
select t.raises('malformed record hash rejected', 'service_role', format($q$select public.dbv5_record_decision(jsonb_set(%L::jsonb, '{record_sha256}', '"nothex"'), %L::jsonb)$q$, :'d', :'inp'), 'record_sha256 malformed');
select t.must('nothing was written by any rejected call', t.counts() = '0/0');

-- 3. atomic rollback: a failure injected on the LAST input insert must roll back the decision row too
create function t.boom() returns trigger language plpgsql as $$ begin if new.tf = 'h4' then raise exception 'injected failure on h4'; end if; return new; end $$;
create trigger t_boom before insert on public.dbv5_decision_inputs for each row execute function t.boom();
select t.raises('injected failure during input insert', 'service_role', format('select public.dbv5_record_decision(%L::jsonb, %L::jsonb)', :'d', :'inp'), 'injected failure');
select t.must('decision row rolled back together with the partial inputs', t.counts() = '0/0');
drop trigger t_boom on public.dbv5_decision_inputs;

-- 4. the happy path, identical retry, conflicts
set role service_role;
select t.must('first write returns true', public.dbv5_record_decision(:'d'::jsonb, :'inp'::jsonb) is true);
select t.must('counts are 1/4 after the write', t.counts() = '1/4');
select t.must('identical retry returns false and changes nothing', public.dbv5_record_decision(:'d'::jsonb, :'inp'::jsonb) is false and t.counts() = '1/4');
reset role;
select t.raises('same id, different record content, is rejected', 'service_role', format('select public.dbv5_record_decision(%L::jsonb, %L::jsonb)', :'dconf', :'inp'), 'different content');
select t.raises('same id, same record, different input BARS (hash string reused) is rejected', 'service_role', format($q$select public.dbv5_record_decision(%L::jsonb, jsonb_set(%L::jsonb, '{0,bars,0,1}', '123456789'))$q$, :'d', :'inp'), 'different inputs');
select t.must('conflicting retries changed nothing', t.counts() = '1/4' and (select record_sha256 from public.dbv5_decisions) = (:'d'::jsonb)->>'record_sha256');
set role service_role;
select t.must('a second, distinct decision is accepted', public.dbv5_record_decision(:'d2'::jsonb, :'inp2'::jsonb) is true and t.counts() = '2/8');
select t.must('service_role can read what was written', (select count(*) from public.dbv5_decisions) = 2);
reset role;

-- 5. append-only for every role including the owner
select t.raises('owner UPDATE on decisions blocked', null, $$update public.dbv5_decisions set sym='X'$$, 'append-only');
select t.raises('owner DELETE on decisions blocked', null, $$delete from public.dbv5_decisions$$, 'append-only');
select t.raises('owner TRUNCATE on decisions blocked', null, $$truncate public.dbv5_decisions cascade$$, 'append-only');
select t.raises('owner UPDATE on inputs blocked', null, $$update public.dbv5_decision_inputs set source='X'$$, 'append-only');
select t.raises('owner DELETE on inputs blocked', null, $$delete from public.dbv5_decision_inputs$$, 'append-only');
select t.raises('owner TRUNCATE on inputs blocked', null, $$truncate public.dbv5_decision_inputs$$, 'append-only');
select t.must('evidence intact after attempted tampering', t.counts() = '2/8');
select t.must('writer is SECURITY DEFINER with a pinned search_path', (select prosecdef and proconfig::text like '%search_path=pg_catalog, public%' from pg_proc where proname = 'dbv5_record_decision'));
select t.must('only service_role (and the owner) may execute the writer', not has_function_privilege('anon','public.dbv5_record_decision(jsonb,jsonb)','execute') and not has_function_privilege('authenticated','public.dbv5_record_decision(jsonb,jsonb)','execute') and has_function_privilege('service_role','public.dbv5_record_decision(jsonb,jsonb)','execute'));
