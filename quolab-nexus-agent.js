/* QNexusAi — unified autonomous agent and universal UI connector v1.5.0 */
(function (global) {
  'use strict';

  const VERSION = '1.8.0';
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
      purpose: 'Interactive computational notebook combining visual quantum-circuit cells, editable Python code cells, Markdown/LaTeX exposition, execution outputs, noise experiments, persistence, import/export and publishing.',
      workflow: 'Inspect notebook metadata, permissions, engine readiness, cell order/types/content/output and current selection. Create/open notebooks; compose explanations and code around visual circuits; edit, reorder, convert, restore or remove cells; execute individual or all executable cells; inspect results/errors; save, import/export or publish according to the requested outcome.',
      capabilities: ['notebook-create-open','visual-qiskit-circuit-cells','python-code-cells','markdown-latex-cells','cell-editing-and-ordering','cell-type-conversion','cell-output-inspection','single-and-batch-execution','noise-models-and-shots','notebook-persistence','ipynb-import-export','publishing-and-sharing','visual-circuit-editor'],
      controls: 'Notebook title: #nb-name-inp. Add exposition with #btn-add-md; add a visual circuit with #btn-add-circ or an insertion-row Circuit control. #main-area/#nb-scroll contain ordered cells. Code editors use #ta-CELLID; Markdown editors use #mta-CELLID and render preview in #mdprev-CELLID. Cell run buttons use #rbtn-CELLID; outputs use #out-CELLID. Notebook operations: #btn-import/#import-file, #btn-download, #btn-save, #btn-publish, #btn-restore-all, #btn-run-cur and #btn-run-all. Circuit previews open the visual editor. Inspect live cell IDs and indices before acting.',
      functions: 'newNotebook, addCellAt, buildCellEl, renderCells, editMd, renderMdPreview, syncCellCode, changeCellType, deleteCell, moveCellUp, moveCellDown, clearCellContent, restoreCell, runCell, runCurCell, runAll, noiseRun, noiseCell, openCircuitEditor, saveCurrentNb, importNb, handleImport, downloadNb, loadNb, deleteNb, refreshNbs, showPublish, publishNb, activateExpositionMode, restoreAllCells.',
      how_to: 'Treat a notebook as an ordered document, not a single code prompt. Decide whether each requested part belongs in Markdown, a visual circuit, or Python code. Use visual-circuit cells as the authoritative graphical circuit representation: opening/editing a circuit updates its Qiskit-backed representation; use ordinary Python code cells for additional Qiskit algorithms, analysis or helper code; the notebook injects the shared Qiskit/NumPy/Matplotlib runtime preamble when executing Python code cells. Add Markdown cells for requested explanations, derivations, headings, equations and conclusions, then write the actual content into them through the Markdown editor bridge. For a mixed notebook, create and populate each cell in document order, preserve existing content, run only executable code/circuit cells, and verify that Markdown text appears in the rendered preview and code/circuit output appears after execution. Qiskit is not a separate cell type. Imported legacy Qiskit-tagged code cells are treated as ordinary Python code cells. Respect exposition read-only mode and authentication. Saving, downloading and publishing are separate operations; publishing is never implied by saving.',
      limits: 'The dedicated notebook bridge supports add_cell, set_markdown, set_code, open_circuit_editor, run and noise. Other operations use visible controls. A dispatch receipt is not proof of a completed edit or execution; verify the cell content, rendered Markdown preview, changed execution count and fresh non-error output. Scientific results come from the configured Python/Qiskit engine, not the language model.'
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
  const FUNCTION_PURPOSES = Object.freeze({
    reload:'Reload the current Projects resource list.',setF:'Apply a resource-type filter.',render:'Rebuild the visible resource list from current data.',execProj:'Open or execute the selected project resource.',delProj:'Delete the selected project after the module confirmation.',editProj:'Open the selected project in its editor.',updateProj:'Persist the edited project metadata.',copyNbLink:'Copy a shareable notebook link.',nexusDirectLink:'Build a direct navigation link to a Nexus resource.',
    buildPalette:'Build the available quantum-gate palette.',placeGate:'Place a selected gate on the circuit canvas.',removeGate:'Remove a gate from the circuit.',moveExistingGate:'Move an existing gate to another circuit position.',renderCircuit:'Render the current circuit on the visual canvas.',updateCodeFromCircuit:'Regenerate Qiskit code from the visual circuit.',onCodeEdit:'Handle code-editor changes and synchronize circuit state.',forceSync:'Force synchronization between the circuit and code representations.',initPyodide:'Initialize the browser Python execution runtime.',runServerCode:'Submit code to the configured remote execution engine.',runCode:'Execute the current code in the configured engine.',fetchWithRetry:'Perform a network request with retry handling.',drawBloch:'Draw the current qubit state on the Bloch sphere.',updateBlochFromProbs:'Update Bloch visualization from measured probabilities.',applyBlochGate:'Apply a gate operation to the selected Bloch-state model.',addQubit:'Add a qubit to the current circuit.',removeQubit:'Remove a qubit from the current circuit.',clearCircuit:'Clear the current circuit.',saveCircuit:'Save the current circuit to the account.',loadCircuit:'Load a saved circuit.',deleteCircuit:'Delete a saved circuit.',dlPy:'Export the current circuit as a Python file.',dlNb:'Export the current circuit as a notebook.',saveAndSchedule:'Save the circuit and add it to the execution queue.',runQueue:'Execute queued circuit jobs.',removeFromQueue:'Remove a job from the execution queue.',setTab:'Switch the active tool tab.',setMode:'Change the current editor or visualization mode.',setLib:'Select the active gate or component library.',openNoise:'Open noise-model configuration.',quickNoise:'Run a quick noise experiment with current settings.',returnToNotebook:'Return the circuit to its parent notebook.',
    newNotebook:'Create a new notebook.',addCellAt:'Insert a Markdown, Python or visual-circuit cell at the requested position.',deleteCell:'Delete the selected notebook cell.',moveCellUp:'Move a notebook cell one position earlier.',moveCellDown:'Move a notebook cell one position later.',changeCellType:'Convert a cell to another supported cell type.',clearCellContent:'Clear the selected cell content.',restoreCell:'Restore the selected cell from its saved or prior state.',runCell:'Execute one notebook code or circuit cell.',runCurCell:'Execute the currently selected notebook cell.',runAll:'Execute all eligible notebook cells in document order.',noiseRun:'Run a notebook noise simulation.',noiseCell:'Configure or run noise for a specific cell.',openCircuitEditor:'Open the visual circuit editor for a notebook circuit cell.',saveCurrentNb:'Save the current notebook.',importNb:'Open the notebook import flow.',handleImport:'Process an imported notebook file.',downloadNb:'Export the current notebook as an ipynb file.',loadNb:'Load a notebook into the editor.',deleteNb:'Delete a saved notebook.',refreshNbs:'Refresh the saved notebook list.',showPublish:'Open notebook publication settings.',publishNb:'Publish the notebook using the module publication flow.',activateExpositionMode:'Enable read-only exposition mode.',restoreAllCells:'Restore all notebook cells.',buildCellEl:'Build the rendered interface for one notebook cell.',renderCells:'Render the ordered notebook cell list.',editMd:'Enter Markdown cell editing mode.',renderMdPreview:'Render a Markdown cell preview.',syncCellCode:'Synchronize the visual circuit representation and its code.',
    refreshApps:'Refresh the published quantum-app catalogue.',getPublishedApps:'Read the currently published quantum apps.',renderPublishedApps:'Render the published-app catalogue.',renderTagFilters:'Render available app tag filters.',setTagFilter:'Filter published apps by tag.',executeQuantumApp:'Launch a published quantum app.',openQuantumAppStudio:'Open the nested Quantum App Studio editor.',closeStudioModal:'Close the nested App Studio editor.',openPendingManager:'Open the pending-app review queue.',publishPendingApp:'Publish a pending app after authorization.',rejectPendingApp:'Reject a pending app after authorization.',deletePublishedApp:'Delete a published app after authorization.',copyAppLink:'Copy the selected app share link.',closeExecModal:'Close the app execution preview.',
    loadProjects:'Load the App Studio project repository.',renderRepository:'Render the App Studio project list.',editProject:'Open a project in the App Studio editor.',setServerUrl:'Set the selected project backend URL.',updateServerStatusText:'Refresh the backend connection status display.',testBackendConnection:'Test the configured remote backend connection.',executePythonRemote:'Execute Python through the configured remote backend.',buildAppBlob:'Build a previewable application document.',launchProject:'Launch or transfer the selected project to Quantum Puzzle.',runPreview:'Run the current application preview.',showScreen:'Switch the App Studio view.',saveCurrentEdit:'Save the current project edits.',deleteProject:'Delete a project after authorization and confirmation.',startNewProject:'Start creating a new App Studio project.',bindEvents:'Register App Studio interface event handlers.',
    getItems:'Read the current Library resource collection.',saveItems:'Persist the Library resource collection.',openItem:'Open the selected Library resource.',openAdd:'Open the Add Resource dialog.',closeAdd:'Close the Add Resource dialog.',addItem:'Add a resource through the Library form.',delItem:'Delete a resource after administrator confirmation.'
  });
  function inferFunctionPurpose(name){
    const words=String(name||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/([A-Z])([A-Z][a-z])/g,'$1 $2').trim().toLowerCase();
    const verbs=[['get','Read'],['list','List'],['find','Find'],['search','Search'],['inspect','Inspect'],['read','Read'],['render','Render'],['refresh','Refresh'],['load','Load'],['show','Open'],['open','Open'],['draw','Draw'],['describe','Describe'],['set','Set or select'],['update','Update'],['build','Build'],['new','Create'],['add','Add'],['create','Create'],['edit','Edit'],['change','Change'],['move','Move'],['remove','Remove'],['delete','Delete'],['clear','Clear'],['restore','Restore'],['run','Execute'],['execute','Execute'],['save','Save'],['import','Import'],['download','Export'],['publish','Publish'],['reject','Reject'],['copy','Copy'],['test','Test'],['launch','Launch'],['close','Close'],['activate','Enable'],['sync','Synchronize'],['apply','Apply'],['init','Initialize'],['bind','Register'],['handle','Handle'],['return','Return'],['select','Select'],['place','Place'],['force','Force'],['quick','Run quick']];
    const match=verbs.find(([prefix])=>name.toLowerCase().startsWith(prefix));
    return (match?match[1]:'Operate')+' the '+words+' function. Check its live signature and module state before calling.';
  }
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
    if(screen==='quantum-app-studio'){
      const puzzle=frameFor('quantum-puzzle');
      const modal=puzzle&&puzzle.contentDocument&&puzzle.contentDocument.getElementById('studioModalReal');
      if(!modal||!modal.classList.contains('open')){
        item.available=false;
        item.note='Open Quantum App Studio from Quantum Puzzle before operating this nested editor.';
        return item;
      }
      item.available=true;
    }
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
      item.function_api=(spec.functions||'').split(',').map(name=>name.trim()).filter(name=>/^[A-Za-z_$][\w$]*$/.test(name)).slice(0,60).map(name=>{
        const fn=doc.defaultView&&doc.defaultView[name];
        let signature='';
        if(typeof fn==='function'){
          try{const source=Function.prototype.toString.call(fn);signature=(source.match(/^[^(]*\(([^)]*)\)/)||source.match(/^\s*([^=()]+?)\s*=>/)||[])[1]||'';}catch(_){}
        }
        const safe=/^(?:get|list|find|search|inspect|read|render|refresh|load|show|open|draw|describe|setF|setTab|setMode|setLib|updateStatus|updateBloch|syncCellCode)/i.test(name);
        return {name,purpose:FUNCTION_PURPOSES[name]||inferFunctionPurpose(name),callable:typeof fn==='function',safe:safe&&typeof fn==='function',arity:typeof fn==='function'?fn.length:0,signature:cleanText(signature,180)};
      });
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
      status: /ERROR|FAIL|REJECT/i.test(type) || /error/i.test(nestedKind) || (details.details && (details.details.ok===false || (Number(details.details.status)>=400))) ? 'error' : /RESULT|OUTPUT|SUCCESS|READY/i.test(type) || /response|output|result/i.test(nestedKind) ? 'result' : 'event',
      timestamp: Number(event.data.timestamp)||Date.now()
    };
    recentEvents.push(record);
    if (recentEvents.length > MAX_EVENTS) recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
    global.dispatchEvent(new CustomEvent('quolab:nexus-activity',{detail:record}));
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
