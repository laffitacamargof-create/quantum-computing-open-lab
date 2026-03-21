from flask import Flask, request, jsonify
from flask_cors import CORS
import sys, io, time, traceback

app = Flask(__name__)
CORS(app)

BLOCKED = ['import os', 'import subprocess', 'import socket',
           'open(', 'os.system', 'shutil.']

def is_safe(code):
    for b in BLOCKED:
        if b in code:
            return False, f'Operación no permitida: {b}'
    return True, 'OK'

@app.route('/')
def index():
    return jsonify({'name':'QCOL Motor','status':'online','version':'3.0'})

@app.route('/health')
def health():
    try:
        import qiskit
        qv = qiskit.__version__
    except:
        qv = 'no instalado'
    return jsonify({'status':'ok','engine':'QCOL-Render','libs':['qiskit'],'qiskit':qv})

@app.route('/run', methods=['POST','OPTIONS'])
def run():
    if request.method == 'OPTIONS':
        r = jsonify({'ok':True})
        r.headers['Access-Control-Allow-Origin'] = '*'
        r.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        r.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return r

    data = request.get_json()
    if not data or 'code' not in data:
        return jsonify({'success':False,'output':'No se recibió código'})

    code = data.get('code','')
    if len(code) > 20000:
        return jsonify({'success':False,'output':'Código muy largo'})

    safe, msg = is_safe(code)
    if not safe:
        return jsonify({'success':False,'output':msg})

    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = buf = io.StringIO()
    sys.stderr = buf_err = io.StringIO()
    t0 = time.time()

    try:
        import qiskit
        import numpy as np
        from numpy import pi
        exec_env = {
            'qiskit': qiskit,
            'QuantumCircuit': qiskit.QuantumCircuit,
            'np': np,
            'pi': pi,
            '__builtins__': __builtins__
        }
        exec(code, exec_env)
        output = buf.getvalue()

        # Extraer statevector si hay circuito
        qc = exec_env.get('qc', None)
        bloch_data = None
        if qc is not None:
            try:
                from qiskit.quantum_info import Statevector
                sv = Statevector(qc)
                probs = sv.probabilities_dict()
                bloch_data = {
                    'probabilities': {k: float(v) for k, v in probs.items()}
                }
            except:
                pass

        return jsonify({
            'success': True,
            'output': output.strip() if output.strip() else '✅ Ejecutado sin output',
            'bloch': bloch_data,
            'time': round(time.time()-t0, 3)
        })

    except SyntaxError as e:
        return jsonify({'success':False,'output':f'Error de sintaxis línea {e.lineno}:\n{e.msg}'})
    except Exception as e:
        tb = traceback.format_exc()
        lines = [l for l in tb.split('\n') if 'File "<string>"' in l or 'Error' in l]
        return jsonify({'success':False,'output':'Error:\n'+'\n'.join(lines) if lines else str(e)})
    finally:
        sys.stdout = old_out
        sys.stderr = old_err

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    print(f'🚀 QCOL Motor iniciando en puerto {port}')
    app.run(host='0.0.0.0', port=port)
