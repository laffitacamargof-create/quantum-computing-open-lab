import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://laffitacamargof-create.github.io",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
]);

const rateBuckets = new Map<string, { startedAt: number; count: number }>();

function corsHeaders(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://laffitacamargof-create.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
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
  const now = Date.now();
  const current = rateBuckets.get(userId);
  if (!current || now - current.startedAt >= 60_000) {
    rateBuckets.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 20) return false;
  current.count += 1;
  return true;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, origin);
  if (origin && !allowedOrigins.has(origin)) return reply(403, { error: "origin_not_allowed" }, origin);

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return reply(401, { error: "user_session_required" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!supabaseUrl || !publishableKey || !deepseekKey) {
    console.error("DeepSeek gateway environment is incomplete");
    return reply(503, { error: "deepseek_gateway_not_configured" }, origin);
  }

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

    const raw = await req.text();
    if (raw.length > 100_000) return reply(413, { error: "payload_too_large" }, origin);
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }, origin); }

    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) {
      return reply(400, { error: "invalid_messages" }, origin);
    }
    let totalChars = 0;
    const safeMessages = [];
    for (const item of messages) {
      if (!item || typeof item !== "object") return reply(400, { error: "invalid_message" }, origin);
      const role = (item as Record<string, unknown>).role;
      const content = (item as Record<string, unknown>).content;
      if (!["system", "user", "assistant"].includes(String(role)) || typeof content !== "string") {
        return reply(400, { error: "invalid_message" }, origin);
      }
      totalChars += content.length;
      if (content.length > 20_000 || totalChars > 60_000) return reply(413, { error: "prompt_too_large" }, origin);
      safeMessages.push({ role, content });
    }

    const requestedModel = String(payload.model || "deepseek-chat");
    const model = ["deepseek-chat", "deepseek-reasoner"].includes(requestedModel) ? requestedModel : "deepseek-chat";
    const maxTokens = Math.min(Math.max(Number(payload.max_tokens) || 1200, 1), 4096);
    const temperature = Math.min(Math.max(Number(payload.temperature) || 0.7, 0), 2);

    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + deepseekKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: safeMessages,
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
      console.error("DeepSeek upstream request failed", { status: upstream.status, userId: user.id });
      return reply(status, { error: upstream.status === 401 ? "deepseek_key_rejected" : "deepseek_request_failed" }, origin);
    }
    return reply(200, {
      id: result.id,
      model: result.model,
      choices: result.choices,
      usage: result.usage,
    }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("DeepSeek gateway error:", message);
    return reply(/timed out|abort/i.test(message) ? 504 : 500, {
      error: /timed out|abort/i.test(message) ? "deepseek_timeout" : "gateway_internal_error",
    }, origin);
  }
});
