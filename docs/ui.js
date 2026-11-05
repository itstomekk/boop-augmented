// Boop Augmented - DOM UI (2D top-down and CSS 3D view), animation, CPU turns, save.
(function () {
  'use strict';
  const L = window.BoopLogic;
  const $ = (id) => document.getElementById(id);
  const boardEl = $('board'), wrapEl = $('boardWrap'), statusEl = $('status'), layoutEl = document.querySelector('.layout');
  const SAVE_KEY = 'boop-augmented-save-v1';
  const SET_KEY = 'boop-augmented-settings-v1';
  const SEEN_KEY = 'boop-augmented-seen-rules-v1';
  const NAMES = ['Snowball', 'Coal', 'Frost', 'Ginger'];   // seat colours: white & gold, black & red, ice blue, ginger orange
  const HUMAN_SEAT = 0;     // against the computer you are seat 0; every other seat is a computer
  const TILT0 = 58, SPIN0 = 30; // default 3D camera tilt / spin (deg)
  const TIER_H = 0.42;       // tier step height, in cells
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Motion (ms). Boops are deliberately slow enough to follow with the eye; `reduced` skips all of it.
  const BOOP_MS = 1000, SCARE_MS = 1000, GHOST_STEP_MS = 800, PLACE_PAUSE_MS = 300;
  const EASE = 'cubic-bezier(.45,0,.2,1)';

  let settings = { mode: 'cpu', players: 2, board: 'tree', levels: 4, size: 6, ghost: false, boopmas: false, pieces: 'auto', ornaments: 'auto', view: '2d', spin: SPIN0, tilt: TILT0, zoom: 1 };
  // board: 'tree' | 'square' | 'shuffle' (a square with Shuffle powers; ghosts and Shuffle are exclusive). Boopmas spirits: tree only.
  const isShuffle = () => settings.board === 'shuffle';
  const isSquare = () => settings.board === 'square' || isShuffle();
  // Auto kittens: 8 on the classic tree, +2 per extra tier (balance_sim.js keeps games ~25 turns each).
  // Squares: 8 on the classic 6x6, +2 per extra row (SHAPE=square balance_sim.js: 40-60 plies on every size).
  const autoPieces = (levels) => 8 + 2 * (levels - 4);
  const autoSquarePieces = (size) => 8 + 2 * (size - 6);
  const autoNow = () => (isSquare() ? autoSquarePieces(settings.size) : autoPieces(settings.levels));
  const piecesFor = () => (settings.pieces === 'auto' ? autoNow() : +settings.pieces);
  // Auto ornaments on bigger trees (balance_sim.js): more ornaments, several hanging at once, and the
  // decorating tier is always 3rd from the bottom, so they stay as close to the edge as on the classic tree.
  // On the classic 4-tier tree Auto equals the official rule (3 ornaments, 1 at a time, tier 2).
  const ornCfg = (levels) => (settings.ornaments === 'classic' || levels === 4
    ? { ornaments: 3, ornActive: 1, decor: 1 }
    : { ornaments: Math.min(6, levels - 1), ornActive: 1 + Math.floor((levels - 3) / 2), decor: levels - 3 });
  const playersNow = () => (settings.players === 3 || settings.players === 4 ? settings.players : 2);
  // Most kittens per player that still leaves a free cell with this many players (2 players: no extra limit).
  const maxPiecesNow = () => (isSquare() ? Math.min(24, L.maxPieces(settings.size, playersNow(), 0, 'square', isShuffle()))
    : playersNow() > 2 ? L.maxPieces(settings.levels, playersNow(), Math.min(ornCfg(settings.levels).ornActive, ornCfg(settings.levels).ornaments)) : 24);
  const gameOpts = () => (isSquare()
    ? Object.assign({ shape: 'square', size: settings.size, players: playersNow(), pieces: Math.min(piecesFor(), maxPiecesNow()), ghost: !isShuffle() && settings.ghost }, isShuffle() ? { shuffle: true } : {})
    : Object.assign({ levels: settings.levels, players: playersNow(), pieces: Math.min(piecesFor(), maxPiecesNow()) }, ornCfg(settings.levels), settings.boopmas ? { boopmas: true } : {}));
  // A fixed kitten count that no longer fits (more players, smaller tree) falls back to the largest option that does.
  function clampPieces() {
    if (settings.pieces === 'auto') return;
    const fit = [16, 14, 12, 10, 8].find((v) => v <= maxPiecesNow());
    if (+settings.pieces > maxPiecesNow()) settings.pieces = fit || 'auto';
  }
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) { /* ignore */ }
  // Stored settings may be hostile or predate squares/ghosts: normalise every new key.
  if (![2, 3, 4].includes(settings.players)) settings.players = 2;
  if (settings.board !== 'square' && settings.board !== 'shuffle') settings.board = 'tree';
  if (![4, 5, 6, 7, 8].includes(settings.levels)) settings.levels = 4;
  if (!Number.isInteger(settings.size) || settings.size < L.SQUARE_MIN || settings.size > L.SQUARE_MAX) settings.size = L.SQUARE_MIN;
  settings.ghost = settings.ghost === true;
  settings.boopmas = settings.boopmas === true;
  let cpuPlan = null, cpuWorker = null, cpuGeneration = 0, cpuWatchdog = null;
  let net = null, netView = null, netSeq = 0, netIds = [], netPending = false, boardRoom = null; // online room (Nostr)
  const replayIdentity = (v) => `${v.root}:${v.admission || ''}`;
  let boardReplay = null;
  let state = null, history = [], selPiece = 'k', selSpirit = null, aim = null, busy = false, S = 64, cpuTimer = null, optCur = 0, lastNote = '';
  let geo = null;
  const pieceEls = new Map();
  let cellEls = [];
  const is3d = () => settings.view === '3d';

  // ---------- art ----------
  const PAL = [
    { fur: '#f6f1e6', edge: '#c9b98f', accent: '#f3c34f', eye: '#2a2a2a', hat: '#f3c34f', trim: '#fff' },   // white & gold
    { fur: '#2b2b33', edge: '#a3a3b4', accent: '#e2403f', eye: '#ffd86b', hat: '#c4161c', trim: '#fff' },   // black & red
    { fur: '#cfeaf9', edge: '#3f8fc0', accent: '#2f7fc4', eye: '#14324d', hat: '#168a9e', trim: '#fff' },   // ice blue & teal
    { fur: '#e8903a', edge: '#7d4410', accent: '#3b7d3a', eye: '#23160a', hat: '#2f8a3f', trim: '#fff' },   // ginger & green
    { fur: '#efe6ff', edge: '#7a52c9', accent: '#ff6fb1', eye: '#22204a', hat: '#7a52c9', trim: '#fff' },   // wild: shared by everyone (no owner)
  ];
  const palOf = (p) => PAL[p < 0 ? 4 : p];
  const ORN_COLORS = [['#ffe08a', '#d79b1c'], ['#ff7a6e', '#a8141a'], ['#a9dcff', '#2a6fb5'], ['#ffb766', '#b34e0c'], ['#ececec', '#8b8b8b']];  // seats 0-3, then neutral (captured)
  // Cats are drawn with thick, flat vector strokes and no blur: they stay crisp at 28-96 px and on phone screens.
  // `festive` (Christmas tree board): Santa hat on cats, scarf on kittens. The plain square board uses a bow tie instead.
  const festive = () => !state || state.shape !== 'square';
  // x: Shuffle power. 'w' wild (rainbow ribbon), 's' super (cape and bolt), 'a' scaredy (wide eyes, sweat drop).
  function catSVG(p, cat, fest = festive(), x) {
    const c = palOf(p);
    const extraBack = x === 's' ? `<path d="M22 66 Q50 106 78 66 L88 100 Q50 112 12 100 Z" fill="#d93a3a" stroke="${c.edge}" stroke-width="4"/>` : '';
    const extraFront = x === 's' ? `<path d="M52 33 L43 52 L51 50 L46 66 L60 45 L51 47 Z" fill="#ffd23f" stroke="${c.edge}" stroke-width="3"/>`
      : x === 'a' ? `<path d="M84 44 Q93 58 84 64 Q75 58 84 44 Z" fill="#9fdcff" stroke="#2f7fc4" stroke-width="3"/><path d="M26 44 L40 48 M74 44 L60 48" stroke="${c.edge}" stroke-width="4" stroke-linecap="round" fill="none"/>`
      : x === 'w' ? `<path d="M30 28 Q50 6 70 28" stroke="#ff6b6b" stroke-width="5" fill="none"/><path d="M34 32 Q50 14 66 32" stroke="#ffd23f" stroke-width="5" fill="none"/><path d="M38 36 Q50 22 62 36" stroke="#4cc9f0" stroke-width="5" fill="none"/>` : '';
    const hat = fest
      ? (cat
        ? `<path d="M26 32 Q48 -8 78 20 L74 34 Z" fill="${c.hat}" stroke="${c.edge}" stroke-width="4"/><rect x="21" y="27" width="60" height="11" rx="5.5" fill="${c.trim}" stroke="${c.edge}" stroke-width="4"/><circle cx="80" cy="18" r="7.5" fill="${c.trim}" stroke="${c.edge}" stroke-width="4"/>`
        : `<path d="M30 92 Q50 101 70 92" stroke="${c.accent}" stroke-width="8" fill="none" stroke-linecap="round"/>`)
      : (cat
        ? `<path d="M50 91 L32 83 L32 99 Z M50 91 L68 83 L68 99 Z" fill="${c.accent}" stroke="${c.edge}" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="91" r="6" fill="${c.accent}" stroke="${c.edge}" stroke-width="4"/>`
        : `<path d="M30 93 Q50 102 70 93" stroke="${c.accent}" stroke-width="8" fill="none" stroke-linecap="round"/>`);
    return `<svg viewBox="0 -8 100 112" aria-hidden="true" data-art="${fest ? 'festive' : 'plain'}"${x ? ` data-x="${x}"` : ''} shape-rendering="geometricPrecision" stroke-linejoin="round">
      ${extraBack}<path d="M17 47 L21 9 L46 31 Z" fill="${c.fur}" stroke="${c.edge}" stroke-width="5"/>
      <path d="M83 47 L79 9 L54 31 Z" fill="${c.fur}" stroke="${c.edge}" stroke-width="5"/>
      <ellipse cx="50" cy="60" rx="38" ry="34" fill="${c.fur}" stroke="${c.edge}" stroke-width="6"/>
      <ellipse cx="36" cy="57" rx="6" ry="8" fill="${c.eye}"/><ellipse cx="64" cy="57" rx="6" ry="8" fill="${c.eye}"/>
      <circle cx="38.5" cy="54" r="2.4" fill="#fff"/><circle cx="66.5" cy="54" r="2.4" fill="#fff"/>
      <path d="M45 67.5 L55 67.5 L50 73.5 Z" fill="${c.accent}"/>
      <path d="M50 73.5 Q44 80 38 76 M50 73.5 Q56 80 62 76" stroke="${c.edge}" stroke-width="4" fill="none" stroke-linecap="round"/>
      ${hat}${extraFront}</svg>`;
  }
  function ornSVG(p) {
    const col = ORN_COLORS[p];
    const id = 'og' + p;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><radialGradient id="${id}" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="${col[0]}"/><stop offset="1" stop-color="${col[1]}"/></radialGradient></defs>
      <rect x="40" y="4" width="20" height="14" rx="3" fill="#c9c9c9" stroke="#888" stroke-width="3"/>
      <circle cx="50" cy="58" r="38" fill="url(#${id})" stroke="${col[1]}" stroke-width="4"/>
      <path d="M16 52 Q50 70 84 52" stroke="#ffffffaa" stroke-width="5" fill="none"/>
      <ellipse cx="36" cy="40" rx="9" ry="6" fill="#ffffffb0" transform="rotate(-30 36 40)"/></svg>`;
  }
  // The ghost cat: a see-through sheet with cat ears and a wavy hem, outlined in its owner's colour.
  function spiritSVG(p) {
    const c = PAL[p].accent;
    return `<svg viewBox="0 0 100 100" aria-hidden="true" data-art="spirit" shape-rendering="geometricPrecision" stroke-linejoin="round">
      <path d="M20 94 V50 Q20 16 50 16 Q80 16 80 50 V94 L70 83 L60 94 L50 83 L40 94 L30 83 Z" fill="#ffffff" fill-opacity=".88" stroke="${c}" stroke-width="6"/>
      <path d="M24 30 L24 6 L44 19 Z M76 30 L76 6 L56 19 Z" fill="#ffffff" fill-opacity=".88" stroke="${c}" stroke-width="5"/>
      <ellipse cx="38" cy="50" rx="5.5" ry="8" fill="#23233a"/><ellipse cx="62" cy="50" rx="5.5" ry="8" fill="#23233a"/>
      <path d="M43 66 Q50 73 57 66" stroke="#23233a" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`;
  }
  const svgFor = (q) => (q.kind === 'o' ? ornSVG(q.p) : catSVG(q.p, q.kind === 'c', festive(), q.x));
  const POWER_NAMES = { w: 'wild', s: 'super', a: 'scaredy' };
  const describe = (q) => (q.kind === 'o' ? 'ornament' : `${q.x ? POWER_NAMES[q.x] + ' ' : ''}${q.kind === 'c' ? 'cat' : 'kitten'}${q.p >= 0 ? ' of ' + NAMES[q.p] : ''}${q.cov ? ', asleep under a blanket' : ''}`);
  const tierLight = (k) => 19 + ((geo.L - 1 - k) / (geo.L - 1)) * 30;
  const ringOf = (i) => (geo.shape === 'square' ? 0 : geo.ring[i]);   // z level of a cell: a square is one flat slab

  // ---------- geometry helpers ----------
  const H = () => S * TIER_H;
  const zRing = (k) => (is3d() ? (geo.tiers - k) * H() : 0);
  const zOf = (r, c) => (geo.shape === 'square' ? zRing(0) : L.onBoard(geo, r, c) ? zRing(geo.ring[r * geo.N + c]) : 0);
  const billboard = () => `rotateZ(${-settings.spin}deg) rotateX(${-settings.tilt}deg)`;
  const camTransform = () => `scale3d(${settings.zoom}, ${settings.zoom}, ${settings.zoom}) rotateX(${settings.tilt}deg) rotateZ(${settings.spin}deg)`;
  // Tree-topper: a standing 3D star centred on the treetop cell, lifted a little above it.
  const starTransform = () => `translateZ(${zRing(0) + S * 0.25}px)`;

  // Fixed stars on a celestial sphere. Apply the same Rx(tilt) Rz(spin)
  // as the tree, then perspective-project directions behind the camera.
  // The finite star list is generated once, not on every animation frame.
  const skyCanvas = $('sky'), skyCtx = skyCanvas.getContext('2d');
  let seed = 674213;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const stars = Array.from({ length: 1400 }, () => {
    const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return { x: r * Math.cos(a), y: r * Math.sin(a), z, size: .6 + Math.pow(rand(), 4) * 2.4, alpha: .3 + rand() * .7 };
  });
  function updateSky() {
    const w = window.innerWidth, h = window.innerHeight;
    // One physical pixel per CSS pixel: no giant high-DPI phone buffers.
    if (skyCanvas.width !== w || skyCanvas.height !== h) { skyCanvas.width = w; skyCanvas.height = h; }
    // Read the tree's actual CSS camera intrinsics, including its viewport-space origin.
    // At infinity uniform board zoom cancels out of x/-z and y/-z.
    const camera = getComputedStyle(wrapEl), rect = wrapEl.getBoundingClientRect();
    const origin = camera.perspectiveOrigin.split(' ').map(parseFloat);
    const f = is3d() ? parseFloat(camera.perspective) : Math.max(w, h) * .8;
    const ox = is3d() ? rect.left + origin[0] : w / 2;
    const oy = is3d() ? rect.top + origin[1] : h / 2;
    const cx = skyCtx;
    cx.fillStyle = '#0b1630'; cx.fillRect(0, 0, w, h);
    const grad = cx.createRadialGradient(w * .5, h * .4, 0, w * .5, h * .4, Math.max(w, h));
    grad.addColorStop(0, '#1a315b'); grad.addColorStop(1, '#080f23');
    cx.fillStyle = grad; cx.fillRect(0, 0, w, h);
    const spin = (is3d() ? settings.spin : 0) * Math.PI / 180;
    const tilt = (is3d() ? settings.tilt : 0) * Math.PI / 180;
    const cs = Math.cos(spin), ss = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
    for (const s of stars) {
      const x = cs * s.x - ss * s.y, y = ss * s.x + cs * s.y;
      const sy = ct * y - st * s.z, sz = st * y + ct * s.z;
      if (sz >= -.05) continue;
      const px = ox + f * x / -sz, py = oy + f * sy / -sz;
      if (px < -4 || px > w + 4 || py < -4 || py > h + 4) continue;
      cx.globalAlpha = s.alpha; cx.fillStyle = '#e5efff';
      cx.beginPath(); cx.arc(px, py, s.size, 0, Math.PI * 2); cx.fill();
    }
    cx.globalAlpha = 1;
  }

  // ---------- layout ----------
  function measure() {
    const w = wrapEl.clientWidth;
    const top = wrapEl.getBoundingClientRect().top + window.scrollY;
    const h = Math.max(300, window.innerHeight - top - 60);
    const N = geo.N;
    // 3D: size the board so it fits at ANY spin and tilt (diagonal x tower height), then zoom on top.
    const D = N * 1.42, T = geo.tiers * TIER_H + 1.6;
    if (is3d()) S = Math.max(14, Math.min(80, Math.floor(Math.min(w / D, h / Math.hypot(D, T)) * 0.94)));
    else S = Math.max(18, Math.min(96, Math.floor(Math.min(w, h) / N)));
    document.documentElement.style.setProperty('--S', S + 'px');
    const W = N * S;
    wrapEl.classList.toggle('v3d', is3d());
    $('snow').style.display = is3d() || geo.shape === 'square' ? 'none' : '';   // snow is for the Christmas tree only
    boardEl.classList.toggle('v3d', is3d());
    wrapEl.style.height = is3d() ? Math.round(S * Math.hypot(D, T) + 24) + 'px' : '';
    boardEl.style.width = W + 'px';
    boardEl.style.height = W + 'px';
    boardEl.style.transform = is3d() ? camTransform() : '';
    boardEl.style.setProperty('--notch', `polygon(${S}px 0, ${W - S}px 0, ${W - S}px ${S}px, ${W}px ${S}px, ${W}px ${W - S}px, ${W - S}px ${W - S}px, ${W - S}px ${W}px, ${S}px ${W}px, ${S}px ${W - S}px, 0 ${W - S}px, 0 ${S}px, ${S}px ${S}px)`);
    boardEl.querySelectorAll('.tier').forEach((t) => {
      const k = +t.dataset.ring, off = (geo.m - k) * S, size = (2 * k + 1) * S;
      Object.assign(t.style, { left: off + 'px', top: off + 'px', width: size + 'px', height: size + 'px' });
      t.style.transform = is3d() ? `translateZ(${zRing(k)}px)` : '';
    });
    const slab = boardEl.querySelector('.slab');
    if (slab) Object.assign(slab.style, { left: '0px', top: '0px', width: W + 'px', height: W + 'px', transform: is3d() ? `translateZ(${zRing(0)}px)` : '' });
    buildWalls();
    const star = boardEl.querySelector('.topstar');
    if (star) {
      Object.assign(star.style, { left: geo.m * S + 'px', top: geo.m * S + 'px', width: S + 'px', height: S + 'px' });
      star.style.transform = is3d() ? starTransform() : '';
    }

    for (const i of geo.cells) {
      const el = cellEls[i];
      el.style.left = (i % N) * S + 'px';
      el.style.top = ((i / N) | 0) * S + 'px';
      el.style.transform = is3d() ? `translateZ(${zRing(ringOf(i)) + 1}px)` : '';
    }
    placeAll();
    syncStitches();
    $('rotBox').classList.toggle('hidden', !is3d());
    updateSky();
  }
  function placeAll() {
    for (const el of pieceEls.values()) placeEl(el, el._r, el._c);
    for (const el of spiritEls.values()) placeEl(el, el._r, el._c);
    if (previewEl) placeEl(previewEl, previewEl._r, previewEl._c);
  }
  // Transform of a piece box whose top-left sits at cell coordinates (r, c); `hop` lifts it (px) for a leap.
  function xform(el, r, c, hop = 0) {
    if (is3d()) {
      const lift = el.classList.contains('orn') ? -30 : -36;
      return `translate3d(${c * S}px, ${r * S}px, ${zOf(r, c) + 2 + hop}px) ${billboard()} translateY(${lift}%)`;
    }
    return `translate(${c * S}px, ${r * S - hop}px)`;
  }
  function placeEl(el, r, c) {
    // Tree 3D only: a gentle warm brightness towards the treetop. No blurred glow or drop shadow: it smears the cat art.
    // Lighting depends on cell and view, not camera angle; don't recompute it on orbit.
    if (el._r !== r || el._c !== c || el._lit3d !== is3d()) {
      const light = is3d() && geo.shape !== 'square' ? Math.max(0, 1 - Math.hypot(r - geo.m, c - geo.m) / (geo.L * 1.25)) : 0;
      el.style.filter = light ? `brightness(${1 + light * 0.22})` : '';
      el._lit3d = is3d();
    }
    el._r = r; el._c = c;
    el.style.transform = xform(el, r, c);
  }

  // Side walls of each tier so the 3D tree reads as stacked slabs (the square board is a single slab).
  function buildWalls() {
    boardEl.querySelectorAll('.wall').forEach((w) => w.remove());
    if (!is3d()) return;
    const first = boardEl.querySelector('.topstar') || boardEl.querySelector('.slab').nextSibling;
    const add = (x, y, len, zb, h, horiz, light, hue = 145, sat = 48) => {
      const d = document.createElement('div');
      d.className = 'wall';
      const shade = horiz ? light - 7 : light - 11;
      d.style.background = `linear-gradient(${horiz ? '0deg' : '90deg'}, hsl(${hue} ${sat}% ${shade - 5}%), hsl(${hue} ${sat}% ${shade}%))`;
      if (horiz) Object.assign(d.style, { left: x + 'px', top: y + 'px', width: len + 'px', height: h + 'px', transformOrigin: '50% 0', transform: `translateZ(${zb}px) rotateX(90deg)` });
      else Object.assign(d.style, { left: x + 'px', top: y + 'px', width: h + 'px', height: len + 'px', transformOrigin: '0 50%', transform: `translateZ(${zb}px) rotateY(-90deg)` });
      boardEl.insertBefore(d, first);
    };
    const W = geo.N * S, h = H();
    if (geo.shape === 'square') {   // four sides of the bed
      add(0, 0, W, 0, h, true, 36, 228, 32); add(0, W, W, 0, h, true, 36, 228, 32);
      add(0, 0, W, 0, h, false, 36, 228, 32); add(W, 0, W, 0, h, false, 36, 228, 32);
      return;
    }
    for (let k = geo.L - 2; k >= 0; k--) {
      const off = (geo.m - k) * S, size = (2 * k + 1) * S, zb = zRing(k + 1), lt = tierLight(k);
      add(off, off, size, zb, h, true, lt); add(off, off + size, size, zb, h, true, lt);
      add(off, off, size, zb, h, false, lt); add(off + size, off, size, zb, h, false, lt);
    }
    const lb = tierLight(geo.L - 1);
    add(S, 0, W - 2 * S, 0, h, true, lb); add(S, W, W - 2 * S, 0, h, true, lb);
    add(0, S, W - 2 * S, 0, h, false, lb); add(W, S, W - 2 * S, 0, h, false, lb);
    for (const [cx, cy] of [[0, 0], [W - S, 0], [0, W - S], [W - S, W - S]]) {
      const hy = cy === 0 ? S : W - S, vx = cx === 0 ? S : W - S;
      add(cx, hy, S, 0, h, true, lb);
      add(vx, cy, S, 0, h, false, lb);
    }
  }

  function buildBoard() {
    geo = L.geometry(state.L, state.shape);
    boardEl.innerHTML = '';
    pieceEls.clear(); spiritEls.clear();
    cellEls = [];
    const square = geo.shape === 'square';
    boardEl.classList.toggle('square', square);
    boardEl.dataset.shape = geo.shape;
    boardEl.setAttribute('aria-label', square ? `${state.shuffle ? 'Shuffle board' : 'Square board'}, ${geo.N} by ${geo.N}` : 'Christmas tree board');
    boardEl.dataset.mode = state.shuffle ? 'shuffle' : state.boopmas ? 'boopmas' : state.ghost ? 'ghost' : 'plain';
    document.body.classList.toggle('plain', square);
    if (square) {
      const slab = document.createElement('div');
      slab.className = 'slab';
      boardEl.appendChild(slab);
    } else {
      for (let k = geo.L - 1; k >= 0; k--) {
        const t = document.createElement('div');
        t.className = 'tier' + (k === geo.L - 1 ? ' base' : '') + (k === 0 ? ' t0' : '') + (k === (state.decor || L.DECOR_RING) ? ' decor' : '');
        t.dataset.ring = k;
        if (k) t.style.background = `hsl(145 52% ${tierLight(k).toFixed(0)}%)`;
        if (k && k < geo.L - 1) t.style.boxShadow = '0 0 0 2px #06200f, 0 7px 16px #000c, inset 0 2px 0 #ffffff30';
        t.innerHTML = '<div class="needles"></div>';
        boardEl.appendChild(t);
      }
      const star = document.createElement('div');
      star.className = 'topstar'; star.innerHTML = '<span class="orb">' + Array.from({length: 12}, (_, i) => `<i style="transform:rotateY(${i * 15}deg)"></i>`).join('') + '</span>';
      star.title = 'Treetop: the single cell of tier 1';
      boardEl.appendChild(star);
    }
    for (const i of geo.cells) {
      const r = (i / geo.N) | 0, c = i % geo.N;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cell'; b.dataset.idx = i;
      b.setAttribute('aria-label', square ? `Row ${r + 1}, column ${c + 1}` : `Tier ${geo.ring[i] + 1}, row ${r + 1}, column ${c + 1}${geo.ring[i] === 0 ? ' (treetop)' : ''}`);
      b.addEventListener('click', () => onCell(i));
      b.addEventListener('mouseenter', () => showPreview(i));
      b.addEventListener('focus', () => showPreview(i));
      b.addEventListener('mouseleave', clearPreview);
      b.addEventListener('blur', clearPreview);
      cellEls[i] = b;
      boardEl.appendChild(b);
    }
    measure();
  }

  // ---------- pieces ----------
  const kindClass = (k) => (k === 'o' ? 'orn' : k === 'c' ? 'cat' : 'kitten');
  // A sleeping piece wears its owner's blanket (Shuffle). cov = {p} or falsy.
  function setNap(el, cov) {
    if (!el) return;
    const old = el.querySelector('.blanket');
    if (!cov) { if (old) old.remove(); el.classList.remove('napping'); return; }
    el.classList.add('napping');
    if (old && old.dataset.p === String(cov.p)) return;
    if (old) old.remove();
    const b = document.createElement('span');
    b.className = 'blanket'; b.dataset.p = cov.p; b.textContent = 'zZ';
    el.appendChild(b);
  }
  function makePiece(q, idx) {
    const el = document.createElement('div');
    el.className = 'piece ' + kindClass(q.kind);
    el.dataset.id = q.id; el.dataset.p = q.p; el.dataset.n = q.p < 0 ? 'W' : q.p + 1; el.dataset.kind = q.kind;
    if (q.x) el.dataset.x = q.x;
    el.title = describe(q);
    el.innerHTML = svgFor(q);
    if (q.cov) setNap(el, q.cov);
    placeEl(el, (idx / geo.N) | 0, idx % geo.N);
    boardEl.appendChild(el);
    if (q.id !== 'preview') pieceEls.set(q.id, el);
    return el;
  }
  function syncPieces() {
    const alive = new Set();
    for (const i of geo.cells) {
      const q = state.b[i];
      if (!q) continue;
      alive.add(q.id);
      const el = pieceEls.get(q.id) || makePiece(q, i);
      el.classList.remove('grad', 'flash', 'nudge', 'gone', 'pickable');
      setNap(el, q.cov); el.title = describe(q);
      placeEl(el, (i / geo.N) | 0, i % geo.N);
    }
    for (const [id, el] of pieceEls) if (!alive.has(id)) { el.remove(); pieceEls.delete(id); }
  }

  // ---------- ghost cats (square boards with the ghost variant) ----------
  const spiritEls = new Map();   // seat -> element of that seat's ghost on the board
  function makeSpirit(p, g) {
    const el = document.createElement('div');
    el.className = 'piece spirit';
    el.dataset.p = p; el.dataset.n = p + 1; el.dataset.kind = 'ghost';
    el.title = `${NAMES[p]}'s ghost cat`;
    el.innerHTML = spiritSVG(p);
    const pl = L.ghostPlace(geo.N, g);
    placeEl(el, pl.r, pl.c);
    boardEl.appendChild(el);
    spiritEls.set(p, el);
    return el;
  }
  function syncSpirits() {
    const want = new Map();
    if (state.ghost) state.ghosts.forEach((g, p) => { if (g.on) want.set(p, g); });
    for (const [p, g] of want) {
      const el = spiritEls.get(p) || makeSpirit(p, g), pl = L.ghostPlace(geo.N, g);
      el.classList.remove('gone', 'appear');
      placeEl(el, pl.r, pl.c);
    }
    for (const [p, el] of spiritEls) if (!want.has(p)) { el.remove(); spiritEls.delete(p); }
  }
  // Entry stitches around the edge while the player decides about the ghost. Each is a real button.
  const EDGE = ['top edge', 'bottom edge', 'left edge', 'right edge'], ARROW = ['↓', '↑', '→', '←'];
  function syncStitches() {
    boardEl.querySelectorAll('.stitch').forEach((b) => b.remove());
    if (!state || state.phase !== 'ghost' || busy || !humanTurn()) return;
    const N = geo.N, W = N * S, ST = Math.max(16, Math.round(S * 0.45));
    for (const id of L.ghostStitches(state)) {
      const g = L.stitchFromId(N, id), x = g.d < 2 ? (g.a + 1) * S : (g.d === 2 ? 0 : W), y = g.d >= 2 ? (g.a + 1) * S : (g.d === 0 ? 0 : W);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'stitch'; b.dataset.id = id; b.dataset.p = state.turn;
      b.textContent = ARROW[g.d];
      b.setAttribute('aria-label', `Place ghost on the ${EDGE[g.d]}, between ${g.d < 2 ? 'columns' : 'rows'} ${g.a + 1} and ${g.a + 2}`);
      Object.assign(b.style, { left: x - ST / 2 + 'px', top: y - ST / 2 + 'px', width: ST + 'px', height: ST + 'px', fontSize: Math.round(ST * 0.62) + 'px' });
      b.style.transform = is3d() ? `translateZ(${zRing(0) + 3}px)` : '';
      b.addEventListener('click', () => { if (!busy && !suppressClick) act('ghost', id); });
      boardEl.appendChild(b);
    }
  }

  // ---------- piece preview (hover/focus) ----------
  let previewEl = null;
  function clearPreview() {
    if (previewEl) { previewEl.remove(); previewEl = null; }
    for (const el of pieceEls.values()) el.classList.remove('nudge');
  }
  function showPreview(i) {
    clearPreview();
    if (busy || !humanTurn() || state.b[i] || dragging) return;
    if (state.phase === 'ornament') {
      if (!L.ornamentCells(state).includes(i)) return;
      previewEl = makePiece({ id: 'preview', p: state.turn, kind: 'o' }, i);
    } else if (state.phase === 'place') {
      const code = effectivePiece();
      if (code === null || code === 'b' || aim) return;
      const o = pieceOpts(code);
      if (selSpirit === 2) return;   // Meowly needs an aim first
      previewEl = makePiece({ id: 'preview', p: o.x === 'w' ? -1 : state.turn, kind: o.cat ? 'c' : 'k', x: o.x }, i);
      try { for (const bp of L.play(state, i, o.cat, playOpts(Object.assign({}, o, selSpirit === 0 || selSpirit === 1 ? { g: selSpirit } : {}))).boops) { const el = pieceEls.get(bp.id); if (el) el.classList.add('nudge'); } } catch (e) { /* not playable here */ }
    } else return;
    previewEl.classList.add('preview');
  }

  // ---------- turn flow ----------
  const isCpu = (p) => !net && settings.mode === 'cpu' && p !== HUMAN_SEAT;
  const seated = () => !!netView && netView.ready !== false;   // v3 rooms start when every seat is filled
  const humanTurn = () => state.phase !== 'over' && (net ? seated() && netView.myIdx === state.turn : !isCpu(state.turn));
  // Pieces the player on turn may choose: k kitten, c cat, ks super kitten, cs super cat, ka scaredy kitten, kw/cw wild kitten/cat
  // (shared), b blankie (needs an awake piece on the board). Without Shuffle only k and c exist.
  const PIECE_ORDER = ['k', 'c', 'ks', 'ka', 'cs', 'kw', 'cw', 'b'];
  function pieceCount(code) {
    const pl = state.pool[state.turn];
    if (code === 'kw') return state.wild ? state.wild.k : 0;
    if (code === 'cw') return state.wild ? state.wild.c : 0;
    if (code === 'b') return (pl.b || 0) > 0 && state.b.some((q) => q && !q.cov) ? pl.b : 0;
    return pl[code] || 0;
  }
  function effectivePiece() {
    if (pieceCount(selPiece) > 0) return selPiece;
    return PIECE_ORDER.find((c) => pieceCount(c) > 0) || null;
  }
  const pieceOpts = (code) => ({ cat: code[0] === 'c', x: code === 'ks' || code === 'cs' ? 's' : code === 'ka' ? 'a' : code === 'kw' || code === 'cw' ? 'w' : code === 'b' ? 'b' : undefined });
  // Options object for L.play from {cat, x, g, d}
  const playOpts = (a) => (a.x === undefined && a.g === undefined && a.d === undefined ? undefined : { x: a.x, g: a.g, d: a.d });
  const PIECE_NAME = { k: 'kitten', c: 'cat', ks: 'super kitten', cs: 'super cat', ka: 'scaredy kitten', kw: 'wild kitten', cw: 'wild cat', b: 'blankie' };
  // Meowly's aim: after choosing the cell, the player clicks the neighbour piece to boop. dirOf: direction index from cell a to b.
  const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const dirOf = (a, b) => DIRS8.findIndex(([dr, dc]) => (((a / geo.N) | 0) + dr) * geo.N + (a % geo.N) + dc === b && Math.abs((b % geo.N) - (a % geo.N)) <= 1);
  const spiritHolderNow = () => !!state.boopmas && state.phase === 'place' && state.spirits.holder === state.turn;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  const idsOn = (st) => new Set(st.b.filter(Boolean).map((q) => q.id));

  // Animate a batch of piece moves (boops or ghost scares). Pieces that leap over blockers hop; pieces that leave the
  // board fade out. Resolves when every motion has finished. `reduced` motion applies the result instantly.
  async function animateMoves(events, notes, ms) {
    const motions = [];
    for (const bp of events) {
      const el = pieceEls.get(bp.id);
      if (!el) continue;
      if (bp.result === 'blanket') {   // the blanket comes off and lands on the next piece (shown as a cut, not a glide)
        setNap(el, null);
        if (bp.blanketCovers) setNap(pieceEls.get(bp.blanketCovers), { p: bp.blanketOwner });
        notes.push(bp.blanketCovers ? `🛏️ A blanket flies over and puts another piece to sleep.` : `🛏️ A blanket is knocked off and goes back to ${NAMES[bp.blanketOwner]}.`);
        continue;
      }
      const from = el.style.transform;
      const off = bp.result === 'off' || bp.result === 'returned' || bp.result === 'captured' || bp.result === 'pounce';
      el.style.transition = 'none';
      placeEl(el, bp.tr, bp.tc);
      if (!reduced) {
        let frames;
        if (bp.leap) {
          const r0 = (bp.from / geo.N) | 0, c0 = bp.from % geo.N, mid = xform(el, (r0 + bp.tr) / 2, (c0 + bp.tc) / 2, S * 0.75);
          frames = off
            ? [{ transform: from, opacity: 1, offset: 0 }, { transform: mid, opacity: 1, offset: 0.5 }, { transform: el.style.transform, opacity: 0, offset: 1 }]
            : [{ transform: from, offset: 0 }, { transform: mid, offset: 0.5 }, { transform: el.style.transform, offset: 1 }];
        } else {
          frames = off
            ? [{ transform: from, opacity: 1, offset: 0 }, { opacity: 1, offset: 0.65 }, { transform: el.style.transform, opacity: 0, offset: 1 }]
            : [{ transform: from }, { transform: el.style.transform }];
        }
        const anim = el.animate(frames, { duration: ms, easing: EASE, fill: 'both' });
        motions.push(anim.finished.catch(() => {}).then(() => { if (off) el.classList.add('gone'); anim.cancel(); el.style.transition = ''; }));
      } else { if (off) el.classList.add('gone'); el.style.transition = ''; }
      if (bp.scare && bp.result === 'move' && !notes.includes('😱 A scaredy kitten is pushed along.')) notes.push('😱 A scaredy kitten is pushed along.');
      if (bp.leap && !bp.ghost && !notes.includes('🦘 A piece jumps over the others.')) notes.push('🦘 A piece jumps over the others.');
      if (bp.result === 'captured') notes.push(`💥 ${NAMES[bp.by]} knocks off an ornament!`);
      if (bp.result === 'returned') notes.push(`${NAMES[bp.owner]} gets their ornament back.`);
      if (bp.result === 'pounce') {
        const oe = pieceEls.get(bp.ornId);
        if (oe) { oe.classList.add('flash'); setTimeout(() => oe.classList.add('gone'), reduced ? 0 : 200); }
        notes.push(bp.ornResult === 'captured' ? `🐾 Pounce! ${NAMES[bp.by]} captures an ornament.` : `🐾 ${NAMES[bp.by]} rescues their own ornament.`);
      }
    }
    if (motions.length) await Promise.all(motions);
  }

  // The owner's ghost steps to its next stitch (or leaves the board), then scares what stands beside it.
  async function animateGhostMove(gm, notes) {
    const el = spiritEls.get(gm.player);
    if (el) {
      const step = gm.from.d % 2 === 0 ? 1 : -1;
      const dest = gm.to || { d: gm.from.d, a: gm.from.a, t: gm.from.t + step * (gm.passed + 1) };   // leaving: glide past the edge
      const from = el.style.transform, pl = L.ghostPlace(geo.N, dest);
      el.style.transition = 'none';
      placeEl(el, pl.r, pl.c);
      if (!reduced) {
        const frames = gm.to ? [{ transform: from }, { transform: el.style.transform }]
          : [{ transform: from, opacity: 1, offset: 0 }, { opacity: 1, offset: 0.5 }, { transform: el.style.transform, opacity: 0, offset: 1 }];
        const anim = el.animate(frames, { duration: GHOST_STEP_MS, easing: EASE, fill: 'both' });
        await anim.finished.catch(() => {});
        anim.cancel();
      }
      el.style.transition = '';
      if (!gm.to) el.classList.add('gone');
    }
    if (!gm.to) notes.push(`👻 ${NAMES[gm.player]}'s ghost leaves the board.`);
    await animateMoves(gm.scares, notes, SCARE_MS);
    if (gm.scares.length) {
      const offN = gm.scares.filter((e) => e.result === 'off').length;
      notes.push(`👻 ${NAMES[gm.player]}'s ghost scares ${gm.scares.length === 1 ? 'a piece' : gm.scares.length + ' pieces'}${offN ? `, ${offN} off the bed` : ''}.`);
    }
  }

  // After all movement (boops, ghost scares): graduation / win highlight. Shared by every action that can resolve a turn.
  async function settle(prev, st, notes) {
    const finalIds = idsOn(st);
    const gradIds = [];
    for (const [id, el] of pieceEls) if (!el.classList.contains('gone') && !finalIds.has(id) && el.dataset.kind !== 'o') gradIds.push(id);
    if (st.winLine) for (const i of st.winLine) cellEls[i].classList.add('winline');
    if (gradIds.length) {
      for (const id of gradIds) pieceEls.get(id).classList.add('grad');
      await wait(800);
      for (const id of gradIds) pieceEls.get(id).classList.add('gone');
      await wait(360);
      notes.push(`✨ ${NAMES[prev.turn]} graduates: ${gradIds.length} ${gradIds.length === 1 ? 'cat' : 'cats'} to the pool.`);
    } else if (st.winLine) await wait(600);
    lastNote = notes.join(' ');
  }

  async function animatePlay(prev, res) {
    clearPreview();
    const notes = [];
    if (res.placed.kind === 'b') setNap(pieceEls.get(res.placed.id), { p: res.placed.p });   // the blankie covers the piece
    else makePiece({ id: res.placed.id, p: res.placed.p, kind: res.placed.kind, x: res.placed.x }, res.placed.idx);
    if (res.placed.g !== undefined) notes.push(`👻 ${NAMES[prev.turn]} calls ${L.SPIRITS[res.placed.g].name}.`);
    await wait(PLACE_PAUSE_MS);
    await animateMoves(res.boops, notes, BOOP_MS);
    if (res.ghostMove) await animateGhostMove(res.ghostMove, notes);
    await settle(prev, res.state, notes);
  }

  const toAction = (kind, arg) => {
    if (kind === 'skip') return { k: 'skip' };
    if (kind !== 'play') return { k: kind, i: arg };
    const a = { k: 'play', i: arg.idx, c: !!arg.cat };   // canonical order k, i, c, x, g, d
    if (arg.x !== undefined) a.x = arg.x;
    if (arg.g !== undefined) a.g = arg.g;
    if (arg.d !== undefined) a.d = arg.d;
    return a;
  };
  async function act(kind, arg, remote) {
    const prev = state, historyLength = history.length;
    let sent = null, completed = false;
    busy = true;
    try {
      // Validate before publishing. Never send a locally illegal action to the relay.
      if (net && !remote) {
        window.BoopOnline.applyAction(L, state, toAction(kind, arg));
        sent = net.sendMove(netSeq, toAction(kind, arg));
      }
      clearPreview();
      render();
      history.push(state);
      if (kind === 'orn') {
        const res = L.placeOrnament(state, arg);
        makePiece({ id: res.placed.id, p: res.placed.p, kind: 'o' }, arg);
        await wait(260);
        state = res.state;
        lastNote = '';
      } else if (kind === 'play') {
        const res = L.play(state, arg.idx, arg.cat, playOpts(arg));
        await animatePlay(prev, res);
        state = res.state;
      } else if (kind === 'ghost' || kind === 'skip') {
        const res = kind === 'ghost' ? L.placeGhost(state, arg) : L.skipGhost(state);
        const notes = [];
        if (kind === 'ghost') {
          const el = makeSpirit(res.ghost.player, res.ghost);
          if (!reduced) { el.classList.add('appear'); await wait(520); }
          notes.push(`👻 ${NAMES[res.ghost.player]} sends a ghost onto the board.`);
        }
        await settle(prev, res.state, notes);
        state = res.state;
      } else if (kind === 'line') {
        const res = L.chooseLine(state, arg);
        for (const id of res.ids) pieceEls.get(id).classList.add('grad');
        await wait(600);
        for (const id of res.ids) pieceEls.get(id).classList.add('gone');
        await wait(300);
        state = res.state;
        lastNote = `✨ ${NAMES[prev.turn]} graduates: 3 cats to the pool.`;
      } else if (kind === 'promote') {
        const res = L.promote(state, arg);
        const el = pieceEls.get(res.removed.id);
        if (el) { el.classList.add('grad'); await wait(420); el.classList.add('gone'); await wait(300); }
        state = res.state;
        lastNote = `✨ ${NAMES[prev.turn]} takes a piece back as a cat.`;
      } else throw new Error('Unknown action');
      if (net) netIds = remote ? remote.actionIds.slice() : netIds.concat(sent.id);
      if (state.boopmas && prev.boopmas && state.spirits.holder !== null && (state.spirits.holder !== prev.spirits.holder || (prev.spirits.used.some(Boolean) && !state.spirits.used.some(Boolean)))) lastNote = (lastNote ? lastNote + ' ' : '') + `👻 ${NAMES[state.spirits.holder]} takes the spirit board.`;
      completed = true;
    } catch (error) {
      console.error('Action failed; restoring canonical state', error);
      history.length = historyLength;
      clearPreview();
      if (net) {
        const latest = net.view();
        netView = latest;
        if (latest.state) replaceReplay(latest);
        else { state = prev; buildBoard(); }
      } else { state = prev; buildBoard(); }
      lastNote = 'The move animation failed; the board has been restored.';
    } finally {
      busy = false;
      if (completed) afterAct();
      else {
        render();
        if (net && netPending) { netPending = false; onNet(netView); }
      }
    }
  }

  function afterAct() {
    optCur = 0; aim = null; selSpirit = null;
    if (net) netSeq = netIds.length;
    if (state.phase === 'place') selPiece = effectivePiece() || 'k';
    if (!net) save();
    busy = false;
    render();
    scheduleCpu();
    if (net && netPending) { netPending = false; onNet(netView); }
  }

  function onCell(i) {
    if (busy || !humanTurn() || suppressClick) return;
    const q = state.b[i];
    if (state.phase === 'ornament') { if (L.ornamentCells(state).includes(i)) act('orn', i); return; }
    if (state.phase === 'promote') { if (q && q.p === state.turn && q.kind !== 'o') act('promote', i); return; }
    if (state.phase === 'chooseLine') {
      const cands = state.options.map((Ln, k) => (Ln.includes(i) ? k : -1)).filter((k) => k >= 0);
      if (!cands.length) return;
      if (cands.includes(optCur)) act('line', optCur);
      else { optCur = cands[0]; render(); }
      return;
    }
    if (state.phase !== 'place') return;
    if (aim) {   // Jacob Meowly: the click picks the piece he boops
      const d = dirOf(aim.idx, i);
      if (i === aim.idx || d < 0 || !L.legalSpirits(state, aim.idx).some((x) => x.g === 2 && x.d === d)) { aim = null; clearPreview(); render(); return; }
      const a = aim; aim = null;
      act('play', { idx: a.idx, cat: a.cat, x: a.x, g: 2, d });
      return;
    }
    const code = effectivePiece();
    if (code === null) return;
    const o = pieceOpts(code);
    if (code === 'b') { if (q && !q.cov) act('play', { idx: i, cat: false, x: 'b' }); return; }
    if (q) return;
    if (selSpirit === 2) {
      if (!L.legalSpirits(state, i).some((x) => x.g === 2)) { lastNote = 'Jacob Meowly needs a piece beside the cell you choose.'; render(); return; }
      aim = { idx: i, cat: o.cat, x: o.x }; clearPreview();
      previewEl = makePiece({ id: 'preview', p: o.x === 'w' ? -1 : state.turn, kind: o.cat ? 'c' : 'k', x: o.x }, i); previewEl.classList.add('preview');   // the new piece stays visible while aiming
      render(); return;
    }
    act('play', { idx: i, cat: o.cat, x: o.x, g: selSpirit === 0 || selSpirit === 1 ? selSpirit : undefined });
  }

  function cancelCpu() {
    ++cpuGeneration;
    clearTimeout(cpuTimer); clearTimeout(cpuWatchdog);
    if (cpuWorker) cpuWorker.terminate();
    cpuWorker = null; cpuPlan = null;
  }
  function scheduleCpu() {
    clearTimeout(cpuTimer);
    if (state.phase === 'over' || !isCpu(state.turn)) return;
    const generation = ++cpuGeneration, searchedState = state;
    busy = true;
    render();
    const current = () => generation === cpuGeneration && state === searchedState && isCpu(state.turn);
    const finish = (m) => {
      if (!current()) return;
      clearTimeout(cpuWatchdog);
      if (cpuWorker) cpuWorker.terminate();
      cpuWorker = null; busy = false;
      if (!m) { render(); return; }
      if (m.line !== undefined) return act('line', m.line);
      if (m.promote !== undefined) return act('promote', m.promote);
      if (m.skip) return act('skip');
      if (m.ghost !== undefined) return act('ghost', m.ghost);
      if (m.orn !== null && m.orn !== undefined && state.phase === 'ornament') { cpuPlan = { idx: m.idx, cat: m.cat, x: m.x, g: m.g, d: m.d }; return act('orn', m.orn); }
      act('play', { idx: m.idx, cat: m.cat, x: m.x, g: m.g, d: m.d });
    };
    const fallback = () => {
      if (!current()) return;
      clearTimeout(cpuWatchdog);
      if (cpuWorker) cpuWorker.terminate();
      cpuWorker = null;
      // Keep the game playable even where workers are blocked or fail to load.
      setTimeout(() => {
        if (!current()) return;
        try { finish(L.bestMove(searchedState)); }
        catch (error) { busy = false; render(); console.error('CPU search failed', error); }
      }, 0);
    };
    cpuTimer = setTimeout(() => {
      if (!current()) return;
      const planOk = (pl) => { if (!pl || state.phase !== 'place') return false; try { L.play(state, pl.idx, pl.cat, playOpts(pl)); return true; } catch (e) { return false; } };
      const m = planOk(cpuPlan) ? cpuPlan : null;
      cpuPlan = null;
      if (m) return finish(m);
      try {
        cpuWorker = new Worker('ai-worker.js');
        cpuWorker.onmessage = (event) => {
          if (!current() || event.data.id !== generation) return;
          if (event.data.error) fallback(); else finish(event.data.move);
        };
        cpuWorker.onerror = (event) => { event.preventDefault(); fallback(); };
        cpuWorker.onmessageerror = fallback;
        cpuWatchdog = setTimeout(fallback, 15000);
        cpuWorker.postMessage({ id: generation, state: searchedState });
      } catch (error) { fallback(); }
    }, reduced ? 30 : 520);
  }

  // ---------- panels / status ----------
  function whoLabel(p) {
    if (!net) return isCpu(p) ? '🤖 Computer' : '🙂 Player';
    if (!netView || !netView.host) return '🌐 …';
    if (netView.myIdx === p) return '🙂 You';
    if (p > 0 && !netView.seats[p]) return '⏳ Waiting for a friend';
    return '🌐 Friend';
  }
  function netBanner() {
    if (!net) return '';
    const room = `<b>${net.room}</b>`;
    if (!netView || !netView.host) return `🌐 Room ${room}: connecting to relays… `;
    const me = netView.myIdx === null ? 'watching' : `you are ${NAMES[netView.myIdx]}`;
    const open = netView.seats.filter((x) => !x).length;
    const opp = open ? (open === 1 ? ' · send the link to a friend' : ` · send the link to ${open} more friends`) : '';
    return `🌐 Room ${room} · ${me}${opp}. `;
  }
  // The blankie: a small quilt in its owner's colour.
  const blankieSVG = (p) => `<svg viewBox="0 0 100 100" aria-hidden="true" data-art="blankie"><rect x="8" y="24" width="84" height="54" rx="8" fill="${PAL[p].accent}" stroke="${PAL[p].edge}" stroke-width="5"/><path d="M36 24 V78 M64 24 V78 M8 51 H92" stroke="#ffffffb0" stroke-width="4" fill="none"/></svg>`;
  function renderPanel(p) {
    const el = $('panel' + p);
    const pl = state.pool[p];
    const ob = L.onBoardCount(state, p);
    const ornOn = L.ornamentsOnTree(state, p), ornMax = state.ornActive || 1;
    const active = state.phase !== 'over' && state.turn === p;
    const canPick = active && humanTurn() && state.phase === 'place' && !busy;
    const code = active ? effectivePiece() : null;
    const cat = active && code !== null ? code[0] === 'c' : null;
    const P = state.players || 2, noOrn = state.ornaments === 0;
    // Captured ornaments: with two players they are the opponent's colour, with more they are neutral (the count is all that is tracked).
    const slots = Array.from({ length: state.ornWin || 3 }, (_, k) => (k < state.captured[p] ? ornSVG(P === 2 ? 1 - p : 4) : '<span class="empty"></span>')).join('');
    const count = (c) => (c === 'kw' ? state.wild.k : c === 'cw' ? state.wild.c : (pl[c] || 0));
    const small = (c, svg, label) => `<button type="button" class="pick small${active && code === c ? ' sel' : ''}" data-piece="${c}" ${canPick && pieceCount(c) > 0 ? '' : 'disabled'} aria-pressed="${active && code === c}">${svg}<span class="lbl"><b>${count(c)}</b><small>${label}</small></span></button>`;
    const fest = festive();
    const spiritsLeft = state.boopmas && state.spirits.holder === p ? state.spirits.used.filter((u) => !u).length : 0;
    el.classList.toggle('active', active);
    el.innerHTML = `
      <h2><span class="dot"></span>${NAMES[p]}</h2>
      <div class="who">${whoLabel(p)}${p === 0 ? ' · starts' : ''}${P > 2 ? ` · seat ${p + 1}` : ''}</div>
      <button type="button" class="pick${active && cat === false && code === 'k' ? ' sel' : ''}" data-piece="k" data-cat="0" ${canPick && pl.k ? '' : 'disabled'}
        aria-pressed="${active && code === 'k'}">${catSVG(p, false)}<span class="lbl"><b>${pl.k}</b><small>kittens (K)</small></span></button>
      <button type="button" class="pick${active && code === 'c' ? ' sel' : ''}" data-piece="c" data-cat="1" ${canPick && pl.c ? '' : 'disabled'}
        aria-pressed="${active && code === 'c'}">${catSVG(p, true)}<span class="lbl"><b>${pl.c}</b><small>cats (C)</small></span></button>
      ${state.shuffle ? `<div class="picks">
        ${small('ks', catSVG(p, false, fest, 's'), 'super kitten')}${small('cs', catSVG(p, true, fest, 's'), 'super cat')}
        ${small('ka', catSVG(p, false, fest, 'a'), 'scaredy kitten')}${small('b', blankieSVG(p), 'blankie')}
        ${small('kw', catSVG(-1, false, fest, 'w'), 'wild kitten (shared)')}${small('cw', catSVG(-1, true, fest, 'w'), 'wild cat (shared)')}</div>` : ''}
      ${noOrn ? '' : `<div class="row">${ornSVG(p)}<span>Ornaments: ${ornOn}/${ornMax} on tree · pool ${pl.o}</span></div>
      <div class="row"><span>Captured:</span><span class="slots">${slots}</span></div>`}
      ${state.ghost ? `<div class="row ghostRow">${spiritSVG(p)}<span>Ghost: ${state.ghosts[p].on ? `on the board, ${state.N - 1 - state.ghosts[p].t} stitch${state.N - 1 - state.ghosts[p].t === 1 ? '' : 'es'} to go` : 'in the pool'}</span></div>` : ''}
      ${state.boopmas && state.spirits.holder === p ? `<div class="row power ghostRow">${spiritSVG(p)}<span>Holds the spirit board: ${spiritsLeft} of 3 spirits left</span></div>` : ''}
      <div class="row">On ${state.shape === 'square' ? 'board' : 'tree'}: ${ob.total}/${state.n} · cats ${ob.cats}</div>`;
    el.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => { selPiece = b.dataset.piece; aim = null; clearPreview(); render(); }));
  }

  // Boopmas spirit board: who holds it and which spirits are left; the holder picks one before placing.
  const SPIRIT_BLURB = ['diagonal boops only', 'straight boops only', 'one chosen boop, jumps over blockers'];
  function renderSpirits() {
    const bar = $('spiritBar');
    if (!state.boopmas) { bar.hidden = true; bar.innerHTML = ''; selSpirit = null; aim = null; return; }
    const h = state.spirits.holder, can = state.phase === 'place' && humanTurn() && !busy && spiritHolderNow();
    if (selSpirit !== null && (!can || state.spirits.used[selSpirit])) { selSpirit = null; aim = null; }
    bar.hidden = false;
    bar.innerHTML = `<span>👻 Spirit board: ${h === null ? 'nobody holds it yet (a graduation hands it to the next seat)' : `<b class="p${h}">${NAMES[h]}</b> holds it`}</span>`
      + L.SPIRITS.map((s, g) => `<button type="button" data-g="${g}" class="${selSpirit === g ? 'sel' : ''}${h !== null && state.spirits.used[g] ? ' spent' : ''}" ${can && !state.spirits.used[g] ? '' : 'disabled'} aria-pressed="${selSpirit === g}">${s.name} <small>${SPIRIT_BLURB[g]}</small></button>`).join('');
    bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const g = +b.dataset.g; selSpirit = selSpirit === g ? null : g; aim = null; clearPreview(); render(); }));
  }

  function render() {
    const players = state.players || 2;
    layoutEl.classList.toggle('multi', players > 2);
    boardEl.classList.toggle('multi', players > 2);
    renderSpirits();
    for (let p = 0; p < 4; p++) { $('panel' + p).hidden = p >= players; if (p < players) renderPanel(p); }
    syncPieces();
    syncSpirits();
    for (const i of geo.cells) cellEls[i].classList.remove('allowed', 'opt', 'optCur', 'winline', 'aimable');
    const decorTier = boardEl.querySelector('.tier.decor');
    if (decorTier) decorTier.classList.toggle('glow', state.phase === 'ornament' && humanTurn());
    const who = `<b class="p${state.turn}">${NAMES[state.turn]}</b>`;
    const pre = netBanner() + (lastNote ? lastNote + ' ' : '');
    let msg;
    if (state.phase === 'over') {
      const why = { naughty: `naughty: ${state.ornWin || 3} ornaments knocked off`, 'nice-line': 'nice: three cats in a row', 'nice-all': 'nice: all cats on the tree' }[state.winReason];
      msg = `${pre}🎉 <b class="p${state.winner}">${NAMES[state.winner]}</b> wins (${why})! Press "New game".`;
      if (state.winLine) for (const i of state.winLine) cellEls[i].classList.add('winline');
    } else if (net && !seated()) {
      const open = netView.seats.filter((x) => !x).length;
      msg = `${pre}Waiting for ${open} more ${open === 1 ? 'player' : 'players'} to join before the game starts…`;
    } else if (isCpu(state.turn)) {
      msg = `${pre}${who} is thinking…`;
    } else if (net && !humanTurn()) {
      msg = `${pre}Waiting for ${who}…`;
    } else if (state.phase === 'ornament') {
      msg = `${pre}${who}: hang an ornament on the gold dashed ring (tier ${(state.decor || 1) + 1}).`;
      for (const i of L.ornamentCells(state)) cellEls[i].classList.add('allowed');
    } else if (state.phase === 'chooseLine') {
      msg = `${pre}${who}: several lines. Click a piece in the highlighted line, then click it again to graduate it.`;
      state.options.forEach((Ln, k) => Ln.forEach((i) => cellEls[i].classList.add(k === optCur ? 'optCur' : 'opt')));
    } else if (state.phase === 'ghost') {
      msg = `${pre}${who}: send your ghost cat onto an edge stitch (the arrow buttons around the board), or <button type="button" id="skipGhost">Keep it this turn</button>`;
    } else if (state.phase === 'promote') {
      msg = `${pre}${who}: all your pieces are on the ${state.shape === 'square' ? 'board' : 'tree'}. Click one of yours; it returns as a cat.`;
      for (const i of geo.cells) { const q = state.b[i]; if (q && q.p === state.turn && q.kind !== 'o') pieceEls.get(q.id).classList.add('pickable'); }
    } else if (aim) {
      msg = `${pre}${who}: Jacob Meowly will boop only ONE piece. Click the highlighted piece next to your new piece. <button type="button" id="cancelAim">Cancel</button>`;
      for (const x of L.legalSpirits(state, aim.idx)) if (x.g === 2) cellEls[aim.idx + DIRS8[x.d][0] * geo.N + DIRS8[x.d][1]].classList.add('aimable');
    } else {
      const code = effectivePiece();
      if (code === 'b') {
        msg = `${pre}${who}'s turn: click an awake kitten or cat to put it to sleep under your blankie.`;
        for (const i of geo.cells) if (state.b[i] && !state.b[i].cov) cellEls[i].classList.add('allowed');
      } else msg = `${pre}${who}'s turn: place a ${PIECE_NAME[code] || 'kitten'}${selSpirit !== null ? ` with ${L.SPIRITS[selSpirit].name}` : ''}.`;
    }
    statusEl.innerHTML = msg;
    const cancelBtn = $('cancelAim');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { aim = null; clearPreview(); render(); });
    const skipBtn = $('skipGhost');
    if (skipBtn) { skipBtn.disabled = busy; skipBtn.addEventListener('click', () => { if (!busy) act('skip'); }); }
    syncStitches();
    for (const i of geo.cells) {
      const q = state.b[i];
      let dis = busy || !humanTurn();
      if (!dis && state.phase === 'place') dis = aim ? !cellEls[i].classList.contains('aimable') : effectivePiece() === 'b' ? !q || !!q.cov : !!q;
      if (!dis && state.phase === 'ornament') dis = !cellEls[i].classList.contains('allowed');
      if (state.phase === 'ghost') dis = true;   // the ghost step uses the edge stitches, not the cells
      cellEls[i].disabled = dis;
    }
    $('undo').disabled = busy || !history.length || !!net;
    $('newGame').disabled = busy;
    for (const id of ['mode', 'players', 'boardKind', 'levels', 'size', 'ghost', 'boopmas', 'pieces', 'ornaments']) $(id).disabled = busy || !!net;
    for (const id of ['view', 'onlineBtn', 'rotL', 'rotR', 'tiltUp', 'tiltDown', 'zoomIn', 'zoomOut', 'camReset']) $(id).disabled = busy;
    // While in an online room the board follows the room's game, not the local selectors.
    const sq = net ? state.shape === 'square' : isSquare();
    $('mode').value = settings.mode;
    $('players').value = String(net ? state.players : playersNow());
    for (const o of $('pieces').options) if (o.value !== 'auto') o.disabled = +o.value > maxPiecesNow();
    const shuf = net ? !!state.shuffle : isShuffle();
    $('boardKind').value = sq ? (shuf ? 'shuffle' : 'square') : 'tree';
    $('levels').value = String(net && !sq ? state.L : settings.levels);
    $('size').value = String(net && sq ? state.L : settings.size);
    $('ghost').value = (net ? state.ghost : settings.ghost) ? 'on' : 'off';
    $('levelsBox').hidden = sq; $('ornBox').hidden = sq; $('sizeBox').hidden = !sq; $('ghostBox').hidden = !sq || shuf; $('boopmasBox').hidden = sq;
    $('boopmas').value = (net ? state.boopmas : settings.boopmas) ? 'on' : 'off';
    $('pieces').value = String(settings.pieces);
    $('pieces').options[0].textContent = `Auto (${autoNow()})`;
    $('view').value = settings.view;
    $('ornaments').value = settings.ornaments;
    $('logoEmoji').textContent = sq ? '🐾' : '🎄';
    updateSky();
  }

  // ---------- save ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state, history: history.slice(-80) })); } catch (e) { /* full */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      const s = L.restoreState(d && d.state);   // validates 2-4 players; saves from before multiplayer are 2-player
      if (s) {
        const hist = Array.isArray(d.history) ? d.history.map(L.restoreState) : [];
        state = s; history = hist.every(Boolean) ? hist : [];
        settings.players = s.players;           // the selectors follow the loaded game
        settings.board = s.shuffle ? 'shuffle' : s.shape;
        if (s.shape === 'square') { settings.size = s.L; settings.ghost = s.ghost; } else { settings.levels = s.L; settings.ghost = false; settings.boopmas = !!s.boopmas; }
        return true;
      }
    } catch (e) { /* corrupt save */ }
    return false;
  }
  function persistSettings() { localStorage.setItem(SET_KEY, JSON.stringify(settings)); }

  function newGame() {
    if (net) leaveOnline(false);
    cancelCpu();
    state = L.newGame(gameOpts());
    history = []; selPiece = 'k'; selSpirit = null; aim = null; busy = false; lastNote = ''; optCur = 0;
    buildBoard();
    save(); render(); scheduleCpu();
  }
  function undo() {
    if (busy || !history.length || net) return;
    cancelCpu();
    state = history.pop();
    while (settings.mode === 'cpu' && isCpu(state.turn) && history.length) state = history.pop();
    for (const el of pieceEls.values()) el.remove();
    pieceEls.clear();
    for (const el of spiritEls.values()) el.remove();
    spiritEls.clear();
    lastNote = ''; aim = null; selSpirit = null;
    save(); render(); scheduleCpu();
  }
  function rotate(deg) {
    settings.spin = ((settings.spin + deg) % 360 + 360) % 360;
    persistSettings();
    applyCamera();
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function setTilt(t) { settings.tilt = clamp(t, 0, 84); persistSettings(); applyCamera(); }
  function setZoom(z) { settings.zoom = clamp(z, 0.5, 2.4); persistSettings(); applyCamera(); }
  function resetCamera() { settings.spin = SPIN0; settings.tilt = TILT0; settings.zoom = 1; persistSettings(); applyCamera(); }
  // Camera change without rebuilding the board: board transform + billboards.
  function applyCamera() {
    if (!is3d()) return;
    boardEl.style.transform = camTransform();
    updateSky();
    placeAll();
  }

  // ---------- 3D drag-to-rotate ----------
  let dragging = false, suppressClick = false, drag0 = null;
  wrapEl.addEventListener('pointerdown', (e) => {
    if (busy || !is3d() || e.button !== 0) return;
    drag0 = { x: e.clientX, y: e.clientY, spin: settings.spin, tilt: settings.tilt };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag0) return;
    const dx = e.clientX - drag0.x, dy = e.clientY - drag0.y;
    if (!dragging && Math.abs(dx) + Math.abs(dy) > 6) { dragging = true; clearPreview(); wrapEl.classList.add('dragging'); boardEl.style.transition = 'none'; }
    if (dragging) {
      settings.spin = drag0.spin - dx * 0.4;
      settings.tilt = clamp(drag0.tilt - dy * 0.3, 0, 84);
      for (const el of pieceEls.values()) el.style.transition = 'none';
      boardEl.style.transform = camTransform();
      updateSky();
      placeAll();
    }
  });
  wrapEl.addEventListener('wheel', (e) => {
    if (busy || !is3d()) return;
    e.preventDefault();
    setZoom(settings.zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  window.addEventListener('pointerup', () => {
    if (!drag0) return;
    if (dragging) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      wrapEl.classList.remove('dragging');
      boardEl.style.transition = '';
      for (const el of pieceEls.values()) el.style.transition = '';
      persistSettings();
    }
    dragging = false; drag0 = null;
  });

  // ---------- online rooms (Nostr) ----------
  const params = new URLSearchParams(location.search);
  const relayParam = params.get('relays');
  let nostrLoad = null;
  function loadNostr() {
    if (window.NostrTools) return Promise.resolve();
    if (!nostrLoad) nostrLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/nostr-tools-2.25.5.bundle.js';
      s.onload = () => res(); s.onerror = () => { nostrLoad = null; rej(new Error('could not load nostr-tools')); };
      document.head.appendChild(s);
    });
    return nostrLoad;
  }
  async function ensureClient() {
    await loadNostr();
    if (!net) {
      net = new window.BoopOnline.Client({ NostrTools: window.NostrTools, Logic: L, relays: relayParam ? relayParam.split(',') : null, onChange: onNet });
    }
    return net;
  }
  function roomLink(room) {
    const u = new URL(location.href);
    u.search = ''; u.searchParams.set('room', room);
    if (relayParam) u.searchParams.set('relays', relayParam);
    return u.toString();
  }
  async function startOnline(room, cfg) {
    if (!cfg) window.BoopOnline.invitation(room);
    cancelCpu();
    busy = false;
    const c = await ensureClient();
    netView = null; netSeq = 0; netIds = []; netPending = false; lastNote = '';
    if (cfg) room = c.create(cfg); else c.open(room);
    boardRoom = null;
    window.history.replaceState(null, '', roomLink(room));
    renderOnlineDialog();
    render();
    return room;
  }
  function leaveOnline(reloadLocal) {
    if (!net) return;
    net.close();
    net = null; netView = null;
    const u = new URL(location.href); u.searchParams.delete('room');
    netIds = []; netSeq = 0; boardReplay = null; netPending = false;
    boardRoom = null;
    window.history.replaceState(null, '', u.toString());
    if (reloadLocal) {
      if (!load()) state = L.newGame(gameOpts());
      buildBoard(); render(); scheduleCpu();
    }
    renderOnlineDialog();
  }
  // Room events changed: replay is the truth. Animate one new move, otherwise jump to the replayed state.
  function replaceReplay(view) {
    boardRoom = net.room; boardReplay = replayIdentity(view);
    state = view.state; netSeq = view.seq; netIds = view.actionIds.slice(); lastNote = '';
    history = []; clearPreview(); buildBoard();
  }
  function onNet(view) {
    if (!net) return;
    netView = view;
    renderSeats();
    if (busy) { netPending = true; return; }
    if (!view.state) { render(); return; }
    if (boardRoom !== net.room || boardReplay !== replayIdentity(view)) {
      replaceReplay(view); render(); return;
    }
    const samePrefix = netIds.every((id, i) => view.actionIds[i] === id);
    if (samePrefix && view.seq === netSeq + 1) {  // only append to the exact accepted prefix
      const a = view.actions[netSeq];
      if (a.k === 'play') act('play', { idx: a.i, cat: a.c, x: a.x, g: a.g, d: a.d }, view); else act(a.k, a.i, view);
      return;
    }
    if (!samePrefix || view.seq !== netSeq) replaceReplay(view);
    render();
  }
  function renderOnlineDialog() {
    const box = $('onlineBody');
    if (!box) return;
    if (net && net.room) {
      const multi = net.room.startsWith('b3.'), P = (netView && netView.players) || playersNow();
      box.innerHTML = `<p>${multi ? `Send this full invitation to your friends. The host admits join requests in order, each into the next open seat; when all ${P} seats are taken the game starts and anyone else can only watch.` : 'Send this full invitation to your friend. The host admits the first received join request as <b>Coal</b>; anyone after that can watch.'} The host must be online to admit a new player.</p>
        <ul class="seats" id="seatList"></ul>
        <p class="linkrow"><input id="roomLink" readonly value="${roomLink(net.room)}"><button id="copyLink" type="button">Copy</button></p>
        <p class="hint">Moves travel as signed Nostr events through public relays (${net.relays.length}). No account needed.</p>
        <p><button id="leaveRoom" type="button">Leave room</button></p>`;
      $('copyLink').onclick = async () => { const i = $('roomLink'); i.select(); try { await navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } $('copyLink').textContent = 'Copied ✓'; };
      $('leaveRoom').onclick = () => { leaveOnline(true); };
      renderSeats();
    } else {
      box.innerHTML = `<p><button id="createRoom" type="button">Create a room</button> <span class="hint">uses the current Board, Players, Kittens and ghost/ornament settings. You play Snowball.</span></p>
        <p class="linkrow"><input id="joinCode" placeholder="Room link or code"><button id="joinRoom" type="button">Join</button></p>`;
      $('createRoom').onclick = () => startOnline(null, gameOpts()).catch(showNetError);
      $('joinRoom').onclick = () => {
        const v = $('joinCode').value.trim();
        let room = v;
        try { room = new URL(v).searchParams.get('room') || ''; } catch (e) { /* full invitation code */ }
        startOnline(room).catch(showNetError);
      };
    }
  }
  // Live seat list in the online dialog: who sits where, and what is still open.
  function renderSeats() {
    const ul = $('seatList');
    if (!ul || !net) return;
    const seats = (netView && netView.seats) || [];
    ul.innerHTML = seats.map((pk, i) => `<li><span class="dot s${i}"></span><b>${NAMES[i]}</b> ${pk ? (pk === net.pubkey ? '(you)' : `joined <small>${pk.slice(0, 6)}…</small>`) : '<i>open</i>'}</li>`).join('');
  }
  function showNetError(e) { statusEl.textContent = '⚠️ Online play is unavailable: ' + e.message; }
  $('onlineBtn').addEventListener('click', () => { renderOnlineDialog(); $('onlineDlg').showModal(); });

  // ---------- wiring ----------
  $('newGame').addEventListener('click', newGame);
  $('undo').addEventListener('click', undo);
  $('rulesBtn').addEventListener('click', () => $('rules').showModal());
  $('rotL').addEventListener('click', () => rotate(-45));
  $('rotR').addEventListener('click', () => rotate(45));
  $('tiltUp').addEventListener('click', () => setTilt(settings.tilt - 12));
  $('tiltDown').addEventListener('click', () => setTilt(settings.tilt + 12));
  $('zoomIn').addEventListener('click', () => setZoom(settings.zoom * 1.2));
  $('zoomOut').addEventListener('click', () => setZoom(settings.zoom / 1.2));
  $('camReset').addEventListener('click', resetCamera);
  $('mode').addEventListener('change', (e) => { settings.mode = e.target.value; persistSettings(); render(); scheduleCpu(); });
  $('players').addEventListener('change', (e) => { settings.players = +e.target.value; clampPieces(); persistSettings(); newGame(); });
  $('boardKind').addEventListener('change', (e) => { settings.board = e.target.value === 'square' || e.target.value === 'shuffle' ? e.target.value : 'tree'; clampPieces(); persistSettings(); newGame(); });
  $('boopmas').addEventListener('change', (e) => { settings.boopmas = e.target.value === 'on'; persistSettings(); newGame(); });
  $('levels').addEventListener('change', (e) => { settings.levels = +e.target.value; clampPieces(); persistSettings(); newGame(); });
  $('size').addEventListener('change', (e) => { settings.size = +e.target.value; clampPieces(); persistSettings(); newGame(); });
  $('ghost').addEventListener('change', (e) => { settings.ghost = e.target.value === 'on'; persistSettings(); newGame(); });
  $('pieces').addEventListener('change', (e) => { settings.pieces = e.target.value === 'auto' ? 'auto' : +e.target.value; persistSettings(); newGame(); });
  $('ornaments').addEventListener('change', (e) => { settings.ornaments = e.target.value; persistSettings(); newGame(); });
  $('view').addEventListener('change', (e) => { settings.view = e.target.value; persistSettings(); measure(); });
  document.addEventListener('keydown', (e) => {
    if (busy || e.target.tagName === 'SELECT' || $('rules').open) return;
    const k = e.key.toLowerCase();
    if (k === 'k') { selPiece = 'k'; aim = null; clearPreview(); render(); }
    else if (k === 'c') { selPiece = 'c'; aim = null; clearPreview(); render(); }
    else if (k === 'escape' && aim) { aim = null; clearPreview(); render(); }
    else if (k === 'u') undo();
    else if (k === 'q' && is3d()) rotate(-45);
    else if (k === 'w' && is3d()) setTilt(settings.tilt - 12);
    else if (k === 's' && is3d()) setTilt(settings.tilt + 12);
    else if ((k === '+' || k === '=') && is3d()) setZoom(settings.zoom * 1.2);
    else if (k === '-' && is3d()) setZoom(settings.zoom / 1.2);
    else if (k === 'e' && is3d()) rotate(45);
  });
  window.addEventListener('resize', () => geo && measure());
  window.addEventListener('scroll', updateSky, { passive: true });
  new ResizeObserver(() => geo && updateSky()).observe(wrapEl);

  // ---------- snow ----------
  (function snow() {
    const cv = $('snow'), cx = cv.getContext('2d');
    let flakes = [];
    function size() {
      cv.width = innerWidth; cv.height = innerHeight;
      flakes = Array.from({ length: Math.min(160, Math.floor(innerWidth / 9)) }, () => ({
        x: Math.random() * cv.width, y: Math.random() * cv.height, r: 0.8 + Math.random() * 2.4, v: 0.3 + Math.random() * 0.9, w: Math.random() * 6.28,
      }));
    }
    size(); addEventListener('resize', size);
    let last = 0;
    function tick(now = 0) {
      if (is3d()) { if (!reduced) requestAnimationFrame(tick); return; }
      if (!reduced && now - last < 33) { requestAnimationFrame(tick); return; }
      last = now;
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.fillStyle = '#ffffffa0';
      for (const f of flakes) {
        f.y += f.v; f.w += 0.01; f.x += Math.sin(f.w) * 0.4;
        if (f.y > cv.height + 4) { f.y = -4; f.x = Math.random() * cv.width; }
        cx.beginPath(); cx.arc(f.x, f.y, f.r, 0, 6.283); cx.fill();
      }
      if (!reduced) requestAnimationFrame(tick);
    }
    tick();
  })();

  if (!load()) state = L.newGame(gameOpts());
  buildBoard();
  render();
  const roomParam = params.get('room');
  if (roomParam && window.BoopOnline) startOnline(roomParam).catch(showNetError);
  else scheduleCpu();
  if (!localStorage.getItem(SEEN_KEY)) { localStorage.setItem(SEEN_KEY, '1'); $('rules').showModal(); }

  // Test/diagnostic hook.
  window.__boop = {
    get state() { return state; }, get busy() { return busy; }, get settings() { return settings; }, get aim() { return aim; }, get selPiece() { return selPiece; }, get selSpirit() { return selSpirit; },
    newGame, undo, rotate, maxPieces: maxPiecesNow, pieceCount: () => pieceEls.size, cellSize: () => S,
    motion: { boopMs: BOOP_MS, scareMs: SCARE_MS, ghostStepMs: GHOST_STEP_MS, placePauseMs: PLACE_PAUSE_MS, easing: EASE },
    get net() { return net && { room: net.room, pubkey: net.pubkey, view: netView, seq: netSeq }; },
  };
})();
