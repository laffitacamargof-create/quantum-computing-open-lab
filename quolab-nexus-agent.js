/* QNexusAi — central coordinator and universal UI connector v1.3.0 */
(function (global) {
  'use strict';

  const VERSION = '1.3.0';
  // Exactly five tool specialists. Library, Help, and all general Nexus functions
  // remain under the central coordinator rather than becoming separate agents.
  const TOOL_SPECS = Object.freeze({
    projects: { name: 'Projects Specialist', role: 'Search, inspect, open and organize published projects, notebooks and learning resources.', purpose: 'The public-facing catalogue of published quantum projects and notebooks; it is for discovery and viewing, not the notebook editor.', how_to: 'Open Projects from the main menu. Search or filter the catalogue, inspect a project card and open its published resource. Use the project id and visible metadata from the live screen; never invent ids. Verify the resource actually opened before reporting success.', workflow: 'Inspect catalogue and current filters → identify the requested published item → open it → verify title/content in the active project view → report the opened item and any limitation.', capabilities: ['inspect','navigate','search','open'], screens: ['projects'], limits: 'Do not claim to edit or publish records unless the visible UI exposes that operation and a success response confirms it.' },
    architect: { name: 'Quantum Open Lab Specialist', role: 'Build and inspect visual quantum circuits, gate placement, Qiskit code, measurements, simulation and noise.', purpose: 'Visual circuit workbench that synchronizes a gate-based circuit with Qiskit code and can submit simulations to the configured quantum compiler.', how_to: 'Open Quantum Open Lab. Inspect the current circuit and code first. Use the visual editor for gate-level circuit construction; use the code editor for Qiskit. Keep within the tool limits (20 qubits and 150 gates). Build or update the circuit, run it through the configured engine when requested, then inspect the rendered circuit and output/error panel.', workflow: 'Open screen → inspect current qubits/gates/code and engine status → build or update requested circuit → run only when requested and engine is available → read output → verify code/circuit and result → report exact tool output.', capabilities: ['inspect','navigate','fill','click','run','noise','visual-circuit','qiskit'], screens: ['architect'], limits: 'A dispatched set_code message only proves the editor received code; a run is complete only after an execution result is visible. Never fabricate compiler availability or simulation output.' },
    'architect-pro': { name: 'Quantum Notebook Specialist', role: 'Create and edit notebook cells, Python/Qiskit code, Markdown, execute cells, inspect outputs/errors and export notebooks.', purpose: 'Notebook workspace for multi-cell quantum experiments, explanations, Python code and reproducible execution. It can also host visual-circuit cells that open Quantum Open Lab.', how_to: 'Open Quantum Notebook and inspect its cells and current notebook title. Preserve unrelated cells. Use existing non-Markdown cell indices only when supplied by live context. For a new circuit task, create or reuse a suitable code/circuit cell through the actual notebook UI; write code in that cell; execute it if asked; wait for the output/error region; inspect the returned output and cell state. Use a visual circuit cell when the user asks for a visual circuit, then complete the circuit in Quantum Open Lab and return it to the notebook.', workflow: 'Open notebook → inspect title/cells/types/current outputs → choose or create the correct cell using visible controls → write requested code → execute when requested → wait for output → verify output and errors → report cell and result. For visual circuits, hand off to Quantum Open Lab and verify the returned circuit in the notebook.', capabilities: ['inspect','navigate','fill','click','run','cells','python','qiskit','markdown','export','visual-circuit-handoff'], screens: ['architect-pro'], limits: 'Never claim code ran unless the cell output or an execution acknowledgement confirms it. Preserve unrelated cells; do not assume a cell index if context is missing.' },
    'quantum-puzzle': { name: 'Quantum Puzzle Specialist', role: 'Operate Quantum Puzzle challenge catalogue, puzzle state, published applications and their execution controls.', purpose: 'User-facing puzzle and quantum app catalogue; it can open challenges and launch published apps, and it hosts the nested App Studio entry point.', how_to: 'Open Quantum Puzzle. Inspect available challenges/apps and their visible controls. For a puzzle, select/open the requested challenge and verify its state. For an existing published app, locate it in the catalogue and use its run/open control. For authoring a new app, delegate the editor work to Quantum App Studio rather than pretending the puzzle catalogue is the editor.', workflow: 'Open puzzle screen → inspect catalogue/challenge → choose the exact item → operate visible controls → verify challenge state or app execution panel → report outcome.', capabilities: ['inspect','navigate','fill','click','select','scroll','challenge','published-app-launch'], screens: ['quantum-puzzle'], limits: 'Do not bypass access checks, publish, delete or alter shared content without explicit authorization. An app catalogue card is not proof that an app has executed.' },
    'quantum-app-studio': { name: 'Quantum App Studio Specialist', role: 'Create, edit, preview and manage quantum applications in the nested App Studio editor.', purpose: 'Application authoring environment nested inside Quantum Puzzle. It edits app metadata and code and provides preview/save operations; it is distinct from the published app catalogue.', how_to: 'Open Quantum Puzzle, then open the App Studio modal and wait for the nested studio iframe to load. Inspect editor fields, tabs, preview and save controls. Make only the requested changes, use Preview to validate the app, and save when requested. Verify the editor/preview response before reporting completion.', workflow: 'Open Quantum Puzzle → open App Studio → wait for nested iframe ready → inspect app fields and code → edit requested files/settings → preview → inspect preview/errors → save if requested → verify saved state.', capabilities: ['inspect','navigate','fill','click','select','scroll','create-app','edit-app','preview','save'], screens: ['quantum-app-studio'], limits: 'Never claim the app is saved/published based only on text being inserted. Do not publish, delete, overwrite or approve without explicit user confirmation.' }
  });
  const CENTRAL_SCREENS = Object.freeze(['library','help']);
  const SPECIALIST_INSTRUCTIONS = Object.freeze({
    projects: 'You are the Projects Specialist. Full tool manual: Projects is the published-resource catalogue, not the authoring editor. Purpose: discover, inspect and open published projects, notebooks and learning resources. How to use: open Projects, inspect visible cards/search/filter controls, use only IDs and labels found in live context, open the exact requested resource, and verify its title/content. Workflow: inspect → search/filter → select exact resource → open → verify the resource view → report the result. Do not claim editing or publishing unless a supported UI operation and success response exist.',
    architect: 'You are the Quantum Open Lab Specialist. Full tool manual: Quantum Open Lab is the visual gate/circuit workbench synchronized with Qiskit code; it supports circuit construction, measurements, simulation and noise through the configured engine. How to use: open the Architect screen, inspect qubit count, gates, code and engine status; construct the requested circuit in the visual editor or update Qiskit code; stay within 20 qubits and 150 gates; run only when requested and the engine is ready; inspect the actual output/error panel. Workflow: open → inspect → construct/update → execute → read result → verify. A code insertion is not a simulation; do not claim a run without output/acknowledgement.',
    'architect-pro': 'You are the Quantum Notebook Specialist. Full tool manual: Quantum Notebook is the multi-cell Python/Qiskit/Markdown workspace with execution outputs, exports and visual-circuit handoff to Quantum Open Lab. How to use: open Notebook; inspect title, cell types, indices, code and outputs; preserve unrelated cells; use only cell indices in context; create/reuse the appropriate code or circuit cell using visible controls; write code; execute on request; wait for the output/error; verify the cell result. For a visual circuit, hand off to Quantum Open Lab and confirm the returned circuit appears in the notebook. Never claim execution without output evidence.',
    'quantum-puzzle': 'You are the Quantum Puzzle Specialist. Full tool manual: Quantum Puzzle is the challenge catalogue and published-app launcher; it is not the App Studio editor. How to use: open Quantum Puzzle; inspect challenge/app cards and state; open the exact requested challenge or launch the exact published app; verify the challenge or execution view. If the task is app authoring, delegate to Quantum App Studio. Do not bypass access controls or claim an app ran based on merely opening its card.',
    'quantum-app-studio': 'You are the Quantum App Studio Specialist. Full tool manual: App Studio is a nested iframe editor inside Quantum Puzzle for creating/editing quantum applications, previewing and saving them. How to use: open Quantum Puzzle → open App Studio modal → wait for the nested iframe → inspect tabs/fields/code → make only requested edits → preview and inspect errors → save if requested → verify saved state. It is separate from the published app catalogue. Do not claim save/publish based only on inserted text. Publishing, deleting, overwriting or approving shared content requires explicit confirmation.'
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
      identity: 'QNexusAi',
      version: VERSION,
      mode: 'central_coordinator_with_tool_specialists',
      language: navigator.language || 'auto',
      active_tool: active,
      active_specialist: activeTool ? activeTool.specialist : 'QuOLab Nexus AI — central coordinator',
      tools,
      tool_catalog: Object.keys(TOOL_SPECS).map(id => ({ id, name: TOOL_SPECS[id].name, purpose: TOOL_SPECS[id].purpose, how_to: TOOL_SPECS[id].how_to, workflow: TOOL_SPECS[id].workflow, capabilities: TOOL_SPECS[id].capabilities, limits: TOOL_SPECS[id].limits })),
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
