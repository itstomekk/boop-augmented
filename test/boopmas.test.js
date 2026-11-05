// Boopmas spirits (tree only, house rule inspired by "the Ghosts of Boopmas!"): node test/boopmas.test.js
// Three spirits: Psst Psst (diagonal boops only), Yet to Pounce (straight boops only) and Jacob Meowly (one chosen
// direction, kittens may boop cats, blocked pieces jump over whatever blocks them). The player after a graduating
// player holds the spirit board; each spirit works once per hand-over, together with a normal placement.
const L = require('../docs/logic.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }
const throws = (fn) => { try { fn(); } catch (e) { return true; } return false; };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const same = (a, b) => canon(a) === canon(b);

const N = 7, at = (r, c) => r * N + c;
let nid = 900;
const tree = (extra) => L.newGame(Object.assign({ levels: 4, pieces: 8, ornaments: 0, boopmas: true }, extra || {}));
// Free-form position: [r, c, owner, kind]; kittens come out of the pool, cats appear "from nowhere".
function setup(opts, pieces, turn, spirits) {
  const s = tree(opts);
  for (const [r, c, p, kind] of pieces) {
    s.b[r * s.N + c] = { id: nid++, p, kind };
    if (kind === 'k') s.pool[p].k--;
    if (kind === 'o') s.pool[p].o--;
  }
  s.phase = 'place'; s.turn = turn || 0; s.nextId = nid;
  if (spirits) s.spirits = spirits;
  return s;
}
const held = (p, used) => ({ holder: p, used: used || [false, false, false] });
const hasAt = (s, r, c, p, kind) => { const q = s.b[r * s.N + c]; return !!q && q.p === p && (!kind || q.kind === kind); };
const empty = (s, r, c) => s.b[r * s.N + c] === null;
const D = { NW: 0, N: 1, NE: 2, W: 3, E: 4, SW: 5, S: 6, SE: 7 };   // indices into the eight directions
const PSST = 0, POUNCE = 1, MEOWLY = 2;

// ---------- 1. off by default, rejected where it does not belong ----------
{
  const s = L.newGame({});
  ok(s.boopmas === false && s.spirits === undefined, 'default games have no spirits');
  ok(L.newGame({ boopmas: false }).spirits === undefined, 'boopmas:false is the same as absent');
  ok(throws(() => L.newGame({ shape: 'square', size: 6, boopmas: true })), 'Boopmas spirits need the tree');
  ok(throws(() => L.newGame({ levels: 4, ghost: true, boopmas: true })), 'ghosts still need a square board');
  const b = L.newGame({ levels: 4, boopmas: true });
  ok(b.boopmas === true && same(b.spirits, { holder: null, used: [false, false, false] }), 'on: nobody holds the spirit board before the first graduation');
  ok(L.SPIRITS.length === 3 && L.SPIRITS.map((x) => x.id).join() === 'psst,pounce,meowly', 'three spirits are defined');
  for (const P of [2, 3, 4]) ok(L.newGame({ levels: 5, players: P, pieces: 8, boopmas: true }).spirits.holder === null, `${P} players start without a holder`);
  ok(same(L.clone(b), b) && L.clone(b).spirits !== b.spirits, 'clone copies the spirit board');
}

// ---------- 2. spirits need a holder, a free spirit and valid arguments ----------
{
  const s = setup({}, [[2, 3, 0, 'k']], 1);
  ok(throws(() => L.play(s, at(3, 3), false, { g: PSST })), 'no holder yet: no spirit can be used');
  ok(L.legalSpirits(s, at(3, 3)).length === 0, 'no legal spirits without a holder');
  const h = setup({}, [[2, 3, 0, 'k']], 0, held(1));
  ok(throws(() => L.play(h, at(3, 3), false, { g: PSST })) && L.legalSpirits(h, at(3, 3)).length === 0, 'the holder is seat 1: seat 0 cannot use them');
  const g = setup({}, [[2, 3, 0, 'k']], 1, held(1));
  for (const bad of [{ g: 3 }, { g: -1 }, { g: 1.5 }, { g: '0' }, { g: null }, { g: MEOWLY }, { g: MEOWLY, d: 8 }, { g: MEOWLY, d: -1 }, { g: MEOWLY, d: 1.5 }, { g: MEOWLY, d: D.W }, { g: PSST, d: 1 }, { g: POUNCE, d: 1 }, { d: 1 }, { x: 'b' }, { g: PSST, x: 's' }])
    ok(throws(() => L.play(g, at(3, 3), false, bad)), 'refused: ' + JSON.stringify(bad));
  const used = setup({}, [[2, 3, 0, 'k']], 1, held(1, [true, false, false]));
  ok(throws(() => L.play(used, at(3, 3), false, { g: PSST })) && !throws(() => L.play(used, at(3, 3), false, { g: POUNCE })), 'a used spirit cannot be used again');
  ok(!throws(() => L.play(g, at(3, 3), false)) && !throws(() => L.play(g, at(3, 3), false, {})), 'plain placements stay legal for the holder');
  ok(L.legalMoves(g).length === L.geometry(4).cells.length - 1 && L.legalMoves(g).every((m) => m.x === undefined && m.g === undefined), 'legalMoves lists plain placements only');
  const ls = L.legalSpirits(g, at(3, 3));
  ok(ls.some((x) => x.g === PSST) && ls.some((x) => x.g === POUNCE), 'legalSpirits offers Psst Psst and Yet to Pounce');
  ok(ls.filter((x) => x.g === MEOWLY).map((x) => x.d).join() === [D.N].join() && ls.length === 3, 'legalSpirits at (3,3): Psst, Pounce and Meowly aimed at the one neighbour ' + JSON.stringify(ls));
}

// ---------- 3. Psst Psst: diagonal boops only ----------
{
  const pieces = [[2, 3, 0, 'k'], [2, 2, 0, 'k'], [3, 4, 0, 'k'], [4, 4, 0, 'k']];
  const plain = L.play(setup({}, pieces, 1, held(1)), at(3, 3), false);
  ok(hasAt(plain.state, 1, 3, 0) && hasAt(plain.state, 1, 1, 0) && hasAt(plain.state, 3, 5, 0) && hasAt(plain.state, 5, 5, 0), 'baseline: a plain kitten boops all four neighbours');
  const r = L.play(setup({}, pieces, 1, held(1)), at(3, 3), false, { g: PSST });
  ok(hasAt(r.state, 1, 1, 0) && empty(r.state, 2, 2) && hasAt(r.state, 5, 5, 0) && empty(r.state, 4, 4), 'Psst Psst moves the two diagonal neighbours one cell away');
  ok(hasAt(r.state, 2, 3, 0) && hasAt(r.state, 3, 4, 0), 'straight neighbours stay where they are');
  ok(r.boops.length === 2 && r.placed.g === PSST, 'two boop events, the placement records the spirit');
  ok(r.state.spirits.used[PSST] === true && r.state.spirits.used[POUNCE] === false && r.state.spirits.holder === 1, 'only Psst Psst is spent, the holder keeps the board');
  ok(r.state.turn === 0, 'the turn passes as usual');
  // kittens still cannot boop cats, cats boop both
  const cats = setup({}, [[2, 2, 0, 'c'], [4, 4, 0, 'k']], 1, held(1)); cats.pool[1].c = 1;
  ok(hasAt(L.play(cats, at(3, 3), false, { g: PSST }).state, 2, 2, 0, 'c') && hasAt(L.play(cats, at(3, 3), false, { g: PSST }).state, 5, 5, 0), 'Psst Psst keeps "kittens do not boop cats"');
  const cr = L.play(cats, at(3, 3), true, { g: PSST }).state;
  ok(hasAt(cr, 1, 1, 0, 'c') && hasAt(cr, 5, 5, 0, 'k'), 'a cat with Psst Psst boops cats and kittens diagonally');
}

// ---------- 4. Yet to Pounce: straight boops only ----------
{
  const pieces = [[2, 3, 0, 'k'], [2, 2, 0, 'k'], [3, 4, 0, 'k'], [4, 4, 0, 'k']];
  const r = L.play(setup({}, pieces, 1, held(1)), at(3, 3), false, { g: POUNCE });
  ok(hasAt(r.state, 1, 3, 0) && empty(r.state, 2, 3) && hasAt(r.state, 3, 5, 0) && empty(r.state, 3, 4), 'Yet to Pounce moves the straight neighbours');
  ok(hasAt(r.state, 2, 2, 0) && hasAt(r.state, 4, 4, 0) && r.state.spirits.used[POUNCE], 'diagonal neighbours stay, the spirit is spent');
  // cats keep their rule in a pounce on an ornament
  const o = L.newGame({ levels: 4, pieces: 8, boopmas: true }); o.phase = 'place'; o.turn = 1; o.spirits = held(1);
  o.b[at(3, 5)] = { id: 800, p: 1, kind: 'o' }; o.pool[1].o--; o.b[at(3, 4)] = { id: 801, p: 0, kind: 'c' }; o.pool[1].c = 1;
  const p = L.play(o, at(3, 3), true, { g: POUNCE });
  ok(p.boops[0].result === 'pounce' && p.state.captured[0] === 1 && p.state.pool[0].c === 1, 'the ornament rules still apply: a pushed cat captures the opponent ornament');
}

// ---------- 5. Jacob Meowly: one direction, kittens boop cats, blocked pieces jump ----------
{
  const base = [[3, 4, 0, 'c'], [2, 3, 0, 'k']];
  const r = L.play(setup({}, base, 1, held(1)), at(3, 3), false, { g: MEOWLY, d: D.E });
  ok(hasAt(r.state, 3, 5, 0, 'c') && empty(r.state, 3, 4), 'a kitten with Meowly boops a CAT, one cell in the chosen direction');
  ok(hasAt(r.state, 2, 3, 0, 'k') && r.boops.length === 1 && r.placed.g === MEOWLY && r.placed.d === D.E, 'only the chosen neighbour moves; the placement records spirit and direction');
  ok(r.state.spirits.used[MEOWLY] && !r.state.spirits.used[PSST], 'Meowly is spent');
  const n = L.play(setup({}, base, 1, held(1)), at(3, 3), false, { g: MEOWLY, d: D.N }).state;
  ok(hasAt(n, 1, 3, 0, 'k') && hasAt(n, 3, 4, 0, 'c'), 'aimed north: the kitten moves, the cat stays');
  ok(throws(() => L.play(setup({}, base, 1, held(1)), at(3, 3), false, { g: MEOWLY })), 'Meowly needs a direction');
  ok(throws(() => L.play(setup({}, base, 1, held(1)), at(3, 3), false, { g: MEOWLY, d: D.S })), 'Meowly needs a piece in that direction');
  const ms = L.legalSpirits(setup({}, base, 1, held(1)), at(3, 3)).filter((x) => x.g === MEOWLY).map((x) => x.d).sort();
  ok(same(ms, [D.N, D.E]), 'legalSpirits lists exactly the directions that hold a piece ' + ms);
  // a blocked piece jumps over every blocker
  let s = setup({}, [[3, 4, 0, 'c'], [3, 5, 0, 'k']], 1, held(1));
  s.pool[1].c = 1;
  ok(hasAt(L.play(s, at(3, 3), true).state, 3, 4, 0, 'c'), 'baseline: without Meowly the blocked cat stays');
  {
    const j = L.play(s, at(3, 3), false, { g: MEOWLY, d: D.E });
    ok(hasAt(j.state, 3, 6, 0, 'c') && empty(j.state, 3, 4) && hasAt(j.state, 3, 5, 0, 'k'), 'Meowly: the blocked cat jumps over its neighbour to the first free cell');
    ok(j.boops[0].leap === true && j.boops[0].result === 'move' && j.boops[0].to === at(3, 6), 'the jump is flagged as a leap for the animation');
  }
  // jumping over two blockers; off the tree when the row is full
  s = setup({}, [[3, 4, 0, 'c'], [3, 5, 1, 'k'], [3, 6, 0, 'k']], 1, held(1));
  const off = L.play(s, at(3, 3), false, { g: MEOWLY, d: D.E });
  ok(empty(off.state, 3, 4) && off.state.pool[0].c === 1 && off.boops[0].result === 'off' && off.boops[0].leap === true, 'no free cell behind the blockers: the piece leaves the tree and returns to its owner');
  const col = setup({}, [[2, 3, 0, 'k'], [1, 3, 1, 'c'], [0, 3, 0, 'k']], 1, held(1));
  ok(empty(L.play(col, at(3, 3), false, { g: MEOWLY, d: D.N }).state, 2, 3), 'a jump over a column to the edge sends the piece off the tree');
  const col2 = setup({}, [[2, 3, 0, 'k'], [1, 3, 1, 'c']], 1, held(1));
  ok(hasAt(L.play(col2, at(3, 3), false, { g: MEOWLY, d: D.N }).state, 0, 3, 0, 'k'), 'a jump over one piece lands on the free cell beyond it');
  // jumping over a CAT-free neighbour: Meowly does not move anything that is not in line
  const diag = setup({}, [[2, 2, 0, 'k'], [1, 1, 1, 'k']], 1, held(1));
  const dr = L.play(diag, at(3, 3), false, { g: MEOWLY, d: D.NW });
  ok(dr.boops[0].leap === true && dr.boops[0].result === 'off' && empty(dr.state, 2, 2) && dr.state.pool[0].k === 8, 'a diagonal jump towards the notched base corner leaves the tree (the corner cell does not exist)');
}

// ---------- 6. Meowly and ornaments ----------
{
  const o = () => { const s = L.newGame({ levels: 4, pieces: 8, boopmas: true }); s.phase = 'place'; s.turn = 1; s.spirits = held(1); return s; };
  let s = o(); s.b[at(2, 3)] = { id: 810, p: 0, kind: 'o' }; s.pool[0].o--;
  let r = L.play(s, at(3, 3), false, { g: MEOWLY, d: D.N });
  ok(r.state.b[at(1, 3)] && r.state.b[at(1, 3)].kind === 'o', 'a kitten with Meowly boops an ornament down one tier');
  s = o(); s.b[at(2, 3)] = { id: 810, p: 0, kind: 'o' }; s.pool[0].o--; s.b[at(1, 3)] = { id: 811, p: 1, kind: 'k' }; s.pool[1].k--;
  r = L.play(s, at(3, 3), false, { g: MEOWLY, d: D.N });
  ok(r.state.b[at(0, 3)] && r.state.b[at(0, 3)].kind === 'o' && r.boops[0].leap, 'a blocked ornament jumps over the piece to the next free cell');
  s.b[at(0, 3)] = { id: 812, p: 0, kind: 'k' }; s.pool[0].k--;
  r = L.play(s, at(3, 3), false, { g: MEOWLY, d: D.N });
  ok(r.state.captured[1] === 1 && empty(r.state, 2, 3) && r.boops[0].result === 'captured', 'an ornament that jumps off the tree is captured by the active player');
  // never up a tier, not even by jumping
  s = o(); s.turn = 1; s.b[at(1, 3)] = { id: 813, p: 0, kind: 'o' }; s.pool[0].o--; s.b[at(2, 3)] = { id: 814, p: 1, kind: 'k' }; s.pool[1].k--;
  r = L.play(s, at(0, 3), false, { g: MEOWLY, d: D.S });
  ok(r.state.b[at(1, 3)] && r.state.b[at(1, 3)].kind === 'o' && r.boops.length === 0, 'ornaments never move up a tier, Meowly or not');
  // a kitten pushed onto an ornament jumps over it
  s = o(); s.b[at(3, 5)] = { id: 815, p: 0, kind: 'o' }; s.pool[0].o--; s.b[at(3, 4)] = { id: 816, p: 0, kind: 'k' }; s.pool[0].k--;
  r = L.play(s, at(3, 3), false, { g: MEOWLY, d: D.E });
  ok(hasAt(r.state, 3, 6, 0, 'k') && r.state.b[at(3, 5)].kind === 'o', 'a blocked kitten jumps over an ornament');
}

// ---------- 7. spirits are spent one by one ----------
{
  let s = setup({}, [], 1, held(1));
  const seq = [[at(1, 1), { g: PSST }], [at(5, 5), { g: POUNCE }]];
  s.b[at(3, 3)] = { id: 850, p: 0, kind: 'c' };
  for (const [idx, opt] of seq) {
    s = L.play(s, idx, false, opt).state;              // seat 1
    ok(s.turn === 0, 'turn passes to seat 0');
    s = L.play(s, idx === at(1, 1) ? at(0, 4) : at(6, 2), false).state;   // seat 0 plain
  }
  ok(same(s.spirits, held(1, [true, true, false])) && s.turn === 1, 'two spirits spent');
  ok(throws(() => L.play(s, at(5, 1), false, { g: PSST })) && L.legalSpirits(s, at(5, 1)).every((x) => x.g === MEOWLY), 'only the third is left');
  const t = L.play(s, at(1, 5), false).state; // a plain turn costs nothing
  ok(same(t.spirits, s.spirits), 'plain turns never change the spirit board');
}

// ---------- 8. graduation hands the board to the next seat ----------
{
  const lineSetup = (P, who, kinds) => {
    const pcs = kinds.map((k, i) => [4, 1 + i, who, k]);
    return setup({ players: P }, pcs, who, held(who, [true, true, false]));   // the graduating seat holds a half-used board
  };
  // 2 players: seat 0 graduates three kittens -> seat 1
  let s = lineSetup(2, 0, ['k', 'k', 'k']);
  let r = L.play(s, at(1, 1), false).state;
  ok(r.pool[0].c === 3 && same(r.spirits, held(1)), '2 players: seat 0 graduates, seat 1 gets all three spirits, freshly reset');
  s = lineSetup(2, 1, ['k', 'k', 'k']); s.spirits = held(1, [true, true, true]);
  r = L.play(s, at(1, 1), false).state;
  ok(same(r.spirits, held(0)), 'the holder graduates: the board goes to the other seat, reset');
  // 3 and 4 players: the seat after the graduator
  for (const [P, who, exp] of [[3, 0, 1], [3, 1, 2], [3, 2, 0], [4, 3, 0], [4, 1, 2]]) {
    s = lineSetup(P, who, ['k', 'k', 'k']);
    r = L.play(s, at(1, 1), false).state;
    ok(r.spirits.holder === exp && r.spirits.used.every((u) => u === false), `${P} players: seat ${who} graduates, seat ${exp} holds the board`);
  }
  // mixed line with one kitten still counts, three cats win instead
  s = lineSetup(2, 0, ['c', 'c', 'k']);
  r = L.play(s, at(1, 1), false).state;
  ok(r.pool[0].c === 3 && r.spirits.holder === 1 && !r.spirits.used.some(Boolean), 'a line with at least one kitten graduates it and passes the board');
  s = lineSetup(2, 0, ['c', 'c', 'c']); r = L.play(s, at(1, 1), false).state;
  ok(r.winner === 0 && r.winReason === 'nice-line', 'three cats win (no graduation)');
  // several lines: chooseLine hands over as well
  s = setup({}, [[4, 0, 0, 'k'], [4, 1, 0, 'k'], [4, 2, 0, 'k'], [4, 3, 0, 'k']], 0, held(0, [true, false, false]));
  r = L.play(s, at(1, 1), false).state;
  ok(r.phase === 'chooseLine' && same(r.spirits, held(0, [true, false, false])), 'choosing a line: nothing moves yet');
  r = L.chooseLine(r, 0).state;
  ok(r.spirits.holder === 1 && r.spirits.used.every((u) => u === false), 'after the line is chosen the board changes hands');
  // using a spirit in the very turn that graduates: the reset wins
  s = lineSetup(2, 1, ['k', 'k', 'k']); s.spirits = held(1);
  r = L.play(s, at(1, 1), false, { g: PSST }).state;
  ok(same(r.spirits, held(0)), 'a spirit used in a graduating turn is reset by the hand-over');
  // plain turns and failed lines change nothing
  s = setup({}, [[4, 1, 0, 'k'], [4, 2, 0, 'k']], 0, held(1, [false, true, false]));
  ok(same(L.play(s, at(1, 1), false).state.spirits, s.spirits), 'no graduation: spirit board untouched');
}

// ---------- 9. promotion: a kitten counts, a cat does not ----------
{
  const four = (P) => { const s = L.newGame({ levels: 4, pieces: 4, ornaments: 0, boopmas: true, players: P }); return s; };
  let s = four(2);
  s.b[at(1, 1)] = { id: 701, p: 0, kind: 'k' }; s.b[at(1, 4)] = { id: 702, p: 0, kind: 'k' }; s.b[at(5, 1)] = { id: 703, p: 0, kind: 'k' }; s.b[at(5, 4)] = { id: 704, p: 0, kind: 'k' };
  s.pool[0].k = 0; s.turn = 0; s.phase = 'promote'; s.promoteWhen = 'start'; s.spirits = held(0, [true, true, false]);
  let r = L.promote(s, at(1, 1)).state;
  ok(r.pool[0].c === 1 && r.phase === 'place' && same(r.spirits, held(1)), 'promoting a kitten graduates it: the board passes on');
  s.b[at(1, 1)] = { id: 701, p: 0, kind: 'c' }; r = L.promote(s, at(1, 1)).state;
  ok(r.pool[0].c === 1 && same(r.spirits, held(0, [true, true, false])), 'promoting a cat is not a graduation');
}

// ---------- 10. saves ----------
{
  const s = setup({ players: 3 }, [[2, 3, 0, 'k'], [3, 4, 1, 'c']], 1, held(2, [false, true, false]));
  const back = L.restoreState(JSON.parse(JSON.stringify(s)));
  ok(back && same(back, s) && back.boopmas === true && back.spirits.holder === 2, 'a saved Boopmas game round-trips');
  const bad = (f) => { const x = JSON.parse(JSON.stringify(s)); f(x); return L.restoreState(x) === null; };
  ok(bad((x) => { delete x.spirits; }), 'boopmas without a spirit board is refused');
  ok(bad((x) => { x.spirits.holder = 3; }) && bad((x) => { x.spirits.holder = -1; }) && bad((x) => { x.spirits.holder = 'a'; }), 'holder must be a seat or null');
  ok(bad((x) => { x.spirits.used = [false, false]; }) && bad((x) => { x.spirits.used = [0, 1, 0]; }) && bad((x) => { x.spirits.used = null; }), 'used must be three booleans');
  ok(bad((x) => { x.spirits = { holder: null, used: [true, false, false] }; }), 'nobody holds a used spirit');
  ok(bad((x) => { x.boopmas = 'yes'; }), 'boopmas must be a boolean');
  ok(bad((x) => { x.boopmas = false; }), 'a spirit board without boopmas is refused');
  ok(bad((x) => { x.shape = 'square'; x.L = 6; x.N = 6; x.b = new Array(36).fill(null); }), 'spirits on a square are refused');
  const plain = L.newGame({ levels: 4, pieces: 8 }), pj = JSON.parse(JSON.stringify(plain)); delete pj.boopmas;
  ok(L.restoreState(pj) && L.restoreState(pj).boopmas === false && L.restoreState(pj).spirits === undefined, 'saves from before Boopmas load as plain games');
  const nobody = L.restoreState(JSON.parse(JSON.stringify(tree())));
  ok(nobody && nobody.spirits.holder === null, 'a fresh Boopmas save keeps its empty holder');
}

// ---------- 11. fuzz: invariants, determinism, saves ----------
let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomStep(s) {
  if (s.phase === 'ornament') return { k: 'orn', i: pick(L.ornamentCells(s)) };
  if (s.phase === 'chooseLine') return { k: 'line', i: Math.floor(rnd() * s.options.length) };
  if (s.phase === 'promote') { const mine = []; s.b.forEach((q, i) => { if (q && q.p === s.turn && q.kind !== 'o') mine.push(i); }); return { k: 'promote', i: pick(mine) }; }
  const m = pick(L.legalMoves(s)), a = { k: 'play', i: m.idx, c: m.cat };
  if (rnd() < 0.6) { const sp = L.legalSpirits(s, m.idx); if (sp.length) { const x = pick(sp); a.g = x.g; if (x.d !== undefined) a.d = x.d; } }
  return a;
}
function applyStep(s, a) {
  if (a.k === 'orn') return L.placeOrnament(s, a.i).state;
  if (a.k === 'line') return L.chooseLine(s, a.i).state;
  if (a.k === 'promote') return L.promote(s, a.i).state;
  const opt = {}; if (a.g !== undefined) opt.g = a.g; if (a.d !== undefined) opt.d = a.d;
  return L.play(s, a.i, a.c, opt).state;
}
function invariants(s, label) {
  for (let p = 0; p < s.players; p++) {
    let on = 0; for (const q of s.b) if (q && q.p === p && q.kind !== 'o') on++;
    if (s.pool[p].k + s.pool[p].c + on !== s.n) return `${label}: seat ${p} piece conservation broken`;
  }
  const ids = s.b.filter(Boolean).map((q) => q.id); if (new Set(ids).size !== ids.length) return `${label}: duplicate ids`;
  if (s.spirits.holder !== null && !(s.spirits.holder >= 0 && s.spirits.holder < s.players)) return `${label}: holder`;
  if (s.spirits.holder === null && s.spirits.used.some(Boolean)) return `${label}: used spirit with no holder`;
  return null;
}
{
  let games = 0, spiritsUsed = [0, 0, 0], jumps = 0, handovers = 0, finished = 0;
  for (const [P, levels] of [[2, 4], [3, 4], [4, 4], [2, 5], [3, 6], [4, 5]]) {
    for (let g = 0; g < 14; g++) {
      let s = L.newGame({ levels, players: P, pieces: levels === 4 ? 8 : 10, boopmas: true, ornaments: g % 3 === 0 ? 0 : 3 });
      const acts = [];
      for (let ply = 0; ply < 260 && s.phase !== 'over'; ply++) {
        const a = randomStep(s), before = s.spirits.holder;
        const prevUsed = s.spirits.used.slice();
        const res = a.k === 'play' ? L.play(s, a.i, a.c, a.g !== undefined ? { g: a.g, d: a.d } : undefined) : null;
        s = res ? res.state : applyStep(s, a); acts.push(a);
        if (a.g !== undefined) spiritsUsed[a.g]++;
        if (res && res.boops.some((e) => e.leap)) jumps++;
        if (s.spirits.holder !== before && s.spirits.holder !== null) handovers++;
        const bad = invariants(s, `P${P} L${levels} game ${g} ply ${ply}`); if (bad) ok(false, bad);
        if (ply % 17 === 0) { const back = L.restoreState(JSON.parse(JSON.stringify(s))); ok(back && same(back, s), `P${P} game ${g} ply ${ply}: save round-trip`); }
      }
      // deterministic replay
      let r = L.newGame({ levels, players: P, pieces: levels === 4 ? 8 : 10, boopmas: true, ornaments: g % 3 === 0 ? 0 : 3 });
      for (const a of acts) r = applyStep(r, a);
      ok(same(r, s), `P${P} L${levels} game ${g}: replaying the actions gives the same state`);
      games++; if (s.phase === 'over') finished++;
    }
  }
  ok(spiritsUsed.every((n) => n > 20), 'fuzz exercised every spirit ' + spiritsUsed);
  ok(jumps > 10 && handovers > 40, `fuzz saw jumps (${jumps}) and hand-overs (${handovers})`);
  console.log(`  fuzz: ${games} games, ${finished} finished, spirits used ${spiritsUsed}, ${jumps} jumps, ${handovers} hand-overs`);
}

// ---------- 12. CPU ----------
{
  // only Meowly can win: the seat holds a single kitten and a cat in the line cannot be booped by a kitten otherwise
  const s = setup({}, [[2, 1, 1, 'c'], [2, 3, 1, 'c'], [3, 2, 1, 'c']], 1, held(1));
  s.pool[1].k = 1; s.pool[1].c = 0;
  const m = L.bestMove(s, { rand: 0 });
  ok(m && m.g === MEOWLY && m.d === D.N, 'the computer finds the winning Meowly boop ' + JSON.stringify(m));
  const r = L.play(s, m.idx, m.cat, { g: m.g, d: m.d });
  ok(r.state.winner === 1 && r.state.winReason === 'nice-line', 'and the move wins');
  ok(m.idx === at(4, 2), 'it places the kitten behind the cat');
  const t = setup({}, [[2, 1, 1, 'c']], 0, held(1)); t.pool[0].k = 8;
  const m2 = L.bestMove(t);
  ok(m2 && m2.g === undefined, 'a seat without the board never asks for a spirit');
  // self-play
  let total = 0, worst = 0, used = 0;
  for (const P of [2, 3, 4]) for (let g = 0; g < 3; g++) {
    let st = L.newGame({ levels: 4, players: P, pieces: 8, boopmas: true });
    for (let ply = 0; ply < 140 && st.phase !== 'over'; ply++) {
      if (st.phase === 'chooseLine' || st.phase === 'promote') { st = L.autoResolve(st); continue; }
      const t0 = Date.now();
      const q = L.bestMove(st);
      worst = Math.max(worst, Date.now() - t0);
      if (!q) break;
      if (st.phase === 'ornament') st = L.placeOrnament(st, q.orn).state;
      const opt = {}; if (q.g !== undefined) { opt.g = q.g; used++; } if (q.d !== undefined) opt.d = q.d;
      st = L.autoResolve(L.play(st, q.idx, q.cat, opt).state); total++;
      const bad = invariants(st, `CPU P${P}`); if (bad) ok(false, bad);
    }
  }
  ok(total > 300, `CPU self-play ran ${total} plies`);
  ok(used > 0, `the computer used spirits in self-play (${used})`);
  ok(worst < 4000, `slowest CPU decision ${worst} ms`);
  console.log(`  CPU: ${total} plies, ${used} spirit uses, slowest decision ${worst} ms`);
}

console.log(`PASS ${pass} checks`);
