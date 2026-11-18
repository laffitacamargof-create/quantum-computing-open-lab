"""Fail-closed OS-isolated execution for QuOLab Nexus."""
import ast, json, os, shutil, subprocess, sys, tempfile, time
from functools import lru_cache

MAX_CODE_BYTES=20000
MAX_OUTPUT_BYTES=16000
ALLOWED_IMPORTS=frozenset({"qiskit","qiskit_aer","numpy","scipy","sympy","cirq","pennylane","qutip","math","cmath","statistics","itertools","functools","collections","decimal","fractions","random","json","time","re","typing","dataclasses","matplotlib"})
FORBIDDEN_NAMES=frozenset({"__import__","eval","exec","compile","open","input","globals","locals","vars","getattr","setattr","delattr","breakpoint","help","memoryview","type","object","super","classmethod","staticmethod","property"})

def is_safe(code):
    if not isinstance(code,str): return False,"El código debe ser texto."
    if len(code.encode("utf-8"))>MAX_CODE_BYTES: return False,"Código demasiado largo (máximo 20 KB)."
    try: tree=ast.parse(code,mode="exec")
    except (SyntaxError,ValueError) as exc: return False,"AST inválido: "+str(exc)
    for node in ast.walk(tree):
        if isinstance(node,(ast.Import,ast.ImportFrom)):
            modules=[item.name for item in node.names] if isinstance(node,ast.Import) else [node.module or ""]
            for module in modules:
                root=module.split(".",1)[0]
                if root not in ALLOWED_IMPORTS or any(part in {"ctypes","ctypeslib"} for part in module.split(".")): return False,"Import no permitido: "+(root or "<vacío>")
        if isinstance(node,ast.Name) and (node.id in FORBIDDEN_NAMES or node.id.startswith("__")):
            return False,"Nombre no permitido: "+node.id
        if isinstance(node,ast.Attribute) and (node.attr.startswith("_") or node.attr in {"ctypeslib","ctypes","CDLL","PyDLL","WinDLL","CFUNCTYPE","pythonapi","system","popen","spawn","fork","execv","fromfile","tofile","memmap","load","save","loadtxt","savetxt"}):
            return False,"Acceso a atributos internos no permitido."
        if isinstance(node,(ast.Global,ast.Nonlocal,ast.ClassDef,ast.AsyncFunctionDef,ast.Await,ast.Yield,ast.YieldFrom)):
            return False,"Construcción no permitida: "+type(node).__name__
    return True,"OK"

_WORKER = r'''
import ast, builtins, contextlib, importlib, io, json, os, sys, time
sys.dont_write_bytecode=True
payload=json.loads(sys.stdin.read())
allowed=set(payload["allowed"])
real_import=builtins.__import__
def safe_import(name,globals=None,locals=None,fromlist=(),level=0):
    if level or name.split(".",1)[0] not in allowed: raise ImportError("Import no permitido")
    return real_import(name,globals,locals,fromlist,level)
safe={name:getattr(builtins,name) for name in (
 "abs","all","any","ascii","bin","bool","bytearray","bytes","callable","chr","complex","dict","divmod",
 "enumerate","filter","float","format","frozenset","hash","hex","int","isinstance","issubclass","iter",
 "len","list","map","max","min","next","oct","ord","pow","print","range","repr","reversed","round",
 "set","slice","sorted","str","sum","tuple","zip","Exception","ArithmeticError","AssertionError",
 "IndexError","KeyError","TypeError","ValueError","ZeroDivisionError")}
safe["__import__"]=safe_import
env={"__builtins__":safe}
tree=ast.parse(payload["code"],mode="exec")
used_names={node.id for node in ast.walk(tree) if isinstance(node,ast.Name)}
requested=set()
for node in ast.walk(tree):
 if isinstance(node,ast.Import):
  requested.update(alias.name.split(".",1)[0] for alias in node.names)
 elif isinstance(node,ast.ImportFrom) and node.module:
  requested.add(node.module.split(".",1)[0])
for alias,module in (("np","numpy"),("numpy","numpy"),("qiskit","qiskit"),("QuantumCircuit","qiskit"),
 ("QuantumRegister","qiskit"),("ClassicalRegister","qiskit"),("Statevector","qiskit"),
 ("DensityMatrix","qiskit"),("Operator","qiskit"),("SparsePauliOp","qiskit"),
 ("AerSimulator","qiskit_aer"),("cirq","cirq"),("qml","pennylane"),("qt","qutip"),
 ("scipy","scipy"),("sympy","sympy"),("plt","matplotlib")):
 if alias in used_names: requested.add(module)
if "pi" in used_names: requested.add("math")
if "matplotlib" in requested:
 try:
  mpl=importlib.import_module("matplotlib")
  mpl.use("Agg")
 except Exception: pass
for module,alias in (("numpy","np"),("numpy","numpy"),("math","math"),("math","pi"),("qiskit","qiskit"),
 ("cirq","cirq"),("pennylane","qml"),("qutip","qt"),("scipy","scipy"),("sympy","sympy"),
 ("matplotlib","matplotlib")):
 if module not in requested: continue
 try:
  obj=importlib.import_module(module)
  env[alias]=getattr(obj,"pi") if alias=="pi" else obj
 except Exception: pass
class CappedBuffer(io.StringIO):
 def write(self, value):
  remaining=8000-len(self.getvalue())
  if remaining>0: return super().write(str(value)[:remaining])
  return len(str(value))
try:
 qiskit=env.get("qiskit")
 if qiskit:
  from qiskit import QuantumCircuit,QuantumRegister,ClassicalRegister,transpile
  from qiskit.quantum_info import Statevector,DensityMatrix,Operator,SparsePauliOp
  env.update({"QuantumCircuit":QuantumCircuit,"QuantumRegister":QuantumRegister,"ClassicalRegister":ClassicalRegister,
   "transpile":transpile,"Statevector":Statevector,"DensityMatrix":DensityMatrix,"Operator":Operator,"SparsePauliOp":SparsePauliOp})
  try:
   from qiskit_aer import AerSimulator
   env["AerSimulator"]=AerSimulator
  except Exception: pass
  try:
   from qiskit_algorithms import VQE,QAOA,Grover
   from qiskit_algorithms.optimizers import COBYLA,SPSA
   env.update({"VQE":VQE,"QAOA":QAOA,"Grover":Grover,"COBYLA":COBYLA,"SPSA":SPSA})
  except Exception: pass
 start=time.monotonic()
 out,err=CappedBuffer(),CappedBuffer()
 with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
  exec(compile(payload["code"],"<quolab-user-code>","exec"),env,env)
 text=(out.getvalue()+("\n"+err.getvalue() if err.getvalue() else "")).strip()[:16000]
 bloch=None
 qc=env.get("qc")
 if qc is not None and qiskit:
  try:
   from qiskit.quantum_info import Statevector
   aer=env.get("AerSimulator")
   measured=any(item.operation.name=="measure" for item in qc.data)
   if aer and measured:
    sim=aer()
    result=sim.run(env["transpile"](qc,sim),shots=1024).result()
    counts=result.get_counts()
    total=sum(counts.values()) or 1
    bloch={"counts":counts,"probabilities":{k:v/total for k,v in counts.items()},"shots":1024,"simulator":"AerSimulator"}
   else:
    state=Statevector(qc)
    bloch={"probabilities":{k:float(v) for k,v in state.probabilities_dict().items()},"simulator":"Statevector"}
  except Exception as exc: bloch={"error":str(exc)[:500]}
 result={"success":True,"output":text or "OK","bloch":bloch,"time":round(time.monotonic()-start,3)}
except BaseException as exc:
 result={"success":False,"output":(str(exc) or type(exc).__name__)[:2000],"bloch":None,"time":0}
sys.__stdout__.write(json.dumps(result,default=str,ensure_ascii=False))
'''

def _limits():
    import resource
    resource.setrlimit(resource.RLIMIT_CPU,(10,11))
    resource.setrlimit(resource.RLIMIT_AS,(2500000000,2500000000))
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_OUTPUT_BYTES*2,MAX_OUTPUT_BYTES*2))
    resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
    try: resource.setrlimit(resource.RLIMIT_NPROC,(32,32))
    except (ValueError,OSError): pass


@lru_cache(maxsize=1)
def sandbox_runtime_status():
    bwrap=shutil.which("bwrap")
    if not bwrap: return {"ready":False,"binary_present":False,"reason":"bwrap_missing"}
    # Bubblewrap maps the invoking container user to namespace root by default.
    # Forcing UID/GID 65534 requires subordinate ID mappings unavailable in
    # many hosted containers, so keep the safe default namespace mapping.
    args=[bwrap,"--unshare-all","--die-with-parent","--new-session"]
    for path in ("/usr","/lib","/lib64","/bin","/sbin"):
        source=os.path.realpath(path)
        if os.path.isdir(source): args.extend(["--ro-bind",source,path])
    args.extend(["--proc","/proc","--dev","/dev","--tmpfs","/tmp","--dir","/workspace",
        "--chdir","/workspace","--","/usr/bin/true"])
    try:
        probe=subprocess.run(args,capture_output=True,text=True,timeout=3,check=False,
            env={"PATH":"/usr/bin:/bin","LANG":"C.UTF-8"})
        return {"ready":probe.returncode==0,"binary_present":True,
            "reason":"ready" if probe.returncode==0 else "namespace_unavailable"}
    except (OSError,subprocess.SubprocessError):
        return {"ready":False,"binary_present":True,"reason":"namespace_unavailable"}

def execute_isolated(code):
    started=time.monotonic()
    safe,message=is_safe(code)
    if not safe: return {"success":False,"output":message,"bloch":None,"time":0}
    runtime=sandbox_runtime_status()
    bwrap=shutil.which("bwrap")
    if not runtime["ready"]:
        return {"success":False,"output":"Ejecución bloqueada: el servidor no puede crear el sandbox aislado. No se ejecutó código fuera del aislamiento.","bloch":None,"time":0}
    with tempfile.TemporaryDirectory(prefix="quolab-run-") as work:
        os.chmod(work,0o777)
        # Bubblewrap maps the invoking container user to namespace root by default.
        # Forcing UID/GID 65534 requires subordinate ID mappings unavailable in
        # many hosted containers, so keep the safe default namespace mapping.
        args=[bwrap,"--unshare-all","--die-with-parent","--new-session"]
        mounted=set()
        for path in ("/usr","/lib","/lib64","/bin","/sbin"):
            # Resolve merged-/usr symlinks in the host namespace, then mount the
            # real directory at the conventional path inside bubblewrap's empty root.
            source=os.path.realpath(path)
            if os.path.isdir(source):
                args.extend(["--ro-bind",source,path]); mounted.add(path)
        for prefix in {sys.prefix,sys.base_prefix}:
            if prefix and os.path.exists(prefix) and not any(prefix==root or prefix.startswith(root.rstrip("/")+"/") for root in mounted if root!="/etc/ld.so.cache"):
                args.extend(["--ro-bind",prefix,prefix]); mounted.add(prefix)
        args.extend(["--proc","/proc","--dev","/dev","--tmpfs","/tmp","--dir","/workspace","--bind",work,"/workspace",
          "--chdir","/workspace","--setenv","HOME","/workspace","--setenv","MPLCONFIGDIR","/workspace/.mpl",
          "--setenv","XDG_CACHE_HOME","/workspace/.cache","--setenv","PYTHONDONTWRITEBYTECODE","1",
          "--",sys.executable,"-I","-c",_WORKER])
        payload=json.dumps({"code":code,"allowed":sorted(ALLOWED_IMPORTS)})
        try:
            proc=subprocess.run(args,input=payload,text=True,capture_output=True,timeout=15,check=False,
              preexec_fn=_limits,env={"PATH":"/usr/bin:/bin","LANG":"C.UTF-8"})
        except subprocess.TimeoutExpired:
            return {"success":False,"output":"Tiempo máximo de ejecución excedido (15 s).","bloch":None,"time":round(time.monotonic()-started,3)}
        except (OSError,subprocess.SubprocessError) as exc:
            return {"success":False,"output":"Sandbox no disponible; ejecución bloqueada: "+str(exc)[:400],"bloch":None,"time":round(time.monotonic()-started,3)}
        raw=(proc.stdout or "")
        if len(raw)>MAX_OUTPUT_BYTES*8:
            return {"success":False,"output":"Salida del proceso aislado demasiado grande.","bloch":None,"time":round(time.monotonic()-started,3)}
        if proc.returncode!=0:
            detail=(proc.stderr or raw or "El proceso aislado terminó sin resultado.")[:1000]
            return {"success":False,"output":"Sandbox rechazó o no pudo ejecutar el proceso: "+detail,"bloch":None,"time":round(time.monotonic()-started,3)}
        try: result=json.loads(raw)
        except (ValueError,TypeError): return {"success":False,"output":"Salida inválida del proceso aislado.","bloch":None,"time":round(time.monotonic()-started,3)}
        result["output"]=str(result.get("output","")).encode("utf-8")[:MAX_OUTPUT_BYTES].decode("utf-8","ignore")
        result["time"]=round(time.monotonic()-started,3)
        return result
