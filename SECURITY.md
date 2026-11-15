# Security notes — QuOLab Nexus

## Credentials

- Never commit Supabase secret keys, service-role credentials, provider API keys, founder keys, or user edit keys.
- The browser configuration may contain only the Supabase publishable key. A publishable key is not a substitute for Row Level Security.
- Backend database access uses the Edge Function secret `QUOLAB_NEXUS_SECRET_KEY`. Keep its value only in Supabase Edge Function secrets.
- A secret key was present in historical revisions of the former `supabase-config.js`. Treat that historical credential as compromised until it has been revoked in Supabase. Removing the file from the current tree does not revoke the key or remove it from Git history.
- Rotation order: create a replacement secret key, update `QUOLAB_NEXUS_SECRET_KEY`, redeploy and verify the admin Edge Function, then revoke the exposed key. Never paste credentials into issues, commits, or chat.

## Database and Edge Functions

- Keep RLS enabled on all application tables.
- Privileged RPC functions must remain unavailable to `anon` and `authenticated`; the server-side Edge Function calls them using its secret key and checks founder or per-item edit keys.
- `quolab-nexus-ai` requires a valid Supabase JWT and anonymous user session.
- `quolab-nexus-admin` retains `verify_jwt=false` for compatibility with existing browser clients. This is not user authentication: founder operations must continue to validate the founder key in the database, and repository edits must validate per-item edit keys. The public app-submission action is rate-limited and may only create pending submissions.
- The admin gateway has an origin allowlist, request-size limits, and per-instance rate limits. The in-memory rate limit is best-effort, not a distributed quota.

## Python execution

- Never fall back to plain Python `exec` in the web process.
- Execute user code only through `quolab_execution_sandbox.py` and bubblewrap.
- The runtime image installs bubblewrap and runs as an unprivileged user.
- The sandbox must create user, PID and network namespaces, expose only read-only runtime paths, and write only to its temporary workspace.
- If bubblewrap or required namespaces are unavailable, execution must fail closed. Do not weaken isolation to make a deployment appear healthy.

## Publication checklist

1. Revoke the historical exposed Supabase secret key and replace the Edge Function secret.
2. Enable Supabase Auth leaked-password protection.
3. Require the Docker build and isolated-execution smoke test to pass.
4. Verify the deployed host supports bubblewrap namespaces; an image build alone does not prove runtime support.
5. Publish only the static frontend bundle. Do not upload backend source, migrations, or environment files to Pages.
