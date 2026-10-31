/* QCOL Noise — opción "🔊 Ruido" para las herramientas existentes (Architect, Notebook, ...).
   Uso:  QcolNoise.open({ getCode: () => '...código Qiskit...', title: 'Mi circuito' [, autorun:true, noise:{...}, engine:'both', shots:512] })
   Convierte el código Qiskit (qc.h(0), qc.cx(0,1), ...) a OpenQASM 3 y lo simula con ruido en el Space de QCOL (MQT YAQS / Qiskit Aer). */
(function () {
  'use strict';
  if (window.QcolNoise) return;
  const DEFAULT_URL = '';   // <- URL del Space (https://usuario-qcol-noise-lab.hf.space). Si se rellena, todos los usuarios la usan.
  const LS = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

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

  // ───────── Llamada al Space ─────────
  const baseUrl = () => (LS.get('qcol_noise_url') || DEFAULT_URL).trim().replace(/\/+$/, '');
  async function api(path, opts) {
    const b = baseUrl(); if (!/^https?:\/\//.test(b)) throw new Error('Set the Noise server URL first.');
    const r = await fetch(b + path, Object.assign({ mode: 'cors' }, opts || {}));
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!j) throw new Error('The server answered ' + r.status + ' without JSON (Space asleep or still building?).');
    return j;
  }
  const run = (o) => api('/qcol/activar_ruido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motor: o.engine, circuito_qasm: o.qasm, noise: o.noise, shots: o.shots, seed: o.seed }) });
  const tvd = (a, b) => { const na = Object.values(a).reduce((x, y) => x + y, 0), nb = Object.values(b).reduce((x, y) => x + y, 0); let s = 0; new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => { s += Math.abs((a[k] || 0) / na - (b[k] || 0) / nb); }); return s / 2; };

  // ───────── Ventana ─────────
  const CH = { depolarizing: { type: 'depolarizing', p: 0.01 }, thermal: { type: 'thermal_relaxation', T1: 100, T2: 80, gate_time: 1.0 }, amp: { type: 'amplitude_damping', gamma: 0.02 }, phase: { type: 'phase_damping', lambda: 0.02 }, readout: { type: 'readout', p0_given_1: 0.03, p1_given_0: 0.02 } };
  const CSS = `.qn-ov{position:fixed;inset:0;z-index:99999;background:rgba(2,6,14,.82);display:flex;align-items:center;justify-content:center;padding:14px;font:14px/1.45 system-ui,sans-serif}
.qn-box{background:#0a1424;color:#d8ecff;border:1px solid rgba(0,200,255,.35);border-radius:14px;width:min(760px,100%);max-height:94vh;overflow:auto;padding:14px 16px}
.qn-box h2{margin:0 0 2px;font-size:1rem;color:#00ccff}.qn-sub{color:#6f8fb0;font-size:.75rem;margin:0 0 8px}
.qn-box label{display:block;font-size:.66rem;letter-spacing:.06em;color:#6f8fb0;margin:.55rem 0 .2rem;text-transform:uppercase}
.qn-box textarea,.qn-box input,.qn-box select{width:100%;box-sizing:border-box;background:#0f1c33;color:#d8ecff;border:1px solid rgba(0,200,255,.25);border-radius:8px;padding:7px;font:12px ui-monospace,Menlo,Consolas,monospace}
.qn-box textarea{min-height:120px;resize:vertical}.qn-box textarea.bad{border-color:#ff5577}
.qn-row{display:flex;gap:8px;flex-wrap:wrap}.qn-row>*{flex:1;min-width:90px}
.qn-box button{background:rgba(0,136,255,.16);color:#00ccff;border:1px solid rgba(0,200,255,.3);border-radius:8px;padding:6px 10px;cursor:pointer;font:600 .72rem ui-monospace,Menlo,monospace}
.qn-box button:hover,.qn-box button:focus-visible{background:rgba(0,136,255,.35);outline:2px solid #00ccff;outline-offset:1px}
.qn-box button.qn-go{background:linear-gradient(135deg,#0077ff,#00ccff);color:#001018;width:100%;padding:10px;margin-top:.7rem;font-size:.85rem}.qn-box button:disabled{opacity:.5;cursor:wait}
.qn-chips{display:flex;gap:6px;flex-wrap:wrap;margin:.3rem 0}.qn-chips button{font-weight:500}
.qn-bar{display:grid;grid-template-columns:64px 1fr 92px;gap:8px;align-items:center;margin:3px 0;font:11px ui-monospace,Menlo,monospace}
.qn-t{height:14px;background:#0f1c33;border-radius:4px;position:relative;overflow:hidden}.qn-t div{height:100%;position:absolute;top:0;left:0}
.qn-msg{padding:7px 10px;border-radius:8px;font-size:.76rem;margin:.35rem 0;border:1px solid}.qn-w{border-color:rgba(255,215,0,.4);background:rgba(255,215,0,.07);color:#ffd700}.qn-e{border-color:rgba(255,85,119,.5);background:rgba(255,85,119,.08);color:#ff5577}.qn-o{border-color:rgba(0,255,136,.4);background:rgba(0,255,136,.07);color:#00ff88}
.qn-x{float:right}.qn-lg span{margin-right:12px;font-size:.7rem}.qn-lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px}`;
  const PAL = ['linear-gradient(90deg,#0077ff,#00ccff)', 'linear-gradient(90deg,#b36bff,#ff7bd5)'];
  let last = null, ov = null;

  function open(o) {
    o = o || {}; close();
    if (!document.getElementById('qn-css')) { const st = document.createElement('style'); st.id = 'qn-css'; st.textContent = CSS; document.head.appendChild(st); }
    ov = document.createElement('div'); ov.className = 'qn-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="qn-box"><button type="button" class="qn-x" id="qn-close" aria-label="Close">✕</button>
      <h2>🔊 Noise simulation</h2><p class="qn-sub">Simulates your circuit with realistic noise using <b>MQT YAQS</b> and cross-checks with <b>Qiskit Aer</b>.</p>
      <label for="qn-url">Noise server (Hugging Face Space URL)</label><div class="qn-row"><input id="qn-url" placeholder="https://your-user-qcol-noise-lab.hf.space" autocomplete="off"><button type="button" id="qn-test" style="flex:0 0 130px">Test</button></div><div id="qn-conn"></div>
      <div class="qn-row"><div><label for="qn-eng">Engine</label><select id="qn-eng"><option value="mqt-yaqs">MQT YAQS (reference)</option><option value="qiskit-aer">Qiskit Aer</option><option value="both">Compare YAQS vs Aer</option></select></div>
      <div><label for="qn-shots">Shots</label><input id="qn-shots" type="number" min="1" max="2048" value="512"></div><div><label for="qn-seed">Seed</label><input id="qn-seed" type="number" min="0" value="42"></div></div>
      <label for="qn-noise">Noise model (portable JSON)</label>
      <div class="qn-chips"><button type="button" data-n="depolarizing">+ depolarizing</button><button type="button" data-n="thermal">+ T1/T2</button><button type="button" data-n="amp">+ amplitude damping</button><button type="button" data-n="phase">+ phase damping</button><button type="button" data-n="readout">+ readout</button><button type="button" data-n="clear">clear</button></div>
      <textarea id="qn-noise" spellcheck="false"></textarea>
      <details><summary style="cursor:pointer;color:#6f8fb0;font-size:.75rem;margin-top:.5rem">OpenQASM generated from your circuit</summary><textarea id="qn-qasm" readonly style="min-height:90px"></textarea></details>
      <button type="button" class="qn-go" id="qn-run">⚡ Activate noise</button>
      <div id="qn-status"></div><div id="qn-warns"></div><div id="qn-lg" class="qn-lg"></div><div id="qn-bars"></div></div>`;
    document.body.appendChild(ov);
    const $ = id => ov.querySelector('#' + id); const set = (id, cls, t) => { const e = $(id); e.textContent = ''; if (t) { const d = document.createElement('div'); d.className = 'qn-msg ' + cls; d.textContent = t; e.appendChild(d); } };
    $('qn-url').value = baseUrl();
    $('qn-noise').value = JSON.stringify(o.noise || { schema_version: '1.0', channels: [CH.depolarizing, CH.thermal, CH.readout], options: { noise_after_1q_gates: true } }, null, 2);
    if (o.engine) $('qn-eng').value = o.engine; if (o.shots) $('qn-shots').value = o.shots;
    let qasm = ''; try { qasm = codeToQasm(o.getCode ? o.getCode() : o.code); $('qn-qasm').value = qasm; } catch (e) { set('qn-status', 'qn-e', '❌ ' + e.message); }
    const parse = () => { const t = $('qn-noise').value.trim(); return t ? JSON.parse(t) : { schema_version: '1.0', channels: [] }; };
    const chk = () => { try { parse(); $('qn-noise').classList.remove('bad'); return true; } catch (e) { $('qn-noise').classList.add('bad'); return false; } };
    $('qn-noise').addEventListener('input', chk);
    ov.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => { if (b.dataset.n === 'clear') { $('qn-noise').value = JSON.stringify({ schema_version: '1.0', channels: [] }, null, 2); return; } let n; try { n = parse(); } catch (e) { n = { schema_version: '1.0', channels: [] }; } n.channels = (n.channels || []).concat([JSON.parse(JSON.stringify(CH[b.dataset.n]))]); $('qn-noise').value = JSON.stringify(n, null, 2); chk(); }));
    $('qn-close').onclick = close;
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } }, true);
    $('qn-test').onclick = async () => { LS.set('qcol_noise_url', $('qn-url').value.trim()); try { const j = await api('/qcol/health'); set('qn-conn', 'qn-o', '✅ Connected. Engines: ' + (j.engines || []).join(', ') + ' · ≤' + j.limits.max_qubits + ' qubits'); } catch (e) { set('qn-conn', 'qn-e', '❌ ' + e.message); } };
    async function go() {
      LS.set('qcol_noise_url', $('qn-url').value.trim());
      try { qasm = codeToQasm(o.getCode ? o.getCode() : o.code); $('qn-qasm').value = qasm; } catch (e) { set('qn-status', 'qn-e', '❌ ' + e.message); return; }
      if (!chk()) { set('qn-status', 'qn-e', 'Fix the noise JSON first.'); return; }
      const eng = $('qn-eng').value, list = eng === 'both' ? ['mqt-yaqs', 'qiskit-aer'] : [eng];
      const shots = Math.max(1, Math.min(2048, parseInt($('qn-shots').value) || 512)), seed = $('qn-seed').value === '' ? null : parseInt($('qn-seed').value);
      $('qn-run').disabled = true; set('qn-status', 'qn-o', 'Running… YAQS can take from seconds to a couple of minutes on the free server.'); set('qn-warns', '', ''); $('qn-bars').textContent = ''; $('qn-lg').textContent = '';
      try {
        const results = []; const noise = parse();
        for (const e of list) results.push({ name: e === 'mqt-yaqs' ? 'YAQS' : 'Aer', res: await run({ engine: e, qasm, noise, shots, seed }) });
        render(results); set('qn-status', '', '');
        last = { circuit_qubits: (qasm.match(/qubit\[(\d+)\]/) || [])[1], shots, noise_channels: (noise.channels || []).map(c => c.type), results: results.map(r => ({ engine: r.name, ok: r.res.ok, error: r.res.error, counts: r.res.counts, avisos: r.res.avisos })) };
        window.QcolNoise.last = last;
      } catch (e) { set('qn-status', 'qn-e', '❌ ' + e.message + ' — if the Space was asleep wait ~1 minute and retry.'); }
      $('qn-run').disabled = false;
    }
    function render(rs) {
      const w = $('qn-warns'); w.textContent = ''; const add = (c, t) => { const d = document.createElement('div'); d.className = 'qn-msg ' + c; d.textContent = t; w.appendChild(d); };
      rs.forEach(r => { if (!r.res.ok) add('qn-e', '❌ ' + r.name + ': ' + r.res.error + ' — ' + (r.res.detalle || '')); else { (r.res.avisos || []).forEach(a => add('qn-w', '⚠️ ' + r.name + ' ' + a)); (r.res.warnings || []).forEach(a => add('qn-w', '⚠️ ' + r.name + ': ' + a)); } });
      const oks = rs.filter(r => r.res.ok); if (!oks.length) return;
      const lg = $('qn-lg'); lg.textContent = ''; oks.forEach((r, i) => { const s = document.createElement('span'), ic = document.createElement('i'); ic.style.background = PAL[i]; s.appendChild(ic); s.appendChild(document.createTextNode(r.name + ' (' + r.res.meta.elapsed_s + ' s)')); lg.appendChild(s); });
      const keys = [...new Set(oks.flatMap(r => Object.keys(r.res.counts)))].sort(); const bars = $('qn-bars'); bars.textContent = '';
      keys.forEach(k => { const row = document.createElement('div'); row.className = 'qn-bar'; const lab = document.createElement('span'); lab.textContent = k; const tr = document.createElement('div'); tr.className = 'qn-t';
        oks.forEach((r, i) => { const n = Object.values(r.res.counts).reduce((a, b) => a + b, 0), f = document.createElement('div'); f.style.width = (100 * (r.res.counts[k] || 0) / n).toFixed(1) + '%'; f.style.background = PAL[i]; if (i) f.style.opacity = '.7'; tr.appendChild(f); });
        const v = document.createElement('span'); v.textContent = oks.map(r => (100 * (r.res.counts[k] || 0) / Object.values(r.res.counts).reduce((a, b) => a + b, 0)).toFixed(1) + '%').join(' / ');
        row.appendChild(lab); row.appendChild(tr); row.appendChild(v); bars.appendChild(row); });
      if (oks.length === 2) add('qn-o', 'Total variation distance YAQS vs Aer: ' + tvd(oks[0].res.counts, oks[1].res.counts).toFixed(4) + ' (≈0.03–0.07 is typical sampling noise)');
    }
    $('qn-run').onclick = go;
    setTimeout(() => { try { (o.autorun ? $('qn-run') : $('qn-run')).focus(); } catch (e) {} if (o.autorun) go(); }, 50);
  }
  function close() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); ov = null; }
  window.QcolNoise = { open, close, codeToQasm, run, api, last: null, version: '1.0' };
})();
