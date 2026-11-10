
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

const hi = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night'; };
const speak = (t) => { try { if (!('speechSynthesis' in window)) return false; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'en-IN'; u.rate = 0.98; u.pitch = 1.05; speechSynthesis.speak(u); return true; } catch { return false; } };

export async function mountHelper() {
  if (document.getElementById('sz-help')) return;
  const p = await profile().catch(() => null);
  const name = p && p.full_name && String(p.full_name).trim().split(' ')[0];
  const css = document.createElement('style');
  css.textContent = `#sz-help-btn{position:fixed;right:16px;bottom:18px;z-index:900;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:linear-gradient(135deg,#ff7ad9,#ff2e97 55%,#ffb347);color:#fff;font:900 22px/1 system-ui,sans-serif;box-shadow:0 10px 26px -8px rgba(255,46,151,.7)}
#sz-help{position:fixed;right:16px;bottom:88px;z-index:901;width:min(340px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#12121a;color:#fff;border-radius:16px;padding:14px;box-shadow:0 18px 40px -12px rgba(0,0,0,.6);border:1px solid rgba(255,46,151,.35)}
#sz-help .q{display:block;width:100%;text-align:left;margin:6px 0;padding:9px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#1c1c28;color:#fff;cursor:pointer;font:600 14px/1.3 system-ui,sans-serif}
#sz-help .a{font:400 14px/1.45 system-ui,sans-serif;background:linear-gradient(120deg,#5b21b6,#db2777);border-radius:12px;padding:10px 12px;margin:8px 0}
#sz-help .x{float:right;background:none;border:0;color:#aaa;font-size:18px;cursor:pointer}`;
  document.head.appendChild(css);
  const btn = document.createElement('button'); btn.id = 'sz-help-btn'; btn.setAttribute('aria-label', 'SHOPZENT help'); btn.textContent = 'H';
  const panel = document.createElement('div'); panel.id = 'sz-help'; panel.hidden = true;
  const greet = name ? `${hi()}, ${name}!` : `${hi()}!`;
  panel.innerHTML = `<button class="x" aria-label="Close">×</button><div style="font-weight:800;margin-bottom:4px">${greet}</div><div style="font-size:13px;opacity:.85;margin-bottom:8px">Kya help chahiye? Koi sawal chuniye.</div>` + QA.map((x, i) => `<button class="q" data-i="${i}">${x.q}</button>`).join('') + `<div id="sz-ans"></div>`;
  const say = (t) => { const ok = speak(t); return ok; };
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) say(greet + ' Kya help chahiye?'); });
  panel.querySelector('.x').addEventListener('click', () => { panel.hidden = true; try { speechSynthesis.cancel(); } catch {} });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('.q'); if (!b) return;
    const item = QA[+b.dataset.i];
    panel.querySelector('#sz-ans').innerHTML = `<div class="a">${item.a}</div>` + (item.go ? `<a href="${href(item.go)}" style="color:#fff;font-weight:700">Kholiye →</a>` : '');
    say(item.a);
  });
  document.body.appendChild(btn); document.body.appendChild(panel);
}
