'use strict';

const { chromium } = require('playwright');
const { spawn } = require('node:child_process');

const BASE_URL = 'http://127.0.0.1:4173/';

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local QuOLab Nexus server did not start.');
}

async function exerciseProfile(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    deviceScaleFactor: profile.isMobile ? 2 : 1
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  if (profile.blockEditorCDN) {
    await page.route('https://esm.sh/**', route => route.abort());
  }

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() =>
    !!window.QuOLabNexus &&
    document.querySelectorAll('#menu-grid .menu-card').length >= 5 &&
    document.getElementById('splash')?.classList.contains('hidden'),
    undefined,
    { timeout: 20000 }
  );

  const checks = [
    { title: 'QUANTUM OPEN LAB', screen: 'architect', file: 'quolab-nexus-architect.html' },
    { title: 'QUANTUM NOTEBOOK', screen: 'architect-pro', file: 'quolab-nexus-quantum-notebook.html' },
    { title: 'NEXUS CONNECTORS', screen: 'nexus-connectors', file: 'quolab-nexus-connectors.html' },
    { title: 'QUANTUM PUZZLE', screen: 'quantum-puzzle', file: 'quolab-nexus-quantum-puzzle.html' }
  ];

  const results = [];
  for (const item of checks) {
    const card = page.locator('#menu-grid .menu-card').filter({ hasText: item.title }).first();
    if (!(await card.count())) throw new Error(profile.name + ': menu card missing: ' + item.title);
    await card.click();
    await page.waitForFunction(screen =>
      document.getElementById('screen-' + screen)?.classList.contains('active'),
      item.screen,
      { timeout: 5000 }
    );
    const frame = page.locator('#' + item.screen + '-wrap iframe.module-iframe');
    await frame.waitFor({ state: 'attached', timeout: 5000 });
    const src = await frame.getAttribute('src');
    if (!src || !src.includes(item.file)) throw new Error(profile.name + ': wrong iframe route for ' + item.screen + ': ' + src);
    await page.waitForFunction(screen => {
      const iframe = document.querySelector('#' + screen + '-wrap iframe');
      try { return !!iframe && iframe.contentDocument && iframe.contentDocument.readyState === 'complete'; }
      catch (_) { return false; }
    }, item.screen, { timeout: 15000 });

    results.push({ module: item.screen, route: 'ok', iframe: 'loaded' });
    await page.locator('#screen-' + item.screen + ' .btn-back').click();
    await page.waitForFunction(() => document.getElementById('screen-home')?.classList.contains('active'), undefined, { timeout: 5000 });
  }

  if (profile.blockEditorCDN) {
    const mode = await page.locator('#ai-editor').getAttribute('data-editor-mode');
    if (mode !== 'fallback') throw new Error(profile.name + ': expected native editor fallback, got ' + mode);
    if (!(await page.locator('#ai-editor textarea.ai-editor-fallback').count())) {
      throw new Error(profile.name + ': fallback composer is missing.');
    }
  }

  if (pageErrors.length) throw new Error(profile.name + ': browser errors: ' + pageErrors.join(' | '));
  await context.close();
  return { profile: profile.name, viewport: profile.viewport, editorCDNBlocked: profile.blockEditorCDN, results };
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '4173', '--bind', '127.0.0.1'], {
    stdio: 'ignore'
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const results = [];
    results.push(await exerciseProfile(browser, {
      name: 'desktop-1440x900-cdn-blocked',
      viewport: { width: 1440, height: 900 },
      isMobile: false,
      hasTouch: false,
      blockEditorCDN: true
    }));
    results.push(await exerciseProfile(browser, {
      name: 'mobile-390x844-touch',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      blockEditorCDN: false
    }));
    process.stdout.write(JSON.stringify({ status: 'passed', results }, null, 2) + '\\n');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})();
