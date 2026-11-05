// Tap Rush core: the target schedule and the scoring rules. The server (public._game_schedule and public._game_judge in
// migration 0027) runs the same integer arithmetic; keep the two in step. Pure functions, no DOM, no network.
export const DUR = 30000;        // run length (ms)
export const SLACK = 80;         // latency slack on a target's window (ms)
export const MIN_GAP = 35;       // fastest allowed gap between two taps (ms)
export const MAX_PER_SEC = 14;   // most taps in any 1000 ms window
export const KIND = { NORMAL: 0, GOLD: 1, BOMB: 2 };

// s' = (1664525 * s + 1013904223) mod 2^32 ; Math.imul keeps the low 32 bits exactly, >>> 0 reduces mod 2^32
export function nextState(s) { return (Math.imul(1664525, s) + 1013904223) >>> 0; }

// the run's targets, in spawn order. Integer ms and integer per-mille positions only.
export function schedule(seed) {
  let s = Number(seed) >>> 0, t = 800, k = 0; const out = [];
  while (t < DUR) {
    s = nextState(s); const r = (s >>> 16) % 100;
    const kind = r < 7 ? (t >= 4000 ? KIND.BOMB : KIND.NORMAL) : (r < 16 ? KIND.GOLD : KIND.NORMAL);
    const bl = 1250 - Math.floor(t * 700 / DUR);
    const life = kind === KIND.GOLD ? Math.max(380, bl - 220) : bl;
    s = nextState(s); const x = 80 + ((s >>> 16) % 840);
    s = nextState(s); const y = 120 + ((s >>> 16) % 760);
    out.push({ k, t, life, kind, x, y }); k++;
    s = nextState(s);
    const iv = 720 - Math.floor(t * 430 / DUR) + ((s >>> 16) % 200) - 100;
    t += Math.max(230, iv);
  }
  return out;
}

// Replays a run. events: [{t, k}] in tap order; k = target index, -1 = empty tap. elapsedMs = server clock since start.
export function judge(seed, events, elapsedMs) {
  const bad = (reason) => ({ ok: false, reason });
  if (!Array.isArray(events)) return bad('bad_events');
  const n = events.length;
  if (n > 400) return bad('too_many_taps');
  if (typeof elapsedMs !== 'number' || elapsedMs < 29500 || elapsedMs > 900000) return bad('bad_duration');
  if (n === 0) return { ok: true, score: 0, hits: 0, best_combo: 0, taps: 0 };
  const ev = [];
  for (const e of events) {
    if (!e || typeof e !== 'object' || !Number.isInteger(e.t) || !Number.isInteger(e.k)) return bad('bad_event');
    if (e.t < 0 || e.t > 30100 || e.k < -1 || e.k > 200) return bad('bad_event');
    ev.push({ t: e.t, k: e.k });
  }
  for (let i = 1; i < n; i++) if (ev[i - 1].t > ev[i].t) return bad('time_order');
  const gaps = []; for (let i = 1; i < n; i++) gaps.push(ev[i].t - ev[i - 1].t);
  if (gaps.length && Math.min(...gaps) < MIN_GAP) return bad('too_fast');
  let win = 0;
  for (let a = 0; a < n; a++) { let c = 0; for (let b = 0; b < n; b++) if (ev[b].t <= ev[a].t && ev[b].t > ev[a].t - 1000) c++; if (c > win) win = c; }
  if (win > MAX_PER_SEC) return bad('rate_limit');
  if (gaps.length >= 25) {
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((x, g) => x + (g - mean) * (g - mean), 0) / (gaps.length - 1));
    if (sd < 8) return bad('too_regular');
  }
  if (Math.max(...ev.map((e) => e.t)) > elapsedMs + 1000) return bad('tap_after_finish');
  const seen = new Set();
  for (const e of ev) if (e.k >= 0) { if (seen.has(e.k)) return bad('duplicate_tap'); seen.add(e.k); }
  const sch = schedule(seed);
  for (const e of ev) if (e.k >= 0) {
    const s = sch[e.k];
    if (!s || e.t < s.t - SLACK || e.t > s.t + s.life + SLACK) return bad('tap_off_target');
  }
  // timeline: taps (typ 0) and misses (typ 1) sorted by time, tap first on a tie
  const tl = [];
  for (const e of ev) { const s = e.k >= 0 ? sch[e.k] : null; tl.push({ tm: e.t, typ: 0, k: e.k, kind: s ? s.kind : null }); }
  for (const s of sch) if (s.kind !== KIND.BOMB && s.t + s.life + SLACK <= DUR && !seen.has(s.k)) tl.push({ tm: s.t + s.life + SLACK, typ: 1, k: s.k, kind: s.kind });
  tl.sort((a, b) => (a.tm - b.tm) || (a.typ - b.typ));
  let score = 0, combo = 0, best = 0, hits = 0;
  for (const r of tl) {
    if (r.typ === 1 || r.k === -1) combo = 0;
    else if (r.kind === KIND.BOMB) { combo = 0; score = Math.max(0, score - 15); }
    else { combo++; hits++; best = Math.max(best, combo); const mult = Math.min(8, 1 + Math.floor(combo / 5)); score += (r.kind === KIND.GOLD ? 30 : 10) * mult; }
  }
  return { ok: true, score, hits, best_combo: best, taps: n };
}
