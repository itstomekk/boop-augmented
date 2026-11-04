// Online room replay tests: node test/online.test.js
const L = require('../docs/logic.js');
const O = require('../docs/online.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }

let n = 0;
const ev = (pubkey, content, t) => ({ id: 'e' + String(n++).padStart(4, '0'), pubkey, created_at: t, kind: O.KIND, tags: [], content: JSON.stringify(Object.assign({ v: 1 }, content)) });
const HOST = 'a'.repeat(64), GUEST = 'b'.repeat(64), OTHER = 'c'.repeat(64);
const cfg = { levels: 4, pieces: 8 };

// Build a legal sequence with the real rules, then turn it into events.
let s = L.newGame(cfg);
const acts = [];
function step(a) { s = O.applyAction(L, s, a); acts.push(a); }
step({ k: 'orn', i: 16 }); step({ k: 'play', i: 38, c: false });
step({ k: 'orn', i: 32 }); step({ k: 'play', i: 37, c: false });
step({ k: 'play', i: 10, c: false }); step({ k: 'play', i: 44, c: false });
const evs = [ev(HOST, { type: 'create', cfg }, 100), ev(GUEST, { type: 'join' }, 101)];
acts.forEach((a, k) => evs.push(ev(k % 2 === 0 ? (k < 2 ? HOST : (acts[k].k === 'orn' ? GUEST : HOST)) : HOST, { type: 'move', seq: k, a }, 102 + k)));
// fix authors by whose turn it is when replaying with the logic
{ let st = L.newGame(cfg); acts.forEach((a, k) => { evs[2 + k].pubkey = st.turn === 0 ? HOST : GUEST; st = O.applyAction(L, st, a); }); }

let r = O.replay(L, evs);
ok(r.host === HOST && r.guest === GUEST, 'host and guest seats');
ok(r.seq === acts.length && JSON.stringify(r.state.b) === JSON.stringify(s.b), 'replay equals direct play');

// Order and duplicates do not matter
const shuffled = evs.slice().reverse().concat(evs.slice(0, 3));
r = O.replay(L, shuffled);
ok(r.seq === acts.length && JSON.stringify(r.state.b) === JSON.stringify(s.b), 'shuffled + duplicated events give the same game');

// A move by the wrong player is ignored
const bad = ev(GUEST, { type: 'move', seq: acts.length, a: { k: 'play', i: 1, c: false } }, 200);
const turnNow = s.turn;
r = O.replay(L, evs.concat([bad]));
ok(turnNow === 0 ? r.seq === acts.length : r.seq === acts.length + 1, 'only the player to move can move');
// An illegal move (occupied cell) is ignored, the next legal one with the same seq counts
const mover = s.turn === 0 ? HOST : GUEST;
const occupied = s.b.findIndex((q) => q && q.kind !== 'o');
const illegal = ev(mover, { type: 'move', seq: acts.length, a: { k: 'play', i: occupied, c: false } }, 201);
const free = L.legalMoves(s)[0];
const legal = ev(mover, { type: 'move', seq: acts.length, a: { k: 'play', i: free.idx, c: false } }, 202);
r = O.replay(L, evs.concat([illegal, legal]));
ok(r.seq === acts.length + 1 && r.rejected >= 1 && r.state.b[free.idx], 'illegal move skipped, legal one applied');
// Two moves with the same seq: the earlier one wins
const free2 = L.legalMoves(s)[1];
const late = ev(mover, { type: 'move', seq: acts.length, a: { k: 'play', i: free2.idx, c: false } }, 300);
r = O.replay(L, evs.concat([late, legal]));
ok(r.state.b[free.idx] && !r.state.b[free2.idx], 'earliest move for a seq wins');

// Third person: spectator; a create with a broken config is ignored
r = O.replay(L, evs.concat([ev(OTHER, { type: 'join' }, 150)]));
ok(r.guest === GUEST, 'second join does not take the seat');
r = O.replay(L, [ev(OTHER, { type: 'create', cfg: { levels: 99 } }, 50)].concat(evs));
ok(r.host === HOST, 'invalid create ignored');
ok(O.ROOM_RE.test('abc23xyz') && !O.ROOM_RE.test('../x'), 'room id format');
console.log('PASS', pass, 'checks');
