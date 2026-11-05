// Tap Rush page: the weekly game, the podium of this week's winners, the winner's photo and name form.
import { api, config } from '../api.js';
import { $, esc, toast, errText } from '../util.js';
import { profile, href } from '../layout.js';
import { createEngine } from '../game/engine.js';
import { ensureAudio, setMuted, muted } from '../game/audio.js';

const BEST_KEY = 'sz_tr_best';
const REASON = {
  too_fast: 'Taps itni tez thi ki game ne count nahi kiya. Thoda aaram se khelo.',
  rate_limit: 'Ek second me itne taps count nahi hote. Dobara khelo.',
  too_regular: 'Taps ka pattern human jaisa nahi laga, isliye run count nahi hua. Dobara khelo.',
  bad_duration: 'Run poora 30 second chalna chahiye. Dobara khelo.',
  tap_off_target: 'Score sync me gadbad hui, run count nahi hua. Dobara khelo.',
  time_order: 'Score sync me gadbad hui, run count nahi hua. Dobara khelo.',
  duplicate_tap: 'Score sync me gadbad hui, run count nahi hua. Dobara khelo.',
  bad_event: 'Score sync me gadbad hui, run count nahi hua. Dobara khelo.',
  too_many_taps: 'Ek run me itne taps nahi ho sakte. Dobara khelo.',
};
const PRIZE_TXT = {
  below_target: (r) => `Target ${Number(r.target).toLocaleString('en-IN')} tak pahunchna hai. Ye run ${Number(r.score).toLocaleString('en-IN')} tha, thoda aur!`,
  already_won_this_week: () => 'Is hafte aap pehle hi winner ho. Maze ke liye khelte raho.',
  winners_decided: () => 'Is hafte ke 3 winners decide ho chuke hain. Ab sirf maze ke liye khelo.',
  week_closed: () => 'Hafta badal gaya hai. Naya round jald shuru hoga.',
};
const rupeeCoins = (n) => `${n} coins`;
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const initial = (s) => esc(String(s || 'W').trim().charAt(0).toUpperCase() || 'W');
const publicPhoto = (path) => path ? `${String(config.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/public-media/${path.split('/').map(encodeURIComponent).join('/')}` : '';
const weekEndText = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const nameOk = (s) => { const t = String(s || '').trim(); return t.length >= 2 && t.length <= 30 && !/(:\/\/|www\.|@|[<>])/i.test(t) && !/\.(com|in|net|org|shop|co|io|me|xyz|info|app|ru|tk)\b/i.test(t) && !/[\u0000-\u001f]/.test(t); };

const PAGE = `
<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Tap Rush</div>
  <h1>Tap Rush 🎮</h1><p class="muted small">Circles tap karo, combo banao. Har hafte pehle 3 alag accounts jo target tak pahunchen, unhe coins milenge.</p></div></div>
<section class="container tr-wrap">
  <div class="tr-stage" id="tr-stage">
    <canvas id="tr-cv" aria-label="Tap Rush game area"></canvas>
    <div class="tr-hud" aria-hidden="true">
      <div class="tr-hud-l"><div class="tr-score" id="tr-score">0</div><div class="tr-combo" id="tr-combo"></div></div>
      <div class="tr-hud-c"><div class="tr-time" id="tr-time">30s</div><div class="tr-bar"><i id="tr-bar"></i></div></div>
      <div class="tr-hud-r"><span class="tr-mult" id="tr-mult"></span><button type="button" class="tr-mute" id="tr-mute" aria-label="Sound on/off">🔊</button></div>
    </div>
    <div class="tr-ov" id="tr-ov"></div>
  </div>
  <div class="tr-note small muted" id="tr-note"></div>
  <div class="tr-banner" id="tr-banner"><div class="small muted">Loading…</div></div>
  <h2 class="tr-h">🏆 Is hafte ke winners</h2>
  <div id="tr-podium"></div>
  <div id="tr-upload"></div>
  <div class="card pad tr-rules">
    <h3>Rules</h3>
    <ul class="small">
      <li>Target score ek hi hai (admin set karta hai). Jo <b>pehle 3 alag accounts</b> target tak pahunchein: 1st <b>30</b>, 2nd <b>20</b>, 3rd <b>10</b> coins, wallet me apne aap.</li>
      <li>Ek account ek hafte me sirf ek baar jeet sakta hai. Hafta Monday 12:00 AM (IST) se Sunday 11:59 PM tak.</li>
      <li>Coins sirf points hain: ye cash nahi hain, withdraw nahi hote, aur shop me kharch hote hain.</li>
      <li>Login ke bina aap maze ke liye khel sakte ho. Prize sirf logged-in account ko milta hai.</li>
      <li>Score server par check hota hai. Bot ya jhooth wale taps se score nahi banega.</li>
    </ul>
  </div>
</section>`;

export async function gamePage() {
  const main = $('#main');
  main.innerHTML = PAGE;
  const cv = $('#tr-cv');
  let me = null; try { me = await profile(); } catch { me = null; }
  let st = null;
  try { st = await api.rpc('game_state'); } catch (x) { $('#tr-banner').innerHTML = `<div class="alert bad">${esc(errText(x))}</div>`; return; }
  let eng = null;
  let lastRun = null;
  let bestLocal = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  const hudEls = { score: $('#tr-score'), combo: $('#tr-combo'), mult: $('#tr-mult'), time: $('#tr-time'), bar: $('#tr-bar') };
  eng = createEngine({ canvas: cv, hud: hudEls });
  const muteBtn = $('#tr-mute');
  const paintMute = () => { muteBtn.textContent = muted ? '🔇' : '🔊'; muteBtn.setAttribute('aria-pressed', String(!muted)); };
  paintMute();
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); setMuted(!muted); paintMute(); });

  function renderBanner(s) {
    const left = Math.max(0, 3 - (s.winners_count || 0));
    const status = !s.enabled ? 'Game abhi band hai. Maze ke liye khel sakte ho.'
      : s.decided ? 'Is hafte ke 3 winners decide ho chuke hain. Ab sirf maze ke liye khelo.'
      : `Is hafte ${left} prize baaki ${left === 1 ? 'hai' : 'hain'}. Target: ${fmt(s.target)}`;
    $('#tr-banner').innerHTML = `
      <div class="tr-chips"><span class="tr-chip">🎯 Target <b>${fmt(s.target)}</b></span><span class="tr-chip">🥇 ${rupeeCoins(s.prizes[0])}</span><span class="tr-chip">🥈 ${rupeeCoins(s.prizes[1])}</span><span class="tr-chip">🥉 ${rupeeCoins(s.prizes[2])}</span></div>
      <div class="small"><b>${esc(status)}</b></div>
      <div class="tiny muted">Hafta khatam: ${esc(weekEndText(s.week_ends_at))} (IST)${me ? ` · aaj ke ${fmt(s.me?.plays_today || 0)} plays` : ''}</div>`;
    $('#tr-note').textContent = me ? (s.me && s.me.won_place ? `Aap is hafte #${s.me.won_place} ho.` : '') : 'Login karke khelo, tab prize jeet sakte ho.';
  }

  function renderPodium(s) {
    const rows = s.podium || [];
    const byPlace = { 1: null, 2: null, 3: null }; rows.forEach((r) => { byPlace[r.place] = r; });
    const slot = (place) => {
      const r = byPlace[place];
      const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉';
      if (!r) return `<div class="tr-pod p${place} empty"><div class="tr-av">${medal}</div><div class="tr-pn muted">Khali</div><div class="tiny muted">${rupeeCoins(s.prizes[place - 1])}</div></div>`;
      const photo = publicPhoto(r.photo_path);
      return `<div class="tr-pod p${place}"><div class="tr-av">${photo ? `<img src="${esc(photo)}" alt="${esc(r.name)}" loading="lazy" decoding="async" width="72" height="72">` : `<span>${initial(r.name)}</span>`}</div>
        <div class="tr-pn">${esc(r.name)}</div><div class="tiny">${medal} #${place} · ${rupeeCoins(r.coins)}</div></div>`;
    };
    $('#tr-podium').innerHTML = `<div class="tr-podium">${slot(2)}${slot(1)}${slot(3)}</div>
      <p class="tiny muted center">${s.podium_week ? `Hafta: ${esc(String(s.podium_week))}` : 'Abhi tak koi winner nahi.'}${rows.length && !rows.some((r) => r.photo_path) ? ' · Photo admin approve karega.' : ''}</p>`;
  }

  function renderUpload(s) {
    const box = $('#tr-upload');
    const wins = (me && s.me && s.me.wins) || [];
    const open = wins.filter((w) => w.submit_status === 'none' || w.submit_status === 'rejected');
    const pending = wins.filter((w) => w.submit_status === 'pending');
    const approved = wins.filter((w) => w.submit_status === 'approved');
    let html = '';
    for (const w of approved) html += `<div class="card pad tr-up-ok"><div class="small"><b>✅ Aapki photo aur naam game me live hain</b> (${esc(String(w.week_key))}, #${w.place})</div></div>`;
    for (const w of pending) html += `<div class="card pad"><div class="small"><b>⏳ Photo aur naam review me hain</b> (${esc(String(w.week_key))}, #${w.place}). Admin approve karega, tab game me dikhega.</div></div>`;
    for (const w of open) {
      html += `<form class="card pad tr-up" data-win="${esc(w.id)}" data-week="${esc(String(w.week_key))}" data-place="${esc(w.place)}">
        <h3>🏆 Aap #${esc(w.place)} ho! Photo aur naam add karo</h3>
        ${w.submit_status === 'rejected' ? `<div class="alert bad small">Pichhli baar ye reject hua: ${esc(w.reject_reason || 'reason nahi diya')}. Naya bhejo.</div>` : ''}
        <p class="small muted">Photo aur naam admin approve karega, tabhi game ke neeche dikhenge. Photo 300 KB tak, JPG ya PNG.</p>
        <label class="small">Photo<input type="file" accept="image/*" class="tr-file" required></label>
        <img class="tr-prev" alt="" hidden>
        <label class="small">Naam (2–30 letters, bina link ke)<input class="tr-name" maxlength="30" required value="${esc(me && me.full_name ? String(me.full_name).split(' ')[0] : '')}"></label>
        <button class="btn" type="submit">Bhejo</button><div class="tr-up-msg small" role="status"></div></form>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('form.tr-up').forEach((f) => wireUpload(f));
  }

  function wireUpload(form) {
    const file = form.querySelector('.tr-file'), prev = form.querySelector('.tr-prev'), msg = form.querySelector('.tr-up-msg'), btn = form.querySelector('button');
    file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; prev.src = URL.createObjectURL(f); prev.hidden = false; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = file.files[0], name = form.querySelector('.tr-name').value.trim();
      if (!f || !/^image\//.test(f.type) || f.size > 15 * 1024 * 1024) { msg.textContent = 'Ek photo chuniye (JPG/PNG).'; return; }
      if (!nameOk(name)) { msg.textContent = 'Naam 2–30 letters ka ho, bina link ya HTML ke.'; return; }
      btn.disabled = true; msg.textContent = 'Photo chhoti ho rahi hai…';
      try {
        const blob = await compress(f);
        msg.textContent = 'Upload ho raha hai…';
        const up = await api.upload('game-photos', new File([blob], 'photo.jpg', { type: 'image/jpeg' }), me.id);
        await api.rpc('game_submit_winner', { p_win_id: Number(form.dataset.win), p_name: name, p_photo_path: up.path });
        toast('Bhej diya ✓ Admin approve karega.', 'ok');
        st = await api.rpc('game_state'); renderUpload(st); renderPodium(st);
      } catch (x) {
        const m = String(x && x.message || x);
        msg.textContent = /photo_too_big/.test(m) ? 'Photo bahut badi hai, dusri try karo.' : /invalid_name/.test(m) ? 'Naam sahi nahi hai.' : /invalid_photo/.test(m) ? 'Photo upload nahi hui, dobara try karo.' : 'Kuch gadbad hui. Dobara try karo.';
        btn.disabled = false;
      }
    });
  }

  async function compress(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const sc = Math.min(1, 300 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
        if (blob && blob.size <= 300 * 1024) return blob;
      }
      throw new Error('photo_too_big');
    } finally { URL.revokeObjectURL(url); }
  }

  function overlay(html) { const ov = $('#tr-ov'); ov.innerHTML = html; ov.hidden = false; ov.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', startRun)); ov.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const u = $('#tr-upload'); u.scrollIntoView({ behavior: 'smooth', block: 'center' }); })); }
  function hideOverlay() { const ov = $('#tr-ov'); ov.hidden = true; ov.innerHTML = ''; }

  function idleOverlay() {
    const best = Math.max(bestLocal, lastRun?.score || 0);
    const loginLine = me ? '' : `<p class="tiny">Prize ke liye <a href="${href('login.html?next=game.html')}" class="tr-link">login</a> karo. Login ke bina maze ke liye khel sakte ho.</p>`;
    overlay(`<div class="tr-ov-in"><div class="tr-logo">TAP<br>RUSH</div>
      <p class="small">Neon circles tap karo. Gold ⭐ = 30 pts. Red ✖ mat chhuna (combo tootega, -15).</p>
      <button type="button" class="tr-go" data-go>${lastRun ? 'Phir se khelo' : 'TAP TO PLAY'}</button>
      ${best ? `<p class="tiny muted">Best: ${fmt(best)}</p>` : ''}${loginLine}</div>`);
  }

  async function startRun() {
    ensureAudio();
    if (eng.state === 'countdown' || eng.state === 'play') return;
    if (!me) {
      overlay('<div class="tr-ov-in"><div class="small">Connecting…</div></div>');
      hideOverlay();
      eng.play({ seed: Math.floor(Math.random() * 4294967296), onDone: (res) => onLocalDone(res) });
      return;
    }
    overlay('<div class="tr-ov-in"><div class="small">Game taiyaar ho raha hai…</div></div>');
    let run;
    try { run = await api.rpc('game_start'); }
    catch (x) {
      const m = String(x && x.message || x);
      const txt = /daily_prize_limit/.test(m) ? 'Aaj ke prize plays khatam. Kal phir khelna.' : /daily_limit/.test(m) ? 'Aaj ke plays khatam. Kal phir khelna.' : /account_suspended/.test(m) ? 'Aapka account abhi active nahi hai.' : /rate_limited/.test(m) ? 'Thoda ruko, phir try karo.' : 'Game shuru nahi ho paya. Dobara try karo.';
      overlay(`<div class="tr-ov-in"><div class="small">${esc(txt)}</div><button type="button" class="tr-go" data-go>Dobara try karo</button></div>`); return;
    }
    lastRun = { run_id: run.run_id, prize_run: run.prize_run, score: 0 };
    hideOverlay();
    eng.play({ seed: run.seed, onDone: (res) => onServerDone(run, res) });
  }

  async function onServerDone(run, res) {
    overlay('<div class="tr-ov-in"><div class="small">Score check ho raha hai…</div></div>');
    let out;
    try { out = await api.rpc('game_finish', { p_run_id: run.run_id, p_events: res.events }); }
    catch (x) { showResult({ ok: false, msg: 'Run count nahi hua. Dobara try karo.' }); return; }
    if (!out || !out.ok) { showResult({ ok: false, msg: REASON[out && out.reason] || 'Run count nahi hua. Dobara try karo.' }); return; }
    lastRun = { run_id: run.run_id, score: out.score };
    if (out.score > bestLocal) { bestLocal = out.score; try { localStorage.setItem(BEST_KEY, String(bestLocal)); } catch { /* */ } }
    showResult({ ok: true, out, prize: out.prize || {} });
    try { st = await api.rpc('game_state'); renderBanner(st); renderPodium(st); renderUpload(st); } catch { /* keep the page */ }
  }

  function onLocalDone(res) {
    lastRun = { score: res.score };
    if (res.score > bestLocal) { bestLocal = res.score; try { localStorage.setItem(BEST_KEY, String(bestLocal)); } catch { /* */ } }
    showResult({ ok: true, out: { score: res.score, best_combo: res.bestCombo, hits: res.hits }, local: true, prize: { eligible: false } });
  }

  function showResult({ ok, out, prize, local, msg }) {
    if (!ok) { overlay(`<div class="tr-ov-in"><div class="small">${esc(msg)}</div><button type="button" class="tr-go" data-go>Phir se khelo</button></div>`); return; }
    let prizeLine = '';
    if (local) prizeLine = `<p class="small">Ye score is device par save hua. Prize ke liye <a href="${href('login.html?next=game.html')}" class="tr-link">login</a> karo.</p>`;
    else if (prize && prize.won) prizeLine = `<div class="tr-win">🏆 Aap #${esc(prize.place)} ho is hafte! ${rupeeCoins(prize.coins)} wallet me aa gaye.</div><button type="button" class="tr-go sm" data-up>Photo aur naam add karo ↓</button>`;
    else if (prize && prize.eligible === false) prizeLine = `<p class="small muted">${st && st.decided ? 'Is hafte ke 3 winners decide ho chuke hain. Ab sirf maze ke liye khelo.' : 'Ye run sirf maze ke liye count hua.'}</p>`;
    else if (prize && prize.reason) prizeLine = `<p class="small">${esc((PRIZE_TXT[prize.reason] || (() => ''))(prize))}</p>`;
    const best = Math.max(bestLocal, out.score);
    overlay(`<div class="tr-ov-in tr-over">
      <div class="tiny muted">GAME OVER</div>
      <div class="tr-final">${fmt(out.score)}</div>
      <div class="small">Best: <b>${fmt(best)}</b> · Hits ${fmt(out.hits)} · Best combo x${fmt(out.best_combo)}</div>
      ${prizeLine}
      <button type="button" class="tr-go" data-go>Phir se khelo</button>
      ${me ? '' : ''}</div>`);
    countUp($('#tr-ov .tr-final'), out.score);
  }

  // score count-up on the game-over card (display only; the number is the one the server checked)
  function countUp(el, to) {
    if (!el) return; const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = Number(to) || 0; if (reduce || target < 1) { el.textContent = fmt(target); return; }
    const t0 = performance.now(), dur = Math.min(1100, 400 + target * 0.6);
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(target * e)); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  }

  // first paint
  renderBanner(st); renderPodium(st); renderUpload(st);
  idleOverlay();
  window.addEventListener('pagehide', () => eng.destroy());
  return;
}
