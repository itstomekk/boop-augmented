// Boop: Choinka - pure rules (no DOM), modelled on "boop the Halls!" and "boop" (Smirk & Dagger).
// Board = Christmas tree seen from above: concentric square tiers, top tier = 1 centre cell.
// Classic: 4 tiers on 7x7 (base corners notched). "Wielka choinka": 5-8 tiers.
// Square board (shape 'square'): the plain boop board, 6x6 with no ornaments and no tiers; 7x7 to 10x10 are house sizes.
// Ghost variant (square boards only): a house adaptation of BOOoop's ghost cats, see ghost section below.
// Boopmas spirits (tree only): house adaptation of "the Ghosts of Boopmas!" (diagonal-only, straight-only and single-direction
// jumping boops), see the spirits section below. Shuffle powers (square only): house adaptation of boop. Shuffle's wild, super
// and scaredy pieces and the blankie as ordinary pieces on the board (no deck), see the shuffle section below.
// 2 to 4 players (house rule beyond the official 2): per-player arrays (pool, captured) are indexed by seat,
// the turn rotates 0 -> 1 -> ... -> players-1 -> 0, and every winning rule stays per player.
(function (root) {
  'use strict';

  const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIRS4 = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const ORNAMENTS = 3;
  const MIN_PLAYERS = 2, MAX_PLAYERS = 4;
  const DECOR_RING = 1; // tier 2 from the top: where ornaments are hung
  const SQUARE_MIN = 6, SQUARE_MAX = 10;   // plain boop is 6x6; larger squares are house variants
  // Boopmas spirits: indices into the three spirits; DIAG / ORTH are indices into DIRS8.
  const SPIRITS = [{ id: 'psst', name: 'Psst Psst' }, { id: 'pounce', name: 'Yet to Pounce' }, { id: 'meowly', name: 'Jacob Meowly' }];
  const DIAG = [0, 2, 5, 7], ORTH = [1, 3, 4, 6], ALL8 = [0, 1, 2, 3, 4, 5, 6, 7];
  // Shuffle: two shared wild pieces (they start as kittens); per seat 1 super kitten, 1 scaredy kitten and 1 blankie out of `pieces`.
  const WILD_PIECES = 2, SHUFFLE_MIN_PIECES = 6;

  const geoCache = {};
  // Tree: `levels` = tiers (4-8). Square: `levels` = side length (6-10). Either way state.L is this parameter.
  function geometry(levels, shape) {
    if (shape === 'square') {
      const Q = Math.max(SQUARE_MIN, Math.min(SQUARE_MAX, levels | 0 || SQUARE_MIN)), key = 's' + Q;
      if (geoCache[key]) return geoCache[key];
      const ring = new Array(Q * Q), cells = [];
      for (let r = 0; r < Q; r++) for (let c = 0; c < Q; c++) { ring[r * Q + c] = Math.max(Math.abs(2 * r - (Q - 1)), Math.abs(2 * c - (Q - 1))) >> 1; cells.push(r * Q + c); } // distance from the middle (CPU only)
      return (geoCache[key] = { shape: 'square', L: Q, N: Q, m: (Q - 1) / 2, tiers: 1, ring, mask: new Array(Q * Q).fill(true), cells });
    }
    const L = Math.max(4, Math.min(8, levels | 0 || 4));
    if (geoCache[L]) return geoCache[L];
    const N = 2 * L - 1, m = L - 1;
    const ring = new Array(N * N), mask = new Array(N * N).fill(false), cells = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c, dr = Math.abs(r - m), dc = Math.abs(c - m);
      ring[i] = Math.max(dr, dc);
      const corner = dr === m && dc === m; // notched corners of the base tier
      if (!corner) { mask[i] = true; cells.push(i); }
    }
    return (geoCache[L] = { shape: 'tree', L, N, m, tiers: L, ring, mask, cells });
  }
  const onBoard = (g, r, c) => r >= 0 && r < g.N && c >= 0 && c < g.N && g.mask[r * g.N + c];
  const geo = (s) => geometry(s.L, s.shape);

  const np = (s) => s.players || MIN_PLAYERS;
  // Most kittens+cats per player that still leaves a free cell for the next placement. A player holds at most
  // n-1 pieces on the tree between turns (all n on the tree forces a promotion), plus up to ornActive ornaments.
  function maxPieces(levels, players, ornActive, shape, shuffle) {
    const cells = geometry(levels, shape).cells.length, p = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players | 0 || MIN_PLAYERS));
    return Math.floor((cells - 1 - (shuffle ? WILD_PIECES : 0) - p * Math.max(0, ornActive | 0)) / p) + 1;   // shuffle: the shared wild pieces take two cells too
  }
  // Pool key of a piece (what it becomes when it goes home): plain 'k'/'c', super 'ks'/'cs', scaredy 'ka'.
  const poolKey = (q) => (q.kind === 'c' ? (q.x === 's' ? 'cs' : 'c') : (q.x === 's' ? 'ks' : q.x === 'a' ? 'ka' : 'k'));
  const poolPieces = (pl) => pl.k + pl.c + (pl.ks || 0) + (pl.ka || 0) + (pl.cs || 0);

  function newGame(opts) {
    // players: 2-4 seats; ornaments: per player (0 = no ornaments, no ornament phase, no captured-ornament win);
    // ornActive: how many may hang at once; ornWin: captures needed to win.
    // shape 'square' + size 6-10: plain boop board without ornaments; ghost: true adds ghost cats (square only).
    const o = Object.assign({ levels: 4, players: MIN_PLAYERS, pieces: 8, decor: DECOR_RING, ornaments: ORNAMENTS, ornActive: 1, ornWin: ORNAMENTS }, opts || {});
    const players = o.players | 0;
    if (players < MIN_PLAYERS || players > MAX_PLAYERS) throw new Error('players must be 2 to 4');
    const shape = o.shape === undefined ? 'tree' : o.shape, square = shape === 'square';
    if (shape !== 'tree' && !square) throw new Error('unknown board shape');
    if (square && !(Number.isInteger(o.size) && o.size >= SQUARE_MIN && o.size <= SQUARE_MAX)) throw new Error(`square size must be ${SQUARE_MIN} to ${SQUARE_MAX}`);
    const ghost = !!o.ghost, boopmas = !!o.boopmas, shuffle = !!o.shuffle;
    if (ghost && !square) throw new Error('ghosts need the square board');
    if (boopmas && square) throw new Error('Boopmas spirits need the tree');
    if (shuffle && !square) throw new Error('Shuffle powers need the square board');
    if (shuffle && ghost) throw new Error('Shuffle powers and ghost cats cannot be combined');
    if (shuffle && !(o.pieces >= SHUFFLE_MIN_PIECES)) throw new Error(`Shuffle powers need at least ${SHUFFLE_MIN_PIECES} pieces per player`);
    const g = square ? geometry(o.size, 'square') : geometry(o.levels);
    const ornaments = square ? 0 : Math.max(0, o.ornaments | 0);
    if ((square || players > MIN_PLAYERS) && o.pieces > maxPieces(g.L, players, Math.min(Math.max(1, o.ornActive | 0), ornaments), shape, shuffle)) throw new Error('too many pieces for this board and player count');
    const s = {
      L: g.L, N: g.N, n: o.pieces, players, ornaments, decor: Math.max(1, Math.min(g.L - 2, o.decor | 0)),
      ornActive: Math.max(1, o.ornActive | 0), ornWin: Math.max(1, o.ornWin | 0),
      shape, ghost, ghosts: ghost ? Array.from({ length: players }, () => ({ on: false })) : undefined,
      boopmas, spirits: boopmas ? { holder: null, used: [false, false, false] } : undefined,   // nobody holds the spirit board until the first graduation
      shuffle, wild: shuffle ? { k: WILD_PIECES, c: 0 } : undefined,
      b: new Array(g.N * g.N).fill(null),
      pool: Array.from({ length: players }, () => (shuffle ? { k: o.pieces - 2, c: 0, o: 0, ks: 1, ka: 1, cs: 0, b: 1 } : { k: o.pieces, c: 0, o: ornaments })),
      captured: new Array(players).fill(0),   // ornaments of other players captured by each player
      turn: 0, phase: 'ornament', options: null, promoteWhen: null,
      winner: null, winReason: null, winLine: null, nextId: 1, moves: 0,
    };
    startTurn(s);
    return s;
  }

  function clone(s) {
    return {
      L: s.L, N: s.N, n: s.n, players: np(s), ornaments: s.ornaments, decor: s.decor, ornActive: s.ornActive, ornWin: s.ornWin,
      shape: s.shape || 'tree', ghost: !!s.ghost, ghosts: s.ghosts ? s.ghosts.map((x) => ({ ...x })) : undefined,
      boopmas: !!s.boopmas, spirits: s.spirits ? { holder: s.spirits.holder, used: s.spirits.used.slice() } : undefined,
      shuffle: !!s.shuffle, wild: s.wild ? { ...s.wild } : undefined, b: s.b.slice(),   // pieces are shared between states: replace, never mutate
      pool: s.pool.map((x) => ({ ...x })), captured: s.captured.slice(),
      turn: s.turn, phase: s.phase, options: s.options ? s.options.map((x) => x.slice()) : null,
      promoteWhen: s.promoteWhen, winner: s.winner, winReason: s.winReason, winLine: s.winLine,
      nextId: s.nextId, moves: s.moves,
    };
  }

  // Validate and normalise a state from storage (any player count; 2-player saves from before multiplayer have
  // no `players`; saves from before squares and ghosts have no `shape`/`ghost`/`ghosts`). Returns a fresh state or null.
  // Never throws on hostile input.
  function restoreState(raw) {
    try {
      const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
      if (!raw || typeof raw !== 'object') return null;
      const shape = raw.shape === undefined ? 'tree' : raw.shape, square = shape === 'square';
      if (shape !== 'tree' && !square) return null;
      if (!(square ? int(raw.L, SQUARE_MIN, SQUARE_MAX) : int(raw.L, 4, 8))) return null;
      const g = geometry(raw.L, shape), P = raw.players === undefined ? (Array.isArray(raw.pool) ? raw.pool.length : 0) : raw.players;
      if (raw.N !== g.N || !int(P, MIN_PLAYERS, MAX_PLAYERS) || !int(raw.n, 1, 24)) return null;
      if (!Array.isArray(raw.b) || raw.b.length !== g.N * g.N) return null;
      if (!Array.isArray(raw.pool) || raw.pool.length !== P || !Array.isArray(raw.captured) || raw.captured.length !== P) return null;
      // Boopmas spirits (tree) and Shuffle powers (square) are opt-in flags; saves from before them have neither.
      if ((raw.boopmas !== undefined && typeof raw.boopmas !== 'boolean') || (raw.shuffle !== undefined && typeof raw.shuffle !== 'boolean')) return null;
      const boopmas = raw.boopmas === true, shuffle = raw.shuffle === true;
      if ((boopmas && square) || (shuffle && !square) || (shuffle && raw.ghost === true)) return null;
      const POOL_EXTRA = ['ks', 'ka', 'cs', 'b'];
      for (const x of raw.pool) {
        if (!x || !int(x.k, 0, 99) || !int(x.c, 0, 99) || !int(x.o, 0, 99)) return null;
        for (const key of POOL_EXTRA) if (shuffle ? !int(x[key], 0, 99) : x[key] !== undefined) return null;
      }
      let spirits, wild;
      if (boopmas) {
        const sp = raw.spirits;
        if (!sp || typeof sp !== 'object' || !(sp.holder === null || int(sp.holder, 0, P - 1)) || !Array.isArray(sp.used) || sp.used.length !== 3 || !sp.used.every((u) => typeof u === 'boolean')) return null;
        if (sp.holder === null && sp.used.some(Boolean)) return null;
        spirits = { holder: sp.holder, used: sp.used.slice() };
      } else if (raw.spirits !== undefined && raw.spirits !== null) return null;
      if (shuffle) {
        if (!raw.wild || typeof raw.wild !== 'object' || !int(raw.wild.k, 0, 99) || !int(raw.wild.c, 0, 99)) return null;
        wild = { k: raw.wild.k, c: raw.wild.c };
      } else if (raw.wild !== undefined && raw.wild !== null) return null;
      for (const c of raw.captured) if (!int(c, 0, 99)) return null;
      if (square && (raw.ornaments !== 0 || raw.pool.some((x) => x.o !== 0) || raw.captured.some((c) => c !== 0))) return null;
      if (!int(raw.turn, 0, P - 1) || !['ornament', 'place', 'chooseLine', 'promote', 'ghost', 'over'].includes(raw.phase)) return null;
      // Ghosts: absent (saves from before ghosts) = off. On: one entry per seat, in the pool or on a distinct stitch.
      let ghosts;
      if (raw.ghost !== undefined && typeof raw.ghost !== 'boolean') return null;
      const ghost = raw.ghost === true;
      if (ghost) {
        if (!square || !Array.isArray(raw.ghosts) || raw.ghosts.length !== P) return null;
        const keys = new Set();
        ghosts = [];
        for (const x of raw.ghosts) {
          if (!x || typeof x !== 'object' || typeof x.on !== 'boolean') return null;
          if (!x.on) { ghosts.push({ on: false }); continue; }
          if (!int(x.d, 0, 3) || !int(x.a, 0, g.N - 2) || !int(x.t, 0, g.N - 1)) return null;
          const key = stitchKey(x);
          if (keys.has(key)) return null;
          keys.add(key); ghosts.push({ on: true, d: x.d, a: x.a, t: x.t });
        }
        if (raw.phase === 'ghost' && ghosts[raw.turn].on) return null;
      } else if (raw.ghosts !== undefined && raw.ghosts !== null) return null;
      if (raw.phase === 'ghost' && !ghost) return null;
      const ids = new Set();
      let maxId = 0;
      for (let i = 0; i < raw.b.length; i++) {
        const q = raw.b[i];
        if (q === null) continue;
        if (!g.mask[i] || !q || !int(q.id, 0, 1e9) || !['k', 'c', 'o'].includes(q.kind) || (square && q.kind === 'o') || ids.has(q.id)) return null;
        // Powers: wild pieces are shared (owner -1), scaredy are kittens, a blanket belongs to a seat and never covers an ornament.
        if (q.x !== undefined && (!shuffle || !['w', 's', 'a'].includes(q.x) || q.kind === 'o' || (q.x === 'a' && q.kind !== 'k'))) return null;
        if (q.x === 'w' ? q.p !== -1 : !int(q.p, 0, P - 1)) return null;
        if (q.cov !== undefined && (!shuffle || q.kind === 'o' || !q.cov || typeof q.cov !== 'object' || !int(q.cov.p, 0, P - 1))) return null;
        ids.add(q.id); maxId = Math.max(maxId, q.id);
      }
      if (raw.options !== null && raw.options !== undefined) {
        if (!Array.isArray(raw.options) || raw.options.length > 16) return null;
        for (const line of raw.options) if (!Array.isArray(line) || line.length !== 3 || !line.every((i) => int(i, 0, raw.b.length - 1))) return null;
      }
      if (raw.phase === 'chooseLine' && !(raw.options && raw.options.length)) return null;
      if (raw.winner !== null && raw.winner !== undefined && !int(raw.winner, 0, P - 1)) return null;
      const s = {
        L: g.L, N: g.N, n: raw.n, players: P, ornaments: raw.ornaments === undefined ? undefined : (int(raw.ornaments, 0, 99) ? raw.ornaments : undefined),
        decor: int(raw.decor, 1, g.L - 2) ? raw.decor : DECOR_RING,
        ornActive: int(raw.ornActive, 1, 99) ? raw.ornActive : 1, ornWin: int(raw.ornWin, 1, 99) ? raw.ornWin : ORNAMENTS,
        shape, ghost, ghosts, boopmas, spirits, shuffle, wild,
        b: raw.b.map((q) => {
          if (!q) return null;
          const v = { id: q.id, p: q.p, kind: q.kind };
          if (q.x !== undefined) v.x = q.x;
          if (q.cov !== undefined) v.cov = { p: q.cov.p };
          return v;
        }),
        pool: raw.pool.map((x) => (shuffle ? { k: x.k, c: x.c, o: x.o, ks: x.ks, ka: x.ka, cs: x.cs, b: x.b } : { k: x.k, c: x.c, o: x.o })), captured: raw.captured.slice(),
        turn: raw.turn, phase: raw.phase, options: raw.options ? raw.options.map((x) => x.slice()) : null,
        promoteWhen: raw.promoteWhen === 'start' || raw.promoteWhen === 'end' ? raw.promoteWhen : null,
        winner: raw.winner === undefined ? null : raw.winner,
        winReason: typeof raw.winReason === 'string' ? raw.winReason : null,
        winLine: Array.isArray(raw.winLine) && raw.winLine.length === 3 && raw.winLine.every((i) => int(i, 0, raw.b.length - 1)) ? raw.winLine.slice() : null,
        nextId: Math.max(int(raw.nextId, 1, 1e9) ? raw.nextId : 1, maxId + 1), moves: int(raw.moves, 0, 1e9) ? raw.moves : 0,
      };
      return s;
    } catch (e) { return null; }
  }

  const ornamentsOnTree = (s, p) => s.b.reduce((n, q) => n + (q && q.kind === 'o' && q.p === p ? 1 : 0), 0);
  const ornActive = (s) => s.ornActive || 1;
  const ornWin = (s) => s.ornWin || ORNAMENTS;

  // Phase after the (optional) ornament step at the start of a turn.
  function afterOrnamentStep(s) {
    const pl = s.pool[s.turn];
    if (poolPieces(pl) === 0) { s.phase = 'promote'; s.promoteWhen = 'start'; }
    else s.phase = 'place';
  }
  function startTurn(s) {
    s.options = null; s.promoteWhen = null;
    // Golden rule: fewer of your ornaments on the tree than allowed -> hang one (one per turn).
    if (ornamentsOnTree(s, s.turn) < ornActive(s) && s.pool[s.turn].o > 0 && ornamentCells(s).length) s.phase = 'ornament';
    else afterOrnamentStep(s);
  }
  function endTurn(s) {
    if (s.winner !== null) { s.phase = 'over'; return; }
    s.turn = (s.turn + 1) % np(s);
    startTurn(s);
  }
  function win(s, p, reason, line) { s.winner = p; s.winReason = reason; s.winLine = line || null; s.phase = 'over'; }

  // Cells where an ornament may be hung: free decorating-tier cells, else the next tier down.
  function ornamentCells(s) {
    if (s.shape === 'square') return [];
    const g = geo(s);
    for (let ring = s.decor || DECOR_RING; ring < g.L; ring++) {
      const free = g.cells.filter((i) => g.ring[i] === ring && !s.b[i]);
      if (free.length) return free;
    }
    return [];
  }

  // The Golden Rule: no ornament of yours on the tree -> hang one first (it does not boop).
  function placeOrnament(s, idx) {
    if (s.phase !== 'ornament') throw new Error('not in ornament phase');
    if (!ornamentCells(s).includes(idx)) throw new Error('ornament must go on the decorating tier');
    const n = clone(s);
    const q = { id: n.nextId++, p: n.turn, kind: 'o' };
    n.b[idx] = q;
    n.pool[n.turn].o--;
    afterOrnamentStep(n);
    return { state: n, placed: { id: q.id, idx, p: q.p, kind: 'o' } };
  }

  function findLines(s, player) {
    const g = geo(s), b = s.b, out = [];
    const mine = (i) => b[i] && (b[i].p === player || b[i].x === 'w') && b[i].kind !== 'o' && !b[i].cov;   // wild pieces count for whoever is on turn; sleeping pieces are out of play
    for (const i of g.cells) {
      if (!mine(i)) continue;
      const r = (i / g.N) | 0, c = i % g.N;
      for (const [dr, dc] of DIRS4) {
        if (!onBoard(g, r + dr, c + dc) || !onBoard(g, r + 2 * dr, c + 2 * dc)) continue;
        const j = (r + dr) * g.N + c + dc, k = (r + 2 * dr) * g.N + c + 2 * dc;
        if (mine(j) && mine(k)) out.push([i, j, k]);
      }
    }
    return out;
  }

  function onBoardCount(s, p) {
    let total = 0, cats = 0;
    for (const q of s.b) if (q && q.p === p && q.kind !== 'o') { total++; if (q.kind === 'c' && !q.cov) cats++; }   // a sleeping cat is still on the board but is no active cat
    return { total, cats };
  }

  function legalMoves(s) {
    if (s.phase !== 'place') return [];
    const g = geo(s), pl = s.pool[s.turn], out = [];
    for (const i of g.cells) {
      if (s.b[i]) continue;
      if (pl.k > 0) out.push({ idx: i, cat: false });
      if (pl.c > 0) out.push({ idx: i, cat: true });
      if (s.shuffle) {   // Shuffle powers: super and scaredy kittens, super cats, wild pieces
        if (pl.ks > 0) out.push({ idx: i, cat: false, x: 's' });
        if (pl.cs > 0) out.push({ idx: i, cat: true, x: 's' });
        if (pl.ka > 0) out.push({ idx: i, cat: false, x: 'a' });
        if (s.wild.k > 0) out.push({ idx: i, cat: false, x: 'w' });
        if (s.wild.c > 0) out.push({ idx: i, cat: true, x: 'w' });
      }
    }
    if (s.shuffle && pl.b > 0) for (const i of g.cells) if (s.b[i] && !s.b[i].cov) out.push({ idx: i, cat: false, x: 'b' });   // the blankie goes on a piece
    return out;
  }

  // ---------- Boopmas spirits (tree only) ----------
  // House adaptation of "the Ghosts of Boopmas!": when a player graduates kittens the next seat takes the spirit board and may
  // use each spirit once, together with a normal placement (one per turn), until the next graduation resets the board.
  //   Psst Psst      the placed piece boops only DIAGONAL neighbours.
  //   Yet to Pounce  the placed piece boops only STRAIGHT (orthogonal) neighbours.
  //   Jacob Meowly   boops only the neighbour in ONE chosen direction; kittens may boop cats; a piece that is blocked jumps over
  //                  every piece in its way to the first free cell (off the tree if the row is full). Ornaments never go up a tier.
  // Spirit options for a placement at idx (the cell is not checked): [{g}] for Psst/Pounce, [{g:2, d}] per neighbour in direction d.
  function legalSpirits(s, idx) {
    if (!s.boopmas || s.phase !== 'place' || s.spirits.holder !== s.turn) return [];
    const g = geo(s), out = [], r = (idx / g.N) | 0, c = idx % g.N;
    if (!s.spirits.used[0]) out.push({ g: 0 });
    if (!s.spirits.used[1]) out.push({ g: 1 });
    if (!s.spirits.used[2]) for (let d = 0; d < 8; d++) { const nr = r + DIRS8[d][0], nc = c + DIRS8[d][1]; if (onBoard(g, nr, nc) && s.b[nr * g.N + nc]) out.push({ g: 2, d }); }
    return out;
  }
  // The hand-over: the board goes to the seat after the one who just graduated at least one kitten, all three spirits fresh.
  function handOver(n) { if (n.boopmas) n.spirits = { holder: (n.turn + 1) % np(n), used: [false, false, false] }; }

  // ---------- boop engine ----------
  // A piece going off the board returns to its owner's pool (wild pieces to the shared supply).
  function sendHome(n, q) { if (q.x === 'w') n.wild[q.kind]++; else n.pool[q.p][poolKey(q)]++; }
  // Boop piece q (on cell ni) one step along (dr, dc) for `steps` cells (super boop: 2); `leap`: a blocked piece jumps over every piece
  // in its way (Meowly, super cat). Mutates n; returns the event, or null when nothing moves. Pieces are replaced, never mutated.
  function boopPiece(n, g, q, ni, dr, dc, steps, leap, p) {
    const N = g.N, r = (ni / N) | 0, c = ni % N;
    const ev = { id: q.id, kind: q.kind, owner: q.p, from: ni, to: null, tr: r + dr, tc: c + dc, result: 'move' };
    const send = (ti) => { n.b[ni] = null; n.b[ti] = q; ev.to = ti; ev.tr = (ti / N) | 0; ev.tc = ti % N; return ev; };
    const leave = (tr, tc) => {
      n.b[ni] = null; ev.tr = tr; ev.tc = tc;
      if (q.kind === 'o') {
        if (q.p === p) { n.pool[p].o++; ev.result = 'returned'; } else { n.captured[p]++; ev.result = 'captured'; ev.by = p; }
      } else { sendHome(n, q); ev.result = 'off'; }
      return ev;
    };
    const jumpOver = (tr, tc) => { while (onBoard(g, tr, tc) && n.b[tr * N + tc]) { tr += dr; tc += dc; } ev.leap = true; return [tr, tc]; };
    if (q.kind === 'o') {   // ornaments: never to a smaller ring (up the tree), blocked by pieces unless the booper leaps
      let tr = r + dr, tc = c + dc;
      if (!onBoard(g, tr, tc)) return leave(tr, tc);
      const ti = tr * N + tc;
      if (g.ring[ti] < g.ring[ni]) return null;
      if (!n.b[ti]) return send(ti);
      if (!leap) return null;
      [tr, tc] = jumpOver(tr, tc);
      if (!onBoard(g, tr, tc)) return leave(tr, tc);
      if (g.ring[tr * N + tc] < g.ring[ni]) { delete ev.leap; return null; }
      return send(tr * N + tc);
    }
    let pr = r, pc = c;
    for (let step = 1; step <= steps; step++) {
      let tr = pr + dr, tc = pc + dc;
      if (!onBoard(g, tr, tc)) return leave(tr, tc);
      const ti = tr * N + tc, t = n.b[ti];
      if (!t) { pr = tr; pc = tc; continue; }
      if (step === 1) {
        if (t.kind === 'o' && q.kind === 'c') {
          // Pounce: the cat takes the ornament, then returns to its owner's pool.
          n.b[ni] = null; n.b[ti] = null;
          n.pool[q.p].c++;
          if (t.p === q.p) { n.pool[q.p].o++; ev.ornResult = 'returned'; }
          else { n.captured[q.p]++; ev.ornResult = 'captured'; }
          ev.result = 'pounce'; ev.to = ti; ev.ornId = t.id; ev.ornOwner = t.p; ev.by = q.p;
          return ev;
        }
        if (leap) {
          [tr, tc] = jumpOver(tr, tc);
          return onBoard(g, tr, tc) ? send(tr * N + tc) : leave(tr, tc);
        }
      }
      break;   // blocked: stays (a line of two cannot be pushed into itself)
    }
    return pr === r && pc === c ? null : send(pr * N + pc);
  }
  // Booping a sleeping piece takes its blanket off instead: the piece stays, the blanket flies one cell the same way and puts
  // the piece there to sleep; with no (awake) piece there, or off the board, it goes back to its owner's pool.
  function blanketBoop(n, g, q, ni, dr, dc) {
    const N = g.N, r = (ni / N) | 0, c = ni % N, tr = r + dr, tc = c + dc, owner = q.cov.p;
    const ev = { id: q.id, kind: q.kind, owner: q.p, from: ni, to: null, tr: r, tc: c, result: 'blanket', blanketOwner: owner, blanketTo: null, blanketCovers: null };
    const awake = Object.assign({}, q); delete awake.cov;
    n.b[ni] = awake;
    if (onBoard(g, tr, tc)) {
      const ti = tr * N + tc, t = n.b[ti];
      if (t && !t.cov && t.kind !== 'o') { n.b[ti] = Object.assign({}, t, { cov: { p: owner } }); ev.blanketTo = ti; ev.blanketCovers = t.id; }
    }
    if (ev.blanketTo === null) n.pool[owner].b++;
    return ev;
  }
  // Boop every eligible neighbour of idx. booper = {kind, x}. o: dirs (indices into DIRS8), anyKind (Meowly), leap.
  function boopNeighbours(n, g, idx, booper, p, o, boops) {
    const N = g.N, r = (idx / N) | 0, c = idx % N;
    const steps = booper.x === 's' ? 2 : 1, leap = !!o.leap || (booper.x === 's' && booper.kind === 'c');
    for (const di of o.dirs || ALL8) {
      const [dr, dc] = DIRS8[di], nr = r + dr, nc = c + dc;
      if (!onBoard(g, nr, nc)) continue;
      const ni = nr * N + nc, q = n.b[ni];
      if (!q) continue;
      if (!o.anyKind && booper.kind === 'k' && q.kind === 'c') continue; // kittens cannot boop cats
      const ev = q.cov ? blanketBoop(n, g, q, ni, dr, dc) : boopPiece(n, g, q, ni, dr, dc, steps, leap, p);
      if (ev) boops.push(ev);
    }
  }
  // Scaredy kittens: whenever a piece LANDS on a cell (boops, and the scares themselves), every awake scaredy kitten beside that cell
  // is booped one cell the same way. Chain reactions follow in event order; each scaredy moves at most once per placement.
  function scareScaredy(n, g, boops, p) {
    const N = g.N, moved = new Set(), queue = [];
    const land = (ev) => { const fr = (ev.from / N) | 0, fc = ev.from % N; queue.push({ id: ev.id, to: ev.to, dr: Math.sign(ev.tr - fr), dc: Math.sign(ev.tc - fc) }); };
    for (const ev of boops) if (ev.result === 'move') { moved.add(ev.id); land(ev); }
    for (let k = 0; k < queue.length; k++) {
      const m = queue[k], r = (m.to / N) | 0, c = m.to % N;
      for (const [ar, ac] of DIRS8) {
        const nr = r + ar, nc = c + ac;
        if (!onBoard(g, nr, nc)) continue;
        const si = nr * N + nc, sq = n.b[si];
        if (!sq || sq.x !== 'a' || sq.cov || sq.id === m.id || moved.has(sq.id)) continue;
        const ev = boopPiece(n, g, sq, si, m.dr, m.dc, 1, false, p);
        if (!ev) continue;
        ev.scare = true; moved.add(sq.id); boops.push(ev);
        if (ev.result === 'move') land(ev);
      }
    }
  }

  // Place a kitten/cat, resolve boops, pounces, captures, then wins and graduation.
  // opt (all optional): x = Shuffle power: 'w' wild, 's' super, 'a' scaredy (kittens only), 'b' blankie (put it on the piece at idx);
  // g/d = Boopmas spirit 0-2 (+ direction 0-7 for Meowly) of the seat holding the spirit board.
  function play(s, idx, isCat, opt) {
    if (s.phase !== 'place') throw new Error('not in place phase');
    const g = geo(s), o = opt || {}, x = o.x, sp = o.g;
    if (!g.mask[idx]) throw new Error('illegal cell');
    if (x !== undefined && (!['w', 's', 'a', 'b'].includes(x) || !s.shuffle)) throw new Error('unknown power');
    if (x === 'a' && isCat) throw new Error('there is no scaredy cat');
    if (x === 'b' && isCat) throw new Error('the blankie is not a cat');
    const p = s.turn, pl = s.pool[p], kind = isCat ? 'c' : 'k';
    if (x === 'b') {
      if (!s.b[idx] || s.b[idx].cov) throw new Error('the blankie needs an uncovered piece');
      if (!(pl.b > 0)) throw new Error('no blankie left');
    } else {
      if (s.b[idx]) throw new Error('illegal cell');
      if (x === 'w' ? !(s.wild[kind] > 0) : !(pl[poolKey({ kind, x })] > 0)) throw new Error('no such piece in pool');
    }
    let boopOpts = {};
    if (sp !== undefined || o.d !== undefined) {
      if (!s.boopmas || s.spirits.holder !== p || !Number.isInteger(sp) || sp < 0 || sp > 2 || s.spirits.used[sp]) throw new Error('that spirit is not available');
      if (sp === 2) {
        const d = o.d, r = (idx / g.N) | 0, c = idx % g.N;
        if (!Number.isInteger(d) || d < 0 || d > 7 || !onBoard(g, r + DIRS8[d][0], c + DIRS8[d][1]) || !s.b[(r + DIRS8[d][0]) * g.N + c + DIRS8[d][1]]) throw new Error('Meowly needs a piece in the chosen direction');
        boopOpts = { dirs: [d], anyKind: true, leap: true };
      } else if (o.d !== undefined) throw new Error('only Jacob Meowly takes a direction');
      else boopOpts = { dirs: sp === 0 ? DIAG : ORTH };
    }

    const n = clone(s);
    n.moves++;
    let piece, placed;
    if (x === 'b') {
      const under = n.b[idx];
      n.b[idx] = Object.assign({}, under, { cov: { p } });
      n.pool[p].b--;
      piece = { kind: 'k' };
      placed = { id: under.id, idx, p, kind: 'b', cover: true };
    } else {
      piece = { id: n.nextId++, p: x === 'w' ? -1 : p, kind };
      if (x) piece.x = x;
      n.b[idx] = piece;
      if (x === 'w') n.wild[kind]--; else n.pool[p][poolKey(piece)]--;
      placed = { id: piece.id, idx, p: piece.p, kind };
      if (x) placed.x = x;
    }
    if (sp !== undefined) {
      n.spirits.used[sp] = true; placed.g = sp;
      if (sp === 2) placed.d = o.d;
    }

    const boops = [];
    boopNeighbours(n, g, idx, piece, p, boopOpts, boops);
    if (n.shuffle) scareScaredy(n, g, boops, p);

    // Ghost variant: the player's ghost on the board moves now (after the boops); with the ghost in the pool the
    // player may place it next (optional, own phase), but not on the turn it just left the board.
    let ghostMove = null;
    if (n.ghost) {
      ghostMove = moveGhost(n, p);
      if (!ghostMove && ghostStitches(n).length) { n.phase = 'ghost'; return { state: n, placed, boops, ghostMove: null }; }
    }
    resolveAfterMove(n);
    return { state: n, placed, boops, ghostMove };
  }

  // ---------- ghosts (square boards) ----------
  // House adaptation of BOOoop's ghost cats. Each player has one ghost. It lives on a "stitch": the seam between two
  // neighbouring cells. d = travel direction (0 down, 1 up, 2 right, 3 left), a = which seam (0..N-2) across the lane,
  // t = how far along the lane (row for d 0/1, column for d 2/3). Entry stitches: id = d*(N-1)+a, t = 0 (d 0, 2) or N-1.
  //  - Placed (optional) at the end of the owner's turn, after boops; it appears without any effect.
  //  - At the end of each later own turn it moves one stitch forward and scares the two cells beside its stitch sideways:
  //    each piece (kitten or cat, any colour) moves one cell away, leaping over blockers to the next open cell,
  //    or off the board (back to its owner) when there is none. Ghosts are not solid and are never booped.
  //  - A ghost that would land on another ghost's stitch passes through to the next open stitch (no effect on the way).
  //  - Past the last stitch it leaves and returns to the pool; it cannot be placed again in that same turn.
  function stitchFromId(N, id) {
    if (!Number.isInteger(id) || id < 0 || id >= 4 * (N - 1)) return null;
    const d = Math.floor(id / (N - 1));
    return { d, a: id % (N - 1), t: d % 2 === 0 ? 0 : N - 1 };
  }
  // The two cells beside a stitch, and the stitch's position as a cell-sized box (top-left in cell units).
  const ghostCells = (N, g) => (g.d < 2 ? [g.t * N + g.a, g.t * N + g.a + 1] : [g.a * N + g.t, (g.a + 1) * N + g.t]);
  const ghostPlace = (N, g) => (g.d < 2 ? { r: g.t, c: g.a + 0.5 } : { r: g.a + 0.5, c: g.t });
  // Ghosts travelling in opposite directions on one seam share its stitches.
  function stitchKey(g) { return (g.d < 2 ? 0 : 1) + ':' + g.t + ':' + g.a; }
  function stitchTaken(s, g) { return s.ghosts.some((x) => x.on && stitchKey(x) === stitchKey(g)); }
  // Entry stitches that are free right now.
  function ghostStitches(s) {
    if (!s.ghost) return [];
    const out = [];
    for (let id = 0; id < 4 * (s.N - 1); id++) if (!stitchTaken(s, stitchFromId(s.N, id))) out.push(id);
    return out;
  }
  // Scare the pieces beside a ghost's stitch (mutates n). Returns events in the same shape as boops.
  function scareAt(n, g, owner) {
    const N = n.N, events = [], cells = ghostCells(N, g);
    const dirs = g.d < 2 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    cells.forEach((ci, k) => {
      const q = n.b[ci];
      if (!q) return;
      const [dr, dc] = dirs[k], r0 = (ci / N) | 0, c0 = ci % N;
      let step = 1, r = r0 + dr, c = c0 + dc;
      while (r >= 0 && r < N && c >= 0 && c < N && n.b[r * N + c]) { step++; r += dr; c += dc; }
      const ev = { id: q.id, kind: q.kind, owner: q.p, from: ci, to: null, tr: r, tc: c, result: 'move', ghost: true, leap: step > 1, by: owner };
      n.b[ci] = null;
      if (r < 0 || r >= N || c < 0 || c >= N) { n.pool[q.p][q.kind]++; ev.result = 'off'; }
      else { n.b[r * N + c] = q; ev.to = r * N + c; }
      events.push(ev);
    });
    return events;
  }
  // The owner's ghost, if on the board, takes its turn-end step. Returns null when it is not on the board.
  function moveGhost(n, p) {
    const g = n.ghosts[p];
    if (!g.on) return null;
    const step = g.d % 2 === 0 ? 1 : -1, from = { d: g.d, a: g.a, t: g.t };
    let t = g.t + step, passed = 0;
    while (t >= 0 && t < n.N && stitchTaken(n, { d: g.d, a: g.a, t })) { t += step; passed++; }
    if (t < 0 || t >= n.N) { n.ghosts[p] = { on: false }; return { player: p, from, to: null, passed, scares: [] }; }
    g.t = t;
    return { player: p, from, to: { d: g.d, a: g.a, t }, passed, scares: scareAt(n, g, p) };
  }
  function placeGhost(s, id) {
    if (s.phase !== 'ghost') throw new Error('not in ghost phase');
    const g = stitchFromId(s.N, id);
    if (!g) throw new Error('bad stitch');
    if (stitchTaken(s, g)) throw new Error('stitch taken by another ghost');
    const n = clone(s);
    n.ghosts[n.turn] = { on: true, d: g.d, a: g.a, t: g.t };
    resolveAfterMove(n);
    return { state: n, ghost: { player: s.turn, id, d: g.d, a: g.a, t: g.t } };
  }
  function skipGhost(s) {
    if (s.phase !== 'ghost') throw new Error('not in ghost phase');
    const n = clone(s);
    resolveAfterMove(n);
    return { state: n };
  }

  // Only after all movement: wins, then graduation / all-pieces-on-tree for the active player.
  function resolveAfterMove(n) {
    const p = n.turn;
    // Captured-ornament win: the active player is checked first, then the others in turn order
    // (a cat pounce can score for a player who is not on turn).
    for (let d = 0; d < np(n); d++) { const q = (p + d) % np(n); if (n.captured[q] >= ornWin(n)) return win(n, q, 'naughty'); }
    const lines = findLines(n, p);
    const catLine = lines.find((L) => L.every((i) => n.b[i].kind === 'c'));
    if (catLine) return win(n, p, 'nice-line', catLine);
    const ob = onBoardCount(n, p);
    if (ob.total === n.n && ob.cats === n.n) return win(n, p, 'nice-all');
    if (lines.length === 1) { graduateLine(n, lines[0]); return endTurn(n); }
    if (lines.length > 1) { n.phase = 'chooseLine'; n.options = lines; return; }
    if (ob.total === n.n) { n.phase = 'promote'; n.promoteWhen = 'end'; return; }
    endTurn(n);
  }

  function graduateLine(n, line) {
    let kitten = false;
    for (const i of line) {   // kittens graduate, cats return; super stays super, wild pieces go home as wild cats
      const q = n.b[i];
      n.b[i] = null;
      if (q.kind === 'k') kitten = true;
      if (q.x === 'w') n.wild.c++; else n.pool[n.turn][q.x === 's' ? 'cs' : 'c']++;
    }
    if (kitten) handOver(n);   // Boopmas: the next seat takes the spirit board
  }

  function chooseLine(s, k) {
    if (s.phase !== 'chooseLine') throw new Error('not choosing a line');
    const line = s.options[k];
    if (!line) throw new Error('bad option');
    const n = clone(s);
    const ids = line.map((i) => n.b[i].id);
    graduateLine(n, line);
    n.options = null;
    endTurn(n);
    return { state: n, line, ids };
  }

  // All pieces on the tree: graduate one kitten (or take a cat back) into the pool.
  function promote(s, idx) {
    if (s.phase !== 'promote') throw new Error('not in promote phase');
    const q = s.b[idx];
    if (!q || q.p !== s.turn || q.kind === 'o') throw new Error('must pick own kitten or cat');
    const n = clone(s);
    n.b[idx] = null;
    n.pool[n.turn][q.x === 's' ? 'cs' : 'c']++;
    if (q.cov) n.pool[q.cov.p].b++;   // a sleeping piece takes its blanket home
    if (q.kind === 'k') handOver(n);
    if (s.promoteWhen === 'start') { n.phase = 'place'; n.promoteWhen = null; }
    else endTurn(n);
    return { state: n, removed: { id: q.id, idx, kind: q.kind } };
  }

  // ---------- CPU ----------
  function evaluate(s, me) {
    if (s.winner === me) return 1e6;
    if (s.winner !== null && s.winner !== undefined) return -1e6;
    // Opponents: material and danger are averaged (identical to the old formula for 2 players);
    // pairs and captures use the most dangerous opponent.
    const opps = [];
    for (let p = 0; p < np(s); p++) if (p !== me) opps.push(p);
    const k = opps.length, mine = onBoardCount(s, me);
    let cats = 0, total = 0, danger = 0, pairMax = 0, capMax = 0;
    for (const o of opps) {
      const th = onBoardCount(s, o);
      cats += th.cats + s.pool[o].c + (s.pool[o].cs || 0); total += th.total; danger += ornamentDanger(s, o);
      pairMax = Math.max(pairMax, pairs(s, o)); capMax = Math.max(capMax, s.captured[o]);
    }
    let v = 120 * ((mine.cats + s.pool[me].c + (s.pool[me].cs || 0)) - cats / k);
    v += 260 * (s.captured[me] - capMax);
    v += 3 * (mine.total - total / k);
    v += 14 * pairs(s, me) - 20 * pairMax;
    v -= 40 * ornamentDanger(s, me) - 30 * danger / k;
    return v;
  }
  function pairs(s, p) {
    const g = geo(s), b = s.b;
    const mine = (i) => b[i] && (b[i].p === p || b[i].x === 'w') && b[i].kind !== 'o' && !b[i].cov;
    let t = 0;
    for (const i of g.cells) {
      if (!mine(i)) continue;
      const r = (i / g.N) | 0, c = i % g.N;
      for (const [dr, dc] of DIRS4) {
        if (!onBoard(g, r + dr, c + dc)) continue;
        const j = (r + dr) * g.N + c + dc;
        if (!mine(j)) continue;
        const w = b[i].kind === 'c' && b[j].kind === 'c' ? 3 : 1;
        for (const [er, ec] of [[r + 2 * dr, c + 2 * dc], [r - dr, c - dc]]) if (onBoard(g, er, ec) && !b[er * g.N + ec]) t += w;
      }
    }
    return t;
  }
  // Ways an ornament of p could be pushed straight off the tree next move.
  function ornamentDanger(s, p) {
    const g = geo(s);
    let d = 0;
    for (const i of g.cells) {
      const q = s.b[i];
      if (!q || q.kind !== 'o' || q.p !== p) continue;
      const r = (i / g.N) | 0, c = i % g.N;
      for (const [dr, dc] of DIRS8) {
        if (onBoard(g, r + dr, c + dc)) continue;
        const pr = r - dr, pc = c - dc;
        if (onBoard(g, pr, pc) && !s.b[pr * g.N + pc]) d++;
      }
    }
    return d;
  }

  function bestLine(s) {
    let best = 0, bestK = -1;
    s.options.forEach((L, k) => { const kc = L.filter((i) => s.b[i].kind === 'k').length; if (kc > bestK) { bestK = kc; best = k; } });
    return best;
  }
  function bestPromote(s) {
    const g = geo(s);
    let best = null, bestV = -Infinity;
    for (const i of g.cells) {
      const q = s.b[i];
      if (!q || q.p !== s.turn || q.kind === 'o') continue;
      const v = (q.kind === 'k' ? 100 : 0) + g.ring[i] * 3; // upgrade kittens, prefer outer ones
      if (v > bestV) { bestV = v; best = i; }
    }
    return best;
  }
  // Resolve chooseLine/promote automatically (CPU and search).
  function autoResolve(s) {
    let st = s;
    for (let guard = 0; guard < 4; guard++) {
      if (st.phase === 'chooseLine') st = chooseLine(st, bestLine(st)).state;
      else if (st.phase === 'ghost') st = skipGhost(st).state;   // search ignores the ghost placement; bestGhost decides it
      else if (st.phase === 'promote') st = promote(st, bestPromote(st)).state;
      else break;
    }
    return st;
  }

  // Full-turn candidates: optional ornament cell + piece placement.
  // `powers`: also try every Boopmas spirit together with each placement (the holder's turn only; replies skip it to stay fast).
  function turnCandidates(s, maxOrn, powers) {
    const out = [], bases = [];
    if (s.phase === 'ornament') {
      let cells = ornamentCells(s);
      if (maxOrn && cells.length > maxOrn) { const step = Math.ceil(cells.length / maxOrn); cells = cells.filter((_, k) => k % step === 0); }
      for (const oc of cells) bases.push({ orn: oc, st: autoResolve(placeOrnament(s, oc).state) });
    } else bases.push({ orn: null, st: s });
    for (const base of bases) {
      for (const m of legalMoves(base.st)) {
        const x = m.x === undefined ? {} : { x: m.x };
        out.push({ orn: base.orn, idx: m.idx, cat: m.cat, x: m.x, st: autoResolve(play(base.st, m.idx, m.cat, m.x === undefined ? undefined : x).state) });
        if (powers) for (const sp of legalSpirits(base.st, m.idx)) out.push({ orn: base.orn, idx: m.idx, cat: m.cat, g: sp.g, d: sp.d, st: autoResolve(play(base.st, m.idx, m.cat, sp).state) });
      }
    }
    return out;
  }

  // Ghost placement for the CPU: replay each free stitch's whole journey over the current board (other pieces are
  // assumed to stay put, which is only a guess) and place where the evaluation gains most; keep the ghost if nothing helps.
  function bestGhost(s) {
    const me = s.turn, base = evaluate(s, me);
    let best = null, bestGain = 0.5;
    for (const id of ghostStitches(s)) {
      const sim = clone(s), g = stitchFromId(s.N, id);
      sim.ghosts[me] = { on: true, d: g.d, a: g.a, t: g.t };
      for (let guard = 0; guard < sim.N + 2 && sim.ghosts[me].on; guard++) moveGhost(sim, me);
      const gain = evaluate(sim, me) - base;
      if (gain > bestGain) { bestGain = gain; best = id; }
    }
    return best === null ? { skip: true } : { ghost: best };
  }

  function bestMove(s, opts) {
    const o = Object.assign({ depth: 2, top: s.N > 11 ? 6 : 10, rand: 0.5 }, opts || {});
    const me = s.turn;
    if (s.phase === 'ghost') return bestGhost(s);
    if (s.phase === 'chooseLine') return { line: bestLine(s) };
    if (s.phase === 'promote') return { promote: bestPromote(s) };
    if (s.phase !== 'ornament' && s.phase !== 'place') return null;
    const cands = turnCandidates(s, 8, true).map((cd) => ({ cd, v: evaluate(cd.st, me) + Math.random() * o.rand }));
    if (!cands.length) return null;
    cands.sort((a, b) => b.v - a.v);
    let pick = cands[0];
    if (pick.v < 1e6 && o.depth >= 2) {
      let bestV = -Infinity;
      for (const c of cands.slice(0, o.top)) {
        let worst = evaluate(c.cd.st, me);
        if (c.cd.st.phase !== 'over') {
          for (const r of turnCandidates(c.cd.st, c.cd.st.N > 9 ? 1 : 3, false)) {
            const v = evaluate(r.st, me);
            if (v < worst) worst = v;
            if (worst <= -1e6) break;
          }
        }
        if (worst > bestV) { bestV = worst; pick = c; }
      }
    }
    const mv = { orn: pick.cd.orn, idx: pick.cd.idx, cat: pick.cd.cat };
    if (pick.cd.x !== undefined) mv.x = pick.cd.x;
    if (pick.cd.g !== undefined) { mv.g = pick.cd.g; if (pick.cd.d !== undefined) mv.d = pick.cd.d; }
    return mv;
  }

  const api = {
    ORNAMENTS, DECOR_RING, MIN_PLAYERS, MAX_PLAYERS, SQUARE_MIN, SQUARE_MAX, SPIRITS, WILD_PIECES, SHUFFLE_MIN_PIECES, maxPieces, poolKey, legalSpirits, restoreState, geometry, onBoard, newGame, clone, placeOrnament, ornamentCells, ornamentsOnTree,
    stitchFromId, ghostCells, ghostPlace, ghostStitches, placeGhost, skipGhost,
    play, chooseLine, promote, findLines, legalMoves, onBoardCount, evaluate, bestMove, autoResolve,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoopLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
