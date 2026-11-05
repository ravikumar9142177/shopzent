# Festival Studio tests

Migrations: `supabase/migrations/0031_festival_studio.sql` (applied live 2026-11-06), `0032_festival_variants.sql` (applied live), `0033_festival_audio_bucket.sql` (applied live).

## 1. Database (rolled back)
Run the migrations and the test blocks in ONE transaction; each test ends with a raise that rolls everything back and prints TESTLOG:

    begin;
    <0031_festival_studio.sql>  <0032_festival_variants.sql>  <0033_festival_audio_bucket.sql>
    <tests/db/0031_festival_studio_test.sql>
    <tests/db/0032_festival_variants_test.sql>

Last run (2026-11-06): 0031 FAILS=0 (anon read, customer and aal1 refused, stale sign-in refused, save + audit + notice state unchanged, 7 invalid inputs refused, reset); 0032 FAILS=0 (32 festival ids accepted, variant 0-9, tune flag, custom tune https link only, javascript: and .exe refused).

## 2. Browser checks (390 px, mocked settings and a mocked admin session)
Serve a copy of `site/` on port 8792 with the public Supabase URL and anon key in js/config.js (never the service key), and put the admin session at /tmp/gt/sess_admin.json (the same mock the Tap Rush checks use). Settings are read from /tmp/fz/settings.json.

    node tests/festival/browser-checks/festival.js all      # festival OFF/ON/ended on home, cart; admin page
    RM=1 node tests/festival/browser-checks/reduced-motion.js

Screenshots land in shots/festival-*.jpg. What they show is observed; sound is not judged (headless Chrome cannot hear the tune; the check only runs the WebAudio graph without errors).
