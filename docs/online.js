// Boop Augmented - online rooms over Nostr.
// A room is a list of signed events tagged ["t", "boop-augmented-<room>"] (kind 8812, regular, so relays keep them):
//   {type:"create", cfg}            host = author, plays Snowball (player 0)
//   {type:"join"}                   first other author to join plays Coal (player 1)
//   {type:"move", seq, a:{k, i, c}} k = orn | play | line | promote
// Every client replays the room from the create event with logic.js. A move counts only if it has the next
// seq, comes from the player whose turn it is, and is legal; so relays only carry data, they never decide.
(function (root) {
  'use strict';
  const KIND = 8812;
  const VERSION = 1;
  const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social'];
  const tagFor = (room) => 'boop-augmented-' + room;
  const ROOM_RE = /^[a-z0-9]{6,16}$/;

  function parse(ev) {
    try { const c = JSON.parse(ev.content); return c && c.v === VERSION ? c : null; } catch (e) { return null; }
  }
  const byTime = (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  function sanitizeCfg(c) {
    if (!c || typeof c !== 'object') return null;
    const levels = c.levels | 0, pieces = c.pieces | 0;
    if (levels < 4 || levels > 8 || pieces < 4 || pieces > 24) return null;
    const cfg = { levels, pieces };
    for (const k of ['ornaments', 'ornActive', 'decor', 'ornWin']) if (c[k] !== undefined) cfg[k] = c[k] | 0;
    return cfg;
  }

  function applyAction(Logic, s, a) {
    if (!a || typeof a !== 'object') throw new Error('bad action');
    if (a.k === 'orn') return Logic.placeOrnament(s, a.i | 0).state;
    if (a.k === 'play') return Logic.play(s, a.i | 0, !!a.c).state;
    if (a.k === 'line') return Logic.chooseLine(s, a.i | 0).state;
    if (a.k === 'promote') return Logic.promote(s, a.i | 0).state;
    throw new Error('unknown action');
  }

  // Pure: events -> room state. Deterministic for any order and duplicates of the same event set.
  function replay(Logic, events) {
    const seen = new Map();
    for (const ev of events) if (ev && ev.id && !seen.has(ev.id)) seen.set(ev.id, ev);
    const evs = [...seen.values()].sort(byTime);
    const out = { cfg: null, host: null, guest: null, state: null, seq: 0, actions: [], rejected: 0 };
    const create = evs.find((e) => { const c = parse(e); return c && c.type === 'create' && sanitizeCfg(c.cfg); });
    if (!create) return out;
    out.host = create.pubkey;
    out.cfg = sanitizeCfg(parse(create).cfg);
    const join = evs.find((e) => e.pubkey !== out.host && (parse(e) || {}).type === 'join');
    out.guest = join ? join.pubkey : null;
    let st = Logic.newGame(out.cfg);
    const players = [out.host, out.guest];
    const moves = evs.filter((e) => { const c = parse(e); return c && c.type === 'move' && Number.isInteger(c.seq); });
    for (let seq = 0; ; seq++) {
      if (st.phase === 'over') break;
      let applied = false;
      for (const e of moves) {
        const c = parse(e);
        if (c.seq !== seq) continue;
        if (e.pubkey !== players[st.turn]) { out.rejected++; continue; }
        try { st = applyAction(Logic, st, c.a); out.actions.push(c.a); applied = true; break; } catch (err) { out.rejected++; }
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
      this.sub = null;
      this.relayOk = new Set();
      this.joinSent = false;
      this.timer = null;
    }
    sign(content) {
      return this.N.finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', tagFor(this.room)]], content: JSON.stringify(Object.assign({ v: VERSION }, content)) }, this.sk);
    }
    publish(content) {
      const ev = this.sign(content);
      this.events.set(ev.id, ev);          // optimistic: count our own event immediately
      this.changed();
      const ps = this.pool.publish(this.relays, ev);
      ps.forEach((p, k) => p.then(() => this.relayOk.add(this.relays[k])).catch(() => {}));
      return ev;
    }
    open(room) {
      if (!ROOM_RE.test(room)) throw new Error('bad room id');
      this.close();
      this.room = room;
      this.joinSent = false;
      this.sub = this.pool.subscribe(this.relays, { kinds: [KIND], '#t': [tagFor(room)], limit: 2000 }, {
        onevent: (ev) => { if (!this.events.has(ev.id)) { this.events.set(ev.id, ev); this.changed(); } },
        oneose: () => { this.eose = true; this.changed(); },
      });
    }
    create(cfg) {
      const room = newRoomId();
      this.open(room);
      this.publish({ type: 'create', cfg });
      return room;
    }
    close() { if (this.sub) { this.sub.close(); this.sub = null; } this.events.clear(); this.room = null; this.eose = false; }
    changed() { clearTimeout(this.timer); this.timer = setTimeout(() => this.onChange(this.view()), 40); }
    view() {
      const r = replay(this.Logic, [...this.events.values()]);
      r.me = this.pubkey;
      r.myIdx = r.host === this.pubkey ? 0 : r.guest === this.pubkey ? 1 : null;
      // Auto-join as the second player when the seat is free.
      if (r.host && r.host !== this.pubkey && !r.guest && !this.joinSent) { this.joinSent = true; this.publish({ type: 'join' }); }
      return r;
    }
    sendMove(seq, a) { return this.publish({ type: 'move', seq, a }); }
  }

  const api = { KIND, VERSION, DEFAULT_RELAYS, tagFor, replay, applyAction, sanitizeCfg, newRoomId, Client, ROOM_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoopOnline = api;
})(typeof window !== 'undefined' ? window : globalThis);
