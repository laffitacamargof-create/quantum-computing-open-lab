# QuOLab Nexus AI architecture and tool operating manual

## One superagent
QNexusAi is the only model-driven agent. The seven module surfaces are tools, not separate agents: Projects, Quantum Open Lab, Quantum Notebook, Quantum Puzzle, nested Quantum App Studio, Library and Help. The agent owns planning, direct tool use, cross-module workflows, recovery and verification.

## Tool knowledge and live context
The runtime catalog documents each module's purpose, supported capabilities, workflow, important controls, relevant implementation functions and restrictions. The complete manuals remain available in the client, but are not all sent to the model at once. Each model turn receives a compact index of all seven tools and their capabilities, plus the full manual for exactly one module selected from the current task and active screen. When a workflow moves to another module, the next turn loads that module's complete manual. This staged context preserves detailed instructions while avoiding oversized prompts. Live context is bounded and prioritizes the selected module. Structured operational context from Quantum Open Lab and Quantum Notebook is requested on demand; requests carry a correlation ID and retry until a matching response arrives or the bounded context timeout is reached. At runtime the agent inspects same-origin module frames and receives:
- headings and visible text;
- visible buttons, tabs, summaries and their usable selectors;
- links and safe destinations;
- editable fields, current values and select options, with sensitive values redacted;
- canvas/SVG/application surfaces;
- output/result/error regions;
- active module, current state, recent tool events and nested App Studio state.

The selected module receives the richest live snapshot; unrelated modules are represented by their loaded state and the compact tool index. Context serialization has a hard size budget and drops unrelated live detail before any selected module manual. Structured Quantum Notebook state is compacted rather than discarded: all cell indices/types are retained, while code/output detail is focused on the first few cells and the current cell. Quantum Open Lab code, engine state, qubit/gate counts, output and noise metadata are preserved in bounded fields. The serializer never cuts a JSON context string at an arbitrary character boundary. Selectors without stable IDs are given a unique temporary `data-qnexus-agent-target` attribute. The agent must use selectors and IDs from this live context, not guess them. Task turns do not resend the conversation history because the original request, checklist and prior action results are already carried explicitly in the continuation message.

## Supported operation paths
1. `nav`: open a top-level module.
2. `open_notebook` / `open_app`: open a published item using an ID found in live context.
3. `add_cell`, `open_circuit_editor`, `set_code`, `run`, `noise`: use the dedicated Notebook/Quantum Open Lab bridge.
4. `ui_action`: click, fill, type, select, scroll, hover, key or drag a visible control in any supported module, including nested App Studio.

Projects, Puzzle, App Studio, Library and Help currently expose their operations through visible UI controls rather than a dedicated command RPC. The universal connector lets the superagent operate those controls; it does not execute arbitrary private JavaScript functions. Admin and role checks remain enforced by the modules.

## Reliable tool-command delivery
Dedicated tool commands use a request ID and a two-stage acknowledgement:
- `OPENQ_AI_ACTION_RECEIVED`: the target module confirms that it received the command.
- `OPENQ_AI_ACTION_ACK`: the module confirms the command result and supplies output/error details.

If the receipt acknowledgement is lost, the parent resends the same request ID with exponential backoff. The target module deduplicates request IDs, so a retry does not execute a command twice. Once receipt is known, the parent stops resending the command and polls `OPENQ_AI_ACTION_STATUS` until the saved result is returned. The request cache retains recent results to replay acknowledgements after a lost response.

Action-delivery retries use exponential backoff (up to 120 attempts) and execution has a 5-minute deadline for edits and a 10-minute deadline for runs/noise. Model/API requests use a stable request correlation ID and retry transient network, timeout, rate-limit and 5xx failures up to five times with exponential backoff. A gateway response distinguishes `gateway_received` from `provider_completed`; a 413 returned by one upstream provider is eligible for fallback to the next configured provider. Client-side context staging and size limits are the primary protection against repeated oversized requests. The model emits at most three tool actions per turn, then the agent refreshes state and asks for the next small batch. If the target never acknowledges receipt, the agent reports delivery unconfirmed; if it acknowledges receipt but never returns a result, the agent reports that the command was received but its execution result is unknown. Neither case is marked completed. This avoids infinite browser hangs while distinguishing delivery from execution.

## Task lifecycle and completion
For each requested operation, QNexusAi defines acceptance criteria, inspects state, acts, checks receipts/results, refreshes context, corrects errors and continues across tools. Navigation, code insertion, receipt acknowledgement or model assertions alone do not prove completion. Run/simulation tasks require fresh output from the actual simulator/compiler. The final status is CONTINUE, COMPLETED or BLOCKED; COMPLETED requires evidence for every requested criterion.

## Module operating guides

### Projects
Search and filter the repository by notebooks, PDFs and videos; open/execute the exact resource; copy a share link; edit resource metadata or delete where role permissions allow. Relevant implementation: `reload`, `setF`, `execProj`, `editProj`, `updateProj`, `delProj`, `copyNbLink`. Founder-key and admin checks are not bypassed.

### Quantum Open Lab
Build and edit circuits using the gate palette, circuit canvas and wires; manage qubit count; synchronize visual circuit and Qiskit code; run the compiler; inspect output and errors; run noise experiments; inspect Bloch sphere; save/load/delete circuits; export Python or notebook files; manage execution queues and panel layouts. Important controls include `#btn-run`, `#btn-noise`, `#btn-noise-run`, `#btn-sync`, `#btn-addqb`, `#btn-remqb`, `#code-ta`, `#out-body`, `#bloch-q-select`, `#btn-save`, `#btn-dlpy`, `#btn-dlnb` and `#btn-run-queue`. Relevant implementation includes `buildPalette`, `placeGate`, `moveExistingGate`, `updateCodeFromCircuit`, `forceSync`, `runServerCode`, `runCode`, `fetchWithRetry`, `drawBloch`, `saveCircuit`, `loadCircuit`, `dlPy`, `dlNb`, `runQueue`, `openNoise` and `quickNoise`. Check engine status before running; require real output. The app's existing circuit guardrails are 20 qubits and 150 gates.

### Quantum Notebook
Create/open notebooks; create Python code, visual-circuit and Markdown/LaTeX cells; Qiskit is not a separate cell type: visual-circuit cells are edited graphically and synchronize to Qiskit-backed code, while ordinary Python cells can contain Qiskit programs. Markdown cells can be created and populated directly by the agent.  edit, reorder, convert, clear, delete and restore cells; execute one/current/all cells; run noise; save; import/export IPYNB; publish; manage notebooks; open the visual circuit editor. Controls include `#nb-name-inp`, `#btn-add-md`, `#btn-add-circ`, `#btn-import`, `#btn-download`, `#btn-save`, `#btn-publish`, `#btn-restore-all`, `#btn-run-cur` and `#btn-run-all`. Cell-level controls include run, move up/down, convert, clear, delete, restore and noise. Relevant implementation includes `newNotebook`, `addCellAt`, `deleteCell`, `moveCellUp`, `moveCellDown`, `changeCellType`, `restoreCell`, `runCell`, `runCurCell`, `runAll`, `noiseRun`, `noiseCell`, `openCircuitEditor`, `saveCurrentNb`, `importNb`, `downloadNb`, `loadNb`, `deleteNb` and `publishNb`. Preserve unrelated cells and use current cell indices. Exposition mode is read-only. Save, export and publish are different operations.

### Quantum Puzzle
Browse/search/filter challenges and published apps; preview/run an app; copy links; open Studio; review pending submissions; publish/reject pending items; delete published apps. Relevant implementation includes `refreshApps`, `getPublishedApps`, `setTagFilter`, `executeQuantumApp`, `openQuantumAppStudio`, `openPendingManager`, `publishPendingApp`, `rejectPendingApp`, `deletePublishedApp` and `copyAppLink`. Studio is nested in `#studioIframe`; published app execution is nested in `#execIframe`. Preserve role checks and require confirmation for publishing/rejection/deletion.

### Quantum App Studio
Inside Puzzle, list/create/edit apps; edit metadata, server URL, Python and HTML; test backend connectivity; preview/run; save; launch back to Puzzle; execute remote Python; delete projects. Important controls include `#new-project-btn`, `#project-name-input`, `#server-url-input`, `#test-server-btn`, `#save-project-editor`, `#preview-run-btn`, `#python-editor`, `#html-editor` and `#app-iframe`. Relevant implementation includes `loadProjects`, `renderRepository`, `editProject`, `setServerUrl`, `testBackendConnection`, `executePythonRemote`, `launchProject`, `runPreview`, `saveCurrentEdit` and `deleteProject`. Preview, save, launch and publication are distinct. Remote Python needs a configured backend.

### Library
Search/filter curated PDFs, videos and notebooks; open a resource; add a resource with type/title/description/URL; delete where admin role permits. Controls include `#search`, type filters, and Add Resource fields `#a-title`, `#a-desc`, `#a-url`, `#a-type`. Relevant implementation includes `getItems`, `saveItems`, `setF`, `openItem`, `openAdd`, `addItem` and `delItem`. Library records are local to the Library module and are separate from Projects resources.

### Help
Read visible guidance, identify the relevant module and navigate there; Help is a reference surface, not an execution API.

## Safety and boundaries
Secrets, password fields, tokens and sensitive form values are redacted and cannot be filled by agent UI actions. Destructive, publishing, financial, credential and irreversible actions retain confirmation. Same-origin browser modules are in scope; arbitrary operating-system applications, inaccessible cross-origin frames and private internal functions are not. Scientific simulators/compiler services—not the language model—produce numerical quantum results.

## Verification
CI validates syntax, module catalog coverage, selectors, staged manual selection, bounded context, small action batches, gateway request retries, upstream 413 failover, receipt/status handling and action deduplication. Automated static tests and GitHub Pages deployment do not substitute for interactive end-to-end testing in a real browser session.


## Runtime function access and continuous telemetry (v1.8)

The superagent receives a live function inventory for each loaded module. For every function documented in that module's operating manual, the inventory reports its purpose, whether the corresponding public global function is actually callable in the current frame, its arity and a best-effort parameter signature. Known functions have explicit descriptions; remaining functions receive a verb-based fallback description. The model may use `tool_call` only for a function in that documented, live callable inventory that is also marked safe (read/navigation helpers). Mutations, simulations, saves, publication, deletion and permission-sensitive operations must use the module's supported action bridge or visible UI, preserving the module's authorization and confirmation checks. If a function is not exposed or is not marked safe, use the supported UI/action bridge. Function calls execute in the module frame and retain module-level authorization checks. Destructive function names require a user confirmation. The agent must not guess function signatures or bypass module security.

The notebook's deduplicated receipt registry includes `OPENQ_AI_SET_MARKDOWN`, so a lost acknowledgement cannot cause the same Markdown edit to be replayed as a new command. The universal connector reports sanitized input/change events, clicks, form submissions, fetch/XHR requests and responses, HTTP failures, rendered output changes, runtime errors and rejected promises. Events are retained in a bounded in-memory recent-event buffer and broadcast to the coordinator. HTTP responses with status 400 or higher are classified as errors and can trigger proactive diagnostics. Sensitive fields and credential-like strings remain redacted. Telemetry is operational context, not a raw recording of passwords, tokens, cookies, private keys or unrelated user data. The agent sees the event stream on context refresh and proactively diagnoses detected errors; it does not invoke an LLM for every keystroke or network packet, which would be expensive and could disclose excessive data.

The task panel remains open during action dispatch and closes only through the verified-completion lifecycle. Manual selection follows the active tool on continuation turns so a multi-tool task can change manuals after each navigation while preserving its original objective.


## Nested App Studio preview and circuit drag behavior

The App Studio preview document loads the same sanitized connector with an explicit `quantum-app-studio` tool identity. The App Studio frame relays preview input, click, network, output and runtime events to its parent, which forwards them to QNexusAi. This covers same-origin Blob previews generated by App Studio; external cross-origin pages and isolated third-party frames remain outside the browser's same-origin inspection boundary.

Circuit drag actions now dispatch both PointerEvent and HTML DragEvent sequences when the browser supports them. These are synthetic events, not trusted physical pointer input. The agent must refresh the circuit state and verify the gate placement; if a widget requires trusted native input, use its supported module API or report that browser limitation rather than claiming success.


El motor Python requiere bubblewrap (bwrap) con espacios de nombres de usuario sin privilegios y de red habilitados. El código se ejecuta con UID/GID 65534, red aislada, directorio temporal escribible, montajes de runtime de solo lectura, validación AST/imports y límites de CPU, memoria, tiempo de pared, tamaño de código y salida. Si bwrap o los espacios de nombres requeridos no están disponibles, la ejecución se rechaza explícitamente; nunca se debe habilitar una ruta alternativa sin aislamiento.
