-- Tap Rush database tests. Run inside ONE transaction after migration 0027 (see README.md). Ends with a raise that rolls everything back and prints the log.

do $t$
declare
  U1 uuid := '00000000-0000-4000-8000-0000000000a1'; U2 uuid := '00000000-0000-4000-8000-0000000000a2';
  U3 uuid := '00000000-0000-4000-8000-0000000000a3'; U4 uuid := '00000000-0000-4000-8000-0000000000a4';
  U5 uuid := '00000000-0000-4000-8000-0000000000a5'; U6 uuid := '00000000-0000-4000-8000-0000000000a6';
  U7 uuid := '00000000-0000-4000-8000-0000000000a7'; U8 uuid := '00000000-0000-4000-8000-0000000000a8';
  U9 uuid := '00000000-0000-4000-8000-0000000000a9';
  v_week date := public._game_week_start();
  v_seed bigint := 424242; v_res jsonb; v_rid uuid; v_ev jsonb; v_b0 bigint; v_b1 bigint; v_cnt int; v_id bigint; v_msg text;
  v_run_u bigint; v_w1 bigint; v_pub jsonb;
begin
  perform set_config('tr.log', '', true);
  -- helper closures are written inline; check(name, cond, got)
  insert into auth.users (id, email) values
    (U1,'t1@example.test'),(U2,'t2@example.test'),(U3,'t3@example.test'),(U4,'t4@example.test'),(U5,'t5@example.test'),
    (U6,'t6@example.test'),(U7,'t7@example.test'),(U8,'t8@example.test'),(U9,'t9@example.test');
  update public.profiles set full_name = 'Ravi Kumar' where id in (U1,U2,U3,U4,U5,U6,U7,U8);
  update public.profiles set role = 'admin' where id = U9;
  update public.site_settings set value = jsonb_set(value, '{target_score}', '100') where key = 'game_weekly';

  -- previous-week winners must not block this week (week rollover)
  insert into public.game_winners (week_key, place, user_id, run_id, score, coins) values
    (v_week - 7, 1, U6, null, 500, 30), (v_week - 7, 2, U7, null, 400, 20), (v_week - 7, 3, U8, null, 300, 10);
  perform set_config('tr.log', current_setting('tr.log') || E'\nrollover: 3 old winners, current week winners = ' || (select count(*) from public.game_winners where week_key = v_week), true);

  -- daily prize cap: 60 prize runs today (finished, not rejected) block a new prize run while the week is open
  perform set_config('request.jwt.claims', json_build_object('sub', U7, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  insert into public.game_runs (user_id, week_key, seed, target, prize_run, status) select U7, v_week, 1, 100, true, 'finished' from generate_series(1, 60);
  begin v_res := public.game_start(); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n60 prize runs today -> ' || v_msg, true);
  delete from public.game_runs where user_id = U7;

  -- logged out
  perform set_config('request.jwt.claims', '', true);
  begin perform public.game_start(); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nlogged_out game_start -> ' || v_msg, true);

  -- U1 wins place 1 (12 valid taps on normal targets of seed v_seed)
  perform set_config('request.jwt.claims', json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  perform set_config('tr.log', current_setting('tr.log') || E'\nstart U1 prize_run=' || (v_res->>'prize_run') || ' target=' || (v_res->>'target'), true);
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_ev := (select jsonb_agg(jsonb_build_object('t', t + 150, 'k', k) order by t) from (select k, t from public._game_schedule(v_seed) where kind = 0 order by t limit 12) s);
  v_res := public.game_finish(v_rid, v_ev);
  perform set_config('tr.log', current_setting('tr.log') || E'\nfinish U1 -> ' || v_res::text, true);
  select coins into v_w1 from public.game_winners where user_id = U1 and week_key = v_week;
  perform set_config('tr.log', current_setting('tr.log') || E'\nU1 winner coins=' || coalesce(v_w1::text,'none'), true);

  -- replay of the same run
  begin v_res := public.game_finish(v_rid, v_ev); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nreplay -> ' || v_msg, true);

  -- U1 again: already won this week (prize flag off at start), and forced prize flag on at finish
  v_res := public.game_start();
  perform set_config('tr.log', current_setting('tr.log') || E'\nU1 second start prize_run=' || (v_res->>'prize_run'), true);
  v_rid := (v_res->>'run_id')::uuid; update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds', prize_run = true where id = v_rid;
  v_res := public.game_finish(v_rid, v_ev);
  perform set_config('tr.log', current_setting('tr.log') || E'\nU1 forced prize finish -> ' || (v_res->'prize')::text, true);

  -- U2 place 2, U3 place 3
  perform set_config('request.jwt.claims', json_build_object('sub', U2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, v_ev);
  perform set_config('tr.log', current_setting('tr.log') || E'\nU2 -> ' || (v_res->'prize')::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', U3, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, v_ev);
  perform set_config('tr.log', current_setting('tr.log') || E'\nU3 -> ' || (v_res->'prize')::text, true);

  -- U4: decided. Start shows prize off; forced prize flag shows winners_decided
  perform set_config('request.jwt.claims', json_build_object('sub', U4, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, v_ev);
  perform set_config('tr.log', current_setting('tr.log') || E'\nU4 (decided) -> ' || (v_res->'prize')::text || ' winners=' || (select count(*) from public.game_winners where week_key = v_week), true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds', prize_run = true where id = v_rid;
  v_res := public.game_finish(v_rid, v_ev);
  perform set_config('tr.log', current_setting('tr.log') || E'\nU4 forced prize -> ' || (v_res->'prize')::text, true);

  -- coins: once only
  select coins into v_w1 from public.game_winners where user_id = U2 and week_key = v_week;
  perform set_config('tr.log', current_setting('tr.log') || E'\nplace coins U2=' || v_w1 || ' sum=' || (select sum(coins) from public.game_winners where week_key = v_week), true);
  select count(*) into v_cnt from public.coin_ledger where idempotency_key = 'game:' || v_week::text || ':1';
  perform set_config('tr.log', current_setting('tr.log') || E'\nledger rows for game:week:1 = ' || v_cnt, true);
  v_b0 := public._coin_balance(U1);
  v_id := public._referral_issue(U1, 30, 'again', 'game:' || v_week::text || ':1');
  v_b1 := public._coin_balance(U1);
  perform set_config('tr.log', current_setting('tr.log') || E'\nreissue same key: balance unchanged=' || (v_b0 = v_b1) || ' balance=' || v_b1, true);
  select count(*) into v_cnt from public.notifications where user_id = U1 and title like 'Tap Rush%';
  perform set_config('tr.log', current_setting('tr.log') || E'\nU1 bell notifications=' || v_cnt, true);

  -- rejections: too fast, burst, regular, off-target, duplicate, too long ago
  perform set_config('request.jwt.claims', json_build_object('sub', U5, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, (select jsonb_agg(jsonb_build_object('t', 1000 + i*10, 'k', -1)) from generate_series(0, 29) i));
  perform set_config('tr.log', current_setting('tr.log') || E'\nimpossible rate (10ms taps) -> ' || (v_res->>'reason'), true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, (select jsonb_agg(jsonb_build_object('t', 1000 + i*60, 'k', -1)) from generate_series(0, 14) i));
  perform set_config('tr.log', current_setting('tr.log') || E'\n15 taps in 0.9s -> ' || (v_res->>'reason'), true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, (select jsonb_agg(jsonb_build_object('t', 1000 + i*100, 'k', -1)) from generate_series(0, 39) i));
  perform set_config('tr.log', current_setting('tr.log') || E'\n40 taps exactly 100ms apart -> ' || (v_res->>'reason'), true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, jsonb_build_array(jsonb_build_object('t', 5, 'k', 40)));
  perform set_config('tr.log', current_setting('tr.log') || E'\ntap on a target not alive yet -> ' || (v_res->>'reason'), true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '5 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, '[]'::jsonb);
  perform set_config('tr.log', current_setting('tr.log') || E'\nfinished 5 s after start -> ' || (v_res->>'reason'), true);
  v_res := public.game_start(); v_rid := (v_res->>'run_id')::uuid;
  update public.game_runs set seed = v_seed, started_at = now() - interval '31 seconds' where id = v_rid;
  v_res := public.game_finish(v_rid, (select jsonb_agg(jsonb_build_object('t', t + 150, 'k', k) order by t) from (select k, t from public._game_schedule(v_seed) where kind = 0 order by t limit 2) s) || jsonb_build_array(jsonb_build_object('t', 0, 'k', -1)));
  perform set_config('tr.log', current_setting('tr.log') || E'\ntime order -> ' || (v_res->>'reason'), true);

  -- daily prize cap: 60 prize runs today blocks a new prize run
  perform set_config('tr.log', current_setting('tr.log') || E'\n(daily cap test moved to the top)', true);

  -- blocked account
  update public.profiles set status = 'suspended' where id = U8;
  perform set_config('request.jwt.claims', json_build_object('sub', U8, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin v_res := public.game_start(); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nsuspended game_start -> ' || v_msg, true);

  -- RLS: runs visible only to owner
  perform set_config('request.jwt.claims', json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.game_runs;
  reset role;
  perform set_config('tr.log', current_setting('tr.log') || E'\nU1 sees via RLS = ' || v_cnt || ' of ' || (select count(*) from public.game_runs) || ' total runs', true);

  -- podium: placeholder names before approval
  perform set_config('request.jwt.claims', '', true);
  v_pub := public.game_state();
  perform set_config('tr.log', current_setting('tr.log') || E'\npodium before approval: ' || (v_pub->'podium')::text || E'\ndecided=' || (v_pub->>'decided') || ' logged_in=' || (v_pub->>'logged_in'), true);

  -- winner submission
  perform set_config('request.jwt.claims', json_build_object('sub', U4, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin v_res := public.game_submit_winner(1, 'Hacker', 'x'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nnon-winner submit -> ' || v_msg, true);
  perform set_config('request.jwt.claims', json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select id into v_run_u from public.game_winners where user_id = U1 and week_key = v_week;
  begin v_res := public.game_submit_winner(v_run_u, '<b>Ravi</b>', U1::text || '/p1.jpg'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nhtml name -> ' || v_msg, true);
  begin v_res := public.game_submit_winner(v_run_u, 'ravi.com', U1::text || '/p1.jpg'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nlink name -> ' || v_msg, true);
  begin v_res := public.game_submit_winner(v_run_u, 'Ravi K', U2::text || '/p1.jpg'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nforeign folder -> ' || v_msg, true);
  begin v_res := public.game_submit_winner(v_run_u, 'Ravi K', U1::text || '/p1.jpg'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nphoto not uploaded -> ' || v_msg, true);
  insert into storage.objects (bucket_id, name) values ('game-photos', U1::text || '/p1.jpg');
  v_res := public.game_submit_winner(v_run_u, 'Ravi K', U1::text || '/p1.jpg');
  perform set_config('tr.log', current_setting('tr.log') || E'\nvalid submit -> ' || (v_res->>'submit_status'), true);

  -- admin RPCs
  perform set_config('request.jwt.claims', json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin v_res := public.admin_game_pending_count(); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\ncustomer admin_game_pending_count -> ' || v_msg, true);
  perform set_config('request.jwt.claims', json_build_object('sub', U9, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin v_res := public.admin_game_pending_count(); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nadmin without aal2 -> ' || v_msg, true);
  perform set_config('request.jwt.claims', json_build_object('sub', U9, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tr.log', current_setting('tr.log') || E'\nadmin pending count = ' || public.admin_game_pending_count(), true);
  begin v_res := public.admin_game_approve(v_run_u, '<img src=x>', 'settings/game-winners/a.jpg'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\napprove html name -> ' || v_msg, true);
  begin v_res := public.admin_game_approve(v_run_u, 'Ravi K', '../etc/a.jpg'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\napprove bad path -> ' || v_msg, true);
  v_res := public.admin_game_approve(v_run_u, 'Ravi K', 'settings/game-winners/w1-1.jpg');
  perform set_config('tr.log', current_setting('tr.log') || E'\napprove -> ' || (v_res->>'submit_status'), true);
  v_pub := public.game_state();
  perform set_config('tr.log', current_setting('tr.log') || E'\npodium after approval: ' || (v_pub->'podium')::text, true);
  begin v_res := public.admin_game_reject(v_run_u, 'ab'); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nreject short reason -> ' || v_msg, true);
  v_res := public.admin_game_reject(v_run_u, 'Blurry photo');
  perform set_config('tr.log', current_setting('tr.log') || E'\nreject -> ' || (v_res->>'submit_status') || ' delete_public=' || coalesce(v_res->>'delete_public','null'), true);
  begin v_res := public.admin_set_game_settings(true, 150, '[30,30,10]'::jsonb); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nprizes 70 total -> ' || v_msg, true);
  begin v_res := public.admin_set_game_settings(true, 150, '[40,20,10]'::jsonb); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\nprize 40 -> ' || v_msg, true);
  begin v_res := public.admin_set_game_settings(true, 5, '[30,20,10]'::jsonb); v_msg := 'NO_ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\ntarget 5 -> ' || v_msg, true);
  v_res := public.admin_set_game_settings(true, 3600, '[30,20,10]'::jsonb);
  perform set_config('tr.log', current_setting('tr.log') || E'\nsettings ok -> ' || (v_res->>'ok') || ' ' || (select value::text from public.site_settings where key='game_weekly'), true);

  raise exception 'TESTLOG%', current_setting('tr.log');
end
$t$;
