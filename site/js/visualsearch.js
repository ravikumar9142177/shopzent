// Camera / photo search (on-device, free): compares a photo's colours and layout with product pictures. Photo never leaves the phone.
import { api } from './api.js';
import { modal, esc } from './util.js';
import { decorate, productCard, wishlistIds, media } from './layout.js';
const N = 6, HB = 18;
function feat(img) {
  const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d', { willReadFrequently: true });
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = Math.min(w, h) * 0.9, sx = (w - s) / 2, sy = (h - s) / 2;
  x.fillStyle = '#fff'; x.fillRect(0, 0, 48, 48); x.drawImage(img, sx, sy, s, s, 0, 0, 48, 48);
  const d = x.getImageData(0, 0, 48, 48).data, g = new Float32Array(N * N * 3), cnt = new Float32Array(N * N), hue = new Float32Array(HB);
  for (let py = 0; py < 48; py++) for (let px = 0; px < 48; px++) {
    const i = (py * 48 + px) * 4, r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, cell = Math.floor(py / (48 / N)) * N + Math.floor(px / (48 / N));
    g[cell * 3] += r; g[cell * 3 + 1] += gg; g[cell * 3 + 2] += b; cnt[cell]++;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dl = mx - mn;
    if (dl > 0.12 && mx > 0.15) { let hh = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4; hh = (hh * 60 + 360) % 360; const wgt = dl; const cx = Math.abs(px - 24) / 24, cy = Math.abs(py - 24) / 24; hue[Math.floor(hh / (360 / HB)) % HB] += wgt * (1.4 - Math.max(cx, cy)); }
  }
  for (let k = 0; k < N * N; k++) for (let j = 0; j < 3; j++) g[k * 3 + j] /= cnt[k] || 1;
  const hs = hue.reduce((a, b) => a + b, 0) || 1; for (let k = 0; k < HB; k++) hue[k] /= hs;
  return { g, hue };
}
const dist = (a, b) => { let d1 = 0; for (let k = 0; k < a.g.length; k++) { const t = a.g[k] - b.g[k]; d1 += t * t; } d1 = Math.sqrt(d1 / a.g.length); let d2 = 0; for (let k = 0; k < HB; k++) d2 += Math.abs(a.hue[k] - b.hue[k]); return d1 * 1.0 + d2 * 0.35; };
const load = (src, cors) => new Promise((res, rej) => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
let cache = null;
async function catalog() {
  if (cache) return cache;
  const ps = await api.select('products', { eq: { published: true }, order: { col: 'created_at', asc: false }, limit: 300 });
  const out = []; let idx = 0;
  const worker = async () => { while (idx < ps.length) { const p = ps[idx++]; const u = media((p.images || [])[0]); if (!u) continue; try { out.push({ p, f: feat(await load(u, true)) }); } catch {} } };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  return (cache = out);
}
export function initCameraSearch() {
  document.querySelectorAll('form.search').forEach((f) => {
    if (f.querySelector('.cam-btn')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cam-btn'; b.setAttribute('aria-label', 'Search with a photo');
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
    b.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { const file = inp.files[0]; inp.value = ''; if (file) run(file); });
    const sub = f.querySelector('button:not(.cam-btn)'); f.insertBefore(b, sub || null); f.appendChild(inp);
  });
}
async function run(file) {
  if (!/^image\//.test(file.type) || file.size > 15 * 1024 * 1024) { modal('<h3>Photo chhoti/sahi nahi</h3><p class="muted">Koi image (15 MB tak) chunein.</p><button class="btn block" data-close>OK</button>'); return; }
  const url = URL.createObjectURL(file);
  const m = modal(`<div class="row between"><h3 style="margin:0">Photo se search</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div><div class="vs-q"><img src="${url}" alt="Your photo"><div><b>Milte-julte products</b><div class="small muted" id="vs-st">Dhoondh rahe hain…</div></div></div><div class="grid" id="vs-res" style="margin-top:12px"></div><p class="tiny muted" style="margin-top:10px">Ye rang aur shape ke hisaab se milaata hai (aapki photo phone se bahar nahi jaati). Kabhi-kabhi sahi na mile to naam se search karein.</p>`, { wide: true });
  try {
    const q = feat(await load(url, false)); const cat = await catalog();
    const top = cat.map((c) => ({ p: c.p, d: dist(q, c.f) })).sort((a, b) => a.d - b.d).slice(0, 8);
    const st = document.getElementById('vs-st'); if (!top.length) { st.textContent = 'Abhi koi product nahi mila.'; return; }
    const ps = top.map((t) => t.p); await decorate(ps); const w = await wishlistIds();
    st.textContent = `${ps.length} sabse milte-julte products`;
    document.getElementById('vs-res').innerHTML = ps.map((p) => productCard(p, w)).join('');
  } catch (e) { const st = document.getElementById('vs-st'); if (st) st.textContent = 'Search nahi ho paya, dobara try karein.'; }
}
