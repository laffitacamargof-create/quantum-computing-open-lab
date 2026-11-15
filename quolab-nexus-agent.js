/* QNexusAi — unified autonomous agent and universal UI connector v1.6.0 */
(function (global) {
  'use strict';

  const VERSION = '1.6.0';
  // One agent, seven module interfaces. This catalog is the operating manual QNexusAi receives.
  const TOOL_CATALOG = Object.freeze({
    projects:{name:'Projects',purpose:'Browse, search, open and study published projects, notebooks and learning resources.',how_to:'Inspect live catalogue and filters; search by topic; open the exact result; verify its title and rendered content.',workflow:['inspect catalogue','search/filter','open exact resource','verify content'],capabilities:['inspect','search','filter','navigate','open','read-visible-content'],inputs:['search terms','visible filters','resource IDs from context'],outputs:['result list','resource title','rendered content'],screens:['projects'],limits:'Read-only unless a visible supported edit exists; never claim edits or publication without confirmation.'},
    architect:{name:'Quantum Open Lab',purpose:'Design visual quantum circuits, edit code, configure engines, measurements and noise, and run supported simulations.',how_to:'Inspect circuit, code, qubit/gate counts, engine and settings; edit requested elements; configure shots/noise/backend; run; inspect actual result or error.',workflow:['inspect circuit and engine','build/edit gates or code','configure backend/shots/noise','run simulator','verify fresh output'],capabilities:['inspect','navigate','visual-circuit','code-edit','configure','select-engine','noise','run','read-results','ui-controls'],inputs:['circuit description','QASM/Python','qubit/gate settings','shots','noise schema','engine'],outputs:['circuit state','measurement counts','simulation/noise results','runtime errors'],screens:['architect'],limits:'Code insertion or dispatch acknowledgement is not a simulation result. Require fresh simulator output; do not invent unsupported operations.'},
    'architect-pro':{name:'Quantum Notebook',purpose:'Create/manage Python, Qiskit, circuit and Markdown cells; execute cells and export notebooks.',how_to:'Inspect notebook ID/title and all cell indices/types/code/outputs; preserve unrelated cells; add/edit correct cell; run in dependency order; verify output/errors; export only through a visible export function.',workflow:['inspect notebook and cells','identify exact indices/types','add/edit without overwriting unrelated cells','execute required cells','verify output/errors','export if requested'],capabilities:['inspect','navigate','python','qiskit','markdown','cells','edit','add-cell','open-circuit-editor','run-cell','read-output','export','ui-controls'],inputs:['notebook ID','cell index/type','source code','execution request'],outputs:['cell source','execution status','stdout/result/error','export acknowledgement'],screens:['architect-pro'],limits:'Never assume cell indices. Code insertion is not execution. Do not claim save/export without visible confirmation.'},
    'quantum-puzzle':{name:'Quantum Puzzle',purpose:'Explore and solve quantum challenges, browse published apps and launch App Studio.',how_to:'Inspect challenge/app lists and selection; open exact item; use visible controls; verify challenge state or app launch.',workflow:['inspect challenge/app catalogue','open exact item','operate visible challenge controls','verify state or launch Studio'],capabilities:['inspect','navigate','search-visible-items','open-challenge','solve-challenge','launch-app','fill','click','select','scroll','ui-controls'],inputs:['challenge/app ID from live context','answers/control values'],outputs:['challenge feedback/state','selected app','Studio launch state'],screens:['quantum-puzzle'],limits:'Do not bypass access controls or alter shared content without authorization.'},
    'quantum-app-studio':{name:'Quantum App Studio',purpose:'Create/edit app metadata and code, preview behavior and save from nested Studio inside Puzzle.',how_to:'Open Studio from Puzzle; inspect tabs, metadata, editor and preview; edit requested fields; run preview; inspect errors; save only when requested and verify acknowledgement.',workflow:['open selected app in Studio','inspect tabs/metadata/code/preview','edit requested content','run preview and inspect errors','save and verify if requested'],capabilities:['inspect','navigate','metadata-edit','code-edit','create-app','edit-app','preview','run-preview','save','fill','click','select','scroll','ui-controls'],inputs:['app ID','metadata','app code','preview request'],outputs:['metadata/code','preview/errors','save acknowledgement'],screens:['quantum-app-studio'],limits:'Preview is not publication. Shared app publishing/deletion/overwrite requires authorization and visible confirmation.'},
    library:{name:'Library',purpose:'Find and open saved learning resources, references and library materials.',how_to:'Inspect search/categories/items; search by title or topic; open exact item; verify contents and metadata.',workflow:['inspect categories/search','search resource','open exact item','verify content'],capabilities:['inspect','search','filter','navigate','open','read-visible-content','ui-controls'],inputs:['query','category/filter','item ID from context'],outputs:['matching resources','opened resource content'],screens:['library'],limits:'Do not claim upload, deletion or edits unless the UI exposes and confirms them.'},
    help:{name:'Help',purpose:'Read ecosystem guidance, documentation, tutorials and tool instructions.',how_to:'Search visible help topics; open relevant guide; use it to ground tool operation; distinguish documented capability from unavailable controls.',workflow:['inspect help index','search topic/error','open guide','apply instructions in target module','verify target action separately'],capabilities:['inspect','search','navigate','open','read-visible-content','ui-controls'],inputs:['topic or error message'],outputs:['documentation','troubleshooting guidance'],screens:['help'],limits:'Reading instructions does not execute the described operation.'}
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
        capabilities: spec ? spec.capabilities : ['inspect','navigate','search','open','read-visible-content','diagnose']
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
      tool_catalog: Object.keys(TOOL_CATALOG).map(id => ({ id, ...TOOL_CATALOG[id] })),
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
