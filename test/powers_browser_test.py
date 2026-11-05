"""Boopmas spirits (tree) and Shuffle powers (square) in the local UI, Firefox and Chromium. No network: every non-local
request is aborted and recorded, WebSockets are closed, so no relay is ever contacted.
Run from repo root: python test/powers_browser_test.py"""
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
    pg.evaluate("""([js, settings]) => {
      const s = (new Function('L', js))(BoopLogic);
      localStorage.setItem('boop-augmented-save-v1', JSON.stringify({ state: s, history: [] }));
      localStorage.setItem('boop-augmented-settings-v1', JSON.stringify(settings));
    }""", [js, settings])
    pg.reload(); pg.wait_for_function("window.__boop")

TREE = {"mode": "pvp", "board": "tree", "levels": 4, "boopmas": True, "pieces": 8, "ornaments": "classic", "view": "2d"}
SHUF = {"mode": "pvp", "board": "shuffle", "size": 6, "pieces": 8, "view": "2d"}
TREE_PRE = "const s = L.newGame({levels:4,pieces:8,ornaments:0,boopmas:true%s}); s.phase='place'; s.nextId=900; let id = 800; "
def tree_state(extra, pieces, turn, holder, used="[false,false,false]"):
    js = (TREE_PRE % extra) + f"s.turn={turn}; s.spirits={{holder:{holder},used:{used}}}; "
    for r, c, p, k in pieces:
        js += f"s.b[{r}*7+{c}]={{id:id++,p:{p},kind:'{k}'}}; " + (f"s.pool[{p}].k--; " if k == 'k' else "")
    return js + "s.nextId=id; return s;"
def sh_state(pieces, turn=0, extra="", spec=None):
    js = f"const s = L.newGame({{shape:'square',size:6,pieces:8,shuffle:true{extra}}}); s.phase='place'; s.turn={turn}; let id = 800; "
    for r, c, p, k, *rest in pieces:
        x = rest[0] if rest else None; cov = rest[1] if len(rest) > 1 else None
        js += f"s.b[{r}*6+{c}]={{id:id++,p:{p},kind:'{k}'" + (f",x:'{x}'" if x else "") + (f",cov:{{p:{cov}}}" if cov is not None else "") + "}; "
        if cov is not None: js += f"s.pool[{cov}].b--; "
        if x == 'w': js += "s.wild.k--; "
        elif k == 'k': js += f"s.pool[{p}].{ {'s':'ks','a':'ka'}.get(x, 'k') }--; "
    return js + (spec or "") + "s.nextId=id; return s;"

def run(engine, p):
    br = getattr(p, engine).launch()
    blocked, errs, bad = [], [], []
    def make(vp=None, reduced=True):
        ctx = br.new_context(viewport=vp or {"width": 1300, "height": 950}, reduced_motion="reduce" if reduced else "no-preference")
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
    live = lambda pg: pg.evaluate("__boop.pieceCount() === __boop.state.b.filter(Boolean).length")

    # ---------------- controls: defaults untouched, new controls only where they belong ----------------
    ctx, pg = make()
    ok(pg.evaluate("__boop.state.shape") == "tree" and pg.evaluate("__boop.state.boopmas") is False and pg.locator(".cell").count() == 45, f"{E}: the default game is still the plain classic tree")
    ok(pg.locator("#boopmas").is_visible() and pg.locator("#spiritBar").is_hidden(), f"{E}: the spirits control is on the tree, the spirit bar is hidden while it is off")
    ok(pg.locator("#boardKind option").evaluate_all("els => els.map(e => e.value)") == ["tree", "square", "shuffle"], f"{E}: board choices tree / square / shuffle")
    ok("house rule" in pg.locator("#boopmas option[value=on]").inner_text() and "house rules" in pg.locator("#boardKind option[value=shuffle]").inner_text(), f"{E}: the adaptations are labelled as house rules in the controls")
    ok("Boopmas spirits" in pg.locator("#rules").inner_text() and "Shuffle powers" in pg.locator("#rules").inner_text() and "house adaptation" in pg.locator("#rules").inner_text(), f"{E}: the rules dialog explains both adaptations")
    pg.select_option("#boardKind", "square"); idle(pg)
    ok(pg.locator("#boopmasBox").is_hidden() and pg.locator("#ghostBox").is_visible() and pg.locator("#spiritBar").is_hidden(), f"{E}: spirits hidden on the square, ghosts offered")
    pg.select_option("#boardKind", "shuffle"); idle(pg)
    st = pg.evaluate("({ shape: __boop.state.shape, N: __boop.state.N, shuffle: __boop.state.shuffle, ghost: __boop.state.ghost, wild: __boop.state.wild, pool: __boop.state.pool[0], n: __boop.state.n })")
    ok(st["shape"] == "square" and st["N"] == 6 and st["shuffle"] is True and st["ghost"] is False and st["wild"] == {"k": 2, "c": 0} and st["pool"]["ks"] == 1 and st["pool"]["ka"] == 1 and st["pool"]["b"] == 1 and st["n"] == 8, f"{E}: choosing the Shuffle board starts a 6x6 shuffle game {st}")
    ok(pg.locator("#ghostBox").is_hidden() and pg.locator("#sizeBox").is_visible() and pg.locator("#boopmasBox").is_hidden(), f"{E}: ghosts are not offered with Shuffle, size is")
    ok(pg.locator("#panel0 .pick.small").count() == 6 and pg.locator("#panel0 .pick[data-cat]").count() == 2, f"{E}: each panel offers kitten, cat and six power pieces")
    kw = pg.locator("#panel0 .pick[data-piece='kw']").inner_text()
    ok(kw.count("2") == 1 and "shared" in kw, f"{E}: the wild supply is shown as shared ({kw!r})")
    pg.select_option("#boardKind", "tree"); idle(pg)
    pg.select_option("#boopmas", "on"); idle(pg)
    ok(pg.evaluate("__boop.state.boopmas") is True and pg.locator("#spiritBar").is_visible() and pg.locator("#spiritBar button").count() == 3, f"{E}: Boopmas on shows the spirit bar with three spirits")
    ok(pg.locator("#spiritBar button").evaluate_all("els => els.every(e => e.disabled)") and "nobody" in pg.inner_text("#spiritBar"), f"{E}: nobody holds the board before the first graduation, so every spirit is disabled")
    ok(pg.evaluate("document.querySelector('#board').dataset.mode") == "boopmas", f"{E}: board mode marker")
    ctx.close()

    # ---------------- Boopmas: hand-over by a real graduation, then Psst Psst ----------------
    ctx, pg = make()
    seed(pg, tree_state("", [(4, 1, 0, "k"), (4, 2, 0, "k"), (4, 3, 0, "k")], 0, "null"), TREE)
    ok(pg.evaluate("__boop.state.spirits.holder") is None, f"{E}: seeded game: nobody holds the board")
    click(pg, 8); idle(pg)   # seat 0 plays (1,1): the line (4,1)-(4,3) graduates
    ok(pg.evaluate("__boop.state.pool[0].c") == 3 and pg.evaluate("__boop.state.spirits.holder") == 1 and pg.evaluate("__boop.state.turn") == 1, f"{E}: graduating three kittens hands the spirit board to seat 1")
    ok("takes the spirit board" in pg.inner_text("#status") and "Coal" in pg.inner_text("#status"), f"{E}: the hand-over is announced ({pg.inner_text('#status')[:120]!r})")
    ok("Coal" in pg.inner_text("#spiritBar") and pg.locator("#spiritBar button:not([disabled])").count() == 3, f"{E}: the spirit bar names the holder and enables all three spirits")
    ok("spirit board" in pg.inner_text("#panel1").lower() and "spirit board" not in pg.inner_text("#panel0").lower(), f"{E}: only the holder's panel shows the spirit board")
    ctx.close()

    ctx, pg = make()
    seed(pg, tree_state("", [(2, 3, 0, "k"), (2, 2, 0, "k"), (3, 4, 0, "k"), (4, 4, 0, "k")], 1, 1), TREE)
    pg.click("#spiritBar button[data-g='0']")
    ok(pg.evaluate("__boop.selSpirit") == 0 and "Psst Psst" in pg.inner_text("#status"), f"{E}: choosing Psst Psst is shown in the status ({pg.inner_text('#status')[:80]!r})")
    pg.locator('.cell[data-idx="24"]').hover(force=True)
    ok(pg.locator(".piece.preview").count() == 1 and pg.locator(".piece.nudge").count() == 2, f"{E}: the hover preview nudges only the two diagonal neighbours")
    click(pg, 24); idle(pg)
    b = pg.evaluate("__boop.state.b.map(q => q && q.p)")
    ok(b[8] == 0 and b[40] == 0 and b[17] == 0 and b[25] == 0 and b[16] is None and b[32] is None, f"{E}: only the diagonal neighbours were booped")
    ok(pg.evaluate("__boop.state.spirits.used") == [True, False, False] and pg.locator("#spiritBar button[data-g='0']").is_disabled() and "spent" in pg.locator("#spiritBar button[data-g='0']").get_attribute("class"), f"{E}: Psst Psst is spent and shown as such")
    ok(pg.evaluate("__boop.selSpirit") is None and pg.evaluate("__boop.state.turn") == 0, f"{E}: the selection resets and the turn passes")
    ok("Psst Psst" in pg.inner_text("#status"), f"{E}: the move is announced ({pg.inner_text('#status')[:100]!r})")
    ok(live(pg), f"{E}: DOM pieces match the state")
    pg.reload(); pg.wait_for_function("window.__boop")
    ok(pg.evaluate("__boop.state.spirits.used") == [True, False, False] and pg.evaluate("__boop.state.spirits.holder") == 1 and pg.locator("#boopmas").input_value() == "on", f"{E}: the spirit board survives a reload (save) and the selector follows it")
    pg.click("#undo"); idle(pg)
    ok(pg.evaluate("__boop.state.spirits.used") == [False, False, False] and pg.evaluate("__boop.state.turn") == 1, f"{E}: undo gives the spirit back")
    ctx.close()

    # ---------------- Boopmas: Yet to Pounce; Meowly with aiming, cancelling and a jump ----------------
    ctx, pg = make()
    seed(pg, tree_state("", [(2, 3, 0, "k"), (2, 2, 0, "k"), (3, 4, 0, "k"), (4, 4, 0, "k")], 1, 1), TREE)
    pg.click("#spiritBar button[data-g='1']"); click(pg, 24); idle(pg)
    b = pg.evaluate("__boop.state.b.map(q => q && q.p)")
    ok(b[10] == 0 and b[26] == 0 and b[17] is None and b[25] is None and b[16] == 0 and b[32] == 0, f"{E}: Yet to Pounce moves only the straight neighbours")
    ctx.close()

    MEOW = tree_state("", [(3, 4, 0, "c"), (3, 5, 0, "k"), (2, 3, 0, "k")], 1, 1)
    ctx, pg = make()
    seed(pg, MEOW, TREE)
    pg.click("#spiritBar button[data-g='2']")
    click(pg, 40); pg.wait_for_timeout(100)   # (5,5): no neighbour -> no aim
    ok(pg.evaluate("__boop.aim") is None and pg.evaluate("__boop.state.moves") == 0 and "needs a piece" in pg.inner_text("#status"), f"{E}: Meowly needs a piece beside the chosen cell ({pg.inner_text('#status')[:80]!r})")
    click(pg, 24); idle(pg)
    ok(pg.evaluate("__boop.aim && [__boop.aim.idx, __boop.aim.cat]") == [24, False], f"{E}: choosing the cell starts the aim")
    ok(pg.locator(".cell.aimable").count() == 2 and "highlighted" in pg.inner_text("#status") and pg.locator("#cancelAim").is_visible(), f"{E}: the two neighbouring pieces are highlighted and the status offers Cancel")
    ok(pg.locator(".piece.preview").count() == 1, f"{E}: the new piece stays visible (as a preview) while aiming")
    ok(pg.locator(".cell").evaluate_all("els => els.filter(e => !e.disabled).length") == 2, f"{E}: only the aimable pieces can be clicked now")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    ok(pg.evaluate("__boop.aim") is None and pg.evaluate("__boop.state.moves") == 0 and pg.evaluate("__boop.selSpirit") == 2, f"{E}: Escape cancels the aim and keeps the spirit chosen")
    ok(pg.locator(".piece.preview").count() == 0, f"{E}: cancelling removes the preview piece")
    click(pg, 24); pg.wait_for_function("__boop.aim"); pg.click("#cancelAim"); pg.wait_for_timeout(100)
    ok(pg.evaluate("__boop.aim") is None, f"{E}: the Cancel button works too")
    click(pg, 24); pg.wait_for_function("__boop.aim"); click(pg, 25); idle(pg)      # aim at the cat on (3,4)
    b = pg.evaluate("__boop.state.b.map(q => q && [q.p, q.kind])")
    ok(b[27] == [0, "c"] and b[25] is None and b[26] == [0, "k"] and b[17] == [0, "k"], f"{E}: the blocked cat jumped over the kitten behind it, the other neighbour stayed {b[25:28]}")
    ok(pg.evaluate("__boop.state.spirits.used") == [False, False, True] and pg.evaluate("__boop.aim") is None, f"{E}: Meowly is spent")
    ok("jumps" in pg.inner_text("#status").lower() or "Meowly" in pg.inner_text("#status"), f"{E}: the jump is announced ({pg.inner_text('#status')[:120]!r})")
    ok(live(pg), f"{E}: DOM pieces match the state")
    ctx.close()

    # ---------------- Boopmas in 3D, 3 players ----------------
    ctx, pg = make()
    seed(pg, MEOW.replace("L.newGame({levels:4,pieces:8,ornaments:0,boopmas:true})", "L.newGame({levels:4,pieces:8,ornaments:0,boopmas:true,players:3})"), dict(TREE, view="3d", players=3))
    ok(pg.evaluate("__boop.state.players") == 3 and pg.evaluate("document.querySelector('#board').classList.contains('v3d')"), f"{E}: 3 players, 3D view")
    pg.click("#spiritBar button[data-g='2']"); click(pg, 24); pg.wait_for_function("__boop.aim")
    ok(pg.locator(".cell.aimable").count() == 2, f"{E}: aiming works in 3D")
    click(pg, 25); idle(pg)
    ok(pg.evaluate("__boop.state.b[27] && __boop.state.b[27].kind") == "c" and pg.evaluate("__boop.state.turn") == 2, f"{E}: Meowly in 3D, next seat is on turn")
    pg.screenshot(path=str(SHOTS / f"boopmas-3d-{E}.png"))
    ctx.close()

    # ---------------- keyboard only: Tab-focusable buttons, Enter to act ----------------
    ctx, pg = make()
    seed(pg, MEOW, TREE)
    pg.locator("#spiritBar button[data-g='2']").focus(); pg.keyboard.press("Enter")
    pg.locator('.cell[data-idx="24"]').focus(); pg.keyboard.press("Enter"); pg.wait_for_function("__boop.aim")
    pg.locator('.cell[data-idx="25"]').focus(); pg.keyboard.press("Enter"); idle(pg)
    ok(pg.evaluate("__boop.state.b[27] && __boop.state.b[27].kind") == "c" and pg.evaluate("__boop.state.spirits.used[2]") is True, f"{E}: Jacob Meowly can be chosen, aimed and fired with the keyboard alone")
    ctx.close()
    ctx, pg = make()
    seed(pg, sh_state([(2, 2, 1, "c"), (2, 3, 1, "k")], 0), SHUF)
    pg.locator("#panel0 .pick[data-piece='b']").focus(); pg.keyboard.press("Enter")
    pg.locator('.cell[data-idx="14"]').focus(); pg.keyboard.press("Enter"); idle(pg)
    ok(pg.locator(".piece.napping").count() == 1 and pg.evaluate("__boop.state.b[14].cov") == {"p": 0}, f"{E}: the blankie works with the keyboard alone")
    ctx.close()

    # ---------------- Boopmas against the computer: the computer finds the winning Meowly boop ----------------
    ctx, pg = make()
    seed(pg, tree_state("", [(2, 1, 1, "c"), (2, 3, 1, "c"), (3, 2, 1, "c")], 0, 1).replace("return s;", "s.pool[1].k = 1; s.pool[1].c = 0; return s;"), dict(TREE, mode="cpu"))
    click(pg, 40); idle(pg, 60000)       # the human plays far away
    pg.wait_for_function("__boop.state.winner !== null", timeout=60000)
    ok(pg.evaluate("__boop.state.winner") == 1 and pg.evaluate("__boop.state.spirits.used[2]") is True, f"{E}: the computer used Jacob Meowly to win ({pg.inner_text('#status')[:100]!r})")
    ok(pg.evaluate("__boop.state.winReason") == "nice-line" and live(pg), f"{E}: three cats in a row")
    ctx.close()

    # ---------------- Shuffle: wild pieces ----------------
    ctx, pg = make()
    seed(pg, sh_state([], 0), SHUF)
    pg.click("#panel0 .pick[data-piece='kw']")
    ok(pg.evaluate("__boop.selPiece") == "kw" and "wild kitten" in pg.inner_text("#status"), f"{E}: choosing a wild kitten ({pg.inner_text('#status')[:60]!r})")
    click(pg, 21); idle(pg)
    w = pg.evaluate("__boop.state.b[21]")
    ok(w and w["p"] == -1 and w["x"] == "w" and w["kind"] == "k" and pg.evaluate("__boop.state.wild.k") == 1 and pg.evaluate("__boop.state.pool[0].k") == 6, f"{E}: the wild kitten comes from the shared supply {w}")
    pc = pg.locator(".piece[data-x='w']")
    ok(pc.count() == 1 and pc.get_attribute("data-n") == "W" and "wild" in pc.get_attribute("title"), f"{E}: it is drawn as a wild piece with a W badge and a title")
    ok(pg.locator("#panel1 .pick[data-piece='kw'] b").inner_text() == "1" and pg.locator("#panel0 .pick[data-piece='kw'] b").inner_text() == "1", f"{E}: both panels show the shared supply")
    # a line completed with the wild piece
    ctx.close()
    ctx, pg = make()
    seed(pg, sh_state([(4, 0, 0, "c"), (4, 1, 0, "c"), (4, 2, -1, "c", "w")], 0), SHUF)
    click(pg, 8); idle(pg)
    ok(pg.evaluate("__boop.state.winner") == 0 and pg.evaluate("__boop.state.winReason") == "nice-line" and pg.locator(".cell.winline").count() == 3, f"{E}: two cats plus a wild cat win for the player on turn")
    ctx.close()
    ctx, pg = make()
    seed(pg, sh_state([(4, 0, 0, "k"), (4, 1, 0, "k"), (4, 2, -1, "k", "w")], 0), SHUF)
    click(pg, 8); idle(pg)
    ok(pg.evaluate("__boop.state.pool[0].c") == 2 and pg.evaluate("__boop.state.wild") == {"k": 1, "c": 1} and pg.locator(".piece[data-x='w']").count() == 0, f"{E}: the wild kitten graduates back to the shared supply as a wild cat")
    click(pg, 20); idle(pg)    # seat 1
    pg.click("#panel0 .pick[data-piece='cw']")
    ok(pg.evaluate("__boop.selPiece") == "cw" and pg.locator("#panel0 .pick[data-piece='cw']").is_enabled(), f"{E}: the wild cat can be placed by whoever is on turn")
    ctx.close()

    # ---------------- Shuffle: super boop, scaredy chain, blankie ----------------
    ctx, pg = make()
    seed(pg, sh_state([(2, 3, 1, "k")], 0), SHUF)
    pg.click("#panel0 .pick[data-piece='ks']"); click(pg, 14); idle(pg)
    ok(pg.evaluate("__boop.state.b[17] && __boop.state.b[17].p") == 1 and pg.evaluate("__boop.state.b[15]") is None, f"{E}: a super kitten boops two cells")
    ok(pg.locator(".piece[data-x='s']").count() == 1 and live(pg), f"{E}: the super kitten is drawn with its badge")
    ctx.close()

    ctx, pg = make()
    seed(pg, sh_state([(2, 2, 1, "k"), (2, 4, 1, "k", "a"), (3, 5, 0, "k", "a")], 0), SHUF)
    click(pg, 13); idle(pg)
    b = pg.evaluate("__boop.state.b.map(q => q && [q.p, q.x || ''])")
    ok(b[15] == [1, ""] and b[17] == [1, "a"] and b[23] is None and pg.evaluate("__boop.state.pool[0].ka") == 1, f"{E}: the scaredy chain reaction: pushed along, the next one off the board")
    ok(live(pg) and "scaredy" in pg.inner_text("#status").lower(), f"{E}: the chain is announced ({pg.inner_text('#status')[:100]!r})")
    ctx.close()

    ctx, pg = make()
    seed(pg, sh_state([(2, 2, 1, "c"), (2, 3, 1, "k")], 0), SHUF)
    ctx, pg = make()
    seed(pg, sh_state([(2, 2, 1, "c"), (2, 3, 1, "k"), (4, 4, 0, "k")], 0), SHUF)
    pg.click("#panel0 .pick[data-piece='b']")
    ok(pg.locator(".cell.allowed").count() == 3 and "sleep" in pg.inner_text("#status") and pg.locator(".cell").evaluate_all("els => els.filter(e => !e.disabled).length") == 3, f"{E}: the blankie highlights exactly the pieces it can cover ({pg.inner_text('#status')[:70]!r})")
    click(pg, 14); idle(pg)
    ok(pg.locator(".piece.napping").count() == 1 and pg.locator(".piece.napping .blanket[data-p='0']").count() == 1, f"{E}: the covered cat wears a blanket in its owner's colour")
    ok(pg.evaluate("__boop.state.b[14].cov") == {"p": 0} and pg.evaluate("__boop.state.pool[0].b") == 0 and pg.evaluate("__boop.state.b[16] && __boop.state.b[16].kind") == "k", f"{E}: state: covered, blankie spent, the neighbour kitten was booped like a kitten would")
    ok("asleep" in pg.locator(".piece.napping").get_attribute("title"), f"{E}: the sleeping piece says so in its title")
    ok(pg.locator("#panel0 .pick[data-piece='b']").is_disabled(), f"{E}: the spent blankie cannot be picked again")
    pg.reload(); pg.wait_for_function("window.__boop")
    ok(pg.locator(".piece.napping").count() == 1 and pg.evaluate("__boop.state.b[14].cov") == {"p": 0}, f"{E}: a sleeping piece survives a reload")
    ctx.close()

    ctx, pg = make()
    seed(pg, sh_state([(2, 2, 0, "k", None, 1), (2, 3, 0, "k")], 1), SHUF)
    ok(pg.locator(".piece.napping").count() == 1, f"{E}: a saved sleeping piece is restored")
    click(pg, 13); idle(pg)     # seat 1 plays a kitten at (2,1): boops the sleeper
    ok(pg.evaluate("__boop.state.b[14].cov") is None and pg.evaluate("__boop.state.b[15].cov") == {"p": 1}, f"{E}: booping a sleeper takes the blanket off, it lands on the next piece")
    ok(pg.locator(".piece.napping").count() == 1 and pg.locator(".piece.napping").get_attribute("data-id") == pg.evaluate("String(__boop.state.b[15].id)") and live(pg), f"{E}: the blanket moved in the DOM too")
    ctx.close()

    # ---------------- Shuffle: 3 and 4 players, size, saves, 3D ----------------
    ctx, pg = make()
    pg.select_option("#mode", "pvp"); pg.select_option("#boardKind", "shuffle"); idle(pg)
    for P in (3, 4):
        pg.select_option("#players", str(P)); idle(pg)
        ok(pg.evaluate("__boop.state.players") == P and pg.evaluate("__boop.state.pool.length") == P and pg.locator(".panel:not([hidden]) .pick.small").count() == 6 * P, f"{E}: {P}-player Shuffle: every seat has its own power pieces")
        order = []
        for t in range(P): order.append(pg.evaluate("__boop.state.turn")); click(pg, 30 + t); idle(pg)
        ok(order == list(range(P)), f"{E}: {P}-player turn order {order}")
    pg.select_option("#players", "2"); idle(pg)
    for size in (7, 10):
        pg.select_option("#size", str(size)); idle(pg)
        ok(pg.evaluate("__boop.state.shuffle") is True and pg.locator(".cell").count() == size * size, f"{E}: Shuffle on {size}x{size}")
    pg.select_option("#size", "8"); idle(pg)
    click(pg, 27); idle(pg)
    pg.reload(); pg.wait_for_function("window.__boop")
    ok(pg.evaluate("__boop.state.shuffle") is True and pg.locator("#boardKind").input_value() == "shuffle" and pg.locator("#size").input_value() == "8" and pg.evaluate("__boop.state.moves") == 1, f"{E}: a saved Shuffle game and its selectors survive a reload")
    ctx.close()

    MID = sh_state([(1, 1, 0, "k"), (2, 2, 0, "c", None, 1), (3, 3, -1, "k", "w"), (1, 4, 1, "k", "a"), (4, 1, 0, "k", "s"), (4, 4, 1, "k"), (2, 4, 1, "c"), (3, 1, 1, "k")], 0)
    ctx, pg = make()
    seed(pg, MID, dict(SHUF, view="3d"))
    ok(pg.locator(".piece[data-x]").count() == 3 and pg.locator(".piece.napping").count() == 1 and pg.locator(".wall").count() == 4, f"{E}: 3D Shuffle board with a wild, a super and a scaredy piece and one sleeper")
    ok("translate3d" in pg.evaluate("document.querySelector('.piece[data-x=\"w\"]').style.transform") and pg.evaluate("[...document.querySelectorAll('.piece')].every(e => !getComputedStyle(e).filter.includes('drop-shadow'))"), f"{E}: power pieces are billboards in 3D, no drop shadows")
    pg.click("#panel0 .pick[data-piece='b']")
    click(pg, 7); idle(pg)
    ok(pg.locator(".piece.napping").count() == 2, f"{E}: the blankie works in 3D (the sleeping cat beside it was not woken: a kitten-like boop cannot move a cat)")
    if E == "firefox":
        pg.locator("#boardWrap").screenshot(path=str(SHOTS / "board-desktop-shuffle-3d.png"))
        seed(pg, MID, dict(SHUF, view="2d")); pg.wait_for_timeout(300)
        pg.locator("#board").screenshot(path=str(SHOTS / "board-desktop-shuffle-2d.png"))
        for view, name, sel in (("2d", "board-desktop-boopmas-2d.png", "#boardWrap"), ("3d", "board-desktop-boopmas-3d.png", "#boardWrap")):
            seed(pg, MEOW, dict(TREE, view=view)); pg.click("#spiritBar button[data-g='2']"); click(pg, 24); pg.wait_for_function("__boop.aim"); pg.wait_for_timeout(300)
            ok(pg.locator(".cell.aimable").count() == 2, f"{E}: README position ({view}) shows the Meowly aim")
            pg.locator(sel).screenshot(path=str(SHOTS / name))
    ctx.close()

    # ---------------- Shuffle against the computer ----------------
    ctx, pg = make()
    seed(pg, sh_state([], 0), dict(SHUF, mode="cpu"))
    for t in range(8):
        idle(pg, 60000)
        ph = pg.evaluate("__boop.state.phase")
        if ph == "over": break
        if ph == "place" and pg.evaluate("__boop.state.turn") == 0:
            free = pg.evaluate("__boop.state.b.map((q, i) => q ? -1 : i).filter(i => i >= 0)")
            click(pg, free[(t * 7) % len(free)])
        elif ph in ("chooseLine", "promote"): break
    idle(pg, 60000)
    ok(pg.evaluate("__boop.state.moves") >= 6 and live(pg), f"{E}: the computer plays the Shuffle board ({pg.evaluate('__boop.state.moves')} moves, DOM matches)")
    ok(pg.evaluate("__boop.state.pool[1].k + __boop.state.pool[1].ks + __boop.state.pool[1].ka + __boop.state.pool[1].c + __boop.state.pool[1].cs + __boop.state.b.filter(q => q && q.p === 1).length") == 8, f"{E}: the computer's pieces are all accounted for")
    ctx.close()

    # ---------------- mobile ----------------
    for label, js, settings in (("shuffle-10x10", "return L.newGame({shape:'square',size:10,pieces:16,shuffle:true});", dict(SHUF, size=10, pieces="auto")),
                                ("boopmas-8", "return L.newGame({levels:8,pieces:16,boopmas:true,ornaments:6,ornActive:3,decor:5});", dict(TREE, levels=8, pieces="auto", ornaments="auto"))):
        ctx, pg = make({"width": 390, "height": 844})
        seed(pg, js, settings)
        ok(pg.evaluate("document.documentElement.scrollWidth") <= 392, f"{E}: {label} on a phone does not overflow horizontally ({pg.evaluate('document.documentElement.scrollWidth')}px)")
        ok(pg.evaluate("__boop.cellSize()") >= 18, f"{E}: {label}: cells stay tappable ({pg.evaluate('__boop.cellSize()')}px)")
        if label.startswith("shuffle"):
            hs = pg.locator("#panel0 .pick.small").evaluate_all("els => els.map(e => e.getBoundingClientRect().height)")
            ok(min(hs) >= 28, f"{E}: power buttons are touch sized (min height {min(hs):.0f}px)")
        else:
            ok(pg.locator("#spiritBar").is_visible() and pg.evaluate("document.querySelector('#spiritBar').getBoundingClientRect().right") <= 392, f"{E}: the spirit bar fits the phone width")
        pg.screenshot(path=str(SHOTS / f"powers-{label}-mobile-{E}.png"))
        ctx.close()

    # ---------------- motion ----------------
    ctx, pg = make(reduced=False)
    seed(pg, sh_state([(2, 3, 1, "k")], 0), SHUF)
    pg.click("#panel0 .pick[data-piece='ks']")
    t0 = pg.evaluate("performance.now()"); click(pg, 14)
    pg.wait_for_function("document.querySelector('.piece[data-id=\"800\"]').getAnimations().some(a => a.playState === 'running')", timeout=15000, polling="raf")
    ok(pg.evaluate("__boop.busy") and pg.locator("#newGame").is_disabled(), f"{E}: input is gated while the super boop glides")
    idle(pg, 30000)
    ok(pg.evaluate("performance.now()") - t0 > 1200, f"{E}: the super boop takes the usual slow boop time")
    ctx.close()
    ctx, pg = make(reduced=True)
    seed(pg, MEOW, TREE)
    pg.click("#spiritBar button[data-g='2']"); click(pg, 24); pg.wait_for_function("__boop.aim"); click(pg, 25); idle(pg, 5000)
    ok(pg.evaluate("__boop.state.b[27] && __boop.state.b[27].kind") == "c" and pg.evaluate("document.getAnimations().length") == 0, f"{E}: reduced motion: the jump resolves at once, no running animations")
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
