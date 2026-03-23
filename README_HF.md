---
title: QCOL Motor Cuantico
emoji: ⚛
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: true
short_description: Motor Qiskit + Cirq + QuTiP + PennyLane para QCOL
---

# ⚛ QCOL Motor Cuántico

Motor de ejecución cuántica para [QCOL — Quantum Computing Open Lab](https://laffitacamargof-create.github.io/quantum-computing-open-lab)

Creado por **Franci Laffita Camargo** — Estudiante de Física Nuclear, Cuba.

## Librerías incluidas

| Librería | Versión | Uso |
|---|---|---|
| Qiskit | 1.0.2 | Circuitos cuánticos |
| Qiskit-Aer | 0.13.3 | Simulador con shots reales |
| Cirq | 1.3.0 | Circuitos Google-style |
| PennyLane | 0.36.0 | Quantum ML |
| QuTiP | 4.7.5 | Sistemas cuánticos abiertos |
| NumPy/SciPy | latest | Matemáticas |
| Matplotlib | latest | Gráficas |

## API para el ecosistema QCOL

**Ejecutar código Python/Qiskit:**
```
POST /run/predict
Content-Type: application/json
{"data": ["from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nprint(qc.draw())"]}
```

**Health check:**
```
POST /health/predict
{"data": [""]}
```

**Respuesta:**
```json
{
  "data": [{
    "success": true,
    "output": "     ┌───┐\nq_0: ┤ H ├\n     └───┘",
    "bloch": {"probabilities": {"0": 0.5, "1": 0.5}},
    "time": 0.12,
    "libs": {"qiskit": "1.0.2", "qiskit-aer": "ok", "cirq": "1.3.0"}
  }]
}
```
