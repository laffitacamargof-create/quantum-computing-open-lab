from flask import Flask, request, jsonify
from flask_cors import CORS
import sys, io, time, traceback

app = Flask(__name__)
CORS(app)

# Seguridad básica
BLOCKED = ['import os', 'import subprocess', 'import socket',
           '__import__("os")', 'open(', 'os.system', 'shutil.']

def is_safe(code):
    for b in BLOCKED:
        if b in code:
            return False, f'Operación no permitida: {b}'
    return True, 'OK'

@app.route('/')
def index():
    return jsonify({
        'name': 'QCOL Motor',
        'status': 'online',
        'version': '2.0',
        'endpoints': ['/health', '/run', '/version']
    })

@app.route('/health')
def health():
    try:
        import qiskit
        qiskit_v = qiskit.__version__
    except:
        qiskit_v = 'no instalado'
    try:
        import cirq
        cirq_v = cirq.__version__
    except:
        cirq_v = 'no instalado'
    return jsonify({
        'status': 'ok',
        'engine': 'QCOL-Render',
        'libs': ['qiskit', 'cirq'],
        'qiskit': qiskit_v,
        'cirq': cirq_v,
    })

@app.route('/version')
def version():
    try:
        import qiskit, numpy
        return jsonify({
            'qiskit': qiskit.__version__,
            'numpy': numpy.__version__,
            'python': sys.version.split()[0]
        })
    except Exception as e:
        return jsonify({'error': str(e)})

@app.route('/run', methods=['POST', 'OPTIONS'])
def run():
    # CORS preflight
    if request.method == 'OPTIONS':
        r = jsonify({'ok': True})
        r.headers['Access-Control-Allow-Origin'] = '*'
        r.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        r.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return r

    data = request.get_json()
    if not data or 'code' not in data:
        return jsonify({'success': False, 'output': 'No se recibió código'})

    code = data.get('code', '')
    if len(code) > 20000:
        return jsonify({'success': False, 'output': 'Código muy largo'})

    safe, msg = is_safe(code)
    if not safe:
        return jsonify({'success': False, 'output': msg})

    # Capturar output
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = buf = io.StringIO()
    sys.stderr = buf_err = io.StringIO()

    t0 = time.time()
    result = {}

    try:
        import qiskit, cirq, numpy as np
        from numpy import pi

        exec_env = {
            'qiskit': qiskit,
            'cirq': cirq,
            'np': np,
            'pi': pi,
            '__builtins__': __builtins__
        }
        exec(code, exec_env)

        output = buf.getvalue()
        warnings = buf_err.getvalue()
        if warnings and 'DeprecationWarning' not in warnings:
            output += '\n' + warnings

        # Extraer probabilidades si hay circuito Qiskit
        qc = exec_env.get('qc', None)
        bloch_data = None

        if qc is not None:
            try:
                from qiskit.quantum_info import Statevector
                from qiskit_aer import AerSimulator
                from qiskit import transpile

                has_measure = any(
                    inst.operation.name == 'measure'
                    for inst in qc.data
                )

                if has_measure:
                    sim = AerSimulator()
                    qc_t = transpile(qc, sim)
                    res = sim.run(qc_t, shots=1024).result()
                    counts = res.get_counts()
                    total = sum(counts.values())
                    bloch_data = {
                        'counts': counts,
                        'probabilities': {k: v/total for k, v in counts.items()},
                        'shots': 1024
                    }
                else:
                    sv = Statevector(qc)
                    probs = sv.probabilities_dict()
                    bloch_data = {
                        'probabilities': {k: float(v) for k, v in probs.items()}
                    }
            except Exception:
                pass

        result = {
            'success': True,
            'output': output.strip() if output.strip() else '✅ Ejecutado sin output',
            'bloch': bloch_data,
            'time': round(time.time() - t0, 3)
        }

    except SyntaxError as e:
        result = {
            'success': False,
            'output': f'Error de sintaxis línea {e.lineno}:\n{e.msg}'
        }
    except Exception as e:
        tb = traceback.format_exc()
        lineas = [l for l in tb.split('\n')
                  if 'File "<string>"' in l or 'Error' in l or 'error' in l.lower()]
        result = {
            'success': False,
            'output': 'Error:\n' + '\n'.join(lineas) if lineas else str(e)
        }
    finally:
        sys.stdout = old_out
        sys.stderr = old_err

    return jsonify(result)


if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    print(f'🚀 QCOL Motor iniciando en puerto {port}')
    app.run(host='0.0.0.0', port=port)
