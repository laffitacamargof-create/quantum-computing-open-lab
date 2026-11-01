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
      out.push(g + (par.length ? '(' + par.map(p => p.toPrecision(10)).join(',') + ')' : '') + ' ' + qs.map(q => 'q[' + q + ']').join(', ') + ';'); return true;
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

  // ───────── Textos (ES/EN) ─────────
  const TX = {
    en: { title: '🔊 Quantum noise', sub: 'Simulates your circuit with realistic noise. The reference engine is MQT YAQS and results can be cross-checked with other simulators.',
      srv: 'QCOL noise server', srvOk: 'Connected', srvWake: 'Waking up the free server… {s}s (first use can take ~1 min)', srvDown: 'The noise server is not answering right now. Try again in a minute.',
      sim: 'Simulator', all: 'Compare all simulators', preset: 'Preset', presetNote: 'Typical orders of magnitude for each technology — not the live calibration of a specific device. Edit any value below.',
      params: 'Adjustable parameters', p1: '1-qubit gate error', p2: '2-qubit gate error', t1: 'T1 (µs)', t2: 'T2 (µs)', tg1: '1q gate time (µs)', tg2: '2q gate time (µs)',
      r01: 'Readout P(0 | 1)', r10: 'Readout P(1 | 0)', amp: 'Extra amplitude damping γ', ph: 'Extra phase damping λ', shots: 'Shots', seed: 'Seed (empty = random)',
      ideal: 'Also show the ideal (noise-free) result', adv: 'Advanced: noise JSON and OpenQASM', manual: 'Edit the JSON by hand (overrides the fields above)', run: '⚡ Run with noise', adjust: '⚙ Adjust noise',
      reset: 'Reset preset', running: 'Running… YAQS can take from seconds to a couple of minutes on the free server.', badjson: 'Fix the noise JSON first.', t2cap: 'T2 was limited to 2·T1 (physical limit).',
      ideal_l: 'Ideal', fid: 'Similarity to ideal (1 − TVD)', tvd: 'Total variation distance', typical: '≈0.03–0.07 is typical sampling noise', caps: 'max {q} qubits · {c} noise channels',
      refEngine: 'reference', validator: 'validator', netfail: 'Could not reach the noise server.', close: 'Close' },
    es: { title: '🔊 Ruido cuántico', sub: 'Simula tu circuito con ruido realista. El motor de referencia es MQT YAQS y puedes contrastar el resultado con otros simuladores.',
      srv: 'Servidor de ruido de QCOL', srvOk: 'Conectado', srvWake: 'Despertando el servidor gratuito… {s}s (el primer uso puede tardar ~1 min)', srvDown: 'El servidor de ruido no responde ahora mismo. Inténtalo de nuevo en un minuto.',
      sim: 'Simulador', all: 'Comparar todos los simuladores', preset: 'Preconfiguración', presetNote: 'Órdenes de magnitud típicos de cada tecnología — no es la calibración en vivo de un dispositivo concreto. Puedes editar cualquier valor.',
      params: 'Parámetros ajustables', p1: 'Error de puerta de 1 qubit', p2: 'Error de puerta de 2 qubits', t1: 'T1 (µs)', t2: 'T2 (µs)', tg1: 'Tiempo puerta 1q (µs)', tg2: 'Tiempo puerta 2q (µs)',
      r01: 'Lectura P(0 | 1)', r10: 'Lectura P(1 | 0)', amp: 'Amortiguamiento de amplitud extra γ', ph: 'Amortiguamiento de fase extra λ', shots: 'Disparos (shots)', seed: 'Semilla (vacío = aleatoria)',
      ideal: 'Mostrar también el resultado ideal (sin ruido)', adv: 'Avanzado: JSON de ruido y OpenQASM', manual: 'Editar el JSON a mano (anula los campos de arriba)', run: '⚡ Ejecutar con ruido', adjust: '⚙ Ajustar ruido',
      reset: 'Restablecer preconfiguración', running: 'Ejecutando… YAQS puede tardar de segundos a un par de minutos en el servidor gratuito.', badjson: 'Corrige primero el JSON de ruido.', t2cap: 'T2 se limitó a 2·T1 (límite físico).',
      ideal_l: 'Ideal', fid: 'Parecido al ideal (1 − TVD)', tvd: 'Distancia de variación total', typical: '≈0.03–0.07 es ruido de muestreo típico', caps: 'máx. {q} qubits · {c} canales de ruido',
      refEngine: 'referencia', validator: 'validador', netfail: 'No se pudo contactar con el servidor de ruido.', close: 'Cerrar' } };
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
  const ENG_NAME = { 'mqt-yaqs': 'MQT YAQS', 'qiskit-aer': 'Qiskit Aer' }, ENG_ROLE = { 'mqt-yaqs': 'refEngine', 'qiskit-aer': 'validator' };
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
        <div class="qn-grid">${['p1', 'p2', 't1', 't2', 'tg1', 'tg2', 'r01', 'r10', 'amp', 'ph'].map(k => fld(k)).join('')}${fld('shots', 'min="1" max="2048" step="1"')}${fld('seed', 'step="1"')}</div>
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
    let engines = ['mqt-yaqs', 'qiskit-aer'], ready = null;
    // Conexión: automática (no hay URL que escribir). Despierta el servidor gratuito si estaba dormido.
    function connect() {
      srv('w', t('srvWake', { s: 0 }));
      ready = wake(s => srv('w', t('srvWake', { s }))).then(h => {
        engines = (h.engines && h.engines.length) ? h.engines : engines; srv('', t('srvOk') + ' · ' + engines.map(engName).join(', '));
        const sel = $('qn-eng'); sel.textContent = '';
        engines.forEach(e => { const op = document.createElement('option'); op.value = e; op.textContent = engName(e) + (ENG_ROLE[e] ? ' (' + t(ENG_ROLE[e]) + ')' : ''); sel.appendChild(op); });
        if (engines.length > 1) { const op = document.createElement('option'); op.value = 'all'; op.textContent = t('all'); sel.appendChild(op); }
        sel.value = (o.engine && (o.engine === 'both' ? 'all' : o.engine)) || saved.engine || engines[0]; if (!sel.value) sel.value = engines[0];
        showCaps(); return h;
      }).catch(e => { srv('e', e.message); throw e; });
      return ready;
    }
    async function showCaps() { const c = await caps(), e = $('qn-eng').value; const x = c && c[e]; $('qn-caps').textContent = (x && x.max_qubits) ? t('caps', { q: x.max_qubits, c: (x.channels || []).length }) : ''; }
    $('qn-eng').addEventListener('change', showCaps);
    function currentCfg() { return { preset: $('qn-preset').value, engine: $('qn-eng').value, shots: parseInt($('qn-shots').value) || 512, seed: $('qn-seed').value === '' ? null : parseInt($('qn-seed').value), ideal: $('qn-ideal').checked, vals: readVals() }; }
    async function go() {
      let q; try { q = getQasm(); } catch (e) { set('qn-status', 'qn-e', '❌ ' + e.message); $('qn-settings').open = true; return; }
      let noise, notes = [];
      if ($('qn-manual').checked || manualOverride) { try { noise = JSON.parse($('qn-noise').value); } catch (e) { $('qn-noise').classList.add('bad'); set('qn-status', 'qn-e', t('badjson')); $('qn-settings').open = true; return; } }
      else { const b = buildNoise(readVals()); noise = b.noise; notes = b.notes; }
      const cfg = currentCfg(); if (!manualOverride && !$('qn-manual').checked) saveCfg(cfg);
      const shots = Math.max(1, Math.min(2048, cfg.shots)), seed = cfg.seed;
      $('qn-run').disabled = true; set('qn-warns', '', ''); $('qn-bars').textContent = ''; $('qn-lg').textContent = ''; set('qn-status', 'qn-o', t('running'));
      try {
        await (ready || connect());
        const eng = cfg.engine || engines[0], list = eng === 'all' ? engines.slice() : [eng], results = [];
        for (const e of list) results.push({ name: engName(e), res: await run({ engine: e, qasm: q, noise, shots, seed }) });
        if (cfg.ideal && noise.channels && noise.channels.length) {
          const ie = engines.indexOf('qiskit-aer') >= 0 ? 'qiskit-aer' : list[0];
          try { const r = await run({ engine: ie, qasm: q, noise: { schema_version: '1.0', channels: [] }, shots: Math.max(shots, 1024), seed }); results.push({ name: t('ideal_l'), res: r, ideal: true }); } catch (e) {}
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
    connect().catch(() => {});
    setTimeout(() => { try { $('qn-run').focus(); } catch (e) {} if (o.autorun || o.quick) go(); }, 50);
  }
  function close() { if (escFn) { document.removeEventListener('keydown', escFn, true); escFn = null; } if (ov && ov.parentNode) ov.parentNode.removeChild(ov); ov = null; }
  const quick = o => open(Object.assign({}, o || {}, { quick: true }));
  window.QcolNoise = { open, quick, close, codeToQasm, run, api, wake, presets: PRESETS, buildNoise, last: null, version: '2.0' };
  // Pre-calienta el servidor gratuito (si estaba dormido) para que el primer uso sea rápido
  setTimeout(() => { try { if (document.visibilityState !== 'hidden') wake(null, 20000).catch(() => {}); } catch (e) {} }, 5000);
})();
