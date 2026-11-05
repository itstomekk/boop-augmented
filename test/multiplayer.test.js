// Multiplayer rules: node test/multiplayer.test.js
// 2-player regression against golden games recorded from the pre-multiplayer engine, then 3 and 4 players:
// turn rotation, per-player rules, capacity limits, saves, no-ornament games, invariant fuzzing and CPU self-play.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('../docs/logic.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }
function throws(fn) { try { fn(); } catch (e) { return true; } return false; }

// ---------- helpers ----------
const digest = (s) => crypto.createHash('sha1').update(JSON.stringify({ b: s.b, pool: s.pool, captured: s.captured, turn: s.turn, phase: s.phase, options: s.options, promoteWhen: s.promoteWhen, winner: s.winner, winReason: s.winReason, winLine: s.winLine, nextId: s.nextId, moves: s.moves })).digest('hex').slice(0, 8);
function apply(s, a) {
  if (a.k === 'orn') return L.placeOrnament(s, a.i).state;
  if (a.k === 'play') return L.play(s, a.i, a.c).state;
  if (a.k === 'line') return L.chooseLine(s, a.i).state;
  if (a.k === 'promote') return L.promote(s, a.i).state;
  throw new Error('bad action');
}
let seed = 20240607; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomAction(s) {
  if (s.phase === 'ornament') return { k: 'orn', i: pick(L.ornamentCells(s)) };
  if (s.phase === 'place') {
    const all = L.legalMoves(s), cats = all.filter((m) => m.cat);
    const m = rnd() < 0.4 && cats.length ? pick(cats) : pick(all);
    return { k: 'play', i: m.idx, c: m.cat };
  }
  if (s.phase === 'chooseLine') return { k: 'line', i: Math.floor(rnd() * s.options.length) };
  const mine = []; s.b.forEach((q, i) => { if (q && q.p === s.turn && q.kind !== 'o') mine.push(i); });
  return { k: 'promote', i: pick(mine) };
}

// ---------- 1. two-player regression against the original engine ----------
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'two_player_golden.json'), 'utf8'));
let goldenPlies = 0;
for (const [gi, g] of golden.entries()) {
  let s = L.newGame(g.cfg);
  ok(s.players === 2 && s.pool.length === 2 && s.captured.length === 2, 'default is 2 players');
  ok(digest(s) === g.digests[0], `golden ${gi}: initial state`);
  for (let k = 0; k < g.actions.length; k++) {
    s = apply(s, g.actions[k]);
    if (digest(s) !== g.digests[k + 1]) ok(false, `golden ${gi}: state diverged at ply ${k}`);
    goldenPlies++;
  }
  ok(s.winner === g.winner && s.winReason === g.reason, `golden ${gi}: same winner and reason`);
}
console.log(`  2-player golden: ${golden.length} games, ${goldenPlies} plies identical to the original engine`);
ok(goldenPlies > 2000 && golden.some((g) => g.reason === 'naughty') && golden.some((g) => g.reason === 'nice-line') && golden.some((g) => g.reason === 'nice-all'), 'golden set covers all three win kinds');

// ---------- helpers for positions ----------
const mk = (players, extra) => {
  const s = L.newGame(Object.assign({ levels: 4, pieces: 8, players }, extra || {}));
  return s;
};
const N = 7, at = (r, c) => r * N + c;
let nid = 900;
function setup(players, pieces, turn, extra) {
  const s = mk(players, extra);
  for (const [r, c, p, kind] of pieces) {
    s.b[at(r, c)] = { id: nid++, p, kind };
    if (kind === 'o') s.pool[p].o--; else if (kind === 'k') s.pool[p].k--; // cats are placed "from nowhere"
  }
  s.phase = 'place'; s.turn = turn || 0;
  return s;
}

// ---------- 2. new game shape, turn rotation, golden rule per player ----------
for (const P of [2, 3, 4]) {
  let s = mk(P);
  ok(s.players === P && s.pool.length === P && s.captured.length === P && s.pool.every((x) => x.k === 8 && x.c === 0 && x.o === 3), `${P} players: pools and captures per seat`);
  const order = [];
  for (let t = 0; t < 2 * P; t++) {
    order.push(s.turn);
    ok(s.phase === 'ornament', `${P} players: turn ${t} starts with the golden rule`);
    s = L.placeOrnament(s, L.ornamentCells(s)[0]).state;
    ok(s.turn === order[t] && s.phase === 'place', 'ornament does not pass the turn');
    s = L.play(s, L.legalMoves(s).filter((m) => L.geometry(4).ring[m.idx] === 3)[t % 20].idx, false).state;
    if (s.phase === 'over' || s.phase !== 'ornament') break;
  }
  ok(order.slice(0, P).join() === [...Array(P).keys()].join(), `${P} players: turn order is seat order (${order.slice(0, P)})`);
}
{
  const s = mk(4);
  ok(throws(() => L.newGame({ players: 5 })) && throws(() => L.newGame({ players: 1 })) && throws(() => L.newGame({ players: 0 })), 'player count must be 2..4');
  ok(L.newGame({}).players === 2 && L.newGame({ players: 3 }).players === 3, 'players defaults to 2');
  ok(L.clone(s).players === 4 && L.clone(s).pool.length === 4, 'clone keeps all seats');
}

// ---------- 3. capacity: no stuck boards ----------
ok(L.maxPieces(4, 4, 1) === 11 && L.maxPieces(4, 3, 1) === 14 && L.maxPieces(4, 2, 1) === 22, 'maxPieces classic: ' + [4, 3, 2].map((p) => L.maxPieces(4, p, 1)));
ok(throws(() => L.newGame({ players: 4, pieces: 12 })) && !throws(() => L.newGame({ players: 4, pieces: 11 })), 'oversized 4-player kitten count refused');
for (const lv of [4, 5, 6, 7, 8]) for (const P of [3, 4]) {
  const auto = 8 + 2 * (lv - 4), act = lv === 4 ? 1 : 1 + Math.floor((lv - 3) / 2);
  ok(L.maxPieces(lv, P, act) >= auto, `Auto kittens fit: ${lv} tiers, ${P} players`);
}

// ---------- 4. per-player rules in 3-4 player games ----------
// A move boops pieces of every other colour.
{
  const s = setup(4, [[3, 4, 1, 'k'], [3, 2, 2, 'k'], [2, 3, 3, 'k'], [4, 3, 1, 'k']], 0);
  const r = L.play(s, at(3, 3), false);
  ok(r.state.b[at(3, 5)].p === 1 && r.state.b[at(3, 1)].p === 2 && r.state.b[at(1, 3)].p === 3 && r.state.b[at(5, 3)].p === 1, 'boop pushes every colour');
  ok(r.state.turn === 1, 'turn passes to seat 1');
}
// A third player's ornament knocked off is captured by the active player, not the owner.
{
  const s = setup(3, [[0, 3, 2, 'o']], 0);
  const r = L.play(s, at(1, 3), false).state;
  ok(r.captured.join() === '1,0,0' && r.pool[2].o === s.pool[2].o, 'capture credited to the active seat only');
  const own = L.play(setup(3, [[0, 3, 0, 'o']], 0), at(1, 3), false).state;
  ok(own.captured.join() === '0,0,0' && own.pool[0].o === 3, 'own ornament still returns to its owner');
}
// Pounce: a cat of seat 1 pushed onto seat 2's ornament scores for seat 1 (the cat owner), on seat 0's turn.
{
  const s = setup(3, [[3, 4, 1, 'c'], [3, 5, 2, 'o']], 0); s.pool[0].c = 1;
  const r = L.play(s, at(3, 3), true).state;
  ok(r.captured.join() === '0,1,0' && r.pool[1].c === 1 && !r.b[at(3, 4)] && !r.b[at(3, 5)], 'pounce credits the cat owner');
  // ...and it can win for a player who is not on turn.
  const w = setup(3, [[3, 4, 1, 'c'], [3, 5, 2, 'o']], 0); w.pool[0].c = 1; w.captured[1] = 2;
  const rw = L.play(w, at(3, 3), true).state;
  ok(rw.winner === 1 && rw.winReason === 'naughty' && rw.phase === 'over', 'a pounce can give the win to a seat that is not on turn');
}
// Simultaneous naughty wins: the active seat is checked first, then the following seats in turn order.
{
  // Seat 1 is active. Its cat at the centre pushes seat 0's cat east onto seat 2's ornament and seat 2's cat west
  // onto seat 1's own ornament: seat 0 and seat 2 both reach 3, seat 1 (active) does not. Order 1, 2, 0 -> seat 2.
  const s = setup(3, [[3, 4, 0, 'c'], [3, 5, 2, 'o'], [3, 2, 2, 'c'], [3, 1, 1, 'o']], 1); s.pool[1].c = 1; s.captured[0] = 2; s.captured[2] = 2;
  const r = L.play(s, at(3, 3), true).state;
  ok(r.captured[0] === 3 && r.captured[2] === 3 && r.winner === 2, 'two non-active seats reach 3: turn order after the active seat decides (seat 2), got ' + r.winner);
  // Same position with seat 2 already at 2 but seat 0 only at 3: a single non-active seat simply wins.
  const s2 = setup(3, [[3, 4, 0, 'c'], [3, 5, 2, 'o']], 1); s2.pool[1].c = 1; s2.captured[0] = 2;
  ok(L.play(s2, at(3, 3), true).state.winner === 0, 'a lone non-active seat reaching 3 wins');
  // Active seat reaches 3 by pushing an ornament off while another seat reaches 3 by a pounce in the same move: active wins.
  const t = setup(3, [[0, 3, 2, 'o'], [2, 3, 1, 'c'], [3, 3, 2, 'o']], 0); t.pool[0].c = 1; t.captured[0] = 2; t.captured[1] = 2;
  const r2 = L.play(t, at(1, 3), true).state;
  ok(r2.captured[0] === 3 && r2.captured[1] === 3 && r2.winner === 0, 'both reach 3 in one move: the active seat wins first');
}
// Lines: only the active seat's lines count.
{
  const s = setup(3, [[5, 1, 1, 'k'], [5, 2, 1, 'k'], [5, 3, 1, 'k']], 0); // seat 1 already has three in a row
  const r = L.play(s, at(2, 2), false).state;
  ok(r.pool[1].c === 0 && r.b[at(5, 1)], 'a line of another seat does not graduate on my turn');
  const own = setup(3, [[5, 1, 2, 'k'], [5, 2, 2, 'k']], 2);
  const g = L.play(own, at(5, 3), false).state;
  ok(g.pool[2].c === 3 && g.turn === 0, 'seat 2 graduates its own line and the turn wraps to seat 0');
}
// Win by nice line and all-on-tree for seats beyond 1; turn does not rotate after a win.
{
  const s = setup(4, [[5, 1, 3, 'c'], [5, 2, 3, 'c']], 3); s.pool[3].c = 1;
  const r = L.play(s, at(5, 3), true).state;
  ok(r.winner === 3 && r.winReason === 'nice-line' && r.phase === 'over' && r.turn === 3, 'seat 3 wins with three cats');
}
// Promote (all pieces on the tree) works for a later seat and wraps correctly.
{
  const s = setup(3, [[0, 1, 2, 'k'], [0, 5, 2, 'k'], [2, 0, 2, 'k'], [6, 2, 2, 'k'], [6, 5, 2, 'k'], [2, 6, 2, 'k'], [4, 6, 2, 'k']], 2);
  const r = L.play(s, at(3, 3), false).state;
  ok(r.phase === 'promote' && r.turn === 2, 'promote phase for seat 2');
  const p = L.promote(r, at(0, 1)).state;
  ok(p.pool[2].c === 1 && p.turn === 0, 'promotion passes the turn to seat 0');
}
// Several lines -> chooseLine belongs to the active seat only.
{
  const s = setup(3, [[5, 1, 1, 'k'], [5, 2, 1, 'k'], [5, 4, 1, 'k'], [5, 5, 2, 'k']], 1);
  const r = L.play(s, at(5, 3), false).state;
  ok(r.phase === 'chooseLine' && r.turn === 1 && r.options.length === 2, 'seat 1 picks between two lines');
  ok(L.chooseLine(r, 0).state.turn === 2, 'after choosing, seat 2 is next');
}

// ---------- 5. games without ornaments (extension point for plain-board variants) ----------
{
  const s = L.newGame({ levels: 4, pieces: 8, players: 3, ornaments: 0 });
  ok(s.phase === 'place' && s.pool.every((x) => x.o === 0) && s.ornaments === 0, 'ornaments: 0 starts in the place phase');
  const r = L.play(s, 24, false).state;
  ok(r.turn === 1 && r.phase === 'place', 'ornaments: 0 never enters the ornament phase');
  let st = L.newGame({ levels: 4, pieces: 6, players: 2, ornaments: 0 });
  for (let k = 0; k < 400 && st.phase !== 'over'; k++) st = apply(st, randomAction(st));
  ok(st.captured.every((c) => c === 0) && !st.b.some((q) => q && q.kind === 'o'), 'no ornaments ever appear');
  ok(st.phase === 'over' ? st.winReason !== 'naughty' : true, 'no naughty win without ornaments');
  const m = L.bestMove(L.newGame({ levels: 4, pieces: 8, players: 4, ornaments: 0 }));
  ok(m && m.orn === null, 'CPU plays without ornaments');
}

// ---------- 6. saves ----------
{
  // Legacy 2-player save: no players, no ornaments field.
  let s = L.newGame({ levels: 4, pieces: 8 });
  s = L.placeOrnament(s, 16).state; s = L.play(s, 38, false).state;
  const legacy = JSON.parse(JSON.stringify(s)); delete legacy.players; delete legacy.ornaments;
  const r = L.restoreState(legacy);
  ok(r && r.players === 2 && r.pool.length === 2 && r.turn === s.turn && digest(r) === digest(s), 'pre-multiplayer save restores as 2 players');
  ok(r.phase === 'ornament' && !!L.play(L.placeOrnament(r, 32).state, 37, false), 'restored legacy state is playable');
  for (const P of [3, 4]) {
    let g = mk(P);
    for (let k = 0; k < 40 && g.phase !== 'over'; k++) g = apply(g, randomAction(g));
    const back = L.restoreState(JSON.parse(JSON.stringify(g)));
    ok(back && back.players === P && digest(back) === digest(g) && JSON.stringify(back.pool) === JSON.stringify(g.pool), `${P}-player JSON save round-trips`);
  }
  const bad = (f) => { const x = JSON.parse(JSON.stringify(L.newGame({ players: 3 }))); f(x); return L.restoreState(x) === null; };
  ok(bad((x) => { x.pool.pop(); }), 'pool/players mismatch rejected');
  ok(bad((x) => { x.captured.push(0); }), 'captured/players mismatch rejected');
  ok(bad((x) => { x.turn = 3; }), 'turn outside seats rejected');
  ok(bad((x) => { x.players = 5; }), 'five players rejected');
  ok(bad((x) => { x.players = 1; x.pool.length = 1; x.captured.length = 1; }), 'one player rejected');
  ok(bad((x) => { x.phase = 'dance'; }), 'unknown phase rejected');
  ok(bad((x) => { x.b[0] = { id: 3, p: 0, kind: 'k' }; }), 'piece on a notched corner rejected');
  ok(bad((x) => { x.b[24] = { id: 3, p: 3, kind: 'k' }; }), 'piece of a missing seat rejected');
  ok(bad((x) => { x.b[24] = { id: 3, p: 0, kind: 'k' }; x.b[25] = { id: 3, p: 0, kind: 'k' }; }), 'duplicate piece ids rejected');
  ok(bad((x) => { x.pool[0].k = -1; }), 'negative pool rejected');
  ok(bad((x) => { x.b.length = 10; }), 'wrong board size rejected');
  ok(bad((x) => { x.L = 'x'; }), 'non-numeric tree rejected');
  ok(bad((x) => { x.winner = 7; }), 'winner outside seats rejected');
  ok(bad((x) => { x.phase = 'chooseLine'; x.options = []; }), 'chooseLine without options rejected');
  ok(L.restoreState(null) === null && L.restoreState('x') === null && L.restoreState([]) === null && L.restoreState({}) === null, 'garbage rejected');
}

// ---------- 7. invariant fuzz, 3 and 4 players ----------
function invariants(s, cfg, where) {
  const P = s.players;
  for (let p = 0; p < P; p++) {
    const ob = L.onBoardCount(s, p);
    ok(s.pool[p].k + s.pool[p].c + ob.total === cfg.pieces, `${where}: seat ${p} pieces conserved`);
    ok(L.ornamentsOnTree(s, p) <= s.ornActive, `${where}: seat ${p} hangs at most ornActive ornaments`);
  }
  let orn = 0; for (let p = 0; p < P; p++) orn += s.pool[p].o + L.ornamentsOnTree(s, p) + s.captured[p];
  ok(orn === P * (cfg.ornaments === undefined ? 3 : cfg.ornaments), `${where}: ornaments conserved`);
  ok(s.turn >= 0 && s.turn < P, `${where}: turn in range`);
  if (s.winner !== null) ok(s.phase === 'over', `${where}: winner means over`);
  if (s.phase === 'place') ok(L.legalMoves(s).length > 0, `${where}: a placement is always possible`);
  if (s.phase === 'ornament') ok(L.ornamentCells(s).length > 0, `${where}: ornament phase has a cell`);
  const ids = new Set(); for (const q of s.b) if (q) { ok(!ids.has(q.id), `${where}: unique ids`); ids.add(q.id); }
}
const fuzzConfigs = [
  { levels: 4, pieces: 8 }, { levels: 4, pieces: 4 }, { levels: 4, pieces: 11 },
  { levels: 5, pieces: 10, ornaments: 4, ornActive: 2, decor: 2 },
  { levels: 6, pieces: 12, ornaments: 5, ornActive: 2, decor: 3 },
  { levels: 4, pieces: 6, ornaments: 0 },
];
const stats = { games: 0, plies: 0, over: 0, naughty: 0, line: 0, all: 0, offTurnWins: 0, byPlayers: { 3: 0, 4: 0 } };
for (const P of [3, 4]) for (const cfg of fuzzConfigs) for (let g = 0; g < 12; g++) {
  let s = L.newGame(Object.assign({ players: P }, cfg));
  const where = `fuzz P${P} L${cfg.levels} n${cfg.pieces} #${g}`;
  invariants(s, cfg, where);
  for (let ply = 0; ply < 500 && s.phase !== 'over'; ply++) {
    const before = s.turn, a = randomAction(s);
    s = apply(s, a); stats.plies++;
    if (a.k === 'play' || a.k === 'orn') invariants(s, cfg, where + ' ply ' + ply);
    if (s.phase === 'over' && s.winner !== before) stats.offTurnWins++;
  }
  stats.games++; stats.byPlayers[P]++;
  if (s.phase === 'over') { stats.over++; if (s.winReason === 'naughty') stats.naughty++; else if (s.winReason === 'nice-line') stats.line++; else stats.all++; }
}
console.log(`  fuzz: ${stats.games} games, ${stats.plies} plies, ${stats.over} finished (naughty ${stats.naughty}, line ${stats.line}, all-on-tree ${stats.all}), ${stats.offTurnWins} won off-turn`);
ok(stats.over > 20 && stats.plies > 5000, 'fuzz played enough finished games');

// ---------- 8. CPU self-play with 3 and 4 seats ----------
function cpuPly(st) {
  const mv = L.bestMove(st);
  ok(mv, 'CPU always has a move');
  if (mv.line !== undefined) return L.chooseLine(st, mv.line).state;
  if (mv.promote !== undefined) return L.promote(st, mv.promote).state;
  let s = st;
  if (mv.orn !== null && mv.orn !== undefined) s = L.placeOrnament(s, mv.orn).state;
  if (s.phase === 'promote') s = L.promote(s, L.bestMove(s).promote).state;
  return L.play(s, mv.idx, mv.cat).state;
}
for (const P of [2, 3, 4]) for (const lv of [4, 6]) {
  let st = L.newGame({ levels: lv, pieces: lv === 4 ? 8 : 12, players: P, ornaments: lv === 4 ? 3 : 5, ornActive: lv === 4 ? 1 : 2, decor: lv === 4 ? 1 : 3 });
  const seats = new Set(), t0 = Date.now();
  let plies = 0;
  for (; plies < 40 && st.phase !== 'over'; plies++) { seats.add(st.turn); st = cpuPly(st); }
  const ms = (Date.now() - t0) / plies;
  ok(ms < 1500, `CPU P${P} L${lv}: ${ms.toFixed(0)} ms/ply`);
  ok(seats.size === Math.min(P, plies), `CPU P${P} L${lv}: every seat took turns`);
  console.log(`  CPU ${P} players, ${lv} tiers: ${plies} plies, ${ms.toFixed(0)} ms/ply, phase ${st.phase}`);
}
{
  // The CPU takes an immediate win for itself and sees evaluate() as a loss when another seat wins.
  const s = setup(4, [[0, 3, 1, 'o']], 0); s.captured[0] = 2;
  const m = L.bestMove(s);
  ok(L.play(s, m.idx, m.cat).state.winner === 0, 'CPU seat 0 takes the winning boop in a 4-seat game');
  const w = setup(3, [], 0); w.winner = 2; w.phase = 'over';
  ok(L.evaluate(w, 0) === -1e6 && L.evaluate(w, 1) === -1e6 && L.evaluate(w, 2) === 1e6, 'evaluate: any other winner is a loss');
}
console.log('PASS', pass, 'checks');
