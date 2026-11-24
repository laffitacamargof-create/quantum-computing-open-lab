/* QuOLab Nexus — U gate window (target → synthesized circuit). Local only; no AI API.
 * Needs: quolab-nexus-theoretical-gates.js, quolab-nexus-tg-ui.js, quolab-nexus-u-synthesis.js
 * window.QuOLabUGate = { open(mode), complex(text) }
 */
(function (root) {
  'use strict';
  var TG = root.QuOLabTheoreticalGates, UI = root.QuOLabTGUI, SY = root.QuOLabUSynth, doc = root.document;
  if (!TG || !UI || !SY || !doc) return;
  var cat = TG.catalog(), esc = UI.esc, PI = Math.PI;
  var CACHE_KEY = 'nexus_u_cache_v1', last = null;

  // ───────── complex expression parser (no eval) ─────────
  function cparse(src) {
    var s = String(src).replace(/\*\*/g, '^').replace(/π/g, 'pi').replace(/√/g, 'sqrt'), i = 0;
    function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
    function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
    function mul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
    function div(a, b) { var d = b[0] * b[0] + b[1] * b[1]; if (d === 0) throw new Error('Division by zero'); return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }
    function cexp(a) { var e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; }
    function clog(a) { return [Math.log(Math.hypot(a[0], a[1])), Math.atan2(a[1], a[0])]; }
    function csqrt(a) { var r = Math.hypot(a[0], a[1]); if (r === 0) return [0, 0]; var re = Math.sqrt((r + a[0]) / 2), im = Math.sqrt((r - a[0]) / 2); return [re, a[1] < 0 ? -im : im]; }
    function expr() { var v = term(); for (;;) { ws(); if (s[i] === '+') { i++; v = add(v, term()); } else if (s[i] === '-') { i++; var t = term(); v = add(v, [-t[0], -t[1]]); } else return v; } }
    function term() { var v = unary(); for (;;) { ws(); if (s[i] === '*') { i++; v = mul(v, unary()); } else if (s[i] === '/') { i++; v = div(v, unary()); } else return v; } }
    function unary() { ws(); if (s[i] === '-') { i++; var v = unary(); return [-v[0], -v[1]]; } if (s[i] === '+') { i++; return unary(); } return pow(); }
    function pow() { var b = atom(); ws(); if (s[i] === '^') { i++; var e = unary(); if (b[0] === 0 && b[1] === 0) return e[0] === 0 && e[1] === 0 ? [1, 0] : [0, 0]; return cexp(mul(e, clog(b))); } return b; }
    function atom() {
      ws(); var m;
      if (s[i] === '(') { i++; var v = expr(); ws(); if (s[i] !== ')') throw new Error('Missing )'); i++; return v; }
      if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i)))) { i += m[0].length; var x = [parseFloat(m[0]), 0]; if (/^\s*[ij]\b/.test(s.slice(i)) && !/^\s*[ij]\s*[A-Za-z_(]/.test(s.slice(i))) { i += s.slice(i).search(/[ij]/) + 1; return mul(x, [0, 1]); } return x; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i)))) {
        i += m[0].length; var n = m[0].toLowerCase();
        if (n === 'i' || n === 'j') return [0, 1]; if (n === 'pi') return [PI, 0]; if (n === 'tau') return [2 * PI, 0]; if (n === 'e') return [Math.E, 0];
        ws(); if (s[i] !== '(') throw new Error('Unknown name “' + m[0] + '”');
        i++; var a = expr(); ws(); if (s[i] !== ')') throw new Error('Missing )'); i++;
        if (n === 'sqrt') return csqrt(a); if (n === 'exp') return cexp(a); if (n === 'abs') return [Math.hypot(a[0], a[1]), 0];
        if (n === 'cos') return [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])]; if (n === 'sin') return [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
        throw new Error('Unknown function “' + m[0] + '”');
      }
      throw new Error('Cannot read “' + s.slice(i, i + 8) + '”');
    }
    var out = expr(); ws(); if (i < s.length) throw new Error('Unexpected “' + s.slice(i, i + 6) + '”'); return out;
  }
  function cfmt(c) { var f = function (x) { return (Math.abs(x) < 5e-13 ? 0 : +x.toFixed(6)).toString(); }; if (Math.abs(c[1]) < 5e-13) return f(c[0]); if (Math.abs(c[0]) < 5e-13) return f(c[1]) + 'i'; return f(c[0]) + (c[1] < 0 ? '-' : '+') + f(Math.abs(c[1])) + 'i'; }

  // ───────── state ─────────
  function dflt() {
    return { name: '', type: 'named', n: 2, named: 'qft', seed: 1, matrix: null, stateIn: null, stateOut: null, probs: null,
      set: { gateSet: 'u3cx', discrete: ['h', 's', 't', 'tdg', 'cx'], tol: 1e-6, maxMs: 20, maxCx: null, restarts: null, maxDepth: 24, maxNodes: 250000, seed: 7 }, result: null, id: null };
  }
  function ident(d) { var r = []; for (var i = 0; i < d; i++) { r.push([]); for (var j = 0; j < d; j++) r[i].push(i === j ? '1' : '0'); } return r; }
  function vecDefault(d, k) { var v = []; for (var i = 0; i < d; i++) v.push(i === k ? '1' : '0'); return v; }
  function parseVec(list, n) {
    var d = 1 << n, v = { re: new Float64Array(d), im: new Float64Array(d) };
    for (var i = 0; i < d; i++) { var c = cparse(list[i] || '0'); v.re[i] = c[0]; v.im[i] = c[1]; }
    return v;
  }
  function norm(v) { return SY.mul ? Math.sqrt(Array.prototype.reduce.call(v.re, function (a, x, i) { return a + x * x + v.im[i] * v.im[i]; }, 0)) : 1; }
  function unitVec(v) { var n = norm(v); if (n < 1e-12) throw new Error('The state vector is zero.'); return { re: v.re.map(function (x) { return x / n; }), im: v.im.map(function (x) { return x / n; }) }; }
  function entangled2(v) { var det = [v.re[0] * v.re[3] - v.im[0] * v.im[3] - (v.re[1] * v.re[2] - v.im[1] * v.im[2]), v.re[0] * v.im[3] + v.im[0] * v.re[3] - (v.re[1] * v.im[2] + v.im[1] * v.re[2])]; return Math.hypot(det[0], det[1]) > 1e-9; }

  // builds {T, warnings[], stateCheck?} from the configuration, or throws a readable Error
  function buildTarget(c) {
    var n = c.n, d = 1 << n, w = [];
    if (n < 1 || n > 3) throw new Error(n > 3 ? 'Synthesis supports up to 3 qubits: a ' + n + '-qubit operator has 4^' + n + ' = ' + Math.pow(4, n) + ' complex entries. For larger systems build the operator from parameterized gates or structured decompositions.' : 'Choose 1 to 3 qubits.');
    if (c.type === 'matrix') {
      var M = c.matrix && c.matrix.length === d ? c.matrix : ident(d), T = SY.mk(n);
      for (var i = 0; i < d; i++) for (var j = 0; j < d; j++) { var z; try { z = cparse(M[i][j]); } catch (e) { throw new Error('Entry (' + i + ',' + j + '): ' + e.message); } T.re[i * d + j] = z[0]; T.im[i * d + j] = z[1]; }
      return { T: T, w: w };
    }
    if (c.type === 'named') {
      var T2;
      switch (c.named) {
        case 'qft': T2 = SY.qft(n); break;
        case 'random': T2 = SY.randomUnitary(n, c.seed || 1); break;
        case 'toffoli': if (n !== 3) throw new Error('Toffoli needs exactly 3 qubits.'); T2 = TGmat('ccx', n); break;
        case 'fredkin': if (n !== 3) throw new Error('Fredkin needs exactly 3 qubits.'); T2 = TGmat('cswap', n); break;
        case 'cnot': if (n !== 2) throw new Error('CNOT needs exactly 2 qubits.'); T2 = TGmat('cx', n); break;
        case 'cz': if (n !== 2) throw new Error('CZ needs exactly 2 qubits.'); T2 = TGmat('cz', n); break;
        case 'swap': if (n !== 2) throw new Error('SWAP needs exactly 2 qubits.'); T2 = TGmat('swap', n); break;
        case 'iswap': if (n !== 2) throw new Error('iSWAP needs exactly 2 qubits.'); T2 = TGmat('iswap', n); break;
        default: if (n !== 1) throw new Error('This operator acts on 1 qubit.'); T2 = TGmat(c.named, n);
      }
      return { T: T2, w: w };
    }
    var a, b;
    if (c.type === 'state') {
      a = parseVec(c.stateIn || vecDefault(d, 0), n); b = parseVec(c.stateOut || vecDefault(d, d - 1), n);
      if (n === 2 && entangled2(b)) w.push('The target state is entangled: it cannot be described by single-qubit Bloch spheres; amplitudes (or a density matrix) are required.');
      w.push('A state transformation only fixes what happens to the chosen input. The synthesized operator maps |input⟩ → |target⟩ but is completed arbitrarily on the rest of the space — it is not a full operator valid for every input.');
    } else {
      var p = (c.probs || vecDefault(d, 0)).map(function (x) { var v = cparse(x)[0]; if (v < 0) throw new Error('Probabilities cannot be negative.'); return v; }), sum = p.reduce(function (s, x) { return s + x; }, 0);
      if (sum < 1e-12) throw new Error('The probabilities sum to zero.');
      a = parseVec(vecDefault(d, 0), n); b = { re: new Float64Array(d), im: new Float64Array(d) };
      p.forEach(function (x, i) { b.re[i] = Math.sqrt(x / sum); });
      w.push('A probability distribution does not define a unique operator (or even a unique state): the phases are free and entangled states need amplitudes. This builds the state with real positive amplitudes √pᵢ from |0…0⟩; any other phases give the same probabilities.');
      if (Math.abs(sum - 1) > 1e-9) w.push('The probabilities were normalized (they summed to ' + (+sum.toFixed(6)) + ').');
    }
    a = unitVec(a); b = unitVec(b);
    return { T: SY.stateMapUnitary(a, b, n), w: w, stateCheck: { a: { re: Array.from(a.re), im: Array.from(a.im) }, b: { re: Array.from(b.re), im: Array.from(b.im) } } };
  }
  function TGmat(name, n) { var U = TG.matrixOfBasic(name, []), T = SY.mk(n); T.re.set(U.re); T.im.set(U.im); return T; }

  // ───────── Bloch sphere (single-qubit states) ─────────
  function bloch(theta, phi, label) {
    var x = Math.sin(theta) * Math.cos(phi), y = Math.sin(theta) * Math.sin(phi), z = Math.cos(theta), cx = 70, cy = 70, R = 52;
    var px = cx + R * (x * 0.9 - y * 0.35), py = cy - R * (z * 0.9 + y * 0.3 * 0 + x * 0.0) + R * y * 0.35 * 0;
    return '<svg width="140" height="150" viewBox="0 0 140 150" role="img" aria-label="Bloch sphere ' + esc(label) + '"><circle cx="70" cy="70" r="52" fill="none" stroke="#3d5a8a"/><ellipse cx="70" cy="70" rx="52" ry="16" fill="none" stroke="#1e3058"/>' +
      '<line x1="70" y1="14" x2="70" y2="126" stroke="#1e3058"/><line x1="14" y1="70" x2="126" y2="70" stroke="#1e3058"/><text x="70" y="10" fill="#8aa0c4" font-size="9" text-anchor="middle">|0⟩</text><text x="70" y="140" fill="#8aa0c4" font-size="9" text-anchor="middle">|1⟩</text>' +
      '<line x1="70" y1="70" x2="' + (cx + R * (x * 0.95)).toFixed(1) + '" y2="' + (cy - R * (z * 0.95) + R * y * 0.3).toFixed(1) + '" stroke="#00ffdd" stroke-width="2.5"/><circle cx="' + (cx + R * (x * 0.95)).toFixed(1) + '" cy="' + (cy - R * (z * 0.95) + R * y * 0.3).toFixed(1) + '" r="4" fill="#00ffdd"/><text x="70" y="148" fill="#dce8ff" font-size="9" text-anchor="middle">' + esc(label) + '</text></svg>';
  }
  function blochOf(vec) { // vec: {re,im} of one qubit → [theta, phi]
    var a = Math.hypot(vec.re[0], vec.im[0]), th = 2 * Math.atan2(Math.hypot(vec.re[1], vec.im[1]), a), phi = Math.atan2(vec.im[1], vec.re[1]) - Math.atan2(vec.im[0], vec.re[0]);
    return [th, phi];
  }

  // ───────── cache / history ─────────
  function cacheGet(k) { try { var m = JSON.parse(root.localStorage.getItem(CACHE_KEY) || '{}'); return m[k] || null; } catch (_) { return null; } }
  function cachePut(k, v) { try { var m = JSON.parse(root.localStorage.getItem(CACHE_KEY) || '{}'), keys = Object.keys(m); if (keys.length >= 25) delete m[keys[0]]; m[k] = v; root.localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch (_) {} }
  function hash(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h >>> 0) + ':' + str.length; }

  // ───────── window ─────────
  function openWindow() {
    var C = dflt(), worker = null, running = false, W = {};
    var m = UI.modal({ title: 'U gate — operator synthesis', cls: 'mid', onClose: function () { if (worker) { worker.terminate(); worker = null; } } });
    m.body.innerHTML =
      '<div class="tgu-help" style="margin-bottom:.6rem"><b>What this does.</b> You describe a target; Quolab searches, <i>locally in your browser</i>, for a circuit of basic gates that implements it. It is a synthesis tool, not a physical gate, and no AI service is used.</div>' +
      '<div class="tgu-lbl">TARGET</div><div class="tgu-row"><select id="u-type" class="tgu-in" aria-label="Target type"><option value="named">Named operator</option><option value="matrix">Advanced operator (matrix)</option><option value="state">State transformation</option><option value="probs">Probability distribution</option></select>' +
      '<span class="tgu-lbl">QUBIT COUNT</span><input id="u-n" type="number" min="1" max="6" class="tgu-in" style="width:64px" aria-label="Qubit count"><span id="u-nhint" class="tgu-hint"></span></div>' +
      '<div id="u-target"></div><div id="u-warn"></div>' +
      '<div class="tgu-lbl" style="margin-top:.7rem">SYNTHESIS SETTINGS</div><div id="u-settings" class="tgu-row"></div><div id="u-est" class="tgu-hint"></div>' +
      '<div class="tgu-row" style="margin-top:.6rem"><button id="u-go" class="tgu-btn pri">Find implementation</button><button id="u-cancel" class="tgu-btn dng" disabled>Cancel</button><div id="u-prog" style="flex:1;min-width:140px"></div></div>' +
      '<div id="u-result"></div>' +
      '<div class="tgu-lbl" style="margin-top:.8rem">CONFIGURATIONS (local history)</div><div class="tgu-row"><input id="u-name" class="tgu-in" placeholder="Configuration name" style="flex:1;min-width:150px" aria-label="Configuration name"><button id="u-save" class="tgu-btn">Save configuration</button></div><div id="u-hist" class="tgu-list"></div>';
    ['type', 'n', 'nhint', 'target', 'warn', 'settings', 'est', 'go', 'cancel', 'prog', 'result', 'name', 'save', 'hist'].forEach(function (k) { W[k] = m.body.querySelector('#u-' + k); });
    function say(el, html, cls) { el.innerHTML = html ? '<div class="tgu-msg ' + (cls || '') + '">' + html + '</div>' : ''; }

    // ----- target editors -----
    function paintTarget() {
      var n = C.n, d = 1 << n, h = '';
      W.nhint.textContent = n > 3 ? '≥ 4 qubits: not supported for synthesis' : (d + '×' + d + ' operator · ' + d * d + ' complex entries');
      if (n > 3) { W.target.innerHTML = '<div class="tgu-msg wn">A ' + n + '-qubit operator has 4<sup>' + n + '</sup> = ' + Math.pow(4, n) + ' complex entries; editing it directly is not practical and synthesis is limited to 3 qubits. Build larger gates from parameters and decompositions (Create Theoretical Gate).</div>'; return; }
      if (C.type === 'named') {
        var opts = [['qft', 'Quantum Fourier transform (n qubits)'], ['random', 'Random unitary (seeded)'], ['h', 'Hadamard (1q)'], ['t', 'T (1q)'], ['sx', '√X (1q)'], ['toffoli', 'Toffoli (3q)'], ['fredkin', 'Fredkin (3q)'], ['cnot', 'CNOT (2q)'], ['cz', 'CZ (2q)'], ['swap', 'SWAP (2q)'], ['iswap', 'iSWAP (2q)']];
        h = '<div class="tgu-row"><select id="u-named" class="tgu-in" aria-label="Named operator">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (C.named === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select><span class="tgu-lbl">SEED</span><input id="u-seed" type="number" class="tgu-in" style="width:80px" value="' + (C.seed || 1) + '"></div>';
      } else if (C.type === 'matrix') {
        var M = C.matrix && C.matrix.length === d ? C.matrix : (C.matrix = ident(d));
        h = '<div class="tgu-hint" style="margin-bottom:.3rem">Entries accept expressions: <code>1/sqrt(2)</code>, <code>-i/sqrt(2)</code>, <code>exp(i*pi/4)</code>. Rows = output basis |q' + (n - 1) + '…q0⟩, columns = input.</div><div class="tgu-mx" style="max-height:34vh"><table>' +
          M.map(function (r, i) { return '<tr>' + r.map(function (v, j) { return '<td><input class="tgu-in u-m" data-i="' + i + '" data-j="' + j + '" style="width:' + (d > 4 ? 64 : 88) + 'px;text-align:center" value="' + esc(v) + '" aria-label="Entry ' + i + ',' + j + '"></td>'; }).join('') + '</tr>'; }).join('') + '</table></div>' +
          '<div class="tgu-row" style="margin-top:.4rem"><button id="u-id" class="tgu-btn">Identity</button><button id="u-fix" class="tgu-btn" title="Replace by the nearest unitary (Newton polar iteration)">Normalize to nearest unitary</button><span id="u-uerr" class="tgu-hint"></span></div>';
      } else {
        var isState = C.type === 'state', one = n === 1;
        if (isState) {
          var A = C.stateIn || (C.stateIn = vecDefault(d, 0)), B = C.stateOut || (C.stateOut = vecDefault(d, d - 1));
          h = '<div class="tgu-lbl">STATE / BLOCH SPHERES</div><div class="tgu-row"><div id="u-b1"></div><div id="u-b2"></div><div style="flex:1;min-width:200px">' +
            '<div class="tgu-hint">Amplitudes ψ<sub>k</sub> for basis |' + '0'.repeat(n) + '⟩…|' + '1'.repeat(n) + '⟩ (they are normalized automatically).</div>' +
            '<div class="tgu-row"><span class="tgu-lbl" style="width:56px">INPUT</span>' + A.map(function (v, i) { return '<input class="tgu-in u-a" data-i="' + i + '" style="width:92px" value="' + esc(v) + '" aria-label="Input amplitude ' + i + '">'; }).join('') + '</div>' +
            '<div class="tgu-row"><span class="tgu-lbl" style="width:56px">TARGET</span>' + B.map(function (v, i) { return '<input class="tgu-in u-b" data-i="' + i + '" style="width:92px" value="' + esc(v) + '" aria-label="Target amplitude ' + i + '">'; }).join('') + '</div>' +
            (one ? '<div class="tgu-row"><span class="tgu-lbl">TARGET θ</span><input id="u-th" type="range" min="0" max="180" value="180"><span class="tgu-lbl">φ</span><input id="u-ph" type="range" min="0" max="360" value="0"></div>' : '<div class="tgu-hint">Bloch spheres are shown for single-qubit states only. Multi-qubit and entangled states are described by their amplitudes.</div>') + '</div></div>';
        } else {
          var P = C.probs || (C.probs = vecDefault(d, 0));
          h = '<div class="tgu-lbl">PROBABILITY DISTRIBUTION</div><div class="tgu-row">' + P.map(function (v, i) { return '<label class="tgu-hint">p(' + i.toString(2).padStart(n, '0') + ')<br><input class="tgu-in u-p" data-i="' + i + '" style="width:80px" value="' + esc(v) + '"></label>'; }).join('') + '</div><div class="tgu-row"><button id="u-uni" class="tgu-btn">Uniform</button><button id="u-ghz" class="tgu-btn">½ |0…0⟩ + ½ |1…1⟩</button></div>';
        }
      }
      W.target.innerHTML = h; bindTarget();
    }
    function drawBlochs() {
      if (C.type !== 'state' || C.n !== 1) return;
      try { var a = unitVec(parseVec(C.stateIn, 1)), b = unitVec(parseVec(C.stateOut, 1)), A = blochOf(a), B = blochOf(b); var e1 = W.target.querySelector('#u-b1'), e2 = W.target.querySelector('#u-b2'); if (e1) e1.innerHTML = bloch(A[0], A[1], 'input'); if (e2) e2.innerHTML = bloch(B[0], B[1], 'target'); } catch (_) {}
    }
    function bindTarget() {
      var q = function (s) { return W.target.querySelector(s); };
      if (q('#u-named')) q('#u-named').onchange = function () { C.named = this.value; if (this.value === 'toffoli' || this.value === 'fredkin') setN(3); else if (/^(cnot|cz|swap|iswap)$/.test(this.value)) setN(2); else if (/^(h|t|sx)$/.test(this.value)) setN(1); };
      if (q('#u-seed')) q('#u-seed').onchange = function () { C.seed = parseInt(this.value, 10) || 1; };
      W.target.querySelectorAll('.u-m').forEach(function (el) { el.oninput = function () { C.matrix[+el.dataset.i][+el.dataset.j] = el.value; unitInfo(); }; });
      W.target.querySelectorAll('.u-a').forEach(function (el) { el.oninput = function () { C.stateIn[+el.dataset.i] = el.value; drawBlochs(); }; });
      W.target.querySelectorAll('.u-b').forEach(function (el) { el.oninput = function () { C.stateOut[+el.dataset.i] = el.value; drawBlochs(); }; });
      W.target.querySelectorAll('.u-p').forEach(function (el) { el.oninput = function () { C.probs[+el.dataset.i] = el.value; }; });
      if (q('#u-id')) q('#u-id').onclick = function () { C.matrix = ident(1 << C.n); paintTarget(); unitInfo(); };
      if (q('#u-fix')) q('#u-fix').onclick = function () { try { var b = buildTarget(C).T, U = SY.polarFix(b), d = U.d; C.matrix = []; for (var i = 0; i < d; i++) { C.matrix.push([]); for (var j = 0; j < d; j++) C.matrix[i].push(cfmt([U.re[i * d + j], U.im[i * d + j]])); } paintTarget(); unitInfo(); } catch (e) { say(W.warn, esc(e.message), 'er'); } };
      if (q('#u-uni')) q('#u-uni').onclick = function () { C.probs = C.probs.map(function () { return '1'; }); paintTarget(); };
      if (q('#u-ghz')) q('#u-ghz').onclick = function () { C.probs = C.probs.map(function (_, i, a) { return i === 0 || i === a.length - 1 ? '1' : '0'; }); paintTarget(); };
      if (q('#u-th')) { var upd = function () { var th = +q('#u-th').value * PI / 180, ph = +q('#u-ph').value * PI / 180; C.stateOut = [cfmt([Math.cos(th / 2), 0]), cfmt([Math.sin(th / 2) * Math.cos(ph), Math.sin(th / 2) * Math.sin(ph)])]; W.target.querySelectorAll('.u-b').forEach(function (el, i) { el.value = C.stateOut[i]; }); drawBlochs(); }; q('#u-th').oninput = upd; q('#u-ph').oninput = upd; }
      drawBlochs(); unitInfo();
    }
    function unitInfo() {
      var el = W.target.querySelector('#u-uerr'); if (!el) return;
      try { var T = buildTarget(C).T, e = SY.unitErr(T); el.textContent = e < 1e-9 ? '✓ unitary' : '✗ not unitary (‖U†U−I‖∞ = ' + e.toExponential(2) + ') — use “Normalize” or fix the entries'; el.style.color = e < 1e-9 ? '#00ff88' : '#ff8ea3'; } catch (err) { el.textContent = '✗ ' + err.message; el.style.color = '#ff8ea3'; }
    }
    function setN(n) { C.n = n; W.n.value = n; C.matrix = null; C.stateIn = null; C.stateOut = null; C.probs = null; paintTarget(); paintSettings(); }
    W.type.onchange = function () { C.type = this.value; C.stateIn = C.stateOut = C.probs = null; C.matrix = null; paintTarget(); say(W.warn, ''); };
    W.n.onchange = function () { setN(Math.max(1, Math.min(6, parseInt(this.value, 10) || 1))); };

    // ----- settings -----
    function paintSettings() {
      var S = C.set, n = C.n, h = '';
      h += '<label class="tgu-hint">Gate set<br><select id="s-gs" class="tgu-in"><option value="u3cx">Universal: U3 + CX (continuous)</option><option value="rzrycx">Rotations: Rz, Ry + CX (continuous)</option><option value="discrete">Discrete set (search)</option></select></label>';
      h += '<label class="tgu-hint">Tolerance (1 − fidelity)<br><input id="s-tol" class="tgu-in" style="width:90px" value="' + S.tol + '"></label>';
      h += '<label class="tgu-hint">Time limit (s)<br><input id="s-ms" type="number" min="1" max="600" class="tgu-in" style="width:70px" value="' + S.maxMs + '"></label>';
      h += '<span id="s-cont"' + (S.gateSet === 'discrete' ? ' style="display:none"' : '') + ' class="tgu-row" style="margin:0"><label class="tgu-hint">Max CX<br><input id="s-cx" type="number" min="0" max="30" class="tgu-in" style="width:64px" placeholder="auto" value="' + (S.maxCx == null ? '' : S.maxCx) + '"></label><label class="tgu-hint">Restarts<br><input id="s-rs" type="number" min="1" max="100" class="tgu-in" style="width:64px" placeholder="auto" value="' + (S.restarts == null ? '' : S.restarts) + '"></label></span>';
      h += '<span id="s-disc"' + (S.gateSet === 'discrete' ? '' : ' style="display:none"') + ' class="tgu-row" style="margin:0"><label class="tgu-hint">Max depth<br><input id="s-dp" type="number" min="1" max="60" class="tgu-in" style="width:64px" value="' + S.maxDepth + '"></label><label class="tgu-hint">Node limit<br><input id="s-nd" type="number" min="1000" max="3000000" class="tgu-in" style="width:96px" value="' + S.maxNodes + '"></label><span class="tgu-hint">Gates:<br>' +
        ['h', 'x', 'y', 'z', 's', 'sdg', 't', 'tdg', 'sx', 'cx', 'cz', 'swap'].map(function (g) { return '<label style="margin-right:.35rem"><input type="checkbox" class="s-g" value="' + g + '"' + (S.discrete.indexOf(g) >= 0 ? ' checked' : '') + '>' + g + '</label>'; }).join('') + '</span></span>';
      W.settings.innerHTML = h; var q = function (s) { return W.settings.querySelector(s); };
      q('#s-gs').value = S.gateSet;
      q('#s-gs').onchange = function () { S.gateSet = this.value; paintSettings(); };
      q('#s-tol').onchange = function () { var v = parseFloat(this.value); S.tol = v > 0 && v < 1 ? v : 1e-6; this.value = S.tol; estimate(); };
      q('#s-ms').onchange = function () { S.maxMs = Math.max(1, Math.min(600, +this.value || 20)); estimate(); };
      q('#s-cx').onchange = function () { S.maxCx = this.value === '' ? null : Math.max(0, Math.min(30, +this.value)); estimate(); };
      q('#s-rs').onchange = function () { S.restarts = this.value === '' ? null : Math.max(1, +this.value); estimate(); };
      q('#s-dp').onchange = function () { S.maxDepth = Math.max(1, +this.value || 24); estimate(); };
      q('#s-nd').onchange = function () { S.maxNodes = Math.max(1000, +this.value || 250000); estimate(); };
      W.settings.querySelectorAll('.s-g').forEach(function (el) { el.onchange = function () { S.discrete = Array.prototype.map.call(W.settings.querySelectorAll('.s-g:checked'), function (x) { return x.value; }); estimate(); }; });
      estimate();
    }
    function estimate() {
      var S = C.set, n = C.n, t;
      if (n > 3) { W.est.textContent = ''; return; }
      if (S.gateSet === 'discrete') { var moves = S.discrete.reduce(function (a, g) { return a + (/^(cx|cz|swap)$/.test(g) ? (n < 2 ? 0 : n * (n - 1) / (g === 'cx' ? 1 : 2)) : n); }, 0); t = 'Search space ≈ ' + moves + '^depth before de-duplication; capped at ' + S.maxNodes.toLocaleString() + ' nodes and ' + S.maxMs + ' s. Exact results are only possible if the target is reachable with this gate set.'; }
      else t = n === 1 ? 'Instant (exact ZYZ decomposition).' : n === 2 ? 'Usually under 3 s (needs at most 3 CX).' : 'Best-effort: generic 3-qubit operators need ~14–20 CX; may take up to the time limit (' + S.maxMs + ' s) and may only reach an approximation.';
      W.est.textContent = '⏱ ' + t;
    }

    // ----- run -----
    function jobOf(tgt) {
      var S = C.set; return { n: C.n, target: { re: Array.from(tgt.T.re), im: Array.from(tgt.T.im) }, gateSet: S.gateSet, discreteGates: S.discrete, tol: S.tol, maxMs: S.maxMs * 1000, maxCx: S.maxCx, restarts: S.restarts, maxDepth: S.maxDepth, maxNodes: S.maxNodes, seed: S.seed, stateCheck: tgt.stateCheck || null };
    }
    function progressUI(p) {
      var pct = Math.round((p.frac || 0) * 100);
      W.prog.innerHTML = '<div style="height:8px;background:#16213a;border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:#00ffdd"></div></div><div class="tgu-hint">' + (p.phase === 'discrete' ? 'Depth ' + p.depth + ' · ' + p.nodes.toLocaleString() + ' nodes · best error ' + (+p.best).toExponential(1) : 'Ansatz with ' + p.cx + ' CX · restart ' + p.restart + '/' + p.restarts + ' · best error ' + (+p.best).toExponential(1)) + '</div>';
    }
    function finish(res, fromCache) {
      running = false; W.go.disabled = false; W.cancel.disabled = true; W.prog.innerHTML = '';
      C.result = res; showResult(res, fromCache);
    }
    function find() {
      if (running) return; var tgt;
      try { tgt = buildTarget(C); } catch (e) { say(W.warn, esc(e.message), 'er'); return; }
      say(W.warn, tgt.w.map(function (x) { return '⚠ ' + esc(x); }).join('<br>'), tgt.w.length ? 'wn' : '');
      var job = jobOf(tgt), key = hash(JSON.stringify([job.n, Array.from(job.target.re, function (x) { return Math.round(x * 1e9); }), Array.from(job.target.im, function (x) { return Math.round(x * 1e9); }), job.gateSet, job.discreteGates, job.tol, job.maxCx, job.restarts, job.maxDepth, job.maxNodes, job.seed]));
      var hit = cacheGet(key); if (hit && hit.status !== 'none') { hit.fromCache = true; if (tgt.stateCheck) hit.metrics.stateFidelity = hit.metrics.stateFidelity; finish(hit, true); return; }
      running = true; W.go.disabled = true; W.cancel.disabled = false; W.result.innerHTML = ''; progressUI({ frac: 0, phase: 'continuous', cx: 0, restart: 0, restarts: 0, best: 1 });
      function done(res) { if (res.status === 'exact' || res.status === 'approximation') cachePut(key, res); finish(res, false); }
      try {
        worker = new Worker('quolab-nexus-u-synthesis.js?v=1');
        worker.onmessage = function (e) { var d = e.data; if (d.type === 'progress') progressUI(d.p); else if (d.type === 'done') { worker.terminate(); worker = null; done(d.result); } else if (d.type === 'error') { worker.terminate(); worker = null; running = false; W.go.disabled = false; W.cancel.disabled = true; say(W.result, 'Synthesis failed: ' + esc(d.message), 'er'); } };
        worker.onerror = function () { if (worker) { worker.terminate(); worker = null; } runInline(job, done); };
        worker.postMessage({ cmd: 'run', job: job });
      } catch (e) { runInline(job, done); }
    }
    function runInline(job, done) { // fallback when Web Workers are unavailable (e.g. file://): bounded time, UI may pause briefly
      say(W.warn, '⚠ Web Workers are unavailable here; running on the main thread with a 10 s cap — the page may pause briefly.', 'wn'); job.maxMs = Math.min(job.maxMs, 10000);
      setTimeout(function () { try { done(SY.run(job, null, function () { return false; })); } catch (e) { running = false; W.go.disabled = false; say(W.result, esc(e.message), 'er'); } }, 30);
    }
    W.go.onclick = find;
    W.cancel.onclick = function () { if (worker) { worker.terminate(); worker = null; } running = false; W.go.disabled = false; W.cancel.disabled = true; W.prog.innerHTML = ''; say(W.result, 'Synthesis cancelled. Nothing was changed.', 'wn'); };

    // ----- result -----
    function opsForTG(res) { return res.ops.map(function (o) { return { g: o.g, q: o.q.slice(), p: (o.p || []).map(function (x) { return String(x); }) }; }); }
    function showResult(res, fromCache) {
      var M = res.metrics, lab = { exact: ['Exact', 'ok'], approximation: ['Approximation within tolerance', 'ok'], best: ['Best approximation found — above the tolerance', 'wn'], none: ['No implementation found', 'er'], unsupported: ['Not supported', 'er'] }[res.status] || [res.status, 'wn'];
      var h = '<div class="tgu-msg ' + lab[1] + '"><b>' + lab[0] + '</b>' + (fromCache ? ' · from local cache' : '') + (res.message ? '<br>' + esc(res.message) : '') + '</div>';
      if (M && res.ops.length) {
        h += '<div class="tgu-hint" style="margin:.3rem 0">Fidelity ' + M.fidelity.toFixed(12) + ' · error (1−F) ' + M.error.toExponential(2) + ' · depth ' + M.depth + ' · ' + M.gates + ' gates (' + M.twoQubit + ' two-qubit) · ' + M.ms + ' ms' + (M.stateFidelity != null ? ' · state fidelity ' + M.stateFidelity.toFixed(10) : '') + '<br>' + esc(M.method || '') + '</div>';
        h += '<div style="overflow:auto">' + UI.circuitSVG({ nq: C.n, ops: opsForTG(res) }, UI.opLabel) + '</div>';
        h += '<table class="tgu-ops" style="margin-top:.4rem"><tr><th>#</th><th>Gate</th><th>Qubits</th><th>Parameters (rad)</th></tr>' + res.ops.map(function (o, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(o.g) + '</td><td>' + esc(o.q.join(', ')) + '</td><td>' + esc((o.p || []).map(function (x) { return +x.toFixed(6); }).join(', ')) + '</td></tr>'; }).join('') + '</table>';
      }
      (res.limits || []).forEach(function (l) { h += '<div class="tgu-msg wn">' + esc(l) + '</div>'; });
      if (C.type === 'state' || C.type === 'probs') h += '<div class="tgu-msg wn">Remember: this operator reproduces the requested state from the chosen input; it is not claimed to equal any particular operator elsewhere.</div>';
      h += '<div class="tgu-row" id="u-ract" style="margin-top:.4rem"></div>';
      W.result.innerHTML = h;
      var act = W.result.querySelector('#u-ract');
      if (res.ops.length) {
        act.appendChild(UI.btn('Save as theoretical gate', 'pri', function () { UI.openEditor({ preset: { name: (C.name || 'U synth ' + C.n + 'q'), nq: C.n, ops: opsForTG(res), params: [] } }); }));
        act.appendChild(UI.btn('Copy Python', '', function () { UI.copy(TG.pyFromOps({ ops: opsForTG(res) }, cat)); }));
        act.appendChild(UI.btn('Compare matrices', '', function () { compareMatrices(res); }));
      }
    }
    function compareMatrices(res) {
      var tgt; try { tgt = buildTarget(C); } catch (e) { return; }
      var flat = res.ops.map(function (o) { return { g: o.g === 'u' ? 'u' : o.g, q: o.q, p: (o.p || []).map(function (x) { return { t: 'num', v: x }; }) }; }), R = TG.unitaryOfFlat(C.n, flat);
      var T = { n: C.n, dim: tgt.T.d, re: tgt.T.re, im: tgt.T.im };
      var mm = UI.modal({ title: 'Target vs synthesized matrix', cls: 'mid' });
      mm.body.innerHTML = '<div class="tgu-hint">The synthesized matrix may differ from the target by a global phase, which has no physical effect.</div><div class="tgu-lbl" style="margin:.4rem 0 .2rem">TARGET</div>' + UI.matrixHTML(T) + '<div class="tgu-lbl" style="margin:.6rem 0 .2rem">SYNTHESIZED</div>' + UI.matrixHTML(R);
      mm.foot.appendChild(UI.btn('Close', '', mm.close));
    }

    // ----- history -----
    function snapshot() { return { name: W.name.value.trim() || ('U ' + C.type + ' ' + C.n + 'q'), target: { type: C.type, n: C.n, named: C.named, seed: C.seed, matrix: C.matrix, stateIn: C.stateIn, stateOut: C.stateOut, probs: C.probs }, settings: JSON.parse(JSON.stringify(C.set)), result: C.result ? { status: C.result.status, ops: C.result.ops, metrics: C.result.metrics, limits: C.result.limits } : null }; }
    function loadCfg(r) {
      var t = r.target; C.type = t.type; C.n = t.n; C.named = t.named; C.seed = t.seed; C.matrix = t.matrix; C.stateIn = t.stateIn; C.stateOut = t.stateOut; C.probs = t.probs; C.set = Object.assign(dflt().set, r.settings); C.result = r.result; C.id = r.id; C.name = r.name; W.name.value = r.name; W.type.value = C.type; W.n.value = C.n;
      paintTarget(); paintSettings(); say(W.warn, ''); if (r.result) showResult(r.result, false); else W.result.innerHTML = '';
    }
    function paintHist() {
      var list = cat.mem.uConfigs; W.hist.innerHTML = list.length ? '' : '<div class="tgu-hint">No saved configurations yet.</div>';
      list.forEach(function (r) {
        var row = doc.createElement('div'), st = r.result ? r.result.status : 'no result'; row.className = 'tgu-item';
        row.innerHTML = '<div class="meta"><b>' + esc(r.name) + '</b><small>' + esc(r.target.type) + ' · ' + r.target.n + ' qubit(s) · ' + esc(r.settings.gateSet) + ' · tol ' + r.settings.tol + ' · ' + esc(st) + (r.result && r.result.metrics ? ' · ' + r.result.metrics.gates + ' gates · err ' + (+r.result.metrics.error).toExponential(1) : '') + ' · ' + esc(new Date(r.modified).toLocaleString()) + '</small></div><div class="act"></div>';
        var a = row.querySelector('.act');
        a.appendChild(UI.btn('Load', '', function () { loadCfg(r); }));
        a.appendChild(UI.btn('Duplicate', '', function () { var s = Object.assign({}, r); delete s.id; s.name = r.name + ' copy'; cat.saveUConfig(s); paintHist(); }));
        a.appendChild(UI.btn('Delete', 'dng', function () { if (root.confirm('Delete configuration “' + r.name + '”?')) { cat.deleteUConfig(r.id); paintHist(); } }));
        W.hist.appendChild(row);
      });
    }
    W.save.onclick = function () {
      var s = snapshot(), existing = C.id && cat.mem.uConfigs.some(function (x) { return x.id === C.id; });
      if (existing) { var q = UI.modal({ title: 'Save configuration', cls: 'sm' }); q.body.innerHTML = '<p style="font-size:.78rem">This configuration was loaded from your history. Do you want to replace it or keep both?</p>';
        q.foot.appendChild(UI.btn('Save as new', 'pri', function () { q.close(); var r = cat.saveUConfig(s); C.id = r.id; paintHist(); }));
        q.foot.appendChild(UI.btn('Replace the old one', '', function () { q.close(); s.id = C.id; cat.saveUConfig(s, 'update'); paintHist(); }));
        q.foot.appendChild(UI.btn('Cancel', '', q.close)); return; }
      var r = cat.saveUConfig(s); C.id = r.id; paintHist(); UI.copy && 0;
    };
    last = C;
    W.type.value = C.type; W.n.value = C.n; paintTarget(); paintSettings(); paintHist();
    m.foot.appendChild(UI.btn('Close', '', m.close));
    return m;
  }

  function open(mode) {
    if (mode === 'matrix') {
      var rec = cat.mem.uConfigs[0];
      if (!rec) { UI.showMatrixModal && 0; var mm = UI.modal({ title: 'U gate', cls: 'sm' }); mm.body.innerHTML = '<div class="tgu-msg">No configuration yet. Left-click the U gate to define a target; its matrix is shown here afterwards.</div>'; mm.foot.appendChild(UI.btn('Open configuration', 'pri', function () { mm.close(); openWindow(); })); mm.foot.appendChild(UI.btn('Close', '', mm.close)); return; }
      try { var C0 = Object.assign(dflt(), { type: rec.target.type, n: rec.target.n, named: rec.target.named, seed: rec.target.seed, matrix: rec.target.matrix, stateIn: rec.target.stateIn, stateOut: rec.target.stateOut, probs: rec.target.probs }); var T = buildTarget(C0).T; UI.showMatrixModal('U gate · target matrix of “' + rec.name + '”', function () { return { n: T.n, dim: T.d, re: T.re, im: T.im }; }, 'Most recent saved configuration.'); } catch (e) { var m2 = UI.modal({ title: 'U gate', cls: 'sm' }); m2.body.innerHTML = '<div class="tgu-msg er">' + esc(e.message) + '</div>'; m2.foot.appendChild(UI.btn('Close', '', m2.close)); }
      return;
    }
    openWindow();
  }
  root.QuOLabUGate = { open: open, complex: cparse, buildTarget: buildTarget };
})(typeof window !== 'undefined' ? window : globalThis);
