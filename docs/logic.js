// Boop: Choinka - pure rules (no DOM), modelled on "boop the Halls!" (Smirk & Dagger).
// Board = Christmas tree seen from above: concentric square tiers, top tier = 1 centre cell.
// Classic: 4 tiers on 7x7 (base corners notched). "Wielka choinka": 5-8 tiers.
(function (root) {
  'use strict';

  const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIRS4 = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const ORNAMENTS = 3;
  const DECOR_RING = 1; // tier 2 from the top: where ornaments are hung

  const geoCache = {};
  function geometry(levels) {
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
    return (geoCache[L] = { L, N, m, ring, mask, cells });
  }
  const onBoard = (g, r, c) => r >= 0 && r < g.N && c >= 0 && c < g.N && g.mask[r * g.N + c];

  function newGame(opts) {
    const o = Object.assign({ levels: 4, pieces: 8 }, opts || {});
    const g = geometry(o.levels);
    const s = {
      L: g.L, N: g.N, n: o.pieces,
      b: new Array(g.N * g.N).fill(null),
      pool: [{ k: o.pieces, c: 0, o: ORNAMENTS }, { k: o.pieces, c: 0, o: ORNAMENTS }],
      captured: [0, 0],          // opponent ornaments captured by each player
      turn: 0, phase: 'ornament', options: null, promoteWhen: null,
      winner: null, winReason: null, winLine: null, nextId: 1, moves: 0,
    };
    startTurn(s);
    return s;
  }

  function clone(s) {
    return {
      L: s.L, N: s.N, n: s.n, b: s.b.slice(),
      pool: [{ ...s.pool[0] }, { ...s.pool[1] }], captured: s.captured.slice(),
      turn: s.turn, phase: s.phase, options: s.options ? s.options.map((x) => x.slice()) : null,
      promoteWhen: s.promoteWhen, winner: s.winner, winReason: s.winReason, winLine: s.winLine,
      nextId: s.nextId, moves: s.moves,
    };
  }

  const hasOrnamentOnTree = (s, p) => s.b.some((q) => q && q.kind === 'o' && q.p === p);

  // Phase after the (optional) ornament step at the start of a turn.
  function afterOrnamentStep(s) {
    const pl = s.pool[s.turn];
    if (pl.k + pl.c === 0) { s.phase = 'promote'; s.promoteWhen = 'start'; }
    else s.phase = 'place';
  }
  function startTurn(s) {
    s.options = null; s.promoteWhen = null;
    if (!hasOrnamentOnTree(s, s.turn) && s.pool[s.turn].o > 0 && ornamentCells(s).length) s.phase = 'ornament';
    else afterOrnamentStep(s);
  }
  function endTurn(s) {
    if (s.winner !== null) { s.phase = 'over'; return; }
    s.turn = 1 - s.turn;
    startTurn(s);
  }
  function win(s, p, reason, line) { s.winner = p; s.winReason = reason; s.winLine = line || null; s.phase = 'over'; }

  // Cells where an ornament may be hung: free decorating-tier cells, else the next tier down.
  function ornamentCells(s) {
    const g = geometry(s.L);
    for (let ring = DECOR_RING; ring < g.L; ring++) {
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
    const g = geometry(s.L), b = s.b, out = [];
    const mine = (i) => b[i] && b[i].p === player && b[i].kind !== 'o';
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
    for (const q of s.b) if (q && q.p === p && q.kind !== 'o') { total++; if (q.kind === 'c') cats++; }
    return { total, cats };
  }

  function legalMoves(s) {
    if (s.phase !== 'place') return [];
    const g = geometry(s.L), pl = s.pool[s.turn], out = [];
    for (const i of g.cells) {
      if (s.b[i]) continue;
      if (pl.k > 0) out.push({ idx: i, cat: false });
      if (pl.c > 0) out.push({ idx: i, cat: true });
    }
    return out;
  }

  // Place a kitten/cat, resolve boops, pounces, captures, then wins and graduation.
  function play(s, idx, isCat) {
    if (s.phase !== 'place') throw new Error('not in place phase');
    const g = geometry(s.L);
    if (!g.mask[idx] || s.b[idx]) throw new Error('illegal cell');
    const p = s.turn, pl = s.pool[p];
    if (isCat ? pl.c <= 0 : pl.k <= 0) throw new Error('no such piece in pool');

    const n = clone(s);
    const piece = { id: n.nextId++, p, kind: isCat ? 'c' : 'k' };
    n.b[idx] = piece;
    n.pool[p][piece.kind]--;
    n.moves++;

    const boops = [];
    const r = (idx / g.N) | 0, c = idx % g.N;
    for (const [dr, dc] of DIRS8) {
      const nr = r + dr, nc = c + dc;
      if (!onBoard(g, nr, nc)) continue;
      const ni = nr * g.N + nc, q = n.b[ni];
      if (!q) continue;
      if (!isCat && q.kind === 'c') continue; // kittens cannot boop cats
      const tr = nr + dr, tc = nc + dc;
      const ev = { id: q.id, kind: q.kind, owner: q.p, from: ni, to: null, tr, tc, result: 'move' };
      if (!onBoard(g, tr, tc)) {
        n.b[ni] = null;
        if (q.kind === 'o') {
          if (q.p === p) { n.pool[p].o++; ev.result = 'returned'; }
          else { n.captured[p]++; ev.result = 'captured'; ev.by = p; }
        } else { n.pool[q.p][q.kind]++; ev.result = 'off'; }
        boops.push(ev);
        continue;
      }
      const ti = tr * g.N + tc, t = n.b[ti];
      if (q.kind === 'o') {
        if (g.ring[ti] < g.ring[ni] || t) continue; // never up a tier; blocked if occupied
        n.b[ti] = q; n.b[ni] = null; ev.to = ti; boops.push(ev);
      } else if (!t) {
        n.b[ti] = q; n.b[ni] = null; ev.to = ti; boops.push(ev);
      } else if (t.kind === 'o' && q.kind === 'c') {
        // Pounce: the cat takes the ornament, then returns to its owner's pool.
        n.b[ni] = null; n.b[ti] = null;
        n.pool[q.p].c++;
        if (t.p === q.p) { n.pool[q.p].o++; ev.ornResult = 'returned'; }
        else { n.captured[q.p]++; ev.ornResult = 'captured'; }
        ev.result = 'pounce'; ev.to = ti; ev.ornId = t.id; ev.ornOwner = t.p; ev.by = q.p;
        boops.push(ev);
      }
      // otherwise blocked: stays put (a line of two cannot be pushed into itself)
    }

    resolveAfterMove(n);
    return { state: n, placed: { id: piece.id, idx, p, kind: piece.kind }, boops };
  }

  // Only after all movement: wins, then graduation / all-pieces-on-tree for the active player.
  function resolveAfterMove(n) {
    const p = n.turn;
    if (n.captured[p] >= ORNAMENTS) return win(n, p, 'naughty');
    if (n.captured[1 - p] >= ORNAMENTS) return win(n, 1 - p, 'naughty');
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
    for (const i of line) { n.b[i] = null; n.pool[n.turn].c++; } // kittens graduate, cats return
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
    n.pool[n.turn].c++;
    if (s.promoteWhen === 'start') { n.phase = 'place'; n.promoteWhen = null; }
    else endTurn(n);
    return { state: n, removed: { id: q.id, idx, kind: q.kind } };
  }

  // ---------- CPU ----------
  function evaluate(s, me) {
    if (s.winner === me) return 1e6;
    if (s.winner === 1 - me) return -1e6;
    const opp = 1 - me;
    const mine = onBoardCount(s, me), theirs = onBoardCount(s, opp);
    let v = 120 * ((mine.cats + s.pool[me].c) - (theirs.cats + s.pool[opp].c));
    v += 260 * (s.captured[me] - s.captured[opp]);
    v += 3 * (mine.total - theirs.total);
    v += 14 * pairs(s, me) - 20 * pairs(s, opp);
    v -= 40 * ornamentDanger(s, me) - 30 * ornamentDanger(s, opp);
    return v;
  }
  function pairs(s, p) {
    const g = geometry(s.L), b = s.b;
    const mine = (i) => b[i] && b[i].p === p && b[i].kind !== 'o';
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
    const g = geometry(s.L);
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
    const g = geometry(s.L);
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
      else if (st.phase === 'promote') st = promote(st, bestPromote(st)).state;
      else break;
    }
    return st;
  }

  // Full-turn candidates: optional ornament cell + piece placement.
  function turnCandidates(s, maxOrn) {
    const out = [], bases = [];
    if (s.phase === 'ornament') {
      let cells = ornamentCells(s);
      if (maxOrn && cells.length > maxOrn) { const step = Math.ceil(cells.length / maxOrn); cells = cells.filter((_, k) => k % step === 0); }
      for (const oc of cells) bases.push({ orn: oc, st: autoResolve(placeOrnament(s, oc).state) });
    } else bases.push({ orn: null, st: s });
    for (const base of bases) {
      for (const m of legalMoves(base.st)) out.push({ orn: base.orn, idx: m.idx, cat: m.cat, st: autoResolve(play(base.st, m.idx, m.cat).state) });
    }
    return out;
  }

  function bestMove(s, opts) {
    const o = Object.assign({ depth: 2, top: 10, rand: 0.5 }, opts || {});
    const me = s.turn;
    if (s.phase === 'chooseLine') return { line: bestLine(s) };
    if (s.phase === 'promote') return { promote: bestPromote(s) };
    if (s.phase !== 'ornament' && s.phase !== 'place') return null;
    const cands = turnCandidates(s).map((cd) => ({ cd, v: evaluate(cd.st, me) + Math.random() * o.rand }));
    if (!cands.length) return null;
    cands.sort((a, b) => b.v - a.v);
    let pick = cands[0];
    if (pick.v < 1e6 && o.depth >= 2) {
      let bestV = -Infinity;
      for (const c of cands.slice(0, o.top)) {
        let worst = evaluate(c.cd.st, me);
        if (c.cd.st.phase !== 'over') {
          for (const r of turnCandidates(c.cd.st, 3)) {
            const v = evaluate(r.st, me);
            if (v < worst) worst = v;
            if (worst <= -1e6) break;
          }
        }
        if (worst > bestV) { bestV = worst; pick = c; }
      }
    }
    return { orn: pick.cd.orn, idx: pick.cd.idx, cat: pick.cd.cat };
  }

  const api = {
    ORNAMENTS, DECOR_RING, geometry, onBoard, newGame, clone, placeOrnament, ornamentCells,
    play, chooseLine, promote, findLines, legalMoves, onBoardCount, evaluate, bestMove, autoResolve,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoopLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
