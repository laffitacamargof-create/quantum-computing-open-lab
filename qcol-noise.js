/* QCOL Noise v2 — ruido cuántico como OPCIÓN de cualquier herramienta (Architect/Open Lab, Notebook, ...).
   Misma interfaz para cualquier simulador: la lista de motores y sus capacidades las da el servidor (/qcol/health, /qcol/capabilities),
   así un simulador nuevo aparece solo en el desplegable sin tocar las herramientas.
   API:  QcolNoise.open({getCode})   -> ventana de AJUSTE de ruido (preconfiguraciones + parámetros) y ejecución
         QcolNoise.quick({getCode})  -> EJECUTA YA con el ajuste guardado (sin pasar por la configuración; botón ⚙ para ajustar)
   El servidor es el predeterminado de QCOL: el usuario no necesita abrir Hugging Face ni escribir ninguna URL. */
(function () {
  'use strict';
  if (window.QcolNoise) return;
  const DEFAULT_URL = 'https://francilaffita1027-qcol-noise-lab.hf.space';   // servidor de QCOL (único). Para pruebas: window.QCOL_NOISE_URL = '...'
  const LS = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const lang = () => { const l = String(LS.get('openq_lang') || document.documentElement.lang || navigator.language || 'en').toLowerCase(); return l.indexOf('es') === 0 ? 'es' : 'en'; };

  // ───────── Código Qiskit -> OpenQASM 3 (circuitos rectos y bucles for simples) ─────────
  const G = { // nombre: [parámetros, qubits]
    h: [0, 1], x: [0, 1], y: [0, 1], z: [0, 1], s: [0, 1], sdg: [0, 1], t: [0, 1], tdg: [0, 1], sx: [0, 1], id: [0, 1],
    rx: [1, 1], ry: [1, 1], rz: [1, 1], p: [1, 1], u: [3, 1],
    cx: [0, 2], cy: [0, 2], cz: [0, 2], ch: [0, 2], swap: [0, 2], cp: [1, 2], crx: [1, 2], cry: [1, 2], crz: [1, 2],
    ccx: [0, 3], cswap: [0, 3] };
  const IGNORE = new Set(['measure', 'measure_all', 'barrier', 'draw', 'reset']);
  function evalExpr(src, vars) {
    let e = String(src).trim().replace(/np\.pi|numpy\.pi|math\.pi|\bpi\b/g, '(' + Math.PI + ')');
    Object.keys(vars).forEach(k => { e = e.replace(new RegExp('\\b' + k + '\\b', 'g'), '(' + vars[k] + ')'); });
    e = e.replace(/\*\*/g, '^^');
    if (!/^[0-9.+\-*/%()\s^]*$/.test(e)) throw new Error('Unsupported expression: ' + src);
    e = e.replace(/\^\^/g, '**');
    const v = Function('"use strict";return (' + e + ')')();
    if (typeof v !== 'number' || !isFinite(v)) throw new Error('Bad value: ' + src);
    return v;
  }
  function splitArgs(s) { const a = []; let d = 0, c = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { a.push(c); c = ''; } else c += ch; } if (c.trim()) a.push(c); return a; }
  function codeToQasm(code) {
    const lines = String(code || '').replace(/\r/g, '').split('\n').map(l => l.replace(/#.*$/, '').replace(/\s+$/, '')).filter(l => l.trim());
    const decl = String(code).match(/(\w+)\s*=\s*QuantumCircuit\(\s*(\d+)/);
    if (!decl) throw new Error('No "qc = QuantumCircuit(n, ...)" found in the code.');
    const name = decl[1], n = parseInt(decl[2], 10), out = []; let vars = {};
    const callRe = new RegExp('^\\s*' + name + '\\.(\\w+)\\((.*)\\)\\s*$');
    function emit(line, v) {
      const m = line.match(callRe); if (!m) return false;
      const g = m[1]; if (IGNORE.has(g)) return true;
      if (!G[g]) throw new Error('Gate "' + g + '" is not supported for noise simulation.');
      const a = splitArgs(m[2]); const [np_, nq] = G[g];
      if (a.length !== np_ + nq) throw new Error('Wrong number of arguments in: ' + line.trim());
      const par = a.slice(0, np_).map(x => evalExpr(x, v)); const qs = a.slice(np_).map(x => { const q = evalExpr(x, v); if (!Number.isInteger(q) || q < 0 || q >= n) throw new Error('Qubit out of range in: ' + line.trim()); return q; });
      out.push((g === 'u' ? 'U' : g) + (par.length ? '(' + par.map(p => p.toPrecision(10)).join(',') + ')' : '') + ' ' + qs.map(q => 'q[' + q + ']').join(', ') + ';'); return true;
    }
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i], f = L.match(/^(\s*)for\s+(\w+)\s+in\s+range\(([^)]*)\)\s*:\s*(.*)$/);
      if (f) {
        const ra = splitArgs(f[3]).map(x => evalExpr(x, vars)); const lo = ra.length > 1 ? ra[0] : 0, hi = ra.length > 1 ? ra[1] : ra[0], st = ra[2] || 1;
        const ind = f[1].length; const body = []; if (f[4].trim()) body.push(f[4]);
        while (i + 1 < lines.length && (lines[i + 1].match(/^\s*/)[0].length > ind)) body.push(lines[++i]);
        if (hi - lo > 500) throw new Error('Loop too long.');
        for (let k = lo; k < hi; k += st) body.forEach(b => { if (!emit(b, Object.assign({}, vars, { [f[2]]: k }))) throw new Error('Unsupported statement inside loop: ' + b.trim()); });
        continue;
      }
      if (emit(L, vars)) continue;
      const asg = L.match(/^\s*(\w+)\s*=\s*([0-9.+\-*/() ]|np\.pi)+$/); if (asg) { vars[asg[1]] = evalExpr(L.split('=')[1], vars); continue; }
      // cualquier otra línea (imports, prints, simulador...) se ignora
    }
    if (!out.length) throw new Error('The circuit has no supported gates yet.');
    if (n > 8) throw new Error('Noise simulation supports up to 8 qubits.');
    return 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[' + n + '] q;\n' + out.join('\n') + '\n';
  }

  // ───────── Motor DEL NAVEGADOR: matriz de densidad exacta (hasta 8 qubits), sin servidor, en segundos ─────────
  // Canales de Kraus exactos (despolarizante, amortiguamiento, T1/T2, Pauli, Kraus, lectura). Mismo esquema de ruido que el servidor.
  const BR = { id: 'qcol-browser', maxQ: 8 };
  const C = (re, im) => [re, im || 0], cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const ex = th => [Math.cos(th), Math.sin(th)], S2 = Math.SQRT1_2;
  function gate1(name, p) {
    const c = Math.cos, s = Math.sin;
    switch (name) {
      case 'h': return [[C(S2), C(S2)], [C(S2), C(-S2)]];
      case 'x': return [[C(0), C(1)], [C(1), C(0)]];
      case 'y': return [[C(0), C(0, -1)], [C(0, 1), C(0)]];
      case 'z': return [[C(1), C(0)], [C(0), C(-1)]];
      case 's': return [[C(1), C(0)], [C(0), C(0, 1)]];
      case 'sdg': return [[C(1), C(0)], [C(0), C(0, -1)]];
      case 't': return [[C(1), C(0)], [C(0), ex(Math.PI / 4)]];
      case 'tdg': return [[C(1), C(0)], [C(0), ex(-Math.PI / 4)]];
      case 'sx': return [[C(.5, .5), C(.5, -.5)], [C(.5, -.5), C(.5, .5)]];
      case 'id': return [[C(1), C(0)], [C(0), C(1)]];
      case 'rx': return [[C(c(p[0] / 2)), C(0, -s(p[0] / 2))], [C(0, -s(p[0] / 2)), C(c(p[0] / 2))]];
      case 'ry': return [[C(c(p[0] / 2)), C(-s(p[0] / 2))], [C(s(p[0] / 2)), C(c(p[0] / 2))]];
      case 'rz': return [[ex(-p[0] / 2), C(0)], [C(0), ex(p[0] / 2)]];
      case 'p': return [[C(1), C(0)], [C(0), ex(p[0])]];
      case 'u': { const th = p[0], ph = p[1], la = p[2], a = ex(la), b = ex(ph), d = ex(ph + la);
        return [[C(c(th / 2)), [-a[0] * s(th / 2), -a[1] * s(th / 2)]], [[b[0] * s(th / 2), b[1] * s(th / 2)], [d[0] * c(th / 2), d[1] * c(th / 2)]]]; }
    }
    return null;
  }
  // nombre -> [matriz 1q base, nº de controles]
  const CTRL = { cx: ['x', 1], cy: ['y', 1], cz: ['z', 1], ch: ['h', 1], cp: ['p', 1], crx: ['rx', 1], cry: ['ry', 1], crz: ['rz', 1], ccx: ['x', 2] };
  function parseQasmOps(qasm) {
    const ops = []; let n = 0;
    String(qasm).split('\n').forEach(raw => {
      const l = raw.trim(); if (!l || l.startsWith('//') || l.startsWith('OPENQASM') || l.startsWith('include') || l.startsWith('bit')) return;
      const dq = l.match(/^qubit\[(\d+)\]\s+\w+;/); if (dq) { n = parseInt(dq[1], 10); return; }
      if (/^\w+\s*=\s*measure/.test(l) || l.startsWith('measure') || l.startsWith('barrier')) return;
      const m = l.match(/^(\w+)\s*(?:\(([^)]*)\))?\s+(.*);$/); if (!m) throw new Error('Unsupported QASM line: ' + l);
      const qs = m[3].split(',').map(x => { const mm = x.trim().match(/^\w+\[(\d+)\]$/); if (!mm) throw new Error('Bad qubit: ' + x); return parseInt(mm[1], 10); });
      ops.push({ name: m[1].toLowerCase(), p: m[2] ? m[2].split(',').map(Number) : [], q: qs });
    });
    return { n, ops };
  }
  // ρ en re/im (D×D). Aplica M (2×2) sobre el qubit q, solo en estados con los bits de `ctrl` a 1.
  function mulSide(re, im, D, q, M, ctrl, side) {
    const bit = 1 << q;
    if (side === 'L') {
      for (let i = 0; i < D; i++) { if (i & bit) continue; if ((i & ctrl) !== ctrl) continue; const i1 = i | bit;
        for (let j = 0; j < D; j++) { const a = i * D + j, b = i1 * D + j, ar = re[a], ai = im[a], br = re[b], bi = im[b];
          re[a] = M[0][0][0] * ar - M[0][0][1] * ai + M[0][1][0] * br - M[0][1][1] * bi; im[a] = M[0][0][0] * ai + M[0][0][1] * ar + M[0][1][0] * bi + M[0][1][1] * br;
          re[b] = M[1][0][0] * ar - M[1][0][1] * ai + M[1][1][0] * br - M[1][1][1] * bi; im[b] = M[1][0][0] * ai + M[1][0][1] * ar + M[1][1][0] * bi + M[1][1][1] * br; } }
    } else {   // ρ ← ρ M†
      for (let j = 0; j < D; j++) { if (j & bit) continue; if ((j & ctrl) !== ctrl) continue; const j1 = j | bit;
        for (let i = 0; i < D; i++) { const a = i * D + j, b = i * D + j1, ar = re[a], ai = im[a], br = re[b], bi = im[b];
          // M† [k][l] = conj(M[l][k])
          re[a] = ar * M[0][0][0] + ai * M[0][0][1] + br * M[0][1][0] + bi * M[0][1][1]; im[a] = ai * M[0][0][0] - ar * M[0][0][1] + bi * M[0][1][0] - br * M[0][1][1];
          re[b] = ar * M[1][0][0] + ai * M[1][0][1] + br * M[1][1][0] + bi * M[1][1][1]; im[b] = ai * M[1][0][0] - ar * M[1][0][1] + bi * M[1][1][0] - br * M[1][1][1]; } }
    }
  }
  function permute(st, a, b, ctrl) {
    const D = st.D, perm = new Int32Array(D);
    for (let i = 0; i < D; i++) { if ((i & ctrl) === ctrl && (((i >> a) & 1) !== ((i >> b) & 1))) perm[i] = i ^ (1 << a) ^ (1 << b); else perm[i] = i; }
    const nr = new Float64Array(D * D), ni = new Float64Array(D * D);
    for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) { const d = perm[i] * D + perm[j]; nr[d] = st.re[i * D + j]; ni[d] = st.im[i * D + j]; }
    st.re = nr; st.im = ni;
  }
  function applyUnitary(st, op) {
    const { name, p, q } = op, D = st.D;
    if (name === 'swap') { permute(st, q[0], q[1], 0); return; }
    if (name === 'cswap') { permute(st, q[1], q[2], 1 << q[0]); return; }
    let base = name, ctrl = 0, tq = q[0];
    if (CTRL[name]) { const [b, nc] = CTRL[name]; base = b; for (let k = 0; k < nc; k++) ctrl |= 1 << q[k]; tq = q[nc]; }
    const M = gate1(base, p); if (!M) throw new Error('Gate "' + name + '" is not supported by the browser simulator.');
    mulSide(st.re, st.im, D, tq, M, ctrl, 'L'); mulSide(st.re, st.im, D, tq, M, ctrl, 'R');
  }
  function applyKraus(st, q, Ks) {
    const D = st.D, N = D * D, ar = new Float64Array(N), ai = new Float64Array(N);
    for (const K of Ks) { const tr = Float64Array.from(st.re), ti = Float64Array.from(st.im);
      mulSide(tr, ti, D, q, K, 0, 'L'); mulSide(tr, ti, D, q, K, 0, 'R'); for (let k = 0; k < N; k++) { ar[k] += tr[k]; ai[k] += ti[k]; } }
    st.re = ar; st.im = ai;
  }
  const RM = (a, b, c, d) => [[C(a), C(b)], [C(c), C(d)]], sc = (k, M) => M.map(r => r.map(e => [e[0] * k, e[1] * k]));
  const mm = (A, B) => [0, 1].map(i => [0, 1].map(j => { const x = cmul(A[i][0], B[0][j]), y = cmul(A[i][1], B[1][j]); return [x[0] + y[0], x[1] + y[1]]; }));
  const PX = RM(0, 1, 1, 0), PY = [[C(0), C(0, -1)], [C(0, 1), C(0)]], PZ = RM(1, 0, 0, -1), PI = RM(1, 0, 0, 1);
  const adK = g => [RM(1, 0, 0, Math.sqrt(1 - g)), RM(0, Math.sqrt(g), 0, 0)], pdK = l => [RM(1, 0, 0, Math.sqrt(1 - l)), RM(0, 0, 0, Math.sqrt(l))];
  function krausOf(ch) {
    const t_ = ch.type;
    if (t_ === 'depolarizing') return [sc(Math.sqrt(1 - ch.p), PI), sc(Math.sqrt(ch.p / 3), PX), sc(Math.sqrt(ch.p / 3), PY), sc(Math.sqrt(ch.p / 3), PZ)];
    if (t_ === 'amplitude_damping') return adK(ch.gamma);
    if (t_ === 'lowering') return adK(1 - Math.exp(-ch.rate));
    if (t_ === 'phase_damping') return pdK(ch.lambda);
    if (t_ === 'thermal_relaxation') {
      if (ch.T2 > 2 * ch.T1 + 1e-12) throw new Error('T2 must be ≤ 2·T1');
      const g = 1 - Math.exp(-ch.gate_time / ch.T1), l = Math.max(0, 1 - Math.exp(-ch.gate_time * (2 / ch.T2 - 1 / ch.T1)));
      const out = []; adK(g).forEach(a => pdK(l).forEach(p => out.push(mm(p, a)))); return out;
    }
    if (t_ === 'pauli') return [sc(Math.sqrt(Math.max(0, 1 - ch.pX - ch.pY - ch.pZ)), PI), sc(Math.sqrt(ch.pX), PX), sc(Math.sqrt(ch.pY), PY), sc(Math.sqrt(ch.pZ), PZ)];
    if (t_ === 'bit_flip') return [sc(Math.sqrt(1 - ch.p), PI), sc(Math.sqrt(ch.p), PX)];
    if (t_ === 'phase_flip') return [sc(Math.sqrt(1 - ch.p), PI), sc(Math.sqrt(ch.p), PZ)];
    if (t_ === 'kraus') return ch.matrices.map(m => m.map(row => row.map(e => [e[0], e[1]])));
    return null;
  }
  function mulberry(seed) { let a = (seed == null ? (Math.random() * 2 ** 32) : seed) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // Distribución exacta tras el ruido (sin muestreo)
  function exactProbs(qasm, noise) {
    const { n, ops } = parseQasmOps(qasm); if (!n || n > BR.maxQ) throw new Error('The browser simulator supports 1–' + BR.maxQ + ' qubits.');
    const D = 1 << n, st = { D, re: new Float64Array(D * D), im: new Float64Array(D * D) }; st.re[0] = 1;
    const chans = (noise && noise.channels) || [], after1q = !(noise && noise.options && noise.options.noise_after_1q_gates === false), avisos = [];
    const gateCh = [], ro = [];
    chans.forEach((ch, idx) => { if (ch.type === 'readout') { ro.push(ch); return; } if (ch.type === 'crosstalk') { avisos.push('[' + idx + '] crosstalk is not supported by the browser simulator and was skipped.'); return; }
      const K = krausOf(ch); if (!K) throw new Error('Unknown channel ' + ch.type); gateCh.push({ ch, K }); });
    for (const op of ops) {
      applyUnitary(st, op);
      if (op.q.length === 1 && !after1q) continue;
      for (const { ch, K } of gateCh) {
        const sc_ = ch.scope || { kind: 'global' };
        if (sc_.kind === 'gate' && sc_.gates.indexOf(op.name) < 0) continue;
        for (const q of op.q) { if ((sc_.kind === 'qubit' || sc_.kind === 'pair') && (sc_.qubits || []).indexOf(q) < 0) continue; applyKraus(st, q, K); }
      }
    }
    let p = new Float64Array(D); for (let i = 0; i < D; i++) p[i] = Math.max(0, st.re[i * D + i]);
    ro.forEach(ch => { const sc_ = ch.scope || { kind: 'global' }, qs = sc_.kind === 'global' || sc_.kind === 'gate' ? [...Array(n).keys()] : (sc_.qubits || []);
      qs.forEach(q => { const bit = 1 << q, a = ch.p1_given_0, b = ch.p0_given_1;
        for (let i = 0; i < D; i++) { if (i & bit) continue; const p0 = p[i], p1 = p[i | bit]; p[i] = (1 - a) * p0 + b * p1; p[i | bit] = a * p0 + (1 - b) * p1; } }); });
    let s = 0; for (let i = 0; i < D; i++) s += p[i]; for (let i = 0; i < D; i++) p[i] /= s || 1;
    return { n, p, avisos };
  }
  async function simulateBrowser(qasm, noise, shots, seed) {
    await new Promise(r => setTimeout(r, 15));   // deja pintar el aviso "ejecutando"
    const t0 = Date.now();
    try {
      const { n, p, avisos } = exactProbs(qasm, noise), rnd = mulberry(seed), cdf = new Float64Array(p.length); let acc = 0; for (let i = 0; i < p.length; i++) { acc += p[i]; cdf[i] = acc; }
      const counts = {}; for (let k = 0; k < shots; k++) { const u = rnd() * acc; let lo = 0, hi = p.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; } const key = lo.toString(2).padStart(n, '0'); counts[key] = (counts[key] || 0) + 1; }
      return { ok: true, counts: Object.fromEntries(Object.entries(counts).sort()), avisos, warnings: [], applied: [], degraded: [], meta: { engine: BR.id, n_qubits: n, shots, seed, elapsed_s: +((Date.now() - t0) / 1000).toFixed(2) } };
    } catch (e) { return { ok: false, error: 'fallo_motor', detalle: e.message }; }
  }

  // ───────── Textos (ES/EN) ─────────
  const TX = {
    en: { title: '🔊 Quantum noise', sub: 'Simulates your circuit with realistic noise. The reference engine is MQT YAQS and results can be cross-checked with other simulators.',
      srv: 'QCOL noise server', srvOk: 'Connected', srvWake: 'Reference server (optional): waking up… {s}s', srvDown: 'The noise server is not answering right now. Try again in a minute.',
      sim: 'Simulator', all: 'Compare all simulators', preset: 'Preset', presetNote: 'Typical orders of magnitude for each technology — not the live calibration of a specific device. Edit any value below.',
      params: 'Adjustable parameters', p1: '1-qubit gate error', p2: '2-qubit gate error', t1: 'T1 (µs)', t2: 'T2 (µs)', tg1: '1q gate time (µs)', tg2: '2q gate time (µs)',
      r01: 'Readout P(0 | 1)', r10: 'Readout P(1 | 0)', amp: 'Extra amplitude damping γ', ph: 'Extra phase damping λ', shots: 'Shots', seed: 'Seed (empty = random)',
      ideal: 'Also show the ideal (noise-free) result', adv: 'Advanced: noise JSON and OpenQASM', manual: 'Edit the JSON by hand (overrides the fields above)', run: '⚡ Run with noise', adjust: '⚙ Adjust noise',
      reset: 'Reset preset', running: 'Running… YAQS can take from seconds to a couple of minutes on the free server.', badjson: 'Fix the noise JSON first.', t2cap: 'T2 was limited to 2·T1 (physical limit).',
      ideal_l: 'Ideal', fid: 'Similarity to ideal (1 − TVD)', tvd: 'Total variation distance', typical: '≈0.03–0.07 is typical sampling noise', caps: 'max {q} qubits · {c} noise channels',
      refEngine: 'reference · server', validator: 'validator · server', instant: 'instant · in your browser', srvOff: 'Reference server offline — the instant simulator keeps working.', netfail: 'Could not reach the noise server.', close: 'Close' },
    es: { title: '🔊 Ruido cuántico', sub: 'Simula tu circuito con ruido realista. El motor de referencia es MQT YAQS y puedes contrastar el resultado con otros simuladores.',
      srv: 'Servidor de ruido de QCOL', srvOk: 'Conectado', srvWake: 'Servidor de referencia (opcional): despertando… {s}s', srvDown: 'El servidor de ruido no responde ahora mismo. Inténtalo de nuevo en un minuto.',
      sim: 'Simulador', all: 'Comparar todos los simuladores', preset: 'Preconfiguración', presetNote: 'Órdenes de magnitud típicos de cada tecnología — no es la calibración en vivo de un dispositivo concreto. Puedes editar cualquier valor.',
      params: 'Parámetros ajustables', p1: 'Error de puerta de 1 qubit', p2: 'Error de puerta de 2 qubits', t1: 'T1 (µs)', t2: 'T2 (µs)', tg1: 'Tiempo puerta 1q (µs)', tg2: 'Tiempo puerta 2q (µs)',
      r01: 'Lectura P(0 | 1)', r10: 'Lectura P(1 | 0)', amp: 'Amortiguamiento de amplitud extra γ', ph: 'Amortiguamiento de fase extra λ', shots: 'Disparos (shots)', seed: 'Semilla (vacío = aleatoria)',
      ideal: 'Mostrar también el resultado ideal (sin ruido)', adv: 'Avanzado: JSON de ruido y OpenQASM', manual: 'Editar el JSON a mano (anula los campos de arriba)', run: '⚡ Ejecutar con ruido', adjust: '⚙ Ajustar ruido',
      reset: 'Restablecer preconfiguración', running: 'Ejecutando… YAQS puede tardar de segundos a un par de minutos en el servidor gratuito.', badjson: 'Corrige primero el JSON de ruido.', t2cap: 'T2 se limitó a 2·T1 (límite físico).',
      ideal_l: 'Ideal', fid: 'Parecido al ideal (1 − TVD)', tvd: 'Distancia de variación total', typical: '≈0.03–0.07 es ruido de muestreo típico', caps: 'máx. {q} qubits · {c} canales de ruido',
      refEngine: 'referencia · servidor', validator: 'validador · servidor', instant: 'instantáneo · en tu navegador', srvOff: 'Servidor de referencia sin conexión — el simulador instantáneo sigue funcionando.', netfail: 'No se pudo contactar con el servidor de ruido.', close: 'Cerrar' } };
  const t = (k, v) => { let s = (TX[lang()][k] != null ? TX[lang()][k] : TX.en[k]) || k; if (v) Object.keys(v).forEach(x => { s = s.replace('{' + x + '}', v[x]); }); return s; };

  // ───────── Servidor (único, predeterminado) ─────────
  const baseUrl = () => String(window.QCOL_NOISE_URL || DEFAULT_URL).trim().replace(/\/+$/, '');
  function tfetch(url, opts, ms) { const c = new AbortController(), id = setTimeout(() => c.abort(), ms); return fetch(url, Object.assign({ mode: 'cors', signal: c.signal }, opts || {})).finally(() => clearTimeout(id)); }
  let _health = null, _healthAt = 0, _caps = null;
  async function wake(onStatus, maxMs) {
    if (_health && Date.now() - _healthAt < 300000) return _health;
    const t0 = Date.now(); let n = 0; maxMs = maxMs || 110000;
    for (;;) {
      try { const r = await tfetch(baseUrl() + '/qcol/health', {}, 9000); const j = await r.json(); if (j && j.ok) { _health = j; _healthAt = Date.now(); return j; } } catch (e) {}
      n++; if (Date.now() - t0 > maxMs) throw new Error(t('srvDown'));
      if (onStatus) onStatus(Math.round((Date.now() - t0) / 1000));
      await new Promise(r => setTimeout(r, Math.min(5000, 1500 + n * 500)));
    }
  }
  async function api(path, opts) {
    let r;
    try { r = await tfetch(baseUrl() + path, opts, 150000); }
    catch (e) { _health = null; await wake(null, 60000); r = await tfetch(baseUrl() + path, opts, 150000); }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!j) throw new Error(t('netfail') + ' (' + r.status + ')');
    return j;
  }
  // text/plain => petición "simple" (sin preflight CORS); el servidor lee el cuerpo como JSON igualmente
  const run = o => api('/qcol/activar_ruido', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ motor: o.engine, circuito_qasm: o.qasm, noise: o.noise, shots: o.shots, seed: o.seed }) });
  async function caps() { if (_caps) return _caps; try { const r = await tfetch(baseUrl() + '/qcol/capabilities', {}, 20000); _caps = await r.json(); } catch (e) { _caps = {}; } return _caps; }
  const tvd = (a, b) => { const na = Object.values(a).reduce((x, y) => x + y, 0), nb = Object.values(b).reduce((x, y) => x + y, 0); let s = 0; new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => { s += Math.abs((a[k] || 0) / na - (b[k] || 0) / nb); }); return s / 2; };
  const ENG_NAME = { 'qcol-browser': 'QCOL', 'mqt-yaqs': 'MQT YAQS', 'qiskit-aer': 'Qiskit Aer' }, ENG_ROLE = { 'qcol-browser': 'instant', 'mqt-yaqs': 'refEngine', 'qiskit-aer': 'validator' };
  const BROWSER = 'qcol-browser';
  const runAny = o => o.engine === BROWSER ? simulateBrowser(o.qasm, o.noise, o.shots, o.seed) : run(o);
  const engName = e => ENG_NAME[e] || e;

  // ───────── Preconfiguraciones (órdenes de magnitud típicos; NO calibración en vivo) ─────────
  const Z = { p1: 0, p2: 0, t1: 0, t2: 0, tg1: 0, tg2: 0, r01: 0, r10: 0, amp: 0, ph: 0 };
  const PRESETS = [
    { id: 'ideal', n: { en: 'Ideal (no noise)', es: 'Ideal (sin ruido)' }, v: {} },
    { id: 'sc-modern', n: { en: 'Superconducting — modern (Heron-class)', es: 'Superconductor — moderno (clase Heron)' }, v: { p1: 3e-4, p2: 3e-3, t1: 250, t2: 150, tg1: 0.05, tg2: 0.1, r01: 0.02, r10: 0.01 } },
    { id: 'sc-legacy', n: { en: 'Superconducting — earlier NISQ', es: 'Superconductor — NISQ anterior' }, v: { p1: 6e-4, p2: 1e-2, t1: 100, t2: 80, tg1: 0.035, tg2: 0.4, r01: 0.04, r10: 0.02 } },
    { id: 'ion-high', n: { en: 'Trapped ions — high fidelity (Quantinuum-class)', es: 'Iones atrapados — alta fidelidad (clase Quantinuum)' }, v: { p1: 3e-5, p2: 2e-3, r01: 0.003, r10: 0.003 } },
    { id: 'ion-mid', n: { en: 'Trapped ions — commercial (IonQ-class)', es: 'Iones atrapados — comercial (clase IonQ)' }, v: { p1: 5e-4, p2: 5e-3, r01: 0.004, r10: 0.004 } },
    { id: 'atoms', n: { en: 'Neutral atoms (Rydberg)', es: 'Átomos neutros (Rydberg)' }, v: { p1: 1e-3, p2: 6e-3, r01: 0.03, r10: 0.01 } },
    { id: 'mild', n: { en: 'Teaching — mild noise', es: 'Docencia — ruido suave' }, v: { p1: 1e-3, p2: 1e-2, r01: 0.02, r10: 0.02 } },
    { id: 'strong', n: { en: 'Teaching — strong noise', es: 'Docencia — ruido fuerte' }, v: { p1: 5e-3, p2: 5e-2, t1: 50, t2: 40, tg1: 0.05, tg2: 0.3, r01: 0.05, r10: 0.05 } },
  ];
  const presetVals = id => Object.assign({}, Z, (PRESETS.find(p => p.id === id) || PRESETS[2]).v);
  const G1 = ['h', 'x', 'y', 'z', 's', 'sdg', 't', 'tdg', 'sx', 'id', 'rx', 'ry', 'rz', 'p', 'u'], G2 = ['cx', 'cy', 'cz', 'ch', 'swap', 'cp', 'crx', 'cry', 'crz', 'ccx', 'cswap'];
  function buildNoise(c) {
    const ch = [], notes = [];
    if (c.p1 > 0) ch.push({ type: 'depolarizing', p: c.p1, scope: { kind: 'gate', gates: G1 } });
    if (c.p2 > 0) ch.push({ type: 'depolarizing', p: c.p2, scope: { kind: 'gate', gates: G2 } });
    if (c.t1 > 0 && c.t2 > 0) {
      let T2 = c.t2; if (T2 > 2 * c.t1) { T2 = 2 * c.t1; notes.push(t('t2cap')); }
      if (c.tg1 > 0) ch.push({ type: 'thermal_relaxation', T1: c.t1, T2, gate_time: c.tg1, scope: { kind: 'gate', gates: G1 } });
      if (c.tg2 > 0) ch.push({ type: 'thermal_relaxation', T1: c.t1, T2, gate_time: c.tg2, scope: { kind: 'gate', gates: G2 } });
    }
    if (c.amp > 0) ch.push({ type: 'amplitude_damping', gamma: c.amp });
    if (c.ph > 0) ch.push({ type: 'phase_damping', lambda: c.ph });
    if (c.r01 > 0 || c.r10 > 0) ch.push({ type: 'readout', p0_given_1: c.r01, p1_given_0: c.r10 });
    return { noise: { schema_version: '1.0', channels: ch, options: { noise_after_1q_gates: true } }, notes };
  }
  const FIELDS = ['p1', 'p2', 't1', 't2', 'tg1', 'tg2', 'r01', 'r10', 'amp', 'ph'];
  const loadCfg = () => { try { return JSON.parse(LS.get('qcol_noise_cfg') || 'null') || {}; } catch (e) { return {}; } };
  const saveCfg = c => LS.set('qcol_noise_cfg', JSON.stringify(c));

  // ───────── Ventana ─────────
  const CSS = `.qn-ov{position:fixed;inset:0;z-index:99999;background:rgba(2,6,14,.82);display:flex;align-items:center;justify-content:center;padding:14px;font:14px/1.45 system-ui,sans-serif}
.qn-box{background:#0a1424;color:#d8ecff;border:1px solid rgba(0,200,255,.35);border-radius:14px;width:min(780px,100%);max-height:94vh;overflow:auto;padding:14px 16px}
.qn-box h2{margin:0 0 2px;font-size:1.05rem;color:#00ccff}.qn-sub{color:#6f8fb0;font-size:.76rem;margin:0 0 6px}
.qn-box label{display:block;font-size:.64rem;letter-spacing:.06em;color:#6f8fb0;margin:.5rem 0 .2rem;text-transform:uppercase}
.qn-box textarea,.qn-box input,.qn-box select{width:100%;box-sizing:border-box;background:#0f1c33;color:#d8ecff;border:1px solid rgba(0,200,255,.25);border-radius:8px;padding:7px;font:12px ui-monospace,Menlo,Consolas,monospace}
.qn-box input[type=checkbox]{width:auto;margin-right:6px}.qn-chk{display:flex;align-items:center;font-size:.76rem;color:#b8d4ee;margin:.45rem 0;text-transform:none;letter-spacing:0}
.qn-box textarea{min-height:110px;resize:vertical}.qn-box textarea.bad{border-color:#ff5577}
.qn-row{display:flex;gap:8px;flex-wrap:wrap}.qn-row>*{flex:1;min-width:100px}
.qn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0 10px}
.qn-box button{background:rgba(0,136,255,.16);color:#00ccff;border:1px solid rgba(0,200,255,.3);border-radius:8px;padding:6px 10px;cursor:pointer;font:600 .72rem ui-monospace,Menlo,monospace}
.qn-box button:hover,.qn-box button:focus-visible{background:rgba(0,136,255,.35);outline:2px solid #00ccff;outline-offset:1px}
.qn-box button.qn-go{background:linear-gradient(135deg,#0077ff,#00ccff);color:#001018;padding:10px;font-size:.85rem;flex:2}.qn-box button:disabled{opacity:.5;cursor:wait}
.qn-srv{font-size:.7rem;color:#6f8fb0;margin:.2rem 0 .1rem}.qn-srv b{color:#00ff88}.qn-srv.w b{color:#ffd700}.qn-srv.e b{color:#ff5577}
.qn-note{font-size:.68rem;color:#6f8fb0;margin:.25rem 0}.qn-sec{margin-top:.6rem;padding-top:.4rem;border-top:1px solid rgba(0,200,255,.12);font-size:.7rem;letter-spacing:.06em;color:#00ccff;text-transform:uppercase}
.qn-bar{display:grid;grid-template-columns:64px 1fr 120px;gap:8px;align-items:center;margin:3px 0;font:11px ui-monospace,Menlo,monospace}
.qn-t{height:14px;background:#0f1c33;border-radius:4px;position:relative;overflow:hidden}.qn-t div{height:7px;position:absolute;left:0}
.qn-msg{padding:7px 10px;border-radius:8px;font-size:.76rem;margin:.35rem 0;border:1px solid}.qn-w{border-color:rgba(255,215,0,.4);background:rgba(255,215,0,.07);color:#ffd700}.qn-e{border-color:rgba(255,85,119,.5);background:rgba(255,85,119,.08);color:#ff5577}.qn-o{border-color:rgba(0,255,136,.4);background:rgba(0,255,136,.07);color:#00ff88}
.qn-x{float:right}.qn-lg span{margin-right:12px;font-size:.7rem}.qn-lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px}`;
  const PAL = ['linear-gradient(90deg,#0077ff,#00ccff)', 'linear-gradient(90deg,#b36bff,#ff7bd5)', 'linear-gradient(90deg,#ff9f1c,#ffd166)', 'linear-gradient(90deg,#06d6a0,#9bf6c8)', 'linear-gradient(90deg,#8d99ae,#d9e2ec)'];
  const IDEAL_CLR = 'linear-gradient(90deg,#46566f,#8fa3bf)';
  let last = null, ov = null, escFn = null;

  function open(o) {
    o = o || {}; close();
    if (!document.getElementById('qn-css')) { const st = document.createElement('style'); st.id = 'qn-css'; st.textContent = CSS; document.head.appendChild(st); }
    const saved = Object.assign({ preset: 'sc-modern', engine: '', shots: 512, seed: 42, ideal: true }, loadCfg());
    const vals = Object.assign(presetVals(saved.preset), saved.vals || {});
    ov = document.createElement('div'); ov.className = 'qn-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const fld = (k, extra) => `<div><label for="qn-${k}">${t(k)}</label><input id="qn-${k}" type="number" step="any" min="0" ${extra || ''}></div>`;
    ov.innerHTML = `<div class="qn-box"><button type="button" class="qn-x" id="qn-close" aria-label="${t('close')}">✕</button>
      <h2>${t('title')}</h2><p class="qn-sub">${t('sub')}</p>
      <div class="qn-srv" id="qn-srv" aria-live="polite">${t('srv')}: <b>…</b></div>
      <div id="qn-status"></div>
      <details id="qn-settings" ${o.quick ? '' : 'open'}><summary style="cursor:pointer;color:#00ccff;font-size:.78rem;margin:.4rem 0">${t('adjust')}</summary>
        <div class="qn-row"><div><label for="qn-eng">${t('sim')}</label><select id="qn-eng"></select><div class="qn-note" id="qn-caps"></div></div>
          <div><label for="qn-preset">${t('preset')}</label><select id="qn-preset"></select></div></div>
        <div class="qn-note">${t('presetNote')}</div>
        <div class="qn-sec">${t('params')}</div>
        <div class="qn-grid">${['p1', 'p2', 't1', 't2', 'tg1', 'tg2', 'r01', 'r10', 'amp', 'ph'].map(k => fld(k)).join('')}${fld('shots', 'min="1" max="50000" step="1"')}${fld('seed', 'step="1"')}</div>
        <label class="qn-chk"><input id="qn-ideal" type="checkbox">${t('ideal')}</label>
        <details><summary style="cursor:pointer;color:#6f8fb0;font-size:.74rem">${t('adv')}</summary>
          <label class="qn-chk"><input id="qn-manual" type="checkbox">${t('manual')}</label>
          <textarea id="qn-noise" spellcheck="false" readonly></textarea>
          <textarea id="qn-qasm" readonly style="min-height:80px;margin-top:6px"></textarea></details>
      </details>
      <div class="qn-row" style="margin-top:.7rem"><button type="button" class="qn-go" id="qn-run">${t('run')}</button><button type="button" id="qn-reset">${t('reset')}</button></div>
      <div id="qn-warns"></div><div id="qn-lg" class="qn-lg"></div><div id="qn-bars"></div></div>`;
    document.body.appendChild(ov);
    const $ = id => ov.querySelector('#' + id);
    const set = (id, cls, txt) => { const e = $(id); e.textContent = ''; if (txt) { const d = document.createElement('div'); d.className = 'qn-msg ' + cls; d.textContent = txt; e.appendChild(d); } };
    const srv = (cls, txt) => { const e = $('qn-srv'); e.className = 'qn-srv ' + cls; e.textContent = t('srv') + ': '; const b = document.createElement('b'); b.textContent = txt; e.appendChild(b); };
    PRESETS.forEach(p => { const op = document.createElement('option'); op.value = p.id; op.textContent = p.n[lang()] || p.n.en; $('qn-preset').appendChild(op); });
    if (saved.vals && !PRESETS.some(p => p.id === saved.preset)) saved.preset = 'sc-modern';
    $('qn-preset').value = saved.preset;
    const fill = v => { FIELDS.forEach(k => { $('qn-' + k).value = v[k] === 0 ? '0' : String(v[k]); }); refreshJson(); };
    const readVals = () => { const v = {}; FIELDS.forEach(k => { let x = parseFloat($('qn-' + k).value); if (!isFinite(x) || x < 0) x = 0; if (['p1', 'p2', 'r01', 'r10', 'amp', 'ph'].indexOf(k) >= 0) x = Math.min(1, x); v[k] = x; }); return v; };
    $('qn-shots').value = o.shots || saved.shots; $('qn-seed').value = saved.seed == null ? '' : saved.seed; $('qn-ideal').checked = saved.ideal !== false;
    let qasm = ''; const getQasm = () => { qasm = codeToQasm(o.getCode ? o.getCode() : o.code); $('qn-qasm').value = qasm; return qasm; };
    let manualOverride = o.noise || null;      // ruido que llega ya hecho (copiloto): se usa tal cual en esta ejecución
    function refreshJson() { if ($('qn-manual').checked) return; const b = buildNoise(readVals()); $('qn-noise').value = JSON.stringify(manualOverride || b.noise, null, 2); }
    fill(vals); if (manualOverride) { $('qn-noise').value = JSON.stringify(manualOverride, null, 2); }
    FIELDS.forEach(k => $('qn-' + k).addEventListener('input', () => { manualOverride = null; refreshJson(); }));
    $('qn-preset').addEventListener('change', () => { manualOverride = null; fill(presetVals($('qn-preset').value)); });
    $('qn-reset').onclick = () => { manualOverride = null; $('qn-manual').checked = false; $('qn-noise').readOnly = true; fill(presetVals($('qn-preset').value)); };
    $('qn-manual').addEventListener('change', () => { $('qn-noise').readOnly = !$('qn-manual').checked; if (!$('qn-manual').checked) { manualOverride = null; refreshJson(); } });
    $('qn-noise').addEventListener('input', () => { try { JSON.parse($('qn-noise').value); $('qn-noise').classList.remove('bad'); } catch (e) { $('qn-noise').classList.add('bad'); } });
    $('qn-close').onclick = close;
    escFn = e => { if (e.key === 'Escape' && ov) { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('keydown', escFn, true);
    let engines = [BROWSER], srvEngines = [], ready = null, srvOK = false;
    const fillEngines = () => { const sel = $('qn-eng'), keep = sel.value; sel.textContent = '';
      engines.forEach(e => { const op = document.createElement('option'); op.value = e; op.textContent = engName(e) + (ENG_ROLE[e] ? ' (' + t(ENG_ROLE[e]) + ')' : ''); sel.appendChild(op); });
      if (engines.length > 1) { const op = document.createElement('option'); op.value = 'all'; op.textContent = t('all'); sel.appendChild(op); }
      if (keep && sel.dataset.touched) wantEng = keep;
      sel.value = wantEng; if (sel.value !== wantEng) sel.value = BROWSER; showCaps(); };
    let wantEng = (o.engine && (o.engine === 'both' ? 'all' : o.engine)) || saved.engine || BROWSER;
    // Servidor de referencia (YAQS/Aer): conexión automática y OPCIONAL; el simulador del navegador no la necesita.
    function connect() {
      srv('w', t('srvWake', { s: 0 }));
      ready = wake(s => srv('w', t('srvWake', { s }))).then(h => {
        srvEngines = (h.engines && h.engines.length) ? h.engines : []; engines = [BROWSER].concat(srvEngines); srvOK = true;
        srv('', t('srvOk') + ' · ' + engines.map(engName).join(', ')); fillEngines(); return h;
      }).catch(e => { srv('e', t('srvOff')); throw e; });
      return ready;
    }
    async function showCaps() { const e = $('qn-eng').value; if (e === BROWSER) { $('qn-caps').textContent = t('caps', { q: BR.maxQ, c: 10 }); return; } const c = await caps(); const x = c && c[e]; $('qn-caps').textContent = (x && x.max_qubits) ? t('caps', { q: x.max_qubits, c: (x.channels || []).length }) : ''; }
    $('qn-eng').addEventListener('change', () => { wantEng = $('qn-eng').value; $('qn-eng').dataset.touched = '1'; showCaps(); });
    function currentCfg() { return { preset: $('qn-preset').value, engine: $('qn-eng').value, shots: parseInt($('qn-shots').value) || 512, seed: $('qn-seed').value === '' ? null : parseInt($('qn-seed').value), ideal: $('qn-ideal').checked, vals: readVals() }; }
    async function go() {
      let q; try { q = getQasm(); } catch (e) { set('qn-status', 'qn-e', '❌ ' + e.message); $('qn-settings').open = true; return; }
      let noise, notes = [];
      if ($('qn-manual').checked || manualOverride) { try { noise = JSON.parse($('qn-noise').value); } catch (e) { $('qn-noise').classList.add('bad'); set('qn-status', 'qn-e', t('badjson')); $('qn-settings').open = true; return; } }
      else { const b = buildNoise(readVals()); noise = b.noise; notes = b.notes; }
      if (wantEng !== BROWSER && !srvOK) { try { await (ready || connect()); } catch (e) {} fillEngines(); }
      const cfg = currentCfg(); if (!manualOverride && !$('qn-manual').checked) saveCfg(cfg);
      const shots = Math.max(1, Math.min(50000, cfg.shots)), seed = cfg.seed;
      $('qn-run').disabled = true; set('qn-warns', '', ''); $('qn-bars').textContent = ''; $('qn-lg').textContent = ''; set('qn-status', 'qn-o', (cfg.engine || BROWSER) === BROWSER ? '…' : t('running'));
      try {
        const eng = cfg.engine || BROWSER; let list = eng === 'all' ? engines.slice() : [eng]; const results = [];
        if (list.some(e => e !== BROWSER)) { try { await (ready || connect()); } catch (e) { list = list.filter(x => x === BROWSER); results.push({ name: t('srv'), res: { ok: false, error: 'servidor', detalle: t('srvOff') } }); if (!list.length) list = [BROWSER]; } }
        for (const e of list) results.push({ name: engName(e), res: await runAny({ engine: e, qasm: q, noise, shots: e === BROWSER ? Math.min(shots, 50000) : Math.min(shots, 2048), seed }) });
        if (cfg.ideal && noise.channels && noise.channels.length) {
          try { const r = await simulateBrowser(q, { schema_version: '1.0', channels: [] }, Math.min(Math.max(shots, 4096), 50000), seed); results.push({ name: t('ideal_l'), res: r, ideal: true }); } catch (e) {}
        }
        render(results, notes); set('qn-status', '', '');
        last = { circuit_qubits: (q.match(/qubit\[(\d+)\]/) || [])[1], shots, preset: cfg.preset, noise_channels: (noise.channels || []).map(c => c.type), results: results.map(r => ({ engine: r.name, ok: r.res.ok, error: r.res.error, counts: r.res.counts, avisos: r.res.avisos })) };
        window.QcolNoise.last = last;
      } catch (e) { set('qn-status', 'qn-e', '❌ ' + e.message); }
      $('qn-run').disabled = false;
    }
    function render(rs, notes) {
      const w = $('qn-warns'); w.textContent = ''; const add = (c, x) => { const d = document.createElement('div'); d.className = 'qn-msg ' + c; d.textContent = x; w.appendChild(d); };
      (notes || []).forEach(n => add('qn-w', 'ℹ️ ' + n));
      rs.forEach(r => { if (!r.res.ok) add('qn-e', '❌ ' + r.name + ': ' + r.res.error + ' — ' + (r.res.detalle || '')); else { (r.res.avisos || []).forEach(a => add('qn-w', '⚠️ ' + r.name + ' ' + a)); (r.res.warnings || []).forEach(a => add('qn-w', '⚠️ ' + r.name + ': ' + a)); } });
      const oks = rs.filter(r => r.res.ok); if (!oks.length) return;
      const clr = (r, i) => r.ideal ? IDEAL_CLR : PAL[i % PAL.length];
      const lg = $('qn-lg'); lg.textContent = ''; oks.forEach((r, i) => { const s = document.createElement('span'), ic = document.createElement('i'); ic.style.background = clr(r, i); s.appendChild(ic); s.appendChild(document.createTextNode(r.name + ' (' + (r.res.meta && r.res.meta.elapsed_s) + ' s)')); lg.appendChild(s); });
      const tot = r => Object.values(r.res.counts).reduce((a, b) => a + b, 0);
      const keys = [...new Set(oks.flatMap(r => Object.keys(r.res.counts)))].sort((a, b) => oks.reduce((s, r) => s + (r.res.counts[b] || 0) / tot(r), 0) - oks.reduce((s, r) => s + (r.res.counts[a] || 0) / tot(r), 0)).slice(0, 16).sort();
      const bars = $('qn-bars'); bars.textContent = '';
      keys.forEach(k => { const row = document.createElement('div'); row.className = 'qn-bar'; const lab = document.createElement('span'); lab.textContent = k; const tr = document.createElement('div'); tr.className = 'qn-t'; tr.style.height = (oks.length * 8 + 2) + 'px';
        oks.forEach((r, i) => { const f = document.createElement('div'); f.style.top = (i * 8 + 1) + 'px'; f.style.height = '6px'; f.style.width = (100 * (r.res.counts[k] || 0) / tot(r)).toFixed(1) + '%'; f.style.background = clr(r, i); tr.appendChild(f); });
        const v = document.createElement('span'); v.textContent = oks.map(r => (100 * (r.res.counts[k] || 0) / tot(r)).toFixed(1) + '%').join(' / ');
        row.appendChild(lab); row.appendChild(tr); row.appendChild(v); bars.appendChild(row); });
      const noisy = oks.filter(r => !r.ideal), idl = oks.find(r => r.ideal);
      if (idl) noisy.forEach(r => add('qn-o', r.name + ' — ' + t('fid') + ': ' + (1 - tvd(r.res.counts, idl.res.counts)).toFixed(3)));
      if (noisy.length >= 2) add('qn-o', t('tvd') + ' ' + noisy[0].name + ' vs ' + noisy[1].name + ': ' + tvd(noisy[0].res.counts, noisy[1].res.counts).toFixed(4) + ' (' + t('typical') + ')');
    }
    $('qn-run').onclick = go;
    try { getQasm(); } catch (e) { set('qn-status', 'qn-e', '❌ ' + e.message); }
    fillEngines(); connect().catch(() => {});
    setTimeout(() => { try { $('qn-run').focus(); } catch (e) {} if (o.autorun || o.quick) go(); }, 50);
  }
  function close() { if (escFn) { document.removeEventListener('keydown', escFn, true); escFn = null; } if (ov && ov.parentNode) ov.parentNode.removeChild(ov); ov = null; }
  const quick = o => open(Object.assign({}, o || {}, { quick: true }));
  window.QcolNoise = { open, quick, close, engines: () => [BROWSER], codeToQasm, run, api, wake, simulate: simulateBrowser, exactProbs, presets: PRESETS, buildNoise, last: null, version: '2.0' };
  // Pre-calienta el servidor gratuito (si estaba dormido) para que el primer uso sea rápido
  setTimeout(() => { try { if (document.visibilityState !== 'hidden') wake(null, 20000).catch(() => {}); } catch (e) {} }, 5000);
})();
