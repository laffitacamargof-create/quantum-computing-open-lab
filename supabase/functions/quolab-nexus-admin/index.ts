import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const founderActions = new Set([
  "quantum_list_pending",
  "quantum_approve_app",
  "quantum_reject_app",
  "quantum_delete_published_app",
  "quantum_config_save",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  // The function performs its own authorization. The publishable key is only
  // a public gateway identifier; all privileged database access stays server-side.
  if (!req.headers.get("apikey")) return reply(401, { error: "missing_api_key" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = Deno.env.get("QUOLAB_NEXUS_SECRET_KEY");
  if (!supabaseUrl || !secretKey || !secretKey.startsWith("sb_secret_")) {
    console.error("QuOLab Nexus backend configuration is incomplete");
    return reply(500, { error: "backend_not_configured" });
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const raw = await req.text();
    if (raw.length > 2_300_000) return reply(413, { error: "payload_too_large" });
    const payload = JSON.parse(raw);
    const action = payload?.action;
    const params = payload?.params && typeof payload.params === "object" ? payload.params : {};

    if (typeof action !== "string") return reply(400, { error: "missing_action" });

    if (action === "repo_is_founder") {
      const key = typeof params.p_key === "string" ? params.p_key : "";
      if (!key) return reply(200, { data: false });
      const { data, error } = await supabase.rpc("repo_is_founder", { p_key: key });
      if (error) return reply(400, { error: "authorization_check_failed" });
      return reply(200, { data: data === true });
    }

    if (founderActions.has(action)) {
      const founderKey = action === "quantum_config_save"
        ? params.p_founder_key
        : params.p_key;
      if (typeof founderKey !== "string" || founderKey.length < 16) {
        return reply(403, { error: "founder_key_required" });
      }
      const { data: authorized, error: authError } = await supabase.rpc(
        "repo_is_founder",
        { p_key: founderKey },
      );
      if (authError || authorized !== true) return reply(403, { error: "forbidden" });
    }

    let result;
    switch (action) {
      case "quantum_submit_app":
        result = await supabase.rpc("quantum_submit_app", { p_app: params.p_app });
        break;
      case "quantum_list_pending":
        result = await supabase.rpc("quantum_list_pending", { p_key: params.p_key });
        break;
      case "quantum_approve_app":
        result = await supabase.rpc("quantum_approve_app", { p_id: params.p_id, p_key: params.p_key });
        break;
      case "quantum_reject_app":
        result = await supabase.rpc("quantum_reject_app", { p_id: params.p_id, p_key: params.p_key });
        break;
      case "quantum_delete_published_app":
        result = await supabase.rpc("quantum_delete_published_app", { p_id: params.p_id, p_key: params.p_key });
        break;
      case "quantum_config_save":
        result = await supabase.rpc("quantum_config_save", {
          p_key: params.p_key,
          p_value: params.p_value,
          p_founder_key: params.p_founder_key,
        });
        break;
      case "repo_create":
        result = await supabase.rpc("repo_create", params);
        break;
      case "repo_update":
        result = await supabase.rpc("repo_update", params);
        break;
      case "repo_delete":
        result = await supabase.rpc("repo_delete", params);
        break;
      default:
        return reply(404, { error: "action_not_allowed" });
    }

    if (result.error) {
      const message = result.error.message || "database_request_failed";
      const status = /forbidden/i.test(message) ? 403 :
        /not_found/i.test(message) ? 404 : 400;
      return reply(status, { error: message });
    }
    return reply(200, { data: result.data });
  } catch (error) {
    if (error instanceof SyntaxError) return reply(400, { error: "invalid_json" });
    console.error("QuOLab Nexus admin request failed:", error instanceof Error ? error.message : "unknown_error");
    return reply(500, { error: "internal_server_error" });
  }
});
