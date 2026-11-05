// Neon Snake: eat the glowing food, grow, do not hit the wall or yourself. Score = food eaten. Speed rises slowly.
export const HELP = 'Swipe karke ya neeche ke buttons se disha badlo. Ek baar me ek hi turn.';
export function mount(stage, api) {
  const G = 18; const cv = document.createElement('canvas'); cv.className = 'arc-canvas'; stage.appendChild(cv);
  const ctx = cv.getContext('2d'); const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.min(stage.clientWidth || 340, 360); cv.style.width = size + 'px'; cv.style.height = size + 'px'; cv.width = size * dpr; cv.height = size * dpr; ctx.setTransform(dpr * size / G / 1, 0, 0, dpr * size / G / 1, 0, 0);
  const pad = document.createElement('div'); pad.className = 'snk-pad';
  pad.innerHTML = '<span></span><button type="button" data-d="0,-1" aria-label="Up">▲</button><span></span><button type="button" data-d="-1,0" aria-label="Left">◀</button><span></span><button type="button" data-d="1,0" aria-label="Right">▶</button><span></span><button type="button" data-d="0,1" aria-label="Down">▼</button><span></span>';
  stage.appendChild(pad);
  let snake = [{ x: 9, y: 9 }, { x: 8, y: 9 }, { x: 7, y: 9 }], dir = { x: 1, y: 0 }, nextDir = dir, food = null, score = 0, dead = false, tick = 0, timer = null, speed = 140, t0 = performance.now();
  const place = () => { for (;;) { const f = { x: Math.floor(Math.random() * G), y: Math.floor(Math.random() * G) }; if (!snake.some((s) => s.x === f.x && s.y === f.y)) { food = f; return; } } };
  let started = false;
  const setDir = (x, y) => { if (x === -dir.x && y === -dir.y) return; nextDir = { x, y }; if (!started && !dead) { started = true; clearInterval(timer); timer = setInterval(step, speed); } };
  pad.onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; const [x, y] = b.dataset.d.split(',').map(Number); setDir(x, y); hint.remove(); };
  let sx = 0, sy = 0;
  const ts = (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
  const te = (e) => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return; Math.abs(dx) > Math.abs(dy) ? setDir(dx > 0 ? 1 : -1, 0) : setDir(0, dy > 0 ? 1 : -1); };
  cv.addEventListener('touchstart', ts, { passive: true }); cv.addEventListener('touchend', te);
  const kd = (e) => { const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]; if (m) { e.preventDefault(); setDir(m[0], m[1]); } };
  document.addEventListener('keydown', kd);
  const draw = () => {
    ctx.fillStyle = '#0d0820'; ctx.fillRect(0, 0, G, G);
    ctx.strokeStyle = 'rgba(167,139,250,.12)'; ctx.lineWidth = 0.05; for (let i = 0; i <= G; i++) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, G); ctx.moveTo(0, i); ctx.lineTo(G, i); ctx.stroke(); }
    const pulse = 0.6 + 0.4 * Math.sin((performance.now() - t0) / 180);
    if (food) { ctx.shadowColor = '#fde047'; ctx.shadowBlur = 12 * pulse; ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(food.x + 0.5, food.y + 0.5, 0.36 + 0.05 * pulse, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0; }
    snake.forEach((s, i) => { const k = 1 - i / (snake.length + 6); ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = i === 0 ? 14 : 4; ctx.fillStyle = i === 0 ? '#e0f7ff' : `rgba(34,211,238,${0.45 + 0.5 * k})`; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(s.x + 0.08, s.y + 0.08, 0.84, 0.84, 0.2) : ctx.rect(s.x + 0.08, s.y + 0.08, 0.84, 0.84); ctx.fill(); });
    ctx.shadowBlur = 0;
  };
  const step = () => {
    dir = nextDir;
    const h = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (h.x < 0 || h.y < 0 || h.x >= G || h.y >= G || snake.some((s) => s.x === h.x && s.y === h.y)) { dead = true; clearInterval(timer); draw(); api.over(score); return; }
    snake.unshift(h);
    if (food && h.x === food.x && h.y === food.y) { score++; api.score(score); place(); if (score % 4 === 0 && speed > 70) { speed -= 8; clearInterval(timer); timer = setInterval(() => { if (started) step(); }, speed); } }
    else snake.pop();
    draw();
  };
  place(); draw(); api.score(0);
  const hint = document.createElement('div'); hint.className = 'arc-tap'; hint.textContent = 'Disha chuno to khel shuru'; stage.appendChild(hint);
  draw(); timer = setInterval(() => { if (started) step(); }, speed);
  return { destroy() { clearInterval(timer); document.removeEventListener('keydown', kd); } };
}
