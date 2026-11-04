"""Real Firefox CPU worker regression; all external network blocked."""
import pathlib, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]; sock.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(root / 'docs')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
url = f'http://127.0.0.1:{port}/index.html'
seed = """() => {
 localStorage.setItem('boop-augmented-seen-rules-v1','1');
 let s = BoopLogic.newGame({levels:8,pieces:16,decor:5,ornaments:6,ornActive:3});
 s.turn=1; s.phase='ornament';
 localStorage.setItem('boop-augmented-save-v1', JSON.stringify({state:s,history:[]}));
 localStorage.setItem('boop-augmented-settings-v1', JSON.stringify({mode:'cpu',levels:8,pieces:'auto',ornaments:'auto',view:'2d'}));
}"""
try:
 for _ in range(100):
  try: socket.create_connection(('127.0.0.1',port),.1).close(); break
  except OSError: time.sleep(.05)
 with sync_playwright() as p:
  browser=p.firefox.launch()
  ctx=browser.new_context(reduced_motion='reduce')
  ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
  ctx.route_web_socket('**', lambda ws: ws.close())
  page=ctx.new_page(); errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
  page.goto(url); page.evaluate(seed)
  page.add_init_script("""window.workerURLs=[]; window.searchMetrics=[]; const W=window.Worker;
  window.Worker=class extends W {constructor(url,...args){super(url,...args);window.workerURLs.push(String(url));}
   postMessage(msg) { let start=performance.now(), ticks=0, last=start, maxGap=0;
     const timer=setInterval(()=>{let now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++},10);
     this.addEventListener('message',()=>{clearInterval(timer);searchMetrics.push({duration:performance.now()-start,ticks,maxGap})},{once:true});
     super.postMessage(msg);
   }};""")
  page.reload(); page.wait_for_function('__boop && __boop.state.turn === 0 && !__boop.busy',timeout=20000)
  assert page.evaluate("workerURLs.some(x=>x.includes('ai-worker.js'))"), 'AI must use a real worker'
  assert page.evaluate('__boop.state.moves') == 1
  metrics=page.evaluate('searchMetrics[0]')
  assert metrics and metrics['ticks'] > 0, f'main thread did not tick during search: {metrics}'
  print(f'PASS real worker executes CPU turn; search wall={metrics["duration"]:.0f}ms, main-thread timer ticks={metrics["ticks"]}, max timer gap={metrics["maxGap"]:.0f}ms')
  page.evaluate(seed)
  page.add_init_script("""window.Worker=class {constructor(){throw new Error('worker unavailable')}};""")
  page.reload(); page.wait_for_function('__boop && __boop.state.turn === 0 && !__boop.busy',timeout=20000)
  assert page.evaluate('__boop.state.moves') == 1
  print('PASS worker construction failure fallback')
  assert not errors, errors
  ctx.close()

  # A real worker fails to load: browser error event must trigger fallback.
  ctx=browser.new_context(reduced_motion='reduce')
  ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
  page=ctx.new_page(); page.goto(url); page.evaluate(seed)
  ctx.add_init_script("""const W=window.Worker; window.Worker=class extends W {constructor(){super('missing-ai-worker.js')}};""")
  page.reload(); page.wait_for_function('__boop && __boop.state.turn === 0 && !__boop.busy',timeout=20000)
  assert page.evaluate('__boop.state.moves') == 1
  print('PASS worker load error fallback')
  ctx.close()

  # A held response simulates a slow worker and allows delivery after cancellation.
  ctx=browser.new_context(reduced_motion='reduce')
  ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
  ctx.route_web_socket('**', lambda ws: ws.close())
  page=ctx.new_page(); page.goto(url); page.evaluate(seed)
  ctx.add_init_script("""window.held=[]; window.Worker=class {
    constructor(){held.push(this)} postMessage(msg){this.msg=msg} terminate(){this.terminated=true}
  };""")
  page.reload(); page.wait_for_function('held.length && held[0].msg')
  assert page.evaluate('__boop.busy && document.querySelector("#newGame").disabled')
  before=page.evaluate('JSON.stringify(__boop.state)')
  page.evaluate('__boop.undo()')
  assert page.evaluate('JSON.stringify(__boop.state)') == before, 'undo must be locked while busy'
  page.evaluate('__boop.newGame()')
  fresh=page.evaluate('JSON.stringify(__boop.state)')
  page.evaluate("held[0].onmessage({data:{id:held[0].msg.id,move:{orn:36,idx:20,cat:false}}})")
  page.wait_for_timeout(100)
  assert page.evaluate('held[0].terminated && JSON.stringify(__boop.state)') == fresh
  print('PASS stale result after new game and busy undo guard')
  # Undo is exercised after cancellation with a real human move in the fresh game.
  page.locator('.cell.allowed').first.click(); page.wait_for_function('!__boop.busy')
  page.evaluate('__boop.undo()'); restored=page.evaluate('JSON.stringify(__boop.state)')
  page.evaluate("held[0].onmessage({data:{id:held[0].msg.id,move:{orn:36,idx:20,cat:false}}})")
  page.wait_for_timeout(100)
  assert page.evaluate('JSON.stringify(__boop.state)') == restored
  print('PASS stale result after undo')
  ctx.close()

  ctx=browser.new_context(reduced_motion='reduce')
  ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
  ctx.route_web_socket('**', lambda ws: None)
  page=ctx.new_page(); page.goto(url); page.evaluate(seed)
  ctx.add_init_script("""window.workerCount=0; const W=window.Worker; window.Worker=class extends W {constructor(...args){super(...args);workerCount++}};""")
  print('START online isolation', flush=True)
  invite='b2.abc123.'+'a'*64+'.'+'b'*64
  page.goto(url+'?room='+invite+'&relays=wss://fake.relay.test', wait_until='domcontentloaded', timeout=15000)
  page.wait_for_function('__boop && __boop.net',timeout=15000); page.wait_for_timeout(500)
  assert page.evaluate('workerCount') == 0, 'online room must not run local CPU'
  print('PASS online room does not start CPU worker')
  ctx.close(); browser.close()
finally:
 srv.terminate(); srv.wait(timeout=5)
print('RESULT PASS')
