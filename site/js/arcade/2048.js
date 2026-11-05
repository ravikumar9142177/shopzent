// 2048: slide and merge tiles with arrow keys, swipes or the buttons. Score = sum of merged tiles.
export const HELP = 'Swipe karo ya arrow buttons dabao. Do same number merge hote hain.';
export function mount(stage, api) {
  const N = 4; let b = Array.from({ length: N }, () => Array(N).fill(0)); let score = 0;
  const grid = document.createElement('div'); grid.className = 'g2048';
  const pad = document.createElement('div'); pad.className = 'g2048-pad';
  pad.innerHTML = '<button type="button" data-d="u" aria-label="Up">▲</button><div><button type="button" data-d="l" aria-label="Left">◀</button><button type="button" data-d="d" aria-label="Down">▼</button><button type="button" data-d="r" aria-label="Right">▶</button></div>';
  stage.append(grid, pad);
  const add = () => { const e = []; b.forEach((r, y) => r.forEach((v, x) => { if (!v) e.push([y, x]); })); if (!e.length) return; const [y, x] = e[Math.floor(Math.random() * e.length)]; b[y][x] = Math.random() < 0.9 ? 2 : 4; };
  const slide = (row) => { const v = row.filter(Boolean); let gain = 0; for (let i = 0; i < v.length - 1; i++) if (v[i] === v[i + 1]) { v[i] *= 2; gain += v[i]; v.splice(i + 1, 1); } while (v.length < N) v.push(0); return { row: v, gain }; };
  const move = (d) => {
    const before = JSON.stringify(b); let gained = 0;
    for (let i = 0; i < N; i++) {
      let line = [];
      for (let j = 0; j < N; j++) line.push(d === 'l' ? b[i][j] : d === 'r' ? b[i][N - 1 - j] : d === 'u' ? b[j][i] : b[N - 1 - j][i]);
      const r = slide(line); gained += r.gain;
      for (let j = 0; j < N; j++) { const v = r.row[j]; if (d === 'l') b[i][j] = v; else if (d === 'r') b[i][N - 1 - j] = v; else if (d === 'u') b[j][i] = v; else b[N - 1 - j][i] = v; }
    }
    if (JSON.stringify(b) === before) return;
    score += gained; api.score(score); add(); draw();
    if (!canMove()) api.over(score);
  };
  const canMove = () => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (!b[y][x]) return true; if (x + 1 < N && b[y][x] === b[y][x + 1]) return true; if (y + 1 < N && b[y][x] === b[y + 1][x]) return true; } return false; };
  const draw = () => { grid.innerHTML = ''; b.flat().forEach((v) => { const t = document.createElement('div'); t.className = 't t' + (v ? Math.min(v, 2048) : 0); t.textContent = v || ''; grid.appendChild(t); }); };
  pad.onclick = (e) => { const d = e.target.closest('[data-d]'); if (d) move(d.dataset.d); };
  let sx = 0, sy = 0;
  const kd = (e) => { const m = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r' }[e.key]; if (m) { e.preventDefault(); move(m); } };
  grid.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  grid.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u')); });
  document.addEventListener('keydown', kd);
  add(); add(); api.score(0); draw();
  return { destroy() { document.removeEventListener('keydown', kd); } };
}
