// SHOPZENT Admin: Festival Studio. Keyword matcher + looks + controls + live preview; saves through admin_set_festival (AAL2, audited).
import { api } from '../api.js';
import { $, esc, errText, confirmBox, checkFile } from '../util.js';
import { FESTIVALS, PALETTES, festivalOf, looksOf, festivalWindow, matchCommand, mountFestival, decorHtml, playAny } from '../festival/festival.js';

const DEF = { enabled: false, theme: 'none', variant: 0, title: '', greeting: '', intensity: 'medium', accent: '', tune: true, tune_url: null, starts_at: null, ends_at: null,
  offer: { enabled: false, headline: '', text: '', link: '', code: '', show_code: false } };
const FX_NAME = { sparks: 'chingari (sparks)', powder: 'rang (colour powder)', snow: 'barf (snow)', petals: 'phool (petals)', confetti: 'confetti', stars: 'taare (stars)', fireworks: 'phuljhari (fireworks)', none: 'static' };
const ist = (v) => (v && v.length === 16 ? `${v}:00+05:30` : null);
const fromIst = (iso) => (iso ? new Date(Date.parse(iso) + 19800000).toISOString().slice(0, 16) : '');
const when = (iso) => (iso ? new Date(Date.parse(iso) + 19800000).toISOString().slice(0, 16).replace('T', ' ') + ' IST' : '—');

export async function renderFestivalStudio({ main, head, call, ok, bad }) {
  main().innerHTML = head('Festival Studio') + `
  <div class="alert small">🪔 <b>Festival Studio</b>: festival ki top decoration, greeting, special-offer strip aur festival ki tune. Save karte hi (ya set ki hui date par) site par dikhega. <b>Ye AI nahi hai:</b> "Type what you want" me shabd pehchanta hai aur fields bhar deta hai; check karke Save karein.</div>
  <div class="card pad" id="fs-status" style="margin-bottom:14px">Loading…</div>
  <div class="card pad" style="margin-bottom:14px">
    <h3 style="margin-top:0">1. Type what you want <span class="tiny muted">(keyword matcher, AI nahi)</span></h3>
    <div class="row" style="gap:8px;flex-wrap:wrap"><input id="fs-cmd" placeholder="jaise: diwali offer 20%  ·  chhath  ·  holi  ·  normal" style="flex:1;min-width:200px"><button class="btn sm" id="fs-cmd-go" type="button">Fill karo</button></div>
    <p class="tiny muted" id="fs-cmd-msg" style="margin:6px 0 0">Festival ka naam likhiye (diwali, chhath, holi, eid, christmas, new year, republic day, navratri, rakhi, ganesh, sale…) ya "normal".</p>
  </div>
  <div class="card pad" style="margin-bottom:14px">
    <h3 style="margin-top:0">2. Festival aur look chuniye</h3>
    <label class="small">Festival<select id="fs-fest" style="width:100%;margin-top:4px">${FESTIVALS.map((f) => `<option value="${f.id}">${f.icon} ${esc(f.name)}</option>`).join('')}</select></label>
    <p class="tiny muted" style="margin:10px 0 6px">Look chuniye (har festival ke 10 look; neeche chhota preview):</p>
    <div id="fs-looks" class="fs-looks"></div>
  </div>
  <div class="card pad" style="margin-bottom:14px">
    <h3 style="margin-top:0">3. Text, offer aur time</h3>
    <label class="row small" style="gap:8px"><input type="checkbox" id="fs-on"> <b>Festival ON</b> (site par dikhe; khali date = turant)</label>
    <label class="small" style="display:block;margin-top:10px">Title<input id="fs-title" maxlength="60" style="width:100%" placeholder="Happy Diwali"></label>
    <label class="small" style="display:block;margin-top:8px">Greeting line (Hinglish / English)<input id="fs-greet" maxlength="160" style="width:100%" placeholder="Shubh Deepawali 🪔"></label>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:8px">
      <label class="small">Rang (accent)<input type="color" id="fs-acc" value="#f59e0b" style="display:block;width:70px;height:34px;padding:2px"></label>
      <label class="small">Animation<select id="fs-int" style="display:block"><option value="low">Halka</option><option value="medium" selected>Madhyam</option><option value="high">Zyada</option></select></label>
    </div>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:8px">
      <label class="small">Shuru (IST)<input type="datetime-local" id="fs-st" style="display:block"></label>
      <label class="small">Khatam (IST)<input type="datetime-local" id="fs-en" style="display:block"></label>
    </div>
    <p class="tiny muted" style="margin:6px 0 0">Date khali = koi limit nahi. Time IST me likhiye.</p>
    <h4 style="margin:14px 0 6px">Festival tune</h4>
    <label class="row small" style="gap:8px"><input type="checkbox" id="fs-tune" checked> Tune chalu (customer ke pehle tap/scroll par ek baar bajegi; mute button hai)</label>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn sec sm" id="fs-tplay" type="button">▶ Tune sunein</button><span class="tiny muted">Custom file nahi hai to chune hue festival ki original jingle bajegi.</span></div>
    <div style="margin-top:10px;padding:10px;border:1px dashed var(--line);border-radius:12px">
      <div class="small"><b>Custom tune (optional)</b>: mp3 / m4a / ogg / aac / wav, 2 MB tak. <span class="tiny muted">Sirf wahi gaana daalein jiske aap rights rakhte hain ya jo royalty-free ho.</span></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px"><input type="file" id="fs-tfile" accept=".mp3,.m4a,.ogg,.aac,.wav,audio/*" style="max-width:100%"><button class="btn sec sm" id="fs-tup" type="button">Upload</button></div>
      <div class="row" style="gap:8px;margin-top:6px"><input id="fs-turl" placeholder="ya https:// audio link" style="flex:1"><button class="btn ghost sm" id="fs-tclear" type="button">Hata do</button></div>
      <p class="tiny muted" id="fs-tmsg" style="margin:6px 0 0"></p>
    </div>
    <h4 style="margin:14px 0 6px">Special offer strip</h4>
    <label class="row small" style="gap:8px"><input type="checkbox" id="fs-oon"> Offer strip dikhaiye</label>
    <label class="small" style="display:block;margin-top:6px">Headline<input id="fs-oh" maxlength="60" style="width:100%" placeholder="Diwali offer: 20% OFF"></label>
    <label class="small" style="display:block;margin-top:6px">Short text<input id="fs-ot" maxlength="160" style="width:100%" placeholder="Limited time ke liye"></label>
    <label class="small" style="display:block;margin-top:6px">Link (optional: products.html ya https://…)<input id="fs-ol" maxlength="300" style="width:100%"></label>
    <label class="small" style="display:block;margin-top:6px">Coupon code (sirf dikhega jab neeche tick ho)<input id="fs-oc" maxlength="30" style="width:100%" placeholder="DIWALI20"></label>
    <label class="row small" style="gap:8px;margin-top:6px"><input type="checkbox" id="fs-ocs"> Coupon code bhi public site par dikhaiye</label>
    <p class="tiny muted" style="margin:4px 0 0">Ye code sabko dikhega. Private coupon yahan mat daalna (private coupons ke liye Coupons page).</p>
  </div>
  <div class="card pad" style="margin-bottom:14px">
    <h3 style="margin-top:0">4. Preview <span class="tiny muted">(sirf admin me; live site abhi nahi badli)</span></h3>
    <div id="fs-prev" class="fz-prev" style="height:190px;margin-top:6px"></div>
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn sec sm" id="fs-prev-go" type="button">Preview refresh</button></div>
  </div>
  <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:24px"><button class="btn" id="fs-save" type="button">Save & publish</button><button class="btn danger sm" id="fs-reset" type="button">Reset to normal</button></div>`;

  let saved = { ...DEF }; try { const row = await api.select('site_settings', { eq: { key: 'festival' }, single: true }); saved = { ...DEF, ...(row?.value || {}), offer: { ...DEF.offer, ...(row?.value?.offer || {}) } }; } catch { /* first run: defaults */ }
  let st = { ...saved, offer: { ...saved.offer } }; let prev = null, timer = 0;
  const F = () => festivalOf(st.theme);
  const palOf = (fid, k) => { const L = looksOf(fid)[k] || looksOf(fid)[0]; return L ? PALETTES[L.pal] : PALETTES['gold-red']; };

  const statusBox = () => {
    const w = festivalWindow(saved); const lab = { off: 'band hai (normal dikh raha hai)', scheduled: 'Scheduled (abhi shuru nahi)', ended: 'Khatam ho chuka', live: 'LIVE (site par dikh raha hai)' }[w];
    const f = festivalOf(saved.theme);
    $('#fs-status').innerHTML = `<div class="row between" style="flex-wrap:wrap;gap:6px"><b>Abhi site par: ${esc(lab)}</b><span class="tag ${w === 'live' ? 'green' : w === 'scheduled' ? 'pink' : 'gray'}">${esc(w.toUpperCase())}</span></div>
      <div class="tiny muted" style="margin-top:4px">Festival: ${esc(f.icon)} ${esc(f.name)} · look ${Number(saved.variant || 0) + 1} · ${saved.starts_at || saved.ends_at ? `${esc(when(saved.starts_at))} → ${esc(when(saved.ends_at))}` : 'date limit nahi'}</div>`;
  };
  const drawLooks = () => {
    const fid = st.theme; const looks = looksOf(fid);
    if (!looks.length) { $('#fs-looks').innerHTML = '<p class="small muted">"Normal" me koi decoration nahi hai. Festival chuniye.</p>'; return; }
    $('#fs-looks').innerHTML = looks.map((L, k) => { const p = PALETTES[L.pal];
      return `<button type="button" class="fs-look${k === st.variant ? ' on' : ''}" data-k="${k}" aria-pressed="${k === st.variant}">
        <div class="fz fz-prev fs-mini" style="background:linear-gradient(135deg,${p[0]},${p[2]});--fz-a:${p[0]};--fz-b1:${p[1]};--fz-b2:${p[2]}"><div class="fz-band">${decorHtml(L.decor)}</div></div>
        <div class="tiny" style="text-align:left;margin-top:4px"><b>Look ${k + 1}</b> · ${esc(L.pal.replace(/-/g, ' '))}<br><span class="muted">${esc(FX_NAME[L.fx] || L.fx)}</span></div></button>`; }).join('');
  };
  const readCfg = () => ({ enabled: $('#fs-on').checked, theme: st.theme, variant: st.variant, title: $('#fs-title').value.trim(), greeting: $('#fs-greet').value.trim(),
    intensity: $('#fs-int').value, accent: $('#fs-acc').value, tune: $('#fs-tune').checked, tune_url: st.tune_url || null,
    starts_at: ist($('#fs-st').value), ends_at: ist($('#fs-en').value),
    offer: { enabled: $('#fs-oon').checked, headline: $('#fs-oh').value.trim(), text: $('#fs-ot').value.trim(), link: $('#fs-ol').value.trim(), code: $('#fs-oc').value.trim(), show_code: $('#fs-ocs').checked } });
  const refreshPreview = () => { clearTimeout(timer); timer = setTimeout(() => { try { prev && prev.destroy(); const c = readCfg(); prev = mountFestival({ ...c, theme: st.theme, variant: st.variant }, { container: $('#fs-prev'), noStrip: false }); } catch (e) { /* preview only */ } }, 150); };
  const fillForm = () => {
    $('#fs-fest').value = st.theme; $('#fs-on').checked = !!st.enabled; $('#fs-title').value = st.title || ''; $('#fs-greet').value = st.greeting || '';
    $('#fs-int').value = st.intensity || 'medium'; $('#fs-acc').value = /^#[0-9a-f]{6}$/i.test(st.accent || '') ? st.accent : palOf(st.theme, st.variant)[0];
    $('#fs-st').value = fromIst(st.starts_at); $('#fs-en').value = fromIst(st.ends_at); $('#fs-tune').checked = st.tune !== false; $('#fs-turl').value = st.tune_url || '';
    const o = st.offer || {}; $('#fs-oon').checked = !!o.enabled; $('#fs-oh').value = o.headline || ''; $('#fs-ot').value = o.text || ''; $('#fs-ol').value = o.link || ''; $('#fs-oc').value = o.code || ''; $('#fs-ocs').checked = !!o.show_code;
    drawLooks(); refreshPreview();
  };
  const setFestival = (fid, { resetLook = true } = {}) => {
    const oldF = F(); st.theme = fid; if (resetLook) st.variant = 0; const nf = F();
    if (!$('#fs-title').value.trim() || $('#fs-title').value.trim() === oldF.title) $('#fs-title').value = nf.title || '';
    if (!$('#fs-greet').value.trim() || $('#fs-greet').value.trim() === oldF.greeting) $('#fs-greet').value = nf.greeting || '';
    $('#fs-fest').value = fid; $('#fs-acc').value = palOf(fid, st.variant)[0]; drawLooks();
  };
  // events
  $('#fs-fest').addEventListener('change', (e) => { setFestival(e.target.value); refreshPreview(); });
  $('#fs-looks').addEventListener('click', (e) => { const b = e.target.closest('.fs-look'); if (!b) return; st.variant = Number(b.dataset.k); $('#fs-acc').value = palOf(st.theme, st.variant)[0]; drawLooks(); refreshPreview(); });
  document.querySelectorAll('.card input, .card select').forEach((el) => el.addEventListener('input', refreshPreview));
  $('#fs-prev-go').onclick = refreshPreview;
  $('#fs-cmd-go').onclick = () => {
    const m = matchCommand($('#fs-cmd').value); const msg = $('#fs-cmd-msg');
    if (!m) { msg.textContent = 'Samajh nahi aaya. Festival ka naam likhiye (jaise diwali, chhath, holi, eid) ya "normal". Ye keyword matcher hai, AI nahi.'; return; }
    if (m.festival) setFestival(m.festival);
    if (m.enabled !== undefined) $('#fs-on').checked = m.enabled;
    if (m.offer) { const f = F(); $('#fs-oon').checked = true; $('#fs-oh').value = m.offer.pct ? `${f.name} offer: ${m.offer.pct}% OFF` : `${f.name} special offer`; if (!$('#fs-ot').value.trim()) $('#fs-ot').value = 'Limited time ke liye. Abhi dekhein.'; }
    msg.textContent = `Fill kar diya: ${F().name}${m.offer ? ' + offer strip' : ''}. Ye keyword matcher hai (AI nahi). Check karke Save karein.`;
    refreshPreview();
  };
  $('#fs-tplay').onclick = () => { const c = readCfg(); playAny({ ...c, theme: st.theme }); };
  $('#fs-tup').onclick = async () => { const f = $('#fs-tfile').files[0]; const m = $('#fs-tmsg'); try { await checkFile(f, ['mp3', 'm4a', 'ogg', 'aac', 'wav'], 2); m.textContent = 'Upload ho raha hai…'; const mime = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac', wav: 'audio/wav' }[(f.name.split('.').pop() || '').toLowerCase()]; const r = await api.upload('public-media', new File([f], f.name, { type: mime }), 'settings/festival-audio'); if (!r?.url || !/^https:\/\//.test(r.url)) throw new Error('upload'); st.tune_url = r.url; $('#fs-turl').value = r.url; m.textContent = 'Upload ho gaya. Save karein to site par ye tune bajegi.'; } catch (x) { m.textContent = x.message === 'upload' ? 'Upload nahi hua, dobara try karein.' : errText(x); } };
  $('#fs-tclear').onclick = () => { st.tune_url = null; $('#fs-turl').value = ''; $('#fs-tmsg').textContent = 'Custom tune hata di. Save karein.'; };
  $('#fs-turl').addEventListener('change', (e) => { const v = e.target.value.trim(); st.tune_url = v || null; });
  $('#fs-save').onclick = async () => {
    const c = readCfg();
    c.tune_url = $('#fs-turl').value.trim() || null;
    if (c.offer.headline.length > 60 || c.offer.text.length > 160 || c.title.length > 60 || c.greeting.length > 160) return bad(new Error('Text bahut lamba hai (title 60, greeting 160, offer 60/160 tak).'));
    if (c.enabled && c.starts_at && c.ends_at && c.ends_at <= c.starts_at) return bad(new Error('Khatam ka time shuru ke time ke baad ka hona chahiye.'));
    const f = F(); const when2 = c.starts_at || c.ends_at ? `${c.starts_at ? when(c.starts_at) : 'abhi'} → ${c.ends_at ? when(c.ends_at) : 'limit nahi'}` : 'date limit nahi';
    if (!await confirmBox('Festival save karein?', `${f.icon} ${f.name} · look ${c.variant + 1} · ${c.enabled ? 'ON' : 'OFF'} · ${when2}${c.offer.enabled ? ' · offer strip ON' : ''}${c.offer.show_code && c.offer.code ? ` · code ${c.offer.code} public` : ''}. Live site par turant (ya set time par) dikhega.`, { ok: 'Save & publish' })) return;
    try { const out = await call('admin_set_festival', { p_value: { ...c, theme: st.theme, variant: st.variant } }); saved = { ...DEF, ...out, offer: { ...DEF.offer, ...(out.offer || {}) } }; st = { ...saved, offer: { ...saved.offer } }; statusBox(); ok('Saved ✓ (site par set ke hisaab se dikhega)'); }
    catch (x) { bad(x); }
  };
  $('#fs-reset').onclick = async () => {
    if (!await confirmBox('Reset to normal?', 'Festival band ho jayega aur site bilkul normal dikhegi. Koi data delete nahi hota; baad me phir chalu kar sakte hain.', { ok: 'Reset', danger: true })) return;
    try { const out = await call('admin_reset_festival', {}); saved = { ...DEF, ...out }; st = { ...DEF, offer: { ...DEF.offer } }; st.theme = 'none'; fillForm(); statusBox(); ok('Reset ✓ — site normal'); }
    catch (x) { bad(x); }
  };
  statusBox(); fillForm();
}
