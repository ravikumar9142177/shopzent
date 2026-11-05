// Tap Rush engine: canvas drawing, parallax and particles, input, timing. The rules are in core.js; this file shows them and
// records the taps the player made. The server re-plays the recorded taps, so nothing here decides the prize.
import { schedule, DUR, SLACK, MIN_GAP, MAX_PER_SEC, KIND } from './core.js';
import { sfx, ensureAudio, startMusic, stopMusic, muted } from './audio.js';

const TAU = Math.PI * 2;
const COUNTDOWN = 3000;
const PAL = { cyan: '#22d3ee', pink: '#f472b6', gold: '#fde047', violet: '#a78bfa', lime: '#a3e635', red: '#fb7185', white: '#f8fafc' };
const rnd = (a, b) => a + Math.random() * (b - a);
const easeOutBack = (x) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

export function createEngine({ canvas, hud, onFinish, onHudChange }) {
  const g = canvas.getContext('2d');
  let W = 300, H = 500, dpr = 1, R = 30, sp = {}, bgCanvas = null, stars = [];
  let raf = 0, last = 0, state = 'idle', sch = [], idx = 0, alive = [], t0 = 0, cdStart = 0, cdLast = -1;
  let events = [], recent = [], score = 0, combo = 0, bestCombo = 0, hits = 0, mult = 1, nowMs = 0;
  let particles = [], rings = [], pops = [], shake = 0, flash = 0, goAt = -1, lastHud = '';
  let seed = 0, onDone = null, shown = { score: -1, combo: -1, time: -1, mult: -1 };

  function glow(color, size, inner) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'), m = size / 2, grd = x.createRadialGradient(m, m, 0, m, m, m);
    grd.addColorStop(0, inner || 'rgba(255,255,255,0.9)'); grd.addColorStop(0.28, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grd; x.fillRect(0, 0, size, size); return c;
  }
  function badge(fill, ring, symbol) {
    const S = Math.ceil(R * 2.6 * dpr), c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'), m = S / 2, r = R * dpr;
    x.fillStyle = fill; x.beginPath(); x.arc(m, m, r, 0, TAU); x.fill();
    x.lineWidth = Math.max(2, r * 0.12); x.strokeStyle = ring; x.beginPath(); x.arc(m, m, r * 0.98, 0, TAU); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = Math.max(1.5, r * 0.06);
    if (symbol === 'x') { const d = r * 0.42; x.beginPath(); x.moveTo(m - d, m - d); x.lineTo(m + d, m + d); x.moveTo(m + d, m - d); x.lineTo(m - d, m + d); x.stroke(); }
    if (symbol === 'star') { x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.2 : r * 0.5; x.lineTo(m + Math.cos(a) * rr, m + Math.sin(a) * rr); } x.closePath(); x.fillStyle = 'rgba(255,255,255,0.9)'; x.fill(); }
    return { c, S };
  }
  function makeSprites() {
    const S = Math.ceil(R * 2.6 * dpr);
    sp = {
      normal: badge('rgba(8,22,40,0.92)', PAL.cyan, null),
      gold: badge('rgba(60,40,4,0.92)', PAL.gold, 'star'),
      bomb: badge('rgba(60,8,20,0.92)', PAL.red, 'x'),
      glow: { cyan: glow('rgba(34,211,238,0.55)', S), gold: glow('rgba(253,224,71,0.55)', S), red: glow('rgba(251,113,133,0.6)', S), S },
      S, dpr,
    };
    // static background (nebula blobs and vignette) rendered once per size
    bgCanvas = document.createElement('canvas'); bgCanvas.width = Math.round(W * dpr); bgCanvas.height = Math.round(H * dpr);
    const b = bgCanvas.getContext('2d'); b.scale(dpr, dpr);
    const blobs = [[0.15, 0.25, 0.55, 'rgba(124,58,237,0.45)'], [0.9, 0.55, 0.6, 'rgba(14,165,233,0.35)'], [0.4, 0.9, 0.5, 'rgba(236,72,153,0.28)']];
    for (const [x, y, rr, col] of blobs) { const gr = b.createRadialGradient(x * W, y * H, 0, x * W, y * H, rr * Math.max(W, H)); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); b.fillStyle = gr; b.fillRect(0, 0, W, H); }
  }
  function resize() {
    const r = canvas.getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(300, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    R = Math.max(24, Math.min(W, H) * 0.066);
    makeSprites();
    if (!stars.length) for (let layer = 0; layer < 3; layer++) for (let i = 0; i < [70, 45, 26][layer]; i++) stars.push({ x: Math.random(), y: Math.random(), layer, s: [1, 1.6, 2.3][layer], v: [14, 32, 60][layer] });
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n && particles.length < 260; i++) {
      const a = rnd(0, TAU), sp2 = rnd(speed * 0.35, speed);
      particles.push({ x, y, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, life: rnd(0.4, 0.8), age: 0, c: color, s: rnd(1.5, 3.4) });
    }
  }
  function pop(x, y, text, color, big) { pops.push({ x, y, text, color, age: 0, big: !!big }); }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* not supported */ } }

  function tgtXY(s) { return [s.x / 1000 * W, s.y / 1000 * H]; }

  function drawBackground(now) {
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#07041a'); grd.addColorStop(0.6, '#140a33'); grd.addColorStop(1, '#1c0b3d');
    g.fillStyle = grd; g.fillRect(-20, -20, W + 40, H + 40);
    if (bgCanvas) g.drawImage(bgCanvas, 0, 0, W, H);
    // stars: three parallax layers scrolling down
    for (const st of stars) {
      st.y += st.v * 0.016 / H; if (st.y > 1) { st.y -= 1; st.x = Math.random(); }
      g.fillStyle = `rgba(255,255,255,${0.35 + st.layer * 0.25})`;
      g.fillRect(st.x * W, st.y * H, st.s, st.s);
    }
    // neon perspective floor
    const hz = H * 0.74, vx = W / 2, off = (now / 1400) % 1;
    g.save(); g.beginPath(); g.rect(0, hz, W, H - hz); g.clip();
    g.strokeStyle = 'rgba(167,139,250,0.28)'; g.lineWidth = 1;
    for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(vx, hz); g.lineTo(vx + i * W / 4, H); g.stroke(); }
    for (let j = 0; j < 12; j++) { const f = ((j + off) / 12), y = hz + (H - hz) * f * f; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const fl = g.createLinearGradient(0, hz, 0, H); fl.addColorStop(0, 'rgba(236,72,153,0.22)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fl; g.fillRect(0, hz, W, H - hz);
    g.restore();
  }

  function drawTargets(now) {
    for (const a of alive) {
      const s = a.s, [px, py] = tgtXY(s), age = (now - s.t) / 120, sc = age >= 1 ? 1 : Math.max(0.01, easeOutBack(Math.max(0, age)));
      const kindKey = s.kind === KIND.GOLD ? 'gold' : s.kind === KIND.BOMB ? 'bomb' : 'normal';
      const spr = sp[kindKey], S = sp.S / dpr;
      if (s.kind === KIND.GOLD) { const gg = sp.glow.gold; g.drawImage(gg, px - S * 0.7 * sc, py - S * 0.7 * sc, S * 1.4 * sc, S * 1.4 * sc); }
      else if (s.kind === KIND.BOMB) { const gg = sp.glow.red; const pulse = 1 + 0.06 * Math.sin(now / 90); g.drawImage(gg, px - S * 0.7 * sc * pulse, py - S * 0.7 * sc * pulse, S * 1.4 * sc * pulse, S * 1.4 * sc * pulse); }
      else { const gg = sp.glow.cyan; g.drawImage(gg, px - S * 0.7 * sc, py - S * 0.7 * sc, S * 1.4 * sc, S * 1.4 * sc); }
      g.drawImage(spr.c, px - S / 2 * sc, py - S / 2 * sc, S * sc, S * sc);
      // remaining-time ring: shows how long the target stays
      const left = Math.max(0, 1 - (now - s.t) / s.life);
      g.lineWidth = 4; g.lineCap = 'round';
      g.strokeStyle = s.kind === KIND.GOLD ? PAL.gold : s.kind === KIND.BOMB ? PAL.red : PAL.cyan;
      g.beginPath(); g.arc(px, py, R * 1.28, -Math.PI / 2, -Math.PI / 2 + TAU * left); g.stroke();
      if (s.kind === KIND.GOLD) { // sparkle ticks
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; const k = (now / 300) % TAU;
        for (let i = 0; i < 4; i++) { const a = k + i * TAU / 4, r1 = R * 1.5, r2 = R * 1.75; g.beginPath(); g.moveTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1); g.lineTo(px + Math.cos(a) * r2, py + Math.sin(a) * r2); g.stroke(); }
      }
    }
  }

  function drawFx(dt) {
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.age += dt; const f = r.age / r.life; if (f >= 1) { rings.splice(i, 1); continue; }
      g.globalAlpha = 1 - f; g.strokeStyle = r.c; g.lineWidth = 3 * (1 - f) + 1; g.beginPath(); g.arc(r.x, r.y, R * (1 + f * 1.6), 0, TAU); g.stroke(); }
    g.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.age += dt; if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 90 * dt;
      g.globalAlpha = 1 - p.age / p.life; g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.s * (1 - p.age / p.life * 0.5), 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    for (let i = pops.length - 1; i >= 0; i--) { const q = pops[i]; q.age += dt; if (q.age > 0.8) { pops.splice(i, 1); continue; }
      const f = q.age / 0.8; g.globalAlpha = 1 - f * f; g.fillStyle = q.color; g.font = `800 ${q.big ? 30 : 20}px system-ui, sans-serif`; g.textAlign = 'center';
      g.fillText(q.text, q.x, q.y - f * 46); }
    g.globalAlpha = 1;
    if (flash > 0) { g.fillStyle = `rgba(251,113,133,${flash * 0.35})`; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 2.5); }
  }

  function drawCountdown(now) {
    const left = COUNTDOWN - (now - cdStart); if (left < 0) return;
    const n = Math.ceil(left / 1000), label = n > 0 ? String(n) : 'GO';
    const f = (left % 1000) / 1000, sc = 1 + (1 - f) * 0.4;
    g.save(); g.translate(W / 2, H * 0.42); g.scale(sc, sc); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(Math.min(W, H) * 0.3)}px system-ui, sans-serif`; g.shadowColor = PAL.cyan; g.shadowBlur = 24; g.fillStyle = PAL.white;
    g.fillText(label, 0, 0); g.restore();
  }

  function updateHud(now) {
    if (!hud) return;
    const left = Math.max(0, Math.ceil((DUR - now) / 1000));
    if (shown.score !== score) { shown.score = score; hud.score.textContent = score.toLocaleString('en-IN'); }
    if (shown.combo !== combo) { shown.combo = combo; hud.combo.textContent = combo > 1 ? 'COMBO ' + combo : ''; }
    if (shown.mult !== mult) { shown.mult = mult; hud.mult.textContent = mult > 1 ? 'x' + mult : ''; }
    if (shown.time !== left) { shown.time = left; hud.time.textContent = left + 's'; }
    if (hud.bar) hud.bar.style.transform = `scaleX(${Math.max(0, 1 - now / DUR)})`;
    if (onHudChange) onHudChange({ score, combo, mult, left });
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - (last || ts)) / 1000); last = ts;
    const realNow = performance.now();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0) { shake *= Math.exp(-dt * 12); if (shake < 0.2) shake = 0; }
    g.save(); if (shake > 0) g.translate(rnd(-shake, shake), rnd(-shake, shake));
    drawBackground(realNow);
    if (state === 'countdown') {
      const el = realNow - cdStart, n = Math.floor(el / 1000);
      if (n !== cdLast && n < 3) { cdLast = n; sfx.tick(false); }
      if (el >= COUNTDOWN) { state = 'play'; t0 = cdStart + COUNTDOWN; goAt = t0; sfx.tick(true); startMusic(); }
      drawCountdown(realNow);
    } else if (state === 'play') {
      nowMs = realNow - t0;
      while (idx < sch.length && sch[idx].t <= nowMs) { alive.push({ s: sch[idx] }); idx++; }
      for (let i = alive.length - 1; i >= 0; i--) {
        const s = alive[i].s;
        if (nowMs > s.t + s.life + SLACK) {
          alive.splice(i, 1);
          if (s.kind !== KIND.BOMB) { combo = 0; mult = 1; sfx.miss(); pop(...tgtXY(s), 'miss', 'rgba(203,213,225,0.9)', false); }
        }
      }
      drawTargets(nowMs);
      if (goAt > 0 && realNow - goAt < 500) { g.save(); g.textAlign = 'center'; g.font = `900 ${Math.round(Math.min(W, H) * 0.2)}px system-ui`; g.fillStyle = PAL.gold; g.globalAlpha = 1 - (realNow - goAt) / 500; g.fillText('GO!', W / 2, H * 0.42); g.restore(); }
      updateHud(nowMs);
      if (nowMs >= DUR) finish(false);
    } else if (state === 'idle') {
      drawTargets(0);
    }
    drawFx(dt);
    g.restore();
  }

  function onDown(e) {
    if (state !== 'play') return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const now = Math.min(DUR, Math.round(performance.now() - t0));
    if (now >= DUR) return;
    if (events.length && now - events[events.length - 1].t < MIN_GAP) return;     // faster than a finger can tap: ignored
    recent = recent.filter((v) => v > now - 1000);
    if (recent.length >= MAX_PER_SEC) return;                                     // more than the rate allows: ignored
    let hit = null;
    for (const a of alive) { const [px, py] = tgtXY(a.s); const dx = x - px, dy = y - py; if (dx * dx + dy * dy <= (R * 1.35) * (R * 1.35)) { hit = a; break; } }
    recent.push(now);
    if (!hit) { events.push({ t: now, k: -1 }); if (combo) { combo = 0; mult = 1; } return; }
    const s = hit.s, [px, py] = tgtXY(s);
    events.push({ t: now, k: s.k });
    alive = alive.filter((a) => a !== hit);
    if (s.kind === KIND.BOMB) {
      combo = 0; mult = 1; score = Math.max(0, score - 15); flash = 1; shake = 14;
      burst(px, py, PAL.red, 26, 320); pop(px, py, '-15', PAL.red, true); vibrate([40, 30, 40]); sfx.bomb();
    } else {
      combo++; hits++; bestCombo = Math.max(bestCombo, combo); mult = Math.min(8, 1 + Math.floor(combo / 5));
      const pts = s.kind === KIND.GOLD ? 30 : 10; score += pts * mult;
      const col = s.kind === KIND.GOLD ? PAL.gold : PAL.cyan;
      burst(px, py, col, s.kind === KIND.GOLD ? 40 : 22, s.kind === KIND.GOLD ? 380 : 260);
      rings.push({ x: px, y: py, age: 0, life: 0.35, c: col });
      pop(px, py - R, '+' + pts * mult, combo >= 10 ? PAL.pink : PAL.white, combo >= 10);
      shake = Math.min(shake + 1.5, 6); vibrate(10);
      if (s.kind === KIND.GOLD) sfx.gold(); else sfx.hit(combo);
    }
  }

  function finish(early) {
    if (state === 'done' || state === 'idle') return;
    state = 'done'; stopMusic(); alive = []; idx = 0;
    const res = { events: events.slice(), score, hits, bestCombo, early: !!early };
    sfx.over();
    if (onDone) onDone(res);
  }

  function onVis() { if (document.hidden && (state === 'play' || state === 'countdown')) finish(true); }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    /** start a run: targets come from the server seed; onDone receives the tap list and the local score (the server re-plays it). */
    play({ seed: s, onDone: cb }) {
      seed = s; sch = schedule(seed); idx = 0; alive = []; events = []; recent = [];
      score = 0; combo = 0; bestCombo = 0; hits = 0; mult = 1; nowMs = 0; particles = []; rings = []; pops = []; shake = 0; flash = 0; goAt = -1;
      shown = { score: -1, combo: -1, time: -1, mult: -1 }; onDone = cb;
      ensureAudio();
      cdStart = performance.now(); cdLast = -1; state = 'countdown';
      if (hud) { hud.score.textContent = '0'; hud.combo.textContent = ''; hud.mult.textContent = ''; hud.time.textContent = '30s'; if (hud.bar) hud.bar.style.transform = 'scaleX(1)'; }
    },
    stop() { finish(true); },
    idle() { state = 'idle'; alive = []; stopMusic(); },
    get state() { return state; },
    get muted() { return muted; },
    destroy() { cancelAnimationFrame(raf); stopMusic(); canvas.removeEventListener('pointerdown', onDown); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', resize); },
  };
}
