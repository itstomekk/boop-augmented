// Online rooms with Boopmas spirits (tree) and Shuffle powers (square): node test/online_powers.test.js
// Part A: pure config validation, canonical actions and replay. Part B: the real Client with real nostr-tools signatures
// against an in-memory fake relay (no network; no relay of any kind is contacted).
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const L = require('../docs/logic.js');
const O = require('../docs/online.js');
let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } pass++; }
const throws = (fn) => { try { fn(); } catch (e) { return true; } return false; };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const same = (a, b) => canon(a) === canon(b);

// ======================= Part A =======================
const S3 = (c) => O.sanitizeCfg(c, 3, L), S2 = (c) => O.sanitizeCfg(c);
const TREE = { levels: 4, pieces: 8, players: 2, boopmas: true }, SQ = { shape: 'square', size: 6, pieces: 8, players: 2, shuffle: true };
ok(same(S3(TREE), TREE) && same(S3(Object.assign({}, TREE, { players: 4, pieces: 8 })), Object.assign({}, TREE, { players: 4 })), 'v3 accepts a Boopmas tree config for 2-4 players');
ok(same(S3(Object.assign({}, TREE, { boopmas: false })), { levels: 4, pieces: 8, players: 2 }), 'boopmas:false is normalised away');
ok(same(S3(Object.assign({}, TREE, { levels: 6, ornaments: 5, ornActive: 2, decor: 3, ornWin: 3 })), Object.assign({}, TREE, { levels: 6, ornaments: 5, ornActive: 2, decor: 3, ornWin: 3 })), 'Boopmas combines with big trees and ornament options');
for (const v of [1, 'true', null, {}, []]) ok(S3(Object.assign({}, TREE, { boopmas: v })) === null, 'boopmas must be a boolean: ' + JSON.stringify(v));
ok(S3({ shape: 'square', size: 6, pieces: 8, players: 2, boopmas: true }) === null, 'spirits need the tree');
ok(same(S3(SQ), SQ) && same(S3(Object.assign({}, SQ, { size: 10, pieces: 16, players: 3 })), Object.assign({}, SQ, { size: 10, pieces: 16, players: 3 })), 'v3 accepts a Shuffle square config');
ok(same(S3(Object.assign({}, SQ, { shuffle: false })), { shape: 'square', size: 6, pieces: 8, players: 2 }), 'shuffle:false is normalised away');
for (const v of [1, 'true', null, {}]) ok(S3(Object.assign({}, SQ, { shuffle: v })) === null, 'shuffle must be a boolean: ' + JSON.stringify(v));
ok(S3({ levels: 4, pieces: 8, players: 2, shuffle: true }) === null, 'shuffle needs a square board');
ok(S3(Object.assign({}, SQ, { ghost: true })) === null, 'shuffle and ghosts cannot be combined');
ok(S3(Object.assign({}, SQ, { pieces: 5 })) === null && S3(Object.assign({}, SQ, { pieces: 6 })) !== null, 'shuffle needs at least 6 pieces per player');
ok(S3(Object.assign({}, SQ, { pieces: 17 })) !== null && S3(Object.assign({}, SQ, { pieces: 18 })) === null, 'shuffle 6x6, 2 players: 17 pieces fit with the two wild pieces (plain squares allow 18)');
ok(S3(Object.assign({}, SQ, { players: 4, pieces: 9 })) !== null && S3(Object.assign({}, SQ, { players: 4, pieces: 10 })) === null, 'shuffle 6x6, 4 players: 9 pieces');
ok(S2({ levels: 4, pieces: 8, boopmas: true }) === null && S2({ levels: 4, pieces: 8, shuffle: true }) === null && S2({ levels: 4, pieces: 8, boopmas: false }) === null, 'v2 refuses the new fields (the 2-player tree format stays closed)');
ok(JSON.stringify(S2({ levels: 4, pieces: 8, ornaments: 3, ornActive: 1, decor: 1 })) === '{"levels":4,"pieces":8,"ornaments":3,"ornActive":1,"decor":1}', 'v2 cfg byte-identical to before');
ok(L.newGame(S3(TREE)).boopmas === true && L.newGame(S3(SQ)).shuffle === true, 'sanitised configs build the right games');
ok(!S3(TREE).hasOwnProperty('ghost') && !S3(SQ).hasOwnProperty('boopmas') && !S3(SQ).hasOwnProperty('levels'), 'no stray keys');

// canonical actions
const g0 = L.newGame(S3(SQ)), t0 = L.newGame(S3(TREE));
ok(same(O.canonicalAction(g0, { k: 'play', i: 3, c: false, x: 's' }), { k: 'play', i: 3, c: false, x: 's' }), 'x is a canonical play field');
ok(canon(O.canonicalAction(g0, { x: 'b', i: 3, k: 'play', c: false })) === canon({ k: 'play', i: 3, c: false, x: 'b' }) && Object.keys(O.canonicalAction(g0, { x: 'b', i: 3, k: 'play', c: false })).join() === 'k,i,c,x', 'fields come out in a fixed order k,i,c,x,g,d');
ok(Object.keys(O.canonicalAction(t0, { d: 4, g: 2, c: true, i: 9, k: 'play' })).join() === 'k,i,c,g,d' && same(O.canonicalAction(t0, { k: 'play', i: 9, c: true, g: 0 }), { k: 'play', i: 9, c: true, g: 0 }), 'g and d are canonical play fields');
ok(same(O.canonicalAction(g0, { k: 'play', i: 3, c: false }), { k: 'play', i: 3, c: false }), 'plain plays are unchanged');
for (const bad of [{ k: 'play', i: 3, c: false, x: 'z' }, { k: 'play', i: 3, c: false, x: 1 }, { k: 'play', i: 3, c: false, x: null }, { k: 'play', i: 3, c: false, x: '' }, { k: 'play', i: 3, c: false, g: 3 }, { k: 'play', i: 3, c: false, g: -1 }, { k: 'play', i: 3, c: false, g: 1.5 }, { k: 'play', i: 3, c: false, g: '1' }, { k: 'play', i: 3, c: false, g: null },
  { k: 'play', i: 3, c: false, g: 2, d: 8 }, { k: 'play', i: 3, c: false, g: 2, d: -1 }, { k: 'play', i: 3, c: false, g: 2, d: 0.5 }, { k: 'play', i: 3, c: false, g: 2, d: '1' }, { k: 'play', i: 3, c: false, d: 1 }, { k: 'play', i: 3, c: false, g: 0, d: 1 }, { k: 'play', i: 3, c: false, g: 1, d: 1 },
  { k: 'play', i: 3, c: false, q: 1 }, { k: 'orn', i: 3, x: 's' }, { k: 'line', i: 0, g: 0 }, { k: 'promote', i: 3, d: 1 }, { k: 'skip', x: 's' }, { k: 'ghost', i: 1, g: 0 }])
  ok(throws(() => O.canonicalAction(g0, bad)), 'bad action refused: ' + JSON.stringify(bad));
// rules decide the rest
ok(throws(() => O.applyAction(L, g0, { k: 'play', i: 3, c: false, g: 0 })) && throws(() => O.applyAction(L, t0, { k: 'play', i: 3, c: false, x: 's' })) && throws(() => O.applyAction(L, t0, { k: 'play', i: 3, c: false, g: 0 })), 'spirit without the board, power on a tree, spirit on a square: all illegal');
ok(!throws(() => O.applyAction(L, g0, { k: 'play', i: 3, c: false, x: 's' })) && throws(() => O.applyAction(L, g0, { k: 'play', i: 3, c: true, x: 's' })), 'a super kitten is fine, a super cat is not owned yet');
{
  const s = L.newGame(S3(SQ)), a = O.applyAction(L, s, { k: 'play', i: 14, c: false });
  ok(throws(() => O.applyAction(L, a, { k: 'play', i: 20, c: false, x: 'b' })) && !throws(() => O.applyAction(L, a, { k: 'play', i: 14, c: false, x: 'b' })), 'the blankie goes on a piece, not on an empty cell');
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
let seed = 5; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomAction(s) {
  if (s.phase === 'ornament') return { k: 'orn', i: pick(L.ornamentCells(s)) };
  if (s.phase === 'chooseLine') return { k: 'line', i: 0 };
  if (s.phase === 'promote') { const mine = []; s.b.forEach((q, i) => { if (q && q.p === s.turn && q.kind !== 'o') mine.push(i); }); return { k: 'promote', i: mine[0] }; }
  const m = pick(L.legalMoves(s)), a = { k: 'play', i: m.idx, c: m.cat };
  if (m.x) a.x = m.x;
  if (rnd() < 0.7) { const sp = L.legalSpirits(s, m.idx); if (sp.length) { const x = pick(sp); a.g = x.g; if (x.d !== undefined) a.d = x.d; } }
  return a;
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
  ['2-player Boopmas tree', { levels: 4, pieces: 8, players: 2, boopmas: true }, [HOST, G1]],
  ['3-player Boopmas tree, no ornaments', { levels: 4, pieces: 8, players: 3, ornaments: 0, boopmas: true }, [HOST, G1, G2]],
  ['4-player Boopmas 5-tier tree', { levels: 5, pieces: 10, players: 4, boopmas: true }, [HOST, G1, G2, G3]],
  ['2-player Shuffle 6x6', { shape: 'square', size: 6, pieces: 8, players: 2, shuffle: true }, [HOST, G1]],
  ['3-player Shuffle 8x8', { shape: 'square', size: 8, pieces: 12, players: 3, shuffle: true }, [HOST, G1, G2]],
  ['4-player Shuffle 6x6', { shape: 'square', size: 6, pieces: 9, players: 4, shuffle: true }, [HOST, G1, G2, G3]],
]) {
  const g = room(cfg, seats, 260);
  const r = O.replay(L, g.evs, ROOM3);
  ok(r.ready && r.version === 3 && r.seq === g.acts.length && r.rejected === 0 && g.acts.length > 40, `${label}: ${g.acts.length} moves replayed, none rejected`);
  ok(same(r.state, g.s), `${label}: replay equals direct play exactly`);
  ok(same(O.replay(L, g.evs.slice().reverse().concat(g.evs.slice(0, 9)), ROOM3).state, g.s), `${label}: event order and duplicates do not matter`);
  const used = g.acts.filter((a) => a.k === 'play');
  ok(cfg.boopmas ? used.some((a) => a.g !== undefined) && used.every((a) => a.x === undefined) : used.some((a) => a.x === 'w') && used.some((a) => a.x === 'b') && used.every((a) => a.g === undefined), `${label}: the moves carry exactly this mode's power fields`);
  ok(r.actions.every((a, i) => same(a, g.acts[i]) && Object.keys(a).map((k) => 'kicxgd'.indexOf(k)).every((v, j, arr) => v >= 0 && (j === 0 || v > arr[j - 1]))), `${label}: replayed actions are the canonical forms`);
}
// every kind of power round-trips through the wire format, and the rules still decide
{
  const cfg = { levels: 4, pieces: 8, players: 2, ornaments: 0, boopmas: true };
  const c = create(cfg), j = join(G1, 101), a = admit(j, 1, 110), base = [c, j, a];
  const mv = (who, seq, act, t) => ev(who, { type: 'move', seq, a: act }, t);
  // seat 0 graduates a line (set up by moves) so that seat 1 holds the spirit board; use a scripted game on a 2-player tree
  const script = [[0, { k: 'play', i: 22, c: false }], [1, { k: 'play', i: 0 + 1, c: false }]];
  let st = L.newGame(cfg), seq = 0; const evs = base.slice();
  for (const [who, act] of script) { evs.push(mv(who === 0 ? HOST : G1, seq++, act, 200 + seq)); st = O.applyAction(L, st, act); }
  let r = O.replay(L, evs, ROOM3);
  ok(r.seq === 2 && same(r.state, st), 'scripted opening replays');
  // no spirit board yet: a spirit move is rejected, by anyone
  r = O.replay(L, evs.concat(mv(HOST, 2, { k: 'play', i: 8, c: false, g: 0 }, 300)), ROOM3);
  ok(r.seq === 2 && r.rejected === 1, 'a spirit nobody holds is rejected');
  r = O.replay(L, evs.concat(mv(HOST, 2, { k: 'play', i: 8, c: false, x: 'w' }, 300)), ROOM3);
  ok(r.seq === 2 && r.rejected === 1, 'a Shuffle power in a Boopmas room is rejected');
  r = O.replay(L, evs.concat(mv(HOST, 2, { k: 'play', i: 8, c: false, g: 0, d: 1 }, 300)), ROOM3);
  ok(r.seq === 2 && r.rejected === 1, 'extra direction on a plain spirit is rejected');
  r = O.replay(L, evs.concat(mv(HOST, 2, { k: 'play', i: 8, c: false, junk: 1 }, 300)), ROOM3);
  ok(r.seq === 2 && r.rejected === 1, 'unknown fields are rejected');
  // find the first hand-over in a random game (plain placements only), then check who may use a spirit
  const lc = { levels: 4, pieces: 8, players: 2, ornaments: 0, boopmas: true };
  let found = null;
  for (let tries = 0; tries < 400 && !found; tries++) {
    let st2 = L.newGame(lc); const aa = [];
    for (let k = 0; k < 60 && st2.phase !== 'over'; k++) {
      const a2 = randomAction(st2);
      delete a2.g; delete a2.d;
      st2 = O.applyAction(L, st2, a2); aa.push(a2);
      if (st2.spirits.holder !== null) { found = { st: st2, acts: aa }; break; }
    }
  }
  ok(found && found.st.spirits.holder !== null, 'a random game reaches the first graduation');
  const holder = found.st.spirits.holder, other = 1 - holder;
  const evs2 = base.slice(); let walk = L.newGame(lc);
  found.acts.forEach((a2, i) => { evs2.push(mv(walk.turn === 0 ? HOST : G1, i, a2, 200 + i)); walk = O.applyAction(L, walk, a2); });
  r = O.replay(L, evs2, ROOM3);
  ok(r.seq === found.acts.length && same(r.state, found.st) && r.state.spirits.holder === holder, 'a game up to the first hand-over replays');
  const turn = r.state.turn, mover = turn === 0 ? HOST : G1, free = L.legalMoves(r.state)[0].idx;
  ok(r.state.phase === 'place', 'the next turn is a normal placement');
  r = O.replay(L, evs2.concat(mv(mover, found.acts.length, { k: 'play', i: free, c: false, g: 0 }, 400)), ROOM3);
  ok(turn === holder ? r.seq === found.acts.length + 1 && r.state.spirits.used[0] === true && r.rejected === 0 : r.seq === found.acts.length && r.rejected === 1, `only the holder (seat ${holder}) can use a spirit; seat ${turn} is on turn`);
  // and the other seat, when it is their turn, is refused (play on until seat ${other} is on turn)
  const adv = L.play(found.st, free, false).state;
  const evs3 = evs2.concat(mv(mover, found.acts.length, { k: 'play', i: free, c: false }, 400));
  const m2 = adv.turn === 0 ? HOST : G1, free2 = L.legalMoves(adv)[0].idx;
  r = O.replay(L, evs3.concat(mv(m2, found.acts.length + 1, { k: 'play', i: free2, c: false, g: 1 }, 401)), ROOM3);
  ok(adv.phase !== 'place' || (adv.turn === holder ? r.seq === found.acts.length + 2 : r.seq === found.acts.length + 1 && r.rejected === 1), 'a seat that does not hold the board is refused on its own turn');
}
// a v2 room can never carry the new fields
{
  const c2 = create({ levels: 4, pieces: 8, boopmas: true }, 2), c3 = create({ levels: 4, pieces: 8, shuffle: true }, 2);
  ok(O.replay(L, [c2], ROOM2).state === null && O.replay(L, [c3], ROOM2).state === null, 'a b2 room whose config asks for powers is not a room');
  ok(O.replay(L, [create({ levels: 4, pieces: 8, players: 2, boopmas: true }, 2)], ROOM2).state === null, 'not even with players');
  const t2 = create({ levels: 4, pieces: 8, players: 2 }), tj = join(G1, 101);
  const r = O.replay(L, [t2, tj, admit(tj, 1, 110)], ROOM3);
  ok(r.state.boopmas === false && r.state.shuffle === false && r.ready, 'plain b3 rooms still work');
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
  // Boopmas tree, 2 players: must use b3 (b2 cannot carry it)
  const host = makeClient(hub);
  const cfg = { levels: 4, pieces: 8, players: 2, boopmas: true };
  const roomId = host.c.create(cfg);
  ok(roomId.startsWith('b3.') && O.invitation(roomId).version === 3, 'a 2-player Boopmas room uses the b3 invitation');
  const ce = hub.events.find((e) => JSON.parse(e.content).type === 'create');
  ok(JSON.parse(ce.content).v === 3 && same(JSON.parse(ce.content).cfg, cfg), 'the create event carries the Boopmas configuration');
  ok(throws(() => host.c.create({ shape: 'square', size: 6, pieces: 8, players: 2, boopmas: true })) && throws(() => host.c.create({ levels: 4, pieces: 8, players: 2, shuffle: true })) && throws(() => host.c.create({ shape: 'square', size: 6, pieces: 8, players: 2, shuffle: true, ghost: true })), 'the client refuses unplayable power configurations');
  await until(() => host.view() && host.view().host, 'host sees its room');
  const guest = makeClient(hub);
  guest.c.open(roomId);
  await until(() => guest.view() && guest.view().myIdx === 1 && host.view().ready, 'guest seated');
  ok(host.view().state.boopmas === true && guest.view().state.spirits.holder === null, 'both clients replay a Boopmas game');
  // play until the first graduation through the real client, then use a spirit as the new holder
  const clients = [host, guest]; let seq = 0, st = L.newGame(cfg), usedSpirit = false;
  const send = async (u, a, label) => { u.c.sendMove(seq, a); seq++; st = O.applyAction(L, st, a); await until(() => host.view().seq === seq && guest.view().seq === seq, label); };
  let guard = 0;
  while (guard++ < 400 && !usedSpirit && st.phase !== 'over') {
    const a = randomAction(st);
    if (a.g !== undefined && st.spirits.holder === st.turn) usedSpirit = true;
    await send(clients[st.turn], a, 'move ' + seq);
    ok(same(host.view().state, st) && same(guest.view().state, st), 'both boards equal the local rules after move ' + seq);
  }
  ok(usedSpirit && host.view().state.spirits.used.some(Boolean), 'a spirit move travelled through the relay and both clients applied it');
  const mv = hub.events.map((e) => JSON.parse(e.content)).filter((c) => c.type === 'move');
  ok(mv.some((c) => c.a.g !== undefined) && mv.every((c) => c.v === 3), 'move events carry the spirit field');
  // a move by the wrong seat is rejected by everyone
  const wrong = st.turn === 0 ? guest : host;
  wrong.c.sendMove(seq, { k: 'play', i: L.legalMoves(st)[0].idx, c: false }); await wait(200);
  ok(host.view().seq === seq && guest.view().seq === seq && host.view().rejected >= 1, 'a wrong-seat move is rejected by every client');

  // Shuffle square, 2 players
  const h2 = makeClient(hub), cfg2 = { shape: 'square', size: 7, pieces: 10, players: 2, shuffle: true };
  const room2 = h2.c.create(cfg2);
  ok(room2.startsWith('b3.'), 'a Shuffle room uses b3');
  await until(() => h2.view() && h2.view().host, 'shuffle host');
  const g2 = makeClient(hub); g2.c.open(room2);
  await until(() => g2.view() && g2.view().myIdx === 1 && h2.view().ready, 'shuffle guest seated');
  ok(h2.view().state.shuffle === true && same(h2.view().state.wild, { k: 2, c: 0 }), 'both clients replay a Shuffle game');
  let seq2 = 0, st2 = L.newGame(cfg2); const cl2 = [h2, g2], kinds = new Set();
  const send2 = async (u, a, label) => { u.c.sendMove(seq2, a); seq2++; st2 = O.applyAction(L, st2, a); await until(() => h2.view().seq === seq2 && g2.view().seq === seq2, label); };
  const script = [{ k: 'play', i: 24, c: false, x: 'w' }, { k: 'play', i: 0, c: false, x: 's' }, { k: 'play', i: 48, c: false, x: 'a' }, { k: 'play', i: 24, c: false, x: 'b' }, { k: 'play', i: 40, c: false }];
  for (const a of script) { kinds.add(a.x || '-'); await send2(cl2[st2.turn], a, 'shuffle move'); }
  ok(same(h2.view().state, st2) && same(g2.view().state, st2), 'wild, super, scaredy, blankie and plain moves leave both clients identical');
  ok(st2.b[24] && st2.b[24].cov !== undefined, 'the blankie put the wild piece to sleep (it is covered for everybody)');
  ok(h2.view().state.pool[1].ks === 0 && h2.view().state.pool[1].b === 0 && h2.view().state.pool[0].ka === 1 && h2.view().state.wild.k === 1, 'pools show the spent super kitten, the used blankie, the scaredy that was booped home and the wild kitten on the board');
  cl2[1 - st2.turn].c.sendMove(seq2, { k: 'play', i: 5, c: false, x: 'w' }); await wait(200);
  ok(h2.view().seq === seq2 && h2.view().rejected >= 1, 'a Shuffle move by the wrong seat is rejected');
  // 3-player Boopmas stays b3; plain 2-player tree still b2
  const h3 = makeClient(hub), r3 = h3.c.create({ levels: 4, pieces: 8, players: 3, boopmas: true });
  ok(r3.startsWith('b3.'), '3-player Boopmas room: b3');
  const h4 = makeClient(hub), r4 = h4.c.create({ levels: 4, pieces: 8 });
  ok(r4.startsWith('b2.'), 'a classic 2-player tree room still uses b2');
  ok(hub.relayCalls.every((u) => u === 'wss://fake.relay.test'), 'only the in-memory fake relay was addressed');
  console.log(`PASS ${pass} checks`);
  process.exit(0);
})();
