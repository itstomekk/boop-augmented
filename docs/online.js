// Boop Augmented - online rooms over Nostr.
// Two wire formats share kind 8812 and the room tag:
//   v2 / invitation b2.<nonce>.<host>.<create-id>   exactly 2 players (unchanged, readable by older clients)
//   v3 / invitation b3.<nonce>.<host>.<create-id>   2-4 players with per-seat admission (this file)
// Both bind the room nonce, host pubkey and the exact signed creation event ID. Events:
//   {type:"create", cfg}                       host = author, plays seat 0 (Snowball)
//   {type:"join", root}                        request a seat
//   {type:"admit", root, join, guest[, seat]}  host authorizes one signed join request (v3: names the seat 1..players-1)
//   {type:"move", seq, a:{k, i, c[, x][, g][, d]}}   k = orn | play | line | promote | ghost (i = entry stitch) | skip (no i)
//        play extras, all optional: x = Shuffle power ('w' wild, 's' super, 'a' scaredy, 'b' blankie), g = Boopmas spirit 0-2 and
//        d = its direction 0-7 (Jacob Meowly only). Canonical field order: k, i, c, x, g, d.
// Every client replays the room from the create event with logic.js. A move counts only if it has the next
// seq, comes from the seat whose turn it is, and is legal; so relays only carry data, they never decide.
// v3 rules: a seat is held by at most one pubkey and a pubkey holds at most one seat (earliest host admission wins);
// no move counts until every seat is filled. v2 and v3 events are never mixed: each invitation pins its version.
(function (root) {
  'use strict';
  const KIND = 8812;
  const VERSION = 2;            // 2-player wire version (kept as is)
  const MULTI_VERSION = 3;      // 2-4 player wire version
  const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social'];
  const tagFor = (room) => 'boop-augmented-' + room;
  const NONCE_RE = /^[a-z0-9]{6,16}$/;
  const ROOM_RE = /^b2\.[a-z0-9]{6,16}\.[0-9a-f]{64}\.[0-9a-f]{64}$/;
  const ROOM_RE3 = /^b3\.[a-z0-9]{6,16}\.[0-9a-f]{64}\.[0-9a-f]{64}$/;
  const wireVersion = (prefix) => (prefix === 'b3' ? MULTI_VERSION : VERSION);
  function invitation(room) {
    if (typeof room !== 'string' || !(ROOM_RE.test(room) || ROOM_RE3.test(room))) {
      if (typeof room === 'string' && NONCE_RE.test(room)) throw new Error('Legacy room codes are unbound and no longer supported. Ask the host to create a new room and share its full invitation.');
      throw new Error('Invalid invitation: use the full room link or b2/b3 code.');
    }
    const [prefix, nonce, host, root] = room.split('.');
    return { nonce, host, root, version: wireVersion(prefix) };
  }

  function parse(ev, version) {
    try { const c = JSON.parse(ev.content); return c && c.v === (version || VERSION) ? c : null; } catch (e) { return null; }
  }
  const byTime = (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  // v2: exactly the original 2-player configuration (unknown fields, including players, are dropped).
  // v3: adds players (2-4, required), allows ornaments 0 (plain board without ornaments), and the square board:
  //   {shape:'square', size:6-10, pieces, players, ghost?:true}. Tree-only fields are dropped from square configs;
  //   `ghost` needs a square board. v2 refuses `shape` and `ghost` so the 2-player tree format stays closed.
  // Powers (v3 only; v2 refuses them): `boopmas: true` = tree with Boopmas spirits, `shuffle: true` = square with Shuffle powers (at least
  // 6 pieces, no ghosts). Both are booleans, `false` is normalised away, each needs its own board.
  // When Logic is given, configurations whose kittens cannot fit the board for that many players are refused
  // (they could deadlock).
  function sanitizeCfg(c, version, Logic) {
    if (!c || typeof c !== 'object') return null;
    const multi = version === MULTI_VERSION;
    if (!multi && (c.shape !== undefined || c.ghost !== undefined || c.boopmas !== undefined || c.shuffle !== undefined)) return null;
    const pieces = c.pieces;
    if (!Number.isSafeInteger(pieces) || pieces < 4 || pieces > 24) return null;
    if (c.ghost !== undefined && typeof c.ghost !== 'boolean') return null;
    if ((c.boopmas !== undefined && typeof c.boopmas !== 'boolean') || (c.shuffle !== undefined && typeof c.shuffle !== 'boolean')) return null;
    if (c.shape !== undefined && c.shape !== 'tree' && c.shape !== 'square') return null;
    if (c.shape === 'square') {
      if (!Number.isSafeInteger(c.size) || c.size < 6 || c.size > 10) return null;
      if (!Number.isSafeInteger(c.players) || c.players < 2 || c.players > 4) return null;
      if (c.boopmas || (c.shuffle && (c.ghost || pieces < 6))) return null;
      if (Logic && pieces > Logic.maxPieces(c.size, c.players, 0, 'square', !!c.shuffle)) return null;
      const sq = { shape: 'square', size: c.size, pieces, players: c.players };
      if (c.ghost) sq.ghost = true;
      if (c.shuffle) sq.shuffle = true;
      return sq;
    }
    if (c.ghost || c.shuffle) return null;
    const levels = c.levels;
    if (!Number.isSafeInteger(levels)) return null;
    if (levels < 4 || levels > 8) return null;
    const cfg = { levels, pieces };
    if (multi) {
      if (!Number.isSafeInteger(c.players) || c.players < 2 || c.players > 4) return null;
      cfg.players = c.players;
    }
    for (const k of ['ornaments', 'ornActive', 'decor', 'ornWin']) if (c[k] !== undefined) {
      const min = multi && k === 'ornaments' ? 0 : 1;
      if (!Number.isSafeInteger(c[k]) || c[k] < min || c[k] > (k === 'decor' ? levels - 2 : 24)) return null;
      cfg[k] = c[k];
    }
    if (c.boopmas) cfg.boopmas = true;
    if (multi && Logic && cfg.players > 2) {
      const orn = cfg.ornaments === undefined ? 3 : cfg.ornaments, act = Math.min(cfg.ornActive === undefined ? 1 : cfg.ornActive, orn);
      if (cfg.pieces > Logic.maxPieces(levels, cfg.players, act)) return null;
    }
    return cfg;
  }

  function canonicalAction(s, a) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || !['orn', 'play', 'line', 'promote', 'ghost', 'skip'].includes(a.k)) throw new Error('bad action');
    if (a.k === 'skip') {
      if (Object.keys(a).some((k) => k !== 'k')) throw new Error('unexpected action field');
      return { k: 'skip' };
    }
    const max = a.k === 'line' ? (s.options || []).length : s.b.length;
    if (!Number.isSafeInteger(a.i) || a.i < 0 || a.i >= max) throw new Error('bad action index');
    if (a.k === 'play' && typeof a.c !== 'boolean') throw new Error('bad piece type');
    const keys = a.k === 'play' ? ['k', 'i', 'c', 'x', 'g', 'd'] : ['k', 'i'];
    if (Object.keys(a).some((k) => !keys.includes(k))) throw new Error('unexpected action field');
    if (a.k !== 'play') return { k: a.k, i: a.i };
    const out = { k: a.k, i: a.i, c: a.c };
    if (a.x !== undefined) { if (!['w', 's', 'a', 'b'].includes(a.x)) throw new Error('bad power'); out.x = a.x; }
    if (a.g !== undefined) { if (!Number.isSafeInteger(a.g) || a.g < 0 || a.g > 2) throw new Error('bad spirit'); out.g = a.g; }
    if (a.d !== undefined) { if (a.g !== 2 || !Number.isSafeInteger(a.d) || a.d < 0 || a.d > 7) throw new Error('bad spirit direction'); out.d = a.d; }
    return out;
  }
  function applyAction(Logic, s, input) {
    const a = canonicalAction(s, input);
    if (a.k === 'orn') return Logic.placeOrnament(s, a.i).state;
    if (a.k === 'play') return Logic.play(s, a.i, a.c, a.x === undefined && a.g === undefined ? undefined : { x: a.x, g: a.g, d: a.d }).state;
    if (a.k === 'line') return Logic.chooseLine(s, a.i).state;
    if (a.k === 'ghost') return Logic.placeGhost(s, a.i).state;
    if (a.k === 'skip') return Logic.skipGhost(s).state;
    return Logic.promote(s, a.i).state;
  }

  // Pure: events -> room state. Deterministic for any order and duplicates of the same event set.
  // Caller verifies signatures. Invitation validation and room/creation binding are mandatory here.
  // Result: seats[i] = pubkey of seat i (null while open); `guest` = seats[1]; `ready` = every seat filled
  // (always true for v2, where the host may move before the guest arrives).
  function replay(Logic, events, room) {
    const anchor = invitation(room), V = anchor.version, multi = V === MULTI_VERSION;
    const seen = new Map();
    for (const ev of events) if (ev && ev.id && ev.kind === KIND && Array.isArray(ev.tags) && ev.tags.some((t) => t[0] === 't' && t[1] === tagFor(anchor.nonce)) && !seen.has(ev.id)) seen.set(ev.id, ev);
    const evs = [...seen.values()].sort(byTime);
    const out = { version: V, cfg: null, players: V === VERSION ? 2 : null, host: null, guest: null, seats: [], admissions: [], ready: false, state: null, seq: 0, actions: [], actionIds: [], root: anchor.root, admission: null, rejected: 0 };
    const create = evs.find((e) => { const c = parse(e, V); return e.id === anchor.root && e.pubkey === anchor.host && c && c.type === 'create' && sanitizeCfg(c.cfg, V, Logic); });
    if (!create) return out;
    out.host = create.pubkey;
    out.cfg = sanitizeCfg(parse(create, V).cfg, V, Logic);
    out.players = multi ? out.cfg.players : 2;
    const seats = new Array(out.players).fill(null), admissions = new Array(out.players).fill(null);
    seats[0] = out.host;
    const bound = evs.map((e) => ({ e, c: parse(e, V) })).filter(({ c }) => c && c.root === anchor.root);
    const requests = bound.filter(({ e, c }) => e.pubkey !== out.host && c.type === 'join');
    const validAdmit = ({ e, c }) => e.pubkey === out.host && c.type === 'admit' && requests.some((j) => j.e.id === c.join && j.e.pubkey === c.guest);
    if (!multi) {
      const admit = bound.find((x) => validAdmit(x));
      if (admit) { seats[1] = admit.c.guest; admissions[1] = admit.e.id; }
      out.admission = admit ? admit.e.id : null;
    } else {
      // Host-signed admissions in timestamp/ID order. A taken seat or an already seated pubkey is never reassigned.
      for (const x of bound) {
        if (!validAdmit(x)) continue;
        const seat = x.c.seat;
        if (!Number.isSafeInteger(seat) || seat < 1 || seat >= out.players || seats[seat] !== null || seats.includes(x.c.guest)) continue;
        seats[seat] = x.c.guest; admissions[seat] = x.e.id;
      }
      out.admission = admissions.map((a) => a || '').join(',');
    }
    out.seats = seats; out.admissions = admissions;
    out.guest = seats[1];
    out.ready = multi ? seats.every((p) => p !== null) : true;
    let st = Logic.newGame(out.cfg);
    const moves = bound.filter(({ c }) => c.type === 'move' && Number.isSafeInteger(c.seq) && c.seq >= 0);
    for (let seq = 0; out.ready; seq++) {
      if (st.phase === 'over') break;
      let applied = false;
      for (const { e, c } of moves) {
        if (c.seq !== seq) continue;
        if (e.pubkey !== seats[st.turn]) { out.rejected++; continue; }
        try {
          const a = canonicalAction(st, c.a);
          st = applyAction(Logic, st, a); out.actions.push(a); out.actionIds.push(e.id); applied = true; break;
        } catch (err) { out.rejected++; }
      }
      if (!applied) break;
    }
    out.state = st;
    out.seq = out.actions.length;
    return out;
  }

  function newRoomId() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    return [...a].map((x) => abc[x % abc.length]).join('');
  }
  const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

  // Browser client: one throwaway key per browser, one room at a time.
  class Client {
    constructor(opts) {
      this.N = opts.NostrTools;
      this.Logic = opts.Logic;
      this.relays = opts.relays && opts.relays.length ? opts.relays : DEFAULT_RELAYS;
      this.onChange = opts.onChange || (() => {});
      const KEY = 'boop-augmented-nostr-key-v1';
      let hex = null;
      try { hex = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
      if (!hex || !/^[0-9a-f]{64}$/.test(hex)) { hex = toHex(this.N.generateSecretKey()); try { localStorage.setItem(KEY, hex); } catch (e) { /* ignore */ } }
      this.sk = fromHex(hex);
      this.pubkey = this.N.getPublicKey(this.sk);
      this.pool = new this.N.SimplePool({ enableReconnect: true });
      this.events = new Map();
      this.room = null;
      this.anchor = null;
      this.sub = null;
      this.relayOk = new Set();
      this.joinSent = false;
      this.timer = null;
    }
    sign(content, nonce, version) {
      return this.N.finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', tagFor(nonce || this.anchor.nonce)]], content: JSON.stringify(Object.assign({ v: version || (this.anchor && this.anchor.version) || VERSION, root: this.anchor && this.anchor.root }, content)) }, this.sk);
    }
    publish(content) {
      const ev = this.sign(content);
      return this.publishEvent(ev);
    }
    publishEvent(ev) {
      this.events.set(ev.id, ev);          // optimistic: count our own event immediately
      this.changed();
      const ps = this.pool.publish(this.relays, ev);
      ps.forEach((p, k) => p.then(() => this.relayOk.add(this.relays[k])).catch(() => {}));
      return ev;
    }
    open(room) {
      const anchor = invitation(room); // validate before disrupting an existing room
      this.close();
      this.room = room;
      this.anchor = anchor;
      this.joinSent = false;
      this.sub = this.pool.subscribe(this.relays, { kinds: [KIND], '#t': [tagFor(anchor.nonce)], limit: 2000 }, {
        onevent: (ev) => { if (this.room === room && this.N.verifyEvent(ev) && !this.events.has(ev.id)) { this.events.set(ev.id, ev); this.changed(); } },
        oneose: () => { if (this.room === room) { this.eose = true; this.changed(); } },
      });
    }
    // Plain 2-player tree rooms keep the original b2/v2 format; everything newer uses b3/v3.
    create(cfg) {
      const nonce = newRoomId();
      // Only the plain 2-player tree fits the original b2/v2 format; square boards, ghosts, powers and 3-4 players use b3/v3.
      const version = cfg && (cfg.players > 2 || cfg.shape === 'square' || cfg.ghost || cfg.boopmas || cfg.shuffle) ? MULTI_VERSION : VERSION;
      const clean = sanitizeCfg(cfg, version, this.Logic);
      if (!clean) throw new Error('bad room configuration');
      const create = this.sign({ type: 'create', cfg: clean, root: null }, nonce, version);
      const room = `b${version}.${nonce}.${this.pubkey}.${create.id}`;
      this.open(room);
      this.publishEvent(create);
      return room;
    }
    close() { clearTimeout(this.timer); if (this.sub) { this.sub.close(); this.sub = null; } this.events.clear(); this.room = null; this.anchor = null; this.eose = false; }
    changed() { clearTimeout(this.timer); this.timer = setTimeout(() => this.onChange(this.view()), 40); }
    view() {
      const r = replay(this.Logic, [...this.events.values()], this.room);
      r.me = this.pubkey;
      const idx = r.seats.indexOf(this.pubkey);
      r.myIdx = idx >= 0 ? idx : null;
      const all = [...this.events.values()].sort(byTime);
      const requestsFor = (host) => all.filter((e) => { const c = parse(e, r.version); return e.pubkey !== host && c && c.type === 'join' && c.root === r.root; });
      if (r.version === VERSION) {
        // Only the invite-bound host can grant a seat. Outsider backdating cannot replace it.
        // Wait for initial history before admitting, to avoid re-admission on host reload.
        if (r.host === this.pubkey && !r.guest && this.eose) {
          const request = requestsFor(r.host)[0];
          if (request) this.publish({ type: 'admit', join: request.id, guest: request.pubkey });
        }
        if (r.host && r.host !== this.pubkey && !r.guest && !this.joinSent) { this.joinSent = true; this.publish({ type: 'join' }); }
      } else if (r.host) {
        const free = [];
        r.seats.forEach((p, i) => { if (p === null) free.push(i); });
        if (r.host === this.pubkey && this.eose && free.length) {
          // Fill open seats from distinct, unseated requesters in timestamp/ID order. Replay stays the authority.
          const taken = new Set(r.seats.filter(Boolean));
          for (const request of requestsFor(r.host)) {
            if (!free.length) break;
            if (taken.has(request.pubkey)) continue;
            taken.add(request.pubkey);
            this.publish({ type: 'admit', join: request.id, guest: request.pubkey, seat: free.shift() });
          }
        }
        // Ask once, and only after the history arrived, so a seated player who reloads does not re-request.
        if (r.host !== this.pubkey && r.myIdx === null && free.length && this.eose && !this.joinSent) { this.joinSent = true; this.publish({ type: 'join' }); }
      }
      return r;
    }
    sendMove(seq, a) { return this.publish({ type: 'move', seq, a }); }
  }

  const api = { KIND, VERSION, MULTI_VERSION, DEFAULT_RELAYS, tagFor, replay, applyAction, canonicalAction, sanitizeCfg, newRoomId, Client, ROOM_RE, ROOM_RE3, invitation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoopOnline = api;
})(typeof window !== 'undefined' ? window : globalThis);
