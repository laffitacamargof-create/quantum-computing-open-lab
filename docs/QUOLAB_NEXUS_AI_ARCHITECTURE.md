# QuOLab Nexus AI architecture

## Single-agent topology
QNexusAi is the only AI agent. It owns conversation, planning, tool selection by live context, operation, recovery and final verification. There are no specialist agents, worker prompts, router-only calls, inter-agent handoffs or separate synthesis calls.

The module interfaces remain distinct tools: Projects; Quantum Notebook; Quantum Open Lab; Quantum Puzzle; Quantum App Studio; Library; Help. QNexusAi can move between them and complete a multi-tool task in one continuous execution loop. Scientific simulators, not the LLM, produce quantum execution results.

## Unified task lifecycle
1. Read the complete user request and sanitized live context.
2. Define explicit acceptance criteria and an ordered plan.
3. Inspect current module state and use only grounded IDs, cell indices, selectors and values.
4. Execute up to eight supported actions per model turn.
5. Re-read fresh context and inspect every action result.
6. Diagnose failures, correct and retry; move between tools without delegation.
7. Verify every criterion before reporting completion.

Execution uses TASK_STATUS: CONTINUE, COMPLETED or BLOCKED. COMPLETED requires concrete TASK_EVIDENCE from fresh context. Navigation, code insertion, dispatch acknowledgement or a model assertion alone is insufficient. When the bounded iteration budget is reached, report incomplete rather than claiming success.

## Token efficiency
The router → specialist worker(s) → central synthesis sequence is removed. Informational requests normally use one model call. Execution tasks make additional calls only for continuation, correction or verification. Conversation history and context budgets are reduced. The hybrid provider gateway remains unchanged.

## Tool visibility and safety
The universal connector exposes sanitized UI controls, visible outputs, request/response summaries and runtime errors from supported same-origin frames, including nested App Studio. Sensitive values remain redacted. QNexusAi cannot access arbitrary OS apps, unrestricted browser storage or inaccessible cross-origin interfaces. Destructive, publishing, financial, credential and irreversible operations retain confirmation. Quantum simulators remain the source of scientific results.

## Verification
CI checks the single-agent contract, removal of specialist orchestration, supported tool actions, evidence/status handling and reduced token budget. Static checks and deployment do not replace interactive end-to-end testing in the browser.


## Module operating manuals and request receipt

The runtime catalog is the single agent's operating manual for all seven interfaces: Projects, Quantum Open Lab, Quantum Notebook, Quantum Puzzle, Quantum App Studio, Library and Help. Each entry supplies purpose, step-by-step workflow, supported capabilities, expected inputs/outputs and limits. The live context includes this catalog alongside sanitized visible controls and outputs. The agent must ground selectors and IDs in fresh context; generic UI controls are available only when a same-origin visible control is exposed.

The chat request avoids serializing the full live context twice: detailed context is supplied once in the system context, while continuation messages carry a short progress summary. History and output-token budgets are bounded to reduce provider 413 errors without removing the tool manual.

Each gateway attempt carries a request ID. Supabase logs a receipt after authentication and payload validation, and returns `request_received` plus that ID when provider fallback is exhausted or succeeds. The browser retries transient gateway/network failures with the same request ID and bounded exponential backoff. A 413 is not retried unchanged by the browser; the gateway treats an upstream provider 413 as a provider failure and proceeds to the next configured provider. Receipt means the gateway accepted the request, not that the model completed the task. Model response, tool acknowledgement and fresh-state verification remain separate checkpoints.

Retries are bounded rather than infinite: indefinite retries can hang the interface, amplify rate limits and duplicate model work when a response is lost. If no receipt can be confirmed after the retry budget, QNexusAi reports the failure and request ID when available instead of claiming execution.
