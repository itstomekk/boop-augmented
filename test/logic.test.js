// Node rule tests: node test/logic.test.js
const L = require('../docs/logic.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }

const N = 7;
const at = (r, c) => r * N + c;
let nid = 900;
function fresh(levels) {
  const s = L.newGame({ levels: levels || 4, pieces: 8 });
  return s;
}
// Board with both ornaments parked safely so tests run in 'place' phase.
function setup(pieces) {
  const s = fresh();
  for (const [r, c, p, kind] of pieces) {
    s.b[at(r, c)] = { id: nid++, p, kind };
    if (kind === 'o') s.pool[p].o--; else s.pool[p][kind === 'c' ? 'c' : 'k'] -= kind === 'c' ? 0 : 1;
  }
  s.phase = 'place';
  return s;
}

// Geometry
const g4 = L.geometry(4), g6 = L.geometry(6), g8 = L.geometry(8);
ok(g4.N === 7 && g4.cells.length === 45, 'classic 7x7 minus 4 corners = 45');
const rings = [0, 0, 0, 0]; g4.cells.forEach((i) => rings[g4.ring[i]]++);
ok(rings.join() === '1,8,16,20', 'tiers 1/8/16/20, got ' + rings);
ok(g6.N === 11 && g6.cells.length === 117, '6 tiers: 11x11 minus corners');
ok(g8.cells.length === 221, '8 tiers: 15x15 minus corners');

// Golden rule: first action is hanging an ornament on tier 2
let s = fresh();
ok(s.phase === 'ornament', 'turn starts with ornament');
ok(L.ornamentCells(s).length === 8 && L.ornamentCells(s).every((i) => g4.ring[i] === 1), 'ornament cells = 8 on tier 2');
let threw = false; try { L.placeOrnament(s, at(0, 3)); } catch (e) { threw = true; }
ok(threw, 'ornament on base rejected');
s = L.placeOrnament(s, at(2, 2)).state;
ok(s.phase === 'place' && s.pool[0].o === 2, 'ornament placed, now place kitten');

// Basic boop
s = setup([[3, 4, 0, 'k']]);
let res = L.play(s, at(3, 3), false);
ok(res.state.b[at(3, 5)] && !res.state.b[at(3, 4)], 'kitten booped one step');

// Ornament cannot be booped up a tier, but can move along / down
s = setup([[1, 3, 1, 'o']]);
res = L.play(s, at(0, 3), false);                      // would push (1,3) to (2,3): tier up
ok(res.state.b[at(1, 3)] && res.state.b[at(1, 3)].kind === 'o', 'ornament not booped up a tier');
res = L.play(s, at(1, 2), false);                      // pushes along tier 3
ok(res.state.b[at(1, 4)] && res.state.b[at(1, 4)].kind === 'o', 'ornament booped along the tier');
s = setup([[2, 3, 1, 'o']]);
res = L.play(s, at(3, 3), false);                      // from tier 2 down to tier 3
ok(res.state.b[at(1, 3)] && res.state.b[at(1, 3)].kind === 'o', 'ornament booped down a tier');

// Ornament booped off: opponent's -> captured, own -> returned
s = setup([[0, 3, 1, 'o']]);
res = L.play(s, at(1, 3), false);
ok(res.state.captured[0] === 1 && !res.state.b[at(0, 3)], 'opponent ornament captured');
s = setup([[0, 3, 0, 'o']]);
const before = s.pool[0].o;
res = L.play(s, at(1, 3), false);
ok(res.state.pool[0].o === before + 1 && res.state.captured[0] === 0, 'own ornament returns to pool');

// Notched corner: diagonal push from tier 3 corner goes off the tree
s = setup([[1, 1, 1, 'k']]);
res = L.play(s, at(2, 2), false);
ok(!res.state.b[at(1, 1)] && res.state.pool[1].k === 8, 'pushed off through the notched corner');

// Kitten booped into an ornament is blocked; a cat pounces
s = setup([[3, 4, 1, 'k'], [3, 5, 0, 'o']]);
res = L.play(s, at(3, 3), false);
ok(res.state.b[at(3, 4)] && res.state.b[at(3, 5)].kind === 'o', 'kitten blocked by ornament');
s = setup([[3, 4, 1, 'c'], [3, 5, 0, 'o']]);
s.pool[0].c = 1;
res = L.play(s, at(3, 3), true);
ok(!res.state.b[at(3, 4)] && !res.state.b[at(3, 5)], 'pounce clears cat and ornament');
ok(res.state.captured[1] === 1 && res.state.pool[1].c === 1, 'cat owner captures, cat back to pool');

// Kittens cannot boop cats
s = setup([[3, 4, 1, 'c']]);
res = L.play(s, at(3, 3), false);
ok(res.state.b[at(3, 4)].kind === 'c', 'kitten does not boop cat');

// Graduation: three kittens -> three cats in the pool, removed from the tree
s = setup([[5, 1, 0, 'k'], [5, 2, 0, 'k']]);
res = L.play(s, at(5, 3), false);                      // (5,2) push left blocked by (5,1)
ok(!res.state.b[at(5, 1)] && !res.state.b[at(5, 3)], 'line removed');
ok(res.state.pool[0].c === 3 && res.state.turn === 1, 'three cats in pool, turn passes');

// Opponent's line made on my turn does not graduate now
s = setup([[5, 1, 1, 'k'], [5, 2, 1, 'k'], [4, 3, 1, 'k']]);
res = L.play(s, at(3, 4), false);                      // boops (4,3) to (5,2)? no: (5,2) occupied -> blocked
ok(res.state.pool[1].c === 0, 'opponent does not graduate on my turn');

// Nice win: three cats
s = setup([[5, 1, 0, 'c'], [5, 2, 0, 'c']]);
s.pool[0].c = 1;
res = L.play(s, at(5, 3), true);
ok(res.state.winner === 0 && res.state.winReason === 'nice-line', 'three cats win');

// Naughty win: third captured ornament
s = setup([[0, 3, 1, 'o']]);
s.captured[0] = 2;
res = L.play(s, at(1, 3), false);
ok(res.state.winner === 0 && res.state.winReason === 'naughty', 'three ornaments win');

// Four in a row -> choose which three graduate
s = setup([[5, 1, 0, 'k'], [5, 2, 0, 'k'], [5, 4, 0, 'k'], [5, 5, 1, 'k']]);
res = L.play(s, at(5, 3), false);
ok(res.state.phase === 'chooseLine' && res.state.options.length === 2, 'choose between two lines');
const ch = L.chooseLine(res.state, 1);
ok(ch.state.turn === 1 && ch.state.pool[0].c === 3, 'chosen line graduates');
ok(ch.state.b.filter((q) => q && q.p === 0 && q.kind === 'k').length === 1, 'one kitten stays');

// All 8 on the tree -> must graduate one, then the turn passes
s = setup([[0, 1, 0, 'k'], [0, 5, 0, 'k'], [2, 0, 0, 'k'], [6, 2, 0, 'k'], [6, 5, 0, 'k'], [2, 6, 0, 'k'], [4, 6, 0, 'k']]);
ok(s.pool[0].k === 1, 'one kitten left');
res = L.play(s, at(3, 3), false);
ok(res.state.phase === 'promote' && res.state.turn === 0, 'promote phase at end of turn');
const pr = L.promote(res.state, at(0, 1));
ok(pr.state.pool[0].c === 1 && pr.state.turn === 1, 'kitten graduated, turn passed');

// CPU: grabs an instant naughty win, and self-play stays legal on classic and big trees
s = setup([[0, 3, 1, 'o']]);
s.captured[0] = 2;
let m = L.bestMove(s);
ok(m && L.play(s, m.idx, m.cat).state.winner === 0, 'cpu takes the winning boop');
for (const lv of [4, 6, 8]) {
  let st = L.newGame({ levels: lv, pieces: 8 });
  const t0 = Date.now();
  let plies = 0;
  for (; plies < 24 && st.phase !== 'over'; plies++) {
    const mv = L.bestMove(st);
    if (mv.line !== undefined) { st = L.chooseLine(st, mv.line).state; continue; }
    if (mv.promote !== undefined) { st = L.promote(st, mv.promote).state; continue; }
    if (mv.orn !== null && mv.orn !== undefined) st = L.placeOrnament(st, mv.orn).state;
    if (st.phase === 'promote') st = L.promote(st, L.bestMove(st).promote).state;
    st = L.play(st, mv.idx, mv.cat).state;
  }
  const ms = (Date.now() - t0) / plies;
  ok(ms < 1500, `levels ${lv}: ${plies} plies, ${ms.toFixed(0)} ms/move`);
  console.log(`  levels ${lv}: ${plies} plies, ${ms.toFixed(0)} ms/move, phase ${st.phase}`);
}
console.log('PASS', pass, 'checks');
