// Games hub (games.html) and the free mini-game host (play.html?g=<id>). Tap Rush keeps its own page (game.html).
import { $, esc } from '../util.js';
import { GAMES } from '../games/hub-list.js';
import { href } from '../layout.js';

const bestKey = (id) => 'sz_arc_best_' + id;
const getBest = (id) => Number(localStorage.getItem(bestKey(id))) || 0;
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function tile(g) {
  const tone = `--c1:${g.tone[0]};--c2:${g.tone[1]}`;
  const art = g.icon
    ? `<img class="ht-img" src="${href(g.icon)}" alt="" width="96" height="96" loading="lazy" decoding="async">`
    : `<span class="ht-emoji" aria-hidden="true">${esc(g.icon_emoji || '🎮')}</span>`;
  const inner = `<span class="ht-art" style="${tone}">${art}<span class="ht-shine" aria-hidden="true"></span></span>
    <span class="ht-body"><span class="ht-tag ${g.kind === 'prize' ? 'prize' : ''}">${esc(g.tag)}</span>
    <b class="ht-title">${esc(g.title)}</b><span class="ht-line">${esc(g.line)}</span>
    ${g.kind === 'free' && getBest(g.id) ? `<span class="ht-best">Best ${fmt(getBest(g.id))}</span>` : ''}
    <span class="ht-play">${g.kind === 'soon' ? 'Jald aayega' : 'Play →'}</span></span>`;
  if (g.kind === 'soon') return `<div class="hub-tile soon" aria-disabled="true">${inner}</div>`;
  const to = g.kind === 'prize' ? href(g.href) : href('play.html?g=' + encodeURIComponent(g.id));
  return `<a class="hub-tile" href="${to}" aria-label="${esc(g.title)} — play">${inner}</a>`;
}

export async function gamesHub() {
  $('#main').innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Games</div><h1>Games</h1><p class="small muted">Game chuno, khelo. Sab games free hain.</p></div></div>
    <div class="container hub-wrap"><div class="hub-grid" id="hub-grid">${GAMES.map(tile).join('')}</div>
    <p class="tiny muted hub-note">Tap Rush ke weekly prize ke rules game page par dekhein. Free games me sirf score hota hai, koi inaam ya coins nahi.</p></div>`;
}

export async function arcadePage() {
  const id = new URLSearchParams(location.search).get('g');
  const g = GAMES.find((x) => x.id === id && x.kind === 'free');
  const host = $('#main');
  if (!g) { host.innerHTML = `<div class="container" style="padding:24px 0"><div class="alert warn">Ye game nahi mila.</div><p><a href="${href('games.html')}">← Games par wapas jayein</a></p></div>`; return; }
  const mod = await import(`../arcade/${g.id}.js`);
  host.innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / <a href="games.html">Games</a> / ${esc(g.title)}</div><h1>${esc(g.title)}</h1></div></div>
    <div class="container arc-wrap">
      <div class="arc-hud"><div><span>Score</span><b id="arc-score">0</b></div><div><span>Best</span><b id="arc-best">${fmt(getBest(g.id))}</b></div><button class="btn sm sec" type="button" id="arc-restart">Phir se</button></div>
      <div class="arc-stage" id="arc-stage"></div>
      <p class="tiny muted arc-help">${esc(mod.HELP || '')}</p>
      <p class="tiny"><a href="${href('games.html')}">← Saare games</a></p>
    </div>`;
  const stage = $('#arc-stage');
  let cur = null;
  const api = {
    score(n) { $('#arc-score').textContent = fmt(n); },
    over(n) {
      const score = Math.max(0, Math.floor(Number(n) || 0));
      const prev = getBest(g.id); const isBest = score > prev;
      if (isBest) localStorage.setItem(bestKey(g.id), String(score));
      $('#arc-best').textContent = fmt(Math.max(prev, score));
      const ov = document.createElement('div'); ov.className = 'arc-over'; ov.setAttribute('role', 'dialog');
      ov.innerHTML = `<div class="arc-over-card"><div class="arc-over-k">Game over</div><div class="arc-over-score">${fmt(score)}</div>${isBest ? '<div class="arc-newbest">🏆 Naya best!</div>' : `<div class="tiny muted">Best ${fmt(Math.max(prev, score))}</div>`}<button class="btn" type="button" id="arc-again">Phir khelo</button></div>`;
      stage.appendChild(ov); ov.querySelector('#arc-again').onclick = () => start();
      requestAnimationFrame(() => ov.classList.add('show'));
    },
    best: () => getBest(g.id),
  };
  const start = () => {
    if (cur && cur.destroy) cur.destroy();
    stage.innerHTML = ''; $('#arc-score').textContent = '0';
    cur = mod.mount(stage, api) || null;
  };
  $('#arc-restart').onclick = start;
  window.addEventListener('pagehide', () => cur && cur.destroy && cur.destroy(), { once: true });
  start();
}
