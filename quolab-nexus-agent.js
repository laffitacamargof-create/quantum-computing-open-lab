/* QNexusAi — unified autonomous agent and universal UI connector v1.5.0 */
(function (global) {
  'use strict';

  const VERSION = '1.5.0';
  // Exactly five tool specialists. Library, Help, and all general Nexus functions
  // remain under the central coordinator rather than becoming separate agents.
  const TOOL_CATALOG = Object.freeze({
 projects:{name:'Projects',purpose:'Published projects, notebooks and learning resources.',how_to:'Search the live catalogue, open the exact resource and verify its title/content.',capabilities:['inspect','navigate','search','open'],screens:['projects'],limits:'Do not claim edits or publication without visible confirmation.'},
 architect:{name:'Quantum Open Lab',purpose:'Visual circuits, Qiskit, measurements, simulation and noise.',how_to:'Inspect circuit, code and engine; build/update; run when requested; inspect actual output/errors.',capabilities:['inspect','navigate','fill','click','run','noise','visual-circuit'],screens:['architect'],limits:'Code insertion is not a simulation; require visible run output.'},
 'architect-pro':{name:'Quantum Notebook',purpose:'Python/Qiskit/Markdown cells, execution and exports.',how_to:'Inspect title, cell types, indices and outputs; preserve unrelated cells; edit/run the right cell; verify output/errors.',capabilities:['inspect','navigate','fill','click','run','cells','python','qiskit','markdown','export'],screens:['architect-pro'],limits:'Never claim execution without visible output; do not assume cell indices.'},
 'quantum-puzzle':{name:'Quantum Puzzle',purpose:'Challenges and published-app catalogue/launcher.',how_to:'Inspect challenges/apps, open exact item, operate visible controls and verify state.',capabilities:['inspect','navigate','fill','click','select','scroll','challenge','published-app-launch'],screens:['quantum-puzzle'],limits:'Do not bypass access or alter shared content without authorization.'},
 'quantum-app-studio':{name:'Quantum App Studio',purpose:'Nested app editor for metadata/code, preview and save.',how_to:'Open from Puzzle, inspect fields/tabs, edit, preview, inspect errors and save when requested.',capabilities:['inspect','navigate','fill','click','select','scroll','create-app','edit-app','preview','save'],screens:['quantum-app-studio'],limits:'Do not claim saved from text insertion. Publishing/deleting/overwriting requires confirmation.'}
 });
 const CENTRAL_SCREENS = Object.freeze(['library','help']);
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
    const item = { id: screen, name: TOOL_CATALOG[screen]?.name || screen, loaded: false };
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
          selector: '',
          label: cleanText(label || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '', 90)
        };
        const sensitiveField = SENSITIVE.test([descriptor.id, descriptor.name, descriptor.label, descriptor.type].join(' '));
        descriptor.selector = sensitiveField ? '' : selectorFor(el);
        if (!sensitiveField) {
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
          aria_label: cleanText(el.getAttribute('aria-label') || '', 80),
          selector: selectorFor(el),
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
    const managedScreens = Object.keys(TOOL_CATALOG).concat(CENTRAL_SCREENS);
    const tools = managedScreens.map(id => {
      const frame = frameFor(id);
      const spec = TOOL_CATALOG[id];
      return Object.assign({
        id,
        tool_name: spec ? spec.name : 'QNexusAi',
        capabilities: spec ? spec.capabilities : ['inspect','navigate','explain','diagnose']
      }, frame ? describeFrame(id, frame) : { loaded: false });
    });
    const activeTool = tools.find(tool => tool.id === active) || null;
    return {
      identity: 'QNexusAi',
      version: VERSION,
      mode: 'single_autonomous_agent',
      language: navigator.language || 'auto',
      active_tool: active,
      active_tool_name: activeTool ? activeTool.tool_name : 'QNexusAi',
      tools,
      tool_catalog: Object.keys(TOOL_CATALOG).map(id => ({ id, name: TOOL_CATALOG[id].name, purpose: TOOL_CATALOG[id].purpose, how_to: TOOL_CATALOG[id].how_to, workflow: TOOL_CATALOG[id].workflow, capabilities: TOOL_CATALOG[id].capabilities, limits: TOOL_CATALOG[id].limits })),
      recent_events: recentEvents.slice(-20),
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
    const record = {
      time: new Date().toISOString(),
      from: cleanText(details.tool || (frame ? frame.getAttribute('data-openq') : 'nexus'), 60),
      type: type,
      kind: cleanText(nestedKind, 60),
      details: cleanText(JSON.stringify(details.details || details), 1000),
      status: /ERROR|FAIL|REJECT/i.test(type) || /error/i.test(nestedKind) ? 'error' : /RESULT|OUTPUT|SUCCESS|READY/i.test(type) || /response|output|result/i.test(nestedKind) ? 'result' : 'event'
    };
    recentEvents.push(record);
    if (recentEvents.length > MAX_EVENTS) recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
    if (record.status === 'error') {
      const nestedDetails = details.details && typeof details.details === 'object' ? details.details : {};
      const detailMessage = details.message || details.error || nestedDetails.message || nestedDetails.error || nestedKind || type;
      global.dispatchEvent(new CustomEvent('quolab:nexus-alert', {
        detail: { tool: record.from, kind: record.kind, message: cleanText(detailMessage, 240) }
      }));
    }
  }
  global.addEventListener('message', recordMessage, true);

  function validSelector(selector) {
    return typeof selector === 'string' && selector.length <= 140 &&
      (/^#[A-Za-z][\w:.-]*$/.test(selector) ||
       /^\[name="[A-Za-z0-9_.:-]{1,80}"\]$/.test(selector) ||
       /^\[data-[a-z0-9_-]+="[A-Za-z0-9_.:-]{1,80}"\]$/.test(selector) ||
       /^\[(?:aria-label|placeholder|title)="[A-Za-z0-9 _.,:;()\/-]{1,80}"\]$/.test(selector));
  }

  function selectorFor(el) {
    if (el.id && /^[A-Za-z][\w:.-]*$/.test(el.id)) return '#' + el.id;
    const name = el.getAttribute('name') || '';
    if (/^[A-Za-z0-9_.:-]{1,80}$/.test(name)) return '[name="' + name + '"]';
    for (const attr of ['aria-label','placeholder','title']) {
      const value = el.getAttribute(attr) || '';
      if (/^[A-Za-z0-9 _.,:;()\/-]{1,80}$/.test(value)) return '[' + attr + '="' + value + '"]';
    }
    return '';
  }

  function executeUIAction(action) {
    if (!action || (!TOOL_CATALOG[action.screen] && !CENTRAL_SCREENS.includes(action.screen)) || !validSelector(action.selector) || (action.operation === 'drag' && !validSelector(action.targetSelector))) {
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
      const dangerous = /delete|remove|publish|approve|reject|purchase|payment|reset|clear|overwrite|disconnect|logout/i.test(label + ' ' + (el.id || ''));
      if (dangerous && !global.confirm('QNexusAi requests a potentially sensitive action: ' + label + '. Continue?')) {
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
    identity: 'QNexusAi',
    collectContext: snapshot,
    executeUIAction,
    getRecentEvents: () => recentEvents.slice()
  });
})(window);
