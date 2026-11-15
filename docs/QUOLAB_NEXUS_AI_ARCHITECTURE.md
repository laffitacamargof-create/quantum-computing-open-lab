# QuOLab Nexus AI architecture

## Runtime topology

- **QuOLab Nexus AI** is the single central coordinator.
- Exactly five specialist workers are registered: Projects, Quantum Notebook, Quantum Open Lab, Quantum Puzzle, and Quantum App Studio.
- Library, Help, welcome messages, multilingual conversation, ecosystem diagnostics, general programming, and final user communication remain central-agent responsibilities.
- Account and Founder surfaces are outside the AI action scope.

## Delegated request lifecycle

1. The central coordinator collects the current screen snapshot and sanitized tool telemetry, subject to the user's context-sharing setting.
2. A router model call classifies the request. It either returns a direct central answer or assigns one bounded task to one of the five specialist workers.
3. The selected worker runs as a distinct model invocation with its own role instructions and the same grounded screen context.
4. The central coordinator reviews the worker report, prepares the final answer, and emits only schema-valid UI actions.
5. Proposed actions are displayed for user approval. Destructive or sensitive UI controls also trigger a confirmation check.
6. Delegation status and a short sanitized report are kept in a bounded in-memory history and included in subsequent context snapshots.

The five workers currently share the AI provider/model configured by the user. They are separate delegated invocations with specialist-specific instructions, not five separately hosted model deployments or independent long-running processes.

## Tool visibility and controls

The universal connector reports sanitized user-interface inputs, clicks, fetch/XHR request and response summaries, runtime errors, unhandled promise rejections, and changes in visible output/result regions. The central coordinator can inspect same-origin module frames, including the nested Quantum App Studio iframe.

Supported controlled UI operations are click, fill/type, select, scroll, hover, keyboard navigation keys, and drag-and-drop sequences. Passwords, tokens, API keys, founder credentials, and other fields matching the sensitive-field rules are redacted or excluded. The agent does not receive unrestricted access to browser storage, arbitrary page scripts, account controls, or Founder administration.

## Safety and approval

- AI-proposed operations are rendered as explicit user-click actions.
- Destructive actions such as delete, publish, approve, reject, submit, reset, overwrite, and logout require an additional browser confirmation.
- Selectors must use a restricted ID, name, or data-attribute form and target visible controls.
- Specialist reports are treated as untrusted model output and are validated before UI actions are accepted.
- Supabase privileged RPC execution is restricted to service_role; public clients use the deployed quolab-nexus-admin Edge Function.
- The private secret archive has RLS enabled and no grants to anon or authenticated.

## Deployment and configuration limits

The GitHub Pages frontend can use the AI provider configured in the existing Nexus AI settings. In the current deployment that provider key is still stored in the browser-side AI configuration; it is not a server-side secret. Do not treat this as production-grade secret isolation. A server-side AI gateway requires a provider key stored as a Supabase Edge Function secret and a real authenticated user/session policy. The current Supabase tool connection does not expose secret-management operations, so that final credential migration must be completed in the Supabase Dashboard.

The deployed Edge Function has verify_jwt=false because it performs its own founder/item-key checks for its existing public API actions. Do not add AI proxy actions to this unauthenticated endpoint without implementing a separate authenticated session and rate-limit policy.

## Verification

CI checks JavaScript syntax, the exact five-specialist registry, nested App Studio routing, central-owned screens, delegated worker dispatch, telemetry, and supported UI operations. Supabase migration verification checks that public roles cannot execute privileged RPCs and that service_role retains the required grants.