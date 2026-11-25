"""Cross-check: theoretical-gate prelude and U-synthesis output against real Qiskit. Skipped if qiskit/node are missing.
Run: python3 tests/test_theoretical_gates_qiskit.py"""
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
try:
    import numpy as np
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Operator
except Exception as e:
    print('SKIP (qiskit not installed):', e); sys.exit(0)
js = r"""
const T=require(process.argv[1]+'/quolab-nexus-theoretical-gates.js'), U=require(process.argv[1]+'/quolab-nexus-u-synthesis.js');
const s={m:{},getItem(k){return this.m[k]||null},setItem(k,v){this.m[k]=v}}; const c=new T.Catalog(s);
const a=c.create({name:'Alpha',nq:1,params:[{name:'t',def:0}],ops:[{g:'rz',q:[0],p:['t']},{g:'h',q:[0],p:[]}]}).gate;
const f=c.create({name:'Fx',nq:3,params:[{name:'t',def:0.2}],ops:[{g:'h',q:[2],p:[]},{g:'cx',q:[2,0],p:[]},{g:'@'+a.id,v:1,q:[1],p:['t*2+pi/4']},{g:'ccx',q:[0,1],p:[]}].slice(0,3).concat([{g:'ccx',q:[0,1,2],p:[]},{g:'u',q:[1],p:['t','0.3','-0.7']},{g:'cswap',q:[1,0,2],p:[]},{g:'rzz',q:[0,2],p:['t']}])}).gate;
const code='from qiskit import QuantumCircuit\nqc=QuantumCircuit(3)\nqc.F(0.5, 2, 0, 1)\nqc.A(0.9, 1)\n';
const flat=T.flatten(c.version(f),[{t:'num',v:0.5}],c).map(o=>({g:o.g,q:[2,0,1].length?o.q.map(x=>[2,0,1][x]):o.q,p:o.p}));
const fa=T.flatten(c.version(a),[{t:'num',v:0.9}],c).map(o=>({g:o.g,q:[1],p:o.p}));
const ref=T.unitaryOfFlat(3,flat.concat(fa));
const T2=U.randomUnitary(2,9), r=U.run({n:2,target:{re:Array.from(T2.re),im:Array.from(T2.im)},gateSet:'u3cx',tol:1e-6,maxMs:20000});
console.log(JSON.stringify({code:T.injectPrelude(code,c),re:Array.from(ref.re),im:Array.from(ref.im),t2:{re:Array.from(T2.re),im:Array.from(T2.im)},ops:r.ops}));
"""
out = subprocess.run(['node', '-e', js, root], capture_output=True, text=True, check=True).stdout
d = json.loads(out); ns = {}; exec(d['code'], ns)
op = Operator(ns['qc'].decompose(reps=1).decompose(reps=1)).data
ref = (np.array(d['re']) + 1j * np.array(d['im'])).reshape(8, 8)
assert np.abs(op - ref).max() < 1e-9, 'prelude/matrix mismatch %g' % np.abs(op - ref).max()
qc = QuantumCircuit(2)
for o in d['ops']:
    g, q, p = o['g'], o['q'], o['p']
    if g == 'u': qc.u(p[0], p[1], p[2], q[0])
    elif g == 'cx': qc.cx(q[0], q[1])
    else: getattr(qc, g)(*p, *q)
tgt = (np.array(d['t2']['re']) + 1j * np.array(d['t2']['im'])).reshape(4, 4)
ov = abs(np.trace(tgt.conj().T @ Operator(qc).data)) / 4
assert ov > 1 - 1e-9, 'synthesis mismatch %g' % ov
print('OK: theoretical gate matrices and U synthesis agree with Qiskit')
