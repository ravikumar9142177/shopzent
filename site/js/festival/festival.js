// SHOPZENT Festival Studio: festival decoration, greeting, offer strip and a short festival tune. Plain DOM + canvas + CSS
// + WebAudio. No libraries, no external assets, no inline script. Loaded lazily (layout.js) only while a festival is on and
// inside its window, and by the Admin preview. Look = festival x variant (decor x palette x motion), all from this data.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Palettes: [accent, second, third]
export const PALETTES = {
  'gold-red': ['#f59e0b', '#ef4444', '#7c2d12'], 'maroon-gold': ['#fbbf24', '#9f1239', '#451a03'], 'saffron-yellow': ['#f97316', '#facc15', '#92400e'],
  'pink-gold': ['#ec4899', '#fbbf24', '#831843'], 'emerald-gold': ['#059669', '#facc15', '#0f766e'], 'violet-gold': ['#7c3aed', '#facc15', '#4c1d95'],
  'red-green': ['#dc2626', '#16a34a', '#facc15'], 'tricolour': ['#ff9933', '#138808', '#000080'], 'holi-multi': ['#ec4899', '#22c55e', '#3b82f6'],
  'sky-saffron': ['#38bdf8', '#fb923c', '#fde047'], 'indigo-silver': ['#312e81', '#c0c0c0', '#0ea5e9'], 'green-gold': ['#16a34a', '#eab308', '#14532d'],
  'black-gold': ['#111827', '#f5c542', '#7a5b00'], 'blue-gold': ['#2563eb', '#fbbf24', '#1e3a8a'], 'pastel': ['#f9a8d4', '#fde68a', '#a7f3d0'],
};

// Festivals: decor (band art), pal (palettes), fx (canvas motion), tune (WebAudio jingle). Looks = decor x pal x fx, first 10.
export const FESTIVALS = [
  { id: 'diwali', name: 'Diwali', icon: '🪔', title: 'Happy Diwali', greeting: 'Shubh Deepawali 🪔 Roshni, mithai aur naye offers.', decor: ['lamps', 'fire', 'sparkle'], pal: ['gold-red', 'maroon-gold', 'saffron-yellow'], fx: ['sparks', 'stars'], tune: { root: 293.66, scale: 'maj', bpm: 132, timbre: 'crackers' } },
  { id: 'dhanteras', name: 'Dhanteras', icon: '🪙', title: 'Shubh Dhanteras', greeting: 'Dhan aur barkat ke saath naye offers 🪙', decor: ['fire', 'gifts', 'sparkle'], pal: ['gold-red', 'emerald-gold', 'saffron-yellow'], fx: ['sparks', 'stars'], tune: { root: 261.63, scale: 'maj', bpm: 120, timbre: 'bell' } },
  { id: 'bhai-dooj', name: 'Bhai Dooj', icon: '🌼', title: 'Happy Bhai Dooj', greeting: 'Bhai-behen ka pyaar 🌼 Gift ke liye best offers.', decor: ['flowers', 'lamps', 'hearts'], pal: ['pink-gold', 'saffron-yellow', 'pastel'], fx: ['petals', 'stars'], tune: { root: 329.63, scale: 'pent', bpm: 116, timbre: 'pluck' } },
  { id: 'chhath', name: 'Chhath Puja', icon: '🌅', title: 'Chhath Puja ki hardik shubhkamnayein', greeting: 'Chhath Maiya ki kripa bani rahe 🙏 Diye, sup aur phal.', decor: ['sup', 'lamps', 'sun'], pal: ['saffron-yellow', 'sky-saffron', 'gold-red'], fx: ['stars', 'petals'], tune: { root: 293.66, scale: 'pent', bpm: 84, timbre: 'harmonium' } },
  { id: 'dussehra', name: 'Dussehra', icon: '🏹', title: 'Vijayadashami ki shubhkamnayein', greeting: 'Burai par achhai ki jeet 🏹 Dussehra ke special offers.', decor: ['arrows', 'fire', 'drum'], pal: ['maroon-gold', 'red-green', 'saffron-yellow'], fx: ['fireworks', 'sparks'], tune: { root: 220, scale: 'min', bpm: 128, timbre: 'dhol' } },
  { id: 'navratri', name: 'Navratri', icon: '🌺', title: 'Shubh Navratri', greeting: 'Jai Mata Di 🙏 Navratri ke special offers.', decor: ['garba', 'flowers', 'drum'], pal: ['pink-gold', 'violet-gold', 'holi-multi'], fx: ['petals', 'sparks'], tune: { root: 246.94, scale: 'min', bpm: 136, timbre: 'dhol' } },
  { id: 'durga-puja', name: 'Durga Puja', icon: '🪷', title: 'Shubh Durga Puja', greeting: 'Maa Durga ki kripa 🙏 Puja ke special offers.', decor: ['lotus', 'drum', 'flowers'], pal: ['maroon-gold', 'red-green', 'gold-red'], fx: ['petals', 'sparks'], tune: { root: 220, scale: 'min', bpm: 124, timbre: 'dhol' } },
  { id: 'karwa-chauth', name: 'Karwa Chauth', icon: '🌙', title: 'Happy Karwa Chauth', greeting: 'Chaand ke saath roshan din 🌙 Special offers.', decor: ['moon', 'stars', 'hearts'], pal: ['maroon-gold', 'gold-red', 'indigo-silver'], fx: ['stars', 'petals'], tune: { root: 277.18, scale: 'min', bpm: 100, timbre: 'bell' } },
  { id: 'holi', name: 'Holi', icon: '🎨', title: 'Happy Holi', greeting: 'Rang barse 🎨 Holi ke special offers.', decor: ['holi', 'flowers', 'party'], pal: ['holi-multi', 'pink-gold', 'blue-gold'], fx: ['powder', 'confetti'], tune: { root: 293.66, scale: 'pent', bpm: 140, timbre: 'dhol' } },
  { id: 'eid-ul-fitr', name: 'Eid-ul-Fitr', icon: '🌙', title: 'Eid Mubarak', greeting: 'Eid Mubarak 🌙 Khushiyon bhari Eid, special offers ke saath.', decor: ['moon', 'stars', 'sparkle'], pal: ['emerald-gold', 'green-gold', 'pastel'], fx: ['stars', 'petals'], tune: { root: 329.63, scale: 'min', bpm: 104, timbre: 'bell' } },
  { id: 'eid-ul-adha', name: 'Eid-ul-Adha (Bakrid)', icon: '🌙', title: 'Eid-ul-Adha Mubarak', greeting: 'Eid-ul-Adha Mubarak 🌙 Special offers.', decor: ['moon', 'sparkle', 'stars'], pal: ['emerald-gold', 'green-gold', 'indigo-silver'], fx: ['stars', 'petals'], tune: { root: 311.13, scale: 'min', bpm: 100, timbre: 'bell' } },
  { id: 'christmas', name: 'Christmas', icon: '🎄', title: 'Merry Christmas', greeting: 'Merry Christmas 🎄 Gift ke liye best deals.', decor: ['garland', 'tree', 'snowflake'], pal: ['red-green', 'green-gold', 'indigo-silver'], fx: ['snow', 'stars'], tune: { root: 261.63, scale: 'maj', bpm: 128, timbre: 'bell' } },
  { id: 'new-year', name: 'New Year', icon: '🎆', title: 'Happy New Year', greeting: 'Naya saal, nayi shuruaat 🎆 Saal ke best deals.', decor: ['newyear', 'party', 'sparkle'], pal: ['violet-gold', 'black-gold', 'pink-gold'], fx: ['fireworks', 'confetti'], tune: { root: 261.63, scale: 'maj', bpm: 138, timbre: 'pluck' } },
  { id: 'republic-day', name: 'Republic Day', icon: '🇮🇳', title: 'Jai Hind 🇮🇳', greeting: 'Gantantra Diwas ki shubhkamnayein. Desh ke naam, special offers.', decor: ['tricolour', 'flags', 'sparkle'], pal: ['tricolour', 'sky-saffron', 'blue-gold'], fx: ['confetti', 'stars'], tune: { root: 293.66, scale: 'maj', bpm: 118, timbre: 'bell' } },
  { id: 'independence-day', name: 'Independence Day', icon: '🇮🇳', title: 'Happy Independence Day', greeting: 'Azadi ki shubhkamnayein 🇮🇳 Jai Hind.', decor: ['tricolour', 'kites', 'sparkle'], pal: ['tricolour', 'saffron-yellow', 'blue-gold'], fx: ['confetti', 'fireworks'], tune: { root: 293.66, scale: 'maj', bpm: 120, timbre: 'bell' } },
  { id: 'raksha-bandhan', name: 'Raksha Bandhan', icon: '🎀', title: 'Happy Raksha Bandhan', greeting: 'Bhai-behen ka pyaar 🎀 Gift ke liye best offers.', decor: ['threads', 'gifts', 'hearts'], pal: ['pink-gold', 'violet-gold', 'red-green'], fx: ['stars', 'sparks'], tune: { root: 349.23, scale: 'pent', bpm: 114, timbre: 'pluck' } },
  { id: 'ganesh-chaturthi', name: 'Ganesh Chaturthi', icon: '🌼', title: 'Ganpati Bappa Morya', greeting: 'Ganpati Bappa Morya 🙏 Utsav ke special offers.', decor: ['marigold', 'lotus', 'bells'], pal: ['saffron-yellow', 'maroon-gold', 'gold-red'], fx: ['petals', 'sparks'], tune: { root: 261.63, scale: 'pent', bpm: 124, timbre: 'bell' } },
  { id: 'janmashtami', name: 'Janmashtami', icon: '🦚', title: 'Happy Janmashtami', greeting: 'Krishna Janmashtami ki shubhkamnayein 🦚 Special offers.', decor: ['flutes', 'bells', 'flowers'], pal: ['blue-gold', 'green-gold', 'indigo-silver'], fx: ['stars', 'petals'], tune: { root: 246.94, scale: 'pent', bpm: 110, timbre: 'pluck' } },
  { id: 'makar-sankranti', name: 'Makar Sankranti', icon: '🪁', title: 'Makar Sankranti ki shubhkamnayein', greeting: 'Patang udao 🪁 Til-gud aur special offers.', decor: ['kites', 'sun', 'wheat'], pal: ['sky-saffron', 'saffron-yellow', 'green-gold'], fx: ['sparks', 'confetti'], tune: { root: 293.66, scale: 'maj', bpm: 136, timbre: 'pluck' } },
  { id: 'lohri', name: 'Lohri', icon: '🔥', title: 'Happy Lohri', greeting: 'Lohri di lakh lakh vadhaiyan 🔥 Special offers.', decor: ['fire', 'wheat', 'drum'], pal: ['saffron-yellow', 'gold-red', 'red-green'], fx: ['sparks', 'petals'], tune: { root: 246.94, scale: 'pent', bpm: 140, timbre: 'dhol' } },
  { id: 'pongal', name: 'Pongal', icon: '🌾', title: 'Pongal Vazthukal', greeting: 'Pongal ki vadhaiyan 🌾 Special offers.', decor: ['sun', 'wheat', 'flowers'], pal: ['saffron-yellow', 'green-gold', 'sky-saffron'], fx: ['petals', 'sparks'], tune: { root: 261.63, scale: 'pent', bpm: 130, timbre: 'pluck' } },
  { id: 'baisakhi', name: 'Baisakhi', icon: '🌾', title: 'Happy Baisakhi', greeting: 'Baisakhi di lakh lakh vadhaiyan 🌾 Special offers.', decor: ['wheat', 'drum', 'sparkle'], pal: ['tricolour', 'green-gold', 'saffron-yellow'], fx: ['petals', 'confetti'], tune: { root: 293.66, scale: 'pent', bpm: 142, timbre: 'dhol' } },
  { id: 'onam', name: 'Onam', icon: '🌸', title: 'Happy Onam', greeting: 'Onam ashamsakal 🌸 Pookalam aur special offers.', decor: ['flowers', 'coconut', 'leaves'], pal: ['green-gold', 'pastel', 'pink-gold'], fx: ['petals', 'stars'], tune: { root: 293.66, scale: 'maj', bpm: 112, timbre: 'pluck' } },
  { id: 'ram-navami', name: 'Ram Navami', icon: '🚩', title: 'Shri Ram Navami ki shubhkamnayein', greeting: 'Jai Shri Ram 🚩 Special offers.', decor: ['flags', 'lotus', 'bells'], pal: ['saffron-yellow', 'red-green', 'gold-red'], fx: ['sparks', 'stars'], tune: { root: 293.66, scale: 'maj', bpm: 112, timbre: 'bell' } },
  { id: 'maha-shivratri', name: 'Maha Shivratri', icon: '🔱', title: 'Har Har Mahadev', greeting: 'Om Namah Shivay 🔱 Special offers.', decor: ['trident', 'moon', 'bells'], pal: ['indigo-silver', 'blue-gold', 'black-gold'], fx: ['stars', 'sparks'], tune: { root: 220, scale: 'min', bpm: 96, timbre: 'bell' } },
  { id: 'guru-nanak-jayanti', name: 'Guru Nanak Jayanti', icon: '🕯️', title: 'Guru Nanak Jayanti di vadhaiyan', greeting: 'Waheguru ji ka khalsa 🙏 Special offers.', decor: ['lamps', 'flowers', 'sparkle'], pal: ['sky-saffron', 'blue-gold', 'saffron-yellow'], fx: ['stars', 'sparks'], tune: { root: 261.63, scale: 'maj', bpm: 100, timbre: 'bell' } },
  { id: 'hanuman-jayanti', name: 'Hanuman Jayanti', icon: '🚩', title: 'Jai Bajrangbali', greeting: 'Jai Bajrangbali 🚩 Special offers.', decor: ['flags', 'fire', 'drum'], pal: ['red-green', 'saffron-yellow', 'maroon-gold'], fx: ['sparks', 'confetti'], tune: { root: 220, scale: 'min', bpm: 132, timbre: 'dhol' } },
  { id: 'vasant-panchami', name: 'Vasant Panchami', icon: '🌼', title: 'Vasant Panchami ki shubhkamnayein', greeting: 'Basant aayi 🌼 Special offers.', decor: ['flowers', 'sun', 'leaves'], pal: ['saffron-yellow', 'pastel', 'green-gold'], fx: ['petals', 'stars'], tune: { root: 329.63, scale: 'pent', bpm: 112, timbre: 'pluck' } },
  { id: 'teej', name: 'Teej', icon: '💚', title: 'Happy Teej', greeting: 'Teej ki shubhkamnayein 💚 Special offers.', decor: ['flowers', 'hearts', 'leaves'], pal: ['green-gold', 'pink-gold', 'red-green'], fx: ['petals', 'stars'], tune: { root: 293.66, scale: 'pent', bpm: 116, timbre: 'pluck' } },
  { id: 'ugadi', name: 'Ugadi / Gudi Padwa', icon: '🌿', title: 'Ugadi aur Gudi Padwa ki shubhkamnayein', greeting: 'Naya varsh, nayi shuruaat 🌿 Special offers.', decor: ['flowers', 'leaves', 'sparkle'], pal: ['green-gold', 'saffron-yellow', 'violet-gold'], fx: ['petals', 'confetti'], tune: { root: 261.63, scale: 'maj', bpm: 120, timbre: 'bell' } },
  { id: 'sale', name: 'Sale', icon: '🏷️', title: 'Mega Sale', greeting: 'Best prices, limited time 🏷️', decor: ['ribbon', 'party', 'sparkle'], pal: ['violet-gold', 'black-gold', 'saffron-yellow'], fx: ['confetti', 'sparks'], tune: { root: 329.63, scale: 'maj', bpm: 140, timbre: 'pluck' } },
  { id: 'none', name: 'Normal (no decoration)', icon: '✨', title: '', greeting: '', decor: [], pal: [], fx: [], tune: null },
];
export const festivalOf = (id) => FESTIVALS.find((f) => f.id === id) || FESTIVALS[FESTIVALS.length - 1];
// the looks of a festival: decor x palette x motion, first 10 (every festival has more than 10 combinations)
export function looksOf(id) {
  const F = festivalOf(id), out = [];
  for (const fx of F.fx) for (const d of F.decor) for (const p of F.pal) { if (out.length < 10) out.push({ decor: d, pal: p, fx: fx }); }
  return out;
}
// Window: 'off' | 'scheduled' | 'ended' | 'live' (dates are IST date-times stored with their offset).
export function festivalWindow(cfg, now = Date.now()) {
  if (!cfg || cfg.enabled !== true) return 'off';
  const a = cfg.starts_at ? Date.parse(cfg.starts_at) : 0, b = cfg.ends_at ? Date.parse(cfg.ends_at) : Infinity;
  if (now < a) return 'scheduled';
  if (now >= b) return 'ended';
  return 'live';
}

// "Type what you want": a keyword matcher, not a language model. Word-boundary keywords only.
const KEYS = [
  ['diwali', /\b(diwali|deepawali|deepavali|diya|diye)\b/i], ['chhath', /\b(chhath|chhat|chath|suryaarghya)\b/i], ['dhanteras', /\bdhanteras\b/i],
  ['bhai-dooj', /\bbhai ?dooj\b/i], ['dussehra', /\b(dussehra|dussera|vijayadashami)\b/i], ['navratri', /\b(navratri|navratra|garba)\b/i],
  ['durga-puja', /\b(durga puja|durga)\b/i], ['karwa-chauth', /\b(karwa ?chauth|karva ?chauth)\b/i], ['holi', /\b(holi|rang barse)\b/i],
  ['eid-ul-fitr', /\b(eid|eid ul fitr|eid-ul-fitr|ramzan|ramadan|ramzaan)\b/i], ['eid-ul-adha', /\b(bakrid|eid ul adha|eid-ul-adha)\b/i],
  ['christmas', /\b(christmas|xmas)\b/i], ['new-year', /\b(new year|newyear|naya saal|nya saal)\b/i], ['republic-day', /\b(republic day|26 jan|gantantra)\b/i],
  ['independence-day', /\b(independence|15 aug|azadi)\b/i], ['raksha-bandhan', /\b(rakhi|raksha bandhan|raksha)\b/i],
  ['ganesh-chaturthi', /\b(ganesh|ganpati)\b/i], ['janmashtami', /\b(janmashtami|krishna)\b/i], ['makar-sankranti', /\b(makar sankranti|sankranti|uttarayan)\b/i],
  ['lohri', /\blohri\b/i], ['pongal', /\bpongal\b/i], ['baisakhi', /\bbaisakhi\b/i], ['onam', /\bonam\b/i], ['ram-navami', /\bram navami\b/i],
  ['maha-shivratri', /\b(shivratri|mahashivratri|shiv ratri)\b/i], ['guru-nanak-jayanti', /\bguru nanak\b/i], ['hanuman-jayanti', /\bhanuman\b/i],
  ['vasant-panchami', /\b(vasant panchami|basant)\b/i], ['teej', /\bteej\b/i], ['ugadi', /\b(ugadi|gudi padwa)\b/i], ['sale', /\b(mega sale|sale)\b/i],
];
export function matchCommand(text) {
  const t = String(text || '').trim(); if (!t) return null;
  const out = {};
  const hit = KEYS.find(([, re]) => re.test(t));
  if (/\b(normal|band karo|reset|hatao|original|turn off|off karo)\b/i.test(t)) { out.festival = 'none'; out.enabled = false; }
  else if (hit) { out.festival = hit[0]; out.enabled = true; }
  const pct = t.match(/(\d{1,2})\s*%/);
  if (pct || /\b(offer|discount|bachat)\b/i.test(t)) out.offer = { pct: pct ? pct[1] : null };
  return Object.keys(out).length ? out : null;
}

// ---------- decoration art: CSS shapes or emoji sets (no images) ----------
const diya = (d = 0) => `<span class="fz-dya" style="animation-delay:${d}s"><i></i><b></b></span>`;
const EMOJI = { sparkle: ['✨', '⭐', '💫'], party: ['🎉', '🎊', '🎈'], fire: ['🪔', '🔥', '✨'], fireworks: ['🎆', '🎇', '✨'], gifts: ['🎁', '🎀', '🎁'], hearts: ['💗', '🎀', '💗'],
  kites: ['🪁', '🌞', '🪁'], flutes: ['🦚', '🪈', '🦚'], flowers: ['🌸', '🌺', '🌼'], bells: ['🔔', '✨', '🔔'], wheat: ['🌾', '🥁', '🌾'], drum: ['🥁', '🎶'], lotus: ['🪷', '🌸'],
  arrows: ['🏹', '🔥', '🏹'], coconut: ['🥥', '🌴', '🛶'], leaves: ['🍃', '🌿', '🍃'], flags: ['🚩', '🔱'], flagsIn: ['🇮🇳', '🚩'], sun: ['☀️', '🌤️'], snowflake: ['❄️', '⛄', '❄️'],
  tree: ['🎄', '⭐'], trident: ['🔱', '🕉️'], newyear: ['🎆', '✨', '🎉', '✨', '🎇'], holi: [], tricolour: [], garland: [], moon: [], stars: [], hearts2: [] };
const TRI = ['#ff9933', '#ffffff', '#138808'];
const DECOR = {
  lamps: () => Array.from({ length: 9 }, (_, k) => diya(-(k * 0.5).toFixed(1))).join(''),
  sup: () => `<span class="fz-sun"></span>${[0, 1, 2, 3].map((k) => diya(-k * 0.4)).join('')}<span class="fz-sup"><em>🍌</em><em>🥭</em><em>🍊</em><em>🍎</em></span>`,
  sun: () => `<span class="fz-sun"></span>${Array.from({ length: 8 }, (_, k) => `<em class="fz-pop" style="animation-delay:${(k * 0.25).toFixed(2)}s">${k % 2 ? '✦' : '☀️'}</em>`).join('')}`,
  holi: () => ['#ec4899', '#22c55e', '#3b82f6', '#facc15', '#f97316', '#a855f7'].map((c, k) => `<span class="fz-blob" style="left:${4 + k * 16}%;top:${k % 2 ? 2 : 8}px;background:${c}"></span>`).join(''),
  moon: () => `<span class="fz-moon"></span>${Array.from({ length: 9 }, (_, k) => `<em class="fz-star" style="left:${8 + k * 11}%;animation-delay:${(k * 0.35).toFixed(2)}s">✦</em>`).join('')}`,
  garland: () => `<span class="fz-wire"></span>${Array.from({ length: 16 }, (_, k) => `<span class="fz-bulb" style="background:${['#ef4444', '#facc15', '#22c55e', '#3b82f6'][k % 4]};animation-delay:${(k * 0.2).toFixed(1)}s"></span>`).join('')}`,
  tricolour: () => `<span class="fz-tri">${Array.from({ length: 14 }, (_, k) => `<i style="background:${TRI[k % 3]}"></i>`).join('')}</span>`,
  garba: () => Array.from({ length: 18 }, (_, k) => `<span class="fz-dot" style="background:${['#db2777', '#facc15', '#22c55e', '#f97316'][k % 4]};animation-delay:${(k * 0.12).toFixed(2)}s"></span>`).join(''),
  threads: () => `<svg class="fz-thread" viewBox="0 0 400 34" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9 Q50 26 100 9 T200 9 T300 9 T400 9" fill="none" stroke="#db2777" stroke-width="2.4"/><path d="M0 14 Q50 30 100 14 T200 14 T300 14 T400 14" fill="none" stroke="#facc15" stroke-width="2"/></svg>${Array.from({ length: 10 }, (_, k) => `<span class="fz-bead" style="left:${4 + k * 10}%;top:${k % 2 ? 12 : 4}px;background:${['#7c3aed', '#facc15', '#db2777', '#22c55e'][k % 4]}"></span>`).join('')}`,
  marigold: () => Array.from({ length: 10 }, (_, k) => `<em class="fz-swing" style="animation-delay:${(k * -0.4).toFixed(1)}s">🌼</em>`).join(''),
  ribbon: () => `<span class="fz-ribbon">SALE ✦ SALE ✦ SALE ✦ SALE ✦ SALE ✦ SALE</span>`,
};
// emoji decor: a row of the set's items, swinging
const emojiRow = (set) => (EMOJI[set] || []).length ? Array.from({ length: 10 }, (_, k) => `<em class="fz-swing" style="animation-delay:${(k * -0.45).toFixed(2)}s">${EMOJI[set][k % EMOJI[set].length]}</em>`).join('') : '';
const EMOJI_DECOR = { sparkle: 'sparkle', party: 'party', fire: 'fire', gifts: 'gifts', hearts: 'hearts', kites: 'kites', flutes: 'flutes', flowers: 'flowers', bells: 'bells', wheat: 'wheat', drum: 'drum', lotus: 'lotus', arrows: 'arrows', coconut: 'coconut', leaves: 'leaves', flags: 'flags', sun: 'sun', snowflake: 'snowflake', tree: 'tree', trident: 'trident', newyear: 'newyear' };
export function decorHtml(id) { if (DECOR[id]) return DECOR[id](); if (EMOJI_DECOR[id]) return emojiRow(EMOJI_DECOR[id]); return ''; }

// ---------- canvas motion: light particle sims, paused when the tab is hidden ----------
const COLS = { sparks: ['#fde68a', '#fbbf24', '#f97316', '#fff7ed'], powder: ['#ec4899', '#22c55e', '#3b82f6', '#facc15', '#f97316'], snow: ['#ffffff', '#e0f2fe'],
  petals: ['#f59e0b', '#fb923c', '#fde047', '#f472b6'], confetti: ['#ff9933', '#ffffff', '#138808', '#7c3aed', '#ec4899', '#facc15'], stars: ['#fff7d1', '#fde68a', '#ffffff'], fireworks: ['#fde68a', '#f472b6', '#60a5fa', '#34d399'] };
function runFx(canvas, kind, count) {
  const c = canvas.getContext('2d'); const P = []; const cols = COLS[kind] || ['#ffffff'];
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, nextBurst = 0, hidden = false;
  const size = () => { dpr = Math.min(1.5, window.devicePixelRatio || 1); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = Math.max(1, W * dpr); canvas.height = Math.max(1, H * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0); };
  const R = (a, b) => a + Math.random() * (b - a);
  const pick = () => cols[(Math.random() * cols.length) | 0];
  const burst = (x, y, n) => { for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, s = R(1.2, 3.2); P.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.035, r: R(1.2, 2.2), life: R(50, 80), t: 0, c: pick(), k: 'b' }); } };
  const spawn = (fromTop) => { P.push({ x: R(0, W), y: fromTop ? R(-H, 0) : R(0, H), vx: R(-0.3, 0.3), vy: R(0.35, 1.1), r: R(1.4, 3.6), rot: R(0, 6), vr: R(-0.05, 0.05), t: R(0, 100), c: pick(), k: 'f' }); };
  const init = () => {
    P.length = 0;
    if (kind === 'sparks' || kind === 'fireworks') { nextBurst = 0; return; }
    if (kind === 'stars') { for (let k = 0; k < count; k++) P.push({ x: R(0, W), y: R(0, H), r: R(0.8, 1.8), t: R(0, 6), c: pick(), k: 's' }); return; }
    for (let k = 0; k < count; k++) spawn(false);
  };
  const frame = (ts) => {
    raf = 0; if (hidden) return;
    // the canvas is sized when it first has a size (it is hidden until its stylesheet loads); a 1px canvas would stretch over the page
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) { const first = !W; size(); if (first && W) init(); }
    if (!W || !H) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(2.5, last ? (ts - last) / 16.67 : 1); last = ts;
    c.clearRect(0, 0, W, H);
    if ((kind === 'sparks' || kind === 'fireworks') && ts > nextBurst) { burst(R(W * 0.15, W * 0.85), R(H * 0.12, H * 0.55), 14 + ((Math.random() * 6) | 0)); nextBurst = ts + R(1400, 2600); }
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.k === 'b') { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.985; const a = Math.max(0, 1 - p.t / p.life); if (a <= 0) { P.splice(i, 1); continue; } c.globalAlpha = a; c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill(); }
      else if (p.k === 's') { p.t += 0.03 * dt; c.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(p.t)); c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill(); }
      else {
        p.y += p.vy * dt; p.x += (p.vx + Math.sin((p.t += 0.02 * dt)) * 0.35) * dt; p.rot = (p.rot || 0) + (p.vr || 0) * dt;
        if (p.y > H + 12) { P.splice(i, 1); spawn(true); continue; }
        c.globalAlpha = kind === 'powder' ? 0.55 : 0.85; c.fillStyle = p.c;
        if (kind === 'confetti') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-p.r, -p.r * 0.45, p.r * 2.2, p.r * 0.9); c.restore(); }
        else if (kind === 'petals') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.beginPath(); c.ellipse(0, 0, p.r * 1.6, p.r * 0.9, 0, 0, 6.283); c.fill(); c.restore(); }
        else { c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill(); }
      }
    }
    c.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  size(); if (W) init();
  const onVis = () => { hidden = document.hidden; if (!hidden && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(frame);
  return { resize() { const first = !W; size(); if (first && W) init(); }, stop() { cancelAnimationFrame(raf); raf = 0; document.removeEventListener('visibilitychange', onVis); } };
}

// ---------- festival tune: a short original jingle generated with WebAudio (no files, no samples) ----------
const SCALES = { maj: [0, 2, 4, 5, 7, 9, 11, 12], pent: [0, 2, 4, 7, 9, 12], min: [0, 2, 3, 5, 7, 8, 10, 12] };
let AC = null, TUNE_NODES = [];
function audio() { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; if (!AC) AC = new A(); if (AC.state === 'suspended') AC.resume().catch(() => {}); return AC; }
export function playTune(festivalId) {
  const F = festivalOf(festivalId); if (!F.tune) return false;
  const ctx = audio(); if (!ctx) return false;
  const { root, scale, bpm, timbre } = F.tune, sc = SCALES[scale] || SCALES.maj; const step = 60 / bpm / 2; const t0 = ctx.currentTime + 0.05;
  const master = ctx.createGain(); master.gain.value = 0.16; master.connect(ctx.destination); TUNE_NODES.push(master);
  let seed = 0; for (const ch of F.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  for (let i = 0; i < 16; i++) {
    const t = t0 + i * step;
    if (timbre === 'crackers' && rnd() < 0.45) { const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate), d = b.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / d.length, 3); const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = 0.5; s.connect(g).connect(master); s.start(t + rnd() * step * 0.5); }
    if (timbre === 'harmonium') { const deg = sc[Math.floor(rnd() * sc.length)]; const f = root * Math.pow(2, deg / 12); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 2.2); lp.connect(g).connect(master); [-6, 6].forEach((det) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + step * 2.4); }); if (i % 4 === 0) { const k = ctx.createOscillator(), kg = ctx.createGain(); k.frequency.setValueAtTime(120, t); k.frequency.exponentialRampToValueAtTime(55, t + 0.1); kg.gain.setValueAtTime(0.7, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.14); k.connect(kg).connect(master); k.start(t); k.stop(t + 0.16); } continue; }
    if (timbre === 'dhol') {
      if (i % 4 === 0 || i % 4 === 2) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); o.connect(g).connect(master); o.start(t); o.stop(t + 0.18); }
      if (i % 2 === 1) { const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate), d = b.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length); const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = 0.35; s.connect(g).connect(master); s.start(t); }
      continue;
    }
    const deg = sc[Math.floor(rnd() * sc.length)] + (i % 8 === 7 ? 12 : 0);
    const f = root * Math.pow(2, deg / 12);
    if (rnd() < 0.2 && i % 4 !== 0) continue; // a rest now and then, so it breathes
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = timbre === 'pluck' ? 'triangle' : 'sine'; o.frequency.setValueAtTime(f, t);
    const dur = timbre === 'pluck' ? 0.35 : 1.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
    if (timbre === 'bell') { const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.frequency.setValueAtTime(f * 2.76, t); g2.gain.setValueAtTime(0.25, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); o2.connect(g2).connect(master); o2.start(t); o2.stop(t + 0.55); }
  }
  setTimeout(() => { try { master.disconnect(); } catch (e) { /* */ } TUNE_NODES = TUNE_NODES.filter((n) => n !== master); }, 5200);
  return true;
}

// Custom tune: an admin-chosen audio file (https URL, royalty-free or rights held by the owner), played low on the first gesture.
let CUSTOM = null;
export function playFile(url) { try { if (CUSTOM) { CUSTOM.pause(); } CUSTOM = new Audio(url); CUSTOM.volume = 0.35; CUSTOM.preload = 'auto'; const p = CUSTOM.play(); if (p && p.catch) p.catch(() => {}); return true; } catch (e) { return false; } }
export function playAny(cfg) { return cfg.tune_url && /^https:\/\//.test(cfg.tune_url) ? playFile(cfg.tune_url) : playTune(cfg.theme); }

// ---------- mount ----------
let cssP = null;
// the stylesheet loads once; the band stays hidden until it has arrived (no unstyled flash, no layout shift)
function ensureCss() { if (cssP) return cssP; cssP = new Promise((res) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = (document.body?.dataset.root || '.') + '/css/festival.css'; l.dataset.fzCss = '1'; l.onload = res; l.onerror = res; document.head.appendChild(l); }); return cssP; }
const DISMISS_KEY = 'sz.fz.dismiss', MUTE_KEY = 'sz.fz.mute', TUNED_KEY = 'sz.fz.tuned';
// cfg: the festival setting. opts: { container } = admin preview (no fixed placement, no dismiss, no tune), { noStrip } for checkout-style pages.
export function mountFestival(cfg, opts = {}) {
  const F = festivalOf(cfg.theme); const looks = looksOf(F.id); const L = looks[(Number(cfg.variant) || 0) % Math.max(1, looks.length)] || { decor: '', pal: 'gold-red', fx: 'none' };
  const pal = PALETTES[L.pal] || PALETTES['gold-red'];
  const preview = !!opts.container;
  const inten = cfg.intensity === 'low' ? 0.45 : cfg.intensity === 'high' ? 1.8 : 1;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const accent = /^#[0-9a-f]{6}$/i.test(cfg.accent || '') ? cfg.accent : pal[0];
  const root = preview ? opts.container : document.body;
  const wrap = document.createElement('div');
  wrap.className = 'fz' + (preview ? ' fz-prev' : '') + (reduce ? ' fz-rm' : '') + (cfg.intensity === 'high' ? ' fz-hi' : '');
  wrap.style.setProperty('--fz-a', accent); wrap.style.setProperty('--fz-b1', pal[1]); wrap.style.setProperty('--fz-b2', pal[2]);
  const muted = !preview && localStorage.getItem(MUTE_KEY) === '1';
  const tuneOn = !preview && cfg.tune !== false && (!!F.tune || !!cfg.tune_url);
  wrap.innerHTML = `<div class="fz-band" aria-hidden="true">${decorHtml(L.decor)}</div>`;
  let fx = null;
  if (L.fx && L.fx !== 'none' && !reduce) {
    const cv = document.createElement('canvas'); cv.className = 'fz-canvas'; cv.setAttribute('aria-hidden', 'true'); wrap.insertBefore(cv, wrap.firstChild);
    const base = { sparks: 16, powder: 26, snow: 34, petals: 16, confetti: 24, stars: 22, fireworks: 0 }[L.fx] || 12;
    fx = runFx(cv, L.fx, Math.round(base * inten));
  }
  if (tuneOn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'fz-mute'; b.setAttribute('aria-label', muted ? 'Festival tune chalu karein' : 'Festival tune band karein'); b.textContent = muted ? '🔇' : '🔊';
    b.addEventListener('click', () => { const m = localStorage.getItem(MUTE_KEY) === '1'; localStorage.setItem(MUTE_KEY, m ? '0' : '1'); b.textContent = m ? '🔊' : '🔇'; b.setAttribute('aria-label', m ? 'Festival tune band karein' : 'Festival tune chalu karein'); if (m && sessionStorage.getItem(TUNED_KEY) !== '1') { sessionStorage.setItem(TUNED_KEY, '1'); playAny(cfg); } });
    wrap.querySelector('.fz-band').appendChild(b); }
  // offer / greeting strip (bottom, dismissible, never in the document flow)
  const off = cfg.offer || {}; const showOffer = !!off.enabled && !!(off.headline || off.text);
  const title = cfg.title || F.title, greet = cfg.greeting || F.greeting;
  const dismissed = !preview && localStorage.getItem(DISMISS_KEY) === String(cfg.version || '');
  if (!opts.noStrip && (title || greet || showOffer) && !dismissed) {
    const link = String(off.link || '').trim();
    const linkOk = /^https:\/\//.test(link) || /^[a-z0-9-]+\.html(\?|$)/.test(link);
    const code = String(off.code || '').trim();
    const s = document.createElement('section'); s.className = 'fz-strip'; s.setAttribute('aria-label', 'Festival offer');
    s.innerHTML = `<span class="fz-ic" aria-hidden="true">${esc(F.icon)}</span><div class="fz-tx">${title ? `<b>${esc(title)}</b>` : ''}${greet ? `<span>${esc(greet)}</span>` : ''}${showOffer ? `<div class="fz-off"><strong>${esc(off.headline || '')}</strong>${off.text ? ` <span>${esc(off.text)}</span>` : ''}${off.show_code && code ? ` <code class="fz-code">${esc(code)}</code>` : ''}${linkOk ? ` <a class="fz-go" href="${esc(link)}"${/^https/.test(link) ? ' target="_blank" rel="noopener"' : ''}>Abhi dekhein →</a>` : ''}</div>` : ''}</div>${preview ? '' : '<button type="button" class="fz-x" aria-label="Band karein">×</button>'}`;
    if (!preview) s.querySelector('.fz-x').addEventListener('click', () => { localStorage.setItem(DISMISS_KEY, String(cfg.version || '')); s.remove(); });
    wrap.appendChild(s);
  }
  wrap.style.visibility = 'hidden'; root.appendChild(wrap); ensureCss().then(() => { wrap.style.visibility = ''; });
  // the band hangs from the bottom edge of the sticky header (fixed, so it never moves the page)
  const hdr = document.querySelector('.hdr'); let raf2 = 0;
  const place = () => { raf2 = 0; if (!preview && hdr) wrap.style.setProperty('--fz-top', Math.round(hdr.getBoundingClientRect().bottom) + 'px'); };
  const onScroll = () => { if (!raf2) raf2 = requestAnimationFrame(place); };
  const onResize = () => { place(); if (fx) fx.resize(); };
  // first tap / touch / key / scroll of the session starts the tune (browsers block sound before a gesture)
  const onGesture = () => { ['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach((e) => window.removeEventListener(e, onGesture, true)); if (muted || sessionStorage.getItem(TUNED_KEY) === '1') return; sessionStorage.setItem(TUNED_KEY, '1'); playAny(cfg); };
  if (!preview) { place(); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onResize, { passive: true }); }
  if (tuneOn && sessionStorage.getItem(TUNED_KEY) !== '1') ['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach((e) => window.addEventListener(e, onGesture, { capture: true, passive: true }));
  return { destroy() { if (CUSTOM && !preview) { CUSTOM.pause(); } fx && fx.stop(); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); ['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach((e) => window.removeEventListener(e, onGesture, true)); wrap.remove(); } };
}
