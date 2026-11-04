"""Two-browser online test with an in-process fake Nostr relay (nothing is sent to real relays).
Run from repo root: python test/online_browser_test.py"""
import json, re, socket, subprocess, sys, time, pathlib, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(ROOT / "docs")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
RELAY = "wss://fake.relay.test"
BASE = f"http://127.0.0.1:{PORT}/index.html?relays={RELAY}"
fails = []
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

class FakeRelay:
    """Minimal NIP-01 relay: stores EVENTs, answers REQ with stored matches + EOSE, pushes live matches."""
    def __init__(self):
        self.events, self.subs, self.lock = [], [], threading.Lock()
        self.real_attempts = []
    @staticmethod
    def match(f, e):
        if "kinds" in f and e["kind"] not in f["kinds"]: return False
        if "#t" in f and not any(t[0] == "t" and t[1] in f["#t"] for t in e["tags"]): return False
        return True
    def handler(self, ws):
        def on_msg(raw):
            msg = json.loads(raw)
            if msg[0] == "EVENT":
                e = msg[1]
                with self.lock:
                    new = all(x["id"] != e["id"] for x in self.events)
                    if new: self.events.append(e)
                    targets = [(w, sid) for (w, sid, fs) in self.subs if any(self.match(f, e) for f in fs)] if new else []
                ws.send(json.dumps(["OK", e["id"], True, ""]))
                for w, sid in targets:
                    try: w.send(json.dumps(["EVENT", sid, e]))
                    except Exception: pass
            elif msg[0] == "REQ":
                sid, fs = msg[1], msg[2:]
                with self.lock:
                    self.subs.append((ws, sid, fs))
                    stored = [e for e in self.events if any(self.match(f, e) for f in fs)]
                for e in stored: ws.send(json.dumps(["EVENT", sid, e]))
                ws.send(json.dumps(["EOSE", sid]))
            elif msg[0] == "CLOSE":
                with self.lock: self.subs = [x for x in self.subs if not (x[0] is ws and x[1] == msg[1])]
        ws.on_message(on_msg)

relay = FakeRelay()
def new_ctx(br):
    ctx = br.new_context(viewport={"width": 1200, "height": 850})
    ctx.add_init_script("localStorage.setItem('boop-augmented-seen-rules-v1','1')")
    ctx.route_web_socket(re.compile(r"^wss://fake\.relay\.test.*"), relay.handler)
    def block_real(ws):            # any other websocket = a real relay: refuse and record
        relay.real_attempts.append(ws.url); ws.close()
    ctx.route_web_socket(re.compile(r"^wss://(?!fake\.relay\.test).*"), block_real)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, pg, errs

def idle(pg, extra="", t=15000):
    pg.wait_for_function(f"window.__boop && !window.__boop.busy {extra}", timeout=t)

try:
    for _ in range(50):
        try: socket.create_connection(("127.0.0.1", PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    with sync_playwright() as p:
        br = p.firefox.launch()
        ca, A, ea = new_ctx(br)
        cb, B, eb = new_ctx(br)
        A.goto(BASE); A.wait_for_function("window.__boop")
        A.click("#onlineBtn"); A.click("#createRoom")
        A.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.host === __boop.net.pubkey", timeout=15000)
        link = A.input_value("#roomLink")
        ok("room=" in link and "relays=" in link, f"room link created ({link.split('?')[1]})")
        A.click("#onlineDlg form button")
        ok(A.evaluate("__boop.net.view.myIdx") == 0, "host plays Snowball")

        B.goto(link); B.wait_for_function("window.__boop")
        B.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.myIdx === 1", timeout=15000)
        ok(True, "guest joined as Coal")
        A.wait_for_function("__boop.net.view.guest !== null", timeout=15000)
        ok(True, "host sees the guest")

        # Snowball: ornament + kitten
        A.click('.cell[data-idx="16"]'); idle(A)
        A.click('.cell[data-idx="38"]'); idle(A)
        B.wait_for_function("__boop.net.seq === 2 && !__boop.busy", timeout=15000)
        ok(B.evaluate("__boop.state.b[38] && __boop.state.b[38].p") == 0, "guest sees host's kitten")
        ok(A.locator('.cell[data-idx="20"]').is_disabled(), "host cannot move on the guest's turn")
        # Coal: ornament + kitten that boops 38 -> 39
        B.click('.cell[data-idx="32"]'); idle(B)
        B.click('.cell[data-idx="37"]', force=True); idle(B)
        A.wait_for_function("__boop.net.seq === 4 && !__boop.busy", timeout=15000)
        bA = A.evaluate("__boop.state.b")
        ok(bA[39] and bA[39]["p"] == 0 and bA[37] and bA[37]["p"] == 1, "host sees the guest's boop")
        ok(A.evaluate("JSON.stringify(__boop.state.b)") == B.evaluate("JSON.stringify(__boop.state.b)"), "both boards identical")

        # Spectator
        cc, C, ec = new_ctx(br)
        C.goto(link)
        C.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.seq === 4 && !__boop.busy", timeout=15000)
        ok(C.evaluate("__boop.net.view.myIdx") is None, "third visitor watches")
        ok(C.evaluate("JSON.stringify(__boop.state.b)") == A.evaluate("JSON.stringify(__boop.state.b)"), "spectator sees the same board")
        ok("watching" in C.inner_text("#status"), "spectator status says watching")

        # Reload restores from the relay
        A.reload(); A.wait_for_function("__boop.net && __boop.net.view && __boop.net.view.seq === 4 && !__boop.busy", timeout=15000)
        ok(A.evaluate("JSON.stringify(__boop.state.b)") == B.evaluate("JSON.stringify(__boop.state.b)"), "reload rebuilds the game from relay events")
        A.click('.cell[data-idx="10"]'); idle(A)
        B.wait_for_function("__boop.net.seq === 5 && !__boop.busy", timeout=15000)
        ok(B.evaluate("__boop.state.b[10] && __boop.state.b[10].p") == 0, "play continues after reload")

        # Leave room -> back to local
        A.click("#onlineBtn"); A.click("#leaveRoom")
        A.wait_for_function("!__boop.net", timeout=5000)
        ok("room=" not in A.url, "leaving clears the room from the URL")
        A.screenshot(path=str(ROOT / "test" / "screens" / "online-local-after-leave.png"))
        B.screenshot(path=str(ROOT / "test" / "screens" / "online-guest.png"), full_page=True)
        ok(not relay.real_attempts, f"no real relay contacted {relay.real_attempts}")
        ok(not (ea + eb + ec), f"no page errors {ea + eb + ec}")
        ok(len(relay.events) == 1 + 1 + 5, f"relay holds create + join + 5 moves ({len(relay.events)})")
        br.close()
finally:
    srv.kill()
print("RESULT", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)
