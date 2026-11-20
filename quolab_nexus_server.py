"""QuOLab Nexus HTTP engine with fail-closed isolated Python execution."""
import os
import sys
from threading import BoundedSemaphore

from flask import Flask, request, jsonify
from flask_cors import CORS

from quolab_execution_sandbox import execute_isolated, is_safe, sandbox_runtime_status

MAX_REQUEST_BYTES = 24 * 1024
MAX_CODE_BYTES = 20 * 1024
MAX_CONCURRENT_EXECUTIONS = 2

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
_execution_slots = BoundedSemaphore(MAX_CONCURRENT_EXECUTIONS)

ALLOWED_ORIGINS = [
    origin.strip() for origin in os.environ.get(
        "QUOLAB_ALLOWED_ORIGINS",
        "https://laffitacamargof-create.github.io,https://quantum-computing-open-lab.vercel.app,http://localhost:8000,http://localhost:5000,http://127.0.0.1:8000,http://127.0.0.1:5000"
    ).split(",") if origin.strip()
]
CORS(app, origins=ALLOWED_ORIGINS, methods=["GET", "POST", "OPTIONS"],
     allow_headers=["Content-Type"])

def engine_health():
    versions = {}
    for module_name, display_name in (
        ("qiskit", "qiskit"), ("qiskit_aer", "qiskit-aer"),
        ("cirq", "cirq"), ("numpy", "numpy")
    ):
        try:
            module = __import__(module_name)
            versions[display_name] = getattr(module, "__version__", "ok")
        except Exception:
            versions[display_name] = "no instalado"
    runtime = sandbox_runtime_status()
    return {
        "name": "QuOLab Nexus Motor",
        "status": "online" if runtime["ready"] else "degraded",
        "version": "2.2.0",
        "python": sys.version.split()[0],
        "libs": list(versions.keys()),
        "versions": versions,
        "sandbox": {
            **runtime,
            "policy": "fail-closed; no unsandboxed fallback",
            "max_code_bytes": MAX_CODE_BYTES,
            "max_concurrent_executions": MAX_CONCURRENT_EXECUTIONS
        }
    }

@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"success": False, "output": "Solicitud demasiado grande."}), 413

@app.route("/")
def index():
    return jsonify(engine_health())

@app.route("/health")
def health():
    status = engine_health()
    return jsonify(status), 200 if status["sandbox"]["ready"] else 503

@app.route("/version")
def version():
    status = engine_health()
    return jsonify({
        "python": status["python"],
        "libraries": status["versions"],
        "sandbox": status["sandbox"]
    })

@app.route("/run", methods=["POST", "OPTIONS"])
def run():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "output": "JSON inválido."}), 400
    code = data.get("code")
    if not isinstance(code, str):
        values = data.get("data")
        code = values[0] if isinstance(values, list) and values and isinstance(values[0], str) else None
    if code is None:
        return jsonify({"success": False, "output": "Se requiere code o data[0] como texto."}), 400
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        return jsonify({"success": False, "output": "Código demasiado largo (máximo 20 KB)."}), 413
    safe, message = is_safe(code)
    if not safe:
        return jsonify({"success": False, "output": message}), 400
    if not _execution_slots.acquire(blocking=False):
        return jsonify({"success": False, "output": "Servidor ocupado; inténtalo de nuevo."}), 429
    try:
        return jsonify(execute_isolated(code))
    finally:
        _execution_slots.release()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
