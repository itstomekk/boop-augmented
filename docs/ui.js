// Boop Augmented - DOM UI (2D top-down and CSS 3D view), animation, CPU turns, save.
(function () {
  'use strict';
  const L = window.BoopLogic;
  const $ = (id) => document.getElementById(id);
  const boardEl = $('board'), wrapEl = $('boardWrap'), statusEl = $('status');
  const SAVE_KEY = 'boop-augmented-save-v1';
  const SET_KEY = 'boop-augmented-settings-v1';
  const SEEN_KEY = 'boop-augmented-seen-rules-v1';
  const NAMES = ['Snowball', 'Coal'];
  const CPU_PLAYER = 1;
  const TILT0 = 58, SPIN0 = 30; // default 3D camera tilt / spin (deg)
  const TIER_H = 0.42;       // tier step height, in cells
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let settings = { mode: 'cpu', levels: 4, pieces: 'auto', ornaments: 'auto', view: '2d', spin: SPIN0, tilt: TILT0, zoom: 1 };
  // Auto kittens: 8 on the classic tree, +2 per extra tier (balance_sim.js keeps games ~25 turns each).
  const autoPieces = (levels) => 8 + 2 * (levels - 4);
  const piecesFor = () => (settings.pieces === 'auto' ? autoPieces(settings.levels) : +settings.pieces);
  // Auto ornaments on bigger trees (balance_sim.js): more ornaments, several hanging at once, and the
  // decorating tier is always 3rd from the bottom, so they stay as close to the edge as on the classic tree.
  // On the classic 4-tier tree Auto equals the official rule (3 ornaments, 1 at a time, tier 2).
  const ornCfg = (levels) => (settings.ornaments === 'classic' || levels === 4
    ? { ornaments: 3, ornActive: 1, decor: 1 }
    : { ornaments: Math.min(6, levels - 1), ornActive: 1 + Math.floor((levels - 3) / 2), decor: levels - 3 });
  const gameOpts = () => Object.assign({ levels: settings.levels, pieces: piecesFor() }, ornCfg(settings.levels));
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) { /* ignore */ }
  let cpuPlan = null;
  let net = null, netView = null, netSeq = 0, netPending = false, boardRoom = null; // online room (Nostr)
  let state = null, history = [], selCat = false, busy = false, S = 64, cpuTimer = null, optCur = 0, lastNote = '';
  let geo = null;
  const pieceEls = new Map();
  let cellEls = [];
  const is3d = () => settings.view === '3d';

  // ---------- art ----------
  const PAL = [
    { fur: '#f6f1e6', edge: '#c9b98f', accent: '#f3c34f', eye: '#2a2a2a', hat: '#f3c34f', trim: '#fff' },   // white & gold
    { fur: '#2b2b33', edge: '#a3a3b4', accent: '#e2403f', eye: '#ffd86b', hat: '#c4161c', trim: '#fff' },   // black & red
  ];
  function catSVG(p, cat) {
    const c = PAL[p];
    const hat = cat
      ? `<path d="M26 32 Q48 -8 78 20 L74 34 Z" fill="${c.hat}"/><rect x="21" y="27" width="60" height="10" rx="5" fill="${c.trim}"/><circle cx="80" cy="18" r="7" fill="${c.trim}"/>`
      : `<path d="M30 92 Q50 100 70 92" stroke="${c.accent}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    return `<svg viewBox="0 -8 100 112" aria-hidden="true">
      <path d="M18 46 L22 10 L45 31 Z" fill="${c.fur}" stroke="${c.edge}" stroke-width="3"/>
      <path d="M82 46 L78 10 L55 31 Z" fill="${c.fur}" stroke="${c.edge}" stroke-width="3"/>
      <ellipse cx="50" cy="60" rx="38" ry="34" fill="${c.fur}" stroke="${c.edge}" stroke-width="4"/>
      <ellipse cx="36" cy="57" rx="5.5" ry="7.5" fill="${c.eye}"/><ellipse cx="64" cy="57" rx="5.5" ry="7.5" fill="${c.eye}"/>
      <circle cx="38" cy="54" r="1.8" fill="#fff"/><circle cx="66" cy="54" r="1.8" fill="#fff"/>
      <path d="M46 68 L54 68 L50 73 Z" fill="${c.accent}"/>
      <path d="M50 73 Q44 80 38 76 M50 73 Q56 80 62 76" stroke="${c.edge}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      ${hat}</svg>`;
  }
  function ornSVG(p) {
    const col = p === 0 ? ['#ffe08a', '#d79b1c'] : ['#ff7a6e', '#a8141a'];
    const id = 'og' + p;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><radialGradient id="${id}" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="${col[0]}"/><stop offset="1" stop-color="${col[1]}"/></radialGradient></defs>
      <rect x="40" y="4" width="20" height="14" rx="3" fill="#c9c9c9" stroke="#888" stroke-width="2"/>
      <circle cx="50" cy="58" r="38" fill="url(#${id})" stroke="${col[1]}" stroke-width="3"/>
      <path d="M16 52 Q50 70 84 52" stroke="#ffffffaa" stroke-width="5" fill="none"/>
      <ellipse cx="36" cy="40" rx="9" ry="6" fill="#ffffffb0" transform="rotate(-30 36 40)"/></svg>`;
  }
  const svgFor = (q) => (q.kind === 'o' ? ornSVG(q.p) : catSVG(q.p, q.kind === 'c'));
  const tierLight = (k) => 19 + ((geo.L - 1 - k) / (geo.L - 1)) * 30;

  // ---------- geometry helpers ----------
  const H = () => S * TIER_H;
  const zRing = (k) => (is3d() ? (geo.L - k) * H() : 0);
  const zOf = (r, c) => (L.onBoard(geo, r, c) ? zRing(geo.ring[r * geo.N + c]) : 0);
  const billboard = () => `rotateZ(${-settings.spin}deg) rotateX(${-settings.tilt}deg)`;
  const camTransform = () => `scale(${settings.zoom}) rotateX(${settings.tilt}deg) rotateZ(${settings.spin}deg)`;
  // Tree-topper: a standing 3D star centred on the treetop cell, lifted a little above it.
  const starTransform = () => `translateZ(${zRing(0) + S * 0.25}px)`;

  // ---------- layout ----------
  function measure() {
    const w = wrapEl.clientWidth;
    const top = wrapEl.getBoundingClientRect().top + window.scrollY;
    const h = Math.max(300, window.innerHeight - top - 60);
    const N = geo.N;
    // 3D: size the board so it fits at ANY spin and tilt (diagonal x tower height), then zoom on top.
    const D = N * 1.42, T = geo.L * TIER_H + 1.6;
    if (is3d()) S = Math.max(14, Math.min(80, Math.floor(Math.min(w / D, h / Math.hypot(D, T)) * 0.94)));
    else S = Math.max(18, Math.min(96, Math.floor(Math.min(w, h) / N)));
    document.documentElement.style.setProperty('--S', S + 'px');
    const W = N * S;
    wrapEl.classList.toggle('v3d', is3d());
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
    buildWalls();
    const star = boardEl.querySelector('.topstar');
    Object.assign(star.style, { left: geo.m * S + 'px', top: geo.m * S + 'px', width: S + 'px', height: S + 'px' });
    star.style.transform = is3d() ? starTransform() : '';
    for (const i of geo.cells) {
      const el = cellEls[i];
      el.style.left = (i % N) * S + 'px';
      el.style.top = ((i / N) | 0) * S + 'px';
      el.style.transform = is3d() ? `translateZ(${zRing(geo.ring[i]) + 1}px)` : '';
    }
    placeAll();
    $('rotBox').classList.toggle('hidden', !is3d());
  }
  function placeAll() {
    for (const el of pieceEls.values()) placeEl(el, el._r, el._c);
    if (ghostEl) placeEl(ghostEl, ghostEl._r, ghostEl._c);
  }
  function placeEl(el, r, c) {
    el._r = r; el._c = c;
    if (is3d()) {
      const lift = el.classList.contains('orn') ? -30 : -36;
      el.style.transform = `translate3d(${c * S}px, ${r * S}px, ${zOf(r, c) + 2}px) ${billboard()} translateY(${lift}%)`;
    } else el.style.transform = `translate(${c * S}px, ${r * S}px)`;
  }

  // Side walls of each tier so the 3D tree reads as stacked slabs.
  function buildWalls() {
    boardEl.querySelectorAll('.wall').forEach((w) => w.remove());
    if (!is3d()) return;
    const first = boardEl.querySelector('.topstar');
    const add = (x, y, len, zb, h, horiz, light) => {
      const d = document.createElement('div');
      d.className = 'wall';
      const shade = horiz ? light - 7 : light - 11;
      d.style.background = `linear-gradient(${horiz ? '0deg' : '90deg'}, hsl(145 48% ${shade - 5}%), hsl(145 48% ${shade}%))`;
      if (horiz) Object.assign(d.style, { left: x + 'px', top: y + 'px', width: len + 'px', height: h + 'px', transformOrigin: '50% 0', transform: `translateZ(${zb}px) rotateX(90deg)` });
      else Object.assign(d.style, { left: x + 'px', top: y + 'px', width: h + 'px', height: len + 'px', transformOrigin: '0 50%', transform: `translateZ(${zb}px) rotateY(-90deg)` });
      boardEl.insertBefore(d, first);
    };
    const W = geo.N * S, h = H();
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
    geo = L.geometry(state.L);
    boardEl.innerHTML = '';
    pieceEls.clear();
    cellEls = [];
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
    star.className = 'topstar'; star.innerHTML = '<span class="sp a"><i>⭐</i></span><span class="sp b"><i>⭐</i></span>';
    star.title = 'Treetop: the single cell of tier 1';
    boardEl.appendChild(star);
    for (const i of geo.cells) {
      const r = (i / geo.N) | 0, c = i % geo.N;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cell'; b.dataset.idx = i;
      b.setAttribute('aria-label', `Tier ${geo.ring[i] + 1}, row ${r + 1}, column ${c + 1}${geo.ring[i] === 0 ? ' (treetop)' : ''}`);
      b.addEventListener('click', () => onCell(i));
      b.addEventListener('mouseenter', () => showGhost(i));
      b.addEventListener('focus', () => showGhost(i));
      b.addEventListener('mouseleave', clearGhost);
      b.addEventListener('blur', clearGhost);
      cellEls[i] = b;
      boardEl.appendChild(b);
    }
    measure();
  }

  // ---------- pieces ----------
  const kindClass = (k) => (k === 'o' ? 'orn' : k === 'c' ? 'cat' : 'kitten');
  function makePiece(q, idx) {
    const el = document.createElement('div');
    el.className = 'piece ' + kindClass(q.kind);
    el.dataset.id = q.id; el.dataset.p = q.p; el.dataset.kind = q.kind;
    el.innerHTML = svgFor(q);
    placeEl(el, (idx / geo.N) | 0, idx % geo.N);
    boardEl.appendChild(el);
    if (q.id !== 'ghost') pieceEls.set(q.id, el);
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
      placeEl(el, (i / geo.N) | 0, i % geo.N);
    }
    for (const [id, el] of pieceEls) if (!alive.has(id)) { el.remove(); pieceEls.delete(id); }
  }

  // ---------- ghost preview ----------
  let ghostEl = null;
  function clearGhost() {
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    for (const el of pieceEls.values()) el.classList.remove('nudge');
  }
  function showGhost(i) {
    clearGhost();
    if (busy || !humanTurn() || state.b[i] || dragging) return;
    if (state.phase === 'ornament') {
      if (!L.ornamentCells(state).includes(i)) return;
      ghostEl = makePiece({ id: 'ghost', p: state.turn, kind: 'o' }, i);
    } else if (state.phase === 'place') {
      const cat = effectiveCat();
      if (cat === null) return;
      ghostEl = makePiece({ id: 'ghost', p: state.turn, kind: cat ? 'c' : 'k' }, i);
      for (const bp of L.play(state, i, cat).boops) { const el = pieceEls.get(bp.id); if (el) el.classList.add('nudge'); }
    } else return;
    ghostEl.classList.add('ghost');
  }

  // ---------- turn flow ----------
  const isCpu = (p) => !net && settings.mode === 'cpu' && p === CPU_PLAYER;
  const humanTurn = () => state.phase !== 'over' && (net ? !!netView && netView.myIdx === state.turn : !isCpu(state.turn));
  function effectiveCat() {
    const pl = state.pool[state.turn];
    if (selCat && pl.c > 0) return true;
    if (!selCat && pl.k > 0) return false;
    if (pl.k > 0) return false;
    if (pl.c > 0) return true;
    return null;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  const idsOn = (st) => new Set(st.b.filter(Boolean).map((q) => q.id));

  async function animatePlay(prev, res) {
    clearGhost();
    makePiece({ id: res.placed.id, p: res.placed.p, kind: res.placed.kind }, res.placed.idx);
    await wait(140);
    const notes = [];
    for (const bp of res.boops) {
      const el = pieceEls.get(bp.id);
      if (!el) continue;
      placeEl(el, bp.tr, bp.tc);
      if (bp.result === 'off' || bp.result === 'returned' || bp.result === 'captured') el.classList.add('gone');
      if (bp.result === 'captured') notes.push(`💥 ${NAMES[bp.by]} knocks off an ornament!`);
      if (bp.result === 'returned') notes.push(`${NAMES[bp.owner]} gets their ornament back.`);
      if (bp.result === 'pounce') {
        el.classList.add('gone');
        const oe = pieceEls.get(bp.ornId);
        if (oe) { oe.classList.add('flash'); setTimeout(() => oe.classList.add('gone'), reduced ? 0 : 200); }
        notes.push(bp.ornResult === 'captured' ? `🐾 Pounce! ${NAMES[bp.by]} captures an ornament.` : `🐾 ${NAMES[bp.by]} rescues their own ornament.`);
      }
    }
    if (res.boops.length) await wait(360);
    // Pieces removed by graduation = still on the tree after boops, gone in the result.
    const finalIds = idsOn(res.state);
    const gradIds = [];
    for (const [id, el] of pieceEls) if (!el.classList.contains('gone') && !finalIds.has(id) && el.dataset.kind !== 'o') gradIds.push(id);
    const st = res.state;
    if (st.winLine) for (const i of st.winLine) cellEls[i].classList.add('winline');
    if (gradIds.length) {
      for (const id of gradIds) pieceEls.get(id).classList.add('grad');
      await wait(600);
      for (const id of gradIds) pieceEls.get(id).classList.add('gone');
      await wait(280);
      notes.push(`✨ ${NAMES[prev.turn]} graduates: ${gradIds.length} ${gradIds.length === 1 ? 'cat' : 'cats'} to the pool.`);
    } else if (st.winLine) await wait(500);
    lastNote = notes.join(' ');
  }

  const toAction = (kind, arg) => (kind === 'play' ? { k: 'play', i: arg.idx, c: !!arg.cat } : { k: kind, i: arg });
  async function act(kind, arg, remote) {
    if (net && !remote) net.sendMove(netSeq, toAction(kind, arg));
    busy = true;
    clearGhost();
    history.push(state);
    const prev = state;
    if (kind === 'orn') {
      const res = L.placeOrnament(state, arg);
      makePiece({ id: res.placed.id, p: res.placed.p, kind: 'o' }, arg);
      await wait(260);
      state = res.state;
      lastNote = '';
    } else if (kind === 'play') {
      const res = L.play(state, arg.idx, arg.cat);
      await animatePlay(prev, res);
      state = res.state;
    } else if (kind === 'line') {
      const res = L.chooseLine(state, arg);
      for (const id of res.ids) pieceEls.get(id).classList.add('grad');
      await wait(450);
      for (const id of res.ids) pieceEls.get(id).classList.add('gone');
      await wait(260);
      state = res.state;
      lastNote = `✨ ${NAMES[prev.turn]} graduates: 3 cats to the pool.`;
    } else if (kind === 'promote') {
      const res = L.promote(state, arg);
      const el = pieceEls.get(res.removed.id);
      if (el) { el.classList.add('grad'); await wait(320); el.classList.add('gone'); await wait(240); }
      state = res.state;
      lastNote = `✨ ${NAMES[prev.turn]} takes a piece back as a cat.`;
    }
    afterAct();
  }

  function afterAct() {
    optCur = 0;
    if (net) netSeq++;
    if (state.phase === 'place') {
      const pl = state.pool[state.turn];
      if (selCat && pl.c === 0) selCat = false;
      if (!selCat && pl.k === 0) selCat = true;
    }
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
    if (state.phase !== 'place' || q) return;
    const cat = effectiveCat();
    if (cat !== null) act('play', { idx: i, cat });
  }

  function scheduleCpu() {
    clearTimeout(cpuTimer);
    if (state.phase === 'over' || !isCpu(state.turn)) return;
    busy = true;
    render();
    cpuTimer = setTimeout(() => {
      // Reuse the placement planned together with the ornament, if it is still legal.
      let m = cpuPlan && state.phase === 'place' && !state.b[cpuPlan.idx] && state.pool[state.turn][cpuPlan.cat ? 'c' : 'k'] > 0 ? cpuPlan : null;
      cpuPlan = null;
      if (!m) m = L.bestMove(state);
      busy = false;
      if (!m) { render(); return; }
      if (m.line !== undefined) return act('line', m.line);
      if (m.promote !== undefined) return act('promote', m.promote);
      if (m.orn !== null && m.orn !== undefined && state.phase === 'ornament') { cpuPlan = { idx: m.idx, cat: m.cat }; return act('orn', m.orn); }
      act('play', { idx: m.idx, cat: m.cat });
    }, reduced ? 30 : 520);
  }

  // ---------- panels / status ----------
  function whoLabel(p) {
    if (!net) return isCpu(p) ? '🤖 Computer' : '🙂 Player';
    if (!netView || !netView.host) return '🌐 …';
    if (netView.myIdx === p) return '🙂 You';
    if (p === 1 && !netView.guest) return '⏳ Waiting for a friend';
    return '🌐 Friend';
  }
  function netBanner() {
    if (!net) return '';
    const room = `<b>${net.room}</b>`;
    if (!netView || !netView.host) return `🌐 Room ${room}: connecting to relays… `;
    const me = netView.myIdx === null ? 'watching' : `you are ${NAMES[netView.myIdx]}`;
    const opp = netView.guest ? '' : ' · send the link to a friend';
    return `🌐 Room ${room} · ${me}${opp}. `;
  }
  function renderPanel(p) {
    const el = $('panel' + p);
    const pl = state.pool[p];
    const ob = L.onBoardCount(state, p);
    const ornOn = L.ornamentsOnTree(state, p), ornMax = state.ornActive || 1;
    const active = state.phase !== 'over' && state.turn === p;
    const canPick = active && humanTurn() && state.phase === 'place' && !busy;
    const cat = active ? effectiveCat() : null;
    const slots = [0, 1, 2].map((k) => (k < state.captured[p] ? ornSVG(1 - p) : '<span class="empty"></span>')).join('');
    el.classList.toggle('active', active);
    el.innerHTML = `
      <h2><span class="dot"></span>${NAMES[p]}</h2>
      <div class="who">${whoLabel(p)}${p === 0 ? ' · starts' : ''}</div>
      <button type="button" class="pick${active && cat === false ? ' sel' : ''}" data-cat="0" ${canPick && pl.k ? '' : 'disabled'}
        aria-pressed="${active && cat === false}">${catSVG(p, false)}<span class="lbl"><b>${pl.k}</b><small>kittens (K)</small></span></button>
      <button type="button" class="pick${active && cat === true ? ' sel' : ''}" data-cat="1" ${canPick && pl.c ? '' : 'disabled'}
        aria-pressed="${active && cat === true}">${catSVG(p, true)}<span class="lbl"><b>${pl.c}</b><small>cats (C)</small></span></button>
      <div class="row">${ornSVG(p)}<span>Ornaments: ${ornOn}/${ornMax} on tree · pool ${pl.o}</span></div>
      <div class="row"><span>Captured:</span><span class="slots">${slots}</span></div>
      <div class="row">On tree: ${ob.total}/${state.n} · cats ${ob.cats}</div>`;
    el.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => { selCat = b.dataset.cat === '1'; render(); }));
  }

  function render() {
    renderPanel(0); renderPanel(1);
    syncPieces();
    for (const i of geo.cells) cellEls[i].classList.remove('allowed', 'opt', 'optCur', 'winline');
    boardEl.querySelector('.tier.decor').classList.toggle('glow', state.phase === 'ornament' && humanTurn());
    const who = `<b class="p${state.turn}">${NAMES[state.turn]}</b>`;
    const pre = netBanner() + (lastNote ? lastNote + ' ' : '');
    let msg;
    if (state.phase === 'over') {
      const why = { naughty: 'naughty: 3 ornaments knocked off', 'nice-line': 'nice: three cats in a row', 'nice-all': 'nice: all cats on the tree' }[state.winReason];
      msg = `${pre}🎉 <b class="p${state.winner}">${NAMES[state.winner]}</b> wins (${why})! Press "New game".`;
      if (state.winLine) for (const i of state.winLine) cellEls[i].classList.add('winline');
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
    } else if (state.phase === 'promote') {
      msg = `${pre}${who}: all your pieces are on the tree. Click one of yours; it returns as a cat.`;
      for (const i of geo.cells) { const q = state.b[i]; if (q && q.p === state.turn && q.kind !== 'o') pieceEls.get(q.id).classList.add('pickable'); }
    } else {
      msg = `${pre}${who}'s turn: place a ${effectiveCat() ? 'cat' : 'kitten'}.`;
    }
    statusEl.innerHTML = msg;
    for (const i of geo.cells) {
      const q = state.b[i];
      let dis = busy || !humanTurn();
      if (!dis && state.phase === 'place') dis = !!q;
      if (!dis && state.phase === 'ornament') dis = !cellEls[i].classList.contains('allowed');
      cellEls[i].disabled = dis;
    }
    $('undo').disabled = busy || !history.length || !!net;
    for (const id of ['mode', 'levels', 'pieces', 'ornaments']) $(id).disabled = !!net;
    $('mode').value = settings.mode;
    $('levels').value = String(settings.levels);
    $('pieces').value = String(settings.pieces);
    $('pieces').options[0].textContent = `Auto (${autoPieces(settings.levels)})`;
    $('view').value = settings.view;
    $('ornaments').value = settings.ornaments;
  }

  // ---------- save ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state, history: history.slice(-80) })); } catch (e) { /* full */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      const s = d && d.state;
      if (s && Array.isArray(s.b) && s.L >= 4 && s.L <= 8 && s.b.length === s.N * s.N && Array.isArray(s.captured)) {
        state = s; history = Array.isArray(d.history) ? d.history : []; return true;
      }
    } catch (e) { /* corrupt save */ }
    return false;
  }
  function persistSettings() { localStorage.setItem(SET_KEY, JSON.stringify(settings)); }

  function newGame() {
    if (net) leaveOnline(false);
    clearTimeout(cpuTimer);
    state = L.newGame(gameOpts());
    history = []; selCat = false; busy = false; lastNote = ''; optCur = 0;
    buildBoard();
    save(); render(); scheduleCpu();
  }
  function undo() {
    if (busy || !history.length || net) return;
    clearTimeout(cpuTimer);
    state = history.pop();
    while (settings.mode === 'cpu' && isCpu(state.turn) && history.length) state = history.pop();
    for (const el of pieceEls.values()) el.remove();
    pieceEls.clear();
    lastNote = '';
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
    placeAll();
  }

  // ---------- 3D drag-to-rotate ----------
  let dragging = false, suppressClick = false, drag0 = null;
  wrapEl.addEventListener('pointerdown', (e) => {
    if (!is3d() || e.button !== 0) return;
    drag0 = { x: e.clientX, y: e.clientY, spin: settings.spin, tilt: settings.tilt };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag0) return;
    const dx = e.clientX - drag0.x, dy = e.clientY - drag0.y;
    if (!dragging && Math.abs(dx) + Math.abs(dy) > 6) { dragging = true; clearGhost(); wrapEl.classList.add('dragging'); boardEl.style.transition = 'none'; }
    if (dragging) {
      settings.spin = drag0.spin + dx * 0.4;
      settings.tilt = clamp(drag0.tilt + dy * 0.3, 0, 84);
      for (const el of pieceEls.values()) el.style.transition = 'none';
      boardEl.style.transform = camTransform();
      placeAll();
    }
  });
  wrapEl.addEventListener('wheel', (e) => {
    if (!is3d()) return;
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
    clearTimeout(cpuTimer);
    const c = await ensureClient();
    netView = null; netSeq = 0; netPending = false; lastNote = '';
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
    boardRoom = null;
    window.history.replaceState(null, '', u.toString());
    if (reloadLocal) {
      if (!load()) state = L.newGame(gameOpts());
      buildBoard(); render(); scheduleCpu();
    }
    renderOnlineDialog();
  }
  // Room events changed: replay is the truth. Animate one new move, otherwise jump to the replayed state.
  function onNet(view) {
    if (!net) return;
    netView = view;
    if (!view.state) { render(); return; }
    if (busy) { netPending = true; return; }
    if (boardRoom !== net.room) {                 // first replay of this room: build its board
      boardRoom = net.room; state = view.state; netSeq = view.seq; lastNote = '';
      buildBoard(); render(); return;
    }
    if (view.seq === netSeq + 1) {                // exactly one new move: animate it
      const a = view.actions[netSeq];
      if (a.k === 'play') act('play', { idx: a.i, cat: a.c }, true); else act(a.k, a.i, true);
      return;
    }
    if (view.seq !== netSeq) {                    // anything else: jump to the replayed state
      state = view.state; netSeq = view.seq; lastNote = '';
      for (const el of pieceEls.values()) el.remove();
      pieceEls.clear();
    }
    render();
  }
  function renderOnlineDialog() {
    const box = $('onlineBody');
    if (!box) return;
    if (net && net.room) {
      box.innerHTML = `<p>Send this link to your friend. The first person to open it plays <b>Coal</b>; anyone after that can watch.</p>
        <p class="linkrow"><input id="roomLink" readonly value="${roomLink(net.room)}"><button id="copyLink" type="button">Copy</button></p>
        <p class="hint">Moves travel as signed Nostr events through public relays (${net.relays.length}). No account needed.</p>
        <p><button id="leaveRoom" type="button">Leave room</button></p>`;
      $('copyLink').onclick = async () => { const i = $('roomLink'); i.select(); try { await navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } $('copyLink').textContent = 'Copied ✓'; };
      $('leaveRoom').onclick = () => { leaveOnline(true); };
    } else {
      box.innerHTML = `<p><button id="createRoom" type="button">Create a room</button> <span class="hint">uses the current Tree, Kittens and Ornaments settings. You play Snowball.</span></p>
        <p class="linkrow"><input id="joinCode" placeholder="Room link or code"><button id="joinRoom" type="button">Join</button></p>`;
      $('createRoom').onclick = () => startOnline(null, gameOpts()).catch(showNetError);
      $('joinRoom').onclick = () => {
        const v = $('joinCode').value.trim();
        const m = v.match(/room=([a-z0-9]+)/) || v.match(/^([a-z0-9]{6,16})$/);
        if (m) startOnline(m[1]).catch(showNetError); else $('joinCode').setCustomValidity('Paste a room link or code');
      };
    }
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
  $('levels').addEventListener('change', (e) => { settings.levels = +e.target.value; persistSettings(); newGame(); });
  $('pieces').addEventListener('change', (e) => { settings.pieces = e.target.value === 'auto' ? 'auto' : +e.target.value; persistSettings(); newGame(); });
  $('ornaments').addEventListener('change', (e) => { settings.ornaments = e.target.value; persistSettings(); newGame(); });
  $('view').addEventListener('change', (e) => { settings.view = e.target.value; persistSettings(); measure(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || $('rules').open) return;
    const k = e.key.toLowerCase();
    if (k === 'k') { selCat = false; render(); }
    else if (k === 'c') { selCat = true; render(); }
    else if (k === 'u') undo();
    else if (k === 'q' && is3d()) rotate(-45);
    else if (k === 'w' && is3d()) setTilt(settings.tilt - 12);
    else if (k === 's' && is3d()) setTilt(settings.tilt + 12);
    else if ((k === '+' || k === '=') && is3d()) setZoom(settings.zoom * 1.2);
    else if (k === '-' && is3d()) setZoom(settings.zoom / 1.2);
    else if (k === 'e' && is3d()) rotate(45);
  });
  window.addEventListener('resize', () => geo && measure());

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
    function tick() {
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
  if (roomParam && window.BoopOnline && window.BoopOnline.ROOM_RE.test(roomParam)) startOnline(roomParam).catch(showNetError);
  else scheduleCpu();
  if (!localStorage.getItem(SEEN_KEY)) { localStorage.setItem(SEEN_KEY, '1'); $('rules').showModal(); }

  // Test/diagnostic hook.
  window.__boop = {
    get state() { return state; }, get busy() { return busy; }, get settings() { return settings; },
    newGame, undo, rotate, pieceCount: () => pieceEls.size, cellSize: () => S,
    get net() { return net && { room: net.room, pubkey: net.pubkey, view: netView, seq: netSeq }; },
  };
})();
