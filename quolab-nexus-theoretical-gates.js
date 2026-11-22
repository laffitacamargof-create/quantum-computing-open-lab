/* QuOLab Nexus — Theoretical Gates core (shared catalog, matrices, safe Python subset, Python prelude)
 *
 * One catalog, shared by Quantum Open Lab (Architect), Quantum Notebook and the execution layer.
 * Nothing in here evaluates user text as code: every expression is parsed into an AST and re-serialised.
 *
 * Conventions
 *  - Qiskit little-endian: in a gate acting on [a0, a1, ...], a0 is the least-significant bit of the local matrix index.
 *  - Circuit order: apply A then B  =>  operator U = B·A (column-vector convention).
 */
(function (root) {
  'use strict';

  var SCHEMA = 1;
  var STORE_KEY = 'nexus_theoretical_gates_v1';
  var MAX_QUBITS = 20;          // same limit as the canvas
  var MAX_MATRIX_QUBITS = 8;    // 4^8 = 65,536 complex entries — beyond that we explain instead of computing
  var MAX_OPS = 150;            // same limit as the canvas
  var TOL = 1e-9;

  // ───────────────────────── complex helpers ─────────────────────────
  var SQ2 = Math.SQRT1_2;
  function C(r, i) { return [r, i || 0]; }
  function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
  function cexpi(t) { return [Math.cos(t), Math.sin(t)]; }
  function zeros(n) { var m = []; for (var i = 0; i < n; i++) { m.push([]); for (var j = 0; j < n; j++) m[i].push([0, 0]); } return m; }
  function ident(n) { var m = zeros(n); for (var i = 0; i < n; i++) m[i][i] = [1, 0]; return m; }

  // ───────────────────────── built-in gate set ─────────────────────────
  // each entry: n = qubits, p = parameter count, m(params) = local matrix [row][col] of [re, im]
  function m1(a, b, c, d) { return [[a, b], [c, d]]; }
  function ctrl(nc, U) {            // args = [controls..., target]; control k is bit k, target is bit nc
    var nt = U.length, k = nc + Math.log2(nt), dim = 1 << k, M = zeros(dim), mask = (1 << nc) - 1;
    for (var col = 0; col < dim; col++) {
      if ((col & mask) === mask) {
        var t = col >> nc;
        for (var r = 0; r < nt; r++) M[(r << nc) | mask][col] = U[r][t];
      } else M[col][col] = [1, 0];
    }
    return M;
  }
  var X = m1(C(0), C(1), C(1), C(0));
  var Y = m1(C(0), [0, -1], [0, 1], C(0));
  var Z = m1(C(1), C(0), C(0), C(-1));
  var H = m1(C(SQ2), C(SQ2), C(SQ2), C(-SQ2));
  var S = m1(C(1), C(0), C(0), [0, 1]);
  var SDG = m1(C(1), C(0), C(0), [0, -1]);
  var T = m1(C(1), C(0), C(0), cexpi(Math.PI / 4));
  var TDG = m1(C(1), C(0), C(0), cexpi(-Math.PI / 4));
  var SX = m1([0.5, 0.5], [0.5, -0.5], [0.5, -0.5], [0.5, 0.5]);
  var SXDG = m1([0.5, -0.5], [0.5, 0.5], [0.5, 0.5], [0.5, -0.5]);
  var ID = ident(2);
  function RX(t) { var c = Math.cos(t / 2), s = Math.sin(t / 2); return m1(C(c), [0, -s], [0, -s], C(c)); }
  function RY(t) { var c = Math.cos(t / 2), s = Math.sin(t / 2); return m1(C(c), C(-s), C(s), C(c)); }
  function RZ(t) { return m1(cexpi(-t / 2), C(0), C(0), cexpi(t / 2)); }
  function PH(l) { return m1(C(1), C(0), C(0), cexpi(l)); }
  function U3(t, p, l) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return m1(C(c), cmul(cexpi(l), C(-s)), cmul(cexpi(p), C(s)), cmul(cexpi(p + l), C(c)));
  }
  var SWAPM = (function () { var M = zeros(4); M[0][0] = [1, 0]; M[1][2] = [1, 0]; M[2][1] = [1, 0]; M[3][3] = [1, 0]; return M; })();
  var ISWAPM = (function () { var M = zeros(4); M[0][0] = [1, 0]; M[1][2] = [0, 1]; M[2][1] = [0, 1]; M[3][3] = [1, 0]; return M; })();
  function pauliPair(P) {           // P⊗P with both args symmetric, so ordering is irrelevant
    var M = zeros(4);
    for (var a = 0; a < 2; a++) for (var b = 0; b < 2; b++) for (var c = 0; c < 2; c++) for (var d = 0; d < 2; d++)
      M[(a << 1) | b][(c << 1) | d] = cmul(P[a][c], P[b][d]);
    return M;
  }
  function expPauli(P, t) {         // exp(-i t/2 · P⊗P) = cos(t/2) I - i sin(t/2) P⊗P
    var PP = pauliPair(P), c = Math.cos(t / 2), s = Math.sin(t / 2), M = zeros(4);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      var v = cmul(PP[i][j], [0, -s]);
      M[i][j] = [v[0] + (i === j ? c : 0), v[1]];
    }
    return M;
  }

  var G = {};
  function def(name, n, p, m, aliases) { G[name] = { name: name, n: n, p: p, m: m, aliases: aliases || [] }; }
  def('id', 1, 0, function () { return ID; }, ['i']);
  def('h', 1, 0, function () { return H; });
  def('x', 1, 0, function () { return X; });
  def('y', 1, 0, function () { return Y; });
  def('z', 1, 0, function () { return Z; });
  def('s', 1, 0, function () { return S; });
  def('sdg', 1, 0, function () { return SDG; });
  def('t', 1, 0, function () { return T; });
  def('tdg', 1, 0, function () { return TDG; });
  def('sx', 1, 0, function () { return SX; });
  def('sxdg', 1, 0, function () { return SXDG; });
  def('rx', 1, 1, function (a) { return RX(a[0]); });
  def('ry', 1, 1, function (a) { return RY(a[0]); });
  def('rz', 1, 1, function (a) { return RZ(a[0]); });
  def('p', 1, 1, function (a) { return PH(a[0]); }, ['u1']);
  def('u', 1, 3, function (a) { return U3(a[0], a[1], a[2]); }, ['u3']);
  def('cx', 2, 0, function () { return ctrl(1, X); }, ['cnot']);
  def('cy', 2, 0, function () { return ctrl(1, Y); });
  def('cz', 2, 0, function () { return ctrl(1, Z); });
  def('ch', 2, 0, function () { return ctrl(1, H); });
  def('swap', 2, 0, function () { return SWAPM; });
  def('iswap', 2, 0, function () { return ISWAPM; });
  def('cp', 2, 1, function (a) { return ctrl(1, PH(a[0])); }, ['cphase', 'cu1']);
  def('crx', 2, 1, function (a) { return ctrl(1, RX(a[0])); });
  def('cry', 2, 1, function (a) { return ctrl(1, RY(a[0])); });
  def('crz', 2, 1, function (a) { return ctrl(1, RZ(a[0])); });
  def('rxx', 2, 1, function (a) { return expPauli(X, a[0]); });
  def('ryy', 2, 1, function (a) { return expPauli(Y, a[0]); });
  def('rzz', 2, 1, function (a) { return expPauli(Z, a[0]); });
  def('ccx', 3, 0, function () { return ctrl(2, X); }, ['toffoli']);
  def('ccz', 3, 0, function () { return ctrl(2, Z); });
  def('cswap', 3, 0, function () { return ctrl(1, SWAPM); }, ['fredkin']);
  var ALIAS = {};
  Object.keys(G).forEach(function (k) { ALIAS[k] = k; G[k].aliases.forEach(function (a) { ALIAS[a] = k; }); });
  function basicInfo(name) { var k = ALIAS[String(name).toLowerCase()]; return k ? G[k] : null; }

  // ───────────────────────── safe expression parser ─────────────────────────
  var FUNCS = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan, log: Math.log };
  var CONSTS = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };
  function tokenize(src) {
    var toks = [], i = 0, s = String(src);
    while (i < s.length) {
      var ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      var m;
      if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i)))) { toks.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(s.slice(i)))) { toks.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
      if (s.slice(i, i + 2) === '**') { toks.push({ k: 'op', v: '**' }); i += 2; continue; }
      if ('+-*/(),'.indexOf(ch) >= 0) { toks.push({ k: 'op', v: ch }); i++; continue; }
      throw new Error('Unexpected character "' + ch + '" in expression "' + s + '"');
    }
    return toks;
  }
  function parseExpr(src) {
    var toks = tokenize(src), pos = 0;
    function peek() { return toks[pos]; }
    function eat(v) { var t = toks[pos]; if (!t || t.v !== v) throw new Error('Expected "' + v + '" in "' + src + '"'); pos++; }
    function atom() {
      var t = toks[pos];
      if (!t) throw new Error('Incomplete expression "' + src + '"');
      if (t.k === 'num') { pos++; return { t: 'num', v: t.v }; }
      if (t.k === 'op' && t.v === '(') { pos++; var e = add(); eat(')'); return e; }
      if (t.k === 'op' && (t.v === '-' || t.v === '+')) { pos++; var x = unary(); return t.v === '-' ? { t: 'un', x: x } : x; }
      if (t.k === 'id') {
        pos++;
        var name = t.v.replace(/^(?:np|numpy|math)\./, '');
        if (peek() && peek().v === '(') {
          if (!Object.prototype.hasOwnProperty.call(FUNCS, name)) throw new Error('Function "' + t.v + '" is not allowed');
          pos++; var args = [];
          if (!(peek() && peek().v === ')')) { args.push(add()); while (peek() && peek().v === ',') { pos++; args.push(add()); } }
          eat(')'); return { t: 'call', f: name, a: args };
        }
        if (name.indexOf('.') >= 0) throw new Error('"' + t.v + '" is not allowed');
        return { t: 'var', n: name };
      }
      throw new Error('Unexpected "' + t.v + '" in "' + src + '"');
    }
    function unary() { return pow(); }
    function pow() { var b = atom(); if (peek() && peek().v === '**') { pos++; var e = unary(); return { t: 'bin', o: '**', l: b, r: e }; } return b; }
    function mul() { var l = unary(); while (peek() && (peek().v === '*' || peek().v === '/')) { var o = toks[pos++].v; l = { t: 'bin', o: o, l: l, r: unary() }; } return l; }
    function add() { var l = mul(); while (peek() && (peek().v === '+' || peek().v === '-')) { var o = toks[pos++].v; l = { t: 'bin', o: o, l: l, r: mul() }; } return l; }
    var ast = add();
    if (pos < toks.length) throw new Error('Unexpected "' + toks[pos].v + '" in "' + src + '"');
    return ast;
  }
  function evalAst(a, env) {
    switch (a.t) {
      case 'num': return a.v;
      case 'var':
        if (env && Object.prototype.hasOwnProperty.call(env, a.n)) return env[a.n];
        if (Object.prototype.hasOwnProperty.call(CONSTS, a.n)) return CONSTS[a.n];
        throw new Error('Unknown name "' + a.n + '"');
      case 'un': return -evalAst(a.x, env);
      case 'call': return FUNCS[a.f].apply(null, a.a.map(function (x) { return evalAst(x, env); }));
      case 'bin': {
        var l = evalAst(a.l, env), r = evalAst(a.r, env);
        return a.o === '+' ? l + r : a.o === '-' ? l - r : a.o === '*' ? l * r : a.o === '/' ? l / r : Math.pow(l, r);
      }
    }
    throw new Error('Bad expression');
  }
  function astVars(a, out) {
    out = out || {};
    if (a.t === 'var') { if (!Object.prototype.hasOwnProperty.call(CONSTS, a.n)) out[a.n] = 1; }
    else if (a.t === 'un') astVars(a.x, out);
    else if (a.t === 'call') a.a.forEach(function (x) { astVars(x, out); });
    else if (a.t === 'bin') { astVars(a.l, out); astVars(a.r, out); }
    return out;
  }
  function astSubst(a, map) {      // map: name -> AST
    if (a.t === 'var' && Object.prototype.hasOwnProperty.call(map, a.n)) return map[a.n];
    if (a.t === 'un') return { t: 'un', x: astSubst(a.x, map) };
    if (a.t === 'call') return { t: 'call', f: a.f, a: a.a.map(function (x) { return astSubst(x, map); }) };
    if (a.t === 'bin') return { t: 'bin', o: a.o, l: astSubst(a.l, map), r: astSubst(a.r, map) };
    return a;
  }
  function astFold(a) {             // constant folding keeps the generated code short and readable
    if (a.t === 'un') { var x = astFold(a.x); return x.t === 'num' ? { t: 'num', v: -x.v } : { t: 'un', x: x }; }
    if (a.t === 'call') { var args = a.a.map(astFold); return args.every(function (z) { return z.t === 'num'; }) ? { t: 'num', v: FUNCS[a.f].apply(null, args.map(function (z) { return z.v; })) } : { t: 'call', f: a.f, a: args }; }
    if (a.t === 'bin') {
      var l = astFold(a.l), r = astFold(a.r);
      if (l.t === 'num' && r.t === 'num') return { t: 'num', v: evalAst({ t: 'bin', o: a.o, l: l, r: r }) };
      return { t: 'bin', o: a.o, l: l, r: r };
    }
    return a;
  }
  function numStr(v) {
    if (!isFinite(v)) throw new Error('Non-finite number');
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    var s = String(v); return s.indexOf('e') >= 0 || s.indexOf('.') >= 0 ? s : s + '.0';
  }
  function astToPy(a) {
    switch (a.t) {
      case 'num': return a.v < 0 ? '(' + numStr(a.v) + ')' : numStr(a.v);
      case 'var': return Object.prototype.hasOwnProperty.call(CONSTS, a.n) ? 'math.' + (a.n === 'e' ? 'e' : a.n) : a.n;
      case 'un': return '(-' + astToPy(a.x) + ')';
      case 'call': return 'math.' + a.f + '(' + a.a.map(astToPy).join(', ') + ')';
      case 'bin': return '(' + astToPy(a.l) + ' ' + a.o + ' ' + astToPy(a.r) + ')';
    }
  }
  function astToText(a, top) {      // human-friendly (pi stays pi)
    switch (a.t) {
      case 'num': return numStr(+a.v.toPrecision(12));
      case 'var': return a.n;
      case 'un': return '-' + astToText(a.x);
      case 'call': return a.f + '(' + a.a.map(function (x) { return astToText(x, true); }).join(', ') + ')';
      case 'bin': { var s = astToText(a.l) + ' ' + a.o + ' ' + astToText(a.r); return top ? s : '(' + s + ')'; }
    }
  }

  // ───────────────────────── identifiers, labels ─────────────────────────
  var PY_RESERVED = /^(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)$/;
  function newId() {
    var r = '';
    try { var a = new Uint8Array(6); (root.crypto || {}).getRandomValues(a); a.forEach(function (b) { r += ('0' + b.toString(16)).slice(-2); }); }
    catch (_) { r = Math.random().toString(16).slice(2, 14); }
    return 'tg_' + r;
  }
  function initialOf(name) {
    var m = /[A-Za-z]/.exec(String(name || ''));
    return m ? m[0].toUpperCase() : 'G';
  }
  function validName(name) {
    name = String(name == null ? '' : name).trim();
    if (!name) return 'Gate name is required.';
    if (name.length > 48) return 'Gate name is too long (max 48 characters).';
    return '';
  }

  // ───────────────────────── operations model ─────────────────────────
  // op = { g: 'rz' | '@<gateId>', v: version (only for nested gates), q: [ints], p: [expression text] }
  function opKind(op) { return String(op.g).charAt(0) === '@' ? 'gate' : 'basic'; }

  // ───────────────────────── Catalog ─────────────────────────
  function Catalog(storage) {
    this.storage = storage || (function () { try { return root.localStorage; } catch (_) { return null; } })();
    this.mem = null;
    this.listeners = [];
    this.lastError = '';
    this.hooks = { savedCircuits: null };   // host-provided: { list():[{name,code}], replace(i, code) }
    this.load();
  }
  Catalog.prototype._empty = function () { return { schema: SCHEMA, gates: {}, order: [], reserved: [], assigned: [], touched: {}, uConfigs: [], updated: 0 }; };
  Catalog.prototype.load = function () {
    var raw = null;
    try { raw = this.storage && this.storage.getItem(STORE_KEY); } catch (_) { raw = null; }
    if (!raw) { this.mem = this._empty(); return; }
    try {
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || typeof d.gates !== 'object') throw new Error('shape');
      this.mem = this._migrate(d);
    } catch (err) {
      // corrupted: keep a backup copy, start clean, and tell the user instead of silently dropping data
      try { this.storage.setItem(STORE_KEY + '_corrupt_' + Date.now(), raw); } catch (_) {}
      this.lastError = 'The theoretical-gate catalog was unreadable; a backup copy was kept and a new catalog was started.';
      this.mem = this._empty();
    }
  };
  Catalog.prototype._migrate = function (d) {
    var out = this._empty();
    out.gates = d.gates || {}; out.order = Array.isArray(d.order) ? d.order.filter(function (id) { return d.gates[id]; }) : Object.keys(d.gates);
    Object.keys(out.gates).forEach(function (id) { if (out.order.indexOf(id) < 0) out.order.push(id); });
    out.reserved = Array.isArray(d.reserved) ? d.reserved : []; out.assigned = Array.isArray(d.assigned) ? d.assigned : [];
    out.touched = d.touched && typeof d.touched === 'object' ? d.touched : {};
    out.uConfigs = Array.isArray(d.uConfigs) ? d.uConfigs : []; out.updated = d.updated || 0;
    // schema 1 is current; future migrations go here keyed by d.schema
    Object.keys(out.gates).forEach(function (id) {
      var g = out.gates[id];
      if (!g || !Array.isArray(g.versions) || !g.versions.length) { delete out.gates[id]; out.order = out.order.filter(function (x) { return x !== id; }); return; }
      g.id = id;
    });
    return out;
  };
  Catalog.prototype.save = function () {
    this.mem.schema = SCHEMA; this.mem.updated = Date.now();
    var text = JSON.stringify(this.mem);
    try {
      if (!this.storage) throw new Error('no storage');
      this.storage.setItem(STORE_KEY, text);
      this.lastError = '';
    } catch (err) {
      var quota = err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(String(err.message)));
      this.lastError = quota ? 'Browser storage is full — export your gates (Export JSON) and free some space.' : 'Could not save the catalog in this browser.';
      this._emit('error', { message: this.lastError });
      return false;
    }
    this._emit('change', {});
    return true;
  };
  Catalog.prototype.on = function (fn) { this.listeners.push(fn); };
  Catalog.prototype._emit = function (type, data) { this.listeners.forEach(function (fn) { try { fn(type, data); } catch (_) {} }); };
  Catalog.prototype.reload = function () { this.load(); this._emit('change', {}); };

  Catalog.prototype.allocateLabel = function (name) {
    var ini = initialOf(name), used = {}, m = this.mem;
    m.reserved.forEach(function (a) { used[a] = 1; });
    Object.keys(m.gates).forEach(function (id) { used[m.gates[id].label] = 1; });
    var label = ini, n = 1;
    while (used[label] || PY_RESERVED.test(label)) { n++; label = ini + n; }
    return label;
  };
  Catalog.prototype.get = function (id) { return this.mem.gates[id] || null; };
  Catalog.prototype.byLabel = function (label) {
    var m = this.mem;
    for (var i = 0; i < m.order.length; i++) { var g = m.gates[m.order[i]]; if (g && g.label === label) return g; }
    return null;
  };
  Catalog.prototype.list = function (opts) {
    opts = opts || {}; var m = this.mem, out = [];
    m.order.forEach(function (id) { var g = m.gates[id]; if (g && (opts.archived || !g.archived)) out.push(g); });
    return out;
  };
  Catalog.prototype.version = function (g, v) {
    if (!g) return null; var want = v == null ? g.current : v;
    for (var i = 0; i < g.versions.length; i++) if (g.versions[i].v === want) return g.versions[i];
    return null;
  };
  Catalog.prototype.recent = function (n) {
    var t = this.mem.touched, self = this;
    return this.list().sort(function (a, b) { return (t[b.id] || 0) - (t[a.id] || 0); }).slice(0, n || 2);
  };
  Catalog.prototype.touch = function (id) { if (this.mem.gates[id]) { this.mem.touched[id] = Date.now(); this.save(); } };
  Catalog.prototype.assigned = function () { var self = this; return this.mem.assigned.map(function (id) { return self.mem.gates[id]; }).filter(function (g) { return g && !g.archived; }); };
  Catalog.prototype.assign = function (id, on) {
    var a = this.mem.assigned, i = a.indexOf(id);
    if (on && i < 0 && this.mem.gates[id]) a.push(id);
    if (!on && i >= 0) a.splice(i, 1);
    return this.save();
  };

  // Build a validated version record from an editor payload
  Catalog.prototype.buildVersion = function (payload, num, note) {
    var chk = validateDefinition(payload, this);
    var v = {
      v: num, created: Date.now(), note: note || '',
      nq: payload.nq, params: (payload.params || []).map(function (p) { return { name: p.name, def: p.def == null ? 0 : +p.def }; }),
      ops: (payload.ops || []).map(function (o) { return { g: o.g, v: o.v, q: o.q.slice(), p: (o.p || []).slice() }; }),
      pyText: payload.pyText || '', source: payload.source === 'python' ? 'python' : 'visual', pythonOnly: !!payload.pythonOnly,
      status: chk.state, statusMsg: chk.message, deps: chk.deps
    };
    return v;
  };
  Catalog.prototype.create = function (payload) {
    var nameErr = validName(payload.name);
    if (nameErr) return { ok: false, error: nameErr };
    var chk = validateDefinition(payload, this);
    if (chk.state === 'invalid' && chk.fatal) return { ok: false, error: chk.message };
    var id = newId(), label = this.allocateLabel(payload.name), m = this.mem;
    var g = { id: id, name: String(payload.name).trim(), label: label, created: Date.now(), modified: Date.now(), archived: false, current: 1,
              versions: [this.buildVersion(payload, 1, 'Created')], forkedFrom: null };
    m.gates[id] = g; m.order.push(id); m.reserved.push(label); m.touched[id] = Date.now();
    if (!this.save()) { delete m.gates[id]; m.order.pop(); m.reserved.pop(); return { ok: false, error: this.lastError }; }
    return { ok: true, gate: g };
  };
  // mode: 'overwrite' (edit current version in place) | 'version' (add v+1 and keep the previous ones)
  Catalog.prototype.update = function (id, payload, mode, note) {
    var g = this.mem.gates[id]; if (!g) return { ok: false, error: 'Gate not found.' };
    var nameErr = validName(payload.name != null ? payload.name : g.name); if (nameErr) return { ok: false, error: nameErr };
    var chk = validateDefinition(payload, this, id);
    if (chk.state === 'invalid' && chk.fatal) return { ok: false, error: chk.message };
    var snapshot = JSON.stringify(g), pinned = 0;
    if (payload.name != null) g.name = String(payload.name).trim();
    if (mode === 'version') {
      var prev = g.current, next = Math.max.apply(null, g.versions.map(function (x) { return x.v; })) + 1;
      pinned = this.pinReferences(id, prev);
      g.versions.push(this.buildVersion(payload, next, note || 'New version'));
      g.current = next;
    } else {
      var cur = this.version(g), idx = g.versions.indexOf(cur);
      g.versions[idx] = this.buildVersion(payload, cur.v, note || cur.note);
    }
    g.modified = Date.now(); this.mem.touched[id] = Date.now();
    if (!this.save()) { this.mem.gates[id] = JSON.parse(snapshot); return { ok: false, error: this.lastError }; }
    return { ok: true, gate: g, pinned: pinned };
  };
  Catalog.prototype.duplicate = function (id, newName) {
    var g = this.mem.gates[id]; if (!g) return { ok: false, error: 'Gate not found.' };
    var v = this.version(g);
    var r = this.create({ name: newName, nq: v.nq, params: v.params, ops: v.ops, pyText: v.pyText, source: v.source, pythonOnly: v.pythonOnly });
    if (r.ok) { r.gate.forkedFrom = { id: id, v: v.v }; this.save(); }
    return r;
  };
  Catalog.prototype.archive = function (id, on) {
    var g = this.mem.gates[id]; if (!g) return false;
    g.archived = on !== false;
    if (g.archived) this.mem.assigned = this.mem.assigned.filter(function (x) { return x !== id; });
    return this.save();
  };
  Catalog.prototype.remove = function (id, force) {
    var deps = this.dependents(id);
    if ((deps.gates.length || deps.circuits.length) && !force) return { ok: false, blocked: true, dependents: deps };
    delete this.mem.gates[id];
    this.mem.order = this.mem.order.filter(function (x) { return x !== id; });
    this.mem.assigned = this.mem.assigned.filter(function (x) { return x !== id; });
    delete this.mem.touched[id];
    this.save();
    return { ok: true, dependents: deps };    // label stays reserved forever so old code never silently changes meaning
  };
  // who uses this gate: other gates (nested ops) and saved circuits (code text)
  Catalog.prototype.dependents = function (id) {
    var self = this, res = { gates: [], circuits: [] }, g0 = this.mem.gates[id];
    Object.keys(this.mem.gates).forEach(function (gid) {
      if (gid === id) return; var g = self.mem.gates[gid];
      var used = g.versions.some(function (v) { return v.ops.some(function (o) { return o.g === '@' + id; }); });
      if (used) res.gates.push({ id: gid, name: g.name, label: g.label });
    });
    var hook = this.hooks.savedCircuits;
    if (g0 && hook && typeof hook.list === 'function') {
      try {
        hook.list().forEach(function (c, i) { if (codeUses(c.code, g0.label)) res.circuits.push({ index: i, name: c.name }); });
      } catch (_) {}
    }
    return res;
  };
  // new version created: freeze every unversioned reference to <label> (nested gates already carry explicit versions)
  Catalog.prototype.pinReferences = function (id, ver) {
    var g = this.mem.gates[id], hook = this.hooks.savedCircuits, n = 0;
    if (!g || !hook || typeof hook.list !== 'function' || typeof hook.replace !== 'function') return 0;
    var re = new RegExp('(\\.\\s*)' + g.label + '(\\s*\\()', 'g');
    try {
      hook.list().forEach(function (c, i) {
        var next = String(c.code || '').replace(re, '$1' + g.label + '_v' + ver + '$2');
        if (next !== c.code) { hook.replace(i, next); n++; }
      });
    } catch (_) {}
    return n;
  };
  function codeUses(code, label) {
    return new RegExp('\\.\\s*' + label + '(?:_v\\d+)?\\s*\\(').test(String(code || ''));
  }

  // export / import
  Catalog.prototype.exportJSON = function () {
    return JSON.stringify({ format: 'quolab-theoretical-gates', schema: SCHEMA, exported: new Date().toISOString(), gates: this.mem.gates, order: this.mem.order, reserved: this.mem.reserved, assigned: this.mem.assigned, uConfigs: this.mem.uConfigs }, null, 2);
  };
  // Import never overwrites: gates with an existing id are skipped, labels are re-allocated on collision
  Catalog.prototype.importJSON = function (text) {
    var d; try { d = JSON.parse(text); } catch (_) { return { ok: false, error: 'The file is not valid JSON.' }; }
    if (!d || d.format !== 'quolab-theoretical-gates' || typeof d.gates !== 'object') return { ok: false, error: 'This file is not a QuOLab theoretical-gate export.' };
    if (d.schema > SCHEMA) return { ok: false, error: 'This export was made by a newer version (schema ' + d.schema + ').' };
    var added = 0, skipped = 0, bad = 0, self = this, m = this.mem, map = {};
    (d.order || Object.keys(d.gates)).forEach(function (id) {
      var g = d.gates[id]; if (!g || !Array.isArray(g.versions) || !g.versions.length) { bad++; return; }
      if (m.gates[id]) { skipped++; return; }
      var ok = g.versions.every(function (v) { return validateDefinition(v, null).state !== 'invalid' || !validateDefinition(v, null).fatal; });
      if (!ok) { bad++; return; }
      var label = g.label, taken = m.reserved.indexOf(label) >= 0 || !/^[A-Z][A-Za-z0-9_]*$/.test(label || '');
      if (taken) label = self.allocateLabel(g.name);
      map[id] = label;
      m.gates[id] = { id: id, name: String(g.name || 'Gate').slice(0, 48), label: label, created: g.created || Date.now(), modified: g.modified || Date.now(), archived: !!g.archived, current: g.current || g.versions[g.versions.length - 1].v, versions: g.versions, forkedFrom: g.forkedFrom || null };
      m.order.push(id); m.reserved.push(label); added++;
    });
    if (Array.isArray(d.uConfigs)) d.uConfigs.forEach(function (c) { if (c && c.id && !m.uConfigs.some(function (x) { return x.id === c.id; })) m.uConfigs.push(c); });
    if (!this.save()) return { ok: false, error: this.lastError };
    return { ok: true, added: added, skipped: skipped, invalid: bad };
  };

  // U configuration history (never overwritten silently)
  Catalog.prototype.saveUConfig = function (cfg, mode) {
    var list = this.mem.uConfigs, now = Date.now();
    if (mode === 'update' && cfg.id) {
      var i = list.findIndex(function (x) { return x.id === cfg.id; });
      if (i >= 0) { list[i] = Object.assign({}, cfg, { modified: now }); this.save(); return list[i]; }
    }
    var rec = Object.assign({}, cfg, { id: 'u_' + now.toString(36) + Math.random().toString(36).slice(2, 6), created: now, modified: now });
    if (list.some(function (x) { return x.name === rec.name; })) rec.name = rec.name + ' (' + new Date(now).toLocaleTimeString() + ')';
    list.unshift(rec); if (list.length > 200) list.length = 200;
    this.save(); return rec;
  };
  Catalog.prototype.deleteUConfig = function (id) { this.mem.uConfigs = this.mem.uConfigs.filter(function (x) { return x.id !== id; }); return this.save(); };

  // ───────────────────────── validation ─────────────────────────
  // returns { state: 'valid'|'invalid'|'unverified', message, deps:[ids], fatal }
  function validateDefinition(d, cat, selfId) {
    var res = { state: 'valid', message: 'Unitary within 1e-9.', deps: [], fatal: false };
    function bad(msg, fatal) { res.state = 'invalid'; res.message = msg; res.fatal = fatal !== false; return res; }
    var nq = d.nq;
    if (!Number.isInteger(nq) || nq < 1 || nq > MAX_QUBITS) return bad('Qubit count must be an integer between 1 and ' + MAX_QUBITS + '.');
    var pnames = {}, params = d.params || [];
    for (var i = 0; i < params.length; i++) {
      var pn = params[i].name;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pn || '') || PY_RESERVED.test(pn) || CONSTS[pn] != null || FUNCS[pn]) return bad('Invalid parameter name "' + pn + '".');
      if (pnames[pn]) return bad('Duplicate parameter "' + pn + '".');
      pnames[pn] = 1;
      if (params[i].def != null && !isFinite(+params[i].def)) return bad('Default for "' + pn + '" must be a number.');
    }
    var ops = d.ops || [];
    if (!ops.length) return bad('The gate has no operations yet.', false);
    if (ops.length > MAX_OPS) { res.state = 'unverified'; res.message = 'More than ' + MAX_OPS + ' operations: shown as Python-only.'; }
    var deps = {};
    for (var k = 0; k < ops.length; k++) {
      var op = ops[k], where = 'Operation ' + (k + 1) + ': ';
      if (!op || typeof op.g !== 'string' || !Array.isArray(op.q)) return bad(where + 'malformed operation.');
      var info, nested = null, np;
      if (opKind(op) === 'gate') {
        var nid = op.g.slice(1);
        if (!cat) { info = { n: (op.q || []).length, p: (op.p || []).length }; }
        else {
          nested = cat.get(nid);
          if (!nested) return bad(where + 'references a gate that no longer exists.', false);
          if (nested.archived) { res.state = 'invalid'; res.message = where + '"' + nested.name + '" is archived.'; res.fatal = false; }
          if (nid === selfId) return bad(where + 'a gate cannot contain itself.');
          if (reaches(cat, nid, selfId)) return bad(where + 'this would create a circular dependency.');
          var nv = cat.version(nested, op.v);
          if (!nv) return bad(where + 'unknown version of "' + nested.name + '".');
          info = { n: nv.nq, p: nv.params.length };
        }
        deps[nid] = 1;
      } else {
        info = basicInfo(op.g);
        if (!info) return bad(where + (/^(measure|reset|barrier|initialize)/i.test(op.g) ? '"' + op.g + '" is not unitary and cannot be part of a theoretical gate.' : 'unknown gate "' + op.g + '".'));
      }
      if (op.q.length !== info.n) return bad(where + '"' + op.g.replace(/^@/, '') + '" acts on ' + info.n + ' qubit(s), got ' + op.q.length + '.');
      var seen = {};
      for (var j = 0; j < op.q.length; j++) {
        var q = op.q[j];
        if (!Number.isInteger(q) || q < 0 || q >= nq) return bad(where + 'qubit ' + q + ' is outside 0…' + (nq - 1) + '.');
        if (seen[q]) return bad(where + 'qubit ' + q + ' is used twice.');
        seen[q] = 1;
      }
      var plist = op.p || [];
      if (plist.length !== info.p) return bad(where + '"' + op.g.replace(/^@/, '') + '" needs ' + info.p + ' parameter(s), got ' + plist.length + '.');
      for (var z = 0; z < plist.length; z++) {
        try {
          var ast = parseExpr(plist[z]), vars = astVars(ast);
          for (var vn in vars) if (!pnames[vn]) return bad(where + 'unknown name "' + vn + '" (declare it as a parameter).');
        } catch (e) { return bad(where + e.message); }
      }
    }
    res.deps = Object.keys(deps);
    if (res.state === 'valid') {
      if (nq > MAX_MATRIX_QUBITS) { res.state = 'unverified'; res.message = 'Matrix not computed: a ' + nq + '-qubit operator has 4^' + nq + ' entries (limit: ' + MAX_MATRIX_QUBITS + ' qubits).'; }
      else if (cat) {
        try {
          var env = {}; params.forEach(function (p) { env[p.name] = +p.def || 0; });
          var U = buildUnitary({ nq: nq, ops: ops, params: params }, env, cat);
          var err = unitaryError(U);
          if (err > 1e-8) { res.state = 'invalid'; res.message = 'Not unitary (‖U†U − I‖ = ' + err.toExponential(2) + ').'; res.fatal = false; }
          else res.message = 'Unitary (‖U†U − I‖ = ' + err.toExponential(1) + ').';
        } catch (e) { res.state = 'invalid'; res.message = e.message; res.fatal = false; }
      }
    }
    return res;
  }
  function reaches(cat, fromId, targetId) {       // does gate <fromId> (any version) contain <targetId> transitively?
    if (!targetId) return false;
    var seen = {}, stack = [fromId];
    while (stack.length) {
      var id = stack.pop(); if (seen[id]) continue; seen[id] = 1;
      var g = cat.get(id); if (!g) continue;
      for (var i = 0; i < g.versions.length; i++) for (var j = 0; j < g.versions[i].ops.length; j++) {
        var o = g.versions[i].ops[j]; if (o.g.charAt(0) !== '@') continue;
        var nid = o.g.slice(1); if (nid === targetId) return true; stack.push(nid);
      }
    }
    return false;
  }

  // ───────────────────────── matrices ─────────────────────────
  // flatten one version into basic ops with AST parameters (nested gates are inlined, caller args substituted)
  function flatten(ver, argAsts, cat, depth) {
    depth = depth || 0; if (depth > 24) throw new Error('Gate nesting is too deep.');
    var map = {};
    (ver.params || []).forEach(function (p, i) { map[p.name] = argAsts[i] || { t: 'num', v: +p.def || 0 }; });
    var out = [];
    ver.ops.forEach(function (op) {
      var asts = (op.p || []).map(function (t) { return astFold(astSubst(parseExpr(t), map)); });
      if (op.g.charAt(0) === '@') {
        var nested = cat && cat.get(op.g.slice(1));
        if (!nested) throw new Error('Missing gate ' + op.g.slice(1));
        var nv = cat.version(nested, op.v);
        if (!nv) throw new Error('Missing version of "' + nested.name + '"');
        flatten(nv, asts, cat, depth + 1).forEach(function (o2) { out.push({ g: o2.g, q: o2.q.map(function (x) { return op.q[x]; }), p: o2.p }); });
      } else {
        out.push({ g: basicInfo(op.g).name, q: op.q.slice(), p: asts });
      }
    });
    return out;
  }
  // full 2^n × 2^n unitary (n ≤ MAX_MATRIX_QUBITS). Returns {n, dim, re:Float64Array, im:Float64Array} row-major
  function buildUnitary(ver, env, cat) {
    var n = ver.nq;
    if (n > MAX_MATRIX_QUBITS) throw new Error('Matrix not computed: a ' + n + '-qubit operator has 4^' + n + ' entries (limit: ' + MAX_MATRIX_QUBITS + ' qubits).');
    var flat = flatten(ver, (ver.params || []).map(function (p) { return { t: 'num', v: env && env[p.name] != null ? +env[p.name] : (+p.def || 0) }; }), cat);
    return unitaryOfFlat(n, flat);
  }
  function unitaryOfFlat(n, flat) {
    var dim = 1 << n, re = new Float64Array(dim * dim), im = new Float64Array(dim * dim);
    for (var i = 0; i < dim; i++) re[i * dim + i] = 1;
    flat.forEach(function (op) {
      var info = G[op.g], vals = op.p.map(function (a) { return evalAst(a, {}); }), M = info.m(vals), k = op.q.length, ld = 1 << k;
      var masks = op.q.map(function (q) { return 1 << q; }), allMask = masks.reduce(function (a, b) { return a | b; }, 0);
      var idx = new Array(ld);
      for (var base = 0; base < dim; base++) {
        if (base & allMask) continue;
        for (var l = 0; l < ld; l++) { var ix = base; for (var b = 0; b < k; b++) if (l & (1 << b)) ix |= masks[b]; idx[l] = ix; }
        for (var col = 0; col < dim; col++) {          // apply to every column of the running unitary (left-multiply: U ← G·U)
          var tr = new Array(ld), ti = new Array(ld);
          for (var r = 0; r < ld; r++) {
            var sr = 0, si = 0;
            for (var c2 = 0; c2 < ld; c2++) {
              var g = M[r][c2]; if (g[0] === 0 && g[1] === 0) continue;
              var vr = re[idx[c2] * dim + col], vi = im[idx[c2] * dim + col];
              sr += g[0] * vr - g[1] * vi; si += g[0] * vi + g[1] * vr;
            }
            tr[r] = sr; ti[r] = si;
          }
          for (var r2 = 0; r2 < ld; r2++) { re[idx[r2] * dim + col] = tr[r2]; im[idx[r2] * dim + col] = ti[r2]; }
        }
      }
    });
    return { n: n, dim: dim, re: re, im: im };
  }
  function unitaryError(U) {      // max |(U†U − I)_ij|
    var d = U.dim, worst = 0;
    for (var i = 0; i < d; i++) for (var j = 0; j < d; j++) {
      var sr = 0, si = 0;
      for (var k = 0; k < d; k++) {
        var ar = U.re[k * d + i], ai = -U.im[k * d + i], br = U.re[k * d + j], bi = U.im[k * d + j];
        sr += ar * br - ai * bi; si += ar * bi + ai * br;
      }
      if (i === j) sr -= 1;
      worst = Math.max(worst, Math.abs(sr), Math.abs(si));
    }
    return worst;
  }
  function matrixOfBasic(name, params) {
    var info = basicInfo(name); if (!info) throw new Error('Unknown gate ' + name);
    var M = info.m(params || []), d = M.length, re = new Float64Array(d * d), im = new Float64Array(d * d);
    for (var i = 0; i < d; i++) for (var j = 0; j < d; j++) { re[i * d + j] = M[i][j][0]; im[i * d + j] = M[i][j][1]; }
    return { n: Math.log2(d), dim: d, re: re, im: im };
  }
  function fmtC(re, im, digits) {
    digits = digits == null ? 4 : digits;
    function f(x) { var s = (Math.abs(x) < 5e-13 ? 0 : x).toFixed(digits).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; }
    var a = f(re), b = f(Math.abs(im));
    if (b === '0') return a;
    if (a === '0') return (im < 0 ? '-' : '') + (b === '1' ? '' : b) + 'i';
    return a + (im < 0 ? '−' : '+') + (b === '1' ? '' : b) + 'i';
  }
  function matrixToText(U, digits) {
    var rows = [];
    for (var i = 0; i < U.dim; i++) { var r = []; for (var j = 0; j < U.dim; j++) r.push(fmtC(U.re[i * U.dim + j], U.im[i * U.dim + j], digits)); rows.push(r); }
    return rows;
  }
  function matrixToLatex(U, digits) {
    return '\\begin{pmatrix}' + matrixToText(U, digits).map(function (r) { return r.join(' & '); }).join(' \\\\ ') + '\\end{pmatrix}';
  }
  function distancePhaseInvariant(A, B) {          // 1 - |tr(A†B)|/d  (0 = equal up to a global phase)
    var d = A.dim, tr = 0, ti = 0;
    for (var i = 0; i < d; i++) for (var k = 0; k < d; k++) {
      var ar = A.re[k * d + i], ai = -A.im[k * d + i], br = B.re[k * d + i], bi = B.im[k * d + i];
      tr += ar * br - ai * bi; ti += ar * bi + ai * br;
    }
    return 1 - Math.sqrt(tr * tr + ti * ti) / d;
  }

  // ───────────────────────── safe Python subset ─────────────────────────
  // Parses lines like  qc.h(0) / qc.cx(0, 1) / qc.rz(theta/2, 1) / qc.F2(3, 0)  and  for i in range(n): …
  // Anything else is rejected with the line number. Nothing is ever executed here.
  function parsePython(text, ctx) {
    ctx = ctx || {}; var cat = ctx.catalog || null, selfId = ctx.selfId || null;
    var nq = ctx.nq, declared = ctx.params || [], errors = [], ops = [];
    var pnames = {}; declared.forEach(function (p) { pnames[p.name] = 1; });
    var lines = String(text || '').split(/\r?\n/);
    function err(i, msg) { errors.push({ line: i + 1, message: msg }); }
    function indentOf(s) { return s.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length; }
    var items = [];
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].replace(/#.*$/, '');
      if (!raw.trim()) continue;
      items.push({ n: i, ind: indentOf(raw), s: raw.trim() });
    }
    var headerNq = null;
    function splitArgs(s) {
      var out = [], depth = 0, cur = '';
      for (var c = 0; c < s.length; c++) {
        var ch = s[c];
        if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    }
    function intExpr(txt, env, ln, what) {
      try {
        var v = evalAst(astFold(parseExpr(txt)), env);
        if (!Number.isFinite(v) || Math.abs(v - Math.round(v)) > 1e-12) { err(ln, what + ' must be an integer, got "' + txt + '".'); return null; }
        return Math.round(v);
      } catch (e) { err(ln, what + ': ' + e.message); return null; }
    }
    function labelLookup(name) {
      if (!cat) return null;
      var m = /^([A-Z][A-Za-z0-9_]*?)(?:_v(\d+))?$/.exec(name);
      if (!m) return null;
      var g = cat.byLabel(m[1]) || cat.byLabel(name);
      if (!g) return null;
      return { g: g, v: m[2] ? +m[2] : null };
    }
    function run(from, to, env, baseInd) {
      var idx = from;
      while (idx < to) {
        var it = items[idx];
        if (it.ind !== baseInd) { err(it.n, 'Unexpected indentation.'); idx++; continue; }
        var m;
        if ((m = /^for\s+([A-Za-z_]\w*)\s+in\s+range\s*\((.*)\)\s*:$/.exec(it.s))) {
          var end = idx + 1; while (end < to && items[end].ind > baseInd) end++;
          if (end === idx + 1) { err(it.n, 'Empty loop body.'); idx = end; continue; }
          var a = splitArgs(m[2]).map(function (t) { return intExpr(t, env, it.n, 'range argument'); });
          if (a.length < 1 || a.length > 3 || a.some(function (x) { return x == null; })) { if (a.length < 1 || a.length > 3) err(it.n, 'range() takes 1 to 3 arguments.'); idx = end; continue; }
          var lo = a.length === 1 ? 0 : a[0], hi = a.length === 1 ? a[0] : a[1], st = a.length === 3 ? a[2] : 1;
          if (!st) { err(it.n, 'range() step cannot be 0.'); idx = end; continue; }
          var count = 0;
          for (var v = lo; st > 0 ? v < hi : v > hi; v += st) {
            if (++count > 256) { err(it.n, 'Loop runs more than 256 times.'); break; }
            var env2 = Object.assign({}, env); env2[m[1]] = v;
            run(idx + 1, end, env2, items[idx + 1].ind);
          }
          idx = end; continue;
        }
        if ((m = /^(?:import\s+numpy(?:\s+as\s+np)?|import\s+math|from\s+qiskit\s+import\s+[\w ,]+|from\s+numpy\s+import\s+pi|import\s+qiskit)$/.exec(it.s))) { idx++; continue; }
        if ((m = /^qc\s*=\s*QuantumCircuit\s*\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)$/.exec(it.s))) { headerNq = +m[1]; idx++; continue; }
        if ((m = /^(?:qc|circuit|self)\s*\.\s*([A-Za-z_]\w*)\s*\((.*)\)$/.exec(it.s))) {
          var name = m[1], args = splitArgs(m[2]);
          var info = null, nested = null, nver = null, opName;
          var lk = /^[A-Z]/.test(name) ? labelLookup(name) : null;
          if (lk) {
            nested = lk.g; if (selfId && nested.id === selfId) { err(it.n, 'A gate cannot contain itself.'); idx++; continue; }
            nver = cat.version(nested, lk.v); if (!nver) { err(it.n, 'Gate "' + name + '" has no such version.'); idx++; continue; }
            info = { n: nver.nq, p: nver.params.length }; opName = '@' + nested.id;
          } else {
            info = basicInfo(name);
            if (!info) {
              if (/^(measure|measure_all|reset|barrier|initialize|save_|draw|delay)/i.test(name)) err(it.n, '"qc.' + name + '" is not allowed inside a theoretical gate (it is not a unitary operation).');
              else err(it.n, 'Unknown gate "qc.' + name + '". Use the basic gates (h, x, rz, cx, …) or another theoretical gate (qc.' + (cat && cat.list()[0] ? cat.list()[0].label : 'F') + '(…)).');
              idx++; continue;
            }
            opName = info.name;
          }
          if (args.length !== info.p + info.n) { err(it.n, '"qc.' + name + '" takes ' + info.p + ' parameter(s) then ' + info.n + ' qubit(s) — got ' + args.length + ' argument(s).'); idx++; continue; }
          var ps = [], qs = [], ok = true;
          for (var a2 = 0; a2 < info.p; a2++) {
            try {
              var ast = astFold(astSubst(parseExpr(args[a2]), Object.keys(env).reduce(function (o, k) { o[k] = { t: 'num', v: env[k] }; return o; }, {})));
              var vars = astVars(ast);
              for (var vn in vars) if (!pnames[vn]) throw new Error('unknown name "' + vn + '" (declare it in the Parameters box)');
              ps.push(astToText(ast, true));
            } catch (e) { err(it.n, 'Parameter ' + (a2 + 1) + ': ' + e.message); ok = false; }
          }
          for (var a3 = info.p; a3 < args.length; a3++) { var qv = intExpr(args[a3], env, it.n, 'Qubit'); if (qv == null) ok = false; else qs.push(qv); }
          if (ok) {
            var op = { g: opName, q: qs, p: ps }; if (nested) op.v = nver.v;
            ops.push(op);
            if (ops.length > 5000) { err(it.n, 'Too many operations.'); return; }
          }
          idx++; continue;
        }
        err(it.n, 'Not supported here: "' + it.s.slice(0, 60) + '". Use qc.<gate>(…) calls and simple for-loops over range(); no other Python is run.');
        idx++;
      }
    }
    if (items.length) run(0, items.length, {}, items[0].ind);
    var useNq = nq != null ? nq : headerNq;
    var maxq = -1; ops.forEach(function (o) { o.q.forEach(function (q) { if (q > maxq) maxq = q; }); });
    if (useNq == null) useNq = Math.max(1, maxq + 1);
    return { ok: errors.length === 0, errors: errors, ops: ops, nq: useNq, headerNq: headerNq };
  }
  function pyFromOps(def, cat) {
    var lines = ['# Theoretical gate — Python editor (safe subset: qc.<gate>(…) calls and range() loops)'];
    (def.ops || []).forEach(function (op) {
      var name = op.g, args = (op.p || []).slice();
      if (name.charAt(0) === '@') {
        var g = cat && cat.get(name.slice(1)); var ver = g && cat.version(g, op.v);
        name = g ? (g.label + (ver && ver.v !== g.current ? '_v' + ver.v : '')) : 'Missing';
      }
      lines.push('qc.' + name + '(' + args.concat(op.q.map(String)).join(', ') + ')');
    });
    return lines.join('\n');
  }

  // ───────────────────────── Python prelude (for Qiskit real + the Pyodide mock) ─────────────────────────
  var ALIAS_RE = /\.\s*([A-Z][A-Za-z0-9_]*?)(?:_v(\d+))?\s*\(/g;
  function usedGates(code, cat) {
    var found = {}, m, text = String(code || '').split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n');
    ALIAS_RE.lastIndex = 0;
    while ((m = ALIAS_RE.exec(text))) {
      var g = cat.byLabel(m[1]); var ver = m[2] ? +m[2] : null;
      if (!g && m[2]) g = cat.byLabel(m[1] + '_' + m[2]);   // label that itself ends in digits
      if (g) found[g.id + ':' + (ver || g.current)] = { g: g, v: ver || g.current, pinned: !!ver };
      else { var g2 = cat.byLabel(m[1] + (m[2] ? '_v' + m[2] : '')); if (g2) found[g2.id + ':' + g2.current] = { g: g2, v: g2.current, pinned: false }; }
    }
    return Object.keys(found).map(function (k) { return found[k]; });
  }
  function pyIdent(s) { return String(s).replace(/[^A-Za-z0-9_]/g, '_'); }
  function buildPrelude(code, cat) {
    cat = cat || defaultCatalog(); if (!cat) return '';
    var used = usedGates(code, cat);
    if (!used.length) return '';
    var blocks = [], table = [];
    used.forEach(function (u) {
      var ver = cat.version(u.g, u.v); if (!ver) return;
      var flat; try { flat = flatten(ver, (ver.params || []).map(function (p) { return { t: 'var', n: p.name }; }), cat); } catch (e) { return; }
      var fn = '__qtg_' + pyIdent(u.g.id) + '_v' + u.v, pn = ver.params.map(function (p) { return p.name; });
      var body = flat.map(function (o) {
        var pyName = o.g === 'p' ? 'p' : o.g;
        return '        s.' + pyName + '(' + o.p.map(astToPy).concat(o.q.map(String)).join(', ') + ')';
      });
      blocks.push('    def ' + fn + '(s' + (pn.length ? ', ' + pn.join(', ') : '') + '):\n' + (body.length ? body.join('\n') : '        pass'));
      // the unversioned alias always means the CURRENT version; older versions are only reachable as F_v<n>
      if (u.v === u.g.current) table.push('        ' + JSON.stringify(u.g.label) + ': (' + JSON.stringify(u.g.id) + ', ' + u.v + ', ' + ver.nq + ', ' + pn.length + ', ' + fn + ', ' + JSON.stringify(u.g.label) + '),');
      table.push('        ' + JSON.stringify(u.g.label + '_v' + u.v) + ': (' + JSON.stringify(u.g.id) + ', ' + u.v + ', ' + ver.nq + ', ' + pn.length + ', ' + fn + ', ' + JSON.stringify(u.g.label) + '),');
    });
    if (!blocks.length) return '';
    return [
      '# >>> QuOLab theoretical gates (auto-generated, do not edit) >>>',
      'def __qtg_install():',
      '    import math',
      '    import qiskit as _qk',
      '    _QC = _qk.QuantumCircuit',
      blocks.join('\n'),
      '    _T = {',
      table.join('\n'),
      '    }',
      '    _mock = hasattr(_QC, "_add")',
      '    if not hasattr(_QC, "_qtg_orig_getattr"):',
      '        _QC._qtg_orig_getattr = _QC.__dict__.get("__getattr__")',
      '    _orig = _QC._qtg_orig_getattr',
      '    def _qubits(args):',
      '        out = []',
      '        for a in args:',
      '            if isinstance(a, (list, tuple, range)): out.extend(_qubits(a))',
      '            else: out.append(a)',
      '        return out',
      '    def _make(self, key):',
      '        gid, ver, nq, np_, build, label = _T[key]',
      '        def call(*args, **kw):',
      '            if len(args) != np_ + nq:',
      '                raise TypeError("qc.%s takes %d parameter(s) then %d qubit(s) (got %d arguments)" % (key, np_, nq, len(args)))',
      '            prm = [float(a) for a in args[:np_]]',
      '            qs = _qubits(args[np_:])',
      '            if _mock:',
      '                return self._add("qtg_" + gid, qs, prm, "qtg_" + gid, {"qtg": gid, "v": ver, "label": label, "p": prm})',
      '            from qiskit.circuit import Gate as _Gate',
      '            sub = _QC(nq, name="qtg_" + gid)',
      '            build(sub, *prm)',
      '            g = _Gate("qtg_" + gid, nq, list(prm), label=label)',
      '            g.definition = sub',
      '            return self.append(g, qs)',
      '        return call',
      '    def _getattr(self, name):',
      '        if name in _T: return _make(self, name)',
      '        if _orig is not None: return _orig(self, name)',
      '        raise AttributeError(name)',
      '    _QC.__getattr__ = _getattr',
      '    if not _mock:',
      '        try:',
      '            import qiskit_aer as _qa',
      '            if not getattr(_qa.AerSimulator, "_qtg_patched", False):',
      '                _run0 = _qa.AerSimulator.run',
      '                def _x(c):',
      '                    try:',
      '                        if any(i.operation.name.startswith("qtg_") for i in c.data): return c.decompose(gates_to_decompose="qtg_*")',
      '                    except Exception: pass',
      '                    return c',
      '                def _run(self, circuits, *a, **k):',
      '                    circuits = [_x(c) for c in circuits] if isinstance(circuits, (list, tuple)) else _x(circuits)',
      '                    return _run0(self, circuits, *a, **k)',
      '                _qa.AerSimulator.run = _run',
      '                _qa.AerSimulator._qtg_patched = True',
      '        except Exception: pass',
      '__qtg_install()',
      'del __qtg_install',
      '# <<< QuOLab theoretical gates <<<',
      ''
    ].join('\n');
  }
  function injectPrelude(code, cat) {
    var pre = buildPrelude(code, cat);
    if (!pre) return code;
    code = String(code);
    // keep `from __future__` first; otherwise put the prelude on top so it is defined before any use
    var m = /^(?:\s*(?:#.*)?\n)*(?:from\s+__future__\s+import[^\n]*\n)+/.exec(code);
    if (m) return code.slice(0, m[0].length) + pre + code.slice(m[0].length);
    return pre + code;
  }
  function stripPrelude(code) {
    return String(code || '').replace(/# >>> QuOLab theoretical gates[\s\S]*?# <<< QuOLab theoretical gates <<<\n?/g, '');
  }

  // ───────────────────────── host helpers (Architect / Notebook parsers) ─────────────────────────
  // arity of a theoretical-gate call in code: { nq, np } or null
  function arityOf(name, cat) {
    cat = cat || defaultCatalog(); if (!cat || !/^[A-Z]/.test(name)) return null;
    var m = /^([A-Z][A-Za-z0-9_]*?)(?:_v(\d+))?$/.exec(name);
    var g = cat.byLabel(name) || (m && cat.byLabel(m[1]));
    if (!g) return null;
    var ver = cat.version(g, m && m[2] ? +m[2] : null) || cat.version(g);
    return ver ? { nq: ver.nq, np: ver.params.length, gate: g, version: ver } : null;
  }
  // python call text for a placed gate  { tg:{id,v,params:[numbers]}, qs:[...] }
  function callFor(placed, cat) {
    cat = cat || defaultCatalog();
    var g = cat.get(placed.tg.id); if (!g) return null;
    var ver = cat.version(g, placed.tg.v), vsuffix = placed.tg.v !== g.current || g.versions.length > 1 && placed.tg.pinned ? '_v' + placed.tg.v : '';
    var params = (placed.tg.params || ver.params.map(function (p) { return p.def; })).map(function (x) { return numStr(+(+x).toPrecision(12)); });
    return 'qc.' + g.label + vsuffix + '(' + params.concat(placed.qs.map(String)).join(', ') + ')';
  }
  function describe(id, v, cat) {
    cat = cat || defaultCatalog(); var g = cat && cat.get(id); if (!g) return null;
    var ver = cat.version(g, v);
    return { id: g.id, name: g.name, label: g.label, version: ver ? ver.v : null, nq: ver ? ver.nq : null, status: ver ? ver.status : 'invalid', archived: g.archived, params: ver ? ver.params : [] };
  }
  function matrixOfGate(id, v, args, cat) {
    cat = cat || defaultCatalog(); var g = cat.get(id); if (!g) throw new Error('This gate is not in the local catalog.');
    var ver = cat.version(g, v); if (!ver) throw new Error('This version is not in the local catalog.');
    var env = {}; ver.params.forEach(function (p, i) { env[p.name] = args && args[i] != null ? +args[i] : +p.def || 0; });
    return buildUnitary(ver, env, cat);
  }

  var _default = null;
  function defaultCatalog() { if (!_default) { try { _default = new Catalog(); } catch (_) { _default = null; } } return _default; }

  var API = {
    SCHEMA: SCHEMA, STORE_KEY: STORE_KEY, MAX_QUBITS: MAX_QUBITS, MAX_MATRIX_QUBITS: MAX_MATRIX_QUBITS, MAX_OPS: MAX_OPS,
    Catalog: Catalog, catalog: defaultCatalog,
    BASIC: G, basicInfo: basicInfo,
    parseExpr: parseExpr, evalAst: evalAst, astToText: astToText, astToPy: astToPy, astSubst: astSubst, astFold: astFold,
    validateDefinition: validateDefinition, validName: validName, initialOf: initialOf,
    flatten: flatten, buildUnitary: buildUnitary, unitaryOfFlat: unitaryOfFlat, unitaryError: unitaryError, matrixOfBasic: matrixOfBasic,
    matrixToText: matrixToText, matrixToLatex: matrixToLatex, fmtC: fmtC, distancePhaseInvariant: distancePhaseInvariant,
    parsePython: parsePython, pyFromOps: pyFromOps,
    buildPrelude: buildPrelude, injectPrelude: injectPrelude, stripPrelude: stripPrelude, usedGates: usedGates,
    arityOf: arityOf, callFor: callFor, describe: describe, matrixOfGate: matrixOfGate, codeUses: codeUses
  };
  root.QuOLabTheoreticalGates = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
