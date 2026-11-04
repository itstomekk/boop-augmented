"""Signed adversarial v2 room tests, Firefox + Chromium, local fake relay only."""
import functools
import http.server
import json
import pathlib
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

class FakeRelay:
    def __init__(self):
        self.events, self.subs, self.external = [], [], []
    def deliver(self, e):
        if any(x['id'] == e['id'] for x in self.events): return
        self.events.append(e)
        for ws, sid, tag in list(self.subs):
            if any(t == ['t', tag] for t in e['tags']):
                try: ws.send(json.dumps(['EVENT', sid, e]))
                except Exception: pass
    def handler(self, ws, reverse=False):
        if not ws.url.startswith('wss://fake.relay.test'):
            self.external.append(ws.url); ws.close(); return
        def receive(raw):
            m = json.loads(raw)
            if m[0] == 'EVENT':
                self.deliver(m[1]); ws.send(json.dumps(['OK', m[1]['id'], True, '']))
            elif m[0] == 'REQ':
                sid, tag = m[1], m[2]['#t'][0]
                self.subs.append((ws, sid, tag))
                history = list(reversed(self.events)) if reverse else self.events[:]
                for e in history:
                    if ['t', tag] in e['tags']: ws.send(json.dumps(['EVENT', sid, e]))
                ws.send(json.dumps(['EOSE', sid]))
            elif m[0] == 'CLOSE':
                self.subs = [s for s in self.subs if s[:2] != (ws, m[1])]
        ws.on_message(receive)

INIT = """localStorage.setItem('boop-augmented-seen-rules-v1','1');
localStorage.setItem('boop-augmented-settings-v1',JSON.stringify({mode:'pvp'}));
Object.defineProperty(window,'BoopOnline',{configurable:true,set(O){
 const C=O.Client;O.Client=class extends C {constructor(o){super(o);window.testClient=this}};
 Object.defineProperty(window,'BoopOnline',{value:O,configurable:true});
}});"""
def ready(pg, seq):
    pg.wait_for_function('(seq)=>window.__boop?.net?.seq===seq && !__boop.busy', arg=seq)
    assert pg.evaluate('JSON.stringify(__boop.state) === JSON.stringify(__boop.net.view.state)')
    assert pg.locator('#newGame').is_enabled() and pg.locator('#onlineBtn').is_enabled()

def signed(pg, content, offset=0, outsider=False):
    result = pg.evaluate("""({content,offset,outsider})=>{
      const c=testClient,N=c.N,sk=outsider?N.generateSecretKey():c.sk;
      const e=N.finalizeEvent({kind:BoopOnline.KIND,created_at:Math.floor(Date.now()/1000)+offset,
        tags:[['t',BoopOnline.tagFor(c.anchor.nonce)]],
        content:JSON.stringify({v:BoopOnline.VERSION,root:c.anchor.root,...content})},sk);
      return {e,valid:N.verifyEvent(e)};
    }""", dict(content=content, offset=offset, outsider=outsider))
    assert result['valid'], 'test event must have a valid signature'
    return result['e']

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT/'docs')))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}/'
try:
    with sync_playwright() as p:
        for engine in ('firefox', 'chromium'):
            browser = getattr(p, engine).launch()
            relay, contexts, errors, blocked = FakeRelay(), [], [], []
            def page(reverse=False):
                ctx = browser.new_context(viewport={'width':1200, 'height':900})
                contexts.append(ctx); ctx.add_init_script(INIT)
                def route(r):
                    if r.request.url.startswith(URL): r.continue_()
                    else: blocked.append(r.request.url); r.abort()
                ctx.route('**/*', route)
                ctx.route_web_socket('**', lambda ws: relay.handler(ws, reverse))
                pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
                return pg
            A, B = page(), page()
            A.goto(URL+'?relays=wss://fake.relay.test')
            A.click('#onlineBtn'); A.click('#createRoom')
            A.wait_for_function('__boop.net?.view?.host')
            link = A.input_value('#roomLink'); A.click('#onlineDlg form button')
            B.goto(link); B.wait_for_function('__boop.net?.view?.myIdx===1')
            A.wait_for_function('__boop.net?.view?.guest')
            host = A.evaluate('__boop.net.view.host'); guest = B.evaluate('__boop.net.pubkey')
            # All these are signed by the legitimate host and delivered through the relay boundary.
            for i in ('16', 16.5, 4294967312, 9007199254740992, None, -1, 49):
                relay.deliver(signed(A, {'type':'move','seq':0,'a':{'k':'orn','i':i}}, -10))
            relay.deliver(signed(A, {'type':'move','seq':0,'a':{'k':'orn'}}, -10))
            B.wait_for_function('__boop.net.view.rejected===8')
            ready(A,0); ready(B,0)
            print('PASS',engine,'F2 eight signed malformed indices rejected; UI unlocked')
            first = signed(A, {'type':'move','seq':0,'a':{'k':'orn','i':16}})
            fork = signed(A, {'type':'move','seq':0,'a':{'k':'orn','i':17}}, -2)
            relay.deliver(first); ready(A,1); ready(B,1)
            relay.deliver(fork)
            for pg in (A,B):
                pg.wait_for_function('__boop.state.b[17]?.kind === "o" && !__boop.state.b[16] && !__boop.busy')
                ready(pg,1)
            # Outsider attempts both host takeover and guest replacement after play has begun.
            attack = signed(A, {'type':'create','cfg':{'levels':8,'pieces':16}}, -600, True)
            join = signed(A, {'type':'join'}, -700, True)
            admit = signed(A, {'type':'admit','join':join['id'],'guest':join['pubkey']}, -600, True)
            for e in (attack,join,admit): relay.deliver(e)
            A.wait_for_function('(id)=>testClient.events.has(id)',arg=admit['id'])
            for pg in (A,B):
                ready(pg,1)
                assert pg.evaluate('__boop.net.view.host') == host
                assert pg.evaluate('__boop.net.view.guest') == guest
                assert pg.evaluate('__boop.state.L') == 4
            C = page(reverse=True); C.goto(link); ready(C,1)
            assert C.evaluate('__boop.net.view.myIdx') is None
            assert C.evaluate('__boop.net.view.host') == host
            assert C.evaluate('__boop.net.view.guest') == guest
            assert C.evaluate('__boop.state.b[17]?.kind') == 'o'
            A.reload(); ready(A,1)
            assert A.evaluate('__boop.net.view.host') == host
            assert A.evaluate('__boop.net.view.guest') == guest
            assert sum(json.loads(e['content'])['type']=='admit' and e['pubkey']==host for e in relay.events)==1
            print('PASS',engine,'F1 signed backdated create/join/admit ignored, reverse-history spectator and host reload anchored')
            print('PASS',engine,'F3 equal-length fork reconciled across live clients and reverse-history spectator')
            # Reject invalid play booleans without affecting a subsequent valid move.
            for c in ('false',0,1,None):
                relay.deliver(signed(A, {'type':'move','seq':1,'a':{'k':'play','i':38,'c':c}}, -10))
            relay.deliver(signed(A, {'type':'move','seq':1,'a':{'k':'play','i':38}}, -10))
            B.wait_for_function('__boop.net.view.rejected===13'); ready(B,1)
            relay.deliver(signed(A, {'type':'move','seq':1,'a':{'k':'play','i':38,'c':False}}))
            for pg in (A,B,C): ready(pg,2)
            relay.deliver(signed(B, {'type':'move','seq':2,'a':{'k':'orn','i':32}}))
            for pg in (A,B,C): ready(pg,3)
            # Make one actual Web Animation throw; replay must still win and busy must be released.
            B.evaluate("""()=>{const animate=Element.prototype.animate;window.injectedFailures=0;
              Element.prototype.animate=function(...args){Element.prototype.animate=animate;
                injectedFailures++;throw new Error('injected animation failure')};}""")
            relay.deliver(signed(B, {'type':'move','seq':3,'a':{'k':'play','i':37,'c':False}}))
            for pg in (A,B,C): ready(pg,4)
            assert B.evaluate('injectedFailures') == 1
            relay.deliver(signed(A, {'type':'move','seq':4,'a':{'k':'play','i':10,'c':False}}))
            for pg in (A,B,C): ready(pg,5)
            assert A.evaluate('JSON.stringify(__boop.state)') == B.evaluate('JSON.stringify(__boop.state)') == C.evaluate('JSON.stringify(__boop.state)')
            print('PASS',engine,'F2 non-boolean rejection, injected animation failure recovery, subsequent legal move after fork/recovery')
            # Queue a fork while the previous canonical action is still animating.
            D = page(); D.goto(URL+'?relays=wss://fake.relay.test')
            D.click('#onlineBtn'); D.click('#createRoom'); D.wait_for_function('__boop.net?.view?.state')
            D.click('#onlineDlg form button')
            relay.deliver(signed(D, {'type':'move','seq':0,'a':{'k':'orn','i':16}}))
            D.wait_for_function('__boop.busy')
            relay.deliver(signed(D, {'type':'move','seq':0,'a':{'k':'orn','i':17}}, -2))
            D.wait_for_function('__boop.state.b[17]?.kind === "o" && !__boop.busy'); ready(D,1)
            print('PASS',engine,'F3 fork arriving during animation drains pending replay')
            # A fork plus one append must not animate against the incompatible old prefix.
            D.evaluate("""()=>{const c=testClient,callback=c.onChange;c.onChange=()=>{};
              window.flushReplay=()=>{c.onChange=callback;callback(c.view());return __boop.busy};}""")
            relay.deliver(signed(D, {'type':'move','seq':0,'a':{'k':'orn','i':18}}, -4))
            relay.deliver(signed(D, {'type':'move','seq':1,'a':{'k':'play','i':17,'c':False}}))
            D.wait_for_function('testClient.view().seq === 2')
            assert D.evaluate('flushReplay()') is False, 'incompatible prefix must replace synchronously, never animate'
            ready(D,2)
            assert D.evaluate('__boop.state.b[19]?.kind === "o" && __boop.state.b[17]?.kind === "k"')
            print('PASS',engine,'F3 changed prefix plus one appended move atomically replaces board')
            local = page(); local.goto(URL)
            local.wait_for_function('window.__boop')
            local.evaluate("""()=>{const place=BoopLogic.placeOrnament;
              BoopLogic.placeOrnament=function(...args){BoopLogic.placeOrnament=place;
                throw new Error('injected application failure')};}""")
            local.locator('.cell.allowed').first.click()
            local.wait_for_function('!__boop.busy')
            assert local.evaluate('__boop.state.phase === "ornament" && __boop.pieceCount() === 0')
            assert local.locator('#newGame').is_enabled() and local.locator('#onlineBtn').is_enabled()
            local.locator('.cell.allowed').first.click()
            local.wait_for_function('__boop.state.phase === "place" && !__boop.busy')
            print('PASS',engine,'F2 local application exception rolls back and allows retry')
            legacy = page(); before = len(relay.events)
            legacy.goto(URL+'?room=abc123&relays=wss://fake.relay.test')
            legacy.wait_for_function('document.querySelector("#status").textContent.includes("Legacy room")')
            assert legacy.evaluate('__boop.net') is None and len(relay.events)==before
            assert legacy.locator('#newGame').is_enabled()
            legacy.click('#newGame'); assert legacy.evaluate('__boop.state.phase')=='ornament'
            print('PASS',engine,'legacy invitation explicitly refused, no room events emitted, local New game usable')
            assert not relay.external and not blocked and not errors, (relay.external,blocked,errors)
            print('PASS',engine,'no external HTTP/WebSocket attempts, no page errors')
            for ctx in contexts: ctx.close()
            browser.close()
finally:
    server.shutdown(); server.server_close()
print('RESULT PASS')
