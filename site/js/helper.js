
// SHOPZENT Help: fixed answers only (no AI). Speaks with the browser's own voice when the person taps.
import { profile, href } from './layout.js';

const QA = [
  { q: 'Order kahan hai?', a: 'My Account me "My Orders" kholiye. Wahan har order ka status dikhta hai.', go: 'orders.html' },
  { q: 'Return kaise karun?', a: 'Delivery ke 7 din ke andar My Orders se return request kar sakte hain. Return fee ₹50 lagti hai, aur refund ka tarika order page par dikhta hai.', go: 'orders.html' },
  { q: 'Coupon kaise lagaun?', a: 'Cart me checkout se pehle coupon code daaliye. Minimum order ₹118 hona chahiye.', go: 'cart.html' },
  { q: 'Wallet ka paisa kaise use karun?', a: 'Wallet & Coins page par aapka balance aur coins dikhte hain. Checkout par wallet se payment ho jata hai.', go: 'wallet.html' },
  { q: 'Payment kaise karun?', a: 'UPI se payment karke screenshot upload kijiye. Admin verify karega, uske baad order aage badhega.', go: 'cart.html' },
  { q: 'Naam ya profile kaise badlun?', a: 'My Account me Profile kholiye. Wahan naam aur details badal sakte hain.', go: 'profile.html' },
  { q: 'Kisi se baat karni hai?', a: 'WhatsApp par 9942598154 par message kijiye, team jawab degi.', go: null },
];

const hi = () => { const h = new Date().getHours(); return h < 12 ? 'Suprabhat' : h < 17 ? 'Namaskar' : h < 21 ? 'Shubh sandhya' : 'Shubh raatri'; };
const pickVoice = () => { try { const vs = speechSynthesis.getVoices() || []; return vs.find((v) => /hi[-_]IN/i.test(v.lang)) || vs.find((v) => /en[-_]IN/i.test(v.lang)) || vs.find((v) => /^hi/i.test(v.lang)) || null; } catch { return null; } };
const speak = (t, hindi) => { try { if (!('speechSynthesis' in window)) return false; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = hindi ? 'hi-IN' : 'en-IN'; } u.rate = 0.95; u.pitch = 1.0; speechSynthesis.speak(u); return true; } catch { return false; } };

export async function mountHelper() {
  if (document.getElementById('sz-help')) return;
  const p = await profile().catch(() => null);
  const name = p && p.full_name && String(p.full_name).trim().split(' ')[0];
  const css = document.createElement('style');
  css.textContent = `#sz-help-btn{position:fixed;right:10px;top:96px;z-index:900;width:52px;height:52px;border:0;padding:0;cursor:pointer;background:transparent;filter:drop-shadow(0 0 8px rgba(255,46,151,.7))}#sz-help-btn svg{width:52px;height:52px;animation:szbob 3s ease-in-out infinite}@keyframes szbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}@media (prefers-reduced-motion:reduce){#sz-help-btn svg{animation:none}}
#sz-help{position:fixed;right:12px;top:156px;z-index:901;width:min(340px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#12121a;color:#fff;border-radius:16px;padding:14px;box-shadow:0 18px 40px -12px rgba(0,0,0,.6);border:1px solid rgba(255,46,151,.35)}
#sz-help .q{display:block;width:100%;text-align:left;margin:6px 0;padding:9px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#1c1c28;color:#fff;cursor:pointer;font:600 14px/1.3 system-ui,sans-serif}
#sz-help .a{font:400 14px/1.45 system-ui,sans-serif;background:linear-gradient(120deg,#5b21b6,#db2777);border-radius:12px;padding:10px 12px;margin:8px 0}
#sz-help .x{float:right;background:none;border:0;color:#aaa;font-size:18px;cursor:pointer}`;
  document.head.appendChild(css);
  const btn = document.createElement('button'); btn.id = 'sz-help-btn'; btn.setAttribute('aria-label', 'SHOPZENT help'); btn.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="szy" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6a0"/><stop offset=".55" stop-color="#ffd21f"/><stop offset="1" stop-color="#e0a400"/></radialGradient></defs><path d="M18 14 Q14 2 22 4 Q28 8 26 18 Z" fill="#ffd21f"/><path d="M46 14 Q50 2 42 4 Q36 8 38 18 Z" fill="#ffd21f"/><circle cx="32" cy="36" r="22" fill="url(#szy)"/><circle cx="24" cy="32" r="3.2" fill="#2b1a00"/><circle cx="40" cy="32" r="3.2" fill="#2b1a00"/><path d="M22 46 Q32 56 42 46" fill="#5a1a1a" stroke="#2b1a00" stroke-width="1.5"/><path d="M26 47 Q32 51 38 47" fill="#ff6b8b"/><ellipse cx="18" cy="42" rx="4" ry="2.6" fill="#ff7aa2" opacity=".8"/><ellipse cx="46" cy="42" rx="4" ry="2.6" fill="#ff7aa2" opacity=".8"/><ellipse cx="10" cy="40" rx="4" ry="6" fill="#ffd21f"/><ellipse cx="54" cy="40" rx="4" ry="6" fill="#ffd21f"/></svg>';
  const panel = document.createElement('div'); panel.id = 'sz-help'; panel.hidden = true;
  const greet = `${hi()}, team!`;
  panel.innerHTML = `<button class="x" aria-label="Close">×</button><div style="font-weight:800;margin-bottom:4px">${greet}</div><div style="font-size:13px;opacity:.85;margin-bottom:8px">Kya help chahiye? Koi sawal chuniye.</div>` + QA.map((x, i) => `<button class="q" data-i="${i}">${x.q}</button>`).join('') + `<div id="sz-ans"></div>`;
  const say = (t) => speak(t, true);
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) say(greet + ' Kya help chahiye?'); });
  panel.querySelector('.x').addEventListener('click', () => { panel.hidden = true; try { speechSynthesis.cancel(); } catch {} });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('.q'); if (!b) return;
    const item = QA[+b.dataset.i];
    panel.querySelector('#sz-ans').innerHTML = `<div class="a">${item.a}</div>` + (item.go ? `<a href="${href(item.go)}" style="color:#fff;font-weight:700">Kholiye →</a>` : '');
    say(item.a);
  });
  document.body.appendChild(btn); document.body.appendChild(panel);
  if (!sessionStorage.getItem('sz.hello')) { sessionStorage.setItem('sz.hello', '1'); setTimeout(() => { if (!say(greet + ' Kuch help chahiye to mujhe tap kijiye.')) { const once = () => { say(greet); document.removeEventListener('pointerdown', once); }; document.addEventListener('pointerdown', once, { once: true }); } }, 900); }
}
