// Memory Match: find all pairs. Score = 1000 minus 20 per move (never below 100). Free game, score only.
export const HELP = 'Card palto, do ek jaise cards milao. Kam moves = zyada score.';
const SETS = ['🍎', '🚀', '🎧', '🌵', '🦊', '💎', '🎲', '🪐'];
export function mount(stage, api) {
  const deck = [...SETS, ...SETS].sort(() => Math.random() - 0.5);
  const wrap = document.createElement('div'); wrap.className = 'mm-grid';
  stage.appendChild(wrap);
  let open = [], lock = false, moves = 0, matched = 0, timers = [];
  api.score(1000);
  deck.forEach((sym, i) => {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'mm-card'; c.setAttribute('aria-label', 'Card ' + (i + 1));
    c.innerHTML = `<span class="mm-in"><span class="mm-face mm-back"></span><span class="mm-face mm-front">${sym}</span></span>`;
    c.dataset.sym = sym;
    c.onclick = () => {
      if (lock || c.classList.contains('open') || c.classList.contains('done')) return;
      c.classList.add('open'); open.push(c);
      if (open.length === 2) {
        moves++; api.score(Math.max(100, 1000 - moves * 20)); lock = true;
        const [a, b] = open;
        if (a.dataset.sym === b.dataset.sym) {
          timers.push(setTimeout(() => { a.classList.add('done'); b.classList.add('done'); matched++; open = []; lock = false;
            if (matched === SETS.length) api.over(Math.max(100, 1000 - moves * 20)); }, 420));
        } else {
          timers.push(setTimeout(() => { a.classList.remove('open'); b.classList.remove('open'); open = []; lock = false; }, 800));
        }
      }
    };
    wrap.appendChild(c);
  });
  return { destroy() { timers.forEach(clearTimeout); } };
}
