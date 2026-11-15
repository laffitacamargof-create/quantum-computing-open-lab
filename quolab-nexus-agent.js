/* QuOLab Nexus AI — central coordinator and universal UI connector v1.2.0 */
(function (global) {
  'use strict';

  const VERSION = '1.2.1';
  // Exactly five tool specialists. Library, Help, and all general Nexus functions
  // remain under the central coordinator rather than becoming separate agents.
  const TOOL_SPECS = Object.freeze({
    projects: { name: 'Projects Specialist', role: 'Find and open published projects and notebooks; inspect project metadata and results.', capabilities: ['inspect','navigate','open'] },
    architect: { name: 'Quantum Open Lab Specialist', role: 'Design and inspect quantum circuits, gates, Qiskit code, measurements, simulation and noise in Quantum Open Lab.', capabilities: ['inspect','navigate','fill','click','run','noise'] },
    'architect-pro': { name: 'Quantum Notebook Specialist', role: 'Work with notebook cells, Python and quantum code, markdown, execution, outputs and exports.', capabilities: ['inspect','navigate','fill','click','run'] },
    'quantum-puzzle': { name: 'Quantum Puzzle Specialist', role: 'Explore and operate Quantum Puzzle challenges, published puzzles and their user-facing controls.', capabilities: ['inspect','navigate','fill','click','select','scroll'] },
    'quantum-app-studio': { name: 'Quantum App Studio Specialist', role: 'Create, edit, preview and manage quantum applications in Quantum App Studio.', capabilities: ['inspect','navigate','fill','click','select','scroll'] }
  });
  const CENTRAL_SCREENS = Object.freeze(['library','help']);
  const SPECIALIST_INSTRUCTIONS = Object.freeze({
    projects: 'You are the Projects Specialist. Scope: published projects, notebooks, PDFs, videos, project metadata, search and opening project resources. Inspect the supplied project screen and context. Do not claim to edit or publish project records unless a supported action is explicitly available. Return findings, exact next steps, and only safe UI actions supported by context.',
    architect: 'You are the Quantum Open Lab Specialist. Scope: quantum circuit construction, gates, Qiskit code, measurement, simulation, noise models, and circuit diagnostics. Preserve the current circuit unless the user asks to replace it. Validate qubit/gate limits and explain simulation assumptions. Return tested reasoning, code where requested, and safe UI actions.',
    'architect-pro': 'You are the Quantum Notebook Specialist. Scope: notebook cells, Python/Qiskit code, Markdown, execution outputs, errors, and exports. Preserve unrelated cells. Use cell indices only when present in context. Never claim code ran unless an execution result confirms it. Return precise cell-scoped changes and safe UI actions.',
    'quantum-puzzle': 'You are the Quantum Puzzle Specialist. Scope: puzzle catalogue, challenge state, puzzle interactions, and published puzzle applications. Do not bypass access checks or alter published content without explicit user approval. Return grounded findings and safe UI actions.',
    'quantum-app-studio': 'You are the Quantum App Studio Specialist. Scope: creating, editing, previewing, and managing applications inside the nested App Studio iframe. Inspect only controls and state supplied in context. Do not publish, delete, overwrite, or approve without explicit user confirmation. Return exact app changes and safe UI actions.'
  });
  const delegationRuns = [];
  function recordDelegation(specialist, status, summary) {
    if (!Object.prototype.hasOwnProperty.call(TOOL_SPECS, specialist)) return null;
    const spec = TOOL_SPECS[specialist];
    const item = { specialist, name: spec.name, status: cleanText(status, 30), summary: cleanText(summary, 320), at: new Date().toISOString() };
    delegationRuns.push(item);
    if (delegationRuns.length > 20) delegationRuns.shift();
    return Object.assign({}, item);
  }
  const SENSITIVE = /password|passphrase|secret|token|api.?key|private.?key|credential|founder|authorization|cookie|session/i;
  const EVENT_ALLOW = /^(OPENQ|NEXUS|QCOL)_[A-Z0-9_]+$/;
  const recentEvents = [];
  const MAX_EVENTS = 40;

  function cleanText(value, limit) {
    return String(value == null ? '' : value)
      .replace(/(?:sb_secret_|sk[-_](?:proj[-_]|live_|test_)?|ghp_|gho_|github_pat_|AIza|xox[baprs]-|glpat-|npm_)[A-Za-z0-9_\-]{8,}/g, '[REDACTED]')
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]')
      .slice(0, limit || 500);
  }

  function activeScreen() {
    const puzzleFrame = frameFor('quantum-puzzle');
    try {
      const modal = puzzleFrame && puzzleFrame.contentDocument && puzzleFrame.contentDocument.getElementById('studioModalReal');
      if (modal && modal.classList.contains('open')) return 'quantum-app-studio';
    } catch (_) {}
    const el = document.querySelector('.screen.active');
    return el ? el.id.replace(/^screen-/, '') : 'home';
  }

  function frameFor(screen) {
    if (screen === 'quantum-app-studio') {
      const puzzle = Array.from(document.querySelectorAll('iframe.module-iframe[data-openq]'))
        .find(frame => frame.getAttribute('data-openq') === 'quantum-puzzle');
      try { return puzzle && puzzle.contentDocument && puzzle.contentDocument.getElementById('studioIframe') || null; }
      catch (_) { return null; }
    }
    return Array.from(document.querySelectorAll('iframe.module-iframe[data-openq]'))
      .find(frame => frame.getAttribute('data-openq') === screen) || null;
  }

  function describeFrame(screen, frame) {
    const item = { id: screen, name: TOOL_SPECS[screen]?.name || screen, loaded: false };
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.documentElement) return item;
      item.loaded = doc.readyState === 'complete' || doc.readyState === 'interactive';
      item.title = cleanText(doc.title, 100);
      item.url = cleanText(frame.getAttribute('src') || '', 180);
      const active = doc.activeElement;
      if (active && active !== doc.body && active !== doc.documentElement) {
        item.focused = { tag: active.tagName.toLowerCase(), id: active.id || '', name: active.getAttribute('name') || '' };
      }
      const inputs = [];
      for (const el of Array.from(doc.querySelectorAll('input,textarea,select,[contenteditable="true"]')).slice(0, 45)) {
        if (el.type === 'hidden' || el.disabled) continue;
        const label = el.labels && el.labels.length ? el.labels[0].innerText : '';
        const descriptor = {
          tag: el.tagName.toLowerCase(),
          type: el.type || (el.tagName.toLowerCase() === 'select' ? 'select' : 'text'),
          id: el.id || '',
          name: el.getAttribute('name') || '',
          label: cleanText(label || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '', 90)
        };
        if (!SENSITIVE.test([descriptor.id, descriptor.name, descriptor.label, descriptor.type].join(' '))) {
          if (el.tagName === 'SELECT') descriptor.value = cleanText(el.options[el.selectedIndex]?.text || '', 100);
          else descriptor.value = cleanText(el.value || el.innerText || '', 180);
        } else descriptor.value = '[REDACTED]';
        inputs.push(descriptor);
      }
      item.inputs = inputs;
      item.buttons = Array.from(doc.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'))
        .filter(el => !el.disabled)
        .slice(0, 50)
        .map(el => ({
          text: cleanText(el.innerText || el.value || el.getAttribute('aria-label') || '', 100),
          id: el.id || '',
          name: el.getAttribute('name') || '',
          disabled: !!el.disabled
        }));
      const outputs = [];
      for (const el of Array.from(doc.querySelectorAll('pre,output,[aria-live="polite"],[aria-live="assertive"],[id*="output" i],[class*="output" i],[id*="result" i],[class*="result" i]')).slice(0, 25)) {
        const value = cleanText(el.innerText || el.textContent || '', 900);
        if (value && !SENSITIVE.test((el.id || '') + ' ' + (el.className || ''))) outputs.push(value);
      }
      item.outputs = outputs.slice(0, 12);
    } catch (_) {
      item.cross_origin_or_unavailable = true;
    }
    return item;
  }

  function snapshot(base) {
    const active = activeScreen();
    const managedScreens = Object.keys(TOOL_SPECS).concat(CENTRAL_SCREENS);
    const tools = managedScreens.map(id => {
      const frame = frameFor(id);
      const spec = TOOL_SPECS[id];
      return Object.assign({
        id,
        specialist: spec ? spec.name : 'QuOLab Nexus AI — central coordinator',
        capabilities: spec ? spec.capabilities : ['inspect','navigate','explain','diagnose']
      }, frame ? describeFrame(id, frame) : { loaded: false });
    });
    const activeTool = tools.find(tool => tool.id === active) || null;
    return {
      identity: 'QuOLab Nexus AI',
      version: VERSION,
      mode: 'central_coordinator_with_tool_specialists',
      language: navigator.language || 'auto',
      active_tool: active,
      active_specialist: activeTool ? activeTool.specialist : 'QuOLab Nexus AI — central coordinator',
      tools,
      recent_events: recentEvents.slice(-20),
      specialist_runs: delegationRuns.slice(-8),
      user_context: base || {}
    };
  }

  function recordMessage(event) {
    try { if (global.localStorage.getItem('openq_ai_ctx') === '0') return; } catch (_) {}
    if (event.origin !== global.location.origin || !event.data || typeof event.data !== 'object') return;
    const type = event.data.type;
    if (typeof type !== 'string' || !EVENT_ALLOW.test(type)) return;
    const frame = Array.from(document.querySelectorAll('iframe.module-iframe[data-openq]'))
      .find(item => item.contentWindow === event.source);
    const details = event.data.details || {};
    const nestedKind = details.kind || event.data.kind || '';
    recentEvents.push({
      time: new Date().toISOString(),
      from: cleanText(details.tool || (frame ? frame.getAttribute('data-openq') : 'nexus'), 60),
      type: type,
      kind: cleanText(nestedKind, 60),
      details: cleanText(JSON.stringify(details.details || details), 1000),
      status: /ERROR|FAIL|REJECT/i.test(type) || /error/i.test(nestedKind) ? 'error' : /RESULT|OUTPUT|SUCCESS|READY/i.test(type) || /response|output|result/i.test(nestedKind) ? 'result' : 'event'
    });
    if (recentEvents.length > MAX_EVENTS) recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
  }
  global.addEventListener('message', recordMessage, true);

  function validSelector(selector) {
    return typeof selector === 'string' && selector.length <= 140 &&
      (/^#[A-Za-z][\w:.-]*$/.test(selector) ||
       /^\[name="[A-Za-z0-9_.:-]{1,80}"\]$/.test(selector) ||
       /^\[data-[a-z0-9_-]+="[A-Za-z0-9_.:-]{1,80}"\]$/.test(selector));
  }

  function executeUIAction(action) {
    if (!action || (!TOOL_SPECS[action.screen] && !CENTRAL_SCREENS.includes(action.screen)) || !validSelector(action.selector) || (action.operation === 'drag' && !validSelector(action.targetSelector))) {
      return { ok: false, message: 'Invalid tool or selector.' };
    }
    const frame = frameFor(action.screen);
    if (!frame || !frame.contentDocument) return { ok: false, message: 'Open the requested tool first.' };
    let el;
    try { el = frame.contentDocument.querySelector(action.selector); } catch (_) {}
    if (!el) return { ok: false, message: 'The requested control was not found in the current tool.' };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, message: 'The control is disabled.' };
    if (!el.getClientRects().length || global.getComputedStyle(el).visibility === 'hidden') return { ok: false, message: 'The control is not visible.' };
    const label = cleanText(el.innerText || el.value || el.getAttribute('aria-label') || '', 100);
    const operation = action.operation;
    if (operation === 'fill' || operation === 'type' || operation === 'select') {
      if (el.type === 'password' || SENSITIVE.test([el.id, el.name, el.getAttribute('placeholder'), label].join(' '))) {
        return { ok: false, message: 'Sensitive fields cannot be read or filled by the agent.' };
      }
      if (typeof action.value !== 'string' || action.value.length > 4000) return { ok: false, message: 'Invalid value.' };
      if (operation === 'select' && el.tagName !== 'SELECT') return { ok: false, message: 'The target is not a select control.' };
      if ((operation === 'fill' || operation === 'type') && !['INPUT','TEXTAREA'].includes(el.tagName) && !el.isContentEditable) return { ok: false, message: 'The target is not an editable field.' };
      el.focus();
      if (el.isContentEditable) el.innerText = action.value;
      else {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        if (setter) setter.call(el, action.value); else el.value = action.value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, message: 'Field updated.', label };
    }
    if (operation === 'click') {
      const dangerous = /delete|remove|publish|approve|reject|submit|purchase|payment|reset|clear|overwrite|disconnect|logout/i.test(label + ' ' + (el.id || ''));
      if (dangerous && !global.confirm('QuOLab Nexus AI requests a potentially sensitive action: ' + label + '. Continue?')) {
        return { ok: false, message: 'Action cancelled by user.' };
      }
      el.click();
      return { ok: true, message: 'Control activated.', label };
    }
    if (operation === 'hover') {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: global }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: global }));
      return { ok: true, message: 'Pointer hover simulated.', label };
    }
    if (operation === 'key') {
      const allowedKeys = ['Enter','Escape','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown',' '];
      if (!allowedKeys.includes(action.key)) return { ok: false, message: 'Keyboard key is not allowed.' };
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: action.key, bubbles: true, cancelable: true }));
      return { ok: true, message: 'Keyboard action sent.', label };
    }
    if (operation === 'drag') {
      const target = frame.contentDocument.querySelector(action.targetSelector);
      if (!target || target.disabled || !target.getClientRects().length) return { ok: false, message: 'Drop target is unavailable.' };
      if (typeof global.DataTransfer !== 'function') return { ok: false, message: 'Drag and drop is not supported by this browser.' };
      const transfer = new global.DataTransfer();
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      el.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return { ok: true, message: 'Drag-and-drop sequence dispatched.', label };
    }
    if (operation === 'scroll') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const dx = Number.isFinite(action.deltaX) ? Math.max(-1000, Math.min(1000, action.deltaX)) : 0;
      const dy = Number.isFinite(action.deltaY) ? Math.max(-1000, Math.min(1000, action.deltaY)) : 0;
      if (dx || dy) el.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      return { ok: true, message: 'Control brought into view and scrolled.', label };
    }
    return { ok: false, message: 'Unsupported UI operation.' };
  }

  global.QuOLabNexusAgent = Object.freeze({
    version: VERSION,
    identity: 'QuOLab Nexus AI',
    specialists: TOOL_SPECS,
    getSpecialistInstructions: id => SPECIALIST_INSTRUCTIONS[id] || null,
    recordDelegation,
    getRecentDelegations: () => delegationRuns.slice(),
    collectContext: snapshot,
    executeUIAction,
    getRecentEvents: () => recentEvents.slice()
  });
})(window);
