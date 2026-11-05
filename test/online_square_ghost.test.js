// Online rooms with square boards and ghosts: node test/online_square_ghost.test.js
// Part A: pure config validation + replay. Part B: the real Client and real nostr-tools signatures against an
// in-memory fake relay (no network, no relay of any kind is contacted).
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const L = require('../docs/logic.js');
const O = require('../docs/online.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }
const throws = (fn) => { try { fn(); } catch (e) { return true; } return false; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ======================= Part A =======================
const S3 = (c) => O.sanitizeCfg(c, 3, L), S2 = (c) => O.sanitizeCfg(c);
const SQ = { shape: 'square', size: 6, pieces: 8, players: 2 };
ok(same(S3(SQ), SQ) && same(S3(Object.assign({}, SQ, { ghost: true })), Object.assign({}, SQ, { ghost: true })), 'v3 accepts a square config; ghost only appears when true');
ok(same(S3(Object.assign({}, SQ, { ghost: false })), SQ), 'ghost false is normalised away');
for (const size of [6, 7, 8, 9, 10]) ok(S3(Object.assign({}, SQ, { size, pieces: 8 })) !== null, 'square size ' + size);
for (const size of [5, 11, 6.5, '6', null, undefined, NaN]) ok(S3(Object.assign({}, SQ, { size })) === null, 'square size refused: ' + size);
for (const shape of ['hex', 'Square', 1, null, {}]) ok(S3(Object.assign({}, SQ, { shape })) === null, 'shape refused: ' + JSON.stringify(shape));
for (const ghost of [1, 'true', null, {}]) ok(S3(Object.assign({}, SQ, { ghost })) === null, 'ghost must be a boolean: ' + JSON.stringify(ghost));
ok(S3({ levels: 4, pieces: 8, players: 2, ghost: true }) === null && S3({ shape: 'tree', levels: 4, pieces: 8, players: 2, ghost: true }) === null, 'ghosts need a square board');
ok(same(S3({ shape: 'tree', levels: 4, pieces: 8, players: 3 }), { levels: 4, pieces: 8, players: 3 }) && same(S3({ levels: 4, pieces: 8, players: 3 }), { levels: 4, pieces: 8, players: 3 }), 'tree configs are unchanged (no shape key)');
ok(same(S3(Object.assign({}, SQ, { levels: 5, ornaments: 3, ornActive: 1, decor: 1, ornWin: 3 })), SQ), 'tree-only fields are dropped from a square config');
ok(S3({ shape: 'square', pieces: 8, players: 2 }) === null, 'square needs a size');
ok(S3({ shape: 'square', size: 6, pieces: 10, players: 4 }) === null && S3({ shape: 'square', size: 6, pieces: 9, players: 4 }) !== null, 'square: kittens must leave room for 4 players (9 max on 6x6)');
ok(S3({ shape: 'square', size: 6, pieces: 19, players: 2 }) === null && S3({ shape: 'square', size: 6, pieces: 18, players: 2 }) !== null, 'square: 2 players on 6x6 may use up to 18 kittens');
ok(S3({ shape: 'square', size: 10, pieces: 24, players: 4 }) !== null && S3({ shape: 'square', size: 10, pieces: 26, players: 4 }) === null, 'square 10x10, 4 players: up to 24 kittens (global cap) and 25 by room');
ok(S2({ levels: 4, pieces: 8, shape: 'square', size: 6 }) === null && S2({ levels: 4, pieces: 8, ghost: true }) === null && S2({ levels: 4, pieces: 8, shape: 'tree' }) === null, 'v2 refuses shape and ghost fields (2-player tree format is closed)');
ok(JSON.stringify(S2({ levels: 4, pieces: 8, ornaments: 3, ornActive: 1, decor: 1 })) === '{"levels":4,"pieces":8,"ornaments":3,"ornActive":1,"decor":1}', 'v2 cfg byte-identical to before');
ok(!S3(SQ).hasOwnProperty('levels') && L.newGame(S3(SQ)).shape === 'square', 'a sanitised square config builds a square game');

// canonical actions
const g0 = L.newGame(Object.assign({}, SQ, { ghost: true }));
ok(same(O.canonicalAction(g0, { k: 'skip' }), { k: 'skip' }) && same(O.canonicalAction(g0, { k: 'ghost', i: 7 }), { k: 'ghost', i: 7 }), 'ghost and skip are canonical actions');
for (const bad of [{ k: 'skip', i: 0 }, { k: 'ghost' }, { k: 'ghost', i: -1 }, { k: 'ghost', i: 1.5 }, { k: 'ghost', i: 7, c: true }, { k: 'ghost', i: '7' }, { k: 'skip', extra: 1 }, { k: 'ghost', i: 36 }, { k: 'boo' }]) ok(throws(() => O.canonicalAction(g0, bad)), 'bad action refused: ' + JSON.stringify(bad));
ok(throws(() => O.applyAction(L, g0, { k: 'skip' })) && throws(() => O.applyAction(L, g0, { k: 'ghost', i: 3 })), 'ghost actions are illegal outside the ghost phase');
{
  const a1 = O.applyAction(L, g0, { k: 'play', i: 14, c: false });
  ok(a1.phase === 'ghost', 'after the piece the game waits in the ghost phase');
  ok(throws(() => O.applyAction(L, a1, { k: 'play', i: 15, c: false })) && throws(() => O.applyAction(L, a1, { k: 'ghost', i: 20 })), 'no piece play and no out-of-range stitch in the ghost phase');
  ok(O.applyAction(L, a1, { k: 'ghost', i: 2 }).ghosts[0].on === true && O.applyAction(L, a1, { k: 'skip' }).ghosts[0].on === false, 'ghost and skip apply');
}

// replay of whole games over the room protocol
const NONCE = 'abc23xyz', ROOT = 'd'.repeat(64);
const HOST = 'a'.repeat(64), G1 = 'b'.repeat(64), G2 = 'c'.repeat(64), G3 = 'e'.repeat(64);
const ROOM3 = `b3.${NONCE}.${HOST}.${ROOT}`, ROOM2 = `b2.${NONCE}.${HOST}.${ROOT}`;
let n = 0;
const ev = (pubkey, content, t, v) => ({ id: 'e' + String(n++).padStart(5, '0'), pubkey, created_at: t, kind: O.KIND, tags: [['t', O.tagFor(NONCE)]], content: JSON.stringify(Object.assign({ v: v || 3, root: ROOT }, content)) });
const create = (cfg, v) => Object.assign(ev(HOST, { type: 'create', cfg, root: null }, 100, v), { id: ROOT });
const join = (pk, t) => ev(pk, { type: 'join' }, t);
const admit = (j, seat, t) => ev(HOST, { type: 'admit', join: j.id, guest: j.pubkey, seat }, t);
let seed = 99; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomAction(s) {
  if (s.phase === 'ghost') return rnd() < 0.7 ? { k: 'ghost', i: pick(L.ghostStitches(s)) } : { k: 'skip' };
  if (s.phase === 'place') { const m = pick(L.legalMoves(s)); return { k: 'play', i: m.idx, c: m.cat }; }
  if (s.phase === 'chooseLine') return { k: 'line', i: 0 };
  const mine = []; s.b.forEach((q, i) => { if (q && q.p === s.turn) mine.push(i); });
  return { k: 'promote', i: mine[0] };
}
function room(cfg, seats, plies) {
  const c = create(cfg), evs = [c];
  seats.slice(1).forEach((pk, i) => { const j = join(pk, 101 + i); evs.push(j, admit(j, i + 1, 110 + i)); });
  let s = L.newGame(O.sanitizeCfg(cfg, 3, L)), t = 200, seq = 0;
  const acts = [];
  for (let k = 0; k < plies && s.phase !== 'over'; k++) {
    const a = randomAction(s);
    evs.push(ev(seats[s.turn], { type: 'move', seq: seq++, a }, t++));
    s = O.applyAction(L, s, a); acts.push(a);
  }
  return { evs, s, acts };
}
for (const [label, cfg, seats] of [
  ['2-player 6x6 ghost', { shape: 'square', size: 6, pieces: 8, players: 2, ghost: true }, [HOST, G1]],
  ['3-player 8x8 ghost', { shape: 'square', size: 8, pieces: 12, players: 3, ghost: true }, [HOST, G1, G2]],
  ['4-player 6x6 ghost', { shape: 'square', size: 6, pieces: 9, players: 4, ghost: true }, [HOST, G1, G2, G3]],
  ['2-player 7x7 no ghost', { shape: 'square', size: 7, pieces: 10, players: 2 }, [HOST, G1]],
]) {
  const g = room(cfg, seats, 220);
  const r = O.replay(L, g.evs, ROOM3);
  ok(r.ready && r.version === 3 && r.state.shape === 'square' && r.seq === g.acts.length && r.rejected === 0, `${label}: ${g.acts.length} moves replayed, none rejected`);
  ok(same(r.state, g.s), `${label}: replay equals direct play exactly`);
  ok(same(O.replay(L, g.evs.slice().reverse().concat(g.evs.slice(0, 7)), ROOM3).state, g.s), `${label}: event order and duplicates do not matter`);
  ok(cfg.ghost ? g.acts.some((a) => a.k === 'ghost') && g.acts.some((a) => a.k === 'skip') || g.s.phase === 'over' : !g.acts.some((a) => a.k === 'ghost' || a.k === 'skip'), `${label}: ghost actions appear exactly when the ghost variant is on`);
}
// rules still decide: wrong seat, wrong phase, tampering
{
  const cfg = { shape: 'square', size: 6, pieces: 8, players: 2, ghost: true };
  const c = create(cfg), j = join(G1, 101), a = admit(j, 1, 110), base = [c, j, a];
  const m0 = ev(HOST, { type: 'move', seq: 0, a: { k: 'play', i: 14, c: false } }, 200);
  let r = O.replay(L, base.concat(m0), ROOM3);
  ok(r.seq === 1 && r.state.phase === 'ghost' && r.state.turn === 0, 'host piece move counts; the room now waits for the host ghost decision');
  r = O.replay(L, base.concat(m0, ev(G1, { type: 'move', seq: 1, a: { k: 'skip' } }, 201)), ROOM3);
  ok(r.seq === 1 && r.rejected === 1, 'the other seat cannot decide the host ghost');
  r = O.replay(L, base.concat(m0, ev(HOST, { type: 'move', seq: 1, a: { k: 'play', i: 15, c: false } }, 201)), ROOM3);
  ok(r.seq === 1 && r.rejected === 1, 'a piece move during the ghost phase is rejected');
  r = O.replay(L, base.concat(m0, ev(HOST, { type: 'move', seq: 1, a: { k: 'ghost', i: 20 } }, 201)), ROOM3);
  ok(r.seq === 1 && r.rejected === 1, 'a stitch outside the board is rejected');
  r = O.replay(L, base.concat(m0, ev(HOST, { type: 'move', seq: 1, a: { k: 'ghost', i: 3, c: true } }, 201)), ROOM3);
  ok(r.seq === 1 && r.rejected === 1, 'extra action fields are rejected');
  const m1 = ev(HOST, { type: 'move', seq: 1, a: { k: 'ghost', i: 3 } }, 201);
  r = O.replay(L, base.concat(m0, m1), ROOM3);
  ok(r.seq === 2 && r.state.turn === 1 && r.state.ghosts[0].on && r.state.ghosts[0].d === 0 && r.state.ghosts[0].a === 3, 'a ghost placement counts and passes the turn');
  ok(same(r.actions[1], { k: 'ghost', i: 3 }) && r.actionIds[1] === m1.id, 'canonical action and event id kept');
  // skip outside the ghost phase
  r = O.replay(L, base.concat(ev(HOST, { type: 'move', seq: 0, a: { k: 'skip' } }, 200)), ROOM3);
  ok(r.seq === 0 && r.rejected === 1, 'skip in the piece phase is rejected');
  // a v2 room can never carry square or ghost games
  const c2 = create({ levels: 4, pieces: 8, shape: 'square', size: 6, ghost: true }, 2);
  ok(O.replay(L, [c2], ROOM2).state === null, 'a b2 room whose config asks for square/ghost is not a room');
  ok(O.replay(L, [create({ shape: 'square', size: 6, pieces: 8, players: 2 }, 2)], ROOM2).state === null, 'square configs are not accepted in b2');
  // square config through a b3 room never changes 2-player tree rooms
  const t2 = create({ levels: 4, pieces: 8, players: 2 }), tj = join(G1, 101);
  r = O.replay(L, [t2, tj, admit(tj, 1, 110)], ROOM3);
  ok(r.state.shape === 'tree' && r.state.ghost === false && r.ready, 'b3 tree rooms still work');
}

// ======================= Part B: real Client, real signatures, fake relay =======================
const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'vendor', 'nostr-tools-2.25.5.bundle.js'), 'utf8');
const ctx = { console, crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout, WebSocket: class { constructor() { throw new Error('a real WebSocket was opened'); } }, queueMicrotask, URL, Uint8Array };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx); vm.runInContext(src, ctx);
const NT = ctx.NostrTools;
class Hub {
  constructor() { this.events = []; this.subs = new Set(); this.relayCalls = []; }
  add(e) {
    if (this.events.some((x) => x.id === e.id)) return;
    this.events.push(e);
    for (const s of [...this.subs]) if (!s.closed && this.match(s.filter, e)) setTimeout(() => { if (!s.closed) s.params.onevent(JSON.parse(JSON.stringify(e))); }, 0);
  }
  match(f, e) { return (!f.kinds || f.kinds.includes(e.kind)) && (!f['#t'] || e.tags.some((t) => t[0] === 't' && f['#t'].includes(t[1]))); }
}
function makeNT(hub) {
  class Pool {
    subscribe(relays, filter, params) {
      hub.relayCalls.push(...relays);
      const s = { filter, params, closed: false };
      setTimeout(() => { for (const e of hub.events) if (hub.match(filter, e)) params.onevent(JSON.parse(JSON.stringify(e))); params.oneose(); hub.subs.add(s); }, 0);
      return { close() { s.closed = true; hub.subs.delete(s); } };
    }
    publish(relays, e) { hub.relayCalls.push(...relays); hub.add(JSON.parse(JSON.stringify(e))); return relays.map(() => Promise.resolve('ok')); }
  }
  const inRealm = vm.runInContext('(s) => JSON.parse(s)', ctx);
  return Object.assign({}, NT, {
    SimplePool: Pool,
    finalizeEvent: (template, sk) => JSON.parse(JSON.stringify(NT.finalizeEvent(inRealm(JSON.stringify(template)), sk))),
    verifyEvent: (e) => NT.verifyEvent(inRealm(JSON.stringify(e))),
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return; await wait(15); } ok(false, 'timeout: ' + what); }
function makeClient(hub) {
  const store = { 'boop-augmented-nostr-key-v1': Buffer.from(NT.generateSecretKey()).toString('hex') };
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  let last = null;
  const client = new O.Client({ NostrTools: makeNT(hub), Logic: L, relays: ['wss://fake.relay.test'], onChange: (v) => { last = v; } });
  return { c: client, view: () => last };
}
(async () => {
  const hub = new Hub();
  // square + ghost with 2 players must use b3 (b2 cannot carry it)
  const host = makeClient(hub);
  const cfg = { shape: 'square', size: 6, pieces: 8, players: 2, ghost: true };
  const roomId = host.c.create(cfg);
  ok(roomId.startsWith('b3.') && O.invitation(roomId).version === 3, 'a 2-player square room uses the b3 invitation');
  const ce = hub.events.find((e) => JSON.parse(e.content).type === 'create');
  ok(JSON.parse(ce.content).v === 3 && same(JSON.parse(ce.content).cfg, cfg), 'the create event carries the square/ghost configuration');
  ok(throws(() => host.c.create({ levels: 4, pieces: 8, players: 2, ghost: true })) && throws(() => host.c.create({ shape: 'square', size: 5, pieces: 8, players: 2 })), 'the client refuses unplayable configurations');
  await until(() => host.view() && host.view().host, 'host sees its room');
  const guest = makeClient(hub);
  guest.c.open(roomId);
  await until(() => guest.view() && guest.view().myIdx === 1 && host.view().ready, 'guest seated');
  ok(host.view().state.shape === 'square' && host.view().state.ghost === true && guest.view().state.ghosts.length === 2, 'both clients replay a square ghost game');
  // play a few turns through the real client; the host moves piece + ghost, the guest piece + skip
  let seq = 0;
  const send = async (u, a, label) => { u.c.sendMove(seq, a); seq++; await until(() => host.view().seq === seq && guest.view().seq === seq, label); };
  await send(host, { k: 'play', i: 14, c: false }, 'host piece');
  ok(host.view().state.phase === 'ghost' && guest.view().state.phase === 'ghost' && host.view().state.turn === 0, 'both clients wait for the host ghost decision');
  await send(host, { k: 'ghost', i: 3 }, 'host ghost');
  ok(guest.view().state.ghosts[0].on && guest.view().state.turn === 1, 'guest sees the host ghost on its stitch');
  await send(guest, { k: 'play', i: 20, c: false }, 'guest piece');
  await send(guest, { k: 'skip' }, 'guest skip');
  await send(host, { k: 'play', i: 35, c: false }, 'host piece 2 (ghost moves)');
  ok(host.view().state.ghosts[0].t === 1 && same(host.view().state, guest.view().state), 'the ghost moved one stitch and both boards are identical');
  // the host moving on the guest's turn does not count
  host.c.sendMove(seq, { k: 'play', i: 21, c: false }); await wait(200);
  ok(host.view().seq === seq && guest.view().seq === seq && host.view().state.turn === 1 && host.view().rejected >= 1, 'a move by the wrong seat is rejected by every client');
  // 3-player square also b3, tree 2-player still b2
  const h3 = makeClient(hub), r3 = h3.c.create({ shape: 'square', size: 7, pieces: 10, players: 3 });
  ok(r3.startsWith('b3.'), '3-player square room: b3');
  const h2 = makeClient(hub), r2 = h2.c.create({ levels: 4, pieces: 8 });
  ok(r2.startsWith('b2.'), 'a classic 2-player tree room still uses b2');
  ok(hub.relayCalls.every((u) => u === 'wss://fake.relay.test'), 'only the in-memory fake relay was addressed');
  console.log(`PASS ${pass} checks`);
  process.exit(0);
})();
