"""Local 2/3/4-player UI test (shared device and computer seats), Firefox, no external network.
Run from repo root: python test/multiplayer_browser_test.py"""
import json, pathlib, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(ROOT / "docs")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
URL = f"http://127.0.0.1:{PORT}/index.html"
fails = []
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

INIT = "localStorage.setItem('boop-augmented-seen-rules-v1','1')"
def idle(pg, extra="", t=20000):
    pg.wait_for_function(f"window.__boop && !window.__boop.busy {extra}", timeout=t)
def visible_panels(pg):
    return pg.evaluate("[0,1,2,3].filter(i => !document.getElementById('panel'+i).hidden && getComputedStyle(document.getElementById('panel'+i)).display !== 'none')")

try:
    for _ in range(50):
        try: socket.create_connection(("127.0.0.1", PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    with sync_playwright() as p:
        br = p.firefox.launch()
        blocked = []
        def make(vp=None, reduced=True):
            ctx = br.new_context(viewport=vp or {"width": 1300, "height": 900}, reduced_motion="reduce" if reduced else "no-preference")
            ctx.add_init_script(INIT)
            def route(r):
                if r.request.url.startswith(f"http://127.0.0.1:{PORT}/"): r.continue_()
                else: blocked.append(r.request.url); r.abort()
            ctx.route("**/*", route)
            ctx.route_web_socket("**", lambda ws: ws.close())
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            return ctx, pg, errs
        allerrs = []

        # ---- 2-player default is untouched ----
        ctx, pg, errs = make(); allerrs.append(errs)
        pg.goto(URL); pg.wait_for_function("window.__boop")
        ok(pg.evaluate("__boop.state.players") == 2 and visible_panels(pg) == [0, 1], "default game has 2 players and 2 panels")
        ok(pg.locator("#players").input_value() == "2", "players selector shows 2")
        ok(not pg.evaluate("document.querySelector('.layout').classList.contains('multi')"), "2-player layout keeps the original single row")

        # ---- 3 players on a shared device ----
        pg.select_option("#mode", "pvp"); pg.select_option("#players", "3"); idle(pg)
        st = pg.evaluate("__boop.state")
        ok(st["players"] == 3 and len(st["pool"]) == 3 and len(st["captured"]) == 3, "3-player game created")
        ok(visible_panels(pg) == [0, 1, 2], "3 panels visible")
        pcs = pg.evaluate("[0,1,2].map(i => getComputedStyle(document.getElementById('panel'+i)).getPropertyValue('--pc').trim())")
        ok(len(set(pcs)) == 3, f"each seat has its own colour {pcs}")
        names = [pg.inner_text(f"#panel{i} h2") for i in range(3)]
        ok(names == ["Snowball", "Coal", "Frost"], f"seat names {names}")
        order = []
        for t in range(6):
            turn = pg.evaluate("__boop.state.turn"); order.append(turn)
            ok(pg.evaluate(f"document.getElementById('panel{turn}').classList.contains('active')"), f"turn {t}: seat {turn} panel is highlighted")
            ok(pg.evaluate("document.querySelector('#status b').className") == f"p{turn}", f"turn {t}: status names seat {turn}")
            if pg.evaluate("__boop.state.phase") == "ornament":
                pg.locator(".cell.allowed").first.click(); idle(pg)
            free = pg.evaluate("""() => { const g = BoopLogic.geometry(__boop.state.L); return g.cells.filter(i => !__boop.state.b[i] && g.ring[i] === 3); }""")
            pg.click(f'.cell[data-idx="{free[(t * 3) % len(free)]}"]', force=True); idle(pg)
        ok(order == [0, 1, 2, 0, 1, 2], f"turns rotate in seat order {order}")
        owners = pg.evaluate("[...document.querySelectorAll('.piece')].map(e => e.dataset.p + ':' + e.dataset.n)")
        ok(set(owners) >= {"0:1", "1:2", "2:3"}, f"pieces carry owner and seat number {sorted(set(owners))}")
        ok(pg.evaluate("[...document.querySelectorAll('.piece')].every(e => e.dataset.n === String(+e.dataset.p + 1) && getComputedStyle(e, '::after').content !== 'none')"), "seat badge is generated from the owner's seat number on 3-player boards")
        ok(pg.evaluate("getComputedStyle(document.querySelector('.piece.kitten'), '::after').width") != "auto", "seat badge is laid out")
        # Reload restores the 3-player save and the selector follows it.
        pg.reload(); pg.wait_for_function("window.__boop")
        ok(pg.evaluate("__boop.state.players") == 3 and pg.locator("#players").input_value() == "3" and pg.evaluate("__boop.state.moves") == 6, "3-player save survives reload")

        # ---- 4 players ----
        pg.select_option("#players", "4"); idle(pg)
        ok(pg.evaluate("__boop.state.players") == 4 and visible_panels(pg) == [0, 1, 2, 3], "4 panels visible")
        ok(pg.inner_text("#panel3 h2") == "Ginger", "fourth seat is Ginger")
        ok(pg.evaluate("__boop.state.n") == 8, "Auto kittens stay 8 on the classic tree with 4 players")
        ok(pg.evaluate("[...document.querySelectorAll('#pieces option')].filter(o => o.disabled).map(o => o.value)") == ["12", "14", "16"], "kitten counts that would fill the 4-player board are disabled")
        pg.select_option("#pieces", "10"); idle(pg)
        ok(pg.evaluate("__boop.state.n") == 10, "10 kittens fit 4 players")
        pg.select_option("#players", "2"); pg.select_option("#pieces", "16"); idle(pg)
        ok(pg.evaluate("__boop.state.n") == 16 and visible_panels(pg) == [0, 1], "back to 2 players with 16 kittens")
        pg.select_option("#players", "4"); idle(pg)
        ok(pg.evaluate("__boop.state.n") == 10 and pg.evaluate("__boop.settings.pieces") == 10, "16 kittens falls back to the largest count that fits 4 players")
        pg.select_option("#pieces", "auto"); idle(pg)
        # Big tree with 4 players
        pg.select_option("#levels", "6"); idle(pg)
        ok(pg.evaluate("__boop.state.players") == 4 and pg.locator(".cell").count() == 117, "4 players on a 6-tier tree")
        pg.select_option("#levels", "4"); idle(pg)
        # 3D click with 4 players
        pg.select_option("#view", "3d"); pg.wait_for_timeout(300)
        pg.locator(".cell.allowed").first.click(force=True); idle(pg)
        ok(pg.evaluate("__boop.state.phase") == "place", "3D view works with 4 players")
        pg.select_option("#view", "2d")
        ok(pg.evaluate("__boop.state.winner") is None, "no stray winner")
        ctx.close()

        # ---- legacy save and hostile saves ----
        ctx, pg, errs = make(); allerrs.append(errs)
        pg.goto(URL); pg.wait_for_function("window.__boop")
        pg.evaluate("""() => {
          const s = BoopLogic.newGame({levels: 4, pieces: 8});            // exactly what the pre-multiplayer engine saved
          const p = BoopLogic.placeOrnament(s, 16).state; const q = BoopLogic.play(p, 38, false).state;
          delete q.players; delete q.ornaments;
          localStorage.setItem('boop-augmented-save-v1', JSON.stringify({state: q, history: [s, p].map(x => { const y = JSON.parse(JSON.stringify(x)); delete y.players; delete y.ornaments; return y; })}));
          localStorage.setItem('boop-augmented-settings-v1', JSON.stringify({mode: 'pvp', levels: 4, pieces: 8, view: '2d'}));   // no players key
        }""")
        pg.reload(); pg.wait_for_function("window.__boop")
        ok(pg.evaluate("__boop.state.players") == 2 and pg.evaluate("__boop.state.moves") == 1 and visible_panels(pg) == [0, 1], "pre-multiplayer save and settings load as a 2-player game")
        pg.click("#undo"); idle(pg)
        ok(pg.evaluate("__boop.state.moves") == 0 and pg.evaluate("__boop.state.b[38]") is None, "undo works on a restored legacy history")
        for label, mutate in [("5 players", "x.players = 5"), ("pool/seat mismatch", "x.pool.pop()"), ("turn out of range", "x.turn = 9"), ("foreign piece", "x.b[24] = {id: 5, p: 3, kind: 'k'}")]:
            pg.evaluate("(m) => { const x = JSON.parse(JSON.stringify(BoopLogic.newGame({players: 3}))); eval(m); localStorage.setItem('boop-augmented-save-v1', JSON.stringify({state: x, history: []})); }", mutate)
            pg.reload(); pg.wait_for_function("window.__boop")
            ok(pg.evaluate("__boop.state.players") == 2 and pg.evaluate("__boop.state.moves") == 0 and visible_panels(pg) == [0, 1], f"hostile save ({label}) is ignored, fresh game")
        pg.evaluate("localStorage.setItem('boop-augmented-settings-v1', JSON.stringify({mode: 'pvp', players: 9}))")
        pg.reload(); pg.wait_for_function("window.__boop")
        ok(pg.locator("#players").input_value() == "2", "invalid saved players setting falls back to 2")

        # ---- win by seat 3 ----
        pg.evaluate("""() => {
          const s = BoopLogic.newGame({levels: 4, pieces: 8, players: 4});
          s.b[5*7+1] = {id: 700, p: 3, kind: 'c'}; s.b[5*7+2] = {id: 701, p: 3, kind: 'c'}; s.pool[3].c = 1; s.pool[3].k = 6;
          s.turn = 3; s.phase = 'place';
          localStorage.setItem('boop-augmented-save-v1', JSON.stringify({state: s, history: []}));
          localStorage.setItem('boop-augmented-settings-v1', JSON.stringify({mode: 'pvp', players: 4, levels: 4, pieces: 8, view: '2d'}));
        }""")
        pg.reload(); pg.wait_for_function("window.__boop")
        pg.click('#panel3 .pick[data-cat="1"]')
        pg.click('.cell[data-idx="38"]'); idle(pg)
        ok(pg.evaluate("__boop.state.winner") == 3 and "Ginger" in pg.inner_text("#status") and "wins" in pg.inner_text("#status"), "seat 3 wins with three cats and the status names Ginger")
        ok(pg.locator(".cell").evaluate_all("els => els.every(e => e.disabled)"), "board locked after the win")
        ctx.close()

        # ---- computer seats ----
        ctx, pg, errs = make(); allerrs.append(errs)
        pg.add_init_script("window.workerUsed = 0; const W = window.Worker; window.Worker = class extends W { constructor(...a) { super(...a); workerUsed++; } };")
        pg.goto(URL); pg.wait_for_function("window.__boop")
        for P in (3, 4):
            pg.select_option("#mode", "cpu"); pg.select_option("#players", str(P)); idle(pg)
            ok(pg.evaluate("__boop.state.players") == P, f"vs Computer with {P} players")
            labels = [pg.inner_text(f"#panel{i} .who") for i in range(P)]
            ok("Player" in labels[0] and all("Computer" in l for l in labels[1:]), f"seat 0 is you, the other {P-1} are computers {labels}")
            pg.locator(".cell.allowed").first.click(); idle(pg)
            free = pg.evaluate("""() => { const g = BoopLogic.geometry(__boop.state.L); return g.cells.filter(i => !__boop.state.b[i] && g.ring[i] === 3); }""")
            pg.click(f'.cell[data-idx="{free[0]}"]', force=True)
            # all computer seats play in turn, then control returns to the human
            pg.wait_for_function(f"__boop.state.turn === 0 && __boop.state.moves >= {P} && !__boop.busy", timeout=60000)
            ok(pg.evaluate("__boop.state.moves") == P, f"{P} players: one placement per seat, then back to you (moves={pg.evaluate('__boop.state.moves')})")
            seats = pg.evaluate("[...new Set([...document.querySelectorAll('.piece')].map(e => e.dataset.p))].sort().join()")
            ok(set(seats.split(",")) >= {str(i) for i in range(1, P)}, f"{P} players: every computer seat has pieces on the tree ({seats})")
            ok(pg.evaluate("workerUsed") > 0, "computer search runs in a worker")
            # undo rewinds to the human's previous turn and does not leave a computer seat on turn
            before = pg.evaluate("__boop.state.moves")
            pg.click("#undo"); idle(pg)
            ok(pg.evaluate("__boop.state.turn") == 0 and pg.evaluate("__boop.state.moves") < before, f"{P} players: undo returns to your turn")
        # A computer game saved mid-way restores and resumes the computer chain.
        pg.locator(".cell.allowed, .cell:not([disabled])").first.click(force=True); idle(pg, "&& __boop.state.turn === 0", t=60000)
        pg.reload(); pg.wait_for_function("window.__boop")
        idle(pg, "&& __boop.state.turn === 0", t=60000)
        ok(pg.evaluate("__boop.state.players") == 4, "computer game with 4 players restored after reload")
        ctx.close()

        # ---- mobile layout ----
        ctx, pg, errs = make({"width": 390, "height": 844}); allerrs.append(errs)
        pg.goto(URL); pg.wait_for_function("window.__boop")
        pg.select_option("#mode", "pvp"); pg.select_option("#players", "4"); idle(pg)
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile: no horizontal overflow with 4 panels")
        boxes = [pg.locator(f"#panel{i}").bounding_box() for i in range(4)]
        ok(all(b and b["width"] > 100 for b in boxes) and boxes[0]["y"] < boxes[2]["y"] and abs(boxes[0]["y"] - boxes[1]["y"]) < 2, "mobile: panels in a 2x2 block above the board")
        bb = pg.locator("#board").bounding_box()
        ok(bb["y"] > boxes[2]["y"] and bb["x"] >= -1 and bb["x"] + bb["width"] <= 391, "mobile: board below the panels and inside the screen")
        ctx.close()
        ctx, pg, errs = make({"width": 1300, "height": 900}); allerrs.append(errs)
        pg.goto(URL); pg.wait_for_function("window.__boop")
        pg.select_option("#mode", "pvp"); pg.select_option("#players", "4"); idle(pg)
        b = [pg.locator(f"#panel{i}").bounding_box() for i in range(4)]
        bd = pg.locator("#boardWrap").bounding_box()
        ok(b[0]["x"] < bd["x"] < b[1]["x"] and b[2]["x"] < bd["x"] < b[3]["x"] and b[0]["y"] < b[2]["y"], "desktop: seats 0/2 left, 1/3 right of the board")
        pg.screenshot(path=str(ROOT / "test" / "screens" / "multi-4p-desktop.png"), full_page=True)
        ctx.close()
        ok(not blocked, f"no external requests {blocked}")
        ok(not [e for es in allerrs for e in es], f"no page errors {[e for es in allerrs for e in es]}")
        br.close()
finally:
    srv.kill()
print("RESULT", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)
