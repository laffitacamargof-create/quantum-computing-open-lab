#!/usr/bin/env python3
"""
Nexus local bridge
==================
A tiny program that runs on YOUR computer so the Nexus module of the ecosystem
(a web page) can use Bluetooth, local files and local Python through *local connectors*.

  python nexus_bridge.py                    # then pair it from Nexus (bridge chip, top right)
  python nexus_bridge.py --origin https://my-site.example

Design (read this before trusting it):
  * Listens ONLY on 127.0.0.1 and checks the Host header (no DNS-rebinding).
  * Every request needs the pairing code in the path (/t/<code>/...) AND a website that is on the
    allow-list. The code is created on the first run and kept in ~/.nexus/token.
  * Each installed connector runs in its OWN Python process (own venv when it needs packages).
  * Connector code never imports Bluetooth/OS libraries: it asks `ctx` and the bridge checks the
    permissions the connector declared in its code (@connector.tool("tool", allow=[...])).
  * Community connectors are additionally checked with a strict AST validator before installing.
  * Community code uses a strict AST, runtime audit restrictions and Linux bwrap isolation when available,
    with CPU/memory/file limits where supported. Other operating systems retain the audit restrictions only;
    this is defense-in-depth, not a universal replacement for an OS sandbox. Only install code you trust.
Python >= 3.9, standard library only. Bluetooth needs `pip install bleak` in the bridge's Python.
"""
import argparse, ast, asyncio, base64, concurrent.futures as cf, hmac, http.client, http.server
import ipaddress, json, os, platform, queue, re, secrets, shutil, socket, socketserver, ssl
import subprocess, sys, threading, time, urllib.parse, uuid

VERSION = "1.0.0"
TOOLS = {"open_lab", "notebook", "apps", "app_studio", "chat"}
PERMS = {"ble.scan", "ble.link", "ble.read", "ble.write", "ble.notify", "proc.run", "file.read", "file.write", "net.http"}
# which declared permission a ctx operation needs
OP_PERM = {
    "ble.scan": "ble.scan", "ble.link": "ble.link", "ble.unlink": "ble.link", "ble.linked": "ble.link", "ble.services": "ble.link",
    "ble.read": "ble.read", "ble.write": "ble.write", "ble.notify": "ble.notify", "ble.unnotify": "ble.notify",
    "fs.list": "file.read", "fs.read": "file.read", "fs.write": "file.write", "fs.delete": "file.write",
    "http.request": "net.http", "proc.run": "proc.run", "emit": None, "log": None,
}
COMMUNITY_REQUIRES = {"numpy"}
SAFE_IMPORTS = {"nexus", "numpy", "math", "cmath", "json", "re", "time", "typing", "dataclasses", "collections",
                "itertools", "functools", "statistics", "random", "base64", "hashlib", "datetime", "struct", "enum", "decimal", "fractions", "string", "textwrap"}
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "open", "globals", "locals", "vars", "getattr", "setattr", "delattr", "input", "breakpoint", "memoryview"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
REQ_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-\[\],<>=!~ ]{0,80}$")
MAX_CODE = 60000
LOCAL_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1)(:(\d+))?$")
LOCAL_PORTS = {3000, 4173, 5173, 5500, 5501, 8000, 8080, 8765, 8888}


class BridgeError(Exception):
    def __init__(self, msg, code="bridge", status=400):
        super().__init__(msg); self.code = code; self.status = status


# ───────────────────────── code validation ─────────────────────────
def analyze(code, mode):
    """mode: 'official' | 'private' | 'community'. Returns dict(tools, actions, requires, errors)."""
    res = {"tools": {}, "actions": {}, "requires": [], "errors": []}
    if len(code) > MAX_CODE:
        res["errors"].append("Python code is too large"); return res
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        res["errors"].append("Python syntax error on line %s: %s" % (e.lineno, e.msg)); return res

    def is_dec(d):
        return isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr == "tool" and isinstance(d.func.value, ast.Name) and d.func.value.id == "connector"

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                if not is_dec(d):
                    continue
                ok = (len(d.args) == 1 and isinstance(d.args[0], ast.Constant) and isinstance(d.args[0].value, str)
                      and len(d.keywords) == 1 and d.keywords[0].arg == "allow" and isinstance(d.keywords[0].value, (ast.List, ast.Tuple))
                      and all(isinstance(x, ast.Constant) and isinstance(x.value, str) for x in d.keywords[0].value.elts))
                if not ok:
                    res["errors"].append('Line %d: use @connector.tool("name", allow=["perm", ...]) with plain text values' % d.lineno); continue
                t = d.args[0].value; perms = [x.value for x in d.keywords[0].value.elts]
                res["tools"].setdefault(t, [])
                for p in perms:
                    if p not in res["tools"][t]: res["tools"][t].append(p)
                res["actions"].setdefault(node.name, [])
                if t not in res["actions"][node.name]: res["actions"][node.name].append(t)
    if not res["tools"]:
        res["errors"].append("Declare at least one @connector.tool(...)")
    owner = {}
    for t, perms in res["tools"].items():
        if t not in TOOLS: res["errors"].append('Unknown tool "%s"' % t)
        if not perms: res["errors"].append('Tool "%s" declares no permissions' % t)
        for p in perms:
            if p not in PERMS: res["errors"].append('Unknown permission "%s"' % p)
            elif p in owner and owner[p] != t: res["errors"].append('"%s" is declared by both %s and %s' % (p, owner[p], t))
            else: owner[p] = t
            if mode == "community" and p == "proc.run":
                res["errors"].append('"proc.run" is not allowed in community connectors')
    for m in re.finditer(r"^\s*#\s*requires\s*:\s*(.+)$", code, re.I | re.M):
        for r in m.group(1).split(","):
            r = r.strip()
            if r and r not in res["requires"]: res["requires"].append(r)
    for r in res["requires"]:
        if not REQ_RE.match(r) or r.startswith("-"):
            res["errors"].append('Invalid package requirement "%s"' % r)
        elif mode == "community" and re.split(r"[<>=!~\[ ]", r)[0].lower() not in COMMUNITY_REQUIRES:
            res["errors"].append('Package "%s" is not allowed in community connectors' % r)
    if mode == "community":
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    if a.name.split(".")[0] not in SAFE_IMPORTS: res["errors"].append('Line %d: import "%s" is not allowed in community connectors' % (node.lineno, a.name))
            elif isinstance(node, ast.ImportFrom):
                if node.level or (node.module or "").split(".")[0] not in SAFE_IMPORTS:
                    res["errors"].append('Line %d: import from "%s" is not allowed in community connectors' % (node.lineno, node.module))
            elif isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Name) and f.id in FORBIDDEN_CALLS: res["errors"].append("Line %d: %s() is not allowed in community connectors" % (node.lineno, f.id))
                elif isinstance(f, ast.Attribute) and f.attr == "format" and isinstance(f.value, ast.Constant) and isinstance(f.value.value, str):
                    if re.search(r"\{[^{}]*(?:\.|\[)", f.value.value):
                        res["errors"].append("Line %d: format fields cannot access object attributes or indexes in community connectors" % node.lineno)
            elif isinstance(node, ast.Attribute):
                if (node.attr.startswith("__") and node.attr.endswith("__")) or node.attr in {"sys","os","subprocess","socket","modules","loader","builtins","system","popen","connect","load","save","savetxt","loadtxt","genfromtxt","fromfile","memmap","ctypeslib","f2py"}:
                    res["errors"].append("Line %d: access to %s is not allowed in community connectors" % (node.lineno, node.attr))
            elif isinstance(node, ast.Name):
                if node.id in ("__builtins__", "__loader__", "__spec__"): res["errors"].append("Line %d: %s is not allowed in community connectors" % (node.lineno, node.id))
    res["errors"] = list(dict.fromkeys(res["errors"]))
    return res


# ───────────────────────── guarded outbound HTTP ─────────────────────────
def _public(ip):
    a = ipaddress.ip_address(ip)
    if a.version == 6 and a.ipv4_mapped: a = a.ipv4_mapped
    return a.is_global


def _resolve_public(host, port):
    try:
        ips = [i[4][0] for i in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]
    except socket.gaierror:
        raise BridgeError("The service hostname could not be resolved", "dns", 502)
    if not ips or not all(_public(ip) for ip in ips):
        raise BridgeError("Blocked: that address points to this computer or a private network", "denied", 403)
    return ips[0]


def _ssl_context():
    return ssl.create_default_context()


def guarded_fetch(url, method="GET", headers=None, body=None, timeout=30, max_bytes=5_000_000):
    u = urllib.parse.urlsplit(str(url))
    if u.scheme != "https" or not u.hostname or "@" in u.netloc:
        raise BridgeError("Only plain https:// addresses are allowed", "denied", 403)
    method = str(method or "GET").upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"): raise BridgeError("Method not allowed", "denied", 403)
    host, port = u.hostname, u.port or 443
    ip = _resolve_public(host, port)
    ctx = _ssl_context()

    class Pinned(http.client.HTTPSConnection):  # connect to the address we just checked (no DNS re-resolution)
        def connect(self):
            sock = socket.create_connection((ip, port), self.timeout)
            self.sock = ctx.wrap_socket(sock, server_hostname=host)

    conn = Pinned(host, port, timeout=max(1, min(int(timeout or 30), 120)), context=ctx)
    hdrs = {str(k): str(v) for k, v in (headers or {}).items() if str(k).lower() not in ("host", "content-length", "connection", "transfer-encoding")}
    path = (u.path or "/") + ("?" + u.query if u.query else "")
    try:
        conn.request(method, path, body=body.encode() if isinstance(body, str) else body, headers=hdrs)
        r = conn.getresponse(); data = r.read(max_bytes + 1)
        if len(data) > max_bytes: raise BridgeError("Response too large", "network", 502)
        return {"status": r.status, "headers": {k: v for k, v in r.getheaders()}, "body": data.decode("utf-8", "replace")}
    except (OSError, http.client.HTTPException) as e:
        raise BridgeError("Network error: %s" % e, "network", 502)
    finally:
        conn.close()


# ───────────────────────── Bluetooth (bleak, lazy) ─────────────────────────
class BLE:
    def __init__(self, events):
        self.events = events; self.loop = None; self.clients = {}; self.notifs = {}; self.lock = threading.Lock()

    def available(self):
        try:
            import bleak  # noqa
            return True, ""
        except Exception as e:
            return False, "bleak is not installed (pip install bleak)" if isinstance(e, ImportError) else str(e)

    def _loop(self):
        with self.lock:
            if self.loop is None:
                self.loop = asyncio.new_event_loop()
                threading.Thread(target=self.loop.run_forever, daemon=True).start()
        return self.loop

    def run(self, coro, timeout=60):
        ok, why = self.available()
        if not ok:
            coro.close(); raise BridgeError("Bluetooth is not available: " + why, "ble-unavailable", 503)
        try:
            return asyncio.run_coroutine_threadsafe(coro, self._loop()).result(timeout)
        except cf.TimeoutError:
            raise BridgeError("Bluetooth operation timed out", "ble-timeout", 504)
        except BridgeError:
            raise
        except Exception as e:
            raise BridgeError("Bluetooth: %s" % (str(e) or e.__class__.__name__), "ble", 502)

    @staticmethod
    def _bytes(v):
        if isinstance(v, (bytes, bytearray)): return bytes(v)
        if isinstance(v, list): return bytes(int(x) & 255 for x in v)
        if isinstance(v, dict) and "hex" in v: return bytes.fromhex(v["hex"])
        if isinstance(v, str): return v.encode()
        raise BridgeError("data must be a list of bytes, {hex:...} or text", "bad-args")

    def _client(self, cid, address):
        c = self.clients.get((cid, address))
        if not c: raise BridgeError("Device %s is not linked. Link it first." % address, "ble-not-linked", 409)
        return c

    async def _scan(self, timeout, prefix):
        from bleak import BleakScanner
        found = await BleakScanner.discover(timeout=timeout, return_adv=True)
        items = found.values() if isinstance(found, dict) else [(d, None) for d in found]
        out = []
        for d, adv in items:
            name = getattr(d, "name", None) or (getattr(adv, "local_name", None) if adv else None) or ""
            if prefix and not name.lower().startswith(prefix.lower()): continue
            out.append({"address": d.address, "name": name, "rssi": getattr(adv, "rssi", None) if adv else getattr(d, "rssi", None)})
        out.sort(key=lambda x: -(x["rssi"] if isinstance(x["rssi"], (int, float)) else -999))
        return out

    @staticmethod
    def _services(client):
        out = []
        for s in client.services:
            out.append({"uuid": s.uuid, "characteristics": [{"uuid": c.uuid, "properties": list(c.properties)} for c in s.characteristics]})
        return out

    async def _link(self, cid, address):
        from bleak import BleakClient
        if (cid, address) in self.clients and self.clients[(cid, address)].is_connected:
            return self._services(self.clients[(cid, address)])
        def gone(_c):
            self.clients.pop((cid, address), None); self.events.publish(cid, "ble.disconnected", {"address": address})
        client = BleakClient(address, disconnected_callback=gone)
        await client.connect(timeout=20)
        self.clients[(cid, address)] = client
        return self._services(client)

    async def _unlink(self, cid, address):
        c = self.clients.pop((cid, address), None)
        if c: await c.disconnect()
        return True

    async def _read(self, cid, address, char):
        return bytes(await self._client(cid, address).read_gatt_char(char))

    async def _write(self, cid, address, char, data, response):
        await self._client(cid, address).write_gatt_char(char, data, response=response); return True

    async def _notify(self, cid, address, char):
        def cb(_s, data):
            self.events.publish(cid, "ble.notify", {"address": address, "char": char, "hex": bytes(data).hex(), "bytes": list(bytes(data))})
        await self._client(cid, address).start_notify(char, cb); self.notifs[(cid, address, char)] = True; return True

    async def _unnotify(self, cid, address, char):
        await self._client(cid, address).stop_notify(char); self.notifs.pop((cid, address, char), None); return True

    def op(self, cid, op, a):
        addr, char = a.get("address"), a.get("char")
        if op == "ble.scan": return self.run(self._scan(min(float(a.get("timeout", 4)), 15), str(a.get("prefix") or "")), 30)
        if op == "ble.linked": return [{"address": k[1]} for k in self.clients if k[0] == cid and self.clients[k].is_connected]
        if not addr: raise BridgeError("address is required", "bad-args")
        if op == "ble.link": return self.run(self._link(cid, str(addr)), 30)
        if op == "ble.unlink": return self.run(self._unlink(cid, str(addr)), 15)
        if op == "ble.services": return self._services(self._client(cid, str(addr)))
        if not char: raise BridgeError("char is required", "bad-args")
        if op == "ble.read": b = self.run(self._read(cid, str(addr), str(char)), 15); return {"hex": b.hex(), "bytes": list(b)}
        if op == "ble.write": return self.run(self._write(cid, str(addr), str(char), self._bytes(a.get("data")), bool(a.get("response", True))), 15)
        if op == "ble.notify": return self.run(self._notify(cid, str(addr), str(char)), 15)
        if op == "ble.unnotify": return self.run(self._unnotify(cid, str(addr), str(char)), 15)
        raise BridgeError("Unknown operation " + op, "bad-args")

    def cleanup(self, cid):
        for (c, a) in [k for k in self.clients if k[0] == cid]:
            try: self.run(self._unlink(c, a), 10)
            except Exception: self.clients.pop((c, a), None)


# ───────────────────────── events (SSE) ─────────────────────────
class Events:
    def __init__(self): self.subs = {}; self.lock = threading.Lock()
    def subscribe(self, cid):
        q = queue.Queue(maxsize=500)
        with self.lock: self.subs.setdefault(cid, []).append(q)
        return q
    def unsubscribe(self, cid, q):
        with self.lock:
            if q in self.subs.get(cid, []): self.subs[cid].remove(q)
    def publish(self, cid, event, data):
        with self.lock: qs = list(self.subs.get(cid, []))
        for q in qs:
            try: q.put_nowait({"event": event, "data": data})
            except queue.Full: pass


# ───────────────────────── the code that runs INSIDE each connector process ─────────────────────────
RUNNER = r'''
import sys, os, json, asyncio, threading, importlib.util, types, contextvars, inspect, traceback
_out = sys.stdout
sys.stdout = sys.stderr            # print() in connector code goes to the log, never to the protocol channel
_wl = threading.Lock()
def _send(o):
    with _wl:
        _out.write(json.dumps(o, default=_dflt) + "\n"); _out.flush()
def _dflt(o):
    if isinstance(o, (bytes, bytearray)): return bytes(o).hex()
    if hasattr(o, "tolist"): return o.tolist()
    if hasattr(o, "item"): return o.item()
    if isinstance(o, (set, tuple)): return list(o)
    return str(o)

class NexusError(Exception):
    def __init__(self, msg, code="connector"): super().__init__(msg); self.code = code

REG = {}
class _Connector:
    def tool(self, name, allow=()):
        def deco(fn):
            REG.setdefault(name, {})[fn.__name__] = fn
            return fn
        return deco
_m = types.ModuleType("nexus"); _m.connector = _Connector(); _m.NexusError = NexusError
sys.modules["nexus"] = _m

_tool = contextvars.ContextVar("tool", default=None)
_loop = asyncio.new_event_loop()
_pending = {}; _n = [0]

async def _rpc(op, args):
    _n[0] += 1; i = _n[0]
    fut = _loop.create_future(); _pending[i] = fut
    _send({"t": "ctx", "id": i, "op": op, "tool": _tool.get(), "args": args})
    return await fut

class _Ns:
    def __init__(self, prefix): self._p = prefix
    def __getattr__(self, name):
        async def f(**kw): return await _rpc(self._p + "." + name, kw)
        return f
class Ctx:
    def __init__(self):
        self.ble = _Ns("ble"); self.fs = _Ns("fs"); self.http = _Ns("http"); self.proc = _Ns("proc")
    @property
    def tool(self): return _tool.get()
    async def emit(self, event, data=None): await _rpc("emit", {"event": event, "data": data})
    async def log(self, *a): await _rpc("log", {"text": " ".join(str(x) for x in a)})
ctx = Ctx()

async def _handle(i, tool, action, args):
    tok = _tool.set(tool)
    try:
        fn = REG.get(tool, {}).get(action)
        if fn is None: raise NexusError('"%s" is not an action of tool "%s"' % (action, tool), "denied")
        r = fn(ctx, **(args or {}))
        if inspect.isawaitable(r): r = await r
        _send({"t": "result", "id": i, "ok": True, "result": r})
    except TypeError as e:
        _send({"t": "result", "id": i, "ok": False, "code": "bad-args", "error": str(e)})
    except Exception as e:
        _send({"t": "result", "id": i, "ok": False, "code": getattr(e, "code", "connector"), "error": str(e) or e.__class__.__name__})
    finally:
        _tool.reset(tok)

def _reader():
    for line in sys.stdin:
        try: m = json.loads(line)
        except Exception: continue
        if m.get("t") == "call":
            asyncio.run_coroutine_threadsafe(_handle(m["id"], m["tool"], m["action"], m.get("args")), _loop)
        elif m.get("t") == "ctx_result":
            f = _pending.pop(m["id"], None)
            if f:
                def _set(f=f, m=m):
                    if m.get("ok"): f.set_result(m.get("result"))
                    else: f.set_exception(NexusError(m.get("error", "failed"), m.get("code", "connector")))
                _loop.call_soon_threadsafe(_set)
    os._exit(0)  # bridge closed the pipe

def main(path):
    if os.environ.get("NEXUS_COMMUNITY_CONNECTOR") == "1":
        if os.environ.get("NEXUS_BWRAP_ACTIVE") != "1":
            import builtins
            _original_import = builtins.__import__
            def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
                if str(name).split(".")[0] in {"numpy", "scipy"}:
                    raise ImportError("Native numerical packages require the Linux bwrap community sandbox")
                return _original_import(name, globals, locals, fromlist, level)
            builtins.__import__ = _restricted_import
        data_root = os.path.realpath(os.environ.get("NEXUS_CONNECTOR_DATA", os.getcwd()))
        python_root = os.path.realpath(sys.prefix)
        connector_root = os.path.realpath(os.path.dirname(path))
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
            resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 10 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        except (ImportError, AttributeError, OSError, ValueError):
            pass
        def _community_audit(event, args):
            if event in ("subprocess.Popen", "os.system", "os.posix_spawn", "socket.connect", "socket.getaddrinfo"):
                raise PermissionError("Community connector blocked by runtime security policy: " + event)
            if event == "open" and args:
                target = args[0]
                if isinstance(target, (str, bytes, os.PathLike)):
                    real = os.path.realpath(os.fsdecode(target))
                    try:
                        allowed = (os.path.commonpath((real, data_root)) == data_root or os.path.commonpath((real, python_root)) == python_root or os.path.commonpath((real, connector_root)) == connector_root)
                    except ValueError:
                        allowed = False
                    if not allowed:
                        raise PermissionError("Community connector file access is restricted to its data folder")
        sys.addaudithook(_community_audit)
    try:
        spec = importlib.util.spec_from_file_location("connector_main", path)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    except BaseException:
        _send({"t": "fatal", "error": traceback.format_exc(limit=3)}); os._exit(3)
    _send({"t": "ready", "registry": {t: sorted(a) for t, a in REG.items()}})
    threading.Thread(target=_reader, daemon=True).start()
    _loop.run_forever()

main(sys.argv[1])
'''


# ───────────────────────── worker = one connector process ─────────────────────────
class Worker:
    def __init__(self, br, cid):
        self.br = br; self.cid = cid; self.proc = None; self.pending = {}; self.n = 0; self.lock = threading.Lock()
        self.ready = threading.Event(); self.fatal = None; self.tail = []; self.last = time.time()

    def start(self):
        d = self.br.cdir(self.cid)
        py = os.path.join(d, "venv", "Scripts" if os.name == "nt" else "bin", "python.exe" if os.name == "nt" else "python")
        if not os.path.exists(py): py = sys.executable
        data = self.br.ddir(self.cid); os.makedirs(data, exist_ok=True)
        env = {k: v for k, v in os.environ.items() if k in ("PATH", "SYSTEMROOT", "TEMP", "TMP", "LANG", "LC_ALL", "PYTHONPATH_NEXUS")}
        env["PYTHONIOENCODING"] = "utf-8"
        meta = self.br.meta(self.cid) or {}
        env["NEXUS_COMMUNITY_CONNECTOR"] = "1" if meta.get("origin") == "community" else "0"
        env["NEXUS_CONNECTOR_DATA"] = os.path.realpath(data)
        if meta.get("origin") == "community":
            env["HOME"] = os.path.realpath(data)
            env["TMPDIR"] = os.path.realpath(data)
        runner_path = os.path.join(self.br.home, "runner.py")
        runner_fd = None
        command = [py, "-u", runner_path, os.path.join(d, "connector.py")]
        if meta.get("origin") == "community" and sys.platform.startswith("linux"):
            bwrap = shutil.which("bwrap")
            if bwrap:
                env["NEXUS_BWRAP_ACTIVE"] = "1"
                env["NEXUS_CONNECTOR_DATA"] = "/workspace"
                env["HOME"] = "/workspace"
                env["TMPDIR"] = "/tmp"
                sandbox_py = py
                try:
                    if os.path.commonpath((os.path.abspath(py), os.path.abspath(d))) == os.path.abspath(d):
                        sandbox_py = "/connector/" + os.path.relpath(os.path.abspath(py), os.path.abspath(d))
                except ValueError:
                    pass
                mount_dirs = [item for target in ("/connector", "/workspace") if not os.path.exists(target) for item in ("--dir", target)]
                hidden_homes = [item for target in ("/home", "/root") if os.path.isdir(target) for item in ("--tmpfs", target)]
                runner_fd = os.open(runner_path, os.O_RDONLY)
                command = [bwrap, "--unshare-all", "--die-with-parent", "--ro-bind", "/", "/"] + mount_dirs + [
                           "--ro-bind", d, "/connector", "--bind", data, "/workspace",
                           "--ro-bind-data", str(runner_fd), "/runner.py"] + hidden_homes + [
                           "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--chdir", "/workspace", "--",
                           sandbox_py, "-u", "/runner.py", "/connector/connector.py"]
        try:
            self.proc = subprocess.Popen(command, stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=data, env=env,
                                         text=True, encoding="utf-8", bufsize=1,
                                         pass_fds=(runner_fd,) if runner_fd is not None else ())
        finally:
            if runner_fd is not None:
                os.close(runner_fd)
        threading.Thread(target=self._read, daemon=True).start(); threading.Thread(target=self._err, daemon=True).start()
        if not self.ready.wait(25) or self.fatal:
            err = self.fatal or "The connector did not start. " + " | ".join(self.tail[-3:])
            self.stop(); raise BridgeError(err, "connector-start", 500)

    def _err(self):
        for line in self.proc.stderr:
            self.tail.append(line.rstrip()); self.tail = self.tail[-30:]

    def _read(self):
        for line in self.proc.stdout:
            try: m = json.loads(line)
            except Exception: continue
            t = m.get("t")
            if t == "ready": self.ready.set()
            elif t == "fatal": self.fatal = m.get("error", "failed"); self.ready.set()
            elif t == "result":
                f = self.pending.pop(m["id"], None)
                if f: f.set_result(m)
            elif t == "ctx": self.br.pool.submit(self._ctx, m)
        for f in list(self.pending.values()):
            if not f.done(): f.set_result({"ok": False, "code": "connector-exit", "error": "The connector stopped. " + " | ".join(self.tail[-3:])})
        self.pending.clear()

    def _write(self, o):
        with self.lock:
            self.proc.stdin.write(json.dumps(o) + "\n"); self.proc.stdin.flush()

    def _ctx(self, m):
        try:
            res = self.br.ctx_op(self.cid, m.get("tool"), m["op"], m.get("args") or {})
            self._write({"t": "ctx_result", "id": m["id"], "ok": True, "result": res})
        except BridgeError as e:
            self._write({"t": "ctx_result", "id": m["id"], "ok": False, "code": e.code, "error": str(e)})
        except Exception as e:
            self._write({"t": "ctx_result", "id": m["id"], "ok": False, "code": "bridge", "error": str(e) or e.__class__.__name__})

    def call(self, tool, action, args, timeout=120):
        if not self.proc or self.proc.poll() is not None: raise BridgeError("The connector is not running", "connector-exit", 500)
        self.n += 1; i = self.n; f = cf.Future(); self.pending[i] = f; self.last = time.time()
        try: self._write({"t": "call", "id": i, "tool": tool, "action": action, "args": args})
        except Exception: self.pending.pop(i, None); raise BridgeError("The connector stopped", "connector-exit", 500)
        try: return f.result(timeout)
        except cf.TimeoutError:
            self.pending.pop(i, None); raise BridgeError("The connector took too long (> %ds)" % timeout, "timeout", 504)

    def stop(self):
        try:
            if self.proc and self.proc.poll() is None:
                try: self.proc.stdin.close()
                except Exception: pass
                try: self.proc.wait(2)
                except Exception: self.proc.kill()
        except Exception: pass


# ───────────────────────── the bridge ─────────────────────────
class Bridge:
    def __init__(self, home, origins):
        self.home = home; self.origins = set(origins); self.events = Events(); self.ble = BLE(self.events)
        self.pool = cf.ThreadPoolExecutor(8); self.workers = {}; self.jobs = {}; self.wlock = threading.Lock()
        for sub in ("connectors", "data"): os.makedirs(os.path.join(home, sub), exist_ok=True)
        with open(os.path.join(home, "runner.py"), "w", encoding="utf-8") as f: f.write(RUNNER)
        tp = os.path.join(home, "token")
        if os.path.exists(tp): self.token = open(tp).read().strip()
        else: self.token = ""
        if not self.token: self.rotate()

    def rotate(self):
        self.token = secrets.token_urlsafe(18)
        p = os.path.join(self.home, "token"); fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f: f.write(self.token)

    def cdir(self, cid): return os.path.join(self.home, "connectors", cid)
    def ddir(self, cid): return os.path.join(self.home, "data", cid)

    def origin_ok(self, o):
        if o in self.origins: return True
        m = LOCAL_ORIGIN.match(o or "")
        return bool(m and int(m.group(3) or 80) in LOCAL_PORTS)

    def meta(self, cid):
        try:
            with open(os.path.join(self.cdir(cid), "meta.json"), encoding="utf-8") as f: return json.load(f)
        except Exception: return None

    def installed(self):
        out = []
        for cid in sorted(os.listdir(os.path.join(self.home, "connectors"))):
            m = self.meta(cid)
            if m: out.append({k: m.get(k) for k in ("id", "name", "version", "origin", "tools", "installed_at")})
        return out

    # ── install ──
    def start_install(self, pkg):
        cid = str(pkg.get("id", ""))
        if not ID_RE.match(cid): raise BridgeError("Invalid connector id")
        origin = pkg.get("origin", "private")
        if origin not in ("official", "private", "community"): raise BridgeError("Invalid origin")
        for k in ("py", "ui", "web"):
            if not isinstance(pkg.get(k, ""), str) or len(pkg.get(k, "")) > MAX_CODE: raise BridgeError("The %s code is missing or too large" % k)
        res = analyze(pkg.get("py", ""), origin)   # re-checked here: never trust the web page
        if res["errors"]: raise BridgeError("Rejected: " + " · ".join(res["errors"][:4]), "invalid")
        job = uuid.uuid4().hex[:12]; self.jobs[job] = {"state": "running", "log": [], "error": ""}
        threading.Thread(target=self._install, args=(job, cid, pkg, res), daemon=True).start()
        return job

    def _install(self, job, cid, pkg, res):
        J = self.jobs[job]; log = J["log"].append
        try:
            log("Checking the code… OK (%d tool%s)" % (len(res["tools"]), "" if len(res["tools"]) == 1 else "s"))
            self.stop_worker(cid)
            d = self.cdir(cid); os.makedirs(d, exist_ok=True)
            old = self.meta(cid) or {}
            for name, key in (("connector.py", "py"), ("ui.html", "ui"), ("web.js", "web")):
                with open(os.path.join(d, name), "w", encoding="utf-8") as f: f.write(pkg.get(key, ""))
            log("Files written")
            req = res["requires"]
            vdir = os.path.join(d, "venv")
            if req:
                if old.get("requires") != req and os.path.isdir(vdir): shutil.rmtree(vdir, ignore_errors=True)
                if not os.path.isdir(vdir):
                    log("Creating a private Python environment…")
                    r = subprocess.run([sys.executable, "-m", "venv", vdir], capture_output=True, text=True, timeout=300)
                    if r.returncode: raise BridgeError("Could not create the Python environment: " + (r.stderr or r.stdout)[-300:], "install")
                py = os.path.join(vdir, "Scripts" if os.name == "nt" else "bin", "python.exe" if os.name == "nt" else "python")
                log("Installing packages: " + ", ".join(req))
                p = subprocess.Popen([py, "-m", "pip", "install", "--disable-pip-version-check", "--no-input"] + req, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                t0 = time.time()
                for line in p.stdout:
                    line = line.strip()
                    if line: log(line[:140])
                    if time.time() - t0 > 900: p.kill(); raise BridgeError("pip took too long", "install")
                if p.wait(): raise BridgeError("pip could not install the packages (see log)", "install")
            elif os.path.isdir(vdir): shutil.rmtree(vdir, ignore_errors=True)
            with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
                json.dump({"id": cid, "name": str(pkg.get("name", cid))[:80], "version": str(pkg.get("version", "0.0.0"))[:20], "origin": pkg.get("origin", "private"),
                           "requires": req, "perms": res["tools"], "tools": sorted(res["tools"]), "actions": res["actions"], "installed_at": int(time.time())}, f)
            log("Starting the connector to verify it…")
            self.get_worker(cid)
            log("Installed")
            J["state"] = "done"
        except BridgeError as e:
            self.stop_worker(cid); J["state"] = "error"; J["error"] = str(e)
        except Exception as e:
            self.stop_worker(cid); J["state"] = "error"; J["error"] = "%s: %s" % (e.__class__.__name__, e)

    def uninstall(self, cid):
        if not ID_RE.match(cid): raise BridgeError("Invalid connector id")
        self.stop_worker(cid)
        shutil.rmtree(self.cdir(cid), ignore_errors=True)   # code goes; the connector's data folder is kept on purpose
        return True

    # ── running ──
    def get_worker(self, cid):
        with self.wlock:
            w = self.workers.get(cid)
            if w and w.proc and w.proc.poll() is None: return w
            if not self.meta(cid): raise BridgeError("Connector is not installed", "not-installed", 404)
            w = Worker(self, cid); self.workers[cid] = w
        try: w.start()
        except BridgeError:
            self.workers.pop(cid, None); raise
        return w

    def stop_worker(self, cid):
        w = self.workers.pop(cid, None)
        self.ble.cleanup(cid)
        if w: w.stop()

    def call(self, cid, tool, action, args):
        m = self.meta(cid)
        if not m: return {"ok": False, "code": "not-installed", "error": "Connector is not installed"}
        if tool not in m["perms"] or tool not in (m["actions"].get(action) or []):
            return {"ok": False, "code": "denied", "error": '"%s" is not an action of tool "%s" in this connector' % (action, tool)}
        try:
            r = self.get_worker(cid).call(tool, action, args or {})
        except BridgeError as e:
            return {"ok": False, "code": e.code, "error": str(e)}
        r.pop("t", None); r.pop("id", None); return r

    # ── what a connector may do (called by the worker's `ctx`) ──
    def ctx_op(self, cid, tool, op, a):
        m = self.meta(cid)
        if not m: raise BridgeError("Connector is not installed", "not-installed")
        if op not in OP_PERM: raise BridgeError("Unknown operation " + str(op), "bad-args")
        need = OP_PERM[op]
        if need and need not in (m["perms"].get(tool) or []):
            raise BridgeError('Permission "%s" is not declared for tool "%s" in this connector' % (need, tool), "denied", 403)
        if op == "emit": self.events.publish(cid, str(a.get("event", "message"))[:60], a.get("data")); return True
        if op == "log": sys.stderr.write("[%s] %s\n" % (cid, str(a.get("text", ""))[:500])); return True
        if op.startswith("ble."): return self.ble.op(cid, op, a)
        if op.startswith("fs."): return self.fs(cid, op, a)
        if op == "http.request": return guarded_fetch(a.get("url"), a.get("method", "GET"), a.get("headers"), a.get("body"), a.get("timeout", 30))
        if op == "proc.run": return self.proc_run(cid, a)
        raise BridgeError("Unknown operation " + op, "bad-args")

    def fs(self, cid, op, a):
        root = os.path.realpath(self.ddir(cid)); os.makedirs(root, exist_ok=True)
        rel = str(a.get("name", "") or "")
        p = os.path.realpath(os.path.join(root, rel))
        if os.path.isabs(rel) or (p != root and not p.startswith(root + os.sep)): raise BridgeError("Path outside the connector's data folder", "denied", 403)
        if op == "fs.list":
            if not os.path.isdir(p): return []
            return sorted(e + ("/" if os.path.isdir(os.path.join(p, e)) else "") for e in os.listdir(p))
        if op == "fs.read":
            if not os.path.isfile(p): raise BridgeError("File not found", "not-found", 404)
            if os.path.getsize(p) > 5_000_000: raise BridgeError("File too large", "bad-args")
            with open(p, encoding="utf-8", errors="replace") as f: return f.read()
        if op == "fs.write":
            if p == root: raise BridgeError("name is required", "bad-args")
            data = a.get("data", ""); data = data if isinstance(data, str) else json.dumps(data)
            if len(data) > 5_000_000: raise BridgeError("Too large", "bad-args")
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f: f.write(data)
            return True
        if op == "fs.delete":
            if os.path.isfile(p): os.remove(p)
            return True

    def proc_run(self, cid, a):
        cmd = a.get("cmd")
        if not isinstance(cmd, list) or not cmd or not all(isinstance(x, str) for x in cmd): raise BridgeError("cmd must be a list of strings", "bad-args")
        if cmd[0] == "python":   # the connector's own interpreter (its venv, with its packages)
            vpy = os.path.join(self.cdir(cid), "venv", "Scripts" if os.name == "nt" else "bin", "python.exe" if os.name == "nt" else "python")
            cmd[0] = vpy if os.path.exists(vpy) else sys.executable
        t = max(1, min(float(a.get("timeout", 30)), 120))
        try:
            r = subprocess.run(cmd, input=a.get("input"), capture_output=True, text=True, timeout=t, cwd=self.ddir(cid), encoding="utf-8", errors="replace")
        except subprocess.TimeoutExpired: raise BridgeError("The process took longer than %ds" % t, "timeout", 504)
        except OSError as e: raise BridgeError("Cannot run it: %s" % e, "proc")
        return {"code": r.returncode, "stdout": r.stdout[:1_000_000], "stderr": r.stderr[:200_000]}


# ───────────────────────── HTTP ─────────────────────────
class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_handler(br, port):
    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def log_message(self, fmt, *a): pass

        def _cors(self, o, allow=True):
            if o and allow:
                self.send_header("Access-Control-Allow-Origin", o); self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _send(self, status, obj, o=None, allow=True):
            b = json.dumps(obj).encode()
            self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control", "no-store")
            self._cors(o, allow); self.end_headers(); self.wfile.write(b)

        def _host_ok(self):
            h = (self.headers.get("Host") or "").lower()
            return h in ("127.0.0.1:%d" % port, "localhost:%d" % port)

        def do_OPTIONS(self):
            o = self.headers.get("Origin", "")
            self.send_response(204); self._cors(o, br.origin_ok(o) or self.path.startswith("/health")); self.send_header("Content-Length", "0"); self.end_headers()

        def do_GET(self): self._route("GET")
        def do_POST(self): self._route("POST")

        def _route(self, method):
            o = self.headers.get("Origin", "")
            if not self._host_ok(): return self._send(403, {"error": "Bad Host header"})
            u = urllib.parse.urlsplit(self.path); path = u.path
            try:
                if path == "/health":
                    return self._send(200, {"service": "nexus-bridge", "version": VERSION}, o or "*")
                m = re.match(r"^/t/([^/]+)(/.*)$", path)
                if o and not br.origin_ok(o):
                    return self._send(403, {"error": "This website (%s) is not allowed. Start the bridge with --origin %s" % (o, o)}, o)
                if not m or not hmac.compare_digest(urllib.parse.unquote(m.group(1)), br.token):
                    return self._send(403, {"error": "Wrong pairing code"}, o)
                path = m.group(2); q = urllib.parse.parse_qs(u.query)
                body = {}
                if method == "POST":
                    n = int(self.headers.get("Content-Length") or 0)
                    if n > 2_000_000: raise BridgeError("Request too large", "too-large", 413)
                    raw = self.rfile.read(n) if n else b""
                    body = json.loads(raw.decode("utf-8")) if raw else {}
                    if not isinstance(body, dict): raise BridgeError("JSON object expected")
                if path == "/analyze" and method == "POST":
                    code = body.get("code", "")
                    if not isinstance(code, str): raise BridgeError("Python code must be text", "bad-args")
                    result = analyze(code, "community")
                    return self._send(200, {"ok": not result["errors"], "tools": result["tools"], "actions": result["actions"], "requires": result["requires"], "errors": result["errors"], "validator": "python-ast"}, o)
                if path == "/info" and method == "GET":
                    ok, why = br.ble.available()
                    return self._send(200, {"version": VERSION, "platform": platform.system() + " " + platform.release(), "python": platform.python_version(),
                                            "ble": {"available": ok, "reason": why}, "installed": br.installed()}, o)
                if path == "/install" and method == "POST":
                    return self._send(200, {"job": br.start_install(body)}, o)
                if path.startswith("/job/") and method == "GET":
                    j = br.jobs.get(path[5:])
                    return self._send(200, j, o) if j else self._send(404, {"error": "Unknown job"}, o)
                if path == "/uninstall" and method == "POST":
                    return self._send(200, {"ok": br.uninstall(str(body.get("id", "")))}, o)
                if path == "/call" and method == "POST":
                    cid = str(body.get("connector", ""))
                    if not ID_RE.match(cid): raise BridgeError("Invalid connector id")
                    return self._send(200, br.call(cid, str(body.get("tool", "")), str(body.get("action", "")), body.get("args") if isinstance(body.get("args"), dict) else {}), o)
                if path == "/proxy" and method == "POST":
                    r = guarded_fetch(body.get("url"), body.get("method", "GET"), body.get("headers"), body.get("body"), body.get("timeout", 30))
                    return self._send(200, r, o)
                if path == "/events" and method == "GET":
                    return self._sse(str((q.get("connector") or [""])[0]), o)
                return self._send(404, {"error": "Not found"}, o)
            except BridgeError as e:
                self._send(e.status, {"error": str(e), "code": e.code}, o)
            except (ValueError, json.JSONDecodeError) as e:
                self._send(400, {"error": "Bad request: %s" % e}, o)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:
                self._send(500, {"error": "%s: %s" % (e.__class__.__name__, e)}, o)

        def _sse(self, cid, o):
            if not ID_RE.match(cid): raise BridgeError("Invalid connector id")
            q = br.events.subscribe(cid)
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-store"); self.send_header("Connection", "close")
            self._cors(o); self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(b": ok\n\n"); self.wfile.flush()
                while True:
                    try: ev = q.get(timeout=15); self.wfile.write(("data: " + json.dumps(ev) + "\n\n").encode())
                    except queue.Empty: self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                br.events.unsubscribe(cid, q)
    return H


def main(argv=None):
    ap = argparse.ArgumentParser(description="Nexus local bridge")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--home", default=os.environ.get("NEXUS_HOME") or os.path.join(os.path.expanduser("~"), ".nexus"))
    ap.add_argument("--origin", action="append", default=[], help="extra website allowed to use the bridge (e.g. https://my-site.example)")
    ap.add_argument("--new-code", action="store_true", help="create a new pairing code")
    a = ap.parse_args(argv)
    os.makedirs(a.home, exist_ok=True)
    origins = ["https://laffitacamargof-create.github.io"] + [o.rstrip("/") for o in a.origin]
    br = Bridge(a.home, origins)
    if a.new_code: br.rotate()
    srv = Server(("127.0.0.1", a.port), make_handler(br, a.port))
    ok, why = br.ble.available()
    print("\n  Nexus bridge %s" % VERSION)
    print("  Listening on  http://127.0.0.1:%d   (this computer only)" % a.port)
    print("  Pairing code: %s" % br.token)
    print("  Allowed sites: %s + localhost" % ", ".join(origins))
    print("  Bluetooth:    %s" % ("available" if ok else "not available — " + why))
    print("  Data folder:  %s\n  Ctrl+C to stop.\n" % a.home, flush=True)
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        for cid in list(br.workers): br.stop_worker(cid)


if __name__ == "__main__":
    main()
