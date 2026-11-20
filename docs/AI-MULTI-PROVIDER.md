# QuOLab Nexus multi-provider AI gateway

All browser chat requests go through the authenticated `quolab-nexus-ai` Supabase Edge Function. Provider credentials must never be placed in browser storage, HTML, JavaScript bundles, or Git.

## Built-in providers

The gateway supports these providers when their server-side key is configured:

| Provider ID | Secret name | Default model | API style |
| --- | --- | --- | --- |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | Gemini generateContent |
| `groq` | `GROQ_API_KEY` | `openai/gpt-oss-120b` | OpenAI-compatible chat |
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/free` | OpenAI-compatible chat |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` | OpenAI-compatible chat |

Only providers with configured credentials are considered. The default order is Gemini, Groq, OpenRouter, then DeepSeek. Set `AI_PROVIDER_ORDER` to a comma-separated order to change priority, for example:

```text
AI_PROVIDER_ORDER=gemini,groq,openrouter,deepseek
```

Optional model overrides:

- `AI_MODEL_GEMINI`
- `AI_MODEL_GROQ`
- `AI_MODEL_OPENROUTER`
- `AI_MODEL_DEEPSEEK`

## Adding future OpenAI-compatible providers

The gateway has an extensible custom-provider registry. Set `AI_CUSTOM_PROVIDERS_JSON` to a JSON array. Each entry must contain `id`, an HTTPS `endpoint`, `api_key_env` (the name of another Edge Function secret), and `model`.

Example (placeholder only; do not commit real credentials):

```json
[
  {
    "id": "new-provider",
    "endpoint": "https://api.example.com/v1/chat/completions",
    "api_key_env": "NEW_PROVIDER_API_KEY",
    "model": "provider-model-id"
  }
]
```

Then add `new-provider` to `AI_PROVIDER_ORDER`. The provider's key is read from the named server-side secret. Custom providers use the OpenAI chat-completions request/response format.

## Ollama and local models

Ollama can be added as a custom OpenAI-compatible endpoint only when that endpoint is securely reachable from the Supabase Edge Function runtime. A model running only on a user's laptop at `localhost` is not reachable from Supabase; do not expose an unauthenticated local Ollama port to the public internet. A private tunnel or a separately secured hosted gateway is required.

## Failover and safety

- The browser never chooses a provider or sends provider credentials.
- Supabase validates the caller's anonymous Auth JWT and applies the existing request limits.
- The gateway tries configured providers in order. It falls back on authentication/billing/rate-limit/upstream/network failures; malformed client requests are not retried.
- The response keeps the existing `choices[0].message.content` shape so the current chat UI remains compatible, and adds provider/model metadata.
- This gateway currently provides text chat compatibility. Native tool/function calling, vision, audio, and provider-specific structured output require explicit capability adapters and tests before being enabled.
- External hardware/storage API connectors can also coexist for the same tool. The Nexus broker tries compatible enabled connectors in priority order. Safe read requests can fail over after transport or HTTP errors; non-idempotent writes are not replayed after ambiguous network/server failures to avoid duplicate jobs or charges.
- Provider quotas and free-tier availability are controlled by each provider and are not guaranteed by this gateway.


## Built-in AI provider endpoints

The shared connector core must define a built-in endpoint and default model for every provider exposed by the connector form. The supported built-ins are DeepSeek, Groq, Cerebras, Mistral, OpenAI, and OpenRouter. The `other` provider uses the user-supplied HTTPS base URL. This prevents a connector from being saved successfully while its provider has no runtime endpoint. Multiple enabled AI connectors are still attempted sequentially in saved priority order; they are not fanned out in parallel, avoiding duplicate requests and charges.
