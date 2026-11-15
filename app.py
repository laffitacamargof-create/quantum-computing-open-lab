# QuOLab Nexus Motor — servidor cuántico
import json
import os
import shutil
from threading import BoundedSemaphore

from starlette.concurrency import run_in_threadpool
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from quolab_execution_sandbox import execute_isolated, is_safe, sandbox_runtime_status

LIBS = {}
try:
    import qiskit
    LIBS["qiskit"] = qiskit.__version__
except Exception:
    pass
for module_name, display_name in (("qiskit_aer", "qiskit-aer"), ("cirq", "cirq"),
                                  ("pennylane", "pennylane"), ("qutip", "qutip"),
                                  ("numpy", "numpy"), ("scipy", "scipy"),
                                  ("sympy", "sympy"), ("matplotlib", "matplotlib")):
    try:
        module = __import__(module_name)
        LIBS[display_name] = getattr(module, "__version__", "ok")
    except Exception:
        pass

MAX_REQUEST_BYTES = 24 * 1024
MAX_CODE_BYTES = 20 * 1024
MAX_CONCURRENT_EXECUTIONS = 2
_execution_slots = BoundedSemaphore(MAX_CONCURRENT_EXECUTIONS)

def execute_code(code: str):
    return execute_isolated(code)

def health_response():
    runtime = sandbox_runtime_status()
    return {
        "status": "ok" if runtime["ready"] else "degraded",
        "engine": "QuOLab Nexus",
        "libs": list(LIBS.keys()),
        "versions": LIBS,
        "sandbox": {
            **runtime,
            "policy": "fail-closed; no unsandboxed fallback",
            "max_code_bytes": MAX_CODE_BYTES,
            "max_concurrent_executions": MAX_CONCURRENT_EXECUTIONS
        }
    }

app = FastAPI(title="QuOLab Nexus Motor", version="2.1.0")
ALLOWED_ORIGINS = [
    origin.strip() for origin in os.environ.get(
        "QUOLAB_ALLOWED_ORIGINS",
        "https://laffitacamargof-create.github.io,https://quantum-computing-open-lab.vercel.app,http://localhost:8000,http://localhost:7860"
    ).split(",") if origin.strip()
]
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["Content-Type"])

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
    chunks = []
    received = 0
    try:
        async for chunk in request.stream():
            received += len(chunk)
            if received > MAX_REQUEST_BYTES:
                return JSONResponse({"success": False, "output": "Solicitud demasiado grande."}, status_code=413)
            chunks.append(chunk)
        body = json.loads(b"".join(chunks).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JSONResponse({"success": False, "output": "JSON inválido."}, status_code=400)
    except Exception:
        return JSONResponse({"success": False, "output": "No se pudo leer la solicitud."}, status_code=400)
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
        return JSONResponse(await run_in_threadpool(execute_code, code))
    finally:
        _execution_slots.release()

@app.get("/")
async def root():
    return health_response()

@app.get("/health")
async def health_get():
    status = health_response()
    return JSONResponse(status, status_code=200 if status["sandbox"]["ready"] else 503)

@app.post("/health")
async def health_post():
    status = health_response()
    return JSONResponse(status, status_code=200 if status["sandbox"]["ready"] else 503)

@app.get("/health/predict")
async def health_predict_get():
    status = health_response()
    return JSONResponse({"data": [status]}, status_code=200 if status["sandbox"]["ready"] else 503)

@app.post("/health/predict")
async def health_predict_post():
    status = health_response()
    return JSONResponse({"data": [status]}, status_code=200 if status["sandbox"]["ready"] else 503)

@app.post("/run")
async def run_post(request: Request):
    return await _run_code(request)

@app.post("/run/predict")
async def run_predict_post(request: Request):
    result = await _run_code(request)
    payload = json.loads(result.body.decode("utf-8"))
    if result.status_code != 200:
        return JSONResponse({"data": [payload]}, status_code=result.status_code)
    return JSONResponse({"data": [payload]})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
