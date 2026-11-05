"""Online rooms with a square board and ghosts, in real browsers (Firefox and Chromium) over an in-process fake Nostr relay.
Nothing reaches a real relay: any other WebSocket or HTTP request is refused and recorded.
Run from repo root: python test/online_square_ghost_browser_test.py"""
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

def run(engine, p):
    br = getattr(p, engine).launch()
    relay, ctxs, errs, blocked = FakeRelay(), [], [], []
    def page():
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
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

    # ---- host: square + ghost room ----
    A = page(); A.goto(URL + "?relays=wss://fake.relay.test"); A.wait_for_function("window.__boop")
    A.select_option("#boardKind", "square"); A.select_option("#ghost", "on"); A.select_option("#size", "7"); idle(A)
    ok(A.evaluate("__boop.state.N") == 7 and A.evaluate("__boop.state.ghost"), f"{E}: host prepared a 7x7 ghost game")
    A.click("#onlineBtn"); A.click("#createRoom")
    A.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.host === __boop.net.pubkey", timeout=15000)
    link = A.input_value("#roomLink")
    ok("room=b3." in link, f"{E}: a 2-player square room uses the b3 invitation")
    create = relay.contents("create")[-1]
    ok(create["v"] == 3 and create["cfg"] == {"shape": "square", "size": 7, "pieces": 10, "players": 2, "ghost": True}, f"{E}: create event carries the square/ghost config {create['cfg']}")
    B = page(); B.goto(link); B.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx === 1", timeout=15000)
    A.wait_for_function("__boop.net.view.ready === true", timeout=15000); B.wait_for_function("__boop.net.view.ready === true", timeout=15000)
    A.click("#onlineDlg form button")
    ok(B.evaluate("__boop.state.shape") == "square" and B.evaluate("__boop.state.N") == 7 and B.evaluate("__boop.state.ghost") is True and B.locator("#sizeBox").is_visible(), f"{E}: the guest's board follows the room (7x7 square with ghosts)")
    ok(B.locator("#boardKind").input_value() == "square" and B.locator("#size").input_value() == "7" and B.locator("#ghost").input_value() == "on", f"{E}: the guest's selectors show the room's configuration")
    ok(B.locator(".tier").count() == 0 and B.locator(".cell").count() == 49, f"{E}: guest draws 49 square cells")

    # ---- play: host piece -> host ghost decision -> guest piece -> guest keeps ghost ----
    A.locator('.cell[data-idx="24"]').evaluate("e => e.click()"); idle(A); sync([A, B], 1)
    ok(A.evaluate("__boop.state.phase") == "ghost" and B.evaluate("__boop.state.phase") == "ghost", f"{E}: both clients wait for the host's ghost decision")
    ok(A.locator(".stitch").count() == 24 and B.locator(".stitch").count() == 0, f"{E}: only the host sees the 24 entry stitches (7x7)")
    ok(B.locator("#skipGhost").count() == 0 and "Waiting" in B.inner_text("#status"), f"{E}: the guest just waits ({B.inner_text('#status')[:60]!r})")
    A.locator('.stitch[data-id="3"]').click(); idle(A); sync([A, B], 2)
    ok(B.locator('.spirit[data-p="0"]').count() == 1 and B.evaluate("__boop.state.ghosts[0].on"), f"{E}: the guest sees the host's ghost")
    ok(same([A, B]), f"{E}: boards identical after the ghost placement")
    B.locator('.cell[data-idx="40"]').evaluate("e => e.click()"); idle(B); sync([A, B], 3)
    B.wait_for_function("document.querySelectorAll('.stitch').length > 0", timeout=5000)
    ok(B.locator(".stitch").count() == 23 and B.locator("#skipGhost").is_visible() and A.locator(".stitch").count() == 0, f"{E}: the guest decides about their ghost and may not use the host ghost's occupied stitch ({B.locator('.stitch').count()}, {B.locator('#skipGhost').count()}, {A.locator('.stitch').count()}, {B.evaluate('__boop.state.phase')}, {B.evaluate('__boop.state.turn')})")
    B.locator("#skipGhost").click(); idle(B); sync([A, B], 4)
    ok(B.evaluate("__boop.state.ghosts[1].on") is False and B.evaluate("__boop.state.turn") == 0, f"{E}: the guest kept the ghost in the pool and the turn returned to the host")
    ok(A.evaluate("__boop.state.ghosts[0].t") == 0, f"{E}: the host ghost has not moved yet")
    A.locator('.cell[data-idx="48"]').evaluate("e => e.click()"); idle(A); sync([A, B], 5)
    ok(A.evaluate("__boop.state.ghosts[0].t") == 1 and B.evaluate("__boop.state.ghosts[0].t") == 1, f"{E}: the host ghost stepped on at the end of the host's turn on both clients")
    ok(same([A, B]), f"{E}: boards identical after the ghost step")
    kinds = [m["a"]["k"] for m in relay.contents("move")]
    ok(kinds == ["play", "ghost", "play", "skip", "play"], f"{E}: move events carry ghost/skip actions {kinds}")
    ok(relay.contents("move")[1]["a"] == {"k": "ghost", "i": 3} and relay.contents("move")[3]["a"] == {"k": "skip"}, f"{E}: canonical wire form of ghost and skip")

    # ---- reload in the middle of a ghost decision; a spectator ----
    B.locator('.cell[data-idx="41"]').evaluate("e => e.click()"); idle(B); sync([A, B], 6)
    ok(B.evaluate("__boop.state.phase") == "ghost", f"{E}: guest is deciding about the ghost again")
    B.reload(); B.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx === 1 && __boop.net.seq === 6 && !__boop.busy", timeout=20000)
    B.wait_for_timeout(300)
    ok(B.evaluate("__boop.state.phase") == "ghost" and B.locator(".stitch").count() == 24, f"{E}: after a reload the guest is still in the ghost decision")
    ok(len(relay.contents("join")) == 1 and len(relay.contents("admit")) == 1, f"{E}: the reload requested and admitted nobody")
    C = page(); C.goto(link); C.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.seq === 6 && !__boop.busy", timeout=20000)
    C.wait_for_timeout(300)
    ok(C.evaluate("__boop.net.view.myIdx") is None and C.locator(".stitch").count() == 0 and C.locator(".cell").evaluate_all("els => els.every(e => e.disabled)"), f"{E}: a spectator sees the game but cannot act")
    ok(same([A, B, C]), f"{E}: host, guest and spectator replay the same game")
    B.locator('.stitch[data-id="9"]').click(); idle(B); sync([A, B, C], 7)
    ok(A.locator(".spirit").count() == 2 and same([A, B, C]), f"{E}: both ghosts are on the board for everyone")
    ok(all(pg.evaluate("workerCount") == 0 for pg in (A, B, C)), f"{E}: online rooms never start the computer")
    # a 3-player square room (no ghosts)
    D = page(); D.goto(URL + "?relays=wss://fake.relay.test"); D.wait_for_function("window.__boop")
    D.select_option("#boardKind", "square"); D.select_option("#players", "3"); idle(D)
    D.click("#onlineBtn"); D.click("#createRoom"); D.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.host", timeout=15000)
    ok("room=b3." in D.input_value("#roomLink") and D.evaluate("__boop.net.view.players") == 3 and D.evaluate("__boop.state.shape") == "square", f"{E}: 3-player square room is b3 with 3 seats")
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
