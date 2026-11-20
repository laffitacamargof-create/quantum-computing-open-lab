# QuOLab Nexus AI — DeepSeek gateway

QuOLab Nexus routes DeepSeek requests through the Supabase Edge Function
`quolab-nexus-ai`. The DeepSeek API key must remain server-side.

## Supabase setup

1. In Supabase Dashboard, open **Authentication → Sign In / Providers**.
2. Enable **Allow anonymous sign-ins**. QuOLab Nexus uses anonymous Auth sessions
   so the browser can obtain a short-lived user JWT without collecting an email.
3. In **Edge Functions → Secrets**, create or confirm `DEEPSEEK_API_KEY`.
4. Deploy the `quolab-nexus-ai` Edge Function with JWT verification enabled.

## Runtime flow

1. The browser obtains or refreshes a Supabase anonymous Auth session.
2. It sends the session JWT and the public publishable key to
   `/functions/v1/quolab-nexus-ai`.
3. Supabase verifies the JWT before the function runs.
4. The function confirms the caller is an anonymous Auth user, validates the
   request size and message roles, and applies a best-effort per-user rate limit.
5. The function reads `DEEPSEEK_API_KEY` from its server environment and calls
   `https://api.deepseek.com/chat/completions`.
6. The provider key is never sent to the browser or stored in localStorage.

## Operational notes

- The gateway currently permits 20 requests per user per minute per warm
  function instance. This in-memory limit is best-effort, not a durable global
  quota.
- The gateway accepts `deepseek-chat` and `deepseek-reasoner`; other model
  values fall back to `deepseek-chat`.
- If anonymous sign-ins are disabled, the UI reports a Supabase anonymous
  authentication error. If the server secret is absent, the function returns
  `deepseek_gateway_not_configured`.
- Never commit provider keys to GitHub, frontend configuration, or browser
  storage. Rotate any key previously pasted into chat or committed to source.
