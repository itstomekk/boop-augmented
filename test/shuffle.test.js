// Shuffle powers on the board (square boards only, house rules inspired by boop. Shuffle): node test/shuffle.test.js
// Not a card game: every power is a piece a player may choose to place. Wild kittens/cats are shared and count for
// whoever completes a line, super kittens/cats boop two cells (super cats leap over a blocked line), scaredy kittens
// are pushed along when a piece lands next to them, and the blankie puts a cat or kitten to sleep (out of play).
const L = require('../docs/logic.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }
const throws = (fn) => { try { fn(); } catch (e) { return true; } return false; };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const same = (a, b) => canon(a) === canon(b);

const N = 6, at = (r, c) => r * N + c;
let nid = 900;
const sh = (extra) => L.newGame(Object.assign({ shape: 'square', size: 6, pieces: 8, shuffle: true }, extra || {}));
// Free-form position: [r, c, owner, kind, x, cov]. owner -1 = shared wild piece. Kittens come out of their pool,
// cats appear "from nowhere" (wild cats come out of the wild kittens).
function setup(opts, pieces, turn) {
  const s = sh(opts);
  for (const [r, c, p, kind, x, cov] of pieces) {
    const q = { id: nid++, p, kind };
    if (x) q.x = x;
    if (cov !== undefined) { q.cov = { p: cov }; s.pool[cov].b--; }
    s.b[r * s.N + c] = q;
    if (x === 'w') s.wild.k--;
    else if (kind === 'k') s.pool[p][x === 's' ? 'ks' : x === 'a' ? 'ka' : 'k']--;
  }
  s.phase = 'place'; s.turn = turn || 0; s.nextId = nid;
  return s;
}
const A = (r, c, p, kind, x, cov) => [r, c, p, kind, x, cov];
const q = (s, r, c) => s.b[r * s.N + c];
const is = (s, r, c, p, kind, x) => { const v = q(s, r, c); return !!v && v.p === p && v.kind === kind && (v.x || undefined) === x; };
const empty = (s, r, c) => q(s, r, c) === null;
const play = (s, r, c, cat, x) => L.play(s, at(r, c), cat, x ? { x } : undefined);

// ---------- 1. configuration ----------
{
  const s = sh();
  ok(s.shuffle === true && s.shape === 'square' && s.ghost === false && s.boopmas === false && s.spirits === undefined, 'shuffle is a square-board mode, no ghosts, no spirits');
  ok(s.pool.every((x) => same(x, { k: 6, c: 0, o: 0, ks: 1, ka: 1, cs: 0, b: 1 })), 'each seat: 6 kittens, 1 super kitten, 1 scaredy kitten, 1 blankie (8 pieces)');
  ok(same(s.wild, { k: 2, c: 0 }) && s.phase === 'place' && s.turn === 0 && s.ornaments === 0, 'two shared wild kittens, no wild cats yet, no ornaments');
  ok(sh({ players: 4 }).pool.length === 4 && sh({ players: 3 }).pool.every((x) => x.b === 1), '3 and 4 players get their own sets');
  ok(L.newGame({ shape: 'square', size: 6, pieces: 8 }).shuffle === false && L.newGame({ shape: 'square', size: 6, pieces: 8 }).wild === undefined, 'shuffle off: no wild supply');
  ok(same(L.newGame({ shape: 'square', size: 6, pieces: 8 }).pool[0], { k: 8, c: 0, o: 0 }), 'shuffle off: pools are exactly as before');
  ok(throws(() => sh({ ghost: true })), 'no ghosts together with shuffle');
  ok(throws(() => L.newGame({ levels: 4, shuffle: true })), 'shuffle needs a square board');
  ok(throws(() => sh({ pieces: 5 })) && !throws(() => sh({ pieces: 6 })) && sh({ pieces: 6 }).pool[0].k === 4, 'at least 6 pieces so the specials fit');
  ok(L.maxPieces(6, 2, 0, 'square', true) === 17 && L.maxPieces(6, 2, 0, 'square') === 18 && L.maxPieces(6, 4, 0, 'square', true) === 9, 'maxPieces leaves room for the two wild pieces');
  ok(throws(() => sh({ pieces: 18 })) && !throws(() => sh({ pieces: 17 })), 'too many kittens refused with shuffle');
  ok(same(L.clone(s), s) && L.clone(s).wild !== s.wild && L.clone(s).pool[0] !== s.pool[0], 'clone copies wild supply and pools');
  ok(L.poolKey({ kind: 'k' }) === 'k' && L.poolKey({ kind: 'k', x: 's' }) === 'ks' && L.poolKey({ kind: 'k', x: 'a' }) === 'ka' && L.poolKey({ kind: 'c' }) === 'c' && L.poolKey({ kind: 'c', x: 's' }) === 'cs', 'poolKey names');
}

// ---------- 2. legal moves ----------
{
  const s = sh();
  const lm = L.legalMoves(s), kinds = new Set(lm.map((m) => `${m.cat}:${m.x}`));
  ok(lm.length === 36 * 4 && kinds.size === 4 && ['false:undefined', 'false:s', 'false:a', 'false:w'].every((k) => kinds.has(k)), 'empty board: kitten, super, scaredy and wild kitten on every cell, no cats, no blankie');
  for (const m of lm.slice(0, 200)) if (throws(() => L.play(s, m.idx, m.cat, m.x ? { x: m.x } : undefined))) ok(false, 'every listed move is playable: ' + JSON.stringify(m));
  const t = setup({}, [A(2, 2, 1, 'c'), A(3, 3, 0, 'k')], 0); t.pool[0].cs = 1; t.wild.c = 1;
  const bl = L.legalMoves(t).filter((m) => m.x === 'b');
  ok(bl.length === 2 && bl.every((m) => m.cat === false) && same(bl.map((m) => m.idx).sort((a, b) => a - b), [at(2, 2), at(3, 3)]), 'the blankie goes onto any uncovered piece');
  ok(L.legalMoves(t).some((m) => m.cat === true && m.x === 's') && L.legalMoves(t).some((m) => m.cat === true && m.x === 'w'), 'super cats and wild cats appear when owned');
  ok(!L.legalMoves(t).some((m) => m.cat === true && m.x === 'a') && !L.legalMoves(t).some((m) => m.cat === true && m.x === undefined), 'no plain cat, no scaredy cat');
  const e = sh(); e.pool[0].ks = 0; e.pool[0].ka = 0; e.wild.k = 0;
  ok(L.legalMoves(e).every((m) => m.x === undefined), 'spent specials disappear from the list');
  const plain = L.newGame({ shape: 'square', size: 6, pieces: 8 });
  ok(L.legalMoves(plain).length === 36 && L.legalMoves(plain).every((m) => m.x === undefined), 'plain squares list plain placements only');
  // refusals
  for (const [label, fn] of [
    ['unknown x', () => L.play(s, 0, false, { x: 'z' })], ['scaredy cat', () => { const u = sh(); u.pool[0].c = 1; return L.play(u, 0, true, { x: 'a' }); }],
    ['wild cat without a wild cat', () => L.play(s, 0, true, { x: 'w' })], ['super cat without one', () => L.play(s, 0, true, { x: 's' })],
    ['blankie on an empty cell', () => L.play(s, 0, false, { x: 'b' })], ['cat blankie', () => L.play(t, at(2, 2), true, { x: 'b' })],
    ['super kitten twice', () => { const u = sh(); u.pool[0].ks = 0; return L.play(u, 0, false, { x: 's' }); }],
    ['spirit in shuffle', () => L.play(s, 0, false, { g: 0 })], ['x on a plain square', () => L.play(plain, 0, false, { x: 's' })],
  ]) ok(throws(fn), 'refused: ' + label);
  const cov = setup({}, [A(2, 2, 1, 'c', undefined, 1)], 0);
  ok(throws(() => L.play(cov, at(2, 2), false, { x: 'b' })), 'a covered piece cannot be covered again');
  const none = setup({}, [A(2, 2, 1, 'c')], 0); none.pool[0].b = 0;
  ok(throws(() => L.play(none, at(2, 2), false, { x: 'b' })), 'no blankie, no cover');
}

// ---------- 3. super boops ----------
{
  let s = setup({}, [A(2, 3, 1, 'k')], 0);
  let r = play(s, 2, 2, false, 's');
  ok(is(r.state, 2, 5, 1, 'k') && empty(r.state, 2, 3) && r.boops.length === 1 && r.boops[0].to === at(2, 5) && r.boops[0].tc === 5, 'a super kitten boops a neighbour TWO cells');
  ok(is(r.state, 2, 2, 0, 'k', 's') && r.state.pool[0].ks === 0 && r.placed.x === 's', 'the placed piece is the super kitten, taken from the super pool');
  s = setup({}, [A(2, 3, 1, 'k'), A(2, 5, 1, 'k')], 0);
  ok(is(play(s, 2, 2, false, 's').state, 2, 4, 1, 'k'), 'second cell blocked: it only moves one');
  s = setup({}, [A(2, 3, 1, 'k'), A(2, 4, 1, 'k')], 0);
  ok(is(play(s, 2, 2, false, 's').state, 2, 3, 1, 'k') && play(s, 2, 2, false, 's').boops.length === 0, 'first cell blocked: it does not move');
  s = setup({}, [A(2, 4, 1, 'k')], 0);
  r = play(s, 2, 3, false, 's');
  ok(empty(r.state, 2, 4) && r.state.pool[1].k === 6 && r.boops[0].result === 'off', 'one cell free, then the edge: the piece leaves the board and goes home');
  s = setup({}, [A(2, 5, 1, 'k')], 0);
  ok(play(s, 2, 4, false, 's').boops[0].result === 'off', 'a piece on the edge is pushed straight off');
  s = setup({}, [A(3, 3, 1, 'k')], 0);
  ok(is(play(s, 2, 2, false, 's').state, 5, 5, 1, 'k'), 'super boops work diagonally');
  // kittens do not boop cats, super cats do
  s = setup({}, [A(2, 3, 1, 'c')], 0); s.pool[0].cs = 1;
  ok(is(play(s, 2, 2, false, 's').state, 2, 3, 1, 'c'), 'a super kitten cannot boop a cat');
  ok(is(play(s, 2, 2, true, 's').state, 2, 5, 1, 'c'), 'a super cat boops a cat two cells');
  // leap: a super cat bumps the first piece of a line over the whole line
  const row = (cols) => setup({}, cols.map((c) => A(2, c, 1, 'k')), 0);
  s = row([1, 2, 3]); s.pool[0].cs = 1;
  r = play(s, 2, 0, true, 's');
  ok(is(r.state, 2, 4, 1, 'k') && empty(r.state, 2, 1) && is(r.state, 2, 2, 1, 'k') && is(r.state, 2, 3, 1, 'k') && r.boops[0].leap === true, 'a super cat bumps the first piece of a line of three to the free cell at the end');
  s = row([1, 2, 3, 4]); s.pool[0].cs = 1;
  ok(is(play(s, 2, 0, true, 's').state, 2, 5, 1, 'k'), 'even a longer line: it lands at the end');
  s = row([1, 2, 3, 4, 5]); s.pool[0].cs = 1;
  r = play(s, 2, 0, true, 's');
  ok(empty(r.state, 2, 1) && r.state.pool[1].k === 6 - 5 + 1 && r.boops[0].result === 'off' && r.boops[0].leap, 'a full row: the bumped piece leaves the board');
  s = row([1, 2, 3]);
  ok(is(play(s, 2, 0, false, 's').state, 2, 1, 1, 'k'), 'a super KITTEN does not leap');
  s = row([1, 2, 3]); s.pool[0].c = 1;
  ok(is(L.play(s, at(2, 0), true).state, 2, 1, 1, 'k'), 'a plain cat does not leap');
  s = row([1, 3]); s.pool[0].cs = 1;
  r = play(s, 2, 0, true, 's');
  ok(is(r.state, 2, 2, 1, 'k') && is(r.state, 2, 3, 1, 'k') && !r.boops[0].leap, 'free first cell, blocked second: a super cat moves one, no leap');
  // supers booped by others move like everyone
  s = setup({}, [A(2, 3, 1, 'k', 's')], 0);
  ok(is(play(s, 2, 2, false).state, 2, 4, 1, 'k', 's'), 'a super piece that is booped moves one cell and keeps its power');
}

// ---------- 4. wild pieces ----------
{
  let s = sh(), r = play(s, 2, 2, false, 'w');
  ok(is(r.state, 2, 2, -1, 'k', 'w') && r.state.wild.k === 1 && r.state.pool[0].k === 6 && r.placed.p === -1 && r.placed.x === 'w', 'a wild kitten comes from the shared supply and belongs to nobody');
  ok(throws(() => L.play(s, 0, true, { x: 'w' })), 'there are no wild cats at the start');
  // lines: the wild piece counts for whoever is on turn
  for (const who of [0, 1]) {
    s = setup({}, [A(4, 0, who, 'k'), A(4, 1, who, 'k'), A(4, 2, -1, 'k', 'w')], who);
    r = play(s, 1, 4, false).state;
    ok(r.pool[who].c === 2 && r.wild.c === 1 && r.wild.k === 1 && empty(r, 4, 0) && empty(r, 4, 1) && empty(r, 4, 2), `seat ${who}: two kittens plus the wild kitten make a line; the wild kitten goes home as a wild CAT`);
  }
  s = setup({}, [A(4, 0, 0, 'k'), A(4, 1, 0, 'k'), A(4, 2, -1, 'k', 'w')], 1);
  r = play(s, 1, 4, false).state;
  ok(r.phase === 'place' && r.turn === 0 && !empty(r, 4, 2) && r.pool[0].c === 0, 'a line that includes a wild piece does not graduate for the other seat');
  r = play(r, 1, 3, false).state;
  ok(r.pool[0].c === 2 && r.wild.c === 1, 'it graduates at the end of its owner\'s own turn');
  // wild cats win lines
  s = setup({}, [A(4, 0, 0, 'c'), A(4, 1, 0, 'c'), A(4, 2, -1, 'c', 'w')], 0);
  s.wild.c = 0;
  r = play(s, 1, 4, false).state;
  ok(r.winner === 0 && r.winReason === 'nice-line' && same(r.winLine.slice().sort(), [at(4, 0), at(4, 1), at(4, 2)]), 'two of my cats and a wild cat: three cats in a row win');
  s.turn = 1; r = play(s, 1, 4, false).state;
  ok(r.winner === null && r.turn === 0, 'on the other seat\'s turn it is not their line');
  // booped off the board: back to the wild supply
  s = setup({}, [A(2, 5, -1, 'k', 'w')], 0);
  r = play(s, 2, 4, false);
  ok(r.boops[0].result === 'off' && r.boops[0].owner === -1 && r.state.wild.k === 2 && r.state.pool[0].k === 5 && r.state.pool[1].k === 6, 'a wild piece pushed off returns to the shared supply');
  // kitten rules
  s = setup({}, [A(2, 3, -1, 'c', 'w')], 0);
  ok(is(play(s, 2, 2, false).state, 2, 3, -1, 'c', 'w'), 'a kitten cannot boop a wild cat');
  s = sh(); s.wild.c = 1;
  r = L.play(s, at(2, 2), true, { x: 'w' }).state;
  ok(is(r, 2, 2, -1, 'c', 'w') && r.wild.c === 0, 'a wild cat can be placed once one exists');
  // two wild pieces in one line
  s = setup({}, [A(4, 0, 0, 'k'), A(4, 1, -1, 'k', 'w'), A(4, 2, -1, 'k', 'w')], 0);
  r = play(s, 1, 4, false).state;
  ok(r.pool[0].c === 1 && r.wild.c === 2 && r.wild.k === 0, 'two wild kittens and one of mine graduate: one cat for me, two wild cats go home');
  // not part of piece counts, never promoted
  s = setup({}, [A(4, 2, -1, 'k', 'w'), A(1, 1, 0, 'k')], 0);
  const c0 = L.onBoardCount(s, 0);
  ok(c0.total === 1 && c0.cats === 0 && L.onBoardCount(s, 1).total === 0, 'wild pieces are nobody\'s piece for the all-on-the-board count');
  s.phase = 'promote'; s.promoteWhen = 'start';
  ok(throws(() => L.promote(s, at(4, 2))) && !throws(() => L.promote(s, at(1, 1))), 'a wild piece cannot be promoted');
  // an all-wild line cannot exist (only two wild pieces), but the finder never counts wilds as a third owner
  s = setup({}, [A(4, 1, -1, 'k', 'w'), A(4, 2, -1, 'k', 'w')], 0);
  ok(L.findLines(s, 0).length === 0 && L.findLines(s, 1).length === 0, 'two wilds alone are not a line');
}

// ---------- 5. scaredy kittens ----------
{
  const S = (r, c, p, cov) => A(r, c, p, 'k', 'a', cov);
  let s = setup({}, [A(2, 2, 1, 'k'), S(2, 4, 1)], 0), r = play(s, 2, 1, false);
  ok(is(r.state, 2, 3, 1, 'k') && is(r.state, 2, 5, 1, 'k', 'a') && empty(r.state, 2, 4), 'a booped piece lands next to a scaredy kitten: the scaredy is booped one cell the same way');
  ok(r.boops.length === 2 && r.boops[1].scare === true && r.boops[1].kind === 'k' && r.boops[0].scare !== true, 'the scare is a separate, flagged event after the boop');
  s = setup({}, [A(2, 2, 1, 'k'), S(2, 4, 1), A(2, 5, 0, 'k')], 0);
  ok(is(play(s, 2, 1, false).state, 2, 4, 1, 'k', 'a'), 'a scaredy that cannot move stays');
  s = setup({}, [A(2, 3, 1, 'k'), S(2, 5, 0)], 0);
  r = play(s, 2, 2, false);
  ok(is(r.state, 2, 4, 1, 'k') && empty(r.state, 2, 5) && r.state.pool[0].ka === 1 && r.boops[1].result === 'off', 'a scaredy pushed off the board goes back to its owner');
  s = setup({}, [A(2, 2, 1, 'k'), S(2, 4, 1), S(3, 5, 0)], 0);
  r = play(s, 2, 1, false);
  ok(is(r.state, 2, 5, 1, 'k', 'a') && empty(r.state, 3, 5) && r.state.pool[0].ka === 1, 'chain reaction: a scaredy that moves scares the next scaredy beside it');
  s = setup({}, [A(2, 2, 1, 'k'), S(3, 4, 1)], 0);
  ok(is(play(s, 2, 1, false).state, 3, 5, 1, 'k', 'a'), 'diagonal neighbours of the landing cell are scared too');
  s = setup({}, [A(2, 2, 1, 'k'), S(3, 4, 1)], 0);
  ok(is(play(s, 1, 1, false).state, 4, 5, 1, 'k', 'a') && is(play(s, 1, 1, false).state, 3, 3, 1, 'k'), 'a diagonal boop scares in the diagonal direction');
  s = setup({}, [S(2, 2, 1), S(2, 4, 0)], 0);
  r = play(s, 2, 1, false);
  ok(is(r.state, 2, 3, 1, 'k', 'a') && is(r.state, 2, 5, 0, 'k', 'a'), 'a scaredy booped by the placed piece is itself a mover and scares its neighbour');
  s = setup({}, [A(2, 5, 1, 'k')], 0);
  ok(play(s, 2, 4, false).boops.length === 1 && play(s, 2, 4, false).boops.every((e) => !e.scare), 'a piece booped OFF the board lands nowhere, so there is nothing to scare');
  s = setup({}, [A(2, 2, 1, 'k'), S(2, 4, 1, 0)], 0);
  ok(is(play(s, 2, 1, false).state, 2, 4, 1, 'k', 'a'), 'a sleeping (covered) scaredy does not react');
  s = setup({}, [A(2, 2, 1, 'k'), A(3, 4, 1, 'c')], 0);
  ok(is(play(s, 2, 1, false).state, 3, 4, 1, 'c'), 'only scaredy kittens react, cats do not');
  s = sh(); s.pool[0].c = 1;
  ok(throws(() => L.play(s, at(0, 0), true, { x: 'a' })), 'there is no scaredy cat');
  // a super boop that lands next to a scaredy
  s = setup({}, [A(1, 2, 1, 'k'), S(2, 4, 1)], 0);
  r = play(s, 1, 1, false, 's');
  ok(is(r.state, 1, 4, 1, 'k') && is(r.state, 2, 5, 1, 'k', 'a'), 'a super boop lands two cells away and scares a scaredy beside the landing cell');
  // a scaredy at the edge of the placed piece keeps the placed piece itself untouched
  s = setup({}, [S(2, 3, 1)], 0);
  ok(is(play(s, 2, 2, false).state, 2, 4, 1, 'k', 'a') && is(play(s, 2, 2, false).state, 2, 2, 0, 'k'), 'the placed piece is never scared');
}

// ---------- 6. the blankie ----------
{
  let s = setup({}, [A(2, 2, 1, 'c'), A(2, 3, 1, 'k'), A(2, 1, 1, 'c')], 0), r = play(s, 2, 2, false, 'b');
  const c = q(r.state, 2, 2);
  ok(c && c.p === 1 && c.kind === 'c' && c.cov && c.cov.p === 0, 'the blankie covers the cat; the cat stays on its cell and remembers the blanket\'s owner');
  ok(r.state.pool[0].b === 0 && r.state.turn === 1 && r.placed.kind === 'b' && r.placed.id === c.id && r.placed.idx === at(2, 2), 'the blankie is spent and the placement is reported');
  ok(is(r.state, 2, 4, 1, 'k') && is(r.state, 2, 1, 1, 'c'), 'placing the blankie boops the neighbours like a kitten: the kitten moves, the cat does not');
  ok(throws(() => L.play(r.state, at(2, 2), false, { x: 'b' })), 'it cannot be covered twice');
  // sleeping pieces are out of play
  s = setup({}, [A(4, 0, 1, 'c'), A(4, 1, 1, 'c', undefined, 0), A(4, 2, 1, 'c')], 1);
  r = play(s, 1, 4, false).state;
  ok(r.winner === null && r.turn === 0, 'a covered cat does not count for three in a row');
  s = setup({}, [A(4, 0, 1, 'c'), A(4, 1, 1, 'c'), A(4, 2, 1, 'c')], 1);
  ok(play(s, 1, 4, false).state.winner === 1, 'the same line without the blanket wins');
  s = setup({}, [A(4, 0, 0, 'k'), A(4, 1, 0, 'k', undefined, 1), A(4, 2, 0, 'k')], 0);
  ok(play(s, 1, 4, false).state.pool[0].c === 0, 'a covered kitten does not graduate either');
  s = setup({}, [A(4, 0, 0, 'c'), A(4, 1, 0, 'c', undefined, 1)], 0);
  const cnt = L.onBoardCount(s, 0);
  ok(cnt.total === 2 && cnt.cats === 1, 'a covered piece is still on the board but is not an active cat');
  // booping a covered piece takes the blanket off instead
  const base = (extra) => setup({}, [A(2, 2, 0, 'k', undefined, 1)].concat(extra), 1);
  s = base([A(2, 3, 0, 'k')]);
  r = play(s, 2, 1, false);
  ok(is(r.state, 2, 2, 0, 'k') && !q(r.state, 2, 2).cov && q(r.state, 2, 3).cov && q(r.state, 2, 3).cov.p === 1, 'booping a sleeping piece: it stays and wakes up; the blanket lands on the piece behind it');
  ok(r.boops[0].result === 'blanket' && r.boops[0].id === q(r.state, 2, 2).id && r.boops[0].blanketTo === at(2, 3), 'a blanket event is reported');
  ok(r.state.pool[1].b === 0, 'the blanket is still on the board');
  s = base([]);
  r = play(s, 2, 1, false);
  ok(!q(r.state, 2, 2).cov && r.state.pool[1].b === 1 && r.boops[0].blanketTo === null, 'no piece behind: the blanket goes back to its owner');
  s = base([A(2, 3, 1, 'k', undefined, 0)]);
  r = play(s, 2, 1, false);
  ok(!q(r.state, 2, 2).cov && q(r.state, 2, 3).cov.p === 0 && r.state.pool[1].b === 1, 'a piece that already sleeps is not covered again: the blanket goes home');
  s = setup({}, [A(2, 5, 0, 'k', undefined, 1)], 1);
  r = play(s, 2, 4, false);
  ok(!q(r.state, 2, 5).cov && r.state.pool[1].b === 1, 'a blanket booped off the board goes back to its owner');
  s = setup({}, [A(2, 2, 0, 'c', undefined, 1)], 1);
  ok(q(play(s, 2, 1, false).state, 2, 2).cov, 'a kitten cannot boop a sleeping cat, so it stays covered');
  s.pool[1].c = 1;
  ok(!q(L.play(s, at(2, 1), true).state, 2, 2).cov, 'a cat can');
  // diagonal and the blanket's own landing piece may be an opponent\'s
  s = setup({}, [A(2, 2, 0, 'k', undefined, 1), A(3, 3, 1, 'c')], 1);
  r = play(s, 1, 1, false);
  ok(q(r.state, 3, 3).cov && q(r.state, 3, 3).cov.p === 1 && !q(r.state, 2, 2).cov, 'the blanket flies in the boop direction (diagonal) and covers whatever stands there');
  // sleeping pieces block like any piece
  s = setup({}, [A(2, 2, 0, 'k'), A(2, 3, 0, 'k', undefined, 1)], 1);
  ok(is(play(s, 2, 1, false).state, 2, 2, 0, 'k'), 'a sleeping piece blocks the way');
  // promotion of a sleeping piece returns the blanket
  s = sh({ pieces: 6 });
  [[1, 1], [1, 4], [4, 1], [4, 4], [3, 2], [2, 3]].forEach(([r0, c0], i) => { s.b[r0 * 6 + c0] = { id: 700 + i, p: 0, kind: 'k' }; });
  s.pool[0].k = 0; s.pool[0].ks = 0; s.pool[0].ka = 0; s.b[at(1, 1)].cov = { p: 1 }; s.pool[1].b = 0; s.phase = 'promote'; s.promoteWhen = 'start'; s.turn = 0;
  r = L.promote(s, at(1, 1)).state;
  ok(r.pool[0].c === 1 && r.pool[1].b === 1 && empty(r, 1, 1), 'promoting a sleeping piece returns its blanket to the owner');
  // a blanket may cover wild and own pieces
  s = setup({}, [A(2, 2, -1, 'k', 'w'), A(3, 3, 0, 'k')], 0);
  ok(q(play(s, 2, 2, false, 'b').state, 2, 2).cov && q(play(s, 3, 3, false, 'b').state, 3, 3).cov, 'wild and own pieces can be covered');
  // nice-all needs every cat awake
  s = sh({ pieces: 6 });
  [[0, 0], [0, 3], [3, 0], [5, 5], [5, 2], [2, 5]].forEach(([r0, c0], i) => { s.b[r0 * 6 + c0] = { id: 720 + i, p: 0, kind: 'c' }; });
  s.pool[0].k = 0; s.pool[0].ks = 0; s.pool[0].ka = 0; s.phase = 'place'; s.turn = 0;
  const w = s; w.pool[0].k = 1; w.b[at(5, 2)] = null;   // five cats on the board and a kitten in the pool
  ok(play(w, 5, 2, false).state.winner === null, 'five cats and a kitten is not yet the all-cats win');
}

// ---------- 7. graduation keeps the power ----------
{
  let s = setup({}, [A(4, 0, 0, 'k'), A(4, 1, 0, 'k', 's'), A(4, 2, 0, 'k', 'a')], 0);
  let r = play(s, 1, 4, false).state;
  ok(r.pool[0].c === 2 && r.pool[0].cs === 1 && r.pool[0].ka === 0, 'kitten and scaredy become plain cats, the super kitten a super cat');
  s = setup({}, [A(4, 0, 0, 'c'), A(4, 1, 0, 'c', 's'), A(4, 2, 0, 'k')], 0);
  r = play(s, 1, 4, false).state;
  ok(r.pool[0].c === 2 && r.pool[0].cs === 1, 'cats in a mixed line return as the same kind of cat');
  s = setup({}, [A(4, 0, 0, 'c'), A(4, 1, 0, 'c', 's'), A(4, 2, 0, 'c')], 0);
  r = play(s, 1, 4, false).state;
  ok(r.winner === 0 && r.winReason === 'nice-line', 'a super cat counts as a cat for the win');
  s = setup({}, [A(4, 0, 0, 'k', 's'), A(4, 1, -1, 'k', 'w'), A(4, 2, 0, 'k')], 0);
  r = play(s, 1, 4, false).state;
  ok(r.pool[0].cs === 1 && r.pool[0].c === 1 && r.wild.c === 1, 'super + wild + kitten: cs, c and a wild cat');
  // promotion mapping
  const prom = (kind, x) => {
    const t = sh({ pieces: 6 });
    const spots = [[1, 1], [1, 4], [4, 1], [4, 4], [3, 2], [2, 3]];
    spots.forEach(([r0, c0], i) => { t.b[r0 * 6 + c0] = { id: 740 + i, p: 0, kind: i === 0 ? kind : 'k' }; if (i === 0 && x) t.b[r0 * 6 + c0].x = x; });
    t.pool[0].k = 0; t.pool[0].ks = 0; t.pool[0].ka = 0; t.phase = 'promote'; t.promoteWhen = 'start'; t.turn = 0;
    return L.promote(t, at(1, 1)).state.pool[0];
  };
  ok(prom('k', 's').cs === 1 && prom('k', 'a').c === 1 && prom('k').c === 1 && prom('c', 's').cs === 1 && prom('c').c === 1, 'promotion: super stays super, scaredy becomes a plain cat');
  // all pieces on the board as cats wins
  const t = sh({ pieces: 6 });
  [[0, 0], [0, 3], [3, 0], [5, 5], [5, 2], [2, 5]].forEach(([r0, c0], i) => { t.b[r0 * 6 + c0] = { id: 760 + i, p: 0, kind: 'c' }; if (i === 2) t.b[r0 * 6 + c0].x = 's'; });
  t.pool[0].k = 0; t.pool[0].ks = 0; t.pool[0].ka = 0; t.phase = 'place'; t.turn = 0; t.b[at(5, 2)] = null; t.pool[0].c = 1;
  r = L.play(t, at(5, 2), true).state;
  ok(r.winner === 0 && r.winReason === 'nice-all', 'all six pieces on the board as cats win (super cats included)');
}

// ---------- 8. saves ----------
{
  const s = setup({ players: 3 }, [A(2, 2, 1, 'c', undefined, 0), A(1, 1, -1, 'k', 'w'), A(3, 3, 2, 'k', 'a'), A(4, 4, 0, 'k', 's')], 1);
  const back = L.restoreState(JSON.parse(JSON.stringify(s)));
  ok(back && same(back, s) && back.shuffle === true && back.wild.k === 1, 'a saved shuffle game round-trips with wild pieces, scaredy, super and blankie');
  const bad = (f) => { const x = JSON.parse(JSON.stringify(s)); f(x); return L.restoreState(x) === null; };
  ok(bad((x) => { delete x.wild; }) && bad((x) => { x.wild = { k: -1, c: 0 }; }) && bad((x) => { x.wild = { k: 1 }; }), 'wild supply must be valid');
  ok(bad((x) => { delete x.pool[0].ks; }) && bad((x) => { x.pool[1].b = 'x'; }) && bad((x) => { x.pool[2].cs = -1; }), 'shuffle pools must carry every power count');
  ok(bad((x) => { x.b[at(1, 1)].p = 0; }) && bad((x) => { x.b[at(4, 4)].p = -1; }) && bad((x) => { delete x.b[at(1, 1)].x; }), 'wild pieces must be unowned, owned pieces must not be');
  ok(bad((x) => { x.b[at(4, 4)].x = 'z'; }) && bad((x) => { x.b[at(3, 3)].kind = 'c'; }), 'unknown power and scaredy cats are refused');
  ok(bad((x) => { x.b[at(2, 2)].cov = { p: 7 }; }) && bad((x) => { x.b[at(2, 2)].cov = 3; }) && bad((x) => { x.b[at(2, 2)].cov = {}; }), 'a blanket needs a valid owner');
  ok(bad((x) => { x.shuffle = 1; }) && bad((x) => { x.shuffle = false; }) && bad((x) => { x.ghost = true; x.ghosts = [{ on: false }, { on: false }, { on: false }]; }), 'shuffle flag must be consistent');
  ok(bad((x) => { x.shape = 'tree'; x.L = 4; x.N = 7; x.b = new Array(49).fill(null); x.ornaments = 3; x.pool.forEach((p) => { p.o = 3; }); }), 'shuffle on a tree is refused');
  const plain = JSON.parse(JSON.stringify(L.newGame({ shape: 'square', size: 7, pieces: 10 }))); delete plain.shuffle;
  const pr = L.restoreState(plain);
  ok(pr && pr.shuffle === false && pr.wild === undefined && same(pr.pool[0], { k: 10, c: 0, o: 0 }), 'saves from before shuffle load as plain squares');
  const odd = JSON.parse(JSON.stringify(L.newGame({ shape: 'square', size: 7, pieces: 10 }))); odd.b[0] = { id: 5, p: 0, kind: 'k', x: 's' };
  ok(L.restoreState(odd) === null, 'a power on a non-shuffle board is refused');
}

// ---------- 9. fuzz ----------
let seed = 11; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function step(s) {
  if (s.phase === 'chooseLine') return { k: 'line', i: Math.floor(rnd() * s.options.length) };
  if (s.phase === 'promote') { const mine = []; s.b.forEach((v, i) => { if (v && v.p === s.turn) mine.push(i); }); return { k: 'promote', i: pick(mine) }; }
  const m = pick(L.legalMoves(s)); const a = { k: 'play', i: m.idx, c: m.cat }; if (m.x) a.x = m.x; return a;
}
function apply(s, a) {
  if (a.k === 'line') return L.chooseLine(s, a.i).state;
  if (a.k === 'promote') return L.promote(s, a.i).state;
  return L.play(s, a.i, a.c, a.x ? { x: a.x } : undefined).state;
}
function invariants(s, label) {
  for (let p = 0; p < s.players; p++) {
    let on = 0, cov = 0;
    for (const v of s.b) { if (v && v.p === p) on++; if (v && v.cov && v.cov.p === p) cov++; }
    const pl = s.pool[p];
    if (pl.k + pl.ks + pl.ka + pl.c + pl.cs + on !== s.n) return `${label}: seat ${p} pieces ${pl.k + pl.ks + pl.ka + pl.c + pl.cs}+${on} != ${s.n}`;
    if (pl.b + cov !== 1) return `${label}: seat ${p} blankie count ${pl.b}+${cov}`;
    for (const key of Object.keys(pl)) if (!(pl[key] >= 0)) return `${label}: negative pool ${key}`;
  }
  const wildOn = s.b.filter((v) => v && v.x === 'w').length;
  if (s.wild.k + s.wild.c + wildOn !== 2 || s.wild.k < 0 || s.wild.c < 0) return `${label}: wild count ${s.wild.k}/${s.wild.c}/${wildOn}`;
  const ids = s.b.filter(Boolean).map((v) => v.id); if (new Set(ids).size !== ids.length) return `${label}: duplicate ids`;
  for (const v of s.b) if (v) { if ((v.x === 'w') !== (v.p === -1)) return `${label}: wild owner`; if (v.x === 'a' && v.kind !== 'k') return `${label}: scaredy cat`; if (v.cov && v.kind === 'o') return `${label}: covered ornament`; }
  return null;
}
{
  const seen = { w: 0, s: 0, a: 0, b: 0, scare: 0, leap: 0, blanket: 0, cover: 0, wildCat: 0, superCat: 0, over: 0 };
  let games = 0;
  for (const P of [2, 3, 4]) for (const size of [6, 7, 8, 9, 10]) for (let g = 0; g < 6; g++) {
    const cfg = { shape: 'square', size, players: P, pieces: Math.min(8 + 2 * (size - 6), L.maxPieces(size, P, 0, 'square', true)), shuffle: true };
    let s = L.newGame(cfg); const acts = [];
    for (let ply = 0; ply < 220 && s.phase !== 'over'; ply++) {
      const a = step(s);
      const res = a.k === 'play' ? L.play(s, a.i, a.c, a.x ? { x: a.x } : undefined) : null;
      s = res ? res.state : apply(s, a); acts.push(a);
      if (a.x) seen[a.x]++;
      if (res) for (const e of res.boops) { if (e.scare) seen.scare++; if (e.leap) seen.leap++; if (e.result === 'blanket') seen.blanket++; }
      if (res && res.placed.kind === 'b') seen.cover++;
      if (a.k === 'play' && a.c && a.x === 'w') seen.wildCat++;
      if (a.k === 'play' && a.c && a.x === 's') seen.superCat++;
      const bad = invariants(s, `P${P} ${size}x${size} game ${g} ply ${ply}`); if (bad) ok(false, bad);
      if (ply % 23 === 0) { const back = L.restoreState(JSON.parse(JSON.stringify(s))); ok(back && same(back, s), `P${P} ${size} game ${g} ply ${ply}: save round-trip`); }
    }
    let r = L.newGame(cfg); for (const a of acts) r = apply(r, a);
    ok(same(r, s), `P${P} ${size}x${size} game ${g}: replay equals the game`);
    games++; if (s.phase === 'over') seen.over++;
  }
  for (const k of ['w', 's', 'a', 'b', 'scare', 'leap', 'blanket', 'cover', 'wildCat', 'superCat']) ok(seen[k] > 5, `fuzz exercised ${k} (${seen[k]})`);
  console.log(`  fuzz: ${games} games, ${seen.over} finished, ${JSON.stringify(seen)}`);
}

// ---------- 10. CPU ----------
{
  // only the wild cat can complete the line
  const s = setup({}, [A(2, 0, 1, 'c'), A(2, 1, 1, 'c')], 1);
  s.wild.c = 1; s.wild.k = 1; s.pool[1].k = 1; s.pool[1].ks = 0; s.pool[1].ka = 0; s.pool[1].b = 0; s.pool[1].c = 0;
  const m = L.bestMove(s, { rand: 0 });
  ok(m && m.x === 'w' && m.cat === true && m.idx === at(2, 2), 'the computer completes the line with the wild cat ' + JSON.stringify(m));
  ok(L.play(s, m.idx, m.cat, { x: m.x }).state.winner === 1, 'and wins');
  // every CPU move is playable in random positions
  let bad = 0, checked = 0, xs = {};
  for (const P of [2, 3, 4]) for (let g = 0; g < 4; g++) {
    let st = L.newGame({ shape: 'square', size: 6 + (g % 3), players: P, pieces: 8, shuffle: true });
    for (let ply = 0; ply < 70 && st.phase !== 'over'; ply++) {
      if (st.phase !== 'place') { st = L.autoResolve(st); continue; }
      const mv = ply % 5 === 0 ? L.bestMove(st) : null;
      if (mv) { checked++; xs[mv.x || '-'] = (xs[mv.x || '-'] || 0) + 1; try { L.play(st, mv.idx, mv.cat, mv.x ? { x: mv.x } : undefined); } catch (e) { bad++; } }
      const a = step(st); st = L.autoResolve(apply(st, a));
    }
  }
  ok(bad === 0 && checked > 40, `computer moves were always legal (${checked} checked) ${JSON.stringify(xs)}`);
  let total = 0, worst = 0, used = {};
  for (const P of [2, 3, 4]) for (const size of [6, 10]) {
    let st = L.newGame({ shape: 'square', size, players: P, pieces: Math.min(size === 6 ? 8 : 16, L.maxPieces(size, P, 0, 'square', true)), shuffle: true });
    for (let ply = 0; ply < 90 && st.phase !== 'over'; ply++) {
      if (st.phase !== 'place') { st = L.autoResolve(st); continue; }
      const t0 = Date.now(); const mv = L.bestMove(st); worst = Math.max(worst, Date.now() - t0);
      if (!mv) break;
      used[mv.x || '-'] = (used[mv.x || '-'] || 0) + 1;
      st = L.autoResolve(L.play(st, mv.idx, mv.cat, mv.x ? { x: mv.x } : undefined).state); total++;
      const b2 = invariants(st, `CPU P${P} ${size}`); if (b2) ok(false, b2);
    }
  }
  ok(total > 300, `CPU self-play ran ${total} plies`);
  ok(Object.keys(used).filter((k) => k !== '-').length >= 2, 'the computer uses specials: ' + JSON.stringify(used));
  ok(worst < 6000, `slowest CPU decision ${worst} ms`);
  console.log(`  CPU: ${total} plies, ${JSON.stringify(used)}, slowest decision ${worst} ms`);
}

console.log(`PASS ${pass} checks`);
