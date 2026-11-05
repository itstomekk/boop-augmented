"""Online 3- and 4-player rooms in real browsers (Firefox and Chromium) over an in-process fake Nostr relay.
Nothing reaches a real relay: any other WebSocket or HTTP request is refused and recorded.
Run from repo root: python test/online_multi_browser_test.py"""
import functools, http.server, json, pathlib, re, threading
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
    def types(self, kind):
        return [e for e in self.events if json.loads(e["content"])["type"] == kind]

INIT = "localStorage.setItem('boop-augmented-seen-rules-v1','1')"
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "docs")))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{server.server_port}/"
fails = []
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

def idle(pg, t=20000): pg.wait_for_function("window.__boop && !window.__boop.busy", timeout=t)
def ring3_free(pg):
    return pg.evaluate("() => { const g = BoopLogic.geometry(__boop.state.L); return g.cells.filter(i => !__boop.state.b[i] && g.ring[i] === 3); }")

def run(engine, p):
    br = getattr(p, engine).launch()
    relay, ctxs, errs, blocked = FakeRelay(), [], [], []
    def page(vp=None):
        ctx = br.new_context(viewport=vp or {"width": 1200, "height": 900}, reduced_motion="reduce")
        ctxs.append(ctx); ctx.add_init_script(INIT)
        ctx.add_init_script("window.workerCount = 0; const W = window.Worker; window.Worker = class extends W { constructor(...a) { super(...a); workerCount++; } };")
        def route(r):
            if r.request.url.startswith(URL): r.continue_()
            else: blocked.append(r.request.url); r.abort()
        ctx.route("**/*", route)
        ctx.route_web_socket("**", relay.handler)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        return pg
    def play_rounds(pages, turns, label):
        """pages[i] = browser of seat i. Each turn: ornament if asked, then a kitten on a free outer cell."""
        for t in range(turns):
            seat = pages[0].evaluate("__boop.state.turn")
            mover = pages[seat]
            others = [pg for i, pg in enumerate(pages) if i != seat]
            ok(all(pg.locator(".cell").evaluate_all("els => els.every(e => e.disabled)") for pg in others), f"{engine} {label} turn {t}: only seat {seat} can click")
            seq = mover.evaluate("__boop.net.seq")
            if mover.evaluate("__boop.state.phase") == "ornament":
                mover.locator(".cell.allowed").first.click(); idle(mover); seq += 1
                for pg in pages: pg.wait_for_function(f"__boop.net.seq === {seq} && !__boop.busy", timeout=15000)
            free = ring3_free(mover)
            mover.click(f'.cell[data-idx="{free[(t * 5) % len(free)]}"]', force=True); idle(mover); seq += 1
            for pg in pages: pg.wait_for_function(f"__boop.net.seq === {seq} && !__boop.busy", timeout=15000)
    def same_board(pages):
        boards = {pg.evaluate("JSON.stringify(__boop.state)") for pg in pages}
        return len(boards) == 1

    # ---------------- 4 players ----------------
    A = page(); A.goto(URL + "?relays=wss://fake.relay.test"); A.wait_for_function("window.__boop")
    A.select_option("#players", "4"); idle(A)
    A.click("#onlineBtn"); A.click("#createRoom")
    A.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.host === __boop.net.pubkey", timeout=15000)
    link = A.input_value("#roomLink")
    ok("room=b3." in link and "relays=" in link, f"{engine} 4 players: invitation is b3")
    ok(A.evaluate("__boop.net.view.players") == 4 and A.evaluate("__boop.state.players") == 4, f"{engine} 4 players: room is a 4-seat game")
    ok(A.locator("#seatList li").count() == 4 and A.locator("#seatList li i").count() == 3, f"{engine} 4 players: seat list shows 3 open seats")
    ok("3 more" in A.inner_text("#status") or "Waiting for 3 more players" in A.inner_text("#status"), f"{engine} 4 players: host waits for 3 more players ({A.inner_text('#status')[:80]!r})")
    ok(A.locator(".cell").evaluate_all("els => els.every(e => e.disabled)"), f"{engine} 4 players: board locked until every seat is filled")
    guests = []
    for k in range(3):
        g = page(); g.goto(link); g.wait_for_function("window.__boop")
        g.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx !== null", timeout=15000)
        guests.append(g)
    A.wait_for_function("__boop.net.view.ready === true", timeout=15000)
    seats = [A.evaluate("__boop.net.view.myIdx")] + [g.evaluate("__boop.net.view.myIdx") for g in guests]
    ok(sorted(seats) == [0, 1, 2, 3] and seats[0] == 0, f"{engine} 4 players: distinct seats {seats}")
    ok(A.locator("#seatList li i").count() == 0 and "joined" in A.inner_text("#seatList"), f"{engine} 4 players: seat list shows everyone seated")
    for g in guests: g.wait_for_function("__boop.net.view.ready === true")
    A.click("#onlineDlg form button")
    ok(len(relay.types("admit")) == 3 and all(e["pubkey"] == A.evaluate("__boop.net.pubkey") for e in relay.types("admit")), f"{engine} 4 players: three host-signed admissions")
    pages = [None] * 4
    pages[0] = A
    for g in guests: pages[g.evaluate("__boop.net.view.myIdx")] = g
    ok(all("you are" in pg.inner_text("#status") for pg in pages), f"{engine} 4 players: status tells each player their seat")
    ok([pg.evaluate("document.querySelector('#panel' + __boop.net.view.myIdx + ' .who').innerText.includes('You')") for pg in pages] == [True] * 4, f"{engine} 4 players: own panel says You")
    play_rounds(pages, 8, "4p")
    ok(same_board(pages) and pages[0].evaluate("__boop.state.moves") == 8, f"{engine} 4 players: two full rounds, identical boards")
    ok(pages[0].evaluate("__boop.state.turn") == 0, f"{engine} 4 players: play wrapped around to seat 0")
    # a late visitor watches, sends nothing
    E = page(); E.goto(link); E.wait_for_function("window.__boop")
    seq8 = pages[0].evaluate("__boop.net.seq")
    E.wait_for_function(f"__boop.net && __boop.net.view && __boop.net.view.seq === {seq8} && !__boop.busy", timeout=15000)
    E.wait_for_timeout(300)
    ok(E.evaluate("__boop.net.view.myIdx") is None and "watching" in E.inner_text("#status"), f"{engine} 4 players: fifth visitor watches")
    ok(E.locator(".cell").evaluate_all("els => els.every(e => e.disabled)"), f"{engine} 4 players: spectator cannot click")
    ok(len(relay.types("join")) == 3 and len(relay.types("admit")) == 3, f"{engine} 4 players: full room, spectator sent no join, host admitted no more")
    ok(E.evaluate("JSON.stringify(__boop.state)") == pages[0].evaluate("JSON.stringify(__boop.state)"), f"{engine} 4 players: spectator sees the same game")
    # reload a guest (seat 2) and the host: both come back into their seats from relay history
    seat2 = pages[2]; seat2.reload(); seat2.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx === 2 && __boop.net.view.seq === " + str(seq8) + " && !__boop.busy", timeout=15000)
    pages[0].reload(); pages[0].wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx === 0 && __boop.net.view.seq === " + str(seq8) + " && !__boop.busy", timeout=15000)
    pages[0].wait_for_timeout(300)
    ok(len(relay.types("join")) == 3 and len(relay.types("admit")) == 3, f"{engine} 4 players: reloads re-admit and re-request nobody")
    play_rounds(pages, 4, "4p after reload")
    ok(same_board(pages + [E]) and pages[0].evaluate("__boop.state.moves") == 12, f"{engine} 4 players: play continues after reloads, all 5 boards identical")
    ok(all(pg.evaluate("workerCount") == 0 for pg in pages + [E]), f"{engine} 4 players: online rooms never start the computer")
    pages[1].screenshot(path=str(ROOT / "test" / "screens" / f"online-4p-{engine}.png"), full_page=True)
    # leaving returns to local play with the saved local game
    pages[3].click("#onlineBtn"); pages[3].click("#leaveRoom"); pages[3].wait_for_function("!__boop.net")
    ok("room=" not in pages[3].url and pages[3].evaluate("__boop.state.moves") == 0, f"{engine} 4 players: leaving returns to a local game")

    # ---------------- 3 players ----------------
    A3 = page(); A3.goto(URL + "?relays=wss://fake.relay.test"); A3.wait_for_function("window.__boop")
    A3.select_option("#players", "3"); idle(A3)
    A3.click("#onlineBtn"); A3.click("#createRoom")
    A3.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.host", timeout=15000)
    link3 = A3.input_value("#roomLink"); A3.click("#onlineDlg form button")
    ok("room=b3." in link3 and A3.evaluate("__boop.net.view.players") == 3, f"{engine} 3 players: b3 invitation, 3 seats")
    b3, c3 = page(), page()
    for g in (b3, c3):
        g.goto(link3); g.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx !== null", timeout=15000)
    A3.wait_for_function("__boop.net.view.ready === true", timeout=15000)
    p3 = [None] * 3; p3[0] = A3
    for g in (b3, c3): p3[g.evaluate("__boop.net.view.myIdx")] = g
    ok(None not in p3 and sorted(g.evaluate("__boop.net.view.myIdx") for g in p3) == [0, 1, 2], f"{engine} 3 players: seats 0-2 filled")
    play_rounds(p3, 6, "3p")
    ok(same_board(p3) and p3[0].evaluate("__boop.state.moves") == 6, f"{engine} 3 players: two rounds, identical boards")
    ok(p3[1].inner_text("#panel2 h2") == "Frost" and p3[1].locator("#panel3").is_hidden(), f"{engine} 3 players: three panels in the room view")

    # ---------------- 2 players still use the original format ----------------
    A2 = page(); A2.goto(URL + "?relays=wss://fake.relay.test"); A2.wait_for_function("window.__boop")
    A2.click("#onlineBtn"); A2.click("#createRoom")
    A2.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.host", timeout=15000)
    link2 = A2.input_value("#roomLink"); A2.click("#onlineDlg form button")
    ok("room=b2." in link2, f"{engine} 2 players: invitation is still b2")
    B2 = page(); B2.goto(link2); B2.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx === 1", timeout=15000)
    A2.wait_for_function("__boop.net.view.guest !== null", timeout=15000)
    create2 = [json.loads(e["content"]) for e in relay.types("create") if json.loads(e["content"])["v"] == 2]
    ok(len(create2) == 1 and "players" not in create2[0]["cfg"], f"{engine} 2 players: create event has the original v2 shape")
    ok(A2.locator("#panel2").is_hidden() and A2.locator("#panel3").is_hidden(), f"{engine} 2 players: two panels")

    ok(not relay.external and not blocked, f"{engine}: no real relay or external request {relay.external + blocked}")
    ok(not errs, f"{engine}: no page errors {errs}")
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
