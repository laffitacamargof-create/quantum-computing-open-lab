# QuOLab Nexus Motor — Servidor cuántico completo
import os, sys, time, json
from quolab_execution_sandbox import execute_isolated, is_safe
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

print(f"QuOLab Nexus Motor OK — {len(LIBS)} libs: {', '.join(LIBS.keys())}")

# La ejecución de usuario se delega al sandbox OS aislado y fail-closed.
def execute_code(code: str):
    return execute_isolated(code)

# Health response
def health_response():
    return {"status":"ok","engine":"QCOL-CPU","libs":list(LIBS.keys()),"versions":LIBS}

# FastAPI
app = FastAPI(title="QuOLab Nexus Motor")
ALLOWED_ORIGINS = [origin.strip() for origin in os.environ.get(
    "QUOLAB_ALLOWED_ORIGINS",
    "https://laffitacamargof-create.github.io,https://quantum-computing-open-lab.vercel.app,http://localhost:8000,http://localhost:7860"
).split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET","POST","OPTIONS"], allow_headers=["Content-Type"])

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
