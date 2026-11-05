// Whack-a-Mole: 30 seconds, tap the moles as they pop up. Score = moles whacked.
export const HELP = '30 second. Mole dikhe to tap karo. Ek baar me jitne ho sako.';
export function mount(stage, api) {
  const grid = document.createElement('div'); grid.className = 'wm-grid'; stage.appendChild(grid);
  const bar = document.createElement('div'); bar.className = 'wm-time'; bar.innerHTML = '<i></i>'; stage.appendChild(bar);
  const holes = []; for (let i = 0; i < 9; i++) { const h = document.createElement('button'); h.type = 'button'; h.className = 'wm-hole'; h.setAttribute('aria-label', 'Hole ' + (i + 1)); h.innerHTML = '<span class="wm-dirt"></span><span class="wm-mole">🐹</span><span class="wm-hit">+1</span>'; grid.appendChild(h); holes.push(h); }
  let score = 0, left = 30000, last = performance.now(), up = null, timers = [], raf = 0, done = false;
  api.score(0);
  const popOne = () => {
    if (done) return; const idx = Math.floor(Math.random() * 9); const h = holes[idx];
    if (h.classList.contains('up')) return;
    h.classList.add('up'); h.dataset.live = '1';
    timers.push(setTimeout(() => { h.classList.remove('up'); h.dataset.live = ''; }, 700 + Math.random() * 500));
  };
  holes.forEach((h) => h.onpointerdown = (e) => {
    e.preventDefault(); if (done || h.dataset.live !== '1') return;
    h.dataset.live = ''; h.classList.remove('up'); h.classList.add('hit'); setTimeout(() => h.classList.remove('hit'), 220);
    score++; api.score(score);
  });
  const spawner = setInterval(() => { popOne(); if (Math.random() < 0.5) popOne(); }, 380);
  const tick = (now) => {
    if (done) return; left -= now - last; last = now;
    bar.firstChild.style.transform = `scaleX(${Math.max(0, left / 30000)})`;
    if (left <= 0) { done = true; clearInterval(spawner); api.over(score); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { destroy() { done = true; clearInterval(spawner); cancelAnimationFrame(raf); timers.forEach(clearTimeout); } };
}
