from flask import Flask, request, jsonify
from flask_cors import CORS
import os, sys
from quolab_execution_sandbox import execute_isolated, is_safe

app = Flask(__name__)
ALLOWED_ORIGINS = [origin.strip() for origin in os.environ.get(
    "QUOLAB_ALLOWED_ORIGINS",
    "https://laffitacamargof-create.github.io,https://quantum-computing-open-lab.vercel.app,http://localhost:8000,http://localhost:5000"
).split(",") if origin.strip()]
CORS(app, origins=ALLOWED_ORIGINS, methods=["GET","POST","OPTIONS"], allow_headers=["Content-Type"])

# Validación AST y ejecución en sandbox OS aislado.
@app.route('/')
def index():
    return jsonify({
        'name': 'QuOLab Nexus Motor',
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
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or not isinstance(data.get('code'), str):
        return jsonify({'success': False, 'output': 'No se recibió código válido'}), 400
    code = data['code']
    safe, message = is_safe(code)
    if not safe:
        return jsonify({'success': False, 'output': message}), 400
    return jsonify(execute_isolated(code))


if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    print(f'🚀 QuOLab Nexus Motor iniciando en puerto {port}')
    app.run(host='0.0.0.0', port=port)
