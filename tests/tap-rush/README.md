# Tap Rush tests

Migration: `supabase/migrations/0027_tap_rush_game.sql` (applied to the live database on 2026-11-05).

## 1. Database (rolled back)
Run the migration and the test block in ONE transaction; the test ends with a raise that rolls everything back and prints the log:

    begin;
    <contents of 0027_tap_rush_game.sql>
    <contents of db-tests.sql>

Expect `TESTLOG` followed by PASS-type lines: week rollover, first 3 places (30/20/10), 4th gets nothing,
same account cannot win twice, coins paid once (ledger key `game:<week>:<place>`), replay refused,
too_fast / rate_limit / too_regular / tap_off_target / time_order / bad_duration, daily prize cap,
logged-out and suspended accounts refused, RLS (runs visible to owner only), podium placeholders and approval,
winner submission checks, admin AAL2 checks, prize total <= 60, target >= 100.

## 2. Schedule and scoring parity (JS = SQL)
    node tests/tap-rush/parity.mjs

prints the MD5 of the schedule for six fixed seeds. The same MD5 comes from
`select md5(string_agg(k||','||t||','||life||','||kind||','||x||','||y, ';' order by k)) from public._game_schedule(<seed>)`
and matched for all six seeds on 2026-11-05. Scoring parity was checked on 119 generated run lists
(valid bot runs, bombs, empty taps, misses, and rejected lists): identical score, hits, best combo and reason.

The same script prints the tuning simulation behind the default target (3600).

## 3. Browser checks (run against a local copy of the site with the public config)
`browser-checks/` holds the Playwright scripts used on 2026-11-05 (390 px, touch emulation):
- `lo.js`: logged-out play against the live backend (real game_state, real play, game over).
- `mock.js`: logged-in flow with a MOCKED session and mocked RPCs (MODE=none|approved|pending).
- `admin.js`: admin Game winners page with a MOCKED AAL2 session and mocked RPCs.
They expect a static server on port 8791 serving a copy of `site/` with the public URL/anon key in js/config.js.
