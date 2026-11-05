// Multi-seat online rooms (b3 / v3): node test/online_multi.test.js
// Part A: pure replay (admission, seats, security, compatibility with b2). Part B: the real Client and real
// nostr-tools signing against an in-memory fake relay (no network), with 3-5 users, reloads and an outsider.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const L = require('../docs/logic.js');
const O = require('../docs/online.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }
const throws = (fn) => { try { fn(); } catch (e) { return true; } return false; };

// ======================= Part A: pure replay =======================
const NONCE = 'abc23xyz', ROOT = 'd'.repeat(64);
const HOST = 'a'.repeat(64), G1 = 'b'.repeat(64), G2 = 'c'.repeat(64), G3 = 'e'.repeat(64), OUT = 'f'.repeat(64);
const ROOM3 = `b3.${NONCE}.${HOST}.${ROOT}`, ROOM2 = `b2.${NONCE}.${HOST}.${ROOT}`;
let n = 0;
const ev = (pubkey, content, t, v) => ({ id: 'e' + String(n++).padStart(5, '0'), pubkey, created_at: t, kind: O.KIND, tags: [['t', O.tagFor(NONCE)]], content: JSON.stringify(Object.assign({ v: v || 3, root: ROOT }, content)) });
const cfg4 = { levels: 4, pieces: 8, players: 4 };
const create = (cfg, v) => Object.assign(ev(HOST, { type: 'create', cfg, root: null }, 100, v), { id: ROOT });
const join = (pk, t, v) => ev(pk, { type: 'join' }, t, v);
const admit = (j, seat, t, by) => ev(by || HOST, { type: 'admit', join: j.id, guest: j.pubkey, seat }, t);
const base4 = () => {
  const c = create(cfg4), j1 = join(G1, 101), j2 = join(G2, 102), j3 = join(G3, 103);
  return { c, j1, j2, j3, a1: admit(j1, 1, 110), a2: admit(j2, 2, 111), a3: admit(j3, 3, 112) };
};
const replay = (events, room) => O.replay(L, events, room || ROOM3);

// invitations
ok(O.invitation(ROOM3).version === 3 && O.invitation(ROOM2).version === 2 && O.ROOM_RE3.test(ROOM3) && !O.ROOM_RE.test(ROOM3) && !O.ROOM_RE3.test(ROOM2), 'b2 and b3 invitations are distinct');
for (const bad of [`b4.${NONCE}.${HOST}.${ROOT}`, `B3.${NONCE}.${HOST}.${ROOT}`, ROOM3 + '0', ROOM3.replace(ROOT, 'd'.repeat(63)), `b3.${NONCE}.${HOST}`, '', null, 'b3']) ok(throws(() => O.invitation(bad)), 'bad invitation refused: ' + bad);

// config validation
const S3 = (c) => O.sanitizeCfg(c, 3, L), S2 = (c) => O.sanitizeCfg(c);
ok(S3({ levels: 4, pieces: 8, players: 3 }).players === 3 && S3({ levels: 4, pieces: 8, players: 2 }).players === 2, 'v3 accepts 2-4 players');
for (const p of [undefined, 1, 5, '3', 3.5, null, NaN]) ok(S3({ levels: 4, pieces: 8, players: p }) === null, 'v3 refuses players ' + p);
ok(S3({ levels: 4, pieces: 12, players: 4 }) === null && S3({ levels: 4, pieces: 11, players: 4 }) !== null && S3({ levels: 4, pieces: 14, players: 3 }) !== null && S3({ levels: 4, pieces: 15, players: 3 }) === null, 'v3 refuses kitten counts that would fill the board');
ok(S3({ levels: 6, pieces: 12, players: 4, ornaments: 0 }).ornaments === 0 && S2({ levels: 4, pieces: 8, ornaments: 0 }) === null, 'ornaments 0 only in v3');
ok(!('players' in S2({ levels: 4, pieces: 8, players: 4 })), 'v2 drops players: 2-player wire format unchanged');
ok(JSON.stringify(S2({ levels: 4, pieces: 8, ornaments: 3, ornActive: 1, decor: 1 })) === '{"levels":4,"pieces":8,"ornaments":3,"ornActive":1,"decor":1}', 'v2 cfg is byte-identical to before');

// happy path with seats admitted out of order
let { c, j1, j2, j3, a1, a2, a3 } = base4();
let r = replay([c, j1, j2, j3, a1, a2, a3]);
ok(r.version === 3 && r.players === 4 && r.ready && r.seats.join() === [HOST, G1, G2, G3].join() && r.guest === G1, 'four seats, host first');
ok(r.admission === ['', a1.id, a2.id, a3.id].join(','), 'admission identity covers every seat');
// swap: G3 gets seat 1 and G1 seat 3
const sw = [c, j1, j2, j3, admit(j3, 1, 110), a2, admit(j1, 3, 112)];
r = replay(sw);
ok(r.seats.join() === [HOST, G3, G2, G1].join(), 'seats follow the host-signed seat number, not request order');
ok(replay(sw).admission !== replay([c, j1, j2, j3, a1, a2, a3]).admission, 'different seating changes the replay identity (UI rebuilds the board)');

// play a long legal game across all seats and compare with direct play
function playGame(seatsPk, events, plies, room) {
  let s = L.newGame(cfg4), seq = events.filter((e) => JSON.parse(e.content).type === 'move').length, t = 200;
  const acts = [];
  let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let k = 0; k < plies && s.phase !== 'over'; k++) {
    let a;
    if (s.phase === 'ornament') a = { k: 'orn', i: pick(L.ornamentCells(s)) };
    else if (s.phase === 'place') { const m = pick(L.legalMoves(s)); a = { k: 'play', i: m.idx, c: m.cat }; }
    else if (s.phase === 'chooseLine') a = { k: 'line', i: 0 };
    else { const mine = []; s.b.forEach((q, i) => { if (q && q.p === s.turn && q.kind !== 'o') mine.push(i); }); a = { k: 'promote', i: mine[0] }; }
    events.push(ev(seatsPk[s.turn], { type: 'move', seq: seq++, a }, t++));
    s = O.applyAction(L, s, a); acts.push(a);
  }
  return { s, acts };
}
let evs = [c, j1, j2, j3, a1, a2, a3];
const g = playGame([HOST, G1, G2, G3], evs, 60, ROOM3);
r = replay(evs);
ok(r.seq === g.acts.length && JSON.stringify(r.state.b) === JSON.stringify(g.s.b) && r.rejected === 0, `replay of ${g.acts.length} moves over 4 seats equals direct play`);
ok(replay(evs.slice().reverse().concat(evs.slice(0, 5))).seq === r.seq && JSON.stringify(replay(evs.slice().reverse()).state.b) === JSON.stringify(g.s.b), 'event order and duplicates do not matter');
ok(r.state.moves > 8 && r.state.turn >= 0, 'game progressed through several rounds');

// The game does not start before every seat is filled; the same events replay identically in any order.
{
  const early = ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i: 16 } }, 150);
  r = replay([c, j1, j2, a1, a2, early]);
  ok(!r.ready && r.seats.join() === [HOST, G1, G2, null].join() && r.seq === 0 && r.state.phase === 'ornament', 'moves ignored while a seat is open');
  r = replay([c, j1, j2, j3, a1, a2, a3, early]);
  ok(r.ready && r.seq === 1, 'once every seat is filled the signed host move counts (resolution is global, deterministic)');
  ok(replay([c, j1, j2, j3, a1, a2, early]).ready === false, 'without the third guest the room never becomes ready');
}

// Admission security
{
  const b = base4();
  const open3 = [b.c, b.j1, b.j2, b.j3];
  ok(replay(open3.concat(b.a1, b.a2)).seats.join() === [HOST, G1, G2, null].join(), 'a join request alone never takes a seat');
  const forged = (extra) => replay([b.c, b.j1, b.j2, b.a1, b.a2].concat(extra));
  // outsider admissions
  const jo = join(OUT, 50), ao = admit(jo, 3, 51, OUT);
  ok(forged([jo, ao]).seats[3] === null, 'admission not signed by the host is ignored');
  ok(forged([jo, ao, admit(jo, 3, 40, G1)]).seats[3] === null, 'a seated player cannot admit others');
  // host admission for a request signed by someone else / wrong pubkey
  ok(forged([jo, ev(HOST, { type: 'admit', join: jo.id, guest: G3, seat: 3 }, 120)]).seats[3] === null, 'admit must name the pubkey that signed the request');
  ok(forged([ev(HOST, { type: 'admit', join: 'nope', guest: OUT, seat: 3 }, 120)]).seats[3] === null, 'admit must reference an existing request');
  // seat numbers
  for (const seat of [0, 4, -1, 1.5, '3', null, undefined, NaN, Number.MAX_SAFE_INTEGER + 2, 99]) ok(replay([b.c, b.j3, ev(HOST, { type: 'admit', join: b.j3.id, guest: G3, seat }, 120)]).seats.join() === [HOST, null, null, null].join(), 'invalid seat refused: ' + seat);
  // taken seat / seated pubkey
  const dup = admit(b.j3, 1, 130);
  ok(forged([b.j3, dup]).seats.join() === [HOST, G1, G2, null].join(), 'a taken seat is not reassigned');
  const early = admit(b.j3, 1, 105);
  ok(replay([b.c, b.j1, b.j3, early, b.a1]).seats.join() === [HOST, G3, null, null].join(), 'earliest admission for a seat wins');
  const twice = admit(b.j1, 3, 140);
  ok(forged([b.j3, twice]).seats.join() === [HOST, G1, G2, null].join(), 'a pubkey holds one seat only');
  ok(replay([b.c, b.j1, b.a1, admit(b.j1, 2, 100)]).seats.join() === [HOST, null, G1, null].join(), 'two admissions of one pubkey: the earlier one decides the seat');
  // host cannot seat itself and cannot admit its own request
  const hj = join(HOST, 104);
  ok(replay([b.c, hj, ev(HOST, { type: 'admit', join: hj.id, guest: HOST, seat: 2 }, 120)]).seats[2] === null, 'the host never takes a second seat');
  // wrong root / wrong version / wrong room tag
  const wrongRoot = ev(G3, { type: 'join', root: 'a'.repeat(64) }, 103);
  ok(forged([wrongRoot, ev(HOST, { type: 'admit', join: wrongRoot.id, guest: G3, seat: 3 }, 120)]).seats[3] === null, 'request bound to another root is ignored');
  const v2join = join(G3, 103, 2);
  ok(forged([v2join, admit(v2join, 3, 120)]).seats[3] === null, 'v2 events are ignored in a b3 room');
  const v3 = [b.c, b.j1, b.a1];
  ok(replay(v3, ROOM2).state === null, 'a v3 create is not accepted through a b2 invitation');
  ok(replay([create({ levels: 4, pieces: 8 }, 2), join(G1, 101, 2), ev(HOST, { type: 'admit', join: 'x', guest: G1 }, 105, 2)], ROOM3).state === null, 'a v2 create is not accepted through a b3 invitation');
  // backdated outsider create + admit cannot take over
  const evil = Object.assign(ev(OUT, { type: 'create', cfg: { levels: 8, pieces: 16, players: 4 }, root: null }, 1), { id: 'b'.repeat(64) });
  const evilJoin = join(OUT, 2), evilAdmit = admit(evilJoin, 1, 3, OUT);
  const full = [b.c, b.j1, b.j2, b.j3, b.a1, b.a2, b.a3];
  r = replay([evil, evilJoin, evilAdmit].concat(full));
  ok(r.host === HOST && r.seats.join() === [HOST, G1, G2, G3].join() && r.state.L === 4, 'backdated outsider create/join/admit changes nothing');
  // spectators: more requests after the room is full
  r = replay(full.concat(join(OUT, 300), ev(OUT, { type: 'move', seq: 0, a: { k: 'orn', i: 16 } }, 301)));
  ok(r.seats.indexOf(OUT) === -1 && r.seq === 0 && r.rejected >= 1, 'an unseated pubkey cannot move');
  // wrong seat moves
  const m0 = ev(G1, { type: 'move', seq: 0, a: { k: 'orn', i: 16 } }, 310);
  ok(replay(full.concat(m0)).seq === 0 && replay(full.concat(m0)).rejected === 1, 'seat 1 cannot move on seat 0 turn');
  const good = ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i: 16 } }, 311), m1 = ev(HOST, { type: 'move', seq: 1, a: { k: 'play', i: 38, c: false } }, 312);
  const wrong1 = ev(G2, { type: 'move', seq: 2, a: { k: 'orn', i: 17 } }, 313);  // seat 2 moves on seat 1's turn
  r = replay(full.concat(good, m1, wrong1));
  ok(r.seq === 2 && r.state.turn === 1, 'seat 2 cannot move on seat 1 turn');
  r = replay(full.concat(good, m1, ev(G1, { type: 'move', seq: 2, a: { k: 'orn', i: 17 } }, 314), ev(G1, { type: 'move', seq: 3, a: { k: 'play', i: 3, c: false } }, 315), ev(G2, { type: 'move', seq: 4, a: { k: 'orn', i: 18 } }, 316)));
  ok(r.seq === 5 && r.state.turn === 2 && r.rejected === 0, 'seat 1 then seat 2 move in order');
}

// 2-player rooms in b3 and the untouched b2 path
{
  const c2 = create({ levels: 4, pieces: 8, players: 2 }), j = join(G1, 101), a = admit(j, 1, 110);
  r = replay([c2, j, a]);
  ok(r.ready && r.players === 2 && r.seats.join() === [HOST, G1].join(), 'b3 supports 2 players too');
  ok(!replay([c2, j]).ready, 'b3 2-player room waits for its guest');
  // b2: players in the config is ignored, extra seats impossible, first admission wins, host may move before the guest joins
  const c4 = create({ levels: 4, pieces: 8, players: 4 }, 2), jj = join(G1, 101, 2), jk = join(G2, 102, 2);
  r = replay([c4, jj, jk, ev(HOST, { type: 'admit', join: jj.id, guest: G1 }, 110, 2), ev(HOST, { type: 'admit', join: jk.id, guest: G2, seat: 2 }, 111, 2)], ROOM2);
  ok(r.version === 2 && r.players === 2 && r.state.players === 2 && r.seats.length === 2 && r.guest === G1 && r.ready, 'b2 stays a 2-player room whatever the config says');
  r = replay([c4, ev(HOST, { type: 'move', seq: 0, a: { k: 'orn', i: 16 } }, 120, 2)], ROOM2);
  ok(r.ready && r.seq === 1, 'b2: the host can still move before the guest joins (unchanged)');
}

// ======================= Part B: real Client, real signatures, fake relay =======================
const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'vendor', 'nostr-tools-2.25.5.bundle.js'), 'utf8');
const ctx = { console, crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, WebSocket: class {}, queueMicrotask, URL, Uint8Array };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx); vm.runInContext(src, ctx);
const NT = ctx.NostrTools;
ok(typeof NT.finalizeEvent === 'function' && typeof NT.verifyEvent === 'function', 'real nostr-tools loaded');

class Hub {
  constructor() { this.events = []; this.subs = new Set(); this.published = []; this.rejectedByRelay = 0; }
  add(e) {
    this.published.push(e);
    if (this.events.some((x) => x.id === e.id)) return;
    this.events.push(e);
    for (const s of [...this.subs]) if (!s.closed && this.match(s.filter, e)) setTimeout(() => { if (!s.closed) s.params.onevent(JSON.parse(JSON.stringify(e))); }, 0);
  }
  match(f, e) { return (!f.kinds || f.kinds.includes(e.kind)) && (!f['#t'] || e.tags.some((t) => t[0] === 't' && f['#t'].includes(t[1]))); }
}
function makeNT(hub) {
  class Pool {
    subscribe(relays, filter, params) {
      const s = { filter, params, closed: false };
      setTimeout(() => {
        for (const e of hub.events) if (hub.match(filter, e)) params.onevent(JSON.parse(JSON.stringify(e)));
        params.oneose();
        hub.subs.add(s);
      }, 0);
      return { close() { s.closed = true; hub.subs.delete(s); } };
    }
    publish(relays, e) { hub.add(JSON.parse(JSON.stringify(e))); return relays.map(() => Promise.resolve('ok')); }
  }
  // nostr-tools runs in its own vm realm (it checks `instanceof Object`): hand it objects created there.
  const inRealm = vm.runInContext('(s) => JSON.parse(s)', ctx);
  return Object.assign({}, NT, {
    SimplePool: Pool,
    finalizeEvent: (template, sk) => JSON.parse(JSON.stringify(NT.finalizeEvent(inRealm(JSON.stringify(template)), sk))),
    verifyEvent: (e) => NT.verifyEvent(inRealm(JSON.stringify(e))),
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await wait(15); }
  ok(false, 'timeout: ' + what);
}
let keySeed = 1;
function makeClient(hub, opts) {
  const keyHex = (opts && opts.keyHex) || Buffer.from(NT.generateSecretKey()).toString('hex');
  const store = { 'boop-augmented-nostr-key-v1': keyHex };
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  let last = null;
  const client = new O.Client({ NostrTools: makeNT(hub), Logic: L, relays: ['wss://fake.relay.test'], onChange: (v) => { last = v; } });
  return { c: client, keyHex, view: () => last, name: (opts && opts.name) || 'u' + keySeed++ };
}

(async () => {
  const hub = new Hub();
  const cfg = { levels: 4, pieces: 8, players: 4, ornaments: 3, ornActive: 1, decor: 1 };
  const host = makeClient(hub, { name: 'host' });
  const room = host.c.create(cfg);
  ok(room.startsWith('b3.') && O.invitation(room).host === host.c.pubkey, '4-player rooms use the b3 invitation');
  const createEv = hub.events.find((e) => JSON.parse(e.content).type === 'create');
  ok(JSON.parse(createEv.content).v === 3 && JSON.parse(createEv.content).cfg.players === 4, 'create event carries v3 and players');
  await until(() => host.view() && host.view().host, 'host sees its room');
  ok(host.view().ready === false && host.view().seats.filter(Boolean).length === 1, 'host alone: lobby, not ready');

  const guests = [1, 2, 3].map((i) => makeClient(hub, { name: 'g' + i }));
  for (const gc of guests) gc.c.open(room);
  await until(() => guests.every((g) => g.view() && g.view().myIdx !== null) && host.view().ready, 'three guests seated');
  const seatsNow = host.view().seats;
  ok(new Set(seatsNow).size === 4 && seatsNow[0] === host.c.pubkey && guests.every((g) => seatsNow.includes(g.c.pubkey)), 'every client got a distinct seat');
  ok(guests.every((g) => g.view().myIdx === seatsNow.indexOf(g.c.pubkey) && g.view().ready), 'each client knows its own seat and the room is ready');
  const admits = hub.events.filter((e) => JSON.parse(e.content).type === 'admit');
  ok(admits.length === 3 && admits.every((e) => e.pubkey === host.c.pubkey && Number.isSafeInteger(JSON.parse(e.content).seat)), 'exactly three host-signed admissions with seat numbers');
  const joinsBefore = hub.events.filter((e) => JSON.parse(e.content).type === 'join').length;
  ok(joinsBefore === 3, 'one join request per guest');

  // A fifth visitor and an outsider with forged events.
  const late = makeClient(hub, { name: 'late' });
  late.c.open(room);
  await until(() => late.view() && late.view().host && late.c.eose, 'late visitor sees the room');
  await wait(200);
  ok(late.view().myIdx === null && late.view().ready && !hub.events.some((e) => e.pubkey === late.c.pubkey), 'a full room: visitor watches and sends no join request');
  const forgeKey = NT.generateSecretKey();
  const forge = (content, offset, nonce) => makeNT(hub).finalizeEvent({ kind: O.KIND, created_at: Math.floor(Date.now() / 1000) + offset, tags: [['t', O.tagFor(nonce || O.invitation(room).nonce)]], content: JSON.stringify(Object.assign({ v: 3, root: O.invitation(room).root }, content)) }, forgeKey);
  const forgeAuthor = NT.getPublicKey(forgeKey);
  const fj = forge({ type: 'join' }, -900), fa = forge({ type: 'admit', join: fj.id, guest: NT.getPublicKey(forgeKey), seat: 1 }, -800);
  const fc = forge({ type: 'create', cfg: { levels: 8, pieces: 16, players: 4 }, root: null }, -1000);
  for (const e of [fj, fa, fc]) hub.add(e);
  await wait(250);
  ok([host, ...guests, late].every((u) => u.view().seats.join() === seatsNow.join() && u.view().state.L === 4), 'backdated outsider create/join/admit is ignored by every client');
  ok(hub.events.filter((e) => e.pubkey === host.c.pubkey && JSON.parse(e.content).type === 'admit').length === 3, 'host did not re-admit anyone');

  // Play two full rounds through the real client API; each mover is whoever holds the seat.
  const byIdx = [host, ...guests].sort((a, b) => a.view().myIdx - b.view().myIdx);
  const plan = (s) => (s.phase === 'ornament' ? { k: 'orn', i: L.ornamentCells(s)[0] }
    : { k: 'play', i: L.legalMoves(s).filter((m) => L.geometry(4).ring[m.idx] === 3)[0].idx, c: false });
  let moves = 0;
  for (let t = 0; t < 8; t++) {
    const u = byIdx[t % 4], v = u.view(), s = v.state;
    ok(s.turn === t % 4 && v.myIdx === t % 4, `turn ${t}: seat ${t % 4} to move and it is that client`);
    if (s.phase === 'ornament') { u.c.sendMove(u.view().seq, plan(s)); moves++; await until(() => u.view().seq === moves && u.view().state.phase === 'place', `ornament by seat ${t % 4}`); }
    u.c.sendMove(u.view().seq, plan(u.view().state)); moves++;
    await until(() => [host, ...guests, late].every((x) => x.view().seq === moves), `move ${moves} reaches all 5 clients`);
  }
  const boards = [host, ...guests, late].map((u) => JSON.stringify(u.view().state.b));
  ok(new Set(boards).size === 1 && host.view().state.moves === 8, 'after two rounds all five boards are identical (8 placements)');

  // Impostor: a seated guest signs a move on someone else's turn; nobody accepts it.
  const turnSeat = host.view().state.turn, imp = byIdx[(turnSeat + 1) % 4];
  const seqBefore = host.view().seq;
  imp.c.sendMove(seqBefore, { k: 'orn', i: 17 });
  await wait(250);
  ok([host, ...guests, late].every((x) => x.view().seq === seqBefore) && host.view().rejected >= 1, 'a move signed by the wrong seat is rejected everywhere');

  // Reloads: host and a guest come back with the same key and no history.
  const hostAgain = makeClient(hub, { keyHex: host.keyHex, name: 'host2' });
  hostAgain.c.open(room);
  await until(() => hostAgain.view() && hostAgain.view().seq === seqBefore && hostAgain.c.eose, 'host reload restores the game');
  await wait(250);
  ok(hostAgain.view().myIdx === 0 && hub.events.filter((e) => e.pubkey === host.c.pubkey && JSON.parse(e.content).type === 'admit').length === 3, 'host reload does not admit again');
  const gAgain = makeClient(hub, { keyHex: guests[1].keyHex, name: 'g2b' });
  gAgain.c.open(room);
  await until(() => gAgain.view() && gAgain.view().myIdx !== null, 'guest reload keeps its seat');
  await wait(250);
  ok(gAgain.view().myIdx === guests[1].view().myIdx && hub.events.filter((e) => e.pubkey !== forgeAuthor && JSON.parse(e.content).type === 'join').length === joinsBefore, 'guest reload sends no new join request');
  // play continues after the reloads
  {
    const st = hostAgain.view().state, mc = st.turn === 0 ? hostAgain : byIdx[st.turn], base = hostAgain.view().seq;
    let sent = 0;
    if (st.phase === 'ornament') { mc.c.sendMove(mc.view().seq, plan(st)); sent++; await until(() => hostAgain.view().seq === base + sent, 'ornament after reload'); }
    mc.c.sendMove(mc.view().seq, plan(hostAgain.view().state)); sent++;
    await until(() => hostAgain.view().seq === base + sent && host.view().seq === base + sent && gAgain.view().seq === base + sent, 'move after reload reaches old and new clients');
    ok(JSON.stringify(hostAgain.view().state.b) === JSON.stringify(gAgain.view().state.b), 'game continues after host and guest reload');
  }
  for (const u of [host, hostAgain, gAgain, late, ...guests]) u.c.close();

  // 3-player room with a flood of join requests: the first two distinct requesters get seats 1 and 2.
  {
    const hub3 = new Hub();
    const h = makeClient(hub3, { name: 'h3' });
    const room3 = h.c.create({ levels: 4, pieces: 8, players: 3 });
    await until(() => h.view() && h.view().host, 'room 3 created');
    const crowd = Array.from({ length: 6 }, () => makeClient(hub3));
    for (const u of crowd) u.c.open(room3);
    await until(() => h.view().ready, '3-player room fills', 8000);
    await wait(300);
    const seats = h.view().seats;
    ok(seats.length === 3 && seats.every(Boolean) && new Set(seats).size === 3, 'two of six requesters seated, host plus two');
    ok(crowd.filter((u) => u.view().myIdx !== null).length === 2 && crowd.filter((u) => u.view().myIdx === null).length === 4, 'the other four requesters watch');
    ok(hub3.events.filter((e) => JSON.parse(e.content).type === 'admit').length === 2, 'host admitted exactly two');
    // late joiners (after the room is full) do not ask
    const joinsNow = hub3.events.filter((e) => JSON.parse(e.content).type === 'join').length;
    const l2 = makeClient(hub3); l2.c.open(room3);
    await until(() => l2.view() && l2.view().host && l2.c.eose, 'late 3p visitor'); await wait(200);
    ok(hub3.events.filter((e) => JSON.parse(e.content).type === 'join').length === joinsNow, 'full room: no join request');
    for (const u of [h, l2, ...crowd]) u.c.close();
  }

  // 2-player rooms created by the new client keep the original format.
  {
    const hub2 = new Hub();
    const h = makeClient(hub2);
    const room2 = h.c.create({ levels: 4, pieces: 8, players: 2, ornaments: 3, ornActive: 1, decor: 1 });
    ok(room2.startsWith('b2.'), '2-player rooms still use b2');
    const ce = hub2.events[0], cc = JSON.parse(ce.content);
    ok(cc.v === 2 && !('players' in cc.cfg) && JSON.stringify(cc.cfg) === '{"levels":4,"pieces":8,"ornaments":3,"ornActive":1,"decor":1}', 'b2 create event has the exact original shape');
    const g = makeClient(hub2); g.c.open(room2);
    await until(() => g.view() && g.view().myIdx === 1 && h.view().guest, '2-player join works');
    const ad = hub2.events.find((e) => JSON.parse(e.content).type === 'admit');
    ok(!('seat' in JSON.parse(ad.content)) && JSON.parse(ad.content).v === 2, 'b2 admission has no seat field');
    ok(h.view().ready && g.view().ready && g.view().seats.length === 2, '2-player room is ready, 2 seats');
    h.c.close(); g.c.close();
  }
  // configurations that would deadlock are refused at creation
  {
    const h = makeClient(new Hub());
    ok(throws(() => h.c.create({ levels: 4, pieces: 14, players: 4 })) && throws(() => h.c.create({ levels: 4, pieces: 8, players: 5 })), 'client refuses unsafe room configurations');
    h.c.close();
  }
  console.log('PASS', pass, 'checks');
  process.exit(0);
})().catch((e) => { console.error('FAIL (exception):', e); process.exit(1); });
