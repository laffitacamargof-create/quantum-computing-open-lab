/* QuOLab Nexus — Theoretical Gates UI (shared by Open Lab / Architect and the Quantum Notebook)
 * Depends on quolab-nexus-theoretical-gates.js (window.QuOLabTheoreticalGates).
 * Public API: window.QuOLabTGUI = { init(host), renderPanel(container), openEditor(opts), openInventory(),
 *   openDetail(id, version), showBasicMatrix(name, params), tileHTML(gate), refreshPanels() }
 * host = { notify(msg), useGate(gate), onChange(), onUseU?() }
 */
(function (root) {
  'use strict';
  var TG = root.QuOLabTheoreticalGates;
  if (!TG || !root.document) return;
  var doc = root.document, cat = TG.catalog(), host = { notify: function (m) { try { console.log(m); } catch (_) {} }, useGate: null, onChange: null };
  var panels = [];

  // Open Lab palette ids → basic gate names
  var PAL = { H: 'h', X: 'x', Y: 'y', Z: 'z', S: 's', T: 't', SX: 'sx', RX: 'rx', RY: 'ry', RZ: 'rz', CX: 'cx', CZ: 'cz', SWAP: 'swap', CCX: 'ccx', CSW: 'cswap' };
  var TRAY = ['H', 'X', 'Y', 'Z', 'S', 'T', 'SX', 'RX', 'RY', 'RZ', 'CX', 'CZ', 'SWAP', 'CCX', 'CSW'];
  var SYM = { sx: '√X', swap: 'SW', cswap: 'CSW' };
  function basicName(tok) { if (PAL[tok]) return PAL[tok]; var i = TG.basicInfo(String(tok || '')); return i ? i.name : null; }
  function defParam(name) { return /^(rx|ry|rz)$/.test(name) ? 'pi/4' : '0'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(m) { try { host.notify(m); } catch (_) {} }
  function when(ts) { try { return new Date(ts).toLocaleString(); } catch (_) { return ''; } }
  function copy(text) { try { navigator.clipboard.writeText(text); note('Copied'); } catch (_) { note('Copy is not available here'); } }

  // ───────────── styles ─────────────
  var CSS = [
    '.tgu-sec{margin-bottom:.6rem}',
    '.tgu-btn{font:600 .62rem/1.2 var(--ex,sans-serif);color:var(--tx,#dce8ff);background:var(--p3,#1a2640);border:1px solid var(--bd2,#1e3058);border-radius:6px;padding:.38rem .55rem;cursor:pointer}',
    '.tgu-btn:hover{border-color:var(--cy,#00ffdd)}.tgu-btn:disabled{opacity:.45;cursor:not-allowed}',
    '.tgu-btn.pri{background:#0a5f58;border-color:#00ffdd}.tgu-btn.dng{border-color:#ff4466;color:#ff8ea3}',
    '.tgu-create{width:100%;margin:.15rem 0 .4rem;text-align:center}',
    '.pal-gate.tg-user{background:#fff!important;border:2px solid #9aa7bd!important;color:#0a0e1a;box-shadow:none!important}',
    '.pal-gate.tg-user .pal-gate-sym{font:800 1.05rem var(--mono,monospace);color:#0a0e1a}',
    '.pal-gate.tg-user .pal-gate-lbl{color:#5a6a88;font-size:.38rem;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pal-gate.tg-u{background:#000!important;border:2px solid #fff!important;box-shadow:none!important}',
    '.pal-gate.tg-u .pal-gate-sym{color:#fff;font:800 1.15rem var(--mono,monospace)}',
    '.pal-gate.tg-u .pal-gate-lbl{color:#9aa7bd}',
    '.tg-plus{width:100%;aspect-ratio:1;border-radius:8px;border:2px dashed #3d5a8a;background:transparent;color:#8aa0c4;font:700 1.3rem var(--mono,monospace);cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.tg-plus:hover{border-color:#00ffdd;color:#00ffdd}',
    '@media(max-width:760px){.tg-plus{width:54px;height:54px;flex-shrink:0;aspect-ratio:auto}.tgu-create{width:auto;white-space:nowrap}}',
    '#tgu-layer{position:fixed;inset:0;z-index:9000;pointer-events:none;font-family:var(--ex,sans-serif)}',
    '.tgu-modal{position:fixed;top:4vh;bottom:4vh;left:max(8px,var(--tgu-left,8px));right:3vw;max-width:1100px;background:#0d1220;color:#dce8ff;border:1px solid #1e3058;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.65);display:flex;flex-direction:column;pointer-events:auto;overflow:hidden}',
    '.tgu-modal.sm{top:12vh;bottom:auto;max-height:76vh;max-width:640px;left:50%;right:auto;transform:translateX(-50%);width:min(640px,94vw)}',
    '.tgu-modal.mid{max-width:860px}',
    '@media(max-width:760px){.tgu-modal{inset:0!important;max-width:none;border-radius:0;transform:none!important;width:auto!important}.tgu-modal.sm{inset:auto 0 0 0!important;max-height:86vh;border-radius:14px 14px 0 0}}',
    '.tgu-h{display:flex;align-items:center;gap:.5rem;padding:.55rem .8rem;background:#111827;border-bottom:1px solid #1a2a48}',
    '.tgu-h b{font:700 .8rem var(--orb,monospace);letter-spacing:.04em;flex:1}',
    '.tgu-x{background:none;border:0;color:#8aa0c4;font-size:1.1rem;cursor:pointer;min-width:32px;min-height:32px}',
    '.tgu-b{flex:1;overflow:auto;padding:.7rem .85rem;-webkit-overflow-scrolling:touch}',
    '.tgu-f{display:flex;flex-wrap:wrap;gap:.4rem;padding:.55rem .8rem;border-top:1px solid #1a2a48;background:#0b101c;align-items:center}',
    '.tgu-f .sp{flex:1}',
    '.tgu-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.55rem}',
    '.tgu-in{background:#060912;border:1px solid #1e3058;border-radius:6px;color:#dce8ff;padding:.38rem .5rem;font:.75rem var(--mono,monospace);min-width:0}',
    '.tgu-in:focus{outline:none;border-color:#00ffdd}',
    '.tgu-lbl{font:.6rem var(--orb,monospace);color:#8aa0c4;letter-spacing:.05em}',
    '.tgu-seg{display:inline-flex;border:1px solid #1e3058;border-radius:7px;overflow:hidden}',
    '.tgu-seg button{background:#0a0e1a;color:#8aa0c4;border:0;padding:.4rem .8rem;font:600 .68rem var(--ex,sans-serif);cursor:pointer}',
    '.tgu-seg button.on{background:#0a5f58;color:#fff}',
    '.tgu-chip{display:inline-block;border-radius:999px;padding:.1rem .5rem;font:700 .58rem var(--ex,sans-serif);border:1px solid}',
    '.tgu-chip.valid{color:#00ff88;border-color:#00ff88}.tgu-chip.invalid{color:#ff4466;border-color:#ff4466}.tgu-chip.unverified{color:#ffd700;border-color:#ffd700}.tgu-chip.arch{color:#8aa0c4;border-color:#3d5a8a}',
    '.tgu-tray{display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.5rem}',
    '.tgu-tray button{min-width:38px;height:34px;border-radius:6px;border:1px solid #3d5a8a;background:#111b30;color:#dce8ff;font:700 .7rem var(--mono,monospace);cursor:pointer}',
    '.tgu-tray button.tg{background:#fff;color:#0a0e1a;border-color:#9aa7bd}.tgu-tray button.sel{outline:2px solid #00ffdd}',
    '.tgu-grid{overflow:auto;border:1px solid #1a2a48;border-radius:8px;background:#060912;padding:.4rem;margin-bottom:.6rem}',
    '.tgu-grid table{border-collapse:collapse}',
    '.tgu-grid td{height:40px;min-width:44px;padding:0;text-align:center;position:relative;border:0}',
    '.tgu-grid td.ql{min-width:46px;font:.62rem var(--mono,monospace);color:#8aa0c4;text-align:right;padding-right:6px}',
    '.tgu-grid td.w::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:#3d5a8a}',
    '.tgu-grid td.w.hov{background:rgba(0,255,221,.08)}',
    '.tgu-g{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;border-radius:5px;background:#1a5fb4;color:#fff;font:700 .7rem var(--mono,monospace);border:1px solid rgba(255,255,255,.35)}',
    '.tgu-g.tg{background:#fff;color:#0a0e1a;border-color:#9aa7bd}',
    '.tgu-g.ctl{width:12px;height:12px;border-radius:50%;background:#dce8ff;border:0}',
    '.tgu-g sub{font-size:.5rem;position:absolute;right:1px;bottom:-1px;color:#ffd700}',
    '.tgu-ops{width:100%;border-collapse:collapse;font-size:.7rem}',
    '.tgu-ops th{font:.56rem var(--orb,monospace);color:#8aa0c4;text-align:left;padding:.2rem .3rem}',
    '.tgu-ops td{padding:.15rem .3rem;border-top:1px solid #16213a}',
    '.tgu-ops input{width:100%}',
    '.tgu-ta{width:100%;min-height:300px;resize:vertical;font:.78rem/1.5 var(--mono,monospace);tab-size:4;white-space:pre}',
    '.tgu-msg{font-size:.7rem;padding:.4rem .55rem;border-radius:6px;margin:.35rem 0;border:1px solid #1e3058;background:#0a0e1a}',
    '.tgu-msg.er{border-color:#ff4466;color:#ffb3c0}.tgu-msg.ok{border-color:#00ff88;color:#aaffd0}.tgu-msg.wn{border-color:#ffd700;color:#ffe9a0}',
    '.tgu-help{font-size:.66rem;color:#8aa0c4;line-height:1.5}.tgu-help code{color:#50fa7b;font-family:var(--mono,monospace)}',
    '.tgu-list{display:flex;flex-direction:column;gap:.4rem}',
    '.tgu-item{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;border:1px solid #1a2a48;border-radius:8px;padding:.45rem .55rem;background:#0a0e1a}',
    '.tgu-item:hover{border-color:#3d5a8a}',
    '.tgu-sq{flex:none;width:38px;height:38px;border-radius:7px;background:#fff;color:#0a0e1a;border:2px solid #9aa7bd;display:flex;align-items:center;justify-content:center;font:800 .95rem var(--mono,monospace)}',
    '.tgu-item .meta{flex:1;min-width:150px}.tgu-item .meta b{font-size:.78rem}.tgu-item .meta small{display:block;color:#8aa0c4;font-size:.62rem}',
    '.tgu-item .act{display:flex;flex-wrap:wrap;gap:.25rem}.tgu-item .act .tgu-btn{padding:.28rem .45rem;font-size:.58rem}',
    '.tgu-mx{overflow:auto;border:1px solid #1a2a48;border-radius:8px;background:#060912;max-height:56vh}',
    '.tgu-mx table{border-collapse:collapse;font:.64rem var(--mono,monospace)}',
    '.tgu-mx td{padding:.2rem .45rem;border:1px solid #16213a;text-align:center;white-space:nowrap}',
    '.tgu-mx td.z{color:#3d5a8a}.tgu-mx th{color:#8aa0c4;font-weight:400;padding:.2rem .35rem;font-size:.56rem}',
    '.tgu-svg{background:#060912;border:1px solid #1a2a48;border-radius:8px;max-width:100%;overflow:auto}',
    '.tgu-hint{font-size:.62rem;color:#8aa0c4}'
  ].join('\n');
  function injectCSS() { if (doc.getElementById('tgu-css')) return; var s = doc.createElement('style'); s.id = 'tgu-css'; s.textContent = CSS; (doc.head || doc.documentElement).appendChild(s); }

  // ───────────── modal helper ─────────────
  function layer() { var l = doc.getElementById('tgu-layer'); if (!l) { l = doc.createElement('div'); l.id = 'tgu-layer'; doc.body.appendChild(l); } return l; }
  function paletteLeft() {
    try { if (root.innerWidth <= 760) return 8; var p = doc.querySelector('.palette'); if (p && p.offsetParent !== null) return Math.round(p.getBoundingClientRect().right + 12); } catch (_) {}
    return 8;
  }
  function modal(opt) {
    injectCSS();
    var m = doc.createElement('div'); m.className = 'tgu-modal ' + (opt.cls || ''); m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', opt.title || 'Theoretical gates');
    m.style.setProperty('--tgu-left', paletteLeft() + 'px');
    m.innerHTML = '<div class="tgu-h"><b></b><button class="tgu-x" aria-label="Close">✕</button></div><div class="tgu-b"></div><div class="tgu-f"></div>';
    m.querySelector('.tgu-h b').textContent = opt.title || '';
    var api = { el: m, body: m.querySelector('.tgu-b'), foot: m.querySelector('.tgu-f'), close: function () { if (opt.onClose && opt.onClose() === false) return; if (m.parentNode) m.parentNode.removeChild(m); api.closed = true; } };
    m.querySelector('.tgu-x').onclick = api.close;
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } });
    layer().appendChild(m);
    return api;
  }
  function btn(label, cls, fn) { var b = doc.createElement('button'); b.className = 'tgu-btn ' + (cls || ''); b.textContent = label; b.type = 'button'; if (fn) b.onclick = fn; return b; }

  // ───────────── panel section (Open Lab palette) ─────────────
  function tileHTML(g) {
    var ver = cat.version(g);
    var tip = g.name + ' · v' + g.current + ' · ' + (ver ? ver.nq : '?') + ' qubit' + (ver && ver.nq > 1 ? 's' : '');
    return '<div class="pal-gate tg-user" tabindex="0" role="button" draggable="true" data-gate="TG:' + esc(g.id) + '" data-tg="' + esc(g.id) + '" title="' + esc(tip) + '" aria-label="Theoretical gate ' + esc(g.name) + ' (' + esc(g.label) + '). Enter to select, right-click for details" ondragstart="onDragStartPalette(event)" ondragend="onDragEndPalette()"><span class="pal-gate-sym">' + esc(g.label) + '</span><span class="pal-gate-lbl">' + esc(g.name) + '</span></div>';
  }
  function renderPanel(container) {
    injectCSS();
    if (container && panels.indexOf(container) < 0) panels.push(container);
    panels.forEach(draw);
  }
  function draw(c) {
    var seen = {}, tiles = [];
    cat.recent(2).forEach(function (g) { seen[g.id] = 1; tiles.push(g); });
    cat.assigned().forEach(function (g) { if (!seen[g.id]) { seen[g.id] = 1; tiles.push(g); } });
    var html = '<div class="pal-sec-lbl">THEORETICAL GATES</div>' +
      '<button class="tgu-btn tgu-create pri" data-act="create">＋ Create Theoretical Gate</button><div class="pal-grid">' +
      tiles.map(tileHTML).join('') +
      '<button class="tg-plus" data-act="inventory" title="Open the full inventory of theoretical gates" aria-label="Open inventory">+</button>' +
      '<div class="pal-gate tg-u" tabindex="0" role="button" data-act="u" title="U gate — define a target operator and synthesize it from basic gates. Left click: configure · right click: matrix" aria-label="U gate: Enter to configure"><span class="pal-gate-sym">U</span><span class="pal-gate-lbl">synthesis</span></div>' +
      '</div>';
    c.className = 'pal-sec tgu-sec'; c.innerHTML = html;
  }
  function refreshPanels() { panels.forEach(draw); }
  function bindPanelEvents() {
    // delegated, so it survives re-rendering; capture phase so Architect's mobile "tap to arm" handler never sees the action buttons
    doc.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-act]'); if (!t || !t.closest('.tgu-sec')) return;
      e.stopPropagation(); e.preventDefault();
      var a = t.getAttribute('data-act');
      if (a === 'create') openEditor({}); else if (a === 'inventory') openInventory(); else if (a === 'u') { if (host.onUseU) host.onUseU('configure'); else note('The U gate is not available in this module yet.'); }
    }, true);
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target.closest && e.target.closest('.tgu-sec [data-act="u"]'); if (!t) return;
      e.stopPropagation(); e.preventDefault(); if (host.onUseU) host.onUseU('configure');
    }, true);
    doc.addEventListener('contextmenu', function (e) {
      var t = e.target.closest && e.target.closest('.tgu-sec .pal-gate, [data-tg]'); if (t) {
        e.preventDefault();
        if (t.getAttribute('data-act') === 'u') { if (host.onUseU) host.onUseU('matrix'); return; }
        var id = t.getAttribute('data-tg'); if (id) { openDetail(id); return; }
      }
      var b = e.target.closest && e.target.closest('#palette-body .pal-gate[data-gate]');
      if (b && !b.classList.contains('tg-user') && PAL[b.getAttribute('data-gate')]) { e.preventDefault(); showBasicMatrix(PAL[b.getAttribute('data-gate')]); }
    }, true);
    // long-press = right click on touch screens
    var timer = null, sx = 0, sy = 0;
    doc.addEventListener('touchstart', function (e) {
      var t = e.target.closest && e.target.closest('[data-tg], .tgu-sec [data-act="u"], #palette-body .pal-gate[data-gate]'); if (!t || !e.touches[0]) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(function () {
        timer = null; t.__tguLP = Date.now();
        var id = t.getAttribute('data-tg');
        if (id) openDetail(id);
        else if (t.getAttribute('data-act') === 'u') { if (host.onUseU) host.onUseU('matrix'); }
        else { var g = t.getAttribute('data-gate'); if (PAL[g]) showBasicMatrix(PAL[g]); }
      }, 550);
    }, { passive: true });
    doc.addEventListener('touchmove', function (e) { if (timer && e.touches[0] && (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10)) { clearTimeout(timer); timer = null; } }, { passive: true });
    ['touchend', 'touchcancel'].forEach(function (n) { doc.addEventListener(n, function () { if (timer) { clearTimeout(timer); timer = null; } }, { passive: true }); });
    doc.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tg],[data-gate]'); if (t && t.__tguLP && Date.now() - t.__tguLP < 700) { e.stopPropagation(); e.preventDefault(); } }, true);
    root.addEventListener('storage', function (e) { if (e.key === TG.STORE_KEY) { cat.reload(); } });
    cat.on(function (type) { if (type === 'change') { refreshPanels(); if (host.onChange) { try { host.onChange(); } catch (_) {} } } else if (type === 'error') note('⚠️ ' + cat.lastError); });
  }

  // ───────────── matrix viewer ─────────────
  function matrixHTML(U, maxShow) {
    if (U.n > (maxShow || 4)) return '<div class="tgu-msg wn">This is a ' + U.dim + '×' + U.dim + ' matrix (' + (U.dim * U.dim) + ' complex entries) — too large to display. Unitarity error ‖U†U−I‖∞ = ' + TG.unitaryError(U).toExponential(2) + '.</div>';
    var rows = TG.matrixToText(U, 4), d = U.dim, h = '<div class="tgu-mx"><table><tr><th></th>';
    for (var j = 0; j < d; j++) h += '<th>|' + j.toString(2).padStart(U.n, '0') + '⟩</th>';
    h += '</tr>';
    rows.forEach(function (r, i) { h += '<tr><th>|' + i.toString(2).padStart(U.n, '0') + '⟩</th>' + r.map(function (c) { return '<td class="' + (c === '0' ? 'z' : '') + '">' + esc(c) + '</td>'; }).join('') + '</tr>'; });
    return h + '</table></div>';
  }
  function showMatrixModal(title, getU, extraNote) {
    var m = modal({ title: title, cls: 'sm' }), U;
    try { U = getU(); } catch (e) { m.body.innerHTML = '<div class="tgu-msg er">' + esc(e.message || e) + '</div>'; m.foot.appendChild(btn('Close', '', m.close)); return m; }
    var err = TG.unitaryError(U);
    m.body.innerHTML = '<div class="tgu-hint" style="margin-bottom:.4rem">Basis order |q<sub>n−1</sub>…q<sub>0</sub>⟩ (q0 is the rightmost bit, Qiskit convention). Rows = output, columns = input.</div>' + matrixHTML(U) +
      (err > 1e-6 ? '<div class="tgu-msg wn">This matrix is not unitary (error ' + err.toExponential(2) + ').</div>' : '<div class="tgu-hint" style="margin-top:.4rem">Unitary check: ‖U†U−I‖∞ = ' + err.toExponential(1) + '</div>') + (extraNote ? '<div class="tgu-hint">' + extraNote + '</div>' : '');
    m.foot.appendChild(btn('Copy LaTeX', '', function () { copy(TG.matrixToLatex(U, 4)); }));
    m.foot.appendChild(btn('Copy as text', '', function () { copy(TG.matrixToText(U, 6).map(function (r) { return r.join('\t'); }).join('\n')); }));
    var sp = doc.createElement('span'); sp.className = 'sp'; m.foot.appendChild(sp); m.foot.appendChild(btn('Close', '', m.close));
    return m;
  }
  function showBasicMatrix(name, params) {
    var info = TG.basicInfo(name); if (!info) { note('No matrix is available for this gate.'); return; }
    var p = []; for (var i = 0; i < info.p; i++) p.push(params && params[i] != null ? params[i] : Math.PI / 4);
    showMatrixModal('Matrix of ' + info.name.toUpperCase() + (info.p ? '(' + p.map(function (x) { return (+x).toFixed(4); }).join(', ') + ')' : ''), function () { return TG.matrixOfBasic(info.name, p); }, info.p ? 'Parameters shown with their default value π/4; the placed gate uses its own angle.' : '');
  }

  // ───────────── circuit drawing (static, for the detail view) ─────────────
  function circuitSVG(ver, labelOf) {
    var n = ver.nq, ops = ver.ops, colW = 54, rowH = 40, left = 40, w = left + (ops.length + 1) * colW, h = n * rowH + 10, s = '<svg class="tgu-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Inner circuit">';
    for (var q = 0; q < n; q++) { var y = q * rowH + 22; s += '<text x="4" y="' + (y + 4) + '" fill="#8aa0c4" font-size="10" font-family="monospace">q[' + q + ']</text><line x1="' + left + '" y1="' + y + '" x2="' + (w - 6) + '" y2="' + y + '" stroke="#3d5a8a"/>'; }
    ops.forEach(function (op, i) {
      var x = left + i * colW + 10, ys = op.q.map(function (q) { return q * rowH + 22; }), lab = labelOf(op);
      if (op.q.length > 1) s += '<line x1="' + (x + 17) + '" y1="' + Math.min.apply(null, ys) + '" x2="' + (x + 17) + '" y2="' + Math.max.apply(null, ys) + '" stroke="#8aa0c4"/>';
      op.q.forEach(function (q, k) {
        var y = q * rowH + 22, nested = op.g.charAt(0) === '@', ctl = !nested && op.q.length > 1 && lab.ctl && lab.ctl.indexOf(k) >= 0;
        if (ctl) s += '<circle cx="' + (x + 17) + '" cy="' + y + '" r="4" fill="#dce8ff"/>';
        else s += '<rect x="' + x + '" y="' + (y - 13) + '" width="34" height="26" rx="4" fill="' + (nested ? '#fff' : '#1a5fb4') + '" stroke="' + (nested ? '#9aa7bd' : 'rgba(255,255,255,.4)') + '"/><text x="' + (x + 17) + '" y="' + (y + 4) + '" text-anchor="middle" font-size="11" font-weight="700" font-family="monospace" fill="' + (nested ? '#0a0e1a' : '#fff') + '">' + esc(op.q.length > 1 && !nested && !lab.all ? (lab.t) : lab.t) + (op.q.length > 1 && nested ? '<tspan font-size="7" dy="6">' + (k + 1) + '</tspan>' : '') + '</text>';
      });
    });
    return s + '</svg>';
  }
  function opLabel(op) {
    if (op.g.charAt(0) === '@') { var g = cat.get(op.g.slice(1)); return { t: g ? g.label : '?', all: true }; }
    var n = op.g, info = TG.basicInfo(n); var ctl = [];
    if (n === 'cx' || n === 'cy' || n === 'cz' || n === 'ch' || n === 'cp' || n === 'crx' || n === 'cry' || n === 'crz') ctl = [0];
    if (n === 'ccx' || n === 'ccz') ctl = [0, 1]; if (n === 'cswap') ctl = [0];
    var t = n === 'cx' || n === 'ccx' ? 'X' : n === 'cz' || n === 'ccz' ? 'Z' : n === 'cy' ? 'Y' : n === 'ch' ? 'H' : n === 'cp' ? 'P' : n === 'crx' ? 'Rx' : n === 'cry' ? 'Ry' : n === 'crz' ? 'Rz' : n === 'cswap' ? '×' : n === 'swap' ? '×' : (SYM[n] || n.toUpperCase());
    return { t: t, ctl: ctl, info: info };
  }

  // ───────────── detail view ─────────────
  function openDetail(id, version) {
    var g = cat.get(id); if (!g) { note('This gate is not in the local catalog (it may have been deleted).'); return; }
    var m = modal({ title: g.name + ' · ' + g.label, cls: 'mid' }), vnum = version || g.current;
    function paint() {
      var ver = cat.version(g, vnum), p = ver.params;
      var h = '<div class="tgu-row"><span class="tgu-lbl">VERSION</span><select class="tgu-in" id="d-v">' + g.versions.map(function (v) { return '<option value="' + v.v + '"' + (v.v === vnum ? ' selected' : '') + '>v' + v.v + (v.v === g.current ? ' (current)' : '') + '</option>'; }).join('') + '</select>' +
        '<span class="tgu-chip ' + ver.status + '">' + esc(ver.status) + '</span>' + (g.archived ? '<span class="tgu-chip arch">archived</span>' : '') + '<span class="tgu-hint">' + ver.nq + ' qubit' + (ver.nq > 1 ? 's' : '') + ' · ' + ver.ops.length + ' operation' + (ver.ops.length === 1 ? '' : 's') + ' · modified ' + esc(when(g.modified)) + '</span></div>';
      h += '<div class="tgu-hint" style="margin-bottom:.4rem">' + esc(ver.statusMsg || '') + (g.forkedFrom ? ' · duplicated from another gate' : '') + '</div>';
      h += '<div class="tgu-lbl" style="margin:.3rem 0">INNER CIRCUIT</div><div style="overflow:auto">' + circuitSVG(ver, opLabel) + '</div>';
      h += '<div class="tgu-lbl" style="margin:.6rem 0 .3rem">OPERATIONS (in order)</div><table class="tgu-ops"><tr><th>#</th><th>Gate</th><th>Qubits</th><th>Parameters</th></tr>' +
        ver.ops.map(function (o, i) { var nm = o.g.charAt(0) === '@' ? (function () { var x = cat.get(o.g.slice(1)); return x ? esc(x.name) + ' (' + esc(x.label) + ' v' + o.v + ')' : '<i>missing gate</i>'; })() : esc(o.g); return '<tr><td>' + (i + 1) + '</td><td>' + nm + '</td><td>' + esc(o.q.join(', ')) + '</td><td>' + esc((o.p || []).join(', ')) + '</td></tr>'; }).join('') + '</table>';
      if (p.length) h += '<div class="tgu-hint" style="margin-top:.4rem">Parameters: ' + p.map(function (x) { return esc(x.name) + ' = ' + esc(x.def); }).join(', ') + '</div>';
      var deps = cat.dependents(id); if (deps.gates.length || deps.circuits.length) h += '<div class="tgu-hint" style="margin-top:.3rem">Used by: ' + deps.gates.map(function (x) { return esc(x.name); }).concat(deps.circuits.map(function (x) { return 'circuit “' + esc(x.name) + '”'; })).join(', ') + '</div>';
      h += '<div class="tgu-lbl" style="margin:.7rem 0 .3rem">RESULTING MATRIX</div><div id="d-mx"></div>';
      m.body.innerHTML = h;
      var mx = m.body.querySelector('#d-mx');
      try { var env = {}; p.forEach(function (x) { env[x.name] = +x.def; }); var U = TG.buildUnitary(ver, env, cat); var err = TG.unitaryError(U); mx.innerHTML = matrixHTML(U) + (err > 1e-6 ? '<div class="tgu-msg wn">Not unitary (error ' + err.toExponential(2) + ') — the matrix is shown as computed, not corrected.</div>' : '<div class="tgu-hint">Composition order: U = B·A (the first operation is applied first). Unitary check ' + err.toExponential(1) + '.</div>'); mx.__U = U; }
      catch (e) { mx.innerHTML = '<div class="tgu-msg wn">' + esc(e.message || e) + '</div>'; }
      m.body.querySelector('#d-v').onchange = function () { vnum = +this.value; paint(); };
      m.foot.innerHTML = '';
      m.foot.appendChild(btn('Use', 'pri', function () { useGate(g); }));
      m.foot.appendChild(btn('Edit', '', function () { m.close(); openEditor({ id: id, version: vnum }); }));
      if (mx.__U) { m.foot.appendChild(btn('Copy LaTeX', '', function () { copy(TG.matrixToLatex(mx.__U, 4)); })); }
      var sp = doc.createElement('span'); sp.className = 'sp'; m.foot.appendChild(sp); m.foot.appendChild(btn('Close', '', m.close));
    }
    paint(); return m;
  }
  function useGate(g) { cat.touch(g.id); if (host.useGate) host.useGate(g); else note('Gate ' + g.label + ' selected'); }

  // ───────────── editor ─────────────
  function openEditor(opt) {
    var existing = opt.id ? cat.get(opt.id) : null, base = existing ? cat.version(existing, opt.version) : null;
    var S = {
      name: existing ? existing.name : '', nq: base ? base.nq : 2, params: base ? base.params.map(function (p) { return { name: p.name, def: p.def }; }) : [],
      ops: base ? base.ops.map(function (o) { return { g: o.g, v: o.v, q: o.q.slice(), p: (o.p || []).slice() }; }) : [], mode: 'visual', py: '', armed: null, undo: [], redo: [], dirty: false,
      hasLoops: !!(base && base.pythonOnly)
    };
    if (opt.preset) { S.name = opt.preset.name || S.name; S.nq = opt.preset.nq || S.nq; S.ops = opt.preset.ops || S.ops; S.params = opt.preset.params || S.params; S.dirty = true; }
    if (base && base.source === 'python' && base.pyText) { S.py = base.pyText; }
    var m = modal({ title: existing ? 'Edit theoretical gate' : 'Create theoretical gate', onClose: function () { if (S.dirty && !S.saved && !root.confirm('Discard your unsaved changes?')) return false; } });
    m.body.innerHTML =
      '<div class="tgu-row"><span class="tgu-lbl">NAME</span><input id="e-name" class="tgu-in" maxlength="48" placeholder="e.g. Fourier 2q" style="flex:1;min-width:140px" aria-label="Gate name">' +
      '<span class="tgu-lbl">QUBITS</span><input id="e-nq" class="tgu-in" type="number" min="1" max="20" style="width:64px" aria-label="Number of qubits">' +
      '<div class="tgu-seg" role="group" aria-label="Editor mode"><button id="e-mv" class="on">Visual Circuit</button><button id="e-mp">Python Editor</button></div></div>' +
      '<div id="e-params" class="tgu-row"></div><div id="e-main"></div><div id="e-msg"></div>';
    var nameIn = m.body.querySelector('#e-name'), nqIn = m.body.querySelector('#e-nq'), main = m.body.querySelector('#e-main'), msg = m.body.querySelector('#e-msg');
    nameIn.value = S.name; nqIn.value = S.nq;
    function say(text, cls) { msg.innerHTML = text ? '<div class="tgu-msg ' + (cls || '') + '">' + text + '</div>' : ''; }
    function snap() { return JSON.stringify({ name: S.name, nq: S.nq, params: S.params, ops: S.ops, py: S.py }); }
    function pushUndo() { S.undo.push(snap()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; S.dirty = true; refreshUR(); }
    function restore(js) { var o = JSON.parse(js); S.name = o.name; S.nq = o.nq; S.params = o.params; S.ops = o.ops; S.py = o.py; nameIn.value = S.name; nqIn.value = S.nq; paintAll(); }
    var bUndo = btn('Undo', '', function () { if (!S.undo.length) return; S.redo.push(snap()); restore(S.undo.pop()); refreshUR(); }),
      bRedo = btn('Redo', '', function () { if (!S.redo.length) return; S.undo.push(snap()); restore(S.redo.pop()); refreshUR(); });
    function refreshUR() { bUndo.disabled = !S.undo.length; bRedo.disabled = !S.redo.length; }
    nameIn.oninput = function () { S.name = nameIn.value; S.dirty = true; };
    nqIn.onchange = function () { var v = Math.max(1, Math.min(20, Math.floor(+nqIn.value) || 1)); if (v < S.nq) { var bad = S.ops.some(function (o) { return o.q.some(function (q) { return q >= v; }); }); if (bad) { say('Some operations use qubit ' + (v) + ' or higher. Remove or move them before reducing the qubit count.', 'er'); nqIn.value = S.nq; return; } } pushUndo(); S.nq = v; nqIn.value = v; paintAll(); say(''); };

    function paramsUI() {
      var box = m.body.querySelector('#e-params'); box.innerHTML = '<span class="tgu-lbl">PARAMETERS</span>';
      S.params.forEach(function (p, i) {
        var w = doc.createElement('span'); w.className = 'tgu-row'; w.style.margin = '0';
        w.innerHTML = '<input class="tgu-in" style="width:80px" value="' + esc(p.name) + '" aria-label="Parameter name"><span class="tgu-hint">=</span><input class="tgu-in" style="width:70px" value="' + esc(p.def) + '" aria-label="Default value"><button class="tgu-x" aria-label="Remove parameter" style="min-width:24px">✕</button>';
        var ins = w.querySelectorAll('input');
        ins[0].onchange = function () { pushUndo(); S.params[i].name = ins[0].value.trim(); paintOps(); };
        ins[1].onchange = function () { pushUndo(); S.params[i].def = parseFloat(ins[1].value) || 0; };
        w.querySelector('button').onclick = function () { pushUndo(); S.params.splice(i, 1); paramsUI(); paintOps(); };
        box.appendChild(w);
      });
      var add = btn('+ parameter', '', function () { pushUndo(); var k = 1; while (S.params.some(function (p) { return p.name === 'theta' + (k > 1 ? k : ''); })) k++; S.params.push({ name: 'theta' + (k > 1 ? k : ''), def: 0 }); paramsUI(); });
      box.appendChild(add);
      if (S.params.length) { var h = doc.createElement('span'); h.className = 'tgu-hint'; h.textContent = 'Use a parameter in any angle field, e.g. theta/2 or 2*pi/3.'; box.appendChild(h); }
    }

    // ----- visual mode -----
    function insertOp(tok, qubit, col) {
      var op;
      if (/^TG:/.test(tok)) {
        var g = cat.get(tok.slice(3)); if (!g) { say('That theoretical gate no longer exists.', 'er'); return; }
        if (existing && g.id === existing.id) { say('A gate cannot contain itself.', 'er'); return; }
        var v = cat.version(g); op = { g: '@' + g.id, v: v.v, q: [], p: v.params.map(function (p) { return String(p.def); }) }; op._n = v.nq;
      } else {
        var bn = basicName(tok); if (!bn) { say('“' + esc(tok) + '” cannot be used inside a theoretical gate (measurements and resets are not unitary).', 'er'); return; }
        var info = TG.basicInfo(bn); op = { g: info.name, q: [], p: []}; for (var i = 0; i < info.p; i++) op.p.push(defParam(info.name)); op._n = info.n;
      }
      var k = op._n; delete op._n;
      if (k > S.nq) { if (k > 20) return; S.nq = k; nqIn.value = k; say('Qubit count increased to ' + k + ' for this gate.', 'wn'); }
      var start = Math.max(0, Math.min(qubit, S.nq - k)); for (var j = 0; j < k; j++) op.q.push(start + j);
      pushUndo(); if (S.ops.length >= TG.MAX_OPS) { say('Limit of ' + TG.MAX_OPS + ' operations reached.', 'er'); return; }
      var at = col == null || col > S.ops.length ? S.ops.length : col; S.ops.splice(at, 0, op); paintOps();
    }
    function gridHTML() {
      var h = '<div class="tgu-grid"><table role="grid" aria-label="Circuit"><tbody>';
      for (var q = 0; q < S.nq; q++) {
        h += '<tr><td class="ql">q[' + q + ']</td>';
        for (var c = 0; c <= S.ops.length; c++) {
          var op = S.ops[c], inner = '';
          if (op) { var k = op.q.indexOf(q); if (k >= 0) { var lab = opLabel(op), nested = op.g.charAt(0) === '@'; inner = (!nested && lab.ctl && lab.ctl.indexOf(k) >= 0) ? '<span class="tgu-g ctl" title="control"></span>' : '<span class="tgu-g' + (nested ? ' tg' : '') + '" title="' + esc(nested ? (cat.get(op.g.slice(1)) || {}).name : op.g) + (op.q.length > 1 ? ' (qubit #' + (k + 1) + ')' : '') + '">' + esc(lab.t) + (op.q.length > 1 && (nested || !lab.ctl.length) ? '<sub>' + (k + 1) + '</sub>' : '') + '</span>'; } }
          h += '<td class="w" data-q="' + q + '" data-c="' + c + '">' + inner + '</td>';
        }
        h += '</tr>';
      }
      return h + '</tbody></table></div>';
    }
    function trayHTML() {
      var h = '<div class="tgu-lbl" style="margin-bottom:.25rem">GATES — drag onto a wire (you can also drag from the general gates panel), or tap a gate and then tap a wire</div><div class="tgu-tray">';
      TRAY.forEach(function (t) { h += '<button data-tok="' + t + '" class="' + (S.armed === t ? 'sel' : '') + '" draggable="true" title="' + esc(PAL[t]) + '">' + (SYM[PAL[t]] || t) + '</button>'; });
      var seen = {}; cat.recent(6).concat(cat.assigned()).forEach(function (g) { if (seen[g.id] || (existing && g.id === existing.id) || g.archived) return; seen[g.id] = 1; h += '<button class="tg ' + (S.armed === 'TG:' + g.id ? 'sel' : '') + '" data-tok="TG:' + esc(g.id) + '" draggable="true" title="' + esc(g.name) + '">' + esc(g.label) + '</button>'; });
      return h + '</div>';
    }
    function opsTableHTML() {
      if (!S.ops.length) return '<div class="tgu-hint">No operations yet. Add gates from the tray above — the order of the columns is the order of execution.</div>';
      var h = '<table class="tgu-ops"><tr><th>#</th><th>Gate</th><th>Qubits (comma separated)</th><th>Parameters</th><th></th></tr>';
      S.ops.forEach(function (o, i) {
        var nested = o.g.charAt(0) === '@', gg = nested ? cat.get(o.g.slice(1)) : null, nm = nested ? esc(gg ? gg.label + ' v' + o.v : 'missing') : esc(o.g);
        h += '<tr data-i="' + i + '"><td>' + (i + 1) + '</td><td>' + nm + '</td><td><input class="tgu-in" data-f="q" value="' + esc(o.q.join(', ')) + '" aria-label="Qubits of operation ' + (i + 1) + '"></td><td>' +
          (o.p || []).map(function (x, k) { return '<input class="tgu-in" data-f="p" data-k="' + k + '" style="width:92px;margin-right:3px" value="' + esc(x) + '" aria-label="Parameter ' + (k + 1) + ' of operation ' + (i + 1) + '">'; }).join('') +
          '</td><td style="white-space:nowrap"><button class="tgu-x" data-f="up" aria-label="Move up">▲</button><button class="tgu-x" data-f="dn" aria-label="Move down">▼</button><button class="tgu-x" data-f="rm" aria-label="Delete operation">✕</button></td></tr>';
      });
      return h + '</table>';
    }
    function paintOps() {
      var g = main.querySelector('#v-grid'), t = main.querySelector('#v-ops'); if (!g) return;
      g.innerHTML = gridHTML(); t.innerHTML = opsTableHTML(); bindGrid();
    }
    function bindGrid() {
      main.querySelectorAll('.tgu-grid td.w').forEach(function (td) {
        var q = +td.dataset.q, c = +td.dataset.c;
        td.ondragover = function (e) { e.preventDefault(); td.classList.add('hov'); }; td.ondragleave = function () { td.classList.remove('hov'); };
        td.ondrop = function (e) { e.preventDefault(); e.stopPropagation(); td.classList.remove('hov'); var tok = e.dataTransfer.getData('text/plain'); if (tok) insertOp(tok, q, c); };
        td.onclick = function () { if (S.armed) insertOp(S.armed, q, c); };
      });
      main.querySelectorAll('#v-ops tr[data-i]').forEach(function (tr) {
        var i = +tr.dataset.i;
        tr.querySelectorAll('input[data-f="q"]').forEach(function (inp) { inp.onchange = function () {
          var arr = inp.value.split(/[ ,]+/).filter(Boolean).map(Number), o = S.ops[i];
          if (arr.length !== o.q.length || arr.some(function (x) { return !Number.isInteger(x) || x < 0 || x >= S.nq; }) || new Set(arr).size !== arr.length) { say('Operation ' + (i + 1) + ' needs ' + o.q.length + ' different qubit(s) between 0 and ' + (S.nq - 1) + '.', 'er'); inp.value = o.q.join(', '); return; }
          pushUndo(); o.q = arr; say(''); paintOps(); }; });
        tr.querySelectorAll('input[data-f="p"]').forEach(function (inp) { inp.onchange = function () {
          var t = inp.value.trim(); try { var ast = TG.parseExpr(t); var vars = []; (function walk(a) { if (!a) return; if (a.t === 'var') vars.push(a.n); ['a', 'b'].forEach(function (k) { if (a[k]) walk(a[k]); }); if (a.args) a.args.forEach(walk); })(ast); var known = {}; S.params.forEach(function (p) { known[p.name] = 1; });
            var unk = vars.filter(function (v) { return !known[v] && !/^(pi|tau|e)$/.test(v); }); if (unk.length) throw new Error('Unknown name “' + unk[0] + '”. Declare it as a parameter first.'); }
          catch (e) { say('Parameter of operation ' + (i + 1) + ': ' + esc(e.message || e), 'er'); inp.value = S.ops[i].p[+inp.dataset.k]; return; }
          pushUndo(); S.ops[i].p[+inp.dataset.k] = t; say(''); }; });
        tr.querySelectorAll('button').forEach(function (b) { b.onclick = function () { var f = b.dataset.f; pushUndo(); if (f === 'rm') S.ops.splice(i, 1); else if (f === 'up' && i > 0) { var t = S.ops[i]; S.ops[i] = S.ops[i - 1]; S.ops[i - 1] = t; } else if (f === 'dn' && i < S.ops.length - 1) { var t2 = S.ops[i]; S.ops[i] = S.ops[i + 1]; S.ops[i + 1] = t2; } paintOps(); }; });
      });
    }
    function paintVisual() {
      main.innerHTML = trayHTML() + '<div id="v-grid"></div><div id="v-ops"></div>' + (S.hasLoops ? '<div class="tgu-msg wn">This gate was written in Python. The visual view shows the expanded sequence; edit loops in the Python editor.</div>' : '');
      main.querySelectorAll('.tgu-tray button').forEach(function (b) {
        b.onclick = function () { S.armed = S.armed === b.dataset.tok ? null : b.dataset.tok; main.querySelectorAll('.tgu-tray button').forEach(function (x) { x.classList.toggle('sel', x.dataset.tok === S.armed); }); };
        b.ondragstart = function (e) { e.dataTransfer.setData('text/plain', b.dataset.tok); };
      });
      paintOps();
    }
    // ----- python mode -----
    var HELP = '<div class="tgu-help"><b>Python editor — safe subset.</b> Allowed: <code>qc.h(0)</code>, <code>qc.cx(0, 1)</code>, <code>qc.rz(theta/2, 1)</code>, theoretical gates <code>qc.F(0.3, 0, 1)</code> (or pinned <code>qc.F_v1(…)</code>) and <code>for i in range(n):</code> loops, with angles built from numbers, <code>pi</code>, your parameters, + − × ÷ ** and sin/cos/sqrt… Parameters come first, then qubits. Nothing else is executed — no imports of modules, files, network or <code>eval</code>.</div>';
    function paintPython() {
      main.innerHTML = '<textarea id="p-ta" class="tgu-in tgu-ta" spellcheck="false" aria-label="Python editor"></textarea>' + HELP;
      var ta = main.querySelector('#p-ta'); ta.value = S.py || TG.pyFromOps({ ops: S.ops }, cat);
      ta.oninput = function () { S.py = ta.value; S.dirty = true; };
      ta.onkeydown = function (e) { if (e.key === 'Tab') { e.preventDefault(); var s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; S.py = ta.value; } };
      ta.onchange = function () { pushUndo(); };
    }
    function parsePy() { return TG.parsePython(S.py, { catalog: cat, selfId: existing ? existing.id : null, nq: S.nq, params: S.params }); }
    function reportPyErrors(r) { say('<b>Python not valid</b><br>' + r.errors.slice(0, 8).map(function (e) { return 'Line ' + e.line + ': ' + esc(e.message); }).join('<br>'), 'er'); }
    function setMode(mode) {
      if (mode === S.mode) return;
      if (mode === 'python') { S.py = S.py && !S.dirtyVisual ? S.py : TG.pyFromOps({ ops: S.ops }, cat); S.mode = 'python'; S.dirtyVisual = false; }
      else {
        var r = parsePy(); if (!r.ok) { reportPyErrors(r); return; }
        S.hasLoops = /^\s*for\s/m.test(S.py); S.ops = r.ops; if (r.nq && r.nq !== S.nq) { S.nq = r.nq; nqIn.value = S.nq; } S.mode = 'visual';
      }
      m.body.querySelector('#e-mv').classList.toggle('on', S.mode === 'visual'); m.body.querySelector('#e-mp').classList.toggle('on', S.mode === 'python');
      say(''); paintAll();
    }
    m.body.querySelector('#e-mv').onclick = function () { setMode('visual'); };
    m.body.querySelector('#e-mp').onclick = function () { setMode('python'); };
    function paintAll() { paramsUI(); if (S.mode === 'python') paintPython(); else paintVisual(); }

    function payload() {
      var ops = S.ops, nq = S.nq, pyText = S.py, source = 'visual';
      if (S.mode === 'python') { var r = parsePy(); if (!r.ok) { reportPyErrors(r); return null; } ops = r.ops; nq = r.nq || S.nq; source = 'python'; S.hasLoops = /^\s*for\s/m.test(S.py); }
      return { name: S.name.trim(), nq: nq, params: S.params, ops: ops, pyText: source === 'python' ? pyText : '', source: source, pythonOnly: source === 'python' && S.hasLoops };
    }
    function validate() {
      var p = payload(); if (!p) return null;
      var nameErr = TG.validName(p.name); var chk = TG.validateDefinition(p, cat, existing ? existing.id : null);
      var text = (nameErr ? esc(nameErr) + '<br>' : '') + esc(chk.message);
      say('<b>' + (chk.state === 'valid' ? 'Valid' : chk.state === 'invalid' ? 'Invalid' : 'Not verified') + '</b> — ' + text + (p.ops.length ? '' : '<br>The gate has no operations (it is the identity).'), chk.state === 'valid' && !nameErr ? 'ok' : chk.state === 'invalid' || nameErr ? 'er' : 'wn');
      return { p: p, chk: chk, nameErr: nameErr };
    }
    function preview() {
      var p = payload(); if (!p) return;
      var env = {}; p.params.forEach(function (x) { env[x.name] = +x.def || 0; });
      var chk = TG.validateDefinition(p, cat, existing ? existing.id : null);
      if (chk.state === 'invalid' && chk.fatal) { say('Cannot compute the matrix: ' + esc(chk.message), 'er'); return; }
      showMatrixModal('Matrix preview · ' + (p.name || 'untitled'), function () { return TG.buildUnitary({ nq: p.nq, ops: p.ops, params: p.params }, env, cat); }, p.params.length ? 'Computed with the default parameter values.' : '');
    }
    function save() {
      var v = validate(); if (!v) return;
      if (v.nameErr) return; if (v.chk.state === 'invalid' && v.chk.fatal) return;
      function done(r, what) {
        if (!r.ok) { say(esc(r.error || 'Could not save.'), 'er'); return; }
        S.saved = true; note('✅ ' + what + ': ' + r.gate.name + ' (' + r.gate.label + ')' + (r.pinned ? ' · ' + r.pinned + ' saved circuit(s) pinned to the old version' : '')); m.close(); refreshPanels();
        if (opt.onSaved) opt.onSaved(r.gate);
      }
      if (!existing) { done(cat.create(v.p), 'Saved'); return; }
      var q = modal({ title: 'Save changes to ' + existing.name, cls: 'sm' });
      q.body.innerHTML = '<p style="font-size:.78rem;line-height:1.5">Version <b>v' + existing.current + '</b> is the current one. Circuits that use it without a pinned version will follow whichever you choose.</p><div class="tgu-hint">“New version” keeps v' + existing.current + ' untouched and pins unversioned references in your saved circuits to it, so their behavior does not change.</div>';
      q.foot.appendChild(btn('Save as new version (v' + (Math.max.apply(null, existing.versions.map(function (x) { return x.v; })) + 1) + ')', 'pri', function () { q.close(); done(cat.update(existing.id, v.p, 'version'), 'New version saved'); }));
      q.foot.appendChild(btn('Overwrite v' + existing.current, '', function () { q.close(); done(cat.update(existing.id, v.p, 'overwrite'), 'Updated'); }));
      var sp = doc.createElement('span'); sp.className = 'sp'; q.foot.appendChild(sp); q.foot.appendChild(btn('Cancel', '', q.close));
    }
    m.foot.appendChild(btn('Save', 'pri', save)); m.foot.appendChild(btn('Cancel', '', m.close)); m.foot.appendChild(btn('Validate', '', validate)); m.foot.appendChild(btn('Preview Matrix', '', preview));
    m.foot.appendChild(bUndo); m.foot.appendChild(bRedo);
    var sp2 = doc.createElement('span'); sp2.className = 'sp'; m.foot.appendChild(sp2);
    var hint = doc.createElement('span'); hint.className = 'tgu-hint'; hint.textContent = 'Unitary gates only — no measurement or reset.'; m.foot.appendChild(hint);
    refreshUR(); paintAll(); setTimeout(function () { nameIn.focus(); }, 30);
    return m;
  }

  // ───────────── inventory ─────────────
  function openInventory() {
    var m = modal({ title: 'Theoretical gates — inventory', cls: 'mid' }), F = { q: '', f: 'all' };
    m.body.innerHTML = '<div class="tgu-row"><input id="i-q" class="tgu-in" placeholder="Search by name, symbol or qubit count…" style="flex:1;min-width:160px" aria-label="Search"><div class="tgu-seg" id="i-f" role="group" aria-label="Filter">' +
      ['all|All', 'valid|Valid', 'invalid|Needs attention', 'assigned|In panel', 'archived|Archived'].map(function (x) { var a = x.split('|'); return '<button data-f="' + a[0] + '"' + (a[0] === 'all' ? ' class="on"' : '') + '>' + a[1] + '</button>'; }).join('') + '</div></div><div id="i-list" class="tgu-list"></div>';
    var list = m.body.querySelector('#i-list');
    function match(g) {
      var ver = cat.version(g), q = F.q.trim().toLowerCase();
      if (q && (g.name + ' ' + g.label + ' ' + ver.nq + 'q ' + ver.nq + ' qubits').toLowerCase().indexOf(q) < 0) return false;
      if (F.f === 'archived') return g.archived; if (g.archived) return false;
      if (F.f === 'valid') return ver.status === 'valid'; if (F.f === 'invalid') return ver.status !== 'valid';
      if (F.f === 'assigned') return cat.mem.assigned.indexOf(g.id) >= 0; return true;
    }
    function paint() {
      var items = cat.list({ archived: true }).filter(match);
      if (!items.length) { list.innerHTML = '<div class="tgu-hint" style="padding:1rem">' + (cat.list({ archived: true }).length ? 'No gates match this search.' : 'You have no theoretical gates yet. Press “Create Theoretical Gate” to make your first one.') + '</div>'; return; }
      list.innerHTML = '';
      items.forEach(function (g) {
        var ver = cat.version(g), row = doc.createElement('div'); row.className = 'tgu-item'; var asg = cat.mem.assigned.indexOf(g.id) >= 0;
        row.innerHTML = '<div class="tgu-sq" title="' + esc(g.name) + '">' + esc(g.label) + '</div><div class="meta"><b>' + esc(g.name) + '</b><small>' + ver.nq + ' qubit' + (ver.nq > 1 ? 's' : '') + ' · v' + g.current + (g.versions.length > 1 ? ' of ' + g.versions.length : '') + ' · ' + ver.ops.length + ' ops · ' + esc(when(g.modified)) + '</small>' +
          '<span class="tgu-chip ' + ver.status + '" title="' + esc(ver.statusMsg || '') + '">' + ver.status + '</span> ' + (g.archived ? '<span class="tgu-chip arch">archived</span> ' : '') + (asg ? '<span class="tgu-chip arch">in panel</span>' : '') + '</div><div class="act"></div>';
        var act = row.querySelector('.act');
        function add(label, cls, fn) { act.appendChild(btn(label, cls, fn)); }
        if (!g.archived) { add('Use', 'pri', function () { useGate(g); }); add(asg ? 'Remove from panel' : 'Assign to General Gates', '', function () { cat.assign(g.id, !asg); paint(); note(asg ? 'Shortcut removed from the panel' : 'Shortcut added to the general gates panel'); }); }
        add('Edit', '', function () { openEditor({ id: g.id }); });
        if (!g.archived) { add('Duplicate', '', function () { var nm = root.prompt('Name of the copy:', g.name + ' copy'); if (nm == null) return; var r = cat.duplicate(g.id, nm); if (!r.ok) note('⚠️ ' + r.error); else { note('Copy created: ' + r.gate.label); paint(); } });
          add('Create Version', '', function () { openEditor({ id: g.id }); }); }
        add('View Circuit', '', function () { openDetail(g.id); });
        if (g.archived) add('Restore', '', function () { cat.archive(g.id, false); paint(); });
        add('Delete', 'dng', function () { askDelete(g, paint); });
        row.oncontextmenu = function (e) { e.preventDefault(); openDetail(g.id); };
        var lp = null; row.addEventListener('touchstart', function () { lp = setTimeout(function () { openDetail(g.id); }, 550); }, { passive: true }); ['touchend', 'touchmove', 'touchcancel'].forEach(function (n) { row.addEventListener(n, function () { clearTimeout(lp); }, { passive: true }); });
        list.appendChild(row);
      });
    }
    m.body.querySelector('#i-q').oninput = function () { F.q = this.value; paint(); };
    m.body.querySelectorAll('#i-f button').forEach(function (b) { b.onclick = function () { F.f = b.dataset.f; m.body.querySelectorAll('#i-f button').forEach(function (x) { x.classList.toggle('on', x === b); }); paint(); }; });
    m.foot.appendChild(btn('＋ Create Theoretical Gate', 'pri', function () { openEditor({}); }));
    m.foot.appendChild(btn('Export JSON', '', function () {
      try { var blob = new Blob([cat.exportJSON()], { type: 'application/json' }), a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'quolab-theoretical-gates.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); } catch (e) { note('Export failed: ' + e.message); } }));
    var imp = doc.createElement('input'); imp.type = 'file'; imp.accept = 'application/json,.json'; imp.style.display = 'none';
    imp.onchange = function () { var f = imp.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { var r = cat.importJSON(String(rd.result)); note(r.ok ? 'Imported ' + r.added + ' gate(s)' + (r.skipped ? ', ' + r.skipped + ' already present' : '') + (r.invalid ? ', ' + r.invalid + ' invalid skipped' : '') : '⚠️ ' + r.error); paint(); imp.value = ''; }; rd.readAsText(f); };
    m.foot.appendChild(btn('Import JSON', '', function () { imp.click(); })); m.foot.appendChild(imp);
    var sp = doc.createElement('span'); sp.className = 'sp'; m.foot.appendChild(sp); m.foot.appendChild(btn('Close', '', m.close));
    paint(); return m;
  }
  function askDelete(g, after) {
    var deps = cat.dependents(g.id), used = deps.gates.length + deps.circuits.length;
    var q = modal({ title: 'Delete “' + g.name + '”?', cls: 'sm' });
    if (used) {
      q.body.innerHTML = '<div class="tgu-msg wn"><b>This gate is in use.</b><br>' + deps.gates.map(function (x) { return '• gate “' + esc(x.name) + '”'; }).concat(deps.circuits.map(function (x) { return '• saved circuit “' + esc(x.name) + '”'; })).join('<br>') + '</div><div class="tgu-help">Deleting it would break those. <b>Archive</b> hides it from the panel but keeps everything working (recommended).</div>';
      q.foot.appendChild(btn('Archive (recommended)', 'pri', function () { cat.archive(g.id, true); q.close(); after(); note('Archived ' + g.name); }));
      q.foot.appendChild(btn('Delete anyway', 'dng', function () { var r = cat.remove(g.id, true); q.close(); after(); note(r.ok ? 'Deleted ' + g.name + ' — dependent code will report a missing gate' : '⚠️ ' + (r.error || 'Could not delete')); }));
    } else {
      q.body.innerHTML = '<div class="tgu-help">Nothing uses this gate. Its label <b>' + esc(g.label) + '</b> stays reserved so old code never silently changes meaning. Export first if you may need it again.</div>';
      q.foot.appendChild(btn('Delete', 'dng', function () { var r = cat.remove(g.id); q.close(); after(); note(r.ok ? 'Deleted ' + g.name : '⚠️ ' + (r.error || 'Could not delete')); }));
      q.foot.appendChild(btn('Archive instead', '', function () { cat.archive(g.id, true); q.close(); after(); }));
    }
    var sp = doc.createElement('span'); sp.className = 'sp'; q.foot.appendChild(sp); q.foot.appendChild(btn('Cancel', '', q.close));
  }

  function init(h) {
    host = Object.assign(host, h || {}); injectCSS();
    if (!init._bound) { init._bound = true; bindPanelEvents(); }
    return API;
  }
  var API = { init: init, renderPanel: renderPanel, refreshPanels: refreshPanels, openEditor: openEditor, openInventory: openInventory, openDetail: openDetail, showBasicMatrix: showBasicMatrix, showMatrixModal: showMatrixModal, tileHTML: tileHTML, modal: modal, btn: btn, esc: esc, catalog: cat, PAL: PAL, matrixHTML: matrixHTML };
  root.QuOLabTGUI = API;
})(typeof window !== 'undefined' ? window : globalThis);
