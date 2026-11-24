/* QuOLab Nexus — U gate synthesis engine (100% local, no AI API).
 * Runs as a Web Worker (postMessage {cmd:'run', job}) or as a plain library (QuOLabUSynth.run(job, onProgress, shouldCancel)).
 * Matrices: {n, d, re:Float64Array, im:Float64Array} row-major; qubit 0 is the least-significant bit (Qiskit order).
 * Strategies: (1) 1 qubit — exact ZYZ; (2) continuous — layered ansatz [U3 on every qubit] + CX layers with
 * multi-start BFGS (iterative deepening over the CX count); (3) discrete — breadth-first search over a chosen gate set with
 * global-phase de-duplication; (4) peephole rewrite rules; (5) result cache (done by the host).
 */
(function (root) {
  'use strict';
  var PI = Math.PI;

  // ───────── complex matrix helpers ─────────
  function mk(n) { var d = 1 << n; return { n: n, d: d, re: new Float64Array(d * d), im: new Float64Array(d * d) }; }
  function ident(n) { var M = mk(n); for (var i = 0; i < M.d; i++) M.re[i * M.d + i] = 1; return M; }
  function clone(M) { return { n: M.n, d: M.d, re: M.re.slice(), im: M.im.slice() }; }
  function mul(A, B) {
    var d = A.d, C = mk(A.n);
    for (var i = 0; i < d; i++) for (var k = 0; k < d; k++) {
      var ar = A.re[i * d + k], ai = A.im[i * d + k]; if (ar === 0 && ai === 0) continue;
      for (var j = 0; j < d; j++) { var br = B.re[k * d + j], bi = B.im[k * d + j]; C.re[i * d + j] += ar * br - ai * bi; C.im[i * d + j] += ar * bi + ai * br; }
    }
    return C;
  }
  function dagger(A) { var d = A.d, B = mk(A.n); for (var i = 0; i < d; i++) for (var j = 0; j < d; j++) { B.re[j * d + i] = A.re[i * d + j]; B.im[j * d + i] = -A.im[i * d + j]; } return B; }
  function unitErr(U) { var P = mul(dagger(U), U), d = U.d, w = 0; for (var i = 0; i < d; i++) for (var j = 0; j < d; j++) { w = Math.max(w, Math.abs(P.re[i * d + j] - (i === j ? 1 : 0)), Math.abs(P.im[i * d + j])); } return w; }
  // |tr(T† U)| / d  — 1 means equal up to a global phase
  function overlap(T, U) {
    var d = T.d, tr = 0, ti = 0, n = d * d;
    for (var k = 0; k < n; k++) { tr += T.re[k] * U.re[k] + T.im[k] * U.im[k]; ti += T.re[k] * U.im[k] - T.im[k] * U.re[k]; }
    return Math.sqrt(tr * tr + ti * ti) / d;
  }

  // ───────── gate library (local matrices as [re, im] pairs) ─────────
  var S2 = Math.SQRT1_2;
  function C(r, i) { return [r, i || 0]; }
  function rz(a) { return [[C(Math.cos(-a / 2), Math.sin(-a / 2)), C(0)], [C(0), C(Math.cos(a / 2), Math.sin(a / 2))]]; }
  function ry(a) { var c = Math.cos(a / 2), s = Math.sin(a / 2); return [[C(c), C(-s)], [C(s), C(c)]]; }
  function rx(a) { var c = Math.cos(a / 2), s = Math.sin(a / 2); return [[C(c), C(0, -s)], [C(0, -s), C(c)]]; }
  function ph(a) { return [[C(1), C(0)], [C(0), C(Math.cos(a), Math.sin(a))]]; }
  var FIX = {
    h: [[C(S2), C(S2)], [C(S2), C(-S2)]], x: [[C(0), C(1)], [C(1), C(0)]], y: [[C(0), C(0, -1)], [C(0, 1), C(0)]], z: [[C(1), C(0)], [C(0), C(-1)]],
    s: ph(PI / 2), sdg: ph(-PI / 2), t: ph(PI / 4), tdg: ph(-PI / 4),
    sx: [[C(0.5, 0.5), C(0.5, -0.5)], [C(0.5, -0.5), C(0.5, 0.5)]], sxdg: [[C(0.5, -0.5), C(0.5, 0.5)], [C(0.5, 0.5), C(0.5, -0.5)]]
  };
  var INV = { h: 'h', x: 'x', y: 'y', z: 'z', s: 'sdg', sdg: 's', t: 'tdg', tdg: 't', sx: 'sxdg', sxdg: 'sx', cx: 'cx', cz: 'cz', swap: 'swap' };
  var ARITY = { cx: 2, cz: 2, swap: 2 };
  function local(name, p) {
    if (FIX[name]) return FIX[name];
    if (name === 'rz') return rz(p[0]); if (name === 'ry') return ry(p[0]); if (name === 'rx') return rx(p[0]); if (name === 'p') return ph(p[0]);
    if (name === 'u') { // U3(θ,φ,λ) = Rz(φ) Ry(θ) Rz(λ) · e^{i(φ+λ)/2}
      var t = p[0], f = p[1], l = p[2], c = Math.cos(t / 2), s = Math.sin(t / 2);
      return [[C(c), C(-s * Math.cos(l), -s * Math.sin(l))], [C(s * Math.cos(f), s * Math.sin(f)), C(c * Math.cos(f + l), c * Math.sin(f + l))]];
    }
    throw new Error('unknown gate ' + name);
  }
  // left-multiply the running unitary by a gate (in place)
  function apply1(U, q, m) {
    var d = U.d, bit = 1 << q;
    for (var r = 0; r < d; r++) {
      if (r & bit) continue; var r1 = r | bit;
      for (var c = 0; c < d; c++) {
        var a = r * d + c, b = r1 * d + c, ar = U.re[a], ai = U.im[a], br = U.re[b], bi = U.im[b];
        U.re[a] = m[0][0][0] * ar - m[0][0][1] * ai + m[0][1][0] * br - m[0][1][1] * bi; U.im[a] = m[0][0][0] * ai + m[0][0][1] * ar + m[0][1][0] * bi + m[0][1][1] * br;
        U.re[b] = m[1][0][0] * ar - m[1][0][1] * ai + m[1][1][0] * br - m[1][1][1] * bi; U.im[b] = m[1][0][0] * ai + m[1][0][1] * ar + m[1][1][0] * bi + m[1][1][1] * br;
      }
    }
  }
  function swapRows(U, r1, r2) { var d = U.d, a = r1 * d, b = r2 * d; for (var c = 0; c < d; c++) { var t = U.re[a + c]; U.re[a + c] = U.re[b + c]; U.re[b + c] = t; t = U.im[a + c]; U.im[a + c] = U.im[b + c]; U.im[b + c] = t; } }
  function applyCX(U, c, t) { var d = U.d, cb = 1 << c, tb = 1 << t; for (var r = 0; r < d; r++) if ((r & cb) && !(r & tb)) swapRows(U, r, r | tb); }
  function applyCZ(U, a, b) { var d = U.d, m = (1 << a) | (1 << b); for (var r = 0; r < d; r++) if ((r & m) === m) for (var c = 0; c < d; c++) { U.re[r * d + c] *= -1; U.im[r * d + c] *= -1; } }
  function applySwap(U, a, b) { var d = U.d, ab = 1 << a, bb = 1 << b; for (var r = 0; r < d; r++) if ((r & ab) && !(r & bb)) swapRows(U, r, (r ^ ab) | bb); }
  function applyOp(U, op) {
    var g = op.g;
    if (g === 'cx') applyCX(U, op.q[0], op.q[1]); else if (g === 'cz') applyCZ(U, op.q[0], op.q[1]); else if (g === 'swap') applySwap(U, op.q[0], op.q[1]);
    else apply1(U, op.q[0], local(g, op.p || []));
  }
  function unitaryOf(n, ops) { var U = ident(n); for (var i = 0; i < ops.length; i++) applyOp(U, ops[i]); return U; }

  // ───────── target construction ─────────
  function completeBasis(v, n) { // unitary whose first column is v (Gram–Schmidt over the standard basis)
    var d = 1 << n, cols = [v];
    for (var k = 0; k < d && cols.length < d; k++) {
      var w = { re: new Float64Array(d), im: new Float64Array(d) }; w.re[k] = 1;
      cols.forEach(function (u) { var pr = 0, pi = 0; for (var i = 0; i < d; i++) { pr += u.re[i] * w.re[i] + u.im[i] * w.im[i]; pi += u.re[i] * w.im[i] - u.im[i] * w.re[i]; } for (var j = 0; j < d; j++) { w.re[j] -= pr * u.re[j] - pi * u.im[j]; w.im[j] -= pr * u.im[j] + pi * u.re[j]; } });
      var nrm = 0; for (var m = 0; m < d; m++) nrm += w.re[m] * w.re[m] + w.im[m] * w.im[m]; nrm = Math.sqrt(nrm);
      if (nrm > 1e-6) { for (var m2 = 0; m2 < d; m2++) { w.re[m2] /= nrm; w.im[m2] /= nrm; } cols.push(w); }
    }
    var M = mk(n); cols.forEach(function (c, j) { for (var i = 0; i < d; i++) { M.re[i * d + j] = c.re[i]; M.im[i * d + j] = c.im[i]; } }); return M;
  }
  function vecNorm(v) { var s = 0; for (var i = 0; i < v.re.length; i++) s += v.re[i] * v.re[i] + v.im[i] * v.im[i]; return Math.sqrt(s); }
  // unitary mapping |a⟩ → |b⟩ (one of infinitely many; the rest of the space is completed arbitrarily)
  function stateMapUnitary(a, b, n) {
    var d = 1 << n, na = vecNorm(a), nb = vecNorm(b);
    if (na < 1e-12 || nb < 1e-12) throw new Error('A state vector is zero.');
    var A = { re: a.re.map(function (x) { return x / na; }), im: a.im.map(function (x) { return x / na; }) }, B = { re: b.re.map(function (x) { return x / nb; }), im: b.im.map(function (x) { return x / nb; }) };
    return mul(completeBasis(B, n), dagger(completeBasis(A, n)));
  }
  function qft(n) { var d = 1 << n, M = mk(n); for (var j = 0; j < d; j++) for (var k = 0; k < d; k++) { var a = 2 * PI * j * k / d; M.re[j * d + k] = Math.cos(a) / Math.sqrt(d); M.im[j * d + k] = Math.sin(a) / Math.sqrt(d); } return M; }
  function randomUnitary(n, seed) {
    var d = 1 << n, rnd = mulberry(seed || 1), M = mk(n), cols = [];
    for (var j = 0; j < d; j++) { var v = { re: new Float64Array(d), im: new Float64Array(d) }; for (var i = 0; i < d; i++) { v.re[i] = gauss(rnd); v.im[i] = gauss(rnd); }
      cols.forEach(function (u) { var pr = 0, pi = 0; for (var i2 = 0; i2 < d; i2++) { pr += u.re[i2] * v.re[i2] + u.im[i2] * v.im[i2]; pi += u.re[i2] * v.im[i2] - u.im[i2] * v.re[i2]; } for (var k = 0; k < d; k++) { v.re[k] -= pr * u.re[k] - pi * u.im[k]; v.im[k] -= pr * u.im[k] + pi * u.re[k]; } });
      var nr = vecNorm(v); for (var m = 0; m < d; m++) { v.re[m] /= nr; v.im[m] /= nr; } cols.push(v); }
    cols.forEach(function (c, j) { for (var i = 0; i < d; i++) { M.re[i * d + j] = c.re[i]; M.im[i * d + j] = c.im[i]; } }); return M;
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v); }
  // nearest-unitary by Newton iteration U ← 1.5U − 0.5 U U† U (converges for matrices close to unitary)
  function polarFix(M) { var U = clone(M); for (var it = 0; it < 60; it++) { var UU = mul(mul(U, dagger(U)), U); for (var k = 0; k < U.re.length; k++) { U.re[k] = 1.5 * U.re[k] - 0.5 * UU.re[k]; U.im[k] = 1.5 * U.im[k] - 0.5 * UU.im[k]; } if (unitErr(U) < 1e-13) break; } return U; }

  // ───────── 1 qubit: exact ZYZ ─────────
  function zyz1(T) {
    // T = e^{iα} Rz(φ) Ry(θ) Rz(λ)
    var a = [T.re[0], T.im[0]], b = [T.re[1], T.im[1]], c = [T.re[2], T.im[2]], d = [T.re[3], T.im[3]];
    var det = [a[0] * d[0] - a[1] * d[1] - (b[0] * c[0] - b[1] * c[1]), a[0] * d[1] + a[1] * d[0] - (b[0] * c[1] + b[1] * c[0])];
    var alpha = Math.atan2(det[1], det[0]) / 2;            // det = e^{2iα}
    var e = [Math.cos(-alpha), Math.sin(-alpha)];
    function cm(x) { return [x[0] * e[0] - x[1] * e[1], x[0] * e[1] + x[1] * e[0]]; }
    var A = cm(a), B = cm(b), Cc = cm(c), D = cm(d);        // SU(2): [[cos e^{-i(φ+λ)/2}, −sin e^{-i(φ−λ)/2}],[sin e^{i(φ−λ)/2}, cos e^{i(φ+λ)/2}]]
    var th = 2 * Math.atan2(Math.hypot(Cc[0], Cc[1]), Math.hypot(A[0], A[1]));
    var sum = 2 * Math.atan2(D[1], D[0]), diff = 2 * Math.atan2(Cc[1], Cc[0]);
    if (Math.hypot(A[0], A[1]) < 1e-12) sum = 0; if (Math.hypot(Cc[0], Cc[1]) < 1e-12) diff = 0;
    return { theta: th, phi: (sum + diff) / 2, lam: (sum - diff) / 2 };
  }

  // ───────── continuous optimization ─────────
  function pairsFor(n) { var p = []; for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) p.push([i, j]); return p; }
  function ansatzOps(n, k, prm) {
    var ops = [], pairs = pairsFor(n), idx = 0;
    function layer() { for (var q = 0; q < n; q++) { ops.push({ g: 'u', q: [q], p: [prm[idx], prm[idx + 1], prm[idx + 2]] }); idx += 3; } }
    layer();
    for (var i = 0; i < k; i++) { var pr = pairs[i % pairs.length]; ops.push({ g: 'cx', q: [pr[0], pr[1]], p: [] }); layer(); }
    return ops;
  }
  function costOf(T, n, k, prm) { return 1 - overlap(T, unitaryOf(n, ansatzOps(n, k, prm))); }
  function bfgs(T, n, k, x0, maxIter, deadline, cancel) {
    var N = x0.length, x = x0.slice(), f = costOf(T, n, k, x), H = []; for (var i = 0; i < N; i++) { H.push(new Float64Array(N)); H[i][i] = 1; }
    function grad(x) { var g = new Float64Array(N), h = 1e-6; for (var i = 0; i < N; i++) { var xi = x[i]; x[i] = xi + h; var f1 = costOf(T, n, k, x); x[i] = xi - h; var f2 = costOf(T, n, k, x); x[i] = xi; g[i] = (f1 - f2) / (2 * h); } return g; }
    var g = grad(x);
    for (var it = 0; it < maxIter; it++) {
      if (f < 1e-13 || Date.now() > deadline || cancel()) break;
      var p = new Float64Array(N); for (var a = 0; a < N; a++) { var s = 0; for (var b = 0; b < N; b++) s -= H[a][b] * g[b]; p[a] = s; }
      var gp = 0; for (var c = 0; c < N; c++) gp += g[c] * p[c]; if (gp >= 0) { for (var r = 0; r < N; r++) { p[r] = -g[r]; for (var r2 = 0; r2 < N; r2++) H[r][r2] = r === r2 ? 1 : 0; } gp = 0; for (var c2 = 0; c2 < N; c2++) gp += g[c2] * p[c2]; }
      var step = 1, xn = new Float64Array(N), fn = f, ok = false;
      for (var ls = 0; ls < 30; ls++) { for (var m = 0; m < N; m++) xn[m] = x[m] + step * p[m]; fn = costOf(T, n, k, xn); if (fn <= f + 1e-4 * step * gp) { ok = true; break; } step *= 0.5; }
      if (!ok) break;
      var gn = grad(xn), sv = new Float64Array(N), yv = new Float64Array(N), sy = 0; for (var u = 0; u < N; u++) { sv[u] = xn[u] - x[u]; yv[u] = gn[u] - g[u]; sy += sv[u] * yv[u]; }
      if (sy > 1e-14) { var Hy = new Float64Array(N), yHy = 0; for (var a2 = 0; a2 < N; a2++) { var t = 0; for (var b2 = 0; b2 < N; b2++) t += H[a2][b2] * yv[b2]; Hy[a2] = t; yHy += yv[a2] * t; }
        for (var a3 = 0; a3 < N; a3++) for (var b3 = 0; b3 < N; b3++) H[a3][b3] += (1 + yHy / sy) * sv[a3] * sv[b3] / sy - (Hy[a3] * sv[b3] + sv[a3] * Hy[b3]) / sy; }
      x = Array.prototype.slice.call(xn); f = fn; g = gn;
    }
    return { x: x, f: f };
  }

  // ───────── rewrite rules (peephole) ─────────
  function twoPi(a) { a = a % (2 * PI); if (a > PI) a -= 2 * PI; if (a < -PI) a += 2 * PI; return a; }
  function simplify(n, ops, tol) {
    var target = unitaryOf(n, ops), cur = ops.map(function (o) { return { g: o.g, q: o.q.slice(), p: (o.p || []).slice() }; }), changed = true, guard = 0;
    function touches(o, qs) { return o.q.some(function (x) { return qs.indexOf(x) >= 0; }); }
    while (changed && guard++ < 200) {
      changed = false;
      for (var i = 0; i < cur.length && !changed; i++) {
        var a = cur[i];
        if ((a.g === 'rz' || a.g === 'ry' || a.g === 'rx' || a.g === 'p') && Math.abs(twoPi(a.p[0])) < 1e-10) { cur.splice(i, 1); changed = true; break; }
        if (a.g === 'u' && Math.abs(a.p[0]) < 1e-10 && Math.abs(twoPi(a.p[1] + a.p[2])) < 1e-10) { cur.splice(i, 1); changed = true; break; }
        var j = i + 1; while (j < cur.length && !touches(cur[j], a.q)) j++;
        if (j >= cur.length) continue; var b = cur[j];
        if (b.q.length !== a.q.length || b.q.some(function (x, k) { return x !== a.q[k]; })) { if (!(a.g === 'cz' || a.g === 'swap') || a.g !== b.g || a.q.slice().sort().join() !== b.q.slice().sort().join()) continue; }
        if (INV[a.g] === b.g && !a.p.length && !b.p.length) { cur.splice(j, 1); cur.splice(i, 1); changed = true; break; }
        if (a.g === b.g && /^(rz|ry|rx|p)$/.test(a.g)) { a.p = [a.p[0] + b.p[0]]; cur.splice(j, 1); changed = true; break; }
        if (a.g === 't' && b.g === 't') { a.g = 's'; cur.splice(j, 1); changed = true; break; }
        if (a.g === 'tdg' && b.g === 'tdg') { a.g = 'sdg'; cur.splice(j, 1); changed = true; break; }
        if (a.g === 's' && b.g === 's') { a.g = 'z'; cur.splice(j, 1); changed = true; break; }
        if (a.g === 'sdg' && b.g === 'sdg') { a.g = 'z'; cur.splice(j, 1); changed = true; break; }
      }
    }
    return overlap(target, unitaryOf(n, cur)) > 1 - 1e-10 ? cur : ops;      // never keep a rewrite that changes the operator
  }

  // ───────── emit gate-set variants ─────────
  function lowerOps(ops, set) {
    if (set !== 'rzrycx') return ops;
    var out = []; ops.forEach(function (o) { if (o.g === 'u') { out.push({ g: 'rz', q: o.q, p: [o.p[2]] }, { g: 'ry', q: o.q, p: [o.p[0]] }, { g: 'rz', q: o.q, p: [o.p[1]] }); } else out.push(o); }); return out;
  }
  function metrics(n, ops, T, elapsed, extra) {
    var U = unitaryOf(n, ops), ov = overlap(T, U), cnt = ops.length, two = ops.filter(function (o) { return o.q.length > 1; }).length, depthArr = new Array(n).fill(0), dep = 0;
    ops.forEach(function (o) { var m = 0; o.q.forEach(function (q) { m = Math.max(m, depthArr[q]); }); o.q.forEach(function (q) { depthArr[q] = m + 1; }); dep = Math.max(dep, m + 1); });
    return Object.assign({ fidelity: ov, error: Math.max(0, 1 - ov), distance: Math.sqrt(Math.max(0, 1 - ov * ov)), gates: cnt, twoQubit: two, depth: dep, ms: Math.round(elapsed) }, extra || {});
  }

  // ───────── discrete search (iterative deepening BFS over a gate set) ─────────
  function canonKey(U) {
    var d = U.d, k = 0, best = 0; for (var i = 0; i < d * d; i++) { var m = U.re[i] * U.re[i] + U.im[i] * U.im[i]; if (m > best + 1e-9) { best = m; k = i; } }
    var pr = U.re[k], pi = U.im[k], nr = Math.hypot(pr, pi), cr = pr / nr, ci = -pi / nr, s = '';
    for (var j = 0; j < d * d; j++) { var re = U.re[j] * cr - U.im[j] * ci, im = U.re[j] * ci + U.im[j] * cr; s += Math.round(re * 1e5) + ',' + Math.round(im * 1e5) + ';'; }
    return s;
  }
  function discreteSearch(T, n, gateSet, opt, progress, cancel) {
    var moves = [];
    gateSet.forEach(function (g) {
      if (ARITY[g] === 2) { if (n < 2) return; for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) { if (a === b) continue; if ((g === 'cz' || g === 'swap') && a > b) continue; moves.push({ g: g, q: [a, b], p: [] }); } }
      else for (var q = 0; q < n; q++) moves.push({ g: g, q: [q], p: [] });
    });
    var seen = Object.create(null), I = ident(n), frontier = [{ U: I, seq: [] }], best = { ov: overlap(T, I), seq: [] }, nodes = 0, deadline = Date.now() + opt.maxMs, status = 'exhausted';
    seen[canonKey(I)] = 1;
    for (var depth = 1; depth <= opt.maxDepth; depth++) {
      var next = [];
      for (var f = 0; f < frontier.length; f++) {
        var node = frontier[f];
        for (var m = 0; m < moves.length; m++) {
          var mv = moves[m], U2 = clone(node.U); applyOp(U2, mv); nodes++;
          var key = canonKey(U2); if (seen[key]) continue; seen[key] = 1;
          var seq = node.seq.concat([mv]), ov = overlap(T, U2);
          if (ov > best.ov + 1e-12) { best = { ov: ov, seq: seq }; }
          if (1 - ov < 1e-9 || (opt.stopAtTol && 1 - ov <= opt.tol)) { return { seq: seq, ov: ov, nodes: nodes, status: 'found' }; }
          next.push({ U: U2, seq: seq });
          if (nodes >= opt.maxNodes) return { seq: best.seq, ov: best.ov, nodes: nodes, status: 'node-limit' };
        }
        if ((f & 63) === 0) { if (Date.now() > deadline) return { seq: best.seq, ov: best.ov, nodes: nodes, status: 'time-limit' }; if (cancel()) return { seq: best.seq, ov: best.ov, nodes: nodes, status: 'cancelled' }; }
      }
      progress({ phase: 'discrete', depth: depth, nodes: nodes, best: 1 - best.ov, frac: Math.min(0.95, nodes / opt.maxNodes) });
      frontier = next; if (!frontier.length) break;
    }
    return { seq: best.seq, ov: best.ov, nodes: nodes, status: status };
  }

  // ───────── main entry ─────────
  // job = { n, target:{re[],im[]}, gateSet:'u3cx'|'rzrycx'|'discrete', discreteGates:[...], tol, maxMs, maxCx, restarts, maxDepth, maxNodes, seed, stateCheck?:{a,b} }
  function run(job, onProgress, shouldCancel) {
    var t0 = Date.now(), n = job.n, cancel = shouldCancel || function () { return false; }, progress = onProgress || function () {};
    if (n < 1 || n > 3) return { status: 'unsupported', message: 'Synthesis supports 1 to 3 qubits. A ' + n + '-qubit operator has 4^' + n + ' complex entries; use structured decompositions (parameterized gates) instead.', ops: [] };
    var T = { n: n, d: 1 << n, re: Float64Array.from(job.target.re), im: Float64Array.from(job.target.im) };
    var uerr = unitErr(T); if (uerr > 1e-6) return { status: 'none', message: 'The target is not unitary (‖U†U−I‖∞ = ' + uerr.toExponential(2) + '). Only unitary operators can be built from quantum gates.', ops: [] };
    var tol = job.tol != null ? job.tol : 1e-6, maxMs = (job.maxMs || 20000), deadline = t0 + maxMs, ops = null, limits = [], method = '';
    var cacheNote = '';
    if (job.gateSet === 'discrete') {
      var gs = (job.discreteGates && job.discreteGates.length) ? job.discreteGates : ['h', 's', 't', 'cx'];
      var maxNodes = job.maxNodes || 250000, r = discreteSearch(T, n, gs, { maxDepth: job.maxDepth || 24, maxNodes: maxNodes, maxMs: maxMs, tol: tol, stopAtTol: true }, progress, cancel);
      ops = r.seq; method = 'Discrete search (breadth-first, phase-deduplicated) over {' + gs.join(', ') + '} · ' + r.nodes + ' nodes explored';
      if (r.status === 'node-limit') limits.push('Stopped at the node limit (' + maxNodes + ').'); if (r.status === 'time-limit') limits.push('Stopped at the time limit.'); if (r.status === 'cancelled') limits.push('Cancelled by the user.');
      if (r.status === 'exhausted') limits.push('The search space up to the maximum depth was exhausted.');
    } else if (n === 1) {
      var z = zyz1(T); ops = [{ g: 'u', q: [0], p: [z.theta, z.phi, z.lam] }]; method = 'Exact ZYZ decomposition (1 qubit)';
    } else {
      var maxCx = job.maxCx != null ? job.maxCx : (n === 2 ? 3 : 14), rnd = mulberry(job.seed || 7), bestAll = null, restarts = job.restarts || (n === 2 ? 12 : 6), startK = n === 2 ? 0 : 3, tried = 0, exactK = -1;
      outer: for (var k = startK; k <= maxCx; k++) {
        var Np = 3 * n * (k + 1), bestK = null;
        for (var r2 = 0; r2 < restarts; r2++) {
          if (Date.now() > deadline) { limits.push('Stopped at the time limit.'); break outer; } if (cancel()) { limits.push('Cancelled by the user.'); break outer; }
          var x0 = []; for (var i = 0; i < Np; i++) x0.push((rnd() * 2 - 1) * PI);
          var res = bfgs(T, n, k, x0, n === 2 ? 220 : 160, deadline, cancel); tried++;
          if (!bestK || res.f < bestK.f) bestK = res;
          progress({ phase: 'continuous', cx: k, restart: r2 + 1, restarts: restarts, best: bestAll ? Math.min(bestAll.f, bestK.f) : bestK.f, frac: Math.min(0.97, (k - startK + (r2 + 1) / restarts) / (maxCx - startK + 1)) });
          if (res.f < Math.max(1e-11, 0)) break;
        }
        if (bestK && (!bestAll || bestK.f < bestAll.f - 1e-12 || bestK.f < 1e-9)) bestAll = { f: bestK.f, x: bestK.x, k: k };
        if (bestAll && bestAll.f < 1e-9) { exactK = k; break; }
        if (bestAll && bestAll.f <= tol && n === 3) break;
      }
      if (!bestAll) return { status: 'none', message: 'No candidate was evaluated before the limit.', ops: [], limits: limits };
      ops = ansatzOps(n, bestAll.k, bestAll.x); method = 'Layered ansatz (U3 layers + ' + bestAll.k + ' CX) · multi-start BFGS · ' + tried + ' optimizations';
      if (exactK < 0 && n === 3) limits.push('3-qubit synthesis is best-effort: generic operators need ~14–20 CX and the optimizer may stop at a local minimum. Raise the time limit or restarts to improve.');
    }
    ops = simplify(n, ops, tol); var lowered = lowerOps(ops, job.gateSet);
    var met = metrics(n, lowered, T, Date.now() - t0, { method: method });
    var status = met.error < 1e-9 ? 'exact' : met.error <= tol ? 'approximation' : (lowered.length ? 'best' : 'none');
    if (job.stateCheck) { var Ur = unitaryOf(n, lowered), a = job.stateCheck.a, b = job.stateCheck.b, d = 1 << n, pr = 0, pi = 0; for (var i2 = 0; i2 < d; i2++) { var vr = 0, vi = 0; for (var j2 = 0; j2 < d; j2++) { vr += Ur.re[i2 * d + j2] * a.re[j2] - Ur.im[i2 * d + j2] * a.im[j2]; vi += Ur.re[i2 * d + j2] * a.im[j2] + Ur.im[i2 * d + j2] * a.re[j2]; } pr += b.re[i2] * vr + b.im[i2] * vi; pi += b.re[i2] * vi - b.im[i2] * vr; } met.stateFidelity = pr * pr + pi * pi; }
    var msg = status === 'none' ? 'No gate sequence improved on the identity within the limits. Raise the node/time limits, add gates to the set, or use the continuous gate set (U3 + CX).' : '';
    if (status === 'none') lowered = [];
    return { status: status, message: msg, ops: lowered.map(function (o) { return { g: o.g, q: o.q.slice(), p: (o.p || []).map(function (x) { return +(+x).toPrecision(12); }) }; }), metrics: met, limits: limits };
  }

  var API = { run: run, mk: mk, ident: ident, mul: mul, dagger: dagger, unitErr: unitErr, overlap: overlap, unitaryOf: unitaryOf, stateMapUnitary: stateMapUnitary, qft: qft, randomUnitary: randomUnitary, polarFix: polarFix, simplify: simplify, local: local, zyz1: zyz1 };
  root.QuOLabUSynth = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  // worker mode
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    var cancelled = false;
    root.onmessage = function (e) {
      var m = e.data || {};
      if (m.cmd === 'cancel') { cancelled = true; return; }
      if (m.cmd === 'run') {
        cancelled = false;
        try { var res = run(m.job, function (p) { root.postMessage({ type: 'progress', p: p }); }, function () { return cancelled; }); root.postMessage({ type: 'done', result: res }); }
        catch (err) { root.postMessage({ type: 'error', message: String(err && err.message || err) }); }
      }
    };
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
