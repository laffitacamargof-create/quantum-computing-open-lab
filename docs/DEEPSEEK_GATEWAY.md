# QuOLab Nexus AI gateway

All browser AI requests pass through the Supabase Edge Function `quolab-nexus-ai`. Provider credentials are server-side secrets and must never be placed in browser code, local storage, or Git.

## Configure providers

Set one or more of these Edge Function secrets in Supabase:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`

Optional routing/model settings:

- `AI_PROVIDER_ORDER` — comma-separated provider IDs. Default: `gemini,groq,deepseek,openrouter`.
- `AI_MODEL_GEMINI`, `AI_MODEL_GROQ`, `AI_MODEL_DEEPSEEK`, `AI_MODEL_OPENROUTER`.
- `AI_CUSTOM_PROVIDERS_JSON` — optional OpenAI-compatible provider registry.

OpenRouter's free route is intentionally last because availability and latency vary.

## Authentication and limits

The browser obtains an anonymous Supabase Auth session and sends its user JWT to the gateway. Enable anonymous sign-ins in Supabase Auth if this deployment uses that flow. The gateway currently applies an in-memory limit of 60 requests per user per minute; it is process-local and is not a durable cross-instance quota.

## Timeouts and retries

The Edge Function uses a 40-second total provider budget and a maximum 10-second timeout per provider. The client allows 45 seconds for the gateway response and retries only selected server errors, at most twice. It does not retry HTTP 429, nor replay a request after a client timeout or confirmed gateway receipt. Respect any rate-limit response and wait before sending another request.

## Logs

Inspect Edge Function logs with:

```sh
supabase functions logs quolab-nexus-ai
```

For the complete provider and secret configuration, see [AI-MULTI-PROVIDER.md](./AI-MULTI-PROVIDER.md). Never place a Supabase service-role key in browser code. Rotate any service-role key that may previously have been exposed.
