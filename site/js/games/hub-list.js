// The games hub list. Add a game here (one object) and it gets a tile on games.html.
// kind: 'prize' = Tap Rush (server-validated, weekly coin prizes; page game.html)
//       'free'  = score-only mini game (no prizes, no coins; page play.html?g=<id>, module js/arcade/<id>.js)
//       'soon'  = placeholder tile, not clickable
export const GAMES = [
  { id: 'tap-rush', kind: 'prize', title: 'Tap Rush', line: 'Neon tap game. Har hafte pehle 3 winners ko 30 / 20 / 10 coins.', href: 'game.html', icon: 'assets/games/tap-rush.svg', tone: ['#7C3AED', '#06B6D4'], tag: 'Weekly prize' },
  { id: 'memory', kind: 'free', title: 'Memory Match', line: 'Pair dhoondo. Kam moves me sabhi cards khol do.', icon_emoji: '🧠', tone: ['#EC4899', '#7C3AED'], tag: 'Free' },
  { id: '2048', kind: 'free', title: '2048', line: 'Tiles merge karo, 2048 tak pahuncho.', icon_emoji: '🔢', tone: ['#F97316', '#EAB308'], tag: 'Free' },
  { id: 'snake', kind: 'free', title: 'Neon Snake', line: 'Khana khao, lamba ho jao. Deewar aur apni hi poonch se bacho.', icon_emoji: '🐍', tone: ['#22C55E', '#06B6D4'], tag: 'Free' },
  { id: 'sky-hop', kind: 'free', title: 'Sky Hop', line: 'Tap karke udo, pipes ke beech se nikalo.', icon_emoji: '🪽', tone: ['#0EA5E9', '#6366F1'], tag: 'Free' },
  { id: 'whack', kind: 'free', title: 'Whack-a-Mole', line: '30 second me jitne mole maar sako.', icon_emoji: '🔨', tone: ['#A855F7', '#F43F5E'], tag: 'Free' },
  { id: 'soon', kind: 'soon', title: 'Coming soon', line: 'Naya game jald aayega. Ruko.', icon_emoji: '✨', tone: ['#334155', '#1e293b'], tag: 'Soon' },
];
