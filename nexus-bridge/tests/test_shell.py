import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


class NexusShellRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = read("index.html")
        cls.agent = read("quolab-nexus-agent.js")
        cls.workflow = read(".github/workflows/validate-nexus-agent.yml")
        cls.puzzle = read("quolab-nexus-quantum-puzzle.html")
        cls.studio = read("quolab-nexus-app-studio.html")

    def test_connectors_module_is_in_index(self): self.assertIn("nexus-connectors", cls_or_self(self.index))
    def test_library_page_removed_from_index(self): self.assertNotIn("quolab-nexus-library.html", self.index)
    def test_tutorial_module_not_in_index(self): self.assertNotIn("quolab-nexus-tutorials.html", self.index)
    def test_library_card_not_in_agent(self): self.assertNotIn("Library", self.agent)
    def test_tutorial_card_not_in_agent(self): self.assertNotIn("Tutorials", self.agent)
    def test_sources_button_and_modal_are_removed(self): self.assertNotIn('id="hdr-sources"', self.index); self.assertNotIn('id="src-modal"', self.index)
    def test_ai_connectors_are_selected_per_tool_card(self): self.assertIn("Policy.pick('ai', tool", self.index); self.assertNotIn("nexus_ai_source", self.index)
    def test_card_activation_authorizes_ai_connector(self): self.assertNotIn("nexus_ai_direct_approved", self.index)
    def test_founder_fallback_requires_explicit_approval(self): self.assertIn("nexus_ai_fallback_approved", self.index)
    def test_external_ai_uses_connector_broker(self): self.assertIn("NXC().ai.chat", self.index)
    def test_ai_fallback_is_visible(self): self.assertIn("using the founder gateway as approved fallback", self.index)
    def test_module_api_registration_is_handled(self): self.assertIn("OPENQ_API_REGISTER", self.index)
    def test_module_api_request_is_handled(self): self.assertIn("OPENQ_API_REQUEST", self.index)
    def test_ai_chat_messages_are_handled(self): self.assertIn("OPENQ_AI_CHAT", self.index)
    def test_nested_iframe_sources_are_resolved(self): self.assertIn("while (current && depth++ < 8)", self.index)
    def test_per_tool_assignments_use_connector_store(self): self.assertIn("Assignments.get", self.index)
    def test_cpu_qpu_storage_routes_are_pre_registered(self): self.assertIn("['quantum-app-studio',['cpu','qpu','storage']]", self.index)
    def test_puzzle_passes_app_route(self): self.assertIn("nexusConnector: window.__nexusConnector", self.puzzle)
    def test_studio_has_per_app_route_selector(self): self.assertIn('id="nexus-hardware-select"', self.studio)
    def test_studio_persists_connector_id(self): self.assertIn("nexusConnectorId", self.studio)
    def test_workflow_no_longer_checks_library_page(self): self.assertNotIn("quolab-nexus-library.html", self.workflow)


def cls_or_self(value):
    return value


if __name__ == "__main__":
    unittest.main()
