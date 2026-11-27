'use strict';
/* Prueba de extremo a extremo del enrutamiento de conectores por herramienta.
   Ejecuta los mismos 7 casos en un perfil PC y uno movil y compara los resultados.
   Los conectores y respuestas son simulados (dominios *.test interceptados); no se usan claves reales. */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const BASE = 'http://127.0.0.1:4173/';
const FOUNDER = 'https://founder.test';
const NOTEBOOK = { title: 'QUANTUM NOTEBOOK', screen: 'architect-pro', file: 'quolab-nexus-quantum-notebook.html', tool: 'notebook' };
const OPENLAB = { title: 'QUANTUM OPEN LAB', screen: 'architect', file: 'quolab-nexus-architect.html', tool: 'open_lab' };
const PROFILES = [
  { name: 'pc-1440x900', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, slowCDN: true },
  { name: 'movil-390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, slowCDN: false }
];

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('El servidor local no arranco.');
}

async function bootShell(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.QuOLabNexusConnectors && document.querySelectorAll('#menu-grid .menu-card').length >= 5 &&
    document.getElementById('splash')?.classList.contains('hidden'), undefined, { timeout: 30000 });
}

async function openModule(page, m) {
  const home = await page.locator('#screen-home.active').count();
  if (!home) {
    const activeId = await page.locator('.screen.active').first().getAttribute('id');
    if (activeId && activeId !== 'screen-home') {
      const activeScreen = activeId.replace(/^screen-/, '');
      await closeModule(page, { screen: activeScreen });
    }
  }
  await page.locator('#menu-grid .menu-card').filter({ hasText: m.title }).first().click();
  await page.waitForFunction(s => document.getElementById('screen-' + s)?.classList.contains('active'), m.screen, { timeout: 8000 });
  await page.waitForFunction(s => {
    const f = document.querySelector('#' + s + '-wrap iframe');
    try { return !!f && f.contentDocument.readyState === 'complete' && !!f.contentWindow.QuOLabNexusReady; } catch (_) { return false; }
  }, m.screen, { timeout: 30000 });
}
async function closeModule(page, m) {
  await page.locator('#screen-' + m.screen + ' .btn-back').click();
  await page.waitForFunction(() => document.getElementById('screen-home')?.classList.contains('active'), undefined, { timeout: 8000 });
}

async function call(page, m, opts) {
  const frame = page.frames().find(f => f.url().includes(m.file));
  if (!frame) throw new Error('iframe no encontrado: ' + m.file);
  const t0 = Date.now();
  const out = await frame.evaluate(async o => {
    try {
      await window.QuOLabNexusReady;
      const r = await window.QuOLabNexusCore.api.request('cpu', o);
      return { ok: true, status: r.status, source: r.source, connector: r.connector || null, text: r.text };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, opts);
  out.ms = Date.now() - t0;
  return out;
}

async function runProfile(browser, profile) {
  const context = await browser.newContext({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch, deviceScaleFactor: profile.isMobile ? 2 : 1 });
  const page = await context.newPage();
  const failures = [], jsErrors = [], cases = {}, pending = [];
  const hits = { a: 0, b: 0, founder: 0 };
  const networkTrace = [];
  let behavior = 'ok';
  const check = (name, cond, detail) => { if (!cond) failures.push(profile.name + ' · ' + name + (detail ? ' → ' + JSON.stringify(detail) : '')); };
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('request', req => { try { const u = new URL(req.url()); if (u.hostname.endsWith('.test')) networkTrace.push({ event:'request', url:req.url(), method:req.method() }); } catch (_) {} });
  page.on('response', res => { try { const u = new URL(res.url()); if (u.hostname.endsWith('.test')) networkTrace.push({ event:'response', url:res.url(), status:res.status() }); } catch (_) {} });

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await context.route(/^https:\/\/(a|b|founder)\.test\//, async route => {
    const req = route.request(), url = new URL(req.url()), who = url.hostname.split('.')[0];
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (!url.pathname.endsWith('/route-probe')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
    hits[who]++;
    if (behavior === 'abort') return route.abort('failed');
    if (behavior === 'hang') { pending.push(route); return; }
    if (/^\d+$/.test(behavior)) return route.fulfill({ status: Number(behavior), headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'simulado ' + behavior }) });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ marker: who }) });
  });
  const bridgeHits = [];
  await context.route(/^http:\/\/(127\.0\.0\.1|localhost):8765\//, route => { bridgeHits.push(route.request().url()); return route.abort('connectionrefused'); });
  await context.route('https://esm.sh/**', r => r.abort());
  if (profile.slowCDN) await context.route(/fonts\.(googleapis|gstatic)\.com/, r => setTimeout(() => r.abort(), 3000));

  const resetHits = () => { hits.a = hits.b = hits.founder = 0; };
  const marker = r => { try { return JSON.parse(r.text || '{}').marker || null; } catch (_) { return null; } };

  await bootShell(page);
  await page.evaluate(async url => {
    localStorage.setItem('nexus_colab_url', url);
    const NC = window.QuOLabNexusConnectors;
    const mk = async (name, base) => NC.Store.upsert(await NC.Make.ext({ name, category: 'classical', baseUrl: base, auth: 'apikey', secret: 'clave-de-prueba-no-real', usage: 'always', tools: [] })).id;
    localStorage.setItem('qa_ids', JSON.stringify({ a: await mk('Conector A', 'https://a.test/v1'), b: await mk('Conector B', 'https://b.test/v1') }));
  }, FOUNDER);
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('qa_ids')));
  const name = id => id === ids.a ? 'A' : id === ids.b ? 'B' : id;
  const probe = { method: 'POST', path: '/route-probe', body: { ping: 1 } };

  // Navegacion rapida entre herramientas antes de usar el broker (condiciones de carrera).
  await openModule(page, NOTEBOOK); await closeModule(page, NOTEBOOK); await openModule(page, OPENLAB); await closeModule(page, OPENLAB); await openModule(page, NOTEBOOK);

  // Caso 1: herramienta con conector asignado -> usa ese conector, no Founder.
  await page.evaluate(id => window.QuOLabNexusConnectors.Assignments.bind(id, 'notebook', 'cpu'), ids.a);
  resetHits();
  let r = await call(page, NOTEBOOK, probe);
  cases.caso1 = { source: r.source, conector: name(r.connector), marcador: marker(r) };
  check('caso1 usa conector A', r.ok && r.source === 'nexus' && r.connector === ids.a && marker(r) === 'a', r);
  check('caso1 no toca Founder', hits.founder === 0 && hits.b === 0, hits);

  // Caso 2: sin asignacion -> configuracion general (Founder).
  await page.evaluate(id => window.QuOLabNexusConnectors.Assignments.unbind(id, 'notebook'), ids.a);
  resetHits();
  r = await call(page, NOTEBOOK, probe);
  cases.caso2 = { source: r.source, marcador: marker(r), founderHits: hits.founder, engineUrl: await page.evaluate(() => window.QuOLabNexusCore.getEngineUrl()), trace: networkTrace.slice(-8) };
  check('caso2 usa Founder', r.ok && r.source === 'founder' && marker(r) === 'founder' && hits.founder === 1, Object.assign({}, r, { founderHits: hits.founder, engineUrl: await page.evaluate(() => window.QuOLabNexusCore.getEngineUrl()), trace: networkTrace.slice(-8) }));
  check('caso2 no usa A', hits.a === 0, hits);

  // Caso 3: proveedores distintos por herramienta, sin mezclarse.
  await page.evaluate(x => { const A = window.QuOLabNexusConnectors.Assignments; A.bind(x.a, 'notebook', 'cpu'); A.bind(x.b, 'open_lab', 'cpu'); }, ids);
  resetHits();
  const rn = await call(page, NOTEBOOK, probe);
  await closeModule(page, NOTEBOOK);
  await openModule(page, OPENLAB);
  const ro = await call(page, OPENLAB, probe);
  await closeModule(page, OPENLAB);
  cases.caso3 = { notebook: marker(rn), open_lab: marker(ro) };
  check('caso3 Notebook=A', rn.ok && rn.connector === ids.a && marker(rn) === 'a', rn);
  check('caso3 Open Lab=B', ro.ok && ro.connector === ids.b && marker(ro) === 'b', ro);
  check('caso3 una peticion por proveedor', hits.a === 1 && hits.b === 1 && hits.founder === 0, hits);

  // Caso 4: persistencia tras recargar.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootShell(page);
  await openModule(page, NOTEBOOK);
  const persisted = await page.evaluate(() => { const A = window.QuOLabNexusConnectors.Assignments; return { n: A.get('architect-pro', 'cpu'), o: A.get('architect', 'cpu') }; });
  check('caso4 asignaciones persisten', persisted.n === ids.a && persisted.o === ids.b, persisted);
  resetHits();
  const rn2 = await call(page, NOTEBOOK, probe);
  cases.caso4 = { notebook: name(persisted.n), open_lab: name(persisted.o), marcador: marker(rn2) };
  check('caso4 sigue usando A', rn2.ok && marker(rn2) === 'a' && hits.founder === 0, rn2);
  await closeModule(page, NOTEBOOK);
  await openModule(page, OPENLAB);
  resetHits();
  const ro2 = await call(page, OPENLAB, probe);
  check('caso4 sigue usando B en Open Lab', ro2.ok && marker(ro2) === 'b' && hits.founder === 0, ro2);
  await closeModule(page, OPENLAB);

  // Caso 5: bridge local offline no afecta a los conectores externos ni genera alertas.
  await openModule(page, NOTEBOOK);
  await page.evaluate(() => { window.__alerts = []; window.addEventListener('quolab:nexus-alert', e => window.__alerts.push(e.detail)); });
  await page.evaluate(() => window.QuOLabNexusConnectors.Bridge.ping());
  resetHits();
  const rb = await call(page, NOTEBOOK, probe);
  const alerts = await page.evaluate(() => window.__alerts.map(a => JSON.stringify(a)));
  cases.caso5 = { marcador: marker(rb), alertasBridge: alerts.filter(a => /8765/.test(a)).length };
  check('caso5 conector externo funciona con bridge offline', rb.ok && marker(rb) === 'a', rb);
  check('caso5 sin alertas del bridge', cases.caso5.alertasBridge === 0, alerts);

  // Caso 6: QNexusAi consulta las rutas y elige el conector correcto.
  const route = await page.evaluate(() => {
    const c = window.QuOLabNexusAgent.collectContext({}).connector_routing;
    const pick = (tool, slot) => (c.routes || []).find(x => x.tool === tool && x.slot === slot);
    return { available: c.available, nb: pick('notebook', 'cpu'), ol: pick('open_lab', 'cpu'), puz: pick('apps', 'cpu') };
  });
  cases.caso6 = { disponible: route.available, notebook: route.nb && name(route.nb.connectors[0] && route.nb.connectors[0].id), open_lab: route.ol && name(route.ol.connectors[0] && route.ol.connectors[0].id), puzzle: route.puz && route.puz.source };
  check('caso6 QNexusAi ve las rutas', route.available === true, route);
  check('caso6 Notebook -> A', route.nb && route.nb.source === 'nexus' && route.nb.connectors[0].id === ids.a, route.nb);
  check('caso6 Open Lab -> B', route.ol && route.ol.source === 'nexus' && route.ol.connectors[0].id === ids.b, route.ol);
  check('caso6 Puzzle sin asignar -> founder', route.puz && route.puz.source === 'founder', route.puz);

  // Caso 7: errores diferenciados y sin bucles (una sola peticion por llamada).
  const errors = {};
  for (const status of ['401', '403', '429', '500']) {
    behavior = status; resetHits();
    const e = await call(page, NOTEBOOK, probe);
    const mentions = (e.error || '').includes(status) || String(e.status) === status;
    errors[status] = { ok: e.ok, status: e.status || null, mencionaEstado: mentions, peticiones: hits.a };
    check('caso7 HTTP ' + status + ' diferenciado', mentions && hits.a === 1 && hits.founder === 0, e);
  }
  behavior = 'abort'; resetHits();
  let e = await call(page, NOTEBOOK, probe);
  errors.red = { ok: e.ok, peticiones: hits.a };
  check('caso7 error de red', e.ok === false && hits.a <= 2 && hits.founder === 0, e);
  behavior = 'hang'; resetHits();
  e = await call(page, NOTEBOOK, Object.assign({}, probe, { timeout: 1500 }));
  errors.timeout = { ok: e.ok, ms: e.ms, peticiones: hits.a };
  check('caso7 timeout sin bucle', e.ok === false && e.ms < 15000 && hits.a === 1 && hits.founder === 0, e);
  for (const p of pending) { try { await p.abort('timedout'); } catch (_) {} }
  behavior = 'ok';
  cases.caso7 = errors;

  check('sin errores JavaScript no controlados', jsErrors.length === 0, jsErrors);
  await context.close();
  return { profile: profile.name, viewport: profile.viewport, touch: profile.hasTouch, cases, bridgePeticionesIntentadas: bridgeHits.length, jsErrors, failures };
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '4173', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const results = [];
    for (const p of PROFILES) results.push(await runProfile(browser, p));
    // Los mismos casos deben dar el mismo resultado en PC y movil (se ignoran tiempos).
    const strip = r => JSON.stringify(r.cases, (k, v) => (k === 'ms' ? undefined : v));
    const same = strip(results[0]) === strip(results[1]);
    const failures = results.flatMap(r => r.failures);
    if (!same) failures.push('Los resultados de PC y movil difieren: ' + strip(results[0]) + ' vs ' + strip(results[1]));
    const report = { status: failures.length ? 'failed' : 'passed', pcIgualMovil: same, failures, results };
    const dir = process.env.CI_RESULTS_DIR;
    if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/connector-routing.json', JSON.stringify(report, null, 2)); }
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
})();