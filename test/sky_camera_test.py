"""Camera-aligned fixed star sphere, exercised in a real browser."""
import pathlib, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(ROOT/'docs')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try: socket.create_connection(('127.0.0.1', port), .2).close(); break
        except OSError: time.sleep(.1)
    with sync_playwright() as p:
        browser = p.firefox.launch()
        for vp in ({'width':1200,'height':900}, {'width':390,'height':844}):
            pg = browser.new_page(viewport=vp, reduced_motion='reduce')
            errors=[]; bad=[]
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('response', lambda r: bad.append(r.url) if r.status >= 400 else None)
            pg.goto(f'http://127.0.0.1:{port}/'); pg.wait_for_function('window.__boop')
            if pg.locator('#rules').evaluate('e => e.open'): pg.click('#rules button')
            pg.select_option('#view','3d')
            assert pg.locator('#sky').count() == 1, 'world sky canvas missing'
            def image(): return pg.locator('#sky').evaluate('e => e.toDataURL()')
            initial=image(); pg.click('#rotR'); rotated=image()
            assert initial != rotated, 'sky must change with azimuth'
            for _ in range(7): pg.click('#rotR')
            assert image() == initial, '360 degrees must return same world stars'
            for _ in range(4): pg.click('#rotR')
            assert image() != initial, 'opposite direction must show different sky'
            pg.click('#camReset'); assert image() == initial
            pg.click('#tiltDown'); assert image() != initial, 'tilt must change world projection'
            pg.click('#camReset'); pg.click('#zoomIn'); assert image() == initial, 'orbit zoom must not move distant stars'
            box=pg.locator('#boardWrap').bounding_box()
            x=box['x']+box['width']/2; y=box['y']+box['height']/2
            pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.move(x+60,y+30,steps=4); pg.mouse.up()
            assert image() != initial, 'drag must immediately change the same sky'
            pg.click('#camReset'); assert image() == initial
            pg.select_option('#view','2d')
            assert pg.locator('.cell').count() == 45 and pg.locator('#sky').is_visible()
            pg.locator('.cell.allowed').first.click(force=True)
            pg.wait_for_function("__boop.state.phase === 'place'")
            assert not errors and not bad, (errors,bad)
            print('PASS sky orbit, tilt, full rotation, zoom and 2D', vp)
            pg.close()
        browser.close()
        # An independent oracle: recorded canvas arcs vs known seeded directions,
        # CSS perspective intrinsics, and points under the real CSS world transform.
        capture = """localStorage.setItem('boop-augmented-seen-rules-v1','1');
        localStorage.setItem('boop-augmented-settings-v1',JSON.stringify({mode:'pvp'}));
        window.skyArcs=[];const arc=CanvasRenderingContext2D.prototype.arc;
        CanvasRenderingContext2D.prototype.arc=function(x,y,...args){
          if(this.canvas.id==='sky')skyArcs.push([x,y]);return arc.call(this,x,y,...args)};
        const fill=CanvasRenderingContext2D.prototype.fillRect;
        CanvasRenderingContext2D.prototype.fillRect=function(...args){
          if(this.canvas.id==='sky'&&args[0]===0&&args[1]===0)skyArcs=[];
          return fill.apply(this,args)};"""
        oracle = """() => {
          const board=document.querySelector('#board'),wrap=document.querySelector('#boardWrap');
          const cam=getComputedStyle(wrap),rect=wrap.getBoundingClientRect();
          const f=parseFloat(cam.perspective),[ox,oy]=cam.perspectiveOrigin.split(' ').map(parseFloat);
          const a=__boop.settings.spin*Math.PI/180,b=__boop.settings.tilt*Math.PI/180;
          let seed=674213;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
          const samples=[];
          for(let j=0;j<1400;j++){
            const z=rand()*2-1,az=rand()*Math.PI*2,r=Math.sqrt(1-z*z),x=r*Math.cos(az),y=r*Math.sin(az);rand();rand();
            const xx=Math.cos(a)*x-Math.sin(a)*y,yy=Math.sin(a)*x+Math.cos(a)*y;
            const sy=Math.cos(b)*yy-Math.sin(b)*z,sz=Math.sin(b)*yy+Math.cos(b)*z;
            if(sz>=-.05)continue;
            const px=rect.left+ox+f*xx/-sz,py=rect.top+oy+f*sy/-sz;
            if(px<0||px>innerWidth||py<0||py>innerHeight)continue;
            const recorded=skyArcs.reduce((best,q)=>Math.hypot(q[0]-px,q[1]-py)<Math.hypot(best[0]-px,best[1]-py)?q:best,[Infinity,Infinity]);
            const point=(R)=>{const e=document.createElement('div');
              e.style.cssText=`position:absolute;width:0;height:0;left:50%;top:50%;transform:translate3d(${x*R}px,${y*R}px,${z*R}px)`;
              board.appendChild(e);const q=e.getBoundingClientRect();e.remove();return [q.x,q.y]};
            const p1=point(1e6),p2=point(2e6),inf=[2*p2[0]-p1[0],2*p2[1]-p1[1]];
            samples.push({star:j,canvasError:Math.hypot(recorded[0]-px,recorded[1]-py),cssRayError:Math.hypot(recorded[0]-inf[0],recorded[1]-inf[1])});
            if(samples.length===5)break;
          }
          return {samples,f,origin:[rect.left+ox,rect.top+oy]};
        }"""
        for engine in ('firefox','chromium'):
            browser=getattr(p,engine).launch()
            ctx=browser.new_context(viewport={'width':1200,'height':900}, reduced_motion='reduce')
            ctx.add_init_script(capture)
            external=[]; errors=[]
            base=f'http://127.0.0.1:{port}/'
            def route(r):
                if r.request.url.startswith(base): r.continue_()
                else: external.append(r.request.url); r.abort()
            ctx.route('**/*',route)
            ctx.route_web_socket('**',lambda ws: (external.append(ws.url),ws.close()))
            pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)))
            pg.goto(base);pg.select_option('#view','3d')
            for vp in ({'width':1200,'height':900},{'width':390,'height':844},{'width':844,'height':390},{'width':960,'height':720}):
                pg.set_viewport_size(vp)
                for spin,tilt,zoom in ((30,58,1),(120,34,.5),(275,82,2.4)):
                    # Exercise camera/measure wiring via the real view control, not an exported projector.
                    pg.evaluate('([spin,tilt,zoom])=>Object.assign(__boop.settings,{spin,tilt,zoom})',[spin,tilt,zoom])
                    pg.select_option('#view','2d');pg.select_option('#view','3d')
                    pg.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                    result=pg.evaluate(oracle)
                    assert result['samples'], ('no sampled visible star',engine,vp,result)
                    assert all(s['canvasError']<.02 and s['cssRayError']<.3 for s in result['samples']), (engine,vp,spin,tilt,zoom,result)
                    print('PASS world-ray',engine,vp,spin,tilt,zoom,'stars',len(result['samples']),
                          'max CSS error',round(max(s['cssRayError'] for s in result['samples']),6))
                pg.evaluate('scrollTo(0,100)');pg.wait_for_timeout(80)
                result=pg.evaluate(oracle)
                assert result['samples'] and all(s['canvasError']<.02 and s['cssRayError']<.3 for s in result['samples']), ('scroll',engine,vp,result)
                pg.evaluate('scrollTo(0,0)');pg.wait_for_timeout(50)
            for vp in ({'width':1200,'height':900},{'width':390,'height':844}):
                pg.set_viewport_size(vp);pg.select_option('#levels','8')
                pg.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                result=pg.evaluate(oracle)
                assert result['samples'] and all(s['canvasError']<.02 and s['cssRayError']<.3 for s in result['samples']), ('big tree',engine,vp,result)
                print('PASS big-tree world-ray',engine,vp,'max CSS error',round(max(s['cssRayError'] for s in result['samples']),6))
            # Changing the CSS camera must also change sky intrinsics, not just angles.
            pg.evaluate("""()=>{const w=document.querySelector('#boardWrap');
              w.style.perspective='1400px';w.style.perspectiveOrigin='27% 63%';__boop.rotate(9)}""")
            result=pg.evaluate(oracle)
            assert result['f']==1400 and result['samples'] and all(s['canvasError']<.02 and s['cssRayError']<.3 for s in result['samples']), ('custom CSS intrinsics',engine,result)
            print('PASS custom CSS intrinsics world-ray',engine,'max CSS error',round(max(s['cssRayError'] for s in result['samples']),6))
            assert not external and not errors,(external,errors)
            ctx.close();browser.close()
finally:
    srv.terminate(); srv.wait(timeout=5)
