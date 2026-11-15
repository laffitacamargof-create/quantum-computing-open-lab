/* QNexusAi — unified autonomous agent and universal UI connector v1.5.0 */
(function (global) {
  'use strict';

  const VERSION = '1.6.0';
  const TOOL_CATALOG = Object.freeze({
    projects: {
      name: 'Projects',
      purpose: 'Repository of learning and project resources: notebooks, PDFs and videos.',
      workflow: 'Inspect search and active filter; search by title/tags; filter All/Notebooks/PDFs/Videos; open a resource; verify its destination. Resource edit/create/delete is restricted by the app role and founder-key checks.',
      capabilities: ['inspect','search','filter','open-notebook','open-resource','execute-notebook-link','copy-share-link','edit-resource','delete-resource'],
      controls: 'Search input #search; filter controls call setF(all|nb|pdf|video); resource cards expose Open/Execute, Edit, Delete and Copy Link actions. Inspect the live buttons before acting.',
      functions: 'reload, setF, render, execProj, delProj, editProj, updateProj, copyNbLink, nexusDirectLink. Use visible controls; do not call private admin functions or bypass founder-key prompts.',
      how_to: 'Find the exact resource first. Open/execute only the matching item and verify the URL/title or loaded destination. Editing requires role permission; deleting is destructive and needs confirmation.',
      limits: 'No direct AI command API exists in this module; operate its visible UI through the universal connector. Do not invent resource IDs or bypass access checks.'
    },
    architect: {
      name: 'Quantum Open Lab',
      purpose: 'Visual quantum-circuit builder and Qiskit workspace with compiler execution, circuit/code synchronization, measurement visualization and noise experiments.',
      workflow: 'Inspect qubit count, gate list, code, engine status and output. Build via palette/canvas or edit code. Sync visual and code representations, run the compiler, inspect output/errors and elapsed time. For noise, configure model and shots, run experiment, inspect results and compare with ideal output.',
      capabilities: ['visual-circuit','gate-palette','drag-gates','wire-connections','qubit-management','qiskit-code','code-editor','sync-circuit-code','compiler-run','noise-models','bloch-sphere','save-load-circuit','delete-circuit','python-download','notebook-download','execution-queue','resize-panels'],
      controls: 'Important controls: #btn-run and #btn-run2 run; #btn-noise opens noise settings; #btn-noise-run runs quick noise; #btn-sync syncs; #btn-clear clears circuit; #btn-addqb/#btn-remqb change qubits; #code-ta is the code editor; #out-body shows results; #bloch-q-select selects the Bloch qubit; #save-name and #btn-save save; #btn-dlpy/#btn-dlnb export; #btn-run-queue runs the queue.',
      functions: 'buildPalette, placeGate, removeGate, moveExistingGate, renderCircuit, updateCodeFromCircuit, onCodeEdit, forceSync, initPyodide, runServerCode, runCode, fetchWithRetry, drawBloch, updateBlochFromProbs, applyBlochGate, addQubit, removeQubit, clearCircuit, saveCircuit, loadCircuit, deleteCircuit, dlPy, dlNb, saveAndSchedule, runQueue, removeFromQueue, setTab, setMode, setLib, openNoise, quickNoise, returnToNotebook.',
      how_to: 'Use the live canvas/palette controls for visual construction; prefer the module code editor only when code is the requested artifact. Never assume a code write changed the circuit: sync and inspect both. Before execution check engineOK; run only when requested; require fresh output. For noise, specify a supported model and shot count, then verify noise_last/output. Saving/exporting is separate from running.',
      limits: 'The simulator/compiler is the source of scientific results, not the LLM. Current guardrails limit circuits to 20 qubits and 150 gates. A successful code insertion or click is not a simulation result. Clear/delete/save/export are distinct operations.'
    },
    'architect-pro': {
      name: 'Quantum Notebook',
      purpose: 'Notebook environment with Python/Qiskit code cells, visual-circuit cells, Markdown/LaTeX cells, cell outputs, execution engines, noise, persistence and sharing.',
      workflow: 'Inspect notebook title, exposition/read-only state, current cell, cell order/types/code/output and engine. Create or open notebook; add/edit/reorder/convert/restore cells; run selected or all cells; inspect each output and errors; save, import/export or publish only when asked.',
      capabilities: ['notebook-create-open','qiskit-python-cells','visual-circuit-cells','markdown-latex-cells','edit-cells','add-delete-move-cells','change-cell-type','restore-cell','run-cell','run-current','run-all','noise-run','noise-configure','save','import-ipynb','download-ipynb','publish','manage-notebooks','open-visual-editor'],
      controls: 'Important controls: #nb-name-inp title; #btn-add-md/#btn-add-circ add cells; #btn-import and #import-file import; #btn-download export; #btn-save save; #btn-publish publish; #btn-restore-all restore; #btn-run-cur/#btn-run-all execute; #main-area contains cells; each cell has dynamic IDs such as #ta-ID and #rbtn-ID; cell menus provide move, convert, clear, delete, restore and noise.',
      functions: 'newNotebook, addCellAt, deleteCell, moveCellUp, moveCellDown, changeCellType, clearCellContent, restoreCell, runCell, runCurCell, runAll, noiseRun, noiseCell, openCircuitEditor, saveCurrentNb, importNb, handleImport, downloadNb, loadNb, deleteNb, refreshNbs, showPublish, publishNb, activateExpositionMode, restoreAllCells.',
      how_to: 'Use current live cell indices from context; never guess IDs. Preserve unrelated cells. Use circuit cells for visual circuits, code cells for Python/Qiskit, Markdown cells for explanations/LaTeX. Run the intended cell or all cells only as requested and verify exec_count/output changed. Saving, downloading and publishing are separate; publishing requires explicit user intent and confirmation. Exposition mode is read-only.',
      limits: 'The AI command bridge supports add_cell, open_circuit_editor, set_code, run and noise. Other functions are accessed through visible controls. A dispatch ACK is not execution evidence; require a changed execution count and non-error output.'
    },
    'quantum-puzzle': {
      name: 'Quantum Puzzle',
      purpose: 'Quantum challenge browser, published application catalogue, pending publication review and launcher for embedded apps.',
      workflow: 'Inspect search, tag filters and published cards; locate exact challenge/app; open preview or run; verify app loaded and outputs. The same screen opens the nested Quantum App Studio editor and pending-app review.',
      capabilities: ['browse-challenges','search-apps','filter-tags','preview-app','run-published-app','copy-app-link','open-app-studio','review-pending','publish-pending','reject-pending','delete-published-app'],
      controls: 'Search #searchInput; cards expose Run Program, Preview and Copy Link. #studioModalReal contains the nested #studioIframe. Pending manager uses #pendingModal and #pendingListContainer; app preview uses #previewAppModal; execution uses #execAppModal and #execIframe. Studio opens via Open Quantum App Studio.',
      functions: 'refreshApps, getPublishedApps, renderPublishedApps, renderTagFilters, setTagFilter, executeQuantumApp, openQuantumAppStudio, closeStudioModal, openPendingManager, publishPendingApp, rejectPendingApp, deletePublishedApp, copyAppLink, closeExecModal.',
      how_to: 'Search/filter before choosing an app. Preview and run are different. Open Studio from this screen, then inspect the nested editor context. Verify app execution in the execution iframe. Review/publish/reject/delete actions change shared content and require explicit intent; destructive or publishing actions require confirmation.',
      limits: 'App Studio is nested inside this module, not a separate top-level screen. Pending review and published-app administration depend on role permissions. Do not bypass role checks.'
    },
    'quantum-app-studio': {
      name: 'Quantum App Studio',
      purpose: 'Nested application authoring environment for metadata, server configuration, Python and HTML code, preview, save, launch and remote execution.',
      workflow: 'Open from Quantum Puzzle. Inspect repository/editor/runner state; create or select an app; edit name, server URL, Python and HTML; test backend connection if required; preview/test; inspect runtime errors; save; return to Puzzle to launch or submit for publication.',
      capabilities: ['list-projects','create-app','edit-app','rename-app','configure-server','test-backend','edit-python','edit-html','preview-run','save-project','launch-to-puzzle','remote-python-execution','delete-project'],
      controls: 'Nested frame controls: #new-project-btn; #project-name-input; #server-url-input; #test-server-btn; #save-project-editor; #preview-run-btn; #back-to-repo-editor; #back-to-repo-runner; #python-editor; #html-editor; #app-iframe. Inspect the actual active view before selecting controls.',
      functions: 'loadProjects, renderRepository, editProject, setServerUrl, updateServerStatusText, testBackendConnection, executePythonRemote, buildAppBlob, launchProject, runPreview, showScreen, saveCurrentEdit, deleteProject, startNewProject, bindEvents.',
      how_to: 'Treat this as the nested frame quantum-puzzle -> #studioIframe. Check the live frame before each action. Test/preview before saving when appropriate. A preview is not a saved project; a saved project is not necessarily published. Return to Puzzle to launch or publish via its own flow. Server URLs and code are ordinary project inputs, but never expose API secrets.',
      limits: 'Nested frame must be open and same-origin for direct UI control. Remote Python execution requires a configured backend. Save, launch, publication and delete are distinct states.'
    },
    library: {
      name: 'Library',
      purpose: 'Curated resource library for PDFs, videos and notebooks.',
      workflow: 'Search by title/description; filter All/Videos/PDFs/Notebooks; open the exact resource; add a resource with title, description, URL and type when authorized; delete only with explicit confirmation.',
      capabilities: ['search','filter','open-pdf','open-video','open-notebook','add-resource','delete-resource'],
      controls: 'Search #search; filters call setF(all|video|pdf|nb); #a-title, #a-desc, #a-url, #a-type and #a-icon belong to the Add Resource dialog; Add Resource opens via openAdd(). Cards expose View/Open and admin Delete.',
      functions: 'getItems, saveItems, setF, render, openItem, openAdd, closeAdd, addItem, delItem.',
      how_to: 'Inspect the current resource list and type before opening. Validate URL and type. Add only when requested and authorized. Deletion is destructive. Library data is stored in its module localStorage, not the Projects catalogue.',
      limits: 'No direct AI action endpoint exists; use visible controls. Admin controls are hidden for non-admin users.'
    },
    help: {
      name: 'Help',
      purpose: 'User-facing help and guidance for the QuOLab Nexus ecosystem.',
      workflow: 'Read the visible help content, identify the exact tool/topic, explain the relevant workflow and link the user to the corresponding module through navigation.',
      capabilities: ['read-help','explain-workflows','navigate-to-tool'],
      controls: 'Primarily a read-only help surface. Inspect visible headings, links and text; there may be no action buttons.',
      functions: 'The current page exposes content/navigation rather than a separate operational API.',
      how_to: 'Use Help as reference material, then operate the relevant tool itself and verify the result there. Do not claim that reading help completed an operation.',
      limits: 'Read-only guidance; execution belongs to the target module.'
    }
  });
  const CENTRAL_SCREENS = Object.freeze([]);
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

  function describeFrame(screen, frame, isActive) {
    const item = { id: screen, name: TOOL_CATALOG[screen]?.name || screen, loaded: false };
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.documentElement) return item;
      item.loaded = doc.readyState === 'complete' || doc.readyState === 'interactive';
      item.title = cleanText(doc.title, 120);
      item.url = cleanText(frame.getAttribute('src') || '', 180);
      const visible = el => !!(el && el.getClientRects().length && global.getComputedStyle(el).visibility !== 'hidden' && global.getComputedStyle(el).display !== 'none');
      const active = doc.activeElement;
      if (active && active !== doc.body && active !== doc.documentElement) {
        item.focused = { tag: active.tagName.toLowerCase(), id: active.id || '', name: active.getAttribute('name') || '' };
      }
      item.headings = Array.from(doc.querySelectorAll('h1,h2,h3,[role="heading"]')).filter(visible).slice(0,(isActive?24:8)).map(el => cleanText(el.innerText || el.textContent,120)).filter(Boolean);
      const inputs = [];
      for (const el of Array.from(doc.querySelectorAll('input,textarea,select,[contenteditable="true"]')).filter(visible).slice(0,(isActive?70:24))) {
        if (el.type === 'hidden' || el.disabled) continue;
        const label = el.labels && el.labels.length ? el.labels[0].innerText : '';
        const descriptor = { tag:el.tagName.toLowerCase(), type:el.type || (el.tagName.toLowerCase()==='select'?'select':'text'), id:el.id||'', name:el.getAttribute('name')||'', selector:'', label:cleanText(label||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'',100) };
        const sensitiveField = SENSITIVE.test([descriptor.id,descriptor.name,descriptor.label,descriptor.type].join(' '));
        descriptor.selector = sensitiveField ? '' : selectorFor(el);
        if (!sensitiveField) descriptor.value = cleanText(el.tagName==='SELECT' ? el.options[el.selectedIndex]?.text||'' : (el.value||el.innerText||''),180);
        else descriptor.value='[REDACTED]';
        if (el.tagName==='SELECT') descriptor.options=Array.from(el.options).slice(0,30).map(o=>cleanText(o.text,80));
        inputs.push(descriptor);
      }
      item.inputs=inputs;
      item.buttons=Array.from(doc.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],[role="tab"],summary')).filter(visible).slice(0,90).map(el=>({
        text:cleanText(el.innerText||el.value||el.getAttribute('aria-label')||'',120),
        id:el.id||'',name:el.getAttribute('name')||'',aria_label:cleanText(el.getAttribute('aria-label')||'',90),
        selector:selectorFor(el),role:el.getAttribute('role')||el.tagName.toLowerCase(),disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true'
      }));
      item.links=Array.from(doc.querySelectorAll('a[href]')).filter(visible).slice(0,60).map(el=>({
        text:cleanText(el.innerText||el.getAttribute('aria-label')||'',120),
        href:cleanText((el.getAttribute('href')||'').split('?')[0],240),selector:selectorFor(el)
      })).filter(x=>x.text||x.href);
      item.canvases=Array.from(doc.querySelectorAll('canvas,svg,[role="application"]')).filter(visible).slice(0,20).map(el=>({
        tag:el.tagName.toLowerCase(),id:el.id||'',label:cleanText(el.getAttribute('aria-label')||el.getAttribute('title')||'',100),
        width:el.width||el.clientWidth||0,height:el.height||el.clientHeight||0,selector:selectorFor(el)
      }));
      const outputs=[];
      for(const el of Array.from(doc.querySelectorAll('pre,output,[aria-live="polite"],[aria-live="assertive"],[id*="output" i],[class*="output" i],[id*="result" i],[class*="result" i]')).filter(visible).slice(0,(isActive?30:8))){
        const value=cleanText(el.innerText||el.textContent||'',1000);
        if(value&&!SENSITIVE.test((el.id||'')+' '+(el.className||'')))outputs.push(value);
      }
      item.outputs=outputs.slice(0,isActive?18:5);
      item.visible_text=cleanText(doc.body?.innerText||'',isActive?4200:700);
    } catch (_) { item.cross_origin_or_unavailable=true; }
    return item;
  }

  function snapshot(base) {
    const active = activeScreen();
    const managedScreens = Object.keys(TOOL_CATALOG);
    const tools = managedScreens.map(id => {
      const frame = frameFor(id);
      const spec = TOOL_CATALOG[id];
      return Object.assign({
        id,
        tool_name: spec ? spec.name : 'QNexusAi',
        capabilities: spec ? spec.capabilities : ['inspect','navigate','explain','diagnose']
      }, frame ? describeFrame(id, frame, id === active) : { loaded: false });
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

  let selectorSequence = 0;
  function validSelector(selector) {
    return typeof selector === 'string' && selector.length <= 180 &&
      (/^#[A-Za-z][\w:.-]*$/.test(selector) ||
       /^\[name="[A-Za-z0-9_.:-]{1,80}"\]$/.test(selector) ||
       /^\[data-[a-z0-9_-]+="[A-Za-z0-9_.:-]{1,100}"\]$/.test(selector) ||
       /^\[(?:aria-label|placeholder|title)="[A-Za-z0-9 _.,:;()\/-]{1,100}"\]$/.test(selector));
  }

  function selectorFor(el) {
    const doc = el && el.ownerDocument;
    if (!el || !doc) return '';
    if (el.id && /^[A-Za-z][\w:.-]*$/.test(el.id)) {
      try { if (doc.querySelectorAll('#' + el.id).length === 1) return '#' + el.id; } catch (_) {}
    }
    const name = el.getAttribute('name') || '';
    if (/^[A-Za-z0-9_.:-]{1,80}$/.test(name)) {
      const selector = '[name="' + name + '"]';
      try { if (doc.querySelectorAll(selector).length === 1) return selector; } catch (_) {}
    }
    for (const attr of ['data-testid','data-action','aria-label','placeholder','title']) {
      const value = el.getAttribute(attr) || '';
      if (/^[A-Za-z0-9 _.,:;()\/-]{1,100}$/.test(value)) {
        const selector = '[' + attr + '="' + value + '"]';
        try { if (doc.querySelectorAll(selector).length === 1) return selector; } catch (_) {}
      }
    }
    let token = el.getAttribute('data-qnexus-agent-target');
    if (!token) {
      token = String(++selectorSequence);
      el.setAttribute('data-qnexus-agent-target', token);
    }
    return '[data-qnexus-agent-target="' + token + '"]';
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
