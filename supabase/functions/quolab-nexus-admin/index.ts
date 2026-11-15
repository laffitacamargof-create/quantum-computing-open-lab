import { createClient } from "npm:@supabase/supabase-js@2";

const origins = new Set([
  "https://laffitacamargof-create.github.io",
  "https://quantum-computing-open-lab.vercel.app",
  "http://localhost:4173", "http://localhost:5173", "http://localhost:8000",
  "http://localhost:7860", "http://127.0.0.1:4173", "http://127.0.0.1:5173",
]);
const founderActions = new Set([
  "quantum_list_pending", "quantum_approve_app", "quantum_reject_app",
  "quantum_delete_published_app", "quantum_config_save",
]);
const buckets = new Map<string, { start: number; count: number }>();
const MAX_BODY = 2_300_000;
const WINDOW = 60_000;

function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && origins.has(origin) ? origin : "https://laffitacamargof-create.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
  };
}
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}
function rateLimited(req: Request, action: string) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const limit = action === "repo_is_founder" ? 5 : founderActions.has(action) ? 10 : 20;
  const key = ip + ":" + action, now = Date.now(), bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start >= WINDOW) buckets.delete(k);
    return false;
  }
  if (bucket.count >= limit) return true;
  bucket.count++;
  return false;
}
async function readBody(req: Request) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY) throw new Error("too_large");
  if (!req.body) return "";
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error("too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && !origins.has(origin)) return new Response(null, { status: 403 });
    return new Response("ok", { headers: headers(origin) });
  }
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, origin);
  if (origin && !origins.has(origin)) return reply(403, { error: "origin_not_allowed" }, origin);
  if (!req.headers.get("apikey")) return reply(401, { error: "missing_api_key" }, origin);

  const url = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const secret = Deno.env.get("QUOLAB_NEXUS_SECRET_KEY")?.trim() || "";
  if (!url || !secret.startsWith("sb_secret_")) {
    console.error("QuOLab Nexus admin backend configuration is incomplete");
    return reply(503, { error: "backend_not_configured" }, origin);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "too_large";
    return reply(tooLarge ? 413 : 400, { error: tooLarge ? "payload_too_large" : "invalid_json" }, origin);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply(400, { error: "invalid_payload" }, origin);
  const action = payload.action;
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown> : {};
  if (typeof action !== "string") return reply(400, { error: "missing_action" }, origin);
  if (rateLimited(req, action)) return reply(429, { error: "rate_limit_exceeded" }, origin);

  const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (action === "repo_is_founder") {
      const key = typeof params.p_key === "string" ? params.p_key : "";
      if (!key || key.length > 512) return reply(200, { data: false }, origin);
      const { data, error } = await db.rpc("repo_is_founder", { p_key: key });
      if (error) return reply(503, { error: "authorization_check_failed" }, origin);
      return reply(200, { data: data === true }, origin);
    }
    if (founderActions.has(action)) {
      const key = action === "quantum_config_save" ? params.p_founder_key : params.p_key;
      if (typeof key !== "string" || key.length < 16 || key.length > 512) return reply(403, { error: "founder_key_required" }, origin);
      const { data, error } = await db.rpc("repo_is_founder", { p_key: key });
      if (error || data !== true) return reply(403, { error: "forbidden" }, origin);
    }

    let result;
    switch (action) {
      case "quantum_submit_app": result = await db.rpc("quantum_submit_app", { p_app: params.p_app }); break;
      case "quantum_list_pending": result = await db.rpc("quantum_list_pending", { p_key: params.p_key }); break;
      case "quantum_approve_app": result = await db.rpc("quantum_approve_app", { p_id: params.p_id, p_key: params.p_key }); break;
      case "quantum_reject_app": result = await db.rpc("quantum_reject_app", { p_id: params.p_id, p_key: params.p_key }); break;
      case "quantum_delete_published_app": result = await db.rpc("quantum_delete_published_app", { p_id: params.p_id, p_key: params.p_key }); break;
      case "quantum_config_save":
        result = await db.rpc("quantum_config_save", { p_key: params.p_key, p_value: params.p_value, p_founder_key: params.p_founder_key }); break;
      case "repo_create": result = await db.rpc("repo_create", params); break;
      case "repo_update": result = await db.rpc("repo_update", params); break;
      case "repo_delete": result = await db.rpc("repo_delete", params); break;
      default: return reply(404, { error: "action_not_allowed" }, origin);
    }
    if (result.error) {
      const message = String(result.error.message || "");
      const status = /forbidden/i.test(message) ? 403 : /not_found/i.test(message) ? 404 :
        /too large|too long/i.test(message) ? 413 : 400;
      console.error("QuOLab admin RPC failed", { action, status });
      return reply(status, { error: status === 403 ? "forbidden" : status === 404 ? "not_found" :
        status === 413 ? "payload_too_large" : "database_request_failed" }, origin);
    }
    return reply(200, { data: result.data }, origin);
  } catch (error) {
    console.error("QuOLab admin request failed", { action, error: error instanceof Error ? error.name : "unknown" });
    return reply(500, { error: "internal_server_error" }, origin);
  }
});
