# QuOLab Nexus Motor — servidor cuántico
import os
import shutil
import sys
from starlette.concurrency import run_in_threadpool
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from quolab_execution_sandbox import execute_isolated, is_safe
from threading import BoundedSemaphore

LIBS = {}
try:
    import qiskit
    from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister, transpile
    from qiskit.quantum_info import Statevector, DensityMatrix, Operator, SparsePauliOp
    LIBS["qiskit"] = qiskit.__version__
except Exception as exc:
    print(f"qiskit: {exc}")
try:
    from qiskit_aer import AerSimulator
    LIBS["qiskit-aer"] = "ok"
except Exception:
    AerSimulator = None
try:
    from qiskit_algorithms import VQE, QAOA, Grover
    from qiskit_algorithms.optimizers import COBYLA, SPSA
    LIBS["qiskit-algorithms"] = "ok"
except Exception as exc:
    print(f"qiskit-algorithms: {exc}")
try:
    import cirq
    LIBS["cirq"] = cirq.__version__
except Exception:
    cirq = None
try:
    import pennylane as qml
    LIBS["pennylane"] = qml.__version__
except Exception:
    qml = None
try:
    import qutip as qt
    LIBS["qutip"] = qt.__version__
except Exception:
    qt = None
try:
    import numpy as np
    from numpy import pi
    LIBS["numpy"] = np.__version__
except Exception:
    pass
try:
    import scipy
    LIBS["scipy"] = scipy.__version__
except Exception:
    pass
try:
    import matplotlib
    matplotlib.use("Agg")
    LIBS["matplotlib"] = matplotlib.__version__
except Exception:
    pass
try:
    import sympy
    LIBS["sympy"] = sympy.__version__
except Exception:
    pass

MAX_REQUEST_BYTES = 24 * 1024
MAX_CODE_BYTES = 20 * 1024
MAX_CONCURRENT_EXECUTIONS = 2
_execution_slots = BoundedSemaphore(MAX_CONCURRENT_EXECUTIONS)

def execute_code(code: str):
    return execute_isolated(code)

def health_response():
    return {
        "status": "ok",
        "engine": "QuOLab Nexus",
        "libs": list(LIBS.keys()),
        "versions": LIBS,
        "sandbox": {
            "binary_present": bool(shutil.which("bwrap")),
            "policy": "fail-closed; no unsandboxed fallback",
            "max_code_bytes": MAX_CODE_BYTES,
            "max_concurrent_executions": MAX_CONCURRENT_EXECUTIONS
        }
    }

app = FastAPI(title="QuOLab Nexus Motor", version="2.1.0")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "QUOLAB_ALLOWED_ORIGINS",
        "https://laffitacamargof-create.github.io,https://quantum-computing-open-lab.vercel.app,http://localhost:8000,http://localhost:7860"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    if request.url.path in {"/run", "/run/predict"}:
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                if int(raw_length) > MAX_REQUEST_BYTES:
                    return JSONResponse({"success": False, "output": "Solicitud demasiado grande."}, status_code=413)
            except ValueError:
                return JSONResponse({"success": False, "output": "Content-Length inválido."}, status_code=400)
    return await call_next(request)

def _extract_code(body):
    if not isinstance(body, dict):
        return None
    code = body.get("code")
    if isinstance(code, str):
        return code
    data = body.get("data")
    if isinstance(data, list) and data and isinstance(data[0], str):
        return data[0]
    return None

async def _run_code(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "output": "JSON inválido."}, status_code=400)
    code = _extract_code(body)
    if code is None:
        return JSONResponse({"success": False, "output": "Se requiere code o data[0] como texto."}, status_code=400)
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        return JSONResponse({"success": False, "output": "Código demasiado largo (máximo 20 KB)."}, status_code=413)
    safe, message = is_safe(code)
    if not safe:
        return JSONResponse({"success": False, "output": message}, status_code=400)
    if not _execution_slots.acquire(blocking=False):
        return JSONResponse({"success": False, "output": "Servidor ocupado; inténtalo de nuevo."}, status_code=429)
    try:
        result = await run_in_threadpool(execute_code, code)
        return JSONResponse(result)
    finally:
        _execution_slots.release()

@app.get("/")
async def root():
    return health_response()

@app.get("/health")
async def health_get():
    return JSONResponse(health_response())

@app.post("/health")
async def health_post():
    return JSONResponse(health_response())

@app.get("/health/predict")
async def health_predict_get():
    return JSONResponse({"data": [health_response()]})

@app.post("/health/predict")
async def health_predict_post():
    return JSONResponse({"data": [health_response()]})

@app.post("/run")
async def run_post(request: Request):
    return await _run_code(request)

@app.post("/run/predict")
async def run_predict_post(request: Request):
    result = await _run_code(request)
    if result.status_code != 200:
        return JSONResponse({"data": [result.body.decode("utf-8")]}, status_code=result.status_code)
    import json
    return JSONResponse({"data": [json.loads(result.body)]})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
