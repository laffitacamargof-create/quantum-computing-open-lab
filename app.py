# ═══════════════════════════════════════════════════
# QCOL Motor — HuggingFace ZeroGPU
# Qiskit + Qiskit-Aer + Cirq + PennyLane + QuTiP
# ═══════════════════════════════════════════════════
import gradio as gr
import sys, io, time, traceback

# ── Importar librerías cuánticas disponibles ──────
LIBS = {}

try:
    import qiskit
    from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister, transpile
    from qiskit.quantum_info import Statevector, DensityMatrix, Operator
    LIBS['qiskit'] = qiskit.__version__
except ImportError:
    pass

try:
    from qiskit_aer import AerSimulator
    from qiskit_aer.primitives import Sampler, Estimator
    LIBS['qiskit-aer'] = 'ok'
except ImportError:
    AerSimulator = None

try:
    import cirq
    LIBS['cirq'] = cirq.__version__
except ImportError:
    cirq = None

try:
    import pennylane as qml
    LIBS['pennylane'] = qml.__version__
except ImportError:
    qml = None

try:
    import qutip as qt
    LIBS['qutip'] = qt.__version__
except ImportError:
    qt = None

try:
    import numpy as np
    from numpy import pi
    LIBS['numpy'] = np.__version__
except ImportError:
    pass

try:
    import scipy
    LIBS['scipy'] = scipy.__version__
except ImportError:
    pass

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    LIBS['matplotlib'] = matplotlib.__version__
except ImportError:
    plt = None

try:
    import sympy
    LIBS['sympy'] = sympy.__version__
except ImportError:
    pass

print(f"✅ QCOL Motor iniciado")
print(f"📦 Librerías: {', '.join(LIBS.keys())}")

# ── Seguridad ──────────────────────────────────────
BLOCKED = [
    'import os', 'import subprocess', 'import socket',
    'open(', 'os.system', 'shutil.', '__import__("os")',
    'os.popen', 'eval(', 'exec(import'
]

def is_safe(code):
    for b in BLOCKED:
        if b in code:
            return False, f'Operación no permitida: {b}'
    return True, 'OK'

# ── Ejecutar código ────────────────────────────────
def run_circuit(code: str):
    safe, msg = is_safe(code)
    if not safe:
        return {"success": False, "output": msg, "bloch": None, "time": 0, "libs": LIBS}

    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = buf = io.StringIO()
    sys.stderr = buf_err = io.StringIO()
    t0 = time.time()

    try:
        # Entorno completo con todas las librerías
        exec_env = {
            '__builtins__': __builtins__,
            'np': np, 'pi': pi,
        }

        # Qiskit
        if 'qiskit' in LIBS:
            exec_env.update({
                'qiskit': qiskit,
                'QuantumCircuit': QuantumCircuit,
                'QuantumRegister': QuantumRegister,
                'ClassicalRegister': ClassicalRegister,
                'transpile': transpile,
                'Statevector': Statevector,
                'DensityMatrix': DensityMatrix,
                'Operator': Operator,
            })

        # Qiskit-Aer
        if AerSimulator:
            exec_env['AerSimulator'] = AerSimulator

        # Cirq
        if cirq:
            exec_env['cirq'] = cirq

        # PennyLane
        if qml:
            exec_env['qml'] = qml

        # QuTiP
        if qt:
            exec_env['qt'] = qt

        # Matplotlib
        if plt:
            exec_env['plt'] = plt
            exec_env['matplotlib'] = matplotlib

        # Scipy, Sympy
        try:
            import scipy; exec_env['scipy'] = scipy
        except: pass
        try:
            import sympy; exec_env['sympy'] = sympy
        except: pass

        exec(code, exec_env)

        output = buf.getvalue()
        warns  = buf_err.getvalue()
        if warns and 'DeprecationWarning' not in warns:
            output += '\n⚠️ Warnings:\n' + warns

        # ── Extraer probabilidades ──────────────────
        bloch_data = None

        # Qiskit con AerSimulator (shots reales)
        qc = exec_env.get('qc', None)
        if qc is not None and AerSimulator:
            try:
                has_measure = any(
                    inst.operation.name == 'measure'
                    for inst in qc.data
                )
                if has_measure:
                    sim = AerSimulator()
                    qc_t = transpile(qc, sim)
                    result = sim.run(qc_t, shots=1024).result()
                    counts = result.get_counts()
                    total = sum(counts.values())
                    bloch_data = {
                        'counts': counts,
                        'probabilities': {k: v/total for k, v in counts.items()},
                        'shots': 1024,
                        'simulator': 'AerSimulator'
                    }
                else:
                    sv = Statevector(qc)
                    probs = sv.probabilities_dict()
                    bloch_data = {
                        'probabilities': {k: float(v) for k, v in probs.items()},
                        'simulator': 'Statevector'
                    }
            except Exception as e:
                bloch_data = {'error': str(e)}

        # Qiskit sin Aer (statevector)
        elif qc is not None and 'qiskit' in LIBS:
            try:
                sv = Statevector(qc)
                probs = sv.probabilities_dict()
                bloch_data = {
                    'probabilities': {k: float(v) for k, v in probs.items()},
                    'simulator': 'Statevector'
                }
            except Exception:
                pass

        return {
            "success": True,
            "output":  output.strip() or "✅ Ejecutado sin output",
            "bloch":   bloch_data,
            "time":    round(time.time() - t0, 3),
            "libs":    LIBS
        }

    except SyntaxError as e:
        return {
            "success": False,
            "output":  f"Error de sintaxis línea {e.lineno}:\n{e.msg}",
            "bloch": None, "time": 0, "libs": LIBS
        }
    except Exception as e:
        tb = traceback.format_exc()
        lines = [l for l in tb.split('\n')
                 if 'File "<string>"' in l or 'Error' in l or 'error' in l.lower()]
        return {
            "success": False,
            "output":  'Error:\n' + '\n'.join(lines) if lines else str(e),
            "bloch": None, "time": 0, "libs": LIBS
        }
    finally:
        sys.stdout = old_out
        sys.stderr = old_err

def health_check(x=""):
    return {
        "status": "ok",
        "engine": "QCOL-HuggingFace",
        "libs":   list(LIBS.keys()),
        "versions": LIBS
    }

# ── Interfaz Gradio ────────────────────────────────
with gr.Blocks(title="QCOL Motor Cuántico") as demo:

    gr.Markdown("""
    # ⚛ QCOL — Motor Cuántico
    **Quantum Computing Open Lab** — Qiskit · Cirq · PennyLane · QuTiP
    """)

    with gr.Row():
        with gr.Column(scale=2):
            code_in = gr.Textbox(
                label="Código Python / Qiskit",
                placeholder="""from qiskit import QuantumCircuit
from numpy import pi

# Estado Bell
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0,1],[0,1])
print(qc.draw(output='text'))""",
                lines=14
            )
            run_btn = gr.Button("▶ EJECUTAR", variant="primary")

        with gr.Column(scale=1):
            result_out = gr.JSON(label="Resultado")

    run_btn.click(fn=run_circuit, inputs=code_in, outputs=result_out)

    gr.Markdown(f"""
    ---
    **Librerías disponibles:** {', '.join(LIBS.keys()) if LIBS else 'cargando...'}

    ### API para QCOL Ecosistema
    ```
    POST /run/predict → {{"data": ["codigo_python"]}}
    GET  /health/predict → {{"data": [""]}}
    ```
    """)

    # Endpoints API
    gr.Interface(
        fn=run_circuit,
        inputs=gr.Textbox(visible=False),
        outputs=gr.JSON(visible=False),
        api_name="run"
    )
    gr.Interface(
        fn=health_check,
        inputs=gr.Textbox(visible=False),
        outputs=gr.JSON(visible=False),
        api_name="health"
    )

demo.launch(server_name="0.0.0.0", server_port=7860)
