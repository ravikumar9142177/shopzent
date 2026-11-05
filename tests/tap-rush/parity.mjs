// Tap Rush parity + tuning check (node 22+). Run: node tests/tap-rush/parity.mjs
// 1) prints the schedule fingerprint for fixed seeds: compare with the SQL result of public._game_schedule(seed) (README.md)
// 2) simulates three kinds of player and prints the score distribution used to pick the default target (3600)
import { createHash } from 'node:crypto';
import { schedule, judge, KIND } from '../../site/js/game/core.js';
const seeds = [12345, 0, 4294967295, 999, 2718281828, 1];
for (const s of seeds) {
  const sch = schedule(s);
  const md5 = createHash('md5').update(sch.map((o) => [o.k, o.t, o.life, o.kind, o.x, o.y].join(',')).join(';')).digest('hex');
  console.log('seed', s, 'targets', sch.length, 'md5', md5);
}
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function bot(seed, p, mu, sd) {
  const cand = [];
  for (const s of schedule(seed)) { if (s.kind === KIND.BOMB || Math.random() > p) continue; let r = mu + sd * gauss(); if (r < 120) r = 120; cand.push({ k: s.k, t: Math.round(s.t + r), end: s.t + s.life + 80 }); }
  cand.sort((a, b) => a.t - b.t); const ev = []; let last = -1000;
  for (const c of cand) { const t = Math.max(c.t, last + 35); if (t > c.end || t > 30000) continue; ev.push({ t, k: c.k }); last = t; }
  return ev;
}
for (const [name, p, mu, sd] of [['perfect (100% hits, 190 ms)', 1, 190, 15], ['elite (97%, 215 ms)', 0.97, 215, 35], ['strong (90%, 260 ms)', 0.9, 260, 55], ['average (75%, 330 ms)', 0.75, 330, 90]]) {
  const sc = []; let rej = 0;
  for (let i = 0; i < 2000; i++) { const seed = Math.floor(Math.random() * 4294967296); const j = judge(seed, bot(seed, p, mu, sd), 30500); if (j.ok) sc.push(j.score); else rej++; }
  sc.sort((a, b) => a - b);
  const share = (t) => (sc.filter((x) => x >= t).length / sc.length * 100).toFixed(1) + '%';
  console.log(name.padEnd(30), 'median', sc[Math.floor(sc.length / 2)], 'reach 3600:', share(3600), 'rejected by judge:', rej);
}
