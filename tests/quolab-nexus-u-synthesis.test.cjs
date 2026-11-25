'use strict';
const assert = require('assert');
const U = require('../quolab-nexus-u-synthesis.js');
let n = 0; function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e)); process.exitCode = 1; } }
const job = (T, x) => Object.assign({ n: T.n, target: { re: Array.from(T.re), im: Array.from(T.im) }, gateSet: 'u3cx', tol: 1e-6, maxMs: 20000 }, x || {});
t('1 qubit random unitary: exact, 1 gate', () => { const r = U.run(job(U.randomUnitary(1, 11))); assert.strictEqual(r.status, 'exact'); assert.strictEqual(r.ops.length, 1); });
t('2 qubit QFT: exact with ≤3 CX, verified independently', () => {
  const T = U.qft(2), r = U.run(job(T)); assert.strictEqual(r.status, 'exact'); assert(r.metrics.twoQubit <= 3);
  assert(U.overlap(T, U.unitaryOf(2, r.ops)) > 1 - 1e-10);
});
t('Rz/Ry/CX gate set emits only those gates', () => {
  const r = U.run(job(U.randomUnitary(2, 4), { gateSet: 'rzrycx' })); assert.strictEqual(r.status, 'exact'); assert(r.ops.every(o => /^(rz|ry|cx)$/.test(o.g)));
});
t('discrete set finds H exactly and approximates Rz within tolerance', () => {
  assert.strictEqual(U.run(job(U.unitaryOf(1, [{ g: 'h', q: [0] }]), { gateSet: 'discrete', discreteGates: ['h', 's', 't'] })).status, 'exact');
  const r = U.run(job(U.unitaryOf(1, [{ g: 'rz', q: [0], p: [0.3] }]), { gateSet: 'discrete', discreteGates: ['h', 't', 'tdg', 's'], tol: 0.02, maxDepth: 30 }));
  assert(['approximation', 'exact'].includes(r.status)); assert(r.metrics.error <= 0.02);
});
t('non-unitary and >3 qubits are refused honestly', () => {
  const bad = U.mk(1); bad.re[0] = 1; bad.re[3] = 2; assert.strictEqual(U.run(job(bad)).status, 'none');
  assert.strictEqual(U.run(job(U.mk(2), { n: 4 })).status, 'unsupported');
});
t('state map: Bell state reached with fidelity 1', () => {
  const a = { re: new Float64Array([1, 0, 0, 0]), im: new Float64Array(4) }, b = { re: new Float64Array([Math.SQRT1_2, 0, 0, Math.SQRT1_2]), im: new Float64Array(4) };
  const r = U.run(job(U.stateMapUnitary(a, b, 2), { stateCheck: { a, b } })); assert(Math.abs(r.metrics.stateFidelity - 1) < 1e-9);
});
t('cancellation returns promptly', () => {
  const t0 = Date.now(); const r = U.run(job(U.randomUnitary(3, 2), { maxMs: 60000 }), null, () => Date.now() - t0 > 300);
  assert(Date.now() - t0 < 5000); assert(r.limits.some(l => /Cancelled/.test(l)) || r.status === 'exact');
});
t('polarFix returns a unitary', () => { const M = U.randomUnitary(2, 3); M.re[0] *= 1.05; assert(U.unitErr(U.polarFix(M)) < 1e-9); });
console.log(n + ' passed');
