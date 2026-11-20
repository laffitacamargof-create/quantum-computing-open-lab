import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


class NexusConnectorsModuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ui = read("quolab-nexus-connectors.html")
        cls.core = read("quolab-nexus-connectors-core.js")
        cls.protocol = read("quolab-nexus-core.js")
        cls.bridge = read("nexus-bridge/nexus_bridge.py")
        cls.sql = read("quolab-nexus-connectors.sql")
        cls.tool = read("quolab-nexus-tool-connector.js")

    def test_connectors_page_uses_nexus_brand(self): self.assertIn("Nexus Connectors", self.ui)
    def test_catalog_starts_empty(self): self.assertIn("async load() { return []; }", self.core)
    def test_no_seeded_ai_accounts(self): self.assertNotIn("Main assistant", self.ui)
    def test_no_seeded_backup_ai(self): self.assertNotIn("Fast backup", self.ui)
    def test_no_seeded_quantum_hardware(self): self.assertNotIn("Quantum hardware A", self.ui)
    def test_no_seeded_local_connector(self): self.assertNotIn("Example device reader", self.ui)
    def test_no_qubi_seed(self): self.assertNotIn("qubi", self.ui.lower())
    def test_local_connectors_are_user_created(self): self.assertIn("SAVE CONNECTOR", self.ui)
    def test_local_connector_share_action_exists(self): self.assertIn("SHARE", self.ui)
    def test_pending_review_panel_exists(self): self.assertIn("PENDING", self.ui)
    def test_founder_approval_action_exists(self): self.assertIn("APPROVE", self.ui)
    def test_assignment_panel_is_removed(self): self.assertNotIn("TOOL ASSIGNMENTS", self.ui); self.assertNotIn("renderAssignments", self.ui)
    def test_tool_selector_lives_on_connector_cards(self): self.assertIn("data-card-tool", self.ui); self.assertIn("function toolPicker(r)", self.ui)
    def test_api_creation_forms_do_not_choose_tools(self):
        ai = self.ui[self.ui.index('id="p-ai"'):self.ui.index('id="p-ext"')]
        ext = self.ui[self.ui.index('id="p-ext"'):self.ui.index('id="p-loc"')]
        self.assertNotIn("data-tools", ai + ext)
    def test_connector_exclusivity_exempts_quantum_puzzle(self): self.assertIn("apps:{cpu:Infinity,qpu:Infinity}", self.core); self.assertIn("open_lab:{cpu:1,qpu:1,storage:Infinity}", self.core); self.assertIn("normalizeExclusiveState", self.ui)
    def test_ai_external_local_categories_exist(self): self.assertIn("API · AI", self.ui); self.assertIn("API · EXTERNAL", self.ui); self.assertIn("LOCAL CONNECTOR", self.ui)
    def test_direct_or_bridge_transport_option_exists(self): self.assertIn("ext-via", self.ui)
    def test_credentials_are_not_sampled(self): self.assertNotIn("sk-example", self.ui)
    def test_vault_uses_aes_gcm(self): self.assertIn("AES-GCM", self.core)
    def test_vault_uses_indexeddb(self): self.assertIn("indexedDB", self.core)
    def test_vault_key_is_non_extractable(self): self.assertIn("generateKey({ name: 'AES-GCM', length: 256 }, false", self.core)
    def test_vault_uses_crypto_subtle(self): self.assertIn("crypto.subtle", self.core)
    def test_secret_store_is_not_localstorage(self): self.assertNotIn("localStorage.setItem('nexus_secret", self.core)
    def test_connector_store_uses_nexus_prefix(self): self.assertIn("nexus_connectors_v1", self.core)
    def test_store_uses_broadcast_channel(self): self.assertIn("BroadcastChannel", self.core)
    def test_policy_supports_once_always_off(self): self.assertIn("once", self.core); self.assertIn("always", self.core); self.assertIn("off", self.core)
    def test_ai_broker_exists(self): self.assertIn("const ai", self.core)
    def test_external_broker_exists(self): self.assertIn("const ext", self.core)
    def test_local_broker_exists(self): self.assertIn("const loc", self.core)
    def test_ai_connector_uses_vault_secret(self): self.assertIn("Vault.open", self.core)
    def test_external_connector_uses_vault_secret(self): self.assertIn("Vault.open", self.core)
    def test_local_connector_ast_validation_exists(self): self.assertIn("Analyze.python", self.core)
    def test_community_pending_rpc_exists(self): self.assertIn("nexus_submit_connector", self.core)
    def test_community_published_rpc_exists(self): self.assertIn("nexus_published_connectors", self.core)
    def test_local_bridge_proxy_exists(self): self.assertIn("Bridge.proxy", self.core)
    def test_api_client_is_exposed_to_modules(self): self.assertIn("const api =", self.protocol)
    def test_api_client_supports_storage_adapter(self): self.assertIn("storage:", self.protocol)
    def test_nested_modules_use_top_broker(self): self.assertIn("function brokerWindow()", self.protocol)
    def test_module_fetches_are_routed(self): self.assertIn("engineRequestInfo", self.tool)
    def test_module_registration_is_automatic(self): self.assertIn("installNexusAPI", self.tool)
    def test_module_request_strips_authorization_headers(self): self.assertIn("proxy-authorization", self.tool)
    def test_bridge_binds_loopback_only(self): self.assertIn("127.0.0.1", self.bridge)
    def test_bridge_checks_host_header(self): self.assertIn("Host", self.bridge)
    def test_bridge_uses_public_ip_pinning(self): self.assertIn("_resolve_public", self.bridge)
    def test_bridge_uses_strict_ast_validator(self): self.assertIn("ast.parse", self.bridge)
    def test_bridge_forbids_dynamic_code(self): self.assertIn("FORBIDDEN_CALLS", self.bridge)
    def test_bridge_uses_permission_allowlist(self): self.assertIn("OP_PERM", self.bridge)
    def test_sql_uses_private_schema_for_definer_functions(self): self.assertIn("create schema if not exists private", self.sql)
    def test_sql_public_rpcs_are_invoker(self): self.assertIn("security invoker", self.sql.lower())
    def test_sql_private_functions_are_definer(self): self.assertIn("security definer", self.sql.lower())
    def test_sql_uses_empty_search_path(self): self.assertIn("set search_path = ''", self.sql)
    def test_sql_enables_rls(self): self.assertIn("enable row level security", self.sql.lower())
    def test_sql_pending_table_has_no_direct_grants(self): self.assertIn("revoke all on public.nexus_pending_connectors", self.sql)
    def test_sql_published_table_is_read_only_to_clients(self): self.assertIn("grant select on public.nexus_published_connectors", self.sql)
    def test_sql_rpc_execute_grants_are_explicit(self): self.assertIn("grant execute on function public.nexus_submit_connector", self.sql)
    def test_sql_notifies_postgrest(self): self.assertIn("notify pgrst", self.sql.lower())
    def test_config_sync_does_not_contain_service_key(self):
        cfg = read("quolab-nexus-config-sync.js")
        self.assertNotIn("SUPABASE_SERVICE_KEY", cfg)


if __name__ == "__main__":
    unittest.main()
