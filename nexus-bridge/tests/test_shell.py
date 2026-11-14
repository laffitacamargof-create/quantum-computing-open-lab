"""Shell integration test: Nexus screen, AI source (founder vs Nexus connector) and per-module API slots."""
import json, os, subprocess, sys
from playwright.sync_api import sync_playwright
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
web = subprocess.Popen([sys.executable, "-m", "http.server", "8001", "--bind", "127.0.0.1"], cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ok = fail = 0; seen = {}
def check(n, c, x=""):
    global ok, fail
    if c: ok += 1; print("  ok  ", n)
    else: fail += 1; print("  FAIL", n, x)
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
def mk(name, body):
    def h(route):
        r = route.request
        if r.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
        seen[name] = {"auth": r.headers.get("authorization"), "url": r.url, "method": r.method}
        route.fulfill(status=200, headers=dict(CORS, **{"content-type": "application/json"}), body=json.dumps(body))
    return h
ASK = """(msgs) => new Promise(res => { const id = Math.random(); const f = (e) => { if (e.data && e.data.type === 'OPENQ_AI_RESULT' && e.data.id === id) { removeEventListener('message', f); res(e.data); } };
  addEventListener('message', f); parent.postMessage({type:'OPENQ_AI_CHAT', id, messages: msgs}, '*'); })"""
REQ = """(a) => new Promise(res => { const id = Math.random(); const f = (e) => { if (e.data && e.data.type === 'OPENQ_API_RESULT' && e.data.id === id) { removeEventListener('message', f); res(e.data); } };
  addEventListener('message', f); parent.postMessage(Object.assign({type:'OPENQ_API_REQUEST', id}, a), '*'); })"""
ROUTES = """() => new Promise(res => { const f = (e) => { if (e.data && e.data.type === 'OPENQ_API_ROUTES') { removeEventListener('message', f); res(e.data.routes); } };
  addEventListener('message', f); parent.postMessage({type:'OPENQ_GET_API_ROUTES'}, '*'); })"""
try:
  with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # the editor libraries come from a CDN that is not reachable from the test sandbox → tiny stand-ins (editor not under test)
    STUB = {"codemirror": "export class EditorView{constructor(o){this.state={doc:{toString:()=>'',length:0}}} dispatch(){} static theme(){return []} static updateListener={of(){return []}}; static lineWrapping=[]; }; export const basicSetup=[];",
            "lang-markdown": "export const markdown=()=>[];", "marked": "export const marked={parse:(t)=>t,setOptions(){},use(){}};"}
    def cdn(route):
        u = route.request.url; k = "codemirror" if "/codemirror@" in u else "lang-markdown" if "lang-markdown" in u else "marked" if "/marked@" in u else None
        route.fulfill(status=200, headers=dict(CORS, **{"content-type": "text/javascript"}), body=STUB.get(k, "export default {};"))
    pg.route("https://esm.sh/**", cdn)
    pg.route("**/*supabase.co/**", lambda r: r.fulfill(status=200, headers=CORS, body="[]"))
    pg.route("https://api.deepseek.com/**", mk("ds", {"choices": [{"message": {"content": "pong"}}]}))
    pg.route("https://api.founder-default.com/**", mk("fd", {"who": "founder"}))
    pg.route("https://api.mine.example/**", mk("mine", {"who": "mine"}))
    pg.goto("http://127.0.0.1:8001/index.html"); pg.wait_for_timeout(1500)
    print("shell")
    check("no page errors on load", not errs, errs)
    check("menu has the NEXUS card", "NEXUS" in pg.inner_text("#menu-grid"))
    pg.evaluate("OpenQ.nav('nexus')"); pg.wait_for_timeout(2500)
    fr = next((f for f in pg.frames if "qcol-nexus.html" in f.url), None); check("Nexus module loads inside the shell", fr is not None and fr.locator("#g-ai").count() == 1)
    # create connectors through the real core (same Vault as the module)
    pg.evaluate("""async () => { const N = NexusCore;
      N.Store.upsert(await N.Make.ai({name:'My DeepSeek', provider:'deepseek', apiKey:'sk-mine-999999', tools:['chat','open_lab'], usage:'always'}));
      N.Store.upsert(await N.Make.ext({name:'My Engine', category:'classical', baseUrl:'https://api.mine.example/v1', auth:'bearer', secret:'tok-777', tools:['chat'], usage:'always'})); }""")
    pg.click("#hdr-sources"); pg.wait_for_timeout(300)
    txt = pg.inner_text("#src-body"); check("Sources dialog lists AI + module slots", "AI" in txt and "compiler engine" in txt and "Founder default" in txt, txt[:200])
    check("AI select offers the Nexus connector", "Nexus · My DeepSeek" in pg.inner_text("#src-ai"))
    pg.select_option("#src-ai", index=1); pg.wait_for_timeout(200)
    check("QuantumChat status shows the Nexus source", "Nexus: My DeepSeek" in pg.inner_text("#ai-stxt"), pg.inner_text("#ai-stxt"))
    pg.click("#src-modal .hbtn >> text=Close")
    print("AI through the index space")
    r = fr.evaluate(ASK, [{"role": "user", "content": "ping"}]); check("module asks AI → answered by the Nexus connector", r.get("ok") and r["text"] == "pong" and r["source"] == "nexus", r)
    check("key decrypted from the Vault and sent only to the provider", seen["ds"]["auth"] == "Bearer sk-mine-999999", seen.get("ds"))
    pg.evaluate("NexusCore.Store.patch(NexusCore.Store.byKind('ai')[0].id, r => { r.usage = 'off' })")
    r = fr.evaluate(ASK, [{"role": "user", "content": "ping"}]); check("connector OFF + no founder AI → clear error", (not r["ok"]) and "SOURCES" in r["error"], r)
    pg.evaluate("localStorage.setItem('openq_ai', JSON.stringify({provider:'deepseek', key:'FOUNDER-KEY'})); OpenQ.setAISource(localStorage.getItem('openq_ai_source'))")
    seen.pop("ds", None); r = fr.evaluate(ASK, [{"role": "user", "content": "ping"}]); check("connector OFF → falls back to the founder default", r.get("ok") and seen["ds"]["auth"] == "Bearer FOUNDER-KEY", (r, seen))
    pg.evaluate("NexusCore.Store.patch(NexusCore.Store.byKind('ai')[0].id, r => { r.usage = 'once' })"); seen.pop("ds", None)
    r = fr.evaluate(ASK, [{"role": "user", "content": "1"}]); check("ONCE: first call uses the connector", seen["ds"]["auth"] == "Bearer sk-mine-999999", seen)
    seen.pop("ds", None); r = fr.evaluate(ASK, [{"role": "user", "content": "2"}]); check("ONCE: second call goes back to the founder default", seen["ds"]["auth"] == "Bearer FOUNDER-KEY", seen)
    r = fr.evaluate(ASK, [{"role": "hacker", "content": "x"}]); check("malformed messages rejected", not r["ok"])
    print("API slots per module")
    parent_reg = fr.evaluate("""() => new Promise(res => { const f = (e) => { if (e.data && e.data.type === 'OPENQ_API_ROUTES') { removeEventListener('message', f); res(e.data.routes); } };
        addEventListener('message', f); parent.postMessage({type:'OPENQ_API_REGISTER', slot:'quantum', label:'Nexus · quantum backend', founder:'https://api.founder-default.com/v1'}, '*'); })""")
    check("module registered its own slot", parent_reg.get("quantum", {}).get("source") == "founder", parent_reg)
    r = fr.evaluate(REQ, {"slot": "quantum", "path": "run", "method": "GET"}); check("default route → founder URL", r.get("ok") and r["source"] == "founder" and "founder-default.com/v1/run" in seen["fd"]["url"], (r, seen))
    r = fr.evaluate(REQ, {"slot": "quantum", "path": "https://evil.example/x"}); check("founder route cannot leave its address", not r["ok"], r)
    r = fr.evaluate(REQ, {"slot": "nope", "path": ""}); check("unknown slot rejected", not r["ok"])
    pg.evaluate("OpenQ.setApiRoute('nexus.quantum', 'nexus:' + NexusCore.Store.byKind('ext')[0].id)"); pg.wait_for_timeout(100)
    routes = fr.evaluate(ROUTES); check("module reads which API is selected", routes["quantum"]["source"] == "nexus" and routes["quantum"]["name"] == "My Engine", routes)
    r = fr.evaluate(REQ, {"slot": "quantum", "path": "run"}); check("Nexus route → user's connector with its credential", r.get("ok") and r["source"] == "nexus" and seen["mine"]["auth"] == "Bearer tok-777", (r, seen))
    pg.evaluate("NexusCore.Store.patch(NexusCore.Store.byKind('ext')[0].id, r => { r.usage = 'off' })")
    r = fr.evaluate(REQ, {"slot": "quantum", "path": "run"}); check("connector OFF → refused (no silent fallback)", not r["ok"] and "enabled" in r["error"], r)
    check("no page errors during the run", not errs, errs)
    pg.screenshot(path="/tmp/shell_nexus.png")
    br.close()
finally:
    web.terminate()
print(f"\n{ok} passed, {fail} failed"); sys.exit(1 if fail else 0)
