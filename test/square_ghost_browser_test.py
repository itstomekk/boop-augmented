"""Square board + ghost variant UI test (Firefox and Chromium). No network: every non-local request is aborted and
recorded, WebSockets are closed, so no relay is ever contacted.
Run from repo root: python test/square_ghost_browser_test.py"""
import pathlib, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "test" / "screens"; SHOTS.mkdir(exist_ok=True)
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(ROOT / "docs")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
URL = f"http://127.0.0.1:{PORT}/index.html"
fails = []
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

INIT = "localStorage.setItem('boop-augmented-seen-rules-v1','1')"
def idle(pg, t=30000): pg.wait_for_function("window.__boop && !window.__boop.busy", timeout=t)
def click(pg, idx): pg.locator(f'.cell[data-idx="{idx}"]').evaluate("e => e.click()")
def seed(pg, js, settings):
    """Install a saved game (js builds the state from BoopLogic) plus settings, then reload."""
    pg.evaluate("""([js, settings]) => {
      const s = (new Function('L', js))(BoopLogic);
      localStorage.setItem('boop-augmented-save-v1', JSON.stringify({ state: s, history: [] }));
      localStorage.setItem('boop-augmented-settings-v1', JSON.stringify(settings));
    }""", [js, settings])
    pg.reload(); pg.wait_for_function("window.__boop")

SETTINGS = {"mode": "pvp", "board": "square", "size": 6, "ghost": True, "pieces": 8, "view": "2d"}
# seat 1 kitten (1,2) is scared over seat 0's kitten (1,1) to (1,0) when seat 0's ghost steps from row 0 to row 1
LEAP = ("const s = L.newGame({shape:'square',size:6,pieces:8,ghost:true}); s.phase='place'; s.turn=0; s.ghosts[0]={on:true,d:0,a:2,t:0};"
        "s.b[8]={id:501,p:1,kind:'k'}; s.b[7]={id:502,p:0,kind:'k'}; s.pool[1].k--; s.pool[0].k--; s.nextId=600; return s;")

def run(engine, p):
    br = getattr(p, engine).launch()
    blocked, errs, bad = [], [], []
    def make(vp=None, reduced=True):
        ctx = br.new_context(viewport=vp or {"width": 1300, "height": 900}, reduced_motion="reduce" if reduced else "no-preference")
        ctx.add_init_script(INIT)
        def route(r):
            if r.request.url.startswith(f"http://127.0.0.1:{PORT}/"): r.continue_()
            else: blocked.append(r.request.url); r.abort()
        ctx.route("**/*", route)
        ctx.route_web_socket("**", lambda ws: (blocked.append(ws.url), ws.close()))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("response", lambda r: bad.append((r.url, r.status)) if r.status >= 400 else None)
        pg.goto(URL); pg.wait_for_function("window.__boop")
        return ctx, pg
    E = engine

    # ---------------- default is untouched ----------------
    ctx, pg = make()
    ok(pg.evaluate("__boop.state.shape") == "tree" and pg.evaluate("__boop.state.N") == 7 and pg.locator(".cell").count() == 45, f"{E}: default game is still the classic 4-tier tree (45 cells)")
    ok(pg.locator("#boardKind").input_value() == "tree", f"{E}: board selector defaults to the tree")
    ok(pg.locator("#size").is_hidden() and pg.locator("#ghost").is_hidden() and pg.locator("#levels").is_visible() and pg.locator("#ornaments").is_visible(), f"{E}: square-only controls are hidden on the tree")
    ok(pg.locator(".tier").count() > 0 and pg.locator(".topstar").count() == 1 and not pg.evaluate("document.querySelector('#board').classList.contains('square')"), f"{E}: tree board draws tiers and the treetop")
    ok(pg.locator("#snow").is_visible(), f"{E}: the tree keeps its snow")
    ok(pg.evaluate("document.querySelector('#panel1 .pick[data-cat=\"1\"] svg').dataset.art") == "festive", f"{E}: tree cats keep their Santa hats")
    art = pg.evaluate("""() => {
      const w = [...document.querySelectorAll('#panel1 .pick svg [stroke-width]')].map(e => +e.getAttribute('stroke-width'));
      return { min: Math.min(...w), max: Math.max(...w), n: w.length };
    }""")
    ok(art["min"] >= 4 and art["max"] >= 6, f"{E}: cat art uses thick vector strokes {art}")
    ctx.close()

    # ---------------- square board, classic ----------------
    ctx, pg = make()
    pg.select_option("#mode", "pvp")
    pg.select_option("#boardKind", "square"); idle(pg)
    sq = pg.evaluate("({ shape: __boop.state.shape, N: __boop.state.N, L: __boop.state.L, ghost: __boop.state.ghost, orn: __boop.state.ornaments, n: __boop.state.n, players: __boop.state.players, phase: __boop.state.phase })")
    ok(sq == {"shape": "square", "N": 6, "L": 6, "ghost": False, "orn": 0, "n": 8, "players": 2, "phase": "place"}, f"{E}: choosing Square starts the 6x6 classic board {sq}")
    ok(pg.locator(".cell").count() == 36 and pg.locator(".tier").count() == 0 and pg.locator(".topstar").count() == 0, f"{E}: 36 cells, no tiers, no treetop star")
    ok(pg.evaluate("document.querySelector('#board').classList.contains('square')") and pg.locator(".slab").count() == 1, f"{E}: the square board is a flat bed/slab")
    ok(pg.locator("#size").is_visible() and pg.locator("#ghost").is_visible() and pg.locator("#levels").is_hidden() and pg.locator("#ornaments").is_hidden(), f"{E}: square controls shown, tree controls hidden")
    ok(not pg.locator("#snow").is_visible(), f"{E}: no Christmas snow on the plain board")
    ok("rnament" not in pg.inner_text("#panel0") and "Captured" not in pg.inner_text("#panel0"), f"{E}: no ornament rows in the panels")
    ok(pg.evaluate("document.querySelector('#panel1 .pick[data-cat=\"1\"] svg').dataset.art") == "plain" and pg.locator('#panel1 .pick[data-cat="1"] svg path[fill="#c4161c"]').count() == 0, f"{E}: plain cats wear no Santa hat on the square board")
    ok("kitten" in pg.inner_text("#status") and "ornament" not in pg.inner_text("#status").lower(), f"{E}: status asks for a kitten, not an ornament ({pg.inner_text('#status')!r})")
    ok(pg.evaluate("document.querySelector('.cell').getAttribute('aria-label')") == "Row 1, column 1", f"{E}: cell label is plain row/column")
    click(pg, 14); idle(pg)   # seat 0 at (2,2)
    click(pg, 15); idle(pg)   # seat 1 at (2,3) boops seat 0's kitten west
    b = pg.evaluate("__boop.state.b.map(q => q && q.p)")
    ok(b[13] == 0 and b[14] is None and b[15] == 1, f"{E}: classic boop on the square (kitten pushed one cell away)")
    ok(pg.evaluate("__boop.state.turn") == 0 and pg.evaluate("__boop.state.phase") == "place", f"{E}: turn returned to seat 0")
    ok(pg.locator(".stitch").count() == 0 and pg.locator(".spirit").count() == 0, f"{E}: no ghost UI when ghosts are off")
    for size in (7, 8, 9, 10):
        pg.select_option("#size", str(size)); idle(pg)
        auto = pg.evaluate("__boop.state.n")
        ok(pg.locator(".cell").count() == size * size and pg.evaluate("__boop.state.N") == size and auto == 8 + 2 * (size - 6), f"{E}: {size}x{size} board has {size*size} cells, Auto kittens {auto}")
    pg.select_option("#size", "6"); idle(pg)
    for P in (3, 4):
        pg.select_option("#players", str(P)); idle(pg)
        ok(pg.evaluate("__boop.state.players") == P and pg.evaluate("__boop.state.shape") == "square" and pg.evaluate("[0,1,2,3].filter(i => !document.getElementById('panel'+i).hidden).length") == P, f"{E}: {P} players on the square, {P} panels")
        order = []
        for t in range(P):
            order.append(pg.evaluate("__boop.state.turn")); click(pg, 30 + t); idle(pg)
        ok(order == list(range(P)), f"{E}: {P}-player turn order {order}")
    ok(pg.evaluate("__boop.maxPieces()") == 9, f"{E}: 4 players on 6x6 are capped at 9 kittens")
    pg.select_option("#players", "2"); idle(pg)
    pg.select_option("#size", "8"); idle(pg); pg.reload(); pg.wait_for_function("window.__boop")
    ok(pg.evaluate("__boop.state.N") == 8 and pg.locator("#boardKind").input_value() == "square" and pg.locator("#size").input_value() == "8", f"{E}: saved square game and selectors survive a reload")
    pg.screenshot(path=str(SHOTS / f"square-8x8-{E}.png"))
    ctx.close()

    # ---------------- old saves and settings still load ----------------
    ctx, pg = make()
    pg.evaluate("""() => {
      const s = BoopLogic.newGame({ levels: 5, pieces: 10 }); delete s.shape; delete s.ghost; delete s.ghosts;
      localStorage.setItem('boop-augmented-save-v1', JSON.stringify({ state: s, history: [] }));
      localStorage.setItem('boop-augmented-settings-v1', JSON.stringify({ mode: 'pvp', levels: 5, pieces: 10, view: '2d' }));   // no board/size/ghost keys
    }""")
    pg.reload(); pg.wait_for_function("window.__boop")
    ok(pg.evaluate("__boop.state.shape") == "tree" and pg.evaluate("__boop.state.L") == 5 and pg.locator("#boardKind").input_value() == "tree" and pg.locator("#levels").input_value() == "5", f"{E}: a save and settings from before squares load as the 5-tier tree")
    pg.evaluate("localStorage.setItem('boop-augmented-settings-v1', JSON.stringify({ mode: 'pvp', board: 'bogus', size: 99, ghost: 'x', levels: 4 })); localStorage.removeItem('boop-augmented-save-v1')")
    pg.reload(); pg.wait_for_function("window.__boop")
    ok(pg.evaluate("__boop.state.shape") == "tree" and pg.locator("#boardKind").input_value() == "tree", f"{E}: hostile stored settings fall back to the tree")
    pg.evaluate("localStorage.setItem('boop-augmented-save-v1', JSON.stringify({ state: { L: 6, N: 6, shape: 'square', ghost: true, ghosts: [], players: 2 } }))")
    pg.reload(); pg.wait_for_function("window.__boop")
    ok(pg.evaluate("__boop.state.shape") == "tree" and pg.locator(".cell").count() > 0, f"{E}: a corrupt ghost save is ignored and a fresh game starts")
    ctx.close()

    # ---------------- ghost: placement flow (shared device, reduced motion) ----------------
    ctx, pg = make()
    pg.select_option("#mode", "pvp"); pg.select_option("#boardKind", "square"); pg.select_option("#ghost", "on"); idle(pg)
    ok(pg.evaluate("__boop.state.ghost") is True and len(pg.evaluate("__boop.state.ghosts")) == 2, f"{E}: ghost variant on, one ghost per player")
    ok("Ghost" in pg.inner_text("#panel0") and "pool" in pg.inner_text("#panel0").lower(), f"{E}: panel shows the ghost in the pool")
    click(pg, 14); idle(pg)
    ok(pg.evaluate("__boop.state.phase") == "ghost" and pg.evaluate("__boop.state.turn") == 0, f"{E}: after the piece the game waits for the ghost decision")
    ok(pg.locator(".stitch").count() == 20 and pg.locator("#skipGhost").is_visible(), f"{E}: 20 edge stitches and a keep-the-ghost button")
    ok(pg.locator(".cell").evaluate_all("els => els.every(e => e.disabled)"), f"{E}: cells are locked during the ghost decision")
    ok("ghost" in pg.inner_text("#status").lower(), f"{E}: status explains the ghost step ({pg.inner_text('#status')[:90]!r})")
    pg.locator('.stitch[data-id="2"]').click(); idle(pg)
    gs = pg.evaluate("__boop.state.ghosts[0]")
    ok(gs == {"on": True, "d": 0, "a": 2, "t": 0} and pg.evaluate("__boop.state.turn") == 1, f"{E}: clicking a stitch places the ghost {gs} and passes the turn")
    sp = pg.locator('.spirit[data-p="0"]')
    ok(sp.count() == 1, f"{E}: the ghost is drawn")
    box, bb = sp.bounding_box(), pg.locator("#board").bounding_box(); S = pg.evaluate("__boop.cellSize()")
    cx, cy = box["x"] + box["width"] / 2 - bb["x"], box["y"] + box["height"] / 2 - bb["y"]
    ok(abs(cx - 3 * S) < S * 0.2 and abs(cy - 0.5 * S) < S * 0.2, f"{E}: the ghost sits on its stitch between columns 3 and 4 of row 1 ({cx:.0f},{cy:.0f} vs {3*S},{S/2})")
    ok(pg.locator(".stitch").count() == 0, f"{E}: stitches disappear after placing")
    click(pg, 35); idle(pg)   # seat 1 piece
    ok(pg.evaluate("__boop.state.phase") == "ghost" and pg.locator(".stitch").count() == 19 and pg.locator('.stitch[data-id="2"]').count() == 0, f"{E}: the opponent cannot use the occupied stitch")
    pg.locator("#skipGhost").click(); idle(pg)
    ok(pg.evaluate("__boop.state.ghosts[1].on") is False and pg.evaluate("__boop.state.turn") == 0, f"{E}: keeping the ghost passes the turn and leaves it in the pool")
    click(pg, 21); idle(pg)   # seat 0 again: the ghost steps to row 2 (index 1)
    ok(pg.evaluate("__boop.state.ghosts[0].t") == 1 and pg.locator(".spirit").count() == 1, f"{E}: the ghost advanced one stitch")
    ok(pg.evaluate("__boop.state.phase") == "place" and pg.evaluate("__boop.state.turn") == 1, f"{E}: a ghost already on the board does not ask for a placement")
    pg.screenshot(path=str(SHOTS / f"ghost-6x6-{E}.png"))
    ctx.close()

    # ---------------- ghost in a saved game: scare with leap, reload in the ghost phase ----------------
    ctx, pg = make()
    seed(pg, LEAP, SETTINGS)
    ok(pg.locator(".spirit").count() == 1 and pg.evaluate("__boop.state.ghosts[0].t") == 0, f"{E}: a saved ghost on the board is restored")
    click(pg, 35); idle(pg)
    st = pg.evaluate("({ a: __boop.state.b[6] && __boop.state.b[6].id, b: __boop.state.b[7] && __boop.state.b[7].id, c: __boop.state.b[8] })")
    ok(st["a"] == 501 and st["b"] == 502 and st["c"] is None, f"{E}: the scared kitten leapt over its neighbour to the edge {st}")
    ok(pg.evaluate("__boop.pieceCount() === __boop.state.b.filter(Boolean).length"), f"{E}: DOM pieces match the state")
    seed(pg, "const s = L.newGame({shape:'square',size:6,pieces:8,ghost:true}); return L.play(s, 14, false).state;", SETTINGS)
    ok(pg.evaluate("__boop.state.phase") == "ghost" and pg.locator(".stitch").count() == 20, f"{E}: reloading in the ghost phase offers the stitches again")
    ctx.close()

    # ---------------- README crops (Firefox only): a readable mid-game position, 2D and 3D ----------------
    if E == "firefox":
        MID = ("const s = L.newGame({shape:'square',size:6,pieces:8,ghost:true}); s.phase='place'; s.turn=0; let id = 900;"
               "for (const [r,c,p,k] of [[1,1,0,'k'],[2,2,0,'c'],[3,0,0,'k'],[4,3,0,'k'],[1,4,1,'k'],[2,3,1,'c'],[3,4,1,'k'],[4,1,1,'k'],[5,5,1,'k']]) { s.b[r*6+c] = {id:id++,p,kind:k}; if (k==='k') s.pool[p].k--; }"
               "s.pool[0].c = 0; s.ghosts[0] = {on:true,d:0,a:1,t:2}; s.ghosts[1] = {on:true,d:3,a:2,t:4}; s.nextId = id; return s;")
        for view, name, sel in (("2d", "board-desktop-square-2d.png", "#board"), ("3d", "board-desktop-square-3d.png", "#boardWrap")):
            ctx, pg = make(); seed(pg, MID, dict(SETTINGS, view=view)); pg.wait_for_timeout(300)
            ok(pg.locator(".spirit").count() == 2 and pg.locator(".piece:not(.spirit)").count() == 9, f"{E}: README position ({view}) has 9 pieces and 2 ghosts")
            pg.locator(sel).screenshot(path=str(SHOTS / name)); ctx.close()

    # ---------------- ghost against the computer ----------------
    ctx, pg = make()
    seed(pg, "return L.newGame({shape:'square',size:6,pieces:8,ghost:true});", dict(SETTINGS, mode="cpu"))
    for t in range(8):
        idle(pg, 60000)
        ph = pg.evaluate("__boop.state.phase")
        if ph == "over": break
        if ph == "ghost": pg.locator("#skipGhost").click(); continue
        if ph == "place" and pg.evaluate("__boop.state.turn") == 0:
            free = pg.evaluate("__boop.state.b.map((q, i) => q ? -1 : i).filter(i => i >= 0)")
            click(pg, free[(t * 7) % len(free)])
        elif ph in ("chooseLine", "promote"): break
    idle(pg, 60000)
    ok(pg.evaluate("__boop.state.moves") >= 6, f"{E}: computer and human alternate on a ghost game ({pg.evaluate('__boop.state.moves')} moves)")
    ok(len(pg.evaluate("__boop.state.ghosts")) == 2, f"{E}: the computer seat has a ghost too")
    ok(pg.evaluate("__boop.pieceCount() === __boop.state.b.filter(Boolean).length"), f"{E}: DOM pieces match the state after computer turns")
    ctx.close()

    # ---------------- 3D view of the square ----------------
    ctx, pg = make()
    seed(pg, "const s = L.newGame({shape:'square',size:6,pieces:8,ghost:true,players:3}); s.phase='place'; s.ghosts[1]={on:true,d:2,a:1,t:3}; s.b[8]={id:501,p:1,kind:'k'}; s.b[14]={id:502,p:2,kind:'c'}; s.pool[1].k--; s.nextId=600; return s;",
         dict(SETTINGS, players=3, view="3d"))
    ok(pg.locator(".wall").count() == 4 and pg.locator(".slab").count() == 1 and pg.locator(".tier").count() == 0, f"{E}: 3D square is one slab with 4 walls")
    ok(pg.evaluate("getComputedStyle(document.querySelector('#board')).transform") != "none" and "translateZ" in pg.evaluate("document.querySelector('.cell').style.transform"), f"{E}: 3D cells are lifted onto the slab")
    ok(pg.locator(".spirit").count() == 1 and "translate3d" in pg.evaluate("document.querySelector('.spirit').style.transform"), f"{E}: the ghost is a billboard in 3D")
    ok(pg.evaluate("[...document.querySelectorAll('.piece')].every(e => !getComputedStyle(e).filter.includes('drop-shadow'))"), f"{E}: no soft drop shadows on 3D pieces")
    pg.screenshot(path=str(SHOTS / f"square-3d-{E}.png"))
    click(pg, 35); idle(pg)
    ok(pg.evaluate("__boop.state.phase") == "ghost" and pg.locator(".stitch").count() == 20, f"{E}: stitches are available in 3D ({pg.locator('.stitch').count()})")
    pg.locator('.stitch').first.evaluate("e => e.click()"); idle(pg)
    ok(pg.evaluate("__boop.state.ghosts[0].on") is True and pg.locator(".spirit").count() == 2, f"{E}: ghost placed in 3D")
    ctx.close()

    # ---------------- 2D pieces are not shadowed either ----------------
    ctx, pg = make()
    seed(pg, "const s = L.newGame({shape:'square',size:6,pieces:8}); s.phase='place'; s.b[8]={id:501,p:1,kind:'k'}; s.b[9]={id:502,p:0,kind:'c'}; s.b[10]={id:503,p:1,kind:'c'}; s.pool[1].k--; s.nextId=600; return s;", dict(SETTINGS, ghost=False))
    ok(pg.evaluate("[...document.querySelectorAll('.piece svg')].every(e => getComputedStyle(e).filter === 'none')") and pg.evaluate("[...document.querySelectorAll('.piece')].every(e => !getComputedStyle(e).filter.includes('drop-shadow'))"), f"{E}: SVG cats carry no soft drop shadow in 2D")
    ctx.close()

    # ---------------- mobile ----------------
    ctx, pg = make({"width": 390, "height": 844})
    seed(pg, "return L.newGame({shape:'square',size:10,pieces:16,ghost:true});", dict(SETTINGS, size=10, pieces="auto"))
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 392, f"{E}: 10x10 on a phone does not overflow horizontally ({pg.evaluate('document.documentElement.scrollWidth')}px)")
    ok(pg.evaluate("__boop.cellSize()") >= 18, f"{E}: cells stay tappable ({pg.evaluate('__boop.cellSize()')}px)")
    click(pg, 55); idle(pg)
    sb = pg.locator('.stitch').first.bounding_box()
    ok(pg.locator(".stitch").count() == 36 and sb is not None and sb["width"] >= 14, f"{E}: 36 stitches on 10x10, usable size {sb and sb['width']:.0f}px")
    pg.screenshot(path=str(SHOTS / f"square-10x10-mobile-{E}.png"))
    ctx.close()

    # ---------------- motion ----------------
    ctx, pg = make(reduced=False)
    mo = pg.evaluate("__boop.motion")
    ok(1000 <= mo["boopMs"] <= 1200 and mo["scareMs"] >= 1000 and mo["easing"].startswith("cubic-bezier"), f"{E}: boop motion is about 1 s with an ease curve {mo}")
    seed(pg, LEAP, SETTINGS)
    t0 = pg.evaluate("performance.now()")
    click(pg, 35)
    pg.wait_for_function("document.querySelector('.spirit').getAnimations().some(a => a.playState === 'running')", timeout=15000, polling="raf")
    ok(pg.evaluate("__boop.busy") and pg.locator("#newGame").is_disabled(), f"{E}: input is gated while the ghost moves")
    # freeze the leap the moment it runs, probe three points of its path, then let it finish
    pg.wait_for_function(f"(() => {{ const a = document.querySelector('.piece[data-id=\"501\"]').getAnimations().find(a => a.playState === 'running' && a.effect.getTiming().duration === {mo['scareMs']}); if (!a) return false; window.__leap = a; a.pause(); return true; }})()", timeout=15000, polling="raf")
    arc = pg.evaluate(f"""() => {{ const e = document.querySelector('.piece[data-id="501"]'), a = window.__leap, t0 = a.currentTime;
      a.currentTime = {mo['scareMs']} / 2; const mid = getComputedStyle(e).transform; a.currentTime = 0; const s = getComputedStyle(e).transform;
      a.currentTime = {mo['scareMs']} - 1; const f = getComputedStyle(e).transform; a.currentTime = t0; a.play(); return [s, mid, f]; }}""")
    def ty(m):
        v = [float(x) for x in m[m.index("(") + 1:-1].split(",")]
        return v[5] if len(v) == 6 else v[13]
    ok(ty(arc[1]) < min(ty(arc[0]), ty(arc[2])) - 5, f"{E}: the scared kitten hops over its neighbour (mid y {ty(arc[1]):.0f} vs ends {ty(arc[0]):.0f}/{ty(arc[2]):.0f})")
    idle(pg, 30000)
    took = pg.evaluate("performance.now()") - t0
    ok(pg.evaluate("__boop.state.b[6].id") == 501 and took > 1800, f"{E}: the whole turn (piece, ghost step, leap) took {took:.0f} ms")
    ctx.close()
    ctx, pg = make(reduced=True)
    seed(pg, LEAP, SETTINGS)
    click(pg, 35); idle(pg, 5000)
    ok(pg.evaluate("__boop.state.b[6].id") == 501 and pg.evaluate("document.getAnimations().length") == 0, f"{E}: reduced motion: instant resolution, no running animations")
    ctx.close()

    ok(not blocked, f"{E}: no external request or relay {blocked}")
    ok(not bad, f"{E}: no HTTP errors {bad}")
    ok(not errs, f"{E}: no page errors {errs}")
    br.close()

try:
    for _ in range(50):
        try: socket.create_connection(("127.0.0.1", PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    with sync_playwright() as p:
        for engine in ("firefox", "chromium"):
            run(engine, p)
finally:
    srv.terminate()
print("RESULT", "FAIL" if fails else "PASS")
raise SystemExit(1 if fails else 0)
