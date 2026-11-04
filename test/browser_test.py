"""Browser test + README screenshots. Run from repo root: python test/browser_test.py
Needs Playwright with Firefox (pip install playwright && playwright install firefox)."""
import socket, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "docs"
OUT = ROOT / "test" / "screens"
OUT.mkdir(exist_ok=True)
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(SITE)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
URL = f"http://127.0.0.1:{PORT}/index.html"
fails = []
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

# Synthetic mid-game positions for screenshots.
SEED = """([levels, view, spin]) => {
  const L = BoopLogic, s = L.newGame({levels, pieces: 8}), g = L.geometry(levels), N = g.N, m = g.m;
  const at = (dr, dc) => (m + dr) * N + (m + dc); let id = 500;
  const put = [[-1,-1,0,'o'],[1,1,1,'o'],[-2,0,0,'c'],[0,-2,1,'k'],[0,1,0,'k'],[2,-1,1,'c'],[1,-1,0,'k'],[-1,2,1,'k'],[2,2,0,'k'],[0,0,1,'k']];
  if (levels > 4) put.push([-4,1,0,'k'],[3,-4,1,'k'],[-3,-3,0,'c'],[4,3,1,'k']);
  for (const [dr,dc,p,kind] of put) s.b[at(dr,dc)] = {id: id++, p, kind};
  s.pool = [{k:4,c:0,o:2},{k:4,c:0,o:2}]; s.captured = [1,0]; s.phase = 'place'; s.turn = 0;
  localStorage.setItem('boop-augmented-save-v1', JSON.stringify({state: s, history: []}));
  localStorage.setItem('boop-augmented-settings-v1', JSON.stringify({mode:'pvp', levels, pieces:8, view, spin}));
  localStorage.setItem('boop-augmented-seen-rules-v1', '1');
}"""

def idle(pg, extra=""):
    pg.wait_for_function(f"window.__boop && !window.__boop.busy {extra}", timeout=15000)

def shot(pg, path, name):
    pg.wait_for_timeout(700)
    pg.screenshot(path=str(OUT / path), full_page=True)
    box = pg.locator("#boardWrap").bounding_box()
    pg.screenshot(path=str(OUT / ("board-" + path)), clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]})

try:
    for _ in range(50):
        try: socket.create_connection(("127.0.0.1", PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    with sync_playwright() as p:
        br = p.firefox.launch()
        for name, vp in [("desktop", {"width": 1400, "height": 900}), ("mobile", {"width": 390, "height": 844})]:
            pg = br.new_page(viewport=vp)
            errors, bad = [], []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 else None)
            pg.goto(URL); pg.wait_for_function("window.__boop")
            ok(pg.locator("#rules").evaluate("d => d.open"), f"{name}: rules shown on first visit")
            ok("treetop" in pg.locator("#rules").inner_text(), f"{name}: rules explain the star")
            pg.click("#rules button")

            pg.select_option("#mode", "pvp"); pg.select_option("#levels", "4"); pg.select_option("#view", "2d"); idle(pg)
            ok(pg.locator(".cell").count() == 45, f"{name}: classic tree has 45 cells")
            ok(pg.evaluate("__boop.state.phase") == "ornament", f"{name}: game starts with ornament")
            ok(pg.locator(".cell.allowed").count() == 8, f"{name}: 8 decorating cells highlighted")
            ok(pg.locator('.cell[data-idx="3"]').is_disabled(), f"{name}: base cell disabled in ornament phase")
            pg.click('.cell[data-idx="16"]'); idle(pg)                       # (2,2)
            st = pg.evaluate("__boop.state")
            ok(st["b"][16] and st["b"][16]["kind"] == "o" and st["phase"] == "place", f"{name}: ornament hung")
            ok("Snowball" in pg.inner_text("#status"), f"{name}: English player name in status")
            pg.click('.cell[data-idx="38"]'); idle(pg)                       # P0 kitten (5,3)
            pg.click('.cell[data-idx="32"]'); idle(pg)                       # P1 ornament (4,4)
            pg.click('.cell[data-idx="37"]', force=True); idle(pg)           # P1 kitten (5,2) boops (5,3)->(5,4)
            b = pg.evaluate("__boop.state.b")
            ok(b[39] and b[39]["p"] == 0 and not b[38], f"{name}: 2D click boop moved kitten")

            pg.click("#undo"); idle(pg)
            ok(pg.evaluate("__boop.state.b[38] && !__boop.state.b[37]"), f"{name}: undo restores")
            pg.reload(); pg.wait_for_function("window.__boop")
            ok(pg.evaluate("__boop.state.b[32] && __boop.state.b[32].kind") == "o", f"{name}: save survives reload")

            # 3D view: real clicks still land on the right cell
            pg.select_option("#view", "3d"); pg.wait_for_timeout(600)
            ok(pg.locator("#rotBox").is_visible(), f"{name}: rotate buttons visible in 3D")
            pg.click('.cell[data-idx="37"]', force=True); idle(pg)
            b = pg.evaluate("__boop.state.b")
            ok(b[37] and b[37]["p"] == 1 and b[39] and b[39]["p"] == 0, f"{name}: 3D click places and boops")
            # Board fits its frame, the star is centred on the treetop and turns with the tree
            def star_offset():
                sb = pg.locator(".topstar .orb").bounding_box(); cb = pg.locator('.cell[data-idx="24"]').bounding_box()
                return abs((sb["x"] + sb["width"] / 2) - (cb["x"] + cb["width"] / 2))
            ok(pg.locator(".topstar .orb").count() == 1 and pg.locator(".topstar .sp").count() == 0, f"{name}: glowing sphere replaces crossed stars")
            ok(pg.locator('.tier:not(.base)').first.evaluate("e => getComputedStyle(e).clipPath.startsWith('polygon')"), f"{name}: tier corners are cut")
            ok(pg.locator('.topstar .orb').evaluate("e => getComputedStyle(e).transform !== 'none'"), f"{name}: orb raised above treetop")
            for k in range(3):
                pg.click("#rotR"); pg.wait_for_timeout(550)
                ok(star_offset() < pg.evaluate("__boop.cellSize()") * 0.35, f"{name}: star centred over treetop after rotation {k+1} ({star_offset():.1f}px)")
            pg.click("#tiltDown"); pg.click("#zoomIn"); pg.wait_for_timeout(500)
            cam = pg.evaluate("[__boop.settings.tilt, __boop.settings.zoom]")
            ok(cam[0] == 70 and abs(cam[1] - 1.2) < 1e-9, f"{name}: tilt and zoom buttons ({cam})")
            pg.click("#camReset"); pg.wait_for_timeout(500)
            box = pg.locator('#boardWrap').bounding_box()
            x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            before = pg.evaluate('[__boop.settings.spin, __boop.settings.tilt]')
            pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 40, y + 30, steps=5); pg.mouse.up()
            after = pg.evaluate('[__boop.settings.spin, __boop.settings.tilt]')
            ok(after[0] < before[0] and after[1] < before[1], f"{name}: right/down drag follows corrected direction")
            pg.click("#camReset"); pg.wait_for_timeout(500)
            wb = pg.locator("#boardWrap").bounding_box(); bb = pg.locator("#board").bounding_box()
            ok(bb["y"] >= wb["y"] - 4 and bb["y"] + bb["height"] <= wb["y"] + wb["height"] + 4 and bb["x"] >= -2 and bb["x"] + bb["width"] <= vp["width"] + 2,
               f"{name}: whole 3D board inside its frame")
            spin0 = pg.evaluate("__boop.settings.spin")
            pg.click("#rotR"); pg.wait_for_timeout(500)
            ok(pg.evaluate("__boop.settings.spin") == (spin0 + 45) % 360, f"{name}: rotate button turns the tree")
            pg.click('.cell[data-idx="10"]', force=True); idle(pg)           # P0 kitten after rotating
            ok(pg.evaluate("__boop.state.b[10] && __boop.state.b[10].p") == 0, f"{name}: click works after rotation")

            # Big tree vs CPU, in 3D
            pg.select_option("#mode", "cpu"); pg.select_option("#levels", "8"); idle(pg)
            ok(pg.locator(".cell").count() == 221, f"{name}: 8-tier tree has 221 cells")
            ok(pg.evaluate("__boop.state.n") == 16, f"{name}: Auto gives 16 kittens on 8 tiers")
            ok(pg.evaluate("[__boop.state.pool[0].o, __boop.state.ornActive, __boop.state.decor]") == [6, 3, 5], f"{name}: Auto ornaments on 8 tiers: 6, 3 at once, ring 5")
            ok(pg.locator("#pieces option").first.inner_text() == "Auto (16)", f"{name}: Auto label shows the count")
            dec = pg.evaluate("BoopLogic.ornamentCells(__boop.state)")
            pg.click(f'.cell[data-idx="{dec[0]}"]', force=True); idle(pg)
            pg.click('.cell[data-idx="20"]', force=True)
            idle(pg, "&& __boop.state.turn === 0 && __boop.state.moves === 2")
            st = pg.evaluate("__boop.state")
            ok(any(q and q["kind"] == "o" and q["p"] == 1 for q in st["b"]) and st["phase"] in ("place", "ornament"), f"{name}: CPU replied on the big tree (phase {st['phase']})")

            # Screenshots (synthetic positions)
            for levels, view, spin, fn in [(4, "3d", 30, "classic-3d"), (4, "2d", 30, "classic-2d"), (8, "2d", 30, "big-2d"), (8, "3d", 30, "big-3d")]:
                if name == "mobile" and fn not in ("classic-3d", "big-2d"): continue
                pg.evaluate(SEED, [levels, view, spin]); pg.reload(); pg.wait_for_function("window.__boop")
                shot(pg, f"{name}-{fn}.png", name)
            ok(not errors, f"{name}: no page errors {errors}")
            ok(not bad, f"{name}: no HTTP errors {bad}")
            pg.close()
        br.close()
finally:
    srv.kill()
print("RESULT", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)
