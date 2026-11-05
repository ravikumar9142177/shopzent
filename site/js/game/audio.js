// Tap Rush sound: every sound is synthesised here with WebAudio (no audio files, no copyrighted material).
// The context is created on the first tap (browsers allow audio only after a gesture). Mute is remembered on this device.
const KEY = 'sz_tr_muted';
let ctx = null, master = null, sfxBus = null, musicBus = null, timer = 0, nextT = 0, step = 0;
export let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.16; musicBus.connect(master);
  } catch { ctx = null; }
  return ctx;
}

export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* private mode */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
}

function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function blip(freq, dur, type, peak, when = 0, slideTo = null, bus = null) {
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  env(g, t, 0.005, dur, peak); o.connect(g); g.connect(bus || sfxBus);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, peak, when = 0, hp = 800) {
  if (!ctx) return;
  const t = ctx.currentTime + when, n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = peak;
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t);
}

export const sfx = {
  hit(combo) { const base = 620 + Math.min(combo, 30) * 34; blip(base, 0.09, 'triangle', 0.5); blip(base * 2, 0.05, 'sine', 0.12, 0.012); },
  gold() { [784, 988, 1319].forEach((f, i) => blip(f, 0.16, 'sine', 0.35, i * 0.045)); },
  bomb() { blip(180, 0.32, 'sawtooth', 0.35, 0, 40); noise(0.22, 0.4, 0, 300); },
  miss() { blip(260, 0.12, 'square', 0.12, 0, 150); },
  tick(final) { blip(final ? 1320 : 880, 0.09, 'square', 0.18); },
  over() { blip(440, 0.5, 'sawtooth', 0.22, 0, 110); blip(330, 0.7, 'triangle', 0.25, 0.15, 90); },
  win() { [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.22, 'triangle', 0.35, i * 0.09)); },
};

// a looping 124 bpm groove: sawtooth bass, triangle arpeggio, a soft pad. Scheduled a little ahead of time.
const BASS = [45, 45, 48, 45, 52, 45, 50, 48], ARP = [69, 72, 76, 79, 81, 79, 76, 72];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function schedule() {
  if (!ctx) return;
  const stepLen = 60 / 124 / 2;
  while (nextT < ctx.currentTime + 0.25) {
    const t = nextT, i = step % 8;
    const b = ctx.createOscillator(), bf = ctx.createBiquadFilter(), bg = ctx.createGain();
    b.type = 'sawtooth'; b.frequency.value = mtof(BASS[i]); bf.type = 'lowpass'; bf.frequency.value = 520;
    bg.gain.setValueAtTime(0.0001, t); bg.gain.exponentialRampToValueAtTime(0.5, t + 0.01); bg.gain.exponentialRampToValueAtTime(0.0001, t + stepLen * 0.9);
    b.connect(bf); bf.connect(bg); bg.connect(musicBus); b.start(t); b.stop(t + stepLen);
    const a = ctx.createOscillator(), ag = ctx.createGain();
    a.type = 'triangle'; a.frequency.value = mtof(ARP[(step * 3) % 8]);
    ag.gain.setValueAtTime(0.0001, t); ag.gain.exponentialRampToValueAtTime(0.28, t + 0.005); ag.gain.exponentialRampToValueAtTime(0.0001, t + stepLen * 0.7);
    a.connect(ag); ag.connect(musicBus); a.start(t); a.stop(t + stepLen);
    nextT += stepLen; step++;
  }
}
export function startMusic() {
  if (!ensureAudio() || timer) return;
  nextT = ctx.currentTime + 0.1; step = 0; schedule(); timer = setInterval(schedule, 90);
}
export function stopMusic() { if (timer) { clearInterval(timer); timer = 0; } }
