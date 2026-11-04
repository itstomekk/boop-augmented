"""Focused browser regression: boop movement, input gate and reduced motion."""
import pathlib, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(ROOT / 'docs')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
url = f'http://127.0.0.1:{port}/'

def seed(pg, pos, view='2d'):
    pg.evaluate('''([pos,view]) => {
      const s=BoopLogic.newGame({levels:4,pieces:8});
      s.phase='place'; s.turn=0; s.b[pos]={id:500,p:1,kind:'k'};
      localStorage.setItem('boop-augmented-save-v1',JSON.stringify({state:s,history:[]}));
      localStorage.setItem('boop-augmented-settings-v1',JSON.stringify({mode:'pvp',levels:4,pieces:8,view}));
      localStorage.setItem('boop-augmented-seen-rules-v1','1');
    }''', [pos, view]); pg.reload(); pg.wait_for_function('window.__boop')

def idle(pg): pg.wait_for_function('!__boop.busy', timeout=10000)

try:
    for _ in range(50):
        try: socket.create_connection(('127.0.0.1',port),.2).close(); break
        except OSError: time.sleep(.1)
    with sync_playwright() as p:
        browser=p.firefox.launch()
        pg=browser.new_page(viewport={'width':1200,'height':900})
        errors=[]; pg.on('pageerror',lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_function('window.__boop')
        for view in ('2d','3d'):
            for source, target, click in [(38,39,37),(41,None,40)]:
                seed(pg,source,view)
                # CSS 3D projection can overlap hit targets; activate the intended button directly.
                pg.locator(f'.cell[data-idx="{click}"]').evaluate('(e) => e.click()')
                pg.wait_for_function("document.querySelector('.piece[data-id=\"500\"]').getAnimations().some(a => a.playState === 'running' && a.effect.getTiming().duration === 560)",timeout=5000)
                assert pg.evaluate('__boop.busy'), 'input must be gated during motion'
                assert pg.locator('#newGame').is_disabled(), 'new game must be gated during motion'
                assert pg.locator('.cell').evaluate_all('(els) => els.every(e => e.disabled)'), 'cells must be disabled during motion'
                motion=pg.locator('.piece[data-id="500"]').evaluate('''e => {
                  const a=e.getAnimations().find(a => a.effect.getTiming().duration === 560);
                  a.pause(); a.currentTime=100; const start=getComputedStyle(e).transform;
                  a.currentTime=350; const mid=getComputedStyle(e).transform;
                  a.play(); return [start,mid];
                }''')
                assert motion[0] != motion[1], f'{view}: piece did not visibly move'
                idle(pg)
                assert pg.evaluate(f'__boop.state.b[{target}]?.id' if target is not None else '__boop.state.b.some(q => q && q.id === 500)') == (500 if target is not None else False)
                assert pg.evaluate('__boop.pieceCount() === __boop.state.b.filter(Boolean).length')
                print('PASS',view,'move' if target is not None else 'off-board')
        assert not errors, errors
        ctx=browser.new_context(reduced_motion='reduce'); rp=ctx.new_page(); rp.goto(url); rp.wait_for_function('window.__boop'); seed(rp,38)
        rp.locator('.cell[data-idx="37"]').click(force=True); idle(rp)
        assert rp.evaluate('__boop.state.b[39]?.id') == 500
        assert rp.locator('.piece[data-id="500"]').evaluate('e => e.getAnimations().length') == 0
        print('PASS reduced motion')
        browser.close()
finally:
    srv.terminate(); srv.wait(timeout=5)
print('RESULT PASS')
