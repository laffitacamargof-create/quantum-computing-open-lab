/* QuOLab Nexus AI — central coordinator and universal UI connector v1 */
(function (global) {
  'use strict';

  const VERSION = '1.0.0';
  const TOOL_SPECS = Object.freeze({
    projects: { name: 'Projects Specialist', role: 'Find and open published notebooks and projects; explain project metadata and execution results.', capabilities: ['inspect','navigate','open'] },
    architect: { name: 'Architect Specialist', role: 'Build and inspect quantum circuits, Qiskit code, gates, measurements, simulation and noise.', capabilities: ['inspect','navigate','fill','click','run','noise'] },
    'architect-pro': { name: 'Quantum Notebook Specialist', role: 'Work with notebook cells, code, markdown, execution, outputs and exports.', capabilities: ['inspect','navigate','fill','click','run'] },
    library: { name: 'Library Specialist', role: 'Find learning resources, references, tutorials and documents.', capabilities: ['inspect','navigate','search','open'] },
    help: { name: 'Help Specialist', role: 'Explain how to use QuOLab Nexus and troubleshoot its modules.', capabilities: ['inspect','navigate'] },
    'quantum-puzzle': { name: 'Quantum Apps Specialist', role: 'Explore and operate published Quantum Apps and their user-facing controls.', capabilities: ['inspect','navigate','fill','click','select','scroll'] }
  });
  const SENSITIVE = /password|passphrase|secret|token|api.?key|private.?key|credential|founder|authorization|cookie|session/i;
  const EVENT_ALLOW = /^(OPENQ|NEXUS|QCOL)_[A-Z0-9_]+$/;
  const recentEvents = [];
  const MAX_EVENTS = 40;

  function cleanText(value, limit) {
    return String(value == null ? '' : value)
      .replace(/(?:sb_secret_|sk-|ghp_|github_pat_)[A-Za-z0-9_\-]{8,}/g, '[REDACTED]')
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]')
      .slice(0, limit || 500);
  }

  function activeScreen() {
    const el = document.querySelector('.screen.active');
    return el ? el.id.replace(/^screen-/, '') : 'home';
  }

  function frameFor(screen) {
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
    const tools = Object.keys(TOOL_SPECS).map(id => {
      const frame = frameFor(id);
      return Object.assign({ id, specialist: TOOL_SPECS[id].name, capabilities: TOOL_SPECS[id].capabilities }, frame ? describeFrame(id, frame) : { loaded: false });
    });
    const activeTool = tools.find(tool => tool.id === active) || null;
    return {
      identity: 'QuOLab Nexus AI',
      version: VERSION,
      mode: 'central_coordinator_with_tool_specialists',
      language: navigator.language || 'auto',
      active_tool: active,
      active_specialist: activeTool ? activeTool.specialist : 'Nexus Core Coordinator',
      tools,
      recent_events: recentEvents.slice(-20),
      user_context: base || {}
    };
  }

  function recordMessage(event) {
    if (event.origin !== global.location.origin || !event.data || typeof event.data !== 'object') return;
    const type = event.data.type;
    if (typeof type !== 'string' || !EVENT_ALLOW.test(type)) return;
    const frame = Array.from(document.querySelectorAll('iframe.module-iframe[data-openq]'))
      .find(item => item.contentWindow === event.source);
    recentEvents.push({
      time: new Date().toISOString(),
      from: frame ? frame.getAttribute('data-openq') : 'nexus',
      type: type,
      status: /ERROR|FAIL|REJECT/i.test(type) ? 'error' : /RESULT|OUTPUT|SUCCESS|READY/i.test(type) ? 'result' : 'event'
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
    if (!action || !TOOL_SPECS[action.screen] || !validSelector(action.selector)) {
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
    if (operation === 'fill' || operation === 'select') {
      if (el.type === 'password' || SENSITIVE.test([el.id, el.name, el.getAttribute('placeholder'), label].join(' '))) {
        return { ok: false, message: 'Sensitive fields cannot be read or filled by the agent.' };
      }
      if (typeof action.value !== 'string' || action.value.length > 4000) return { ok: false, message: 'Invalid value.' };
      if (operation === 'select' && el.tagName !== 'SELECT') return { ok: false, message: 'The target is not a select control.' };
      if (operation === 'fill' && !['INPUT','TEXTAREA'].includes(el.tagName) && !el.isContentEditable) return { ok: false, message: 'The target is not an editable field.' };
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
    if (operation === 'scroll') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { ok: true, message: 'Control brought into view.', label };
    }
    return { ok: false, message: 'Unsupported UI operation.' };
  }

  global.QuOLabNexusAgent = Object.freeze({
    version: VERSION,
    identity: 'QuOLab Nexus AI',
    specialists: TOOL_SPECS,
    collectContext: snapshot,
    executeUIAction,
    getRecentEvents: () => recentEvents.slice()
  });
})(window);
