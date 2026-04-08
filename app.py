# QCOL Motor — Servidor cuántico completo
import sys, io, time, json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

LIBS = {}

try:
    import qiskit
    from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister, transpile
    from qiskit.quantum_info import Statevector, DensityMatrix, Operator, SparsePauliOp
    LIBS['qiskit'] = qiskit.__version__
except Exception as e:
    print(f"qiskit: {e}")

try:
    from qiskit_aer import AerSimulator
    LIBS['qiskit-aer'] = 'ok'
except Exception:
    AerSimulator = None

try:
    from qiskit_algorithms import VQE, QAOA, Grover
    from qiskit_algorithms.optimizers import COBYLA, SPSA
    LIBS['qiskit-algorithms'] = 'ok'
except Exception as e:
    print(f"qiskit-algorithms: {e}")

try:
    import cirq
    LIBS['cirq'] = cirq.__version__
except Exception:
    cirq = None

try:
    import pennylane as qml
    LIBS['pennylane'] = qml.__version__
except Exception as e:
    qml = None

try:
    import qutip as qt
    LIBS['qutip'] = qt.__version__
except Exception:
    qt = None

try:
    import numpy as np
    from numpy import pi
    LIBS['numpy'] = np.__version__
except Exception:
    pass

try:
    import scipy
    LIBS['scipy'] = scipy.__version__
except Exception:
    pass

try:
    import matplotlib
    matplotlib.use('Agg')
    LIBS['matplotlib'] = matplotlib.__version__
except Exception:
    pass

try:
    import sympy
    LIBS['sympy'] = sympy.__version__
except Exception:
    pass

print(f"QCOL Motor OK — {len(LIBS)} libs: {', '.join(LIBS.keys())}")

# Seguridad
BLOCKED = ['import os','import subprocess','import socket','os.system','shutil.','os.popen']
def is_safe(code):
    for b in BLOCKED:
        if b in code:
            return False, f'No permitido: {b}'
    return True, 'OK'

# Ejecutar código
def execute_code(code: str):
    safe, msg = is_safe(code)
    if not safe:
        return {"success": False, "output": msg, "bloch": None, "time": 0}
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = buf = io.StringIO()
    sys.stderr = io.StringIO()
    t0 = time.time()
    try:
        env = {'__builtins__': __builtins__}
        if 'qiskit' in LIBS:
            env.update({'qiskit':qiskit,'QuantumCircuit':QuantumCircuit,
                'QuantumRegister':QuantumRegister,'ClassicalRegister':ClassicalRegister,
                'transpile':transpile,'Statevector':Statevector,'DensityMatrix':DensityMatrix,
                'Operator':Operator,'SparsePauliOp':SparsePauliOp})
        if AerSimulator: env['AerSimulator'] = AerSimulator
        if 'qiskit-algorithms' in LIBS:
            env.update({'VQE':VQE,'QAOA':QAOA,'Grover':Grover,'COBYLA':COBYLA,'SPSA':SPSA})
        if cirq: env['cirq'] = cirq
        if qml:  env['qml'] = qml
        if qt:   env['qt'] = qt
        if 'numpy' in LIBS: env['np']=np; env['numpy']=np; env['pi']=pi
        if 'scipy' in LIBS: env['scipy']=scipy
        if 'sympy' in LIBS: env['sympy']=sympy

        exec(code, env)
        output = buf.getvalue()

        bloch_data = None
        qc = env.get('qc', None)
        if qc is not None:
            try:
                if AerSimulator:
                    has_m = any(i.operation.name=='measure' for i in qc.data)
                    if has_m:
                        sim = AerSimulator()
                        res = sim.run(transpile(qc,sim), shots=1024).result()
                        counts = res.get_counts()
                        total = sum(counts.values())
                        bloch_data = {'counts':counts,
                            'probabilities':{k:v/total for k,v in counts.items()},
                            'shots':1024,'simulator':'AerSimulator'}
                    else:
                        sv = Statevector(qc)
                        bloch_data = {'probabilities':{k:float(v) for k,v in sv.probabilities_dict().items()},
                            'simulator':'Statevector'}
                else:
                    sv = Statevector(qc)
                    bloch_data = {'probabilities':{k:float(v) for k,v in sv.probabilities_dict().items()},
                        'simulator':'Statevector'}
            except Exception as ex:
                bloch_data = {'error': str(ex)}

        return {"success":True,"output":output.strip() or "OK",
                "bloch":bloch_data,"time":round(time.time()-t0,3),"libs":LIBS}
    except SyntaxError as e:
        return {"success":False,"output":f"Sintaxis línea {e.lineno}: {e.msg}","bloch":None,"time":0}
    except Exception as e:
        return {"success":False,"output":str(e),"bloch":None,"time":0}
    finally:
        sys.stdout = old_out
        sys.stderr = old_err

# Health response
def health_response():
    return {"status":"ok","engine":"QCOL-CPU","libs":list(LIBS.keys()),"versions":LIBS}

# FastAPI
app = FastAPI(title="QCOL Motor")
app.add_middleware(CORSMiddleware,
    allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])

# ── TODOS LOS ENDPOINTS POSIBLES ──────────────────

@app.get("/")
async def root():
    return health_response()

# Health — todas las variantes
@app.get("/health")
async def health_get():
    return JSONResponse(health_response())

@app.post("/health")
async def health_post():
    return JSONResponse(health_response())

@app.get("/health/predict")
async def health_predict_get():
    return JSONResponse({"data":[health_response()]})

@app.post("/health/predict")
async def health_predict_post():
    return JSONResponse({"data":[health_response()]})

# Run — todas las variantes
@app.post("/run")
async def run_post(request: Request):
    body = await request.json()
    code = body.get("code","") or body.get("data",[""])[0] if isinstance(body.get("data"),list) else ""
    return JSONResponse(execute_code(code))

@app.post("/run/predict")
async def run_predict_post(request: Request):
    body = await request.json()
    code = ""
    if "data" in body and isinstance(body["data"],list):
        code = body["data"][0] or ""
    elif "code" in body:
        code = body["code"]
    return JSONResponse({"data":[execute_code(code)]})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
