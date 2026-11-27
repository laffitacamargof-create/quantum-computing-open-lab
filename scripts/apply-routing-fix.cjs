'use strict';
/* Aplica las correcciones de enrutamiento de conectores de QuOLab Nexus.
   Cada edicion exige exactamente UNA coincidencia; si no, aborta sin escribir nada.
   Es idempotente: si la edicion ya esta aplicada, la omite.
   Uso (desde la raiz del repo):  node scripts/apply-routing-fix.cjs */
const fs = require('node:fs');

const HTML = 'quolab-nexus-connectors.html';
const CORE = 'quolab-nexus-connectors-core.js';
const AGENT = 'quolab-nexus-agent.js';

const edits = [
  // 1. Asignar un conector ya no desasigna los de OTRA categoria (CPU/QPU/storage) de la misma herramienta.
  { file: HTML,
    find: `records.filter(r=>r.id!==id&&r.kind==='ext'&&(r.tools||[]).includes(tool))`,
    replace: `records.filter(r=>r.id!==id&&r.kind==='ext'&&r.ext&&current.ext&&r.ext.category===current.ext.category&&(r.tools||[]).includes(tool))` },
  { file: HTML,
    find: `snapshot.filter(r=>r.kind==='ext'&&r.id!==id&&(r.tools||[]).includes(tool))`,
    replace: `snapshot.filter(r=>r.kind==='ext'&&r.id!==id&&r.ext&&record.ext&&r.ext.category===record.ext.category&&(r.tools||[]).includes(tool))` },

  // 2. Clasificacion de errores (timeout, red, 401/403, 429, 5xx).
  { file: CORE,
    find: `function NexusError(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }`,
    replace: `function NexusError(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }
  const httpKind = (s) => s === 401 || s === 403 ? 'auth' : s === 429 ? 'rate_limit' : s >= 500 ? 'server' : 'client';` },
  { file: CORE,
    find: `('API HTTP ' + r.status), { status: r.status });`,
    replace: `('API HTTP ' + r.status), { status: r.status, kind: httpKind(r.status) });` },
  { file: CORE,
    find: `throw NexusError('network', 'Could not reach ' + new URL(url).host + ' (timeout)');`,
    replace: `throw NexusError(timedOut ? 'timeout' : 'network', 'Could not reach ' + new URL(url).host + (timedOut ? ' (timeout)' : ' (network error or CORS; the optional local bridge was not used)'), { kind: timedOut ? 'timeout' : 'network' });` },

  // 3. El bridge local es opcional: solo se usa como proxy si esta emparejado (hay token).
  { file: CORE,
    find: `if (!timedOut) {`,
    replace: `if (!timedOut && Bridge.cfg().token) {` },

  // 4. Al desasignar, se borra el bloqueo antiguo de Founder: sin conector => configuracion general de Nexus.
  { file: CORE,
    find: `this.set(moduleId, kind, next.length ? (SLOT_RULES[tool][kind] === 1 ? next[0] : next) : 'founder');`,
    replace: `this.set(moduleId, kind, next.length ? (SLOT_RULES[tool][kind] === 1 ? next[0] : next) : 'founder');
      if (!next.length) { try { localStorage.removeItem('nexus_founder_fallback_v1:' + moduleId + ':' + kind); } catch (_) {} }` },

  // 5. API de consulta de rutas (sin secretos) para QNexusAi.
  { file: CORE,
    find: `// Do not publish Vault.open(), key derivation, or raw credential-header helpers.`,
    replace: `function describeRoutes() {
    const routes = [];
    Object.keys(TOOL_MODULE).forEach(tool => {
      const moduleId = TOOL_MODULE[tool], rule = SLOT_RULES[tool] || {};
      Object.keys(rule).forEach(kind => {
        if (!rule[kind]) return;
        const expected = ({ cpu: 'classical', qpu: 'quantum', storage: 'storage' })[kind];
        const value = Assignments.get(moduleId, kind);
        const ids = value === 'founder' ? [] : (Array.isArray(value) ? value : [value]);
        const connectors = ids.map(id => Store.get(id)).filter(Boolean).map(r => ({ id: r.id, name: r.name, category: r.ext && r.ext.category, usage: r.usage, via: r.ext && r.ext.via,
          compatible: !!(r.kind === 'ext' && r.ext && r.ext.category === expected && Policy.allowed(r, tool)) }));
        let source = 'founder', reason = 'No connector assigned; the general Nexus (Founder) configuration applies.';
        if (ids.length) {
          const bad = ids.length !== connectors.length || connectors.some(c => !c.compatible);
          source = bad ? 'unavailable' : 'nexus';
          reason = bad ? 'An assigned connector is missing, disabled or incompatible.' : 'Assigned connector(s) are used; Founder is not used.';
        }
        routes.push({ tool, module: moduleId, tool_name: TOOLS[tool], slot: kind, source, reason, connectors });
      });
    });
    const ai = Store.byKind('ai').filter(r => r.usage !== 'off').slice(0, 1).map(r => ({ id: r.id, name: r.name, provider: r.ai.provider }));
    return { routes, ai_active: ai };
  }
  // Do not publish Vault.open(), key derivation, or raw credential-header helpers.` },
  { file: CORE,
    find: `requestAssigned, validateAssignedRoute, util:`,
    replace: `requestAssigned, validateAssignedRoute, describeRoutes, util:` },

  // 6. QNexusAi: contexto de enrutamiento + el bridge offline deja de contarse como error.
  { file: AGENT,
    find: `  function snapshot(base, options = {}) {`,
    replace: `  function connectorRouting() {
    const rules = [
      '1. Identify the tool you need.',
      '2. Look up that tool and slot in connector_routing.routes.',
      '3. source "nexus": use the listed connector; never Founder.',
      '4. source "founder": no connector is assigned, so the general Nexus configuration is the fallback.',
      '5. source "unavailable": report the concrete reason; do not silently switch to Founder or another connector.',
      '6. Opening or selecting a tool is not execution: verify real output before claiming completion.',
      '7. Report concrete errors (timeout, network, HTTP 401/403/429/500) and never repeat the same diagnostic in a loop.'
    ];
    try {
      const nx = global.QuOLabNexusConnectors;
      if (!nx || typeof nx.describeRoutes !== 'function') return { available: false, rules };
      const described = nx.describeRoutes();
      return { available: true, rules, routes: described.routes, ai_active: described.ai_active };
    } catch (error) { return { available: false, rules, error: cleanText(error && error.message || error, 200) }; }
  }

  function snapshot(base, options = {}) {` },
  { file: AGENT,
    find: `user_context: base || {}`,
    replace: `user_context: base || {},
      connector_routing: connectorRouting()` },
  { file: AGENT,
    find: `    storeEvent(record);`,
    replace: `    if (record.status === 'error' && /(?:127\\.0\\.0\\.1|localhost):8765|bridge-offline|local bridge does not answer/i.test(record.details + ' ' + record.kind)) {
      record.status = 'event';
      record.details = 'Optional local bridge is offline (informational; external API connectors do not depend on it).';
    }
    storeEvent(record);` }
];

const files = {};
for (const e of edits) files[e.file] = files[e.file] ?? fs.readFileSync(e.file, 'utf8');
const report = [];
for (const e of edits) {
  const src = files[e.file];
  const count = src.split(e.find).length - 1;
  if (src.includes(e.replace)) report.push('YA ESTABA ' + e.file + ': ' + e.find.slice(0, 60));
  else if (count === 1) { files[e.file] = src.replace(e.find, () => e.replace); report.push('APLICADO  ' + e.file + ': ' + e.find.slice(0, 60)); }
  else { console.error('ABORTADO: ' + count + ' coincidencias en ' + e.file + ' para: ' + e.find.slice(0, 80)); process.exit(1); }
}
for (const f of Object.keys(files)) fs.writeFileSync(f, files[f]);
console.log(report.join('\n'));