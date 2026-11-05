"""Online rooms with Boopmas spirits and Shuffle powers, in real browsers (Firefox and Chromium) over an in-process fake Nostr relay.
Nothing reaches a real relay: any other WebSocket or HTTP request is refused and recorded.
Run from repo root: python test/online_powers_browser_test.py"""
import functools, http.server, json, pathlib, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

class FakeRelay:
    def __init__(self):
        self.events, self.subs, self.external = [], [], []
    def match(self, f, e):
        if "kinds" in f and e["kind"] not in f["kinds"]: return False
        if "#t" in f and not any(t[0] == "t" and t[1] in f["#t"] for t in e["tags"]): return False
        return True
    def handler(self, ws):
        if not ws.url.startswith("wss://fake.relay.test"):
            self.external.append(ws.url); ws.close(); return
        def on_msg(raw):
            m = json.loads(raw)
            if m[0] == "EVENT":
                e = m[1]
                if all(x["id"] != e["id"] for x in self.events):
                    self.events.append(e)
                    for w, sid, fs in list(self.subs):
                        if any(self.match(f, e) for f in fs):
                            try: w.send(json.dumps(["EVENT", sid, e]))
                            except Exception: pass
                ws.send(json.dumps(["OK", e["id"], True, ""]))
            elif m[0] == "REQ":
                sid, fs = m[1], m[2:]
                self.subs.append((ws, sid, fs))
                for e in list(self.events):
                    if any(self.match(f, e) for f in fs): ws.send(json.dumps(["EVENT", sid, e]))
                ws.send(json.dumps(["EOSE", sid]))
            elif m[0] == "CLOSE":
                self.subs = [s for s in self.subs if not (s[0] is ws and s[1] == m[1])]
        ws.on_message(on_msg)
    def contents(self, kind):
        return [json.loads(e["content"]) for e in self.events if json.loads(e["content"])["type"] == kind]

INIT = "localStorage.setItem('boop-augmented-seen-rules-v1','1')"
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "docs")))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{server.server_port}/"
fails = []
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)
def idle(pg, t=20000): pg.wait_for_function("window.__boop && !window.__boop.busy", timeout=t)
def sync(pages, seq):
    for pg in pages: pg.wait_for_function(f"__boop.net && __boop.net.seq === {seq} && !__boop.busy", timeout=20000)
def same(pages): return len({pg.evaluate("JSON.stringify(__boop.state)") for pg in pages}) == 1
def click(pg, idx): pg.locator(f'.cell[data-idx="{idx}"]').evaluate("e => e.click()")

# a deterministic opening, found by the page's own rules: random plain moves until the first graduation hands over the spirit board
FIND = """(cfg) => {
  const L = BoopLogic; let seed = 3; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let best = null;
  for (let tries = 0; tries < 800; tries++) {
    let s = L.newGame(cfg); const acts = [];
    for (let k = 0; k < 60 && s.phase !== 'over' && (!best || acts.length < best.acts.length); k++) {
      let a;
      if (s.phase === 'ornament') { const c = L.ornamentCells(s); a = { k: 'orn', i: c[Math.floor(rnd() * c.length)] }; s = L.placeOrnament(s, a.i).state; }
      else if (s.phase === 'place') { const m = L.legalMoves(s); const mv = m[Math.floor(rnd() * m.length)]; a = { k: 'play', i: mv.idx, c: mv.cat }; s = L.play(s, mv.idx, mv.cat).state; }
      else break;
      acts.push(a);
      if (s.spirits && s.spirits.holder !== null) { if (s.phase === 'place') best = { acts, holder: s.spirits.holder, turn: s.turn }; break; }
    }
  }
  return best;   // the shortest opening found: fewer pieces on the tree, so no promotion gets in the way
}"""

def run(engine, p):
    br = getattr(p, engine).launch()
    relay, ctxs, errs, blocked = FakeRelay(), [], [], []
    def page():
        ctx = br.new_context(viewport={"width": 1200, "height": 950}, reduced_motion="reduce")
        ctxs.append(ctx); ctx.add_init_script(INIT)
        ctx.add_init_script("window.workerCount = 0; const W = window.Worker; window.Worker = class extends W { constructor(...a) { super(...a); workerCount++; } };")
        def route(r):
            if r.request.url.startswith(URL): r.continue_()
            else: blocked.append(r.request.url); r.abort()
        ctx.route("**/*", route)
        ctx.route_web_socket("**", relay.handler)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        return pg
    E = engine
    def host_page():
        A = page(); A.goto(URL + "?relays=wss://fake.relay.test"); A.wait_for_function("window.__boop")
        return A
    def create(A):
        A.click("#onlineBtn"); A.click("#createRoom")
        A.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.host === __boop.net.pubkey", timeout=15000)
        return A.input_value("#roomLink")
    def guest(link, seat):
        B = page(); B.goto(link); B.wait_for_function(f"__boop.net && __boop.net.view && __boop.net.view.myIdx === {seat}", timeout=30000)
        return B

    # ================= Boopmas tree, 2 players =================
    A = host_page()
    A.select_option("#mode", "pvp"); A.select_option("#boopmas", "on"); idle(A)
    link = create(A)
    ok("room=b3." in link, f"{E}: a 2-player Boopmas room uses the b3 invitation")
    create_ev = relay.contents("create")[-1]
    ok(create_ev["v"] == 3 and create_ev["cfg"].get("boopmas") is True and create_ev["cfg"]["levels"] == 4 and create_ev["cfg"]["players"] == 2, f"{E}: the create event carries boopmas {create_ev['cfg']}")
    B = guest(link, 1)
    A.wait_for_function("__boop.net.view.ready === true", timeout=15000); B.wait_for_function("__boop.net.view.ready === true", timeout=15000)
    A.click("#onlineDlg form button")
    ok(B.evaluate("__boop.state.boopmas") is True and B.locator("#boopmas").input_value() == "on" and B.locator("#spiritBar").is_visible() and B.locator("#boopmasBox").is_visible(), f"{E}: the guest's board and selectors follow the room (Boopmas on, spirit bar shown)")
    ok(A.locator("#spiritBar button").evaluate_all("els => els.every(e => e.disabled)") and B.locator("#spiritBar button").evaluate_all("els => els.every(e => e.disabled)"), f"{E}: nobody holds the spirit board yet")
    plan = A.evaluate(FIND, B.evaluate("({levels: __boop.state.L, pieces: __boop.state.n, players: __boop.state.players, ornaments: __boop.state.ornaments, ornActive: __boop.state.ornActive, decor: __boop.state.decor, boopmas: true})"))
    ok(plan is not None, f"{E}: found an opening that reaches the first graduation ({len(plan['acts'])} actions)")
    pages = [A, B]; seq = 0
    for a in plan["acts"]:
        turn = A.evaluate("__boop.state.turn"); pg = pages[turn]
        if a["k"] == "orn": click(pg, a["i"])
        else:
            pg.click(f"#panel{turn} .pick[data-cat=\"{1 if a['c'] else 0}\"]"); click(pg, a["i"])
        seq += 1; idle(pg); sync([A, B], seq)
    holder = plan["holder"]; H, O = pages[holder], pages[1 - holder]
    ok(A.evaluate("__boop.state.spirits.holder") == holder and A.evaluate("__boop.state.turn") == holder and same([A, B]), f"{E}: the graduation handed the spirit board to seat {holder}, who is on turn; both clients agree")
    ok(H.locator("#spiritBar button:not([disabled])").count() == 3 and O.locator("#spiritBar button:not([disabled])").count() == 0, f"{E}: only the holder can choose a spirit")
    # Psst Psst first (any empty cell is fine), sent through the room
    free = A.evaluate("BoopLogic.legalMoves(__boop.state)[0].idx")
    H.click("#spiritBar button[data-g='0']"); click(H, free); idle(H); seq += 1; sync([A, B], seq)
    ok(A.evaluate("__boop.state.spirits.used") == [True, False, False] and same([A, B]), f"{E}: Psst Psst travelled through the relay and both boards agree")
    mv = relay.contents("move")[-1]
    ok(mv["a"] == {"k": "play", "i": free, "c": False, "g": 0}, f"{E}: canonical wire form of a spirit move {mv['a']}")
    ok(O.locator("#spiritBar button:not([disabled])").count() == 0, f"{E}: the other seat still cannot use spirits")
    def resolve():
        """Finish golden-rule ornaments, promotions and line choices so that a plain placement is next."""
        nonlocal seq
        for _ in range(6):
            ph = A.evaluate("__boop.state.phase"); pg = pages[A.evaluate("__boop.state.turn")]
            if ph == "ornament": click(pg, pg.evaluate("BoopLogic.ornamentCells(__boop.state)[0]"))
            elif ph == "promote": click(pg, pg.evaluate("__boop.state.b.findIndex(q => q && q.p === __boop.state.turn && q.kind !== 'o')"))
            elif ph == "chooseLine": click(pg, pg.evaluate("__boop.state.options[0][0]"))
            else: return
            idle(pg); seq += 1; sync([A, B], seq)
    # the other seat plays a plain move (after any golden-rule ornament or promotion); then the holder aims Meowly
    resolve()
    ok(A.evaluate("__boop.state.phase") == "place", f"{E}: the next turn is a plain placement")
    pg_turn = pages[A.evaluate("__boop.state.turn")]
    ofree = A.evaluate("BoopLogic.legalMoves(__boop.state)[0].idx")
    click(pg_turn, ofree); idle(pg_turn); seq += 1; sync([A, B], seq)
    resolve()
    info = A.evaluate("""(() => { const s = __boop.state; for (const m of BoopLogic.legalMoves(s)) { const sp = BoopLogic.legalSpirits(s, m.idx).find(x => x.g === 2); if (sp) { const d = BoopLogic.legalSpirits(s, m.idx).find(x => x.g === 2).d; const D = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]][d]; return [m.idx, m.idx + D[0] * s.N + D[1], d]; } } return null; })()""")
    ok(info is not None, f"{E}: a Meowly aim exists on the board")
    H.click("#spiritBar button[data-g='2']"); click(H, info[0]); H.wait_for_function("__boop.aim"); click(H, info[1]); idle(H); seq += 1; sync([A, B], seq)
    ok(A.evaluate("__boop.state.spirits.used") == [True, False, True] and same([A, B]), f"{E}: Jacob Meowly with an aimed direction travelled too")
    mv = relay.contents("move")[-1]
    ok(mv["a"] == {"k": "play", "i": info[0], "c": False, "g": 2, "d": info[2]}, f"{E}: canonical wire form of a Meowly move {mv['a']}")
    # a spectator and a reload
    B.reload(); B.wait_for_function(f"__boop.net && __boop.net.view && __boop.net.view.myIdx === 1 && __boop.net.seq === {seq} && !__boop.busy", timeout=20000)
    B.wait_for_timeout(300)
    ok(B.evaluate("__boop.state.spirits.used") == [True, False, True] and len(relay.contents("join")) == 1, f"{E}: a reload rebuilds the spirit board from the events without a new join")
    C = page(); C.goto(link); C.wait_for_function(f"__boop.net && __boop.net.view && __boop.net.view.seq === {seq} && !__boop.busy", timeout=20000); C.wait_for_timeout(300)
    ok(C.evaluate("__boop.net.view.myIdx") is None and C.locator("#spiritBar button:not([disabled])").count() == 0 and C.locator(".cell").evaluate_all("els => els.every(e => e.disabled)"), f"{E}: a spectator sees the spirit board but cannot act")
    ok(same([A, B, C]), f"{E}: host, guest and spectator replay the same game")
    ok(all(pg.evaluate("workerCount") == 0 for pg in (A, B, C)), f"{E}: online rooms never start the computer")

    # ================= Shuffle square, 2 players =================
    A2 = host_page()
    A2.select_option("#mode", "pvp"); A2.select_option("#boardKind", "shuffle"); idle(A2)
    link2 = create(A2)
    cr = relay.contents("create")[-1]
    ok("room=b3." in link2 and cr["cfg"] == {"shape": "square", "size": 6, "pieces": 8, "players": 2, "shuffle": True}, f"{E}: a Shuffle room is b3 and carries shuffle {cr['cfg']}")
    B2 = guest(link2, 1)
    A2.wait_for_function("__boop.net.view.ready === true", timeout=15000); B2.wait_for_function("__boop.net.view.ready === true", timeout=15000)
    A2.click("#onlineDlg form button")
    ok(B2.evaluate("__boop.state.shuffle") is True and B2.locator("#boardKind").input_value() == "shuffle" and B2.locator("#ghostBox").is_hidden() and B2.locator("#boopmasBox").is_hidden(), f"{E}: the guest's selectors show the Shuffle board")
    ok(B2.locator("#panel1 .pick.small").count() == 6 and B2.locator("#panel1 .pick.small:not([disabled])").count() == 0 and A2.locator("#panel0 .pick.small:not([disabled])").count() == 3, f"{E}: only the player on turn can pick power pieces (super, scaredy and wild kitten; no cats, and no blankie while the board is empty)")
    pg2 = [A2, B2]; seq = 0
    def move(piece, cell, label):
        nonlocal seq
        turn = A2.evaluate("__boop.state.turn"); pg = pg2[turn]
        pg.click(f"#panel{turn} .pick[data-piece='{piece}']"); click(pg, cell); idle(pg); seq += 1; sync([A2, B2], seq)
        ok(same([A2, B2]), f"{E}: boards identical after {label}")
    move("kw", 14, "the host's wild kitten")
    ok(B2.evaluate("__boop.state.b[14].x") == "w" and B2.locator(".piece[data-x='w']").count() == 1 and B2.evaluate("__boop.state.wild.k") == 1, f"{E}: the guest sees the wild piece")
    move("ks", 0, "the guest's super kitten")
    move("ka", 35, "the host's scaredy kitten")
    # the guest puts the host's wild piece to sleep with the blankie
    B2.click("#panel1 .pick[data-piece='b']")
    ok(B2.locator(".cell.allowed").count() == 3, f"{E}: the blankie shows every awake piece ({B2.locator('.cell.allowed').count()})")
    click(B2, 14); idle(B2); seq += 1; sync([A2, B2], seq)
    ok(A2.locator(".piece.napping").count() == 1 and A2.evaluate("__boop.state.b[14].cov") == {"p": 1} and same([A2, B2]), f"{E}: the sleeper is asleep for both players")
    move("k", 33, "a plain host kitten")
    kinds = [(m["a"].get("x"), m["a"].get("g")) for m in relay.contents("move")[-5:]]
    ok(kinds == [("w", None), ("s", None), ("a", None), ("b", None), (None, None)], f"{E}: move events carry the power field {kinds}")
    ok(relay.contents("move")[-2]["a"] == {"k": "play", "i": 14, "c": False, "x": "b"}, f"{E}: canonical wire form of the blankie {relay.contents('move')[-2]['a']}")
    ok(B2.evaluate("__boop.state.pool[1].b") == 0 and B2.evaluate("__boop.state.pool[1].ks") == 0 and B2.evaluate("__boop.state.pool[0].ka") == 0, f"{E}: pools reflect the spent powers")
    A2.reload(); A2.wait_for_function(f"__boop.net && __boop.net.view && __boop.net.view.myIdx === 0 && __boop.net.seq === {seq} && !__boop.busy", timeout=20000); A2.wait_for_timeout(300)
    ok(A2.evaluate("__boop.state.b[14].cov") == {"p": 1} and A2.locator(".piece.napping").count() == 1 and same([A2, B2]), f"{E}: the host's reload rebuilds wild, super, scaredy and the sleeper from the events")

    # ================= 3-player Shuffle and 3-player Boopmas rooms =================
    for label, setup in (("Shuffle", lambda pg: (pg.select_option("#boardKind", "shuffle"), pg.select_option("#players", "3"))), ("Boopmas", lambda pg: (pg.select_option("#boopmas", "on"), pg.select_option("#players", "3")))):
        H3 = host_page(); H3.select_option("#mode", "pvp"); setup(H3); idle(H3)
        l3 = create(H3)
        ok("room=b3." in l3 and H3.evaluate("__boop.net.view.players") == 3, f"{E}: a 3-player {label} room is b3 with 3 seats")
        G1 = guest(l3, 1); G2 = guest(l3, 2)
        for pg in (H3, G1, G2): pg.wait_for_function("__boop.net.view.ready === true", timeout=15000)
        H3.click("#onlineDlg form button")
        first = H3.evaluate("BoopLogic.ornamentCells ? (__boop.state.phase === 'ornament' ? BoopLogic.ornamentCells(__boop.state)[0] : -1) : -1")
        trio = [H3, G1, G2]; s3 = 0
        for k in range(3):
            turn = H3.evaluate("__boop.state.turn"); pg = trio[turn]
            if pg.evaluate("__boop.state.phase") == "ornament": click(pg, pg.evaluate("BoopLogic.ornamentCells(__boop.state)[0]")); idle(pg); s3 += 1; sync(trio, s3)
            click(pg, pg.evaluate("BoopLogic.legalMoves(__boop.state)[0].idx")); idle(pg); s3 += 1; sync(trio, s3)
        ok(same(trio) and H3.evaluate("__boop.state.moves") == 3, f"{E}: all three seats of a {label} room replay the same game after one round")
    ok(not relay.external and not blocked, f"{E}: no real relay or external request {relay.external + blocked}")
    ok(not errs, f"{E}: no page errors {errs}")
    for c in ctxs: c.close()
    br.close()

try:
    with sync_playwright() as p:
        for engine in ("firefox", "chromium"):
            run(engine, p)
finally:
    server.shutdown(); server.server_close()
print("RESULT", "FAIL" if fails else "PASS")
raise SystemExit(1 if fails else 0)
