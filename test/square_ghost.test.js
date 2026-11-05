// Square board and ghost variant rules: node test/square_ghost.test.js
// Square: classic boop board (6x6, no ornaments, no tiers) plus larger house squares 7-10, 2-4 players.
// Ghost: house adaptation of BOOoop's ghost cats (square boards only). One optional ghost per player is placed on an
// edge stitch at the end of a turn, then moves one stitch forward at the end of each later own turn and scares the two
// cells beside its stitch sideways (leaping over blockers); it passes through other ghosts and finally exits.
const L = require('../docs/logic.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }
const throws = (fn) => { try { fn(); } catch (e) { return true; } return false; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const N = 6, at = (r, c) => r * N + c;
let nid = 900;
const sq = (extra) => L.newGame(Object.assign({ shape: 'square', size: 6, pieces: 8 }, extra || {}));
// Free-form position: [r, c, owner, kind]; kittens are taken from the pool, cats appear "from nowhere".
function setup(opts, pieces, turn) {
  const s = sq(opts);
  for (const [r, c, p, kind] of pieces) {
    s.b[r * s.N + c] = { id: nid++, p, kind };
    if (kind === 'k') s.pool[p].k--;
  }
  s.phase = 'place'; s.turn = turn || 0;
  return s;
}
const onBoard = (s, p) => s.b.filter((q) => q && q.p === p).length;
const hasAt = (s, r, c, p, kind) => { const q = s.b[r * s.N + c]; return !!q && q.p === p && (!kind || q.kind === kind); };
const stitchId = (n, d, a) => d * (n - 1) + a;

// ---------- 1. the default game is untouched ----------
{
  const s = L.newGame({});
  ok(s.shape === 'tree' && s.N === 7 && s.L === 4 && s.ghost === false && s.ghosts === undefined, 'default newGame is still the 4-tier Christmas tree without ghosts');
  ok(L.geometry(4).cells.length === 45 && L.geometry(4, "tree").cells.length === 45, "geometry(4) unchanged: 45 tree cells");
  ok(L.maxPieces(4, 4, 1) === 11 && L.maxPieces(4, 4, 1, 'tree') === 11, 'maxPieces unchanged for trees');
}

// ---------- 2. classic square board ----------
{
  const s = sq();
  ok(s.shape === 'square' && s.N === 6 && s.L === 6 && s.players === 2 && s.n === 8 && s.ghost === false, 'square 6x6, 2 players, 8 kittens, no ghosts');
  ok(s.ornaments === 0 && s.pool.every((x) => x.k === 8 && x.c === 0 && x.o === 0), 'no ornaments in a square game');
  ok(s.phase === 'place' && s.turn === 0 && s.b.length === 36 && s.b.every((q) => q === null), 'square game starts in the place phase on an empty 36-cell board');
  const g = L.geometry(6, 'square');
  ok(g.shape === 'square' && g.N === 6 && g.cells.length === 36 && g.mask.every(Boolean), 'square geometry: all 36 cells exist (corners included)');
  ok(L.onBoard(g, 0, 0) && L.onBoard(g, 5, 5) && !L.onBoard(g, 6, 0) && !L.onBoard(g, -1, 3), 'square onBoard');
  ok(L.legalMoves(s).length === 36 && L.ornamentCells(s).length === 0, 'every cell is legal, there are no ornament cells');
  for (const size of [6, 7, 8, 9, 10]) ok(sq({ size }).N === size && sq({ size }).b.length === size * size, 'square size ' + size);
  ok(throws(() => sq({ size: 5 })) && throws(() => sq({ size: 11 })) && throws(() => sq({ size: 6.5 })), 'square sizes outside 6-10 refused');
  ok(throws(() => L.newGame({ shape: 'hex' })) && throws(() => L.newGame({ shape: 'square', size: 6, ghost: 1 })) === false, 'unknown shape refused, truthy ghost accepted as flag');
  ok(sq({ ornaments: 3 }).ornaments === 0, 'ornament options are ignored on squares');
}
// Boop mechanics on the square
{
  let s = setup({}, [[2, 3, 1, 'k']], 0);
  let r = L.play(s, at(2, 2), false);
  ok(hasAt(r.state, 2, 4, 1) && r.state.b[at(2, 3)] === null, 'kitten boops a kitten one cell away');
  ok(r.boops.length === 1 && r.boops[0].result === 'move' && r.state.turn === 1, 'one boop event, turn passes');
  // corner cell and booping off the edge
  s = setup({}, [[0, 1, 1, 'k'], [1, 0, 1, 'k'], [0, 0, 1, 'k']], 0);
  r = L.play(s, at(1, 1), false);
  ok(r.state.b[at(0, 0)] === null && r.state.pool[1].k === 8 - 3 + 3 && onBoard(r.state, 1) === 0, 'booped off the edge: all three return to their owner');
  ok(r.boops.every((e) => e.result === 'off'), 'off events');
  ok(!throws(() => L.play(setup({}, [], 0), at(0, 0), false)) && !throws(() => { const c = setup({}, [], 0); c.pool[0].c = 1; L.play(c, at(5, 5), true); }), 'corner cells can be played');
  // kittens cannot boop cats, cats boop both
  s = setup({}, [[2, 3, 1, 'c']], 0);
  ok(hasAt(L.play(s, at(2, 2), false).state, 2, 3, 1, 'c'), 'kitten does not boop a cat');
  s = setup({}, [[2, 3, 1, 'c'], [3, 3, 1, 'k']], 0); s.pool[0].c = 1;
  r = L.play(s, at(2, 2), true).state;
  ok(hasAt(r, 2, 4, 1, 'c') && hasAt(r, 4, 4, 1, 'k'), 'cat boops cat and kitten');
  // blocked
  s = setup({}, [[2, 3, 1, 'k'], [2, 4, 1, 'k']], 0);
  r = L.play(s, at(2, 2), false).state;
  ok(hasAt(r, 2, 3, 1) && hasAt(r, 2, 4, 1), 'a pair in line is not pushed into itself');
  // no ornament phase ever, even with lots of play
  s = sq(); ok(s.phase === 'place', 'no ornament phase');
}
// Graduation, wins, promotion on the square
{
  let s = setup({}, [[0, 0, 0, 'k'], [0, 1, 0, 'k']], 0);
  let r = L.play(s, at(0, 2), false).state;
  ok(r.b.every((q) => q === null) && r.pool[0].c === 3 && r.pool[0].k === 5 && r.turn === 1, 'three kittens in a row graduate to cats');
  s = setup({}, [[5, 5, 0, 'k'], [4, 4, 0, 'k']], 0);
  r = L.play(s, at(3, 3), false).state;
  ok(r.pool[0].c === 3 && onBoard(r, 0) === 0, 'diagonal line graduates');
  s = setup({}, [[0, 0, 0, 'c'], [0, 1, 0, 'c']], 0); s.pool[0].c = 1; s.pool[0].k = 6;
  r = L.play(s, at(0, 2), true).state;
  ok(r.winner === 0 && r.winReason === 'nice-line' && r.phase === 'over', 'three cats in a row win');
  s = setup({}, [[0, 4, 0, 'k'], [0, 5, 0, 'k']], 0); // (0,4),(0,5) + (1,0): not a line, lines never wrap round the edge
  ok(L.play(s, at(1, 0), false).state.pool[0].c === 0, 'lines do not wrap around the board edge');
  s = sq({ pieces: 3 }); s.phase = 'place';
  // all pieces on the board as cats, not in a line: win
  s.b[at(0, 0)] = { id: 801, p: 0, kind: 'c' }; s.b[at(3, 3)] = { id: 802, p: 0, kind: 'c' };
  s.pool[0] = { k: 0, c: 1, o: 0 };
  r = L.play(s, at(5, 1), true).state;
  ok(r.winner === 0 && r.winReason === 'nice-all', 'all pieces on the board as cats wins');
  // promotion: all pieces on the board, no line
  s = sq({ pieces: 3 }); s.phase = 'place'; s.pool[0] = { k: 1, c: 0, o: 0 };
  s.b[at(0, 0)] = { id: 811, p: 0, kind: 'k' }; s.b[at(0, 3)] = { id: 812, p: 0, kind: 'k' };
  r = L.play(s, at(4, 1), false).state;
  ok(r.phase === 'promote' && r.promoteWhen === 'end', 'all pieces on the board and no line: promote');
  const pr = L.promote(r, at(0, 0)).state;
  ok(pr.pool[0].c === 1 && pr.turn === 1 && pr.b[at(0, 0)] === null, 'promotion returns a cat to the pool and ends the turn');
}
// capacity and multiple players
{
  ok(L.maxPieces(6, 4, 0, 'square') === 9 && L.maxPieces(6, 2, 0, 'square') === 18 && L.maxPieces(10, 4, 0, 'square') === 25, 'maxPieces square: ' + [L.maxPieces(6, 4, 0, 'square'), L.maxPieces(6, 2, 0, 'square')]);
  ok(throws(() => sq({ players: 4, pieces: 10 })) && !throws(() => sq({ players: 4, pieces: 9 })), '4 players on 6x6 may not bring more than 9 kittens');
  for (const P of [2, 3, 4]) {
    let s = sq({ players: P }); const order = [];
    for (let t = 0; t < 2 * P; t++) { order.push(s.turn); s = L.play(s, L.legalMoves(s)[(t * 7) % L.legalMoves(s).length].idx, false).state; if (s.phase === 'over') break; }
    ok(order.slice(0, P).join() === [...Array(P).keys()].join() && s.players === P && s.pool.length === P, P + ' players on a square rotate in seat order');
  }
}

// ---------- 3. saves ----------
{
  let s = setup({ players: 3, size: 8, pieces: 10 }, [[1, 1, 0, 'k'], [2, 5, 2, 'c']], 1);
  s.nextId = 1000;
  ok(same(L.restoreState(JSON.parse(JSON.stringify(s))), s), 'square 8x8 3-player state survives a JSON round trip');
  const old = JSON.parse(JSON.stringify(L.newGame({ levels: 5, pieces: 10 })));
  delete old.shape; delete old.ghost; delete old.ghosts;
  const back = L.restoreState(old);
  ok(back && back.shape === 'tree' && back.ghost === false && back.L === 5 && back.ornaments === 3, 'a save from before squares restores as a tree without ghosts');
  const older = JSON.parse(JSON.stringify(L.newGame({ levels: 4, pieces: 8 }))); delete older.players; delete older.shape; delete older.ghost;
  ok(L.restoreState(older) && L.restoreState(older).players === 2, 'a 2-player save from before multiplayer still loads');
  const bad = (mut) => { const x = JSON.parse(JSON.stringify(sq({ ghost: true }))); mut(x); return L.restoreState(x) === null; };
  ok(bad((x) => { x.N = 7; }) && bad((x) => { x.L = 5; x.N = 5; x.b.length = 25; }) && bad((x) => { x.shape = 'hex'; }), 'hostile square sizes and shapes refused');
  ok(bad((x) => { x.ornaments = 3; }) && bad((x) => { x.pool[0].o = 2; }), 'ornaments in a square state refused');
  ok(bad((x) => { x.ghosts = [{ on: false }]; }) && bad((x) => { x.ghosts = null; }) && bad((x) => { x.ghost = 'yes'; }), 'ghost list must match the players');
  ok(bad((x) => { x.ghosts[0] = { on: true, d: 4, a: 0, t: 0 }; }) && bad((x) => { x.ghosts[0] = { on: true, d: 0, a: 5, t: 0 }; }) && bad((x) => { x.ghosts[0] = { on: true, d: 0, a: 0, t: 6 }; }) && bad((x) => { x.ghosts[0] = { on: true, d: 0, a: 0.5, t: 0 }; }), 'ghost positions outside the board refused');
  ok(bad((x) => { x.ghosts[0] = { on: true, d: 0, a: 1, t: 2 }; x.ghosts[1] = { on: true, d: 1, a: 1, t: 2 }; }), 'two ghosts on one stitch refused');
  ok(bad((x) => { x.ghost = false; x.phase = 'ghost'; }) && bad((x) => { x.ghosts[0] = { on: true, d: 0, a: 1, t: 2 }; x.phase = 'ghost'; x.turn = 0; }), 'phase ghost needs a ghost option and a ghost in the pool');
  const tree = JSON.parse(JSON.stringify(L.newGame({ levels: 4, pieces: 8 }))); tree.ghost = true; tree.ghosts = [{ on: false }, { on: false }];
  ok(L.restoreState(tree) === null, 'ghosts on a tree state refused');
  const good = JSON.parse(JSON.stringify(sq({ ghost: true }))); good.ghosts[1] = { on: true, d: 2, a: 3, t: 4 };
  ok(L.restoreState(good) && L.restoreState(good).ghosts[1].t === 4, 'a valid ghost state restores');
}

// ---------- 4. ghost: setup, stitches, placement ----------
const gsq = (extra) => sq(Object.assign({ ghost: true }, extra || {}));
{
  const s = gsq();
  ok(s.ghost === true && s.ghosts.length === 2 && s.ghosts.every((g) => g.on === false), 'ghost game: one ghost per player, in the pool');
  ok(throws(() => L.newGame({ levels: 4, pieces: 8, ghost: true })) && throws(() => L.newGame({ shape: 'tree', ghost: true })), 'ghosts are refused on the Christmas tree');
  ok(gsq({ players: 4 }).ghosts.length === 4, '4 players: 4 ghosts');
  ok(same(L.stitchFromId(6, 0), { d: 0, a: 0, t: 0 }) && same(L.stitchFromId(6, 4), { d: 0, a: 4, t: 0 }) && same(L.stitchFromId(6, 5), { d: 1, a: 0, t: 5 }) && same(L.stitchFromId(6, 10), { d: 2, a: 0, t: 0 }) && same(L.stitchFromId(6, 19), { d: 3, a: 4, t: 5 }), 'stitch ids: 4 edges of N-1 stitches each');
  ok(L.stitchFromId(6, 20) === null && L.stitchFromId(6, -1) === null && L.stitchFromId(6, 1.5) === null, 'bad stitch ids');
  ok(same(L.ghostCells(6, { d: 0, a: 2, t: 1 }), [at(1, 2), at(1, 3)]) && same(L.ghostCells(6, { d: 1, a: 2, t: 4 }), [at(4, 2), at(4, 3)]) && same(L.ghostCells(6, { d: 2, a: 1, t: 3 }), [at(1, 3), at(2, 3)]) && same(L.ghostCells(6, { d: 3, a: 0, t: 5 }), [at(0, 5), at(1, 5)]), 'cells beside each stitch');
  ok(same(L.ghostPlace(6, { d: 0, a: 2, t: 1 }), { r: 1, c: 2.5 }) && same(L.ghostPlace(6, { d: 2, a: 1, t: 3 }), { r: 1.5, c: 3 }), 'stitch placement in cell units (top-left of a cell-sized box centred on the stitch)');
}
// Phase flow: ghost phase after the piece, optional, nothing happens on the placement turn
{
  let s = setup({ ghost: true }, [[2, 2, 1, 'k']], 0);
  let r = L.play(s, at(2, 3), false);
  ok(r.state.phase === 'ghost' && r.state.turn === 0, 'with a ghost in the pool the turn waits in the ghost phase after the piece');
  ok(L.ghostStitches(r.state).length === 20 && L.legalMoves(r.state).length === 0, '20 stitches on 6x6; no piece placement during the ghost phase');
  // piece boop already happened
  ok(hasAt(r.state, 2, 1, 1), 'the piece boop resolved before the ghost phase');
  const skip = L.skipGhost(r.state).state;
  ok(skip.phase === 'place' && skip.turn === 1 && skip.ghosts[0].on === false, 'skipping keeps the ghost in the pool and passes the turn');
  // placing next to pieces does nothing to them
  const id = stitchId(6, 0, 1);  // between (0,1),(0,2) entering from the top
  const place = L.placeGhost(r.state, id);
  ok(same(place.state.ghosts[0], { on: true, d: 0, a: 1, t: 0 }) && place.state.turn === 1 && place.state.phase === 'place', 'ghost appears on the stitch, turn passes');
  ok(same(place.state.b, r.state.b) && place.ghost.player === 0 && place.ghost.id === id, 'a placed ghost does not affect any piece');
  ok(throws(() => L.placeGhost(skip, id)) && throws(() => L.placeGhost(r.state, 20)) && throws(() => L.placeGhost(r.state, -1)), 'cannot place outside the ghost phase or on a bad stitch');
  ok(throws(() => L.skipGhost(skip)), 'cannot skip outside the ghost phase');
  ok(throws(() => L.play(r.state, at(5, 5), false)), 'no piece play during the ghost phase');
  // the other player's ghost phase comes next turn (own ghost in pool)
  const n2 = L.play(place.state, at(5, 5), false).state;
  ok(n2.phase === 'ghost' && n2.turn === 1 && L.ghostStitches(n2).length === 19, 'opponent: ghost phase, the occupied stitch is not offered');
  ok(throws(() => L.placeGhost(n2, id)), 'cannot place a ghost on an occupied stitch');
  // 20 stitch ids all work and keep the cell geometry inside the board
  for (let i = 0; i < 20; i++) { const g = L.placeGhost(r.state, i).state.ghosts[0]; ok(L.ghostCells(6, g).every((c) => c >= 0 && c < 36), 'stitch ' + i + ' lies on the board'); }
}

// ---------- 5. ghost: movement and scaring ----------
// p0 ghost on board at `g`; p0 to move. A far-away kitten at (5,5) keeps the placed piece out of the way.
function ghostTurn(pieces, g, extra, play) {
  const s = setup(Object.assign({ ghost: true }, extra || {}), pieces, 0);
  s.ghosts[0] = Object.assign({ on: true }, g);
  const pl = play || [5, 5];
  return L.play(s, at(pl[0], pl[1]), false);
}
{
  // ghost enters from the top between columns 2 and 3; first move: row 1; scares (1,2) west and (1,3) east
  let r = ghostTurn([[1, 2, 1, 'k'], [1, 3, 0, 'c'], [0, 2, 1, 'k'], [2, 3, 1, 'k']], { d: 0, a: 2, t: 0 });
  ok(r.state.ghosts[0].t === 1 && hasAt(r.state, 1, 1, 1, 'k') && hasAt(r.state, 1, 4, 0, 'c'), 'ghost moves one stitch and scares both cells beside it sideways (kitten of any colour, cat)');
  ok(hasAt(r.state, 0, 2, 1) && hasAt(r.state, 2, 3, 1), 'pieces in front/behind the stitch (not beside it) stay put');
  ok(r.ghostMove && r.ghostMove.player === 0 && r.ghostMove.from.t === 0 && r.ghostMove.to.t === 1 && r.ghostMove.scares.length === 2 && r.ghostMove.scares.every((e) => e.ghost === true && e.result === 'move' && !e.leap), 'ghost move event for the UI');
  ok(r.state.phase === 'ghost' ? false : r.state.turn === 1, 'a ghost on the board does not enter the ghost phase');
  // the ghost scares the owner's own kittens and kittens even if a kitten would not boop a cat
  r = ghostTurn([[1, 2, 0, 'c']], { d: 0, a: 2, t: 0 });
  ok(hasAt(r.state, 1, 1, 0, 'c'), 'a ghost scares cats, even own cats');
  // leaping over blockers: (1,2) is scared west over (1,1) to the open (1,0)
  r = ghostTurn([[1, 2, 1, 'k'], [1, 1, 0, 'k']], { d: 0, a: 2, t: 0 });
  ok(hasAt(r.state, 1, 0, 1) && hasAt(r.state, 1, 1, 0) && r.ghostMove.scares[0].leap === true && r.ghostMove.scares[0].to === at(1, 0), 'scared piece leaps over a blocker to the next open cell');
  // leaping over a long run
  r = ghostTurn([[1, 3, 1, 'k'], [1, 4, 0, 'k']], { d: 0, a: 2, t: 0 });
  ok(hasAt(r.state, 1, 5, 1) && hasAt(r.state, 1, 4, 0), 'leap east over one blocker to the edge cell');
  // no space: scared off the board, back to the owner
  r = ghostTurn([[1, 3, 1, 'k'], [1, 4, 0, 'k'], [1, 5, 0, 'k']], { d: 0, a: 2, t: 0 });
  ok(r.state.b[at(1, 3)] === null && r.state.pool[1].k === 8 && r.ghostMove.scares[0].result === 'off' && onBoard(r.state, 0) === 3, 'with no open cell the piece is scared off the bed and returns');
  // at the very edge
  r = ghostTurn([[1, 0, 0, 'k'], [1, 5, 1, 'k']], { d: 0, a: 0, t: 0 });
  ok(r.state.b[at(1, 0)] === null && hasAt(r.state, 1, 2, 1) === false && hasAt(r.state, 1, 5, 1), 'ghost between columns 0 and 1: west cell is scared off the board');
  ok(r.state.pool[0].k >= 7, 'the piece scared off returns to its owner');
  // the two sides are independent
  r = ghostTurn([[1, 2, 1, 'k'], [1, 1, 1, 'k'], [1, 3, 1, 'k'], [1, 4, 1, 'k']], { d: 0, a: 2, t: 0 });
  ok(hasAt(r.state, 1, 0, 1) && hasAt(r.state, 1, 5, 1) && hasAt(r.state, 1, 1, 1) && hasAt(r.state, 1, 4, 1) && onBoard(r.state, 1) === 4, 'each side leaps independently');
  // other three directions
  const dirs = [
    { g: { d: 1, a: 2, t: 5 }, tgt: [4, 2], moved: { A: [4, 1], B: [4, 4] } },   // moving up: row 4, same sideways scare
    { g: { d: 2, a: 2, t: 0 }, tgt: [2, 1], moved: { A: [1, 1], B: [4, 1] } },   // moving right: column 1, scare up and down
    { g: { d: 3, a: 2, t: 5 }, tgt: [2, 4], moved: { A: [1, 4], B: [4, 4] } },   // moving left: column 4
  ];
  r = ghostTurn([[4, 2, 1, 'k'], [4, 3, 1, 'k']], dirs[0].g);
  ok(r.state.ghosts[0].t === 4 && hasAt(r.state, 4, 1, 1) && hasAt(r.state, 4, 4, 1), 'ghost entering from the bottom moves up and scares sideways');
  r = ghostTurn([[2, 1, 1, 'k'], [3, 1, 1, 'k']], dirs[1].g);
  ok(r.state.ghosts[0].t === 1 && hasAt(r.state, 1, 1, 1) && hasAt(r.state, 4, 1, 1), 'ghost entering from the left moves right and scares up and down');
  r = ghostTurn([[2, 4, 1, 'k'], [3, 4, 1, 'k']], dirs[2].g);
  ok(r.state.ghosts[0].t === 4 && hasAt(r.state, 1, 4, 1) && hasAt(r.state, 4, 4, 1), 'ghost entering from the right moves left and scares up and down');
  r = ghostTurn([[2, 1, 1, 'k'], [3, 1, 1, 'k'], [1, 1, 0, 'k']], dirs[1].g);
  ok(hasAt(r.state, 0, 1, 1) && hasAt(r.state, 4, 1, 1) && hasAt(r.state, 1, 1, 0), 'vertical scare leaps over a blocker too');
  // no diagonal effect
  r = ghostTurn([[0, 1, 1, 'k'], [2, 1, 1, 'k'], [2, 4, 1, 'k'], [0, 4, 1, 'k']], { d: 0, a: 2, t: 0 });
  ok(hasAt(r.state, 0, 1, 1) && hasAt(r.state, 2, 1, 1) && hasAt(r.state, 2, 4, 1) && hasAt(r.state, 0, 4, 1), 'diagonal neighbours of the stitch are not scared');
  // normal boop order: the placed piece boops first, then the ghost moves
  r = ghostTurn([[1, 3, 1, 'k']], { d: 0, a: 2, t: 0 }, {}, [1, 4]);
  ok(hasAt(r.state, 1, 1, 1) && r.state.b[at(1, 2)] === null && r.state.b[at(1, 3)] === null && hasAt(r.state, 1, 4, 0), 'the placed piece boops first ((1,3) -> (1,2)), then the ghost scares it on from there to (1,1)');
}
// Ghost lifetime: placed turn t0 (no move), then 5 moves, then the exit on the sixth own turn; no same-turn replacement
{
  let s = setup({ ghost: true }, [], 0);
  s.ghosts[0] = { on: true, d: 0, a: 3, t: 0 };
  const seen = [];
  let turns = 0, exitedTurn = null;
  while (turns < 40 && exitedTurn === null) {
    if (s.turn === 0) {
      const wasOn = s.ghosts[0].on, wasT = s.ghosts[0].t;
      const free = L.legalMoves(s).find((m) => m.idx === at(5, turns % 6));
      s = L.play(s, (free || L.legalMoves(s)[0]).idx, false).state;
      if (wasOn) {
        if (s.ghosts[0].on) seen.push(s.ghosts[0].t);
        else { exitedTurn = turns; seen.push('exit'); ok(s.phase !== 'ghost', 'the ghost returned this turn: it cannot be placed again in the same turn'); }
        ok(!wasOn || !s.ghosts[0].on || s.ghosts[0].t === wasT + 1, 'ghost advances exactly one stitch per own turn');
      }
      turns++;
    } else {
      if (s.phase === 'ghost') s = L.skipGhost(s).state;
      else s = L.play(s, L.legalMoves(s).find((m) => m.idx === at(0, s.moves % 6) ) ? at(0, s.moves % 6) : L.legalMoves(s)[0].idx, false).state;
      if (s.phase === 'ghost') s = L.skipGhost(s).state;
    }
    if (s.phase === 'over') break;
  }
  ok(seen.join() === '1,2,3,4,5,exit', 'ghost lifetime on 6x6: stitches 1-5 then exit: ' + seen.join());
  if (s.phase !== 'over') {
    ok(s.ghosts[0].on === false, 'ghost back in the pool after the exit');
    // next turn of the owner: a new ghost phase is offered
    while (s.turn !== 0) { s = s.phase === 'ghost' ? L.skipGhost(s).state : L.play(s, L.legalMoves(s)[0].idx, false).state; if (s.phase === 'ghost' && s.turn === 1) s = L.skipGhost(s).state; if (s.phase === 'over') break; }
  }
}
// Passing through other ghosts
{
  // p1's ghost shares p0's next stitch (opposite direction on the same line also counts as the same stitch)
  for (const other of [{ d: 0, a: 2, t: 1 }, { d: 1, a: 2, t: 1 }]) {
    const s = setup({ ghost: true }, [[1, 2, 1, 'k'], [2, 2, 1, 'k']], 0);
    s.ghosts[0] = { on: true, d: 0, a: 2, t: 0 }; s.ghosts[1] = Object.assign({ on: true }, other);
    const r = L.play(s, at(5, 5), false);
    ok(r.state.ghosts[0].t === 2 && hasAt(r.state, 1, 2, 1) && hasAt(r.state, 2, 1, 1), 'ghost passes through a ghost on its next stitch to the next open one (and does not scare for the skipped stitch)');
    ok(r.ghostMove.passed === 1 && r.state.ghosts[1].t === 1, 'pass-through is reported; the other ghost is untouched');
  }
  // a different line does not block
  {
    const s = setup({ ghost: true }, [[1, 2, 1, 'k']], 0);
    s.ghosts[0] = { on: true, d: 0, a: 2, t: 0 }; s.ghosts[1] = { on: true, d: 0, a: 3, t: 1 };
    const r = L.play(s, at(5, 5), false);
    ok(r.state.ghosts[0].t === 1 && hasAt(r.state, 1, 1, 1), 'a ghost on the neighbouring stitch does not block');
    const s2 = setup({ ghost: true }, [], 0); s2.ghosts[0] = { on: true, d: 0, a: 2, t: 0 }; s2.ghosts[1] = { on: true, d: 2, a: 1, t: 1 };
    ok(L.play(s2, at(5, 5), false).state.ghosts[0].t === 1, 'a crossing ghost on another orientation does not block');
  }
  // all remaining stitches taken: the ghost leaves
  {
    const s = setup({ ghost: true, players: 4 }, [[1, 2, 1, 'k']], 0);
    s.ghosts[0] = { on: true, d: 0, a: 2, t: 3 }; s.ghosts[1] = { on: true, d: 0, a: 2, t: 4 }; s.ghosts[2] = { on: true, d: 1, a: 2, t: 5 };
    const r = L.play(s, at(5, 0), false);
    ok(r.state.ghosts[0].on === false && r.ghostMove.to === null && r.state.phase === 'place' && r.state.turn === 1, 'no open stitch ahead: the ghost leaves and returns to the pool (no replacement this turn)');
  }
  // passing through also happens when the other ghost was just placed
  {
    const s = setup({ ghost: true }, [], 0);
    s.ghosts[0] = { on: true, d: 0, a: 2, t: 4 }; s.ghosts[1] = { on: true, d: 0, a: 2, t: 5 };
    const r = L.play(s, at(5, 0), false);
    ok(r.state.ghosts[0].on === false, 'passing through the last stitch means leaving the board');
  }
}
// ghosts never block or affect normal boops and line-making
{
  const base = [[2, 3, 1, 'k'], [2, 2, 0, 'k']];
  const plain = setup({ ghost: true }, base, 0), withGhost = setup({ ghost: true }, base, 0);
  withGhost.ghosts[1] = { on: true, d: 0, a: 2, t: 2 };   // sits between (2,2),(2,3)
  const a = L.play(plain, at(2, 1), false).state, b = L.play(withGhost, at(2, 1), false).state;
  ok(same(a.b.map((q) => q && [q.p, q.kind]), b.b.map((q) => q && [q.p, q.kind])), 'a ghost on a stitch changes nothing about normal boops');
  const lineSetup = setup({ ghost: true }, [[2, 1, 0, 'k'], [2, 2, 0, 'k']], 0);
  lineSetup.ghosts[1] = { on: true, d: 0, a: 1, t: 2 };   // sits between (2,1) and (2,2)
  const l = L.play(lineSetup, at(2, 0), false).state;
  ok(l.phase === 'ghost' && l.b[at(2, 1)] && L.findLines(l, 0).length === 1, 'a line can be made straight through a ghost');
}

// ---------- 6. ghost: resolution order ----------
{
  // line created for the active player by their own ghost: resolved after the ghost
  let s = setup({ ghost: true }, [[0, 0, 0, 'k'], [2, 2, 0, 'k'], [1, 2, 0, 'k']], 0);
  s.ghosts[0] = { on: true, d: 0, a: 2, t: 0 };       // moves to row 1: scares (1,2) west onto (1,1) = diagonal (0,0),(1,1),(2,2)
  let r = L.play(s, at(5, 5), false);
  ok(r.state.pool[0].c === 3 && r.state.b[at(0, 0)] === null && r.state.b[at(1, 1)] === null && r.state.b[at(2, 2)] === null, 'a line made by the player\'s own ghost graduates (resolved after the ghost)');
  // line created by ghost for the opponent: no graduation on this turn, graduates at the end of the opponent's turn
  s = setup({ ghost: true }, [[0, 0, 1, 'k'], [2, 2, 1, 'k'], [1, 2, 1, 'k']], 0);
  s.ghosts[0] = { on: true, d: 0, a: 2, t: 0 };
  r = L.play(s, at(5, 5), false);
  ok(r.state.b[at(1, 1)] && r.state.b[at(1, 1)].p === 1 && r.state.pool[1].c === 0 && r.state.winner === null && r.state.turn === 1, 'a line the ghost makes for an opponent does not graduate on my turn');
  let t = r.state;
  t = L.play(t, at(4, 0), false).state;                          // opponent plays a harmless kitten: still in a row at the end of their turn
  ok(t.phase === 'ghost' && t.pool[1].c === 0, 'opponent turn: the line still waits while they decide about their ghost');
  t = L.skipGhost(t).state;
  ok(t.pool[1].c === 3 && t.b[at(1, 1)] === null && t.turn === 0, 'the opponent\'s line graduates at the end of their own turn if it is still there');
  // cats: a three-cat line made by the active ghost wins immediately; for the opponent only at the end of their turn
  s = setup({ ghost: true }, [[0, 0, 0, 'c'], [2, 2, 0, 'c'], [1, 2, 0, 'c']], 0);
  s.ghosts[0] = { on: true, d: 0, a: 2, t: 0 };
  r = L.play(s, at(5, 5), false);
  ok(r.state.winner === 0 && r.state.winReason === 'nice-line' && r.state.phase === 'over', 'three cats made by the active player\'s ghost win');
  s = setup({ ghost: true }, [[0, 0, 1, 'c'], [2, 2, 1, 'c'], [1, 2, 1, 'c']], 0);
  s.ghosts[0] = { on: true, d: 0, a: 2, t: 0 };
  r = L.play(s, at(5, 5), false);
  ok(r.state.winner === null && r.state.phase === 'place' && r.state.turn === 1, 'three cats made for the opponent by my ghost are not a win yet');
  t = r.state;
  ok(t.phase === 'place' || t.phase === 'ghost', 'opponent to move');
  t = L.play(t, at(4, 0), false).state; t = L.skipGhost(t).state;
  ok(t.winner === 1 && t.winReason === 'nice-line', 'they win if the cats are still in a row at the end of their own turn');
  // ghost phase: resolution waits for the placement
  s = setup({ ghost: true }, [[0, 0, 0, 'k'], [0, 1, 0, 'k']], 0);
  r = L.play(s, at(0, 2), false);
  ok(r.state.phase === 'ghost' && r.state.b[at(0, 0)] && r.state.pool[0].c === 0, 'a completed line waits for the ghost decision before graduating');
  const done = L.placeGhost(r.state, 3).state;
  ok(done.b[at(0, 0)] === null && done.pool[0].c === 3 && done.turn === 1 && done.ghosts[0].on, 'placing the ghost then graduates the line and passes the turn');
  const done2 = L.skipGhost(r.state).state;
  ok(done2.pool[0].c === 3 && done2.turn === 1 && !done2.ghosts[0].on, 'skipping the ghost then graduates the line');
  // several lines: choose line after the ghost decision
  s = setup({ ghost: true }, [[0, 0, 0, 'k'], [0, 1, 0, 'k'], [1, 2, 0, 'k'], [2, 2, 0, 'k']], 0);
  r = L.play(s, at(0, 2), false);
  ok(r.state.phase === 'ghost', 'two lines: ghost phase first');
  const cl = L.skipGhost(r.state).state;
  ok(cl.phase === 'chooseLine' && cl.options.length >= 2, 'two lines: choose after the ghost decision');
  const cl2 = L.chooseLine(cl, 0).state;
  ok(cl2.turn === 1 && cl2.phase !== 'chooseLine', 'line chosen, turn passes');
  // all pieces on the board, no line: promote after the ghost decision
  s = sq({ pieces: 3, ghost: true }); s.phase = 'place'; s.pool[0] = { k: 1, c: 0, o: 0 };
  s.b[at(0, 0)] = { id: 821, p: 0, kind: 'k' }; s.b[at(0, 3)] = { id: 822, p: 0, kind: 'k' };
  r = L.play(s, at(4, 1), false);
  ok(r.state.phase === 'ghost', 'promotion waits for the ghost decision');
  const pm = L.skipGhost(r.state).state;
  ok(pm.phase === 'promote' && pm.promoteWhen === 'end', 'then promotion');
}

// ---------- 7. determinism, invariants, saves, many random games ----------
let seed = 424242; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomAction(s) {
  if (s.phase === 'ghost') return rnd() < 0.7 ? { k: 'ghost', i: pick(L.ghostStitches(s)) } : { k: 'skip' };
  if (s.phase === 'place') { const all = L.legalMoves(s), cats = all.filter((m) => m.cat); const m = rnd() < 0.4 && cats.length ? pick(cats) : pick(all); return { k: 'play', i: m.idx, c: m.cat }; }
  if (s.phase === 'chooseLine') return { k: 'line', i: Math.floor(rnd() * s.options.length) };
  const mine = []; s.b.forEach((q, i) => { if (q && q.p === s.turn && q.kind !== 'o') mine.push(i); });
  return { k: 'promote', i: pick(mine) };
}
function apply(s, a) {
  if (a.k === 'ghost') return L.placeGhost(s, a.i).state;
  if (a.k === 'skip') return L.skipGhost(s).state;
  if (a.k === 'play') return L.play(s, a.i, a.c).state;
  if (a.k === 'line') return L.chooseLine(s, a.i).state;
  return L.promote(s, a.i).state;
}
function invariants(s, label) {
  for (let p = 0; p < s.players; p++) {
    const ob = L.onBoardCount(s, p), pl = s.pool[p];
    if (pl.k + pl.c + ob.total !== s.n) ok(false, `${label}: piece conservation for seat ${p}`);
    if (pl.o !== 0 || s.captured[p] !== 0) ok(false, label + ': ornaments appeared in a square game');
  }
  if (s.ghost) {
    const keys = new Set();
    for (const g of s.ghosts) if (g.on) {
      if (g.t < 0 || g.t >= s.N || g.a < 0 || g.a > s.N - 2 || g.d < 0 || g.d > 3) ok(false, label + ': ghost outside the board');
      const key = (g.d < 2 ? 0 : 1) + ':' + g.t + ':' + g.a;
      if (keys.has(key)) ok(false, label + ': two ghosts on one stitch');
      keys.add(key);
    }
  }
  if (s.phase === 'ghost' && s.ghosts[s.turn].on) ok(false, label + ': ghost phase while the ghost is on the board');
  const back = L.restoreState(JSON.parse(JSON.stringify(s)));
  if (!back || !same(back, s)) ok(false, label + ': state does not survive save/restore');
}
let plies = 0, games = 0, ghostPlaced = 0, ghostExits = 0, leaps = 0, ghostWins = 0;
const finishes = {};
for (const cfg of [
  { size: 6, players: 2, ghost: true }, { size: 6, players: 3, ghost: true }, { size: 6, players: 4, pieces: 9, ghost: true },
  { size: 7, players: 2, pieces: 10, ghost: true }, { size: 8, players: 3, pieces: 12, ghost: true }, { size: 10, players: 4, pieces: 16, ghost: true },
  { size: 6, players: 2 }, { size: 9, players: 3, pieces: 14 },
]) for (let g = 0; g < 12; g++) {
  let s = L.newGame(Object.assign({ shape: 'square', pieces: 8 }, cfg)); games++;
  const log = [], t0 = s;
  for (let k = 0; k < 400 && s.phase !== 'over'; k++) {
    const a = randomAction(s);
    const before = s;
    const res = a.k === 'play' ? L.play(s, a.i, a.c) : null;
    s = apply(s, a); log.push(a); plies++;
    if (a.k === 'ghost') ghostPlaced++;
    if (res && res.ghostMove) { if (res.ghostMove.to === null) ghostExits++; for (const e of res.ghostMove.scares) if (e.leap) leaps++; }
    invariants(s, `${JSON.stringify(cfg)} game ${g} ply ${k}`);
    if (before.phase === 'over') ok(false, 'played after the game was over');
  }
  // replay determinism
  let again = t0; for (const a of log) again = apply(again, a);
  ok(same(again, s), 'replaying the same actions gives the identical state');
  if (s.phase === 'over') { finishes[s.winReason] = (finishes[s.winReason] || 0) + 1; if (cfg.ghost) ghostWins++; }
}
ok(plies > 5000 && ghostPlaced > 200 && ghostExits > 20 && leaps > 5, `fuzz coverage: ${games} games, ${plies} plies, ${ghostPlaced} ghosts placed, ${ghostExits} exits, ${leaps} leaps`);
console.log(`  fuzz: ${games} games, ${plies} plies, ghosts placed ${ghostPlaced}, exits ${ghostExits}, leaps ${leaps}, finished ${JSON.stringify(finishes)}`);

// ---------- 8. CPU ----------
{
  const s0 = setup({ ghost: true }, [[1, 1, 1, 'k']], 0);
  const m = L.bestMove(s0);
  ok(m && m.idx !== undefined && L.legalMoves(s0).some((x) => x.idx === m.idx && x.cat === m.cat), 'CPU picks a legal piece move on a square ghost game');
  const after = L.play(s0, m.idx, m.cat).state;
  ok(after.phase === 'ghost', 'the CPU turn reaches the ghost phase');
  const gm = L.bestMove(after);
  ok(gm && (gm.skip === true || (Number.isInteger(gm.ghost) && L.ghostStitches(after).includes(gm.ghost))), 'CPU ghost decision is a legal stitch or a skip: ' + JSON.stringify(gm));
  ok(L.autoResolve(after).phase === 'place', 'autoResolve skips the ghost placement during search');
  // a ghost whose path scares an opponent piece off the bed is worth placing; one that cannot help is not
  const good = setup({ ghost: true }, [[1, 0, 1, 'c'], [5, 5, 0, 'k']], 0); good.phase = 'ghost';
  const bad = setup({ ghost: true }, [[1, 2, 0, 'c']], 0); bad.phase = 'ghost';
  const gg = L.bestMove(good), gb = L.bestMove(bad);
  ok(gg && Number.isInteger(gg.ghost) && L.ghostStitches(good).includes(gg.ghost), 'CPU places a ghost whose path scares an opponent piece off the bed: ' + JSON.stringify(gg));
  ok(gb && gb.skip === true, 'CPU keeps its ghost when no stitch can help: ' + JSON.stringify(gb));
  // self-play on square boards, incl. ghosts and 3-4 players
  for (const cfg of [{ size: 6, players: 2, ghost: true }, { size: 8, players: 3, pieces: 12, ghost: true }, { size: 6, players: 4, pieces: 9, ghost: true }, { size: 10, players: 2, pieces: 16 }]) {
    let s = L.newGame(Object.assign({ shape: 'square', pieces: 8 }, cfg)); const t0 = Date.now(); let n = 0, placed = 0;
    while (s.phase !== 'over' && n < 36) {
      const mv = L.bestMove(s, { depth: 1 });
      if (mv.line !== undefined) s = L.chooseLine(s, mv.line).state;
      else if (mv.promote !== undefined) s = L.promote(s, mv.promote).state;
      else if (s.phase === 'ghost') { if (mv.skip) s = L.skipGhost(s).state; else { s = L.placeGhost(s, mv.ghost).state; placed++; } }
      else s = L.play(s, mv.idx, mv.cat).state;
      invariants(s, 'CPU ' + JSON.stringify(cfg)); n++;
    }
    console.log(`  CPU ${cfg.players}p ${cfg.size}x${cfg.size}${cfg.ghost ? ' ghost' : ''}: ${n} plies, ${Math.round((Date.now() - t0) / n)} ms/ply, ${placed} ghosts placed, phase ${s.phase}`);
    ok(n > 10, 'CPU self-play ran');
  }
  // depth-2 timing on the biggest board
  const big = L.newGame({ shape: 'square', size: 10, players: 2, pieces: 16, ghost: true });
  let st = big, tmax = 0;
  for (let i = 0; i < 12 && st.phase !== 'over'; i++) { const t = Date.now(); const mv = L.bestMove(st); tmax = Math.max(tmax, Date.now() - t); st = mv.skip ? L.skipGhost(st).state : mv.ghost !== undefined ? L.placeGhost(st, mv.ghost).state : mv.line !== undefined ? L.chooseLine(st, mv.line).state : mv.promote !== undefined ? L.promote(st, mv.promote).state : L.play(st, mv.idx, mv.cat).state; }
  console.log(`  CPU 10x10 ghost depth 2: slowest move ${tmax} ms`);
  ok(tmax < 4000, 'CPU stays responsive on 10x10');
}

console.log(`PASS ${pass} checks`);
