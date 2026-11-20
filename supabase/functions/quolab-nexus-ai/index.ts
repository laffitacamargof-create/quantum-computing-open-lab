import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://laffitacamargof-create.github.io",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
]);
const rateBuckets = new Map<string, { startedAt: number; count: number }>();
const DEFAULT_ORDER = ["gemini", "groq", "deepseek", "openrouter"];

type Message = { role: "system" | "user" | "assistant"; content: string };
type Provider = {
  id: string; kind: "openai" | "gemini"; endpoint: string; key: string;
  model: string; timeoutMs?: number; headers?: Record<string, string>;
};

function corsHeaders(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://laffitacamargof-create.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-quolab-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}
function withinRateLimit(userId: string) {
  const now = Date.now(), current = rateBuckets.get(userId);
  if (!current || now - current.startedAt >= 60_000) {
    rateBuckets.set(userId, { startedAt: now, count: 1 }); return true;
  }
  if (current.count >= 60) return false;
  current.count += 1; return true;
}
function env(name: string, fallback = "") { return Deno.env.get(name)?.trim() || fallback; }
function modelFor(id: string, fallback: string) { return env("AI_MODEL_" + id.toUpperCase(), fallback); }

function configuredProviders(): Provider[] {
  const providers: Provider[] = [];
  const addOpenAI = (id: string, endpoint: string, secret: string, model: string) => {
    const key = env(secret);
    if (key) providers.push({ id, kind: "openai", endpoint, key, model: modelFor(id, model), timeoutMs: 10_000 });
  };
  const geminiKey = env("GEMINI_API_KEY");
  if (geminiKey) providers.push({
    id: "gemini", kind: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/",
    key: geminiKey, model: modelFor("gemini", "gemini-2.5-flash"), timeoutMs: 10_000,
  });
  addOpenAI("groq", "https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", "openai/gpt-oss-120b");
  addOpenAI("openrouter", "https://openrouter.ai/api/v1/chat/completions", "OPENROUTER_API_KEY", "openrouter/free");
  addOpenAI("deepseek", "https://api.deepseek.com/chat/completions", "DEEPSEEK_API_KEY", "deepseek-chat");

  // Extensible registry: add future OpenAI-compatible endpoints without changing this function.
  // JSON format: [{ "id":"provider-id", "endpoint":"https://...", "api_key_env":"MY_PROVIDER_KEY", "model":"model-id" }]
  try {
    const custom = JSON.parse(env("AI_CUSTOM_PROVIDERS_JSON", "[]"));
    if (Array.isArray(custom)) for (const item of custom.slice(0, 12)) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id || "").toLowerCase();
      const endpoint = String(item.endpoint || "");
      const secretName = String(item.api_key_env || "");
      const model = String(item.model || "");
      if (!/^[a-z0-9_-]{2,40}$/.test(id) || !/^https:\/\//i.test(endpoint) ||
          !/^[A-Z][A-Z0-9_]{2,80}$/.test(secretName) || !model || providers.some(p => p.id === id)) continue;
      const key = env(secretName);
      if (key) providers.push({ id, kind: "openai", endpoint, key, model, timeoutMs: 10_000 });
    }
  } catch { console.error("AI_CUSTOM_PROVIDERS_JSON is invalid JSON"); }
  return providers;
}
function providerOrder(available: Provider[]) {
  const requested = env("AI_PROVIDER_ORDER", DEFAULT_ORDER.join(","))
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const ids = [...requested, ...available.map(p => p.id)];
  return [...new Set(ids)].map(id => available.find(p => p.id === id)).filter((p): p is Provider => !!p);
}
function retryable(status: number) {
  return status === 401 || status === 402 || status === 403 || status === 408 || status === 409 ||
    status === 413 || status === 425 || status === 429 || status >= 500;
}
async function readLimitedText(req: Request, maxBytes = 100_000) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("payload_too_large");
  if (!req.body) return "";
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("payload_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function invoke(provider: Provider, messages: Message[], maxTokens: number, temperature: number) {
  const controller = AbortSignal.timeout(Math.min(provider.timeoutMs || 10_000, 10_000));
  let response: Response;
  if (provider.kind === "gemini") {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const contents = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    response = await fetch(provider.endpoint + encodeURIComponent(provider.model) +
      ":generateContent?key=" + encodeURIComponent(provider.key), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents, generationConfig: { temperature, maxOutputTokens: maxTokens },
      }), signal: controller,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error("provider_http_error"), { status: response.status });
    const content = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
    if (!content) throw Object.assign(new Error("provider_empty_response"), { status: 502 });
    return { content, model: provider.model, usage: data.usageMetadata || null };
  }
  response = await fetch(provider.endpoint, {
    method: "POST",
    headers: { "Authorization": "Bearer " + provider.key, "Content-Type": "application/json", ...(provider.headers || {}) },
    body: JSON.stringify({ model: provider.model, messages, max_tokens: maxTokens, temperature, stream: false }),
    signal: controller,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("provider_http_error"), { status: response.status });
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw Object.assign(new Error("provider_empty_response"), { status: 502 });
  return { content, model: data.model || provider.model, usage: data.usage || null, id: data.id };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, origin);
  if (origin && !allowedOrigins.has(origin)) return reply(403, { error: "origin_not_allowed" }, origin);
  const requestId = (req.headers.get("x-quolab-request-id") || crypto.randomUUID()).slice(0, 100);

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return reply(401, { error: "user_session_required" }, origin);
  const supabaseUrl = env("SUPABASE_URL");
  const publishableKey = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) return reply(503, { error: "gateway_not_configured" }, origin);

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return reply(401, { error: "invalid_user_session" }, origin);
    if (user.is_anonymous !== true) return reply(403, { error: "anonymous_session_required" }, origin);
    if (!withinRateLimit(user.id)) return reply(429, { error: "rate_limit_exceeded" }, origin);

    let raw: string;
    try { raw = await readLimitedText(req); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === "payload_too_large";
      return reply(tooLarge ? 413 : 400, { error: tooLarge ? "payload_too_large" : "invalid_request_body" }, origin);
    }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }, origin); }
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) return reply(400, { error: "invalid_messages" }, origin);
    let totalChars = 0;
    const safeMessages: Message[] = [];
    for (const item of messages) {
      if (!item || typeof item !== "object") return reply(400, { error: "invalid_message" }, origin);
      const role = (item as Record<string, unknown>).role, content = (item as Record<string, unknown>).content;
      if (!["system", "user", "assistant"].includes(String(role)) || typeof content !== "string") return reply(400, { error: "invalid_message" }, origin);
      totalChars += content.length;
      if (content.length > 20_000 || totalChars > 60_000) return reply(413, { error: "prompt_too_large" }, origin);
      safeMessages.push({ role: role as Message["role"], content });
    }
    const maxTokens = Math.min(Math.max(Number(payload.max_tokens) || 1200, 1), 4096);
    const rawTemperature = Number(payload.temperature);
    const temperature = Number.isFinite(rawTemperature) ? Math.min(Math.max(rawTemperature, 0), 2) : 0.7;
    const providers = providerOrder(configuredProviders());
    if (!providers.length) return reply(503, { error: "no_ai_provider_configured", setup: ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"] }, origin);

    const failures: string[] = [];
    const providerDeadline = Date.now() + 40_000;
    for (const provider of providers) {
      if (Date.now() >= providerDeadline) break;
      provider.timeoutMs = Math.min(provider.timeoutMs || 10_000, Math.max(1000, providerDeadline - Date.now()));
      try {
        const result = await invoke(provider, safeMessages, maxTokens, temperature);
        console.log("AI provider succeeded", { provider: provider.id, model: result.model, userId: user.id });
        return reply(200, {
          id: result.id || crypto.randomUUID(),
          model: result.model,
          provider: provider.id,
          choices: [{ index: 0, message: { role: "assistant", content: result.content }, finish_reason: "stop" }],
          usage: result.usage,
          gateway_received: true, provider_completed: true, request_id: requestId,
          routing: { strategy: "ordered_fallback", attempted_providers: failures },
        }, origin);
      } catch (error) {
        const status = Number((error as { status?: number })?.status || 502);
        console.error("AI provider failed", { provider: provider.id, status, userId: user.id });
        failures.push(provider.id);
        if (!retryable(status)) return reply(status >= 400 && status < 500 ? status : 502, {
          error: "ai_provider_request_failed", provider: provider.id, status,
          gateway_received: true, provider_completed: false, request_id: requestId,
        }, origin);
      }
    }
    return reply(503, { error: "all_ai_providers_unavailable", attempted_providers: failures,
      gateway_received: true, provider_completed: false, request_id: requestId }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("AI gateway error", { message });
    return reply(/timed out|abort/i.test(message) ? 504 : 500, {
      error: /timed out|abort/i.test(message) ? "ai_provider_timeout" : "gateway_internal_error",
    }, origin);
  }
});
