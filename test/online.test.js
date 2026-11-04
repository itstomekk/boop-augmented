// Online room replay tests: node test/online.test.js
const L = require('../docs/logic.js');
const O = require('../docs/online.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }

let n = 0;
const ROOT = 'd'.repeat(64), NONCE = 'abc23xyz';
const ev = (pubkey, content, t) => ({ id: 'e' + String(n++).padStart(4, '0'), pubkey, created_at: t, kind: O.KIND, tags: [['t', O.tagFor(NONCE)]], content: JSON.stringify(Object.assign({ v: O.VERSION, root: ROOT }, content)) });
const HOST = 'a'.repeat(64), GUEST = 'b'.repeat(64), OTHER = 'c'.repeat(64);
const cfg = { levels: 4, pieces: 8 };
const ROOM = `b2.${NONCE}.${HOST}.${ROOT}`;
const replay = (events) => O.replay(L, events, ROOM);

// Build a legal sequence with the real rules, then turn it into events.
let s = L.newGame(cfg);
const acts = [];
function step(a) { s = O.applyAction(L, s, a); acts.push(a); }
step({ k: 'orn', i: 16 }); step({ k: 'play', i: 38, c: false });
step({ k: 'orn', i: 32 }); step({ k: 'play', i: 37, c: false });
step({ k: 'play', i: 10, c: false }); step({ k: 'play', i: 44, c: false });
const evs = [ev(HOST, { type: 'create', cfg }, 100), ev(GUEST, { type: 'join' }, 101)];
evs[0].id = ROOT;
acts.forEach((a, k) => evs.push(ev(k % 2 === 0 ? (k < 2 ? HOST : (acts[k].k === 'orn' ? GUEST : HOST)) : HOST, { type: 'move', seq: k, a }, 102 + k)));
// fix authors by whose turn it is when replaying with the logic
{ let st = L.newGame(cfg); acts.forEach((a, k) => { evs[2 + k].pubkey = st.turn === 0 ? HOST : GUEST; st = O.applyAction(L, st, a); }); }
evs.push(ev(HOST, { type: 'admit', guest: GUEST, join: evs[1].id }, 102));

let r = replay(evs);
ok(r.host === HOST && r.guest === GUEST, 'host and guest seats');
ok(r.seq === acts.length && JSON.stringify(r.state.b) === JSON.stringify(s.b), 'replay equals direct play');

// Order and duplicates do not matter
const shuffled = evs.slice().reverse().concat(evs.slice(0, 3));
r = replay(shuffled);
ok(r.seq === acts.length && JSON.stringify(r.state.b) === JSON.stringify(s.b), 'shuffled + duplicated events give the same game');

// A move by the wrong player is ignored
const bad = ev(GUEST, { type: 'move', seq: acts.length, a: { k: 'play', i: 1, c: false } }, 200);
const turnNow = s.turn;
r = replay(evs.concat([bad]));
ok(turnNow === 0 ? r.seq === acts.length : r.seq === acts.length + 1, 'only the player to move can move');
// An illegal move (occupied cell) is ignored, the next legal one with the same seq counts
const mover = s.turn === 0 ? HOST : GUEST;
const occupied = s.b.findIndex((q) => q && q.kind !== 'o');
const illegal = ev(mover, { type: 'move', seq: acts.length, a: { k: 'play', i: occupied, c: false } }, 201);
const free = L.legalMoves(s)[0];
const legal = ev(mover, { type: 'move', seq: acts.length, a: { k: 'play', i: free.idx, c: false } }, 202);
r = replay(evs.concat([illegal, legal]));
ok(r.seq === acts.length + 1 && r.rejected >= 1 && r.state.b[free.idx], 'illegal move skipped, legal one applied');
// Two moves with the same seq: the earlier one wins
const free2 = L.legalMoves(s)[1];
const late = ev(mover, { type: 'move', seq: acts.length, a: { k: 'play', i: free2.idx, c: false } }, 300);
r = replay(evs.concat([late, legal]));
ok(r.state.b[free.idx] && !r.state.b[free2.idx], 'earliest move for a seq wins');

// Third person: spectator; a create with a broken config is ignored
r = replay(evs.concat([ev(OTHER, { type: 'join' }, 150)]));
ok(r.guest === GUEST, 'second join does not take the seat');
r = replay([ev(OTHER, { type: 'create', cfg: { levels: 99 } }, 50)].concat(evs));
ok(r.host === HOST, 'invalid create ignored');
ok(O.ROOM_RE.test(ROOM) && !O.ROOM_RE.test('../x') && !O.ROOM_RE.test(NONCE), 'bound invitation format');
for (const code of [NONCE, ROOM + '.x', ROOM.toUpperCase(), ROOM.replace(ROOT, '0'.repeat(63)), null]) {
  let threw = false;
  try { O.replay(L, evs, code); } catch (e) { threw = true; }
  ok(threw, 'unbound/malformed invite fails closed: ' + code);
}
const outsider = ev(OTHER, { type: 'create', cfg: { levels: 8, pieces: 16 } }, 1);
const joinAttack = ev(OTHER, { type: 'join' }, 0);
const admitAttack = ev(OTHER, { type: 'admit', guest: OTHER, join: joinAttack.id }, 1);
for (const history of [evs.concat(outsider, joinAttack, admitAttack), [outsider, joinAttack, admitAttack].concat(evs).reverse()]) {
  r = replay(history);
  ok(r.host === HOST && r.guest === GUEST && r.seq === acts.length && r.state.L === 4, 'backdated outsider cannot replace host/create or admitted guest');
}
ok(!replay(evs.filter(e => e.id !== ROOT).concat(outsider)).state, 'missing exact creation cannot fall back to outsider');
ok(!O.replay(L, evs, ROOM.replace(HOST, OTHER)).state, 'host and creation ID are both required');
ok(!replay(evs.map(e => ({ ...e, tags: [['t', 'different-room']] }))).state, 'room tag required');
ok(!replay(evs.map(e => ({ ...e, content: JSON.stringify({ ...JSON.parse(e.content), v: 1 }) }))).state, 'no v1 downgrade');
ok(!replay(evs.filter(e => JSON.parse(e.content).type !== 'admit')).guest, 'join alone never grants the seat');
const initial = evs.slice(0, 2);
for (const i of ['16', 16.5, 4294967312, Number.MAX_SAFE_INTEGER + 1, null, undefined, -1, 49]) {
  r = replay(initial.concat(ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i } }, 110)));
  ok(r.seq === 0 && r.rejected === 1, 'reject malformed/out-of-range index: ' + i);
}
for (const c of ['false', 0, 1, null, undefined]) {
  r = replay(evs.slice(0, 3).concat(ev(HOST, { type: 'move', seq: 1, a: { k: 'play', i: 38, c } }, 110)));
  ok(r.seq === 1 && r.rejected === 1, 'reject non-boolean cat: ' + c);
}
const forkA = ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i: 16 } }, 110);
const forkB = ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i: 17 } }, 109);
const ra = replay(initial.concat(forkA)), rb = replay(initial.concat(forkA, forkB));
ok(ra.seq === rb.seq && ra.actionIds[0] !== rb.actionIds[0] && rb.state.b[17] && !rb.state.b[16], 'same-length forks expose exact accepted IDs');
ok(JSON.stringify(rb) === JSON.stringify(replay([forkB, forkA].concat(initial).reverse())), 'fork replay is arrival-order independent');
ok(JSON.stringify(rb.actions) === JSON.stringify([{ k: 'orn', i: 17 }]), 'replay retains canonical action only');
for (const k of ['orn', 'play', 'line', 'promote']) {
  for (const i of ['0', .5, Infinity, NaN, null, undefined, -1, 4294967296]) {
    let threw = false;
    try { O.applyAction(L, L.newGame(cfg), { k, i, ...(k === 'play' ? { c: false } : {}) }); } catch (e) { threw = true; }
    ok(threw, 'all action paths reject malformed index: ' + k + '/' + i);
  }
}
for (const seq of ['0', .5, -1, null, Number.MAX_SAFE_INTEGER + 1]) {
  ok(replay(initial.concat(ev(HOST, { type: 'move', seq, a: { k: 'orn', i: 16 } }, 110))).seq === 0, 'bad wire sequence rejected: ' + seq);
}
ok(replay(initial.concat(ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i: 16 }, root: 'f'.repeat(64) }, 110))).seq === 0, 'correct signer and room tag do not bypass creation binding');
ok(replay(initial.concat(ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i: 16, c: false } }, 110))).seq === 0, 'noncanonical extra action field rejected');
console.log('PASS', pass, 'checks');
