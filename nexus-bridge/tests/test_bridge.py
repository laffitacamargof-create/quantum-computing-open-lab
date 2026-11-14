import json, os, subprocess, sys, tempfile, time, threading, urllib.request, urllib.error, shutil
SP = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
HOME = tempfile.mkdtemp(prefix="nxh_"); PORT = 8799; BASE = f"http://127.0.0.1:{PORT}"
env = dict(os.environ, PYTHONPATH=SP + "/stubs")
proc = subprocess.Popen([sys.executable, REPO + "/nexus-bridge/nexus_bridge.py", "--port", str(PORT), "--home", HOME, "--origin", "https://test.example"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print("  ok  ", name)
    else: fail += 1; print("  FAIL", name, extra)
def req(path, body=None, origin=None, token=None, host=None, method=None):
    tok = token if token is not None else TOKEN
    url = BASE + ("/t/" + tok if tok != "" and path != "/health" else "") + path
    h = {"Content-Type": "text/plain"}
    if origin: h["Origin"] = origin
    if host: h["Host"] = host
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(r, timeout=120) as x: return x.status, json.loads(x.read()), x.headers
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read()), e.headers
        except Exception: return e.code, {}, e.headers
def wait_job(j, tmo=600):
    t0 = time.time()
    while time.time() - t0 < tmo:
        s, r, _ = req("/job/" + j)
        if r["state"] != "running": return r
        time.sleep(0.4)
    return {"state": "timeout"}
def pkg(name, origin="official", cid=None):
    d = f"{REPO}/nexus-bridge/tests/fixtures/" + {"qubi": "ble-sample", "local-exec": "exec-sample"}[name] + "/"
    return {"id": cid or name, "name": name, "version": "1.0.0", "origin": origin, "py": open(d + "connector.py").read(), "ui": open(d + "ui.html").read(), "web": open(d + "web.js").read()}
try:
    for _ in range(50):
        try: urllib.request.urlopen(BASE + "/health", timeout=1); break
        except Exception: time.sleep(0.2)
    TOKEN = open(HOME + "/token").read().strip()
    print("health / auth / origin"); 
    s, r, h = req("/health"); check("health", s == 200 and r["service"] == "nexus-bridge")
    s, r, _ = req("/info", token="WRONG"); check("wrong code → 403", s == 403)
    s, r, _ = req("/info", origin="https://evil.example"); check("disallowed origin → 403", s == 403 and "not allowed" in r["error"])
    s, r, h = req("/info", origin="https://test.example"); check("allowed origin ok + PNA header", s == 200 and h.get("Access-Control-Allow-Origin") == "https://test.example" and h.get("Access-Control-Allow-Private-Network") == "true")
    s, r, h = req("/info", origin="https://laffitacamargof-create.github.io"); check("github pages origin ok", s == 200)
    s, r, _ = req("/info", host="evil.example"); check("bad Host → 403", s == 403)
    s, r, _ = req("/info"); check("info: ble available (stub)", s == 200 and r["ble"]["available"] is True)
    print("static validation")
    def inst(p): s, r, _ = req("/install", p); return s, r
    bad = pkg("qubi", "community", "c1"); bad["py"] = "import os\n" + bad["py"]
    s, r = inst(bad); check("community: import os rejected", s == 400 and "not allowed" in r["error"], r)
    bad = pkg("qubi", "community", "c2"); bad["py"] = bad["py"].replace('"ble.read", "ble.notify"', '"ble.scan"'); s, r = inst(bad); check("overlapping permissions rejected", s == 400 and "declared by both" in r["error"], r)
    s, r = inst(pkg("local-exec", "community", "c3")); check("community: proc.run rejected", s == 400, r)
    bad = pkg("qubi", "community", "c4"); bad["py"] += "\nx = getattr(int, 'a')\n"; s, r = inst(bad); check("community: getattr rejected", s == 400, r)
    bad = pkg("qubi", "private", "../x"); s, r = inst(bad); check("bad id rejected", s == 400)
    bad = pkg("qubi", "private", "p1"); bad["py"] = "# requires: --index-url http://evil\n" + bad["py"]; s, r = inst(bad); check("pip option injection rejected", s == 400, r)
    bad = pkg("qubi", "private", "p2"); bad["py"] = bad["py"].replace('@connector.tool("notebook", allow=["ble.read", "ble.notify"])', '@connector.tool("notebook", allow=["ble.read", ble_x])', 1); s, r = inst(bad); check("non-literal permissions rejected", s == 400, r)
    bad = pkg("qubi", "private", "p3"); bad["py"] = "def (:\n"; s, r = inst(bad); check("syntax error reported", s == 400 and "syntax" in r["error"].lower())
    print("qubi install + BLE flow")
    s, r = inst(pkg("qubi", "official")); check("install qubi (official)", s == 200, r)
    j = wait_job(r["job"]); check("install job done", j["state"] == "done", j)
    s, r, _ = req("/info"); check("listed as installed", any(x["id"] == "qubi" for x in r["installed"]))
    def call(c, t, a, args=None): s, r, _ = req("/call", {"connector": c, "tool": t, "action": a, "args": args or {}}); return r
    r = call("qubi", "open_lab", "scan", {"prefix": "Qubi"}); check("scan filters by name + sorts by rssi", r.get("ok") and [d["address"] for d in r["result"]] == ["AA:01", "AA:02"], r)
    r = call("qubi", "open_lab", "scan", {"prefix": ""}); check("scan without prefix lists all", r.get("ok") and len(r["result"]) == 3, r)
    r = call("qubi", "open_lab", "link", {"address": "AA:01"}); check("link returns services", r.get("ok") and r["result"]["services"][0]["characteristics"][0]["uuid"] == "0000bbbb", r)
    r = call("qubi", "open_lab", "linked"); check("linked lists the device", r.get("ok") and r["result"] == [{"address": "AA:01"}], r)
    # SSE
    events = []
    def sse():
        rq = urllib.request.Request(f"{BASE}/t/{TOKEN}/events?connector=qubi", headers={"Origin": "https://test.example"})
        with urllib.request.urlopen(rq, timeout=20) as x:
            for line in x:
                if line.startswith(b"data:"): events.append(json.loads(line[5:])); 
                if len(events) >= 2: return
    th = threading.Thread(target=sse, daemon=True); th.start(); time.sleep(0.5)
    r = call("qubi", "notebook", "read", {"address": "AA:01", "char": "0000bbbb"}); check("read bytes", r.get("ok") and r["result"]["bytes"] == [1, 2, 255], r)
    r = call("qubi", "notebook", "subscribe", {"address": "AA:01", "char": "0000bbbb"}); check("subscribe ok", r.get("ok"), r)
    r = call("qubi", "open_lab", "unlink", {"address": "AA:01"}); check("unlink ok", r.get("ok"), r)
    th.join(8); names = [e["event"] for e in events]; check("SSE delivered ble.notify + unlinked", "ble.notify" in names and "unlinked" in names, names)
    r = call("qubi", "notebook", "read", {"address": "AA:01", "char": "x"}); check("read after unlink → not linked", (not r["ok"]) and r["code"] == "ble-not-linked", r)
    r = call("qubi", "notebook", "scan", {}); check("action of another tool is denied", (not r["ok"]) and r["code"] == "denied", r)
    r = call("qubi", "open_lab", "nope", {}); check("unknown action denied", not r["ok"] and r["code"] == "denied", r)
    r = call("qubi", "open_lab", "link", {}); check("missing argument → bad-args", (not r["ok"]) and r["code"] == "bad-args", r)
    r = call("ghost", "open_lab", "scan"); check("not installed", (not r["ok"]) and r["code"] == "not-installed", r)
    print("permission enforcement at runtime")
    sneaky = {"id": "sneaky", "name": "Sneaky", "version": "0.1.0", "origin": "private", "ui": "", "web": "", "py": '''from nexus import connector
@connector.tool("notebook", allow=["ble.read"])
async def peek(ctx):
    return await ctx.ble.scan()
@connector.tool("notebook", allow=["ble.read"])
async def run(ctx):
    return await ctx.proc.run(cmd=["python", "-c", "print(1)"])
@connector.tool("open_lab", allow=["file.read", "file.write"])
async def store(ctx, name, data):
    await ctx.fs.write(name=name, data=data)
    return {"files": await ctx.fs.list(), "back": await ctx.fs.read(name=name)}
@connector.tool("open_lab", allow=["file.read", "file.write"])
async def evil(ctx):
    return await ctx.fs.read(name="../../token")
@connector.tool("open_lab", allow=["file.read", "file.write"])
async def evil2(ctx):
    return await ctx.fs.write(name="/tmp/pwned", data="x")
@connector.tool("open_lab", allow=["file.read", "file.write"])
async def boom(ctx):
    raise ValueError("custom failure")
@connector.tool("open_lab", allow=["file.read", "file.write"])
async def pr(ctx):
    print("this must not break the protocol")
    return {"n": 1}
'''}
    s, r = inst(sneaky); j = wait_job(r["job"]); check("install private connector", j["state"] == "done", j)
    r = call("sneaky", "notebook", "peek"); check("ble.scan not declared → denied", (not r["ok"]) and r["code"] == "denied", r)
    r = call("sneaky", "notebook", "run"); check("proc.run not declared → denied", (not r["ok"]) and r["code"] == "denied", r)
    r = call("sneaky", "open_lab", "store", {"name": "a/b.txt", "data": "hello"}); check("fs write/list/read inside the data folder", r.get("ok") and r["result"]["back"] == "hello" and "a/" in r["result"]["files"], r)
    r = call("sneaky", "open_lab", "evil"); check("path traversal blocked", (not r["ok"]) and r["code"] == "denied", r)
    r = call("sneaky", "open_lab", "evil2"); check("absolute path blocked", (not r["ok"]) and r["code"] == "denied", r)
    r = call("sneaky", "open_lab", "boom"); check("connector exception reported", (not r["ok"]) and "custom failure" in r["error"], r)
    r = call("sneaky", "open_lab", "pr"); check("print() does not corrupt protocol", r.get("ok") and r["result"] == {"n": 1}, r)
    print("proxy guard")
    for u, n in (("http://example.com/", "http refused"), ("https://127.0.0.1/", "loopback refused"), ("https://localhost:8765/", "localhost refused"), ("https://user:pw@example.com/", "userinfo refused"), ("https://[::1]/", "ipv6 loopback refused"), ("https://169.254.169.254/", "metadata refused")):
        s, r, _ = req("/proxy", {"url": u}); check(n, s == 403, (s, r))
    print("local-exec (real venv + pip)")
    s, r = inst(pkg("local-exec", "official")); 
    if s == 200:
        j = wait_job(r["job"], 900); check("install local-exec with numpy/scipy", j["state"] == "done", j.get("error") or j)
        if j["state"] == "done":
            r = call("local-exec", "open_lab", "run_python", {"code": "import numpy as np, scipy\nprint(float(np.linalg.eigvalsh(np.array([[0,1],[1,0]])).max()))", "timeout": 30}); check("run_python uses the venv (numpy works)", r.get("ok") and r["result"]["stdout"].strip() == "1.0", r)
            r = call("local-exec", "open_lab", "run_python", {"code": "while True: pass", "timeout": 1}); check("timeout enforced", (not r["ok"]) and r["code"] == "timeout", r)
    else: check("local-exec install accepted", False, r)
    print("uninstall")
    s, r, _ = req("/uninstall", {"id": "sneaky"}); check("uninstall ok", s == 200)
    r = call("sneaky", "open_lab", "store"); check("calls fail after uninstall", (not r["ok"]) and r["code"] == "not-installed")
    check("data folder kept on purpose", os.path.isdir(HOME + "/data/sneaky"))
    check("token file is private (0600)", oct(os.stat(HOME + "/token").st_mode & 0o777) == "0o600")
finally:
    proc.terminate()
    try: out = proc.communicate(timeout=5)[0]
    except Exception: out = ""
    shutil.rmtree(HOME, ignore_errors=True)
print(f"\n{ok} passed, {fail} failed")
if fail: print(out[-1500:])
sys.exit(1 if fail else 0)
