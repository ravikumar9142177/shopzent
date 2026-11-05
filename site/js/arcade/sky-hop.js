// Sky Hop: tap or press space to flap. Fly through the gaps. Score = pipes passed.
export const HELP = 'Screen par tap karo ya space dabao, udte raho aur pipes ke beech se nikalo.';
export function mount(stage, api) {
  const W = 320, H = 480; const cv = document.createElement('canvas'); cv.className = 'arc-canvas fl'; stage.appendChild(cv);
  const size = Math.min(stage.clientWidth || 340, 360); cv.style.width = size + 'px'; cv.style.height = Math.round(size * H / W) + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let bird = { y: H / 2, v: 0 }, pipes = [], score = 0, started = false, over = false, frame = 0, raf = 0, stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.2 + Math.random() * 0.8 }));
  const flap = () => { if (over) return; started = true; bird.v = -6.4; };
  const down = (e) => { e.preventDefault(); flap(); };
  cv.addEventListener('pointerdown', down);
  const kd = (e) => { if (e.code === 'Space' || e.key === 'ArrowUp') { e.preventDefault(); flap(); } };
  document.addEventListener('keydown', kd);
  const gap = () => Math.max(120, 150 - Math.floor(score / 5) * 4);
  const draw = () => {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1e1b4b'); g.addColorStop(0.6, '#4c1d95'); g.addColorStop(1, '#be185d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; stars.forEach((s) => { s.x -= s.z * 0.4; if (s.x < 0) s.x = W; ctx.globalAlpha = 0.3 + s.z * 0.5; ctx.fillRect(s.x, s.y, 1.5 * s.z, 1.5 * s.z); }); ctx.globalAlpha = 1;
    pipes.forEach((p) => {
      ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 12; ctx.fillStyle = '#0f766e';
      ctx.fillRect(p.x, 0, 52, p.top); ctx.fillRect(p.x, p.top + p.gap, 52, H - p.top - p.gap);
      ctx.fillStyle = '#5eead4'; ctx.fillRect(p.x - 3, p.top - 14, 58, 14); ctx.fillRect(p.x - 3, p.top + p.gap, 58, 14); ctx.shadowBlur = 0;
    });
    ctx.save(); ctx.translate(70, bird.y); ctx.rotate(Math.max(-0.5, Math.min(1.1, bird.v * 0.08)));
    ctx.shadowColor = '#fde047'; ctx.shadowBlur = 16; ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 14, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-26, -6); ctx.lineTo(-26, 6); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(6, -4, 3, 0, 6.283); ctx.fill(); ctx.restore(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = '700 34px Poppins, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(score), W / 2, 56);
    if (!started && !over) { ctx.font = '600 18px Poppins, Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('Tap to start', W / 2, H / 2 + 60); }
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (started && !over) {
      frame++; bird.v += 0.34; bird.y += bird.v;
      if (frame % 96 === 1) { const top = 60 + Math.random() * (H - 180 - gap()); pipes.push({ x: W + 10, top, gap: gap(), passed: false }); }
      pipes.forEach((p) => { p.x -= 2.2 + Math.min(1.6, score * 0.05); });
      pipes = pipes.filter((p) => p.x > -70);
      for (const p of pipes) {
        if (!p.passed && p.x + 52 < 70) { p.passed = true; score++; api.score(score); }
        if (70 + 14 > p.x && 70 - 14 < p.x + 52 && (bird.y - 12 < p.top || bird.y + 12 > p.top + p.gap)) { over = true; }
      }
      if (bird.y > H - 14 || bird.y < 0) over = true;
      if (over) { cancelAnimationFrame(raf); draw(); api.over(score); return; }
    }
    draw();
  };
  loop();
  return { destroy() { cancelAnimationFrame(raf); document.removeEventListener('keydown', kd); cv.removeEventListener('pointerdown', down); } };
}
