// Boop Augmented - online rooms over Nostr.
// V2 invites bind the room nonce, host pubkey and exact signed creation event ID.
//   {type:"create", cfg}            host = author, plays Snowball (player 0)
//   {type:"join", root}             request the Coal seat
//   {type:"admit", root, join, guest} host authorizes one signed join request
//   {type:"move", seq, a:{k, i, c}} k = orn | play | line | promote
// Every client replays the room from the create event with logic.js. A move counts only if it has the next
// seq, comes from the player whose turn it is, and is legal; so relays only carry data, they never decide.
(function (root) {
  'use strict';
  const KIND = 8812;
  const VERSION = 2;
  const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social'];
  const tagFor = (room) => 'boop-augmented-' + room;
  const NONCE_RE = /^[a-z0-9]{6,16}$/;
  const ROOM_RE = /^b2\.[a-z0-9]{6,16}\.[0-9a-f]{64}\.[0-9a-f]{64}$/;
  function invitation(room) {
    if (typeof room !== 'string' || !ROOM_RE.test(room)) {
      if (typeof room === 'string' && NONCE_RE.test(room)) throw new Error('Legacy room codes are unbound and no longer supported. Ask the host to create a new room and share its full invitation.');
      throw new Error('Invalid invitation: use the full room link or b2 code.');
    }
    const [, nonce, host, root] = room.split('.');
    return { nonce, host, root };
  }

  function parse(ev) {
    try { const c = JSON.parse(ev.content); return c && c.v === VERSION ? c : null; } catch (e) { return null; }
  }
  const byTime = (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  function sanitizeCfg(c) {
    if (!c || typeof c !== 'object') return null;
    const levels = c.levels, pieces = c.pieces;
    if (!Number.isSafeInteger(levels) || !Number.isSafeInteger(pieces)) return null;
    if (levels < 4 || levels > 8 || pieces < 4 || pieces > 24) return null;
    const cfg = { levels, pieces };
    for (const k of ['ornaments', 'ornActive', 'decor', 'ornWin']) if (c[k] !== undefined) {
      if (!Number.isSafeInteger(c[k]) || c[k] < 1 || c[k] > (k === 'decor' ? levels - 2 : 24)) return null;
      cfg[k] = c[k];
    }
    return cfg;
  }

  function canonicalAction(s, a) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || !['orn', 'play', 'line', 'promote'].includes(a.k)) throw new Error('bad action');
    const max = a.k === 'line' ? (s.options || []).length : s.b.length;
    if (!Number.isSafeInteger(a.i) || a.i < 0 || a.i >= max) throw new Error('bad action index');
    if (a.k === 'play' && typeof a.c !== 'boolean') throw new Error('bad piece type');
    const keys = a.k === 'play' ? ['k', 'i', 'c'] : ['k', 'i'];
    if (Object.keys(a).some((k) => !keys.includes(k))) throw new Error('unexpected action field');
    return a.k === 'play' ? { k: a.k, i: a.i, c: a.c } : { k: a.k, i: a.i };
  }
  function applyAction(Logic, s, input) {
    const a = canonicalAction(s, input);
    if (a.k === 'orn') return Logic.placeOrnament(s, a.i).state;
    if (a.k === 'play') return Logic.play(s, a.i, a.c).state;
    if (a.k === 'line') return Logic.chooseLine(s, a.i).state;
    return Logic.promote(s, a.i).state;
  }

  // Pure: events -> room state. Deterministic for any order and duplicates of the same event set.
  // Caller verifies signatures. Invitation validation and room/creation binding are mandatory here.
  function replay(Logic, events, room) {
    const anchor = invitation(room);
    const seen = new Map();
    for (const ev of events) if (ev && ev.id && ev.kind === KIND && Array.isArray(ev.tags) && ev.tags.some((t) => t[0] === 't' && t[1] === tagFor(anchor.nonce)) && !seen.has(ev.id)) seen.set(ev.id, ev);
    const evs = [...seen.values()].sort(byTime);
    const out = { cfg: null, host: null, guest: null, state: null, seq: 0, actions: [], actionIds: [], root: anchor.root, admission: null, rejected: 0 };
    const create = evs.find((e) => { const c = parse(e); return e.id === anchor.root && e.pubkey === anchor.host && c && c.type === 'create' && sanitizeCfg(c.cfg); });
    if (!create) return out;
    out.host = create.pubkey;
    out.cfg = sanitizeCfg(parse(create).cfg);
    const bound = evs.map((e) => ({ e, c: parse(e) })).filter(({ c }) => c && c.root === anchor.root);
    const requests = bound.filter(({ e, c }) => e.pubkey !== out.host && c.type === 'join');
    const admit = bound.find(({ e, c }) => e.pubkey === out.host && c.type === 'admit' && requests.some((j) => j.e.id === c.join && j.e.pubkey === c.guest));
    out.guest = admit ? admit.c.guest : null;
    out.admission = admit ? admit.e.id : null;
    let st = Logic.newGame(out.cfg);
    const players = [out.host, out.guest];
    const moves = bound.filter(({ c }) => c.type === 'move' && Number.isSafeInteger(c.seq) && c.seq >= 0);
    for (let seq = 0; ; seq++) {
      if (st.phase === 'over') break;
      let applied = false;
      for (const { e, c } of moves) {
        if (c.seq !== seq) continue;
        if (e.pubkey !== players[st.turn]) { out.rejected++; continue; }
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
    sign(content, nonce) {
      return this.N.finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', tagFor(nonce || this.anchor.nonce)]], content: JSON.stringify(Object.assign({ v: VERSION, root: this.anchor && this.anchor.root }, content)) }, this.sk);
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
    create(cfg) {
      const nonce = newRoomId();
      if (!sanitizeCfg(cfg)) throw new Error('bad room configuration');
      const create = this.sign({ type: 'create', cfg, root: null }, nonce);
      const room = `b2.${nonce}.${this.pubkey}.${create.id}`;
      this.open(room);
      this.publishEvent(create);
      return room;
    }
    close() { clearTimeout(this.timer); if (this.sub) { this.sub.close(); this.sub = null; } this.events.clear(); this.room = null; this.anchor = null; this.eose = false; }
    changed() { clearTimeout(this.timer); this.timer = setTimeout(() => this.onChange(this.view()), 40); }
    view() {
      const r = replay(this.Logic, [...this.events.values()], this.room);
      r.me = this.pubkey;
      r.myIdx = r.host === this.pubkey ? 0 : r.guest === this.pubkey ? 1 : null;
      // Only the invite-bound host can grant a seat. Outsider backdating cannot replace it.
      // Wait for initial history before admitting, to avoid re-admission on host reload.
      if (r.host === this.pubkey && !r.guest && this.eose) {
        const request = [...this.events.values()].sort(byTime).find((e) => {
          const c = parse(e); return e.pubkey !== r.host && c && c.type === 'join' && c.root === r.root;
        });
        if (request) this.publish({ type: 'admit', join: request.id, guest: request.pubkey });
      }
      if (r.host && r.host !== this.pubkey && !r.guest && !this.joinSent) { this.joinSent = true; this.publish({ type: 'join' }); }
      return r;
    }
    sendMove(seq, a) { return this.publish({ type: 'move', seq, a }); }
  }

  const api = { KIND, VERSION, DEFAULT_RELAYS, tagFor, replay, applyAction, canonicalAction, sanitizeCfg, newRoomId, Client, ROOM_RE, invitation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoopOnline = api;
})(typeof window !== 'undefined' ? window : globalThis);
