import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nexus-bridge"))
import nexus_bridge as bridge


VALID = '''from nexus import connector

@connector.tool("open_lab", allow=["file.read"])
async def read_file(ctx):
    return await ctx.fs.read("notes.txt")
'''


class BridgeValidationTests(unittest.TestCase):
    def test_valid_official_connector(self):
        self.assertEqual(bridge.analyze(VALID, "official")["errors"], [])

    def test_valid_private_connector(self):
        self.assertEqual(bridge.analyze(VALID, "private")["errors"], [])

    def test_valid_community_connector(self):
        self.assertEqual(bridge.analyze(VALID + "\nimport math\n", "community")["errors"], [])

    def test_syntax_error_is_reported(self):
        result = bridge.analyze("def broken(:\n pass", "community")
        self.assertTrue(any("syntax error" in e.lower() for e in result["errors"]))

    def test_missing_tool_declaration_is_rejected(self):
        self.assertTrue(any("at least one" in e.lower() for e in bridge.analyze("x = 1", "community")["errors"]))

    def test_unknown_tool_is_rejected(self):
        code = VALID.replace('"open_lab"', '"unknown_tool"')
        self.assertTrue(any("unknown tool" in e.lower() for e in bridge.analyze(code, "private")["errors"]))

    def test_unknown_permission_is_rejected(self):
        code = VALID.replace('"file.read"', '"system.root"')
        self.assertTrue(any("unknown permission" in e.lower() for e in bridge.analyze(code, "private")["errors"]))

    def test_empty_permission_list_is_rejected(self):
        code = VALID.replace('["file.read"]', "[]")
        self.assertTrue(any("declares no permissions" in e.lower() for e in bridge.analyze(code, "private")["errors"]))

    def test_permission_overlap_is_rejected(self):
        code = VALID + '\n@connector.tool("notebook", allow=["file.read"])\nasync def second(ctx):\n    return None\n'
        self.assertTrue(any("declared by both" in e.lower() for e in bridge.analyze(code, "private")["errors"]))

    def test_community_rejects_process_execution(self):
        code = VALID.replace('"file.read"', '"proc.run"')
        self.assertTrue(any("proc.run" in e for e in bridge.analyze(code, "community")["errors"]))

    def test_official_allows_process_permission(self):
        code = VALID.replace('"file.read"', '"proc.run"')
        self.assertEqual(bridge.analyze(code, "official")["errors"], [])

    def test_community_rejects_os_import(self):
        self.assertTrue(any('import "os"' in e for e in bridge.analyze(VALID + "\nimport os\n", "community")["errors"]))

    def test_community_allows_math_import(self):
        self.assertEqual(bridge.analyze(VALID + "\nimport math\n", "community")["errors"], [])

    def test_community_rejects_relative_import(self):
        code = VALID + "\nfrom . import helper\n"
        self.assertTrue(any("import from" in e.lower() for e in bridge.analyze(code, "community")["errors"]))

    def test_community_rejects_eval(self):
        code = VALID + "\neval('1 + 1')\n"
        self.assertTrue(any("eval()" in e for e in bridge.analyze(code, "community")["errors"]))

    def test_community_rejects_exec(self):
        code = VALID + "\nexec('pass')\n"
        self.assertTrue(any("exec()" in e for e in bridge.analyze(code, "community")["errors"]))

    def test_community_rejects_compile(self):
        code = VALID + "\ncompile('pass', '<x>', 'exec')\n"
        self.assertTrue(any("compile()" in e for e in bridge.analyze(code, "community")["errors"]))

    def test_community_rejects_dunder_attribute(self):
        code = VALID + "\nx = ctx.__class__\n"
        self.assertTrue(any("access to __class__" in e for e in bridge.analyze(code, "community")["errors"]))

    def test_community_rejects_builtins_name(self):
        code = VALID + "\nx = __builtins__\n"
        self.assertTrue(any("__builtins__" in e for e in bridge.analyze(code, "community")["errors"]))

    def test_invalid_package_requirement_is_rejected(self):
        code = "# requires: -e git+https://example.invalid/x\n" + VALID
        self.assertTrue(any("invalid package requirement" in e.lower() for e in bridge.analyze(code, "community")["errors"]))

    def test_community_rejects_unapproved_package(self):
        code = "# requires: requests>=2.0\n" + VALID
        self.assertTrue(any("not allowed in community" in e.lower() for e in bridge.analyze(code, "community")["errors"]))

    def test_community_accepts_numpy_requirement(self):
        code = "# requires: numpy>=1.0\n" + VALID
        self.assertEqual(bridge.analyze(code, "community")["errors"], [])

    def test_duplicate_requirements_are_collapsed(self):
        code = "# requires: numpy>=1.0, numpy>=1.0\n" + VALID
        self.assertEqual(len(bridge.analyze(code, "community")["requires"]), 1)

    def test_code_size_limit(self):
        result = bridge.analyze(VALID + (" " * (bridge.MAX_CODE + 1)), "community")
        self.assertTrue(any("too large" in e.lower() for e in result["errors"]))

    def test_action_to_tool_mapping_is_returned(self):
        result = bridge.analyze(VALID, "private")
        self.assertEqual(result["actions"]["read_file"], ["open_lab"])

    def test_declared_tool_permission_mapping_is_returned(self):
        result = bridge.analyze(VALID, "private")
        self.assertEqual(result["tools"]["open_lab"], ["file.read"])


class BridgeNetworkSafetyTests(unittest.TestCase):
    def test_public_ipv4_is_allowed(self):
        self.assertTrue(bridge._public("8.8.8.8"))

    def test_public_ipv6_is_allowed(self):
        self.assertTrue(bridge._public("2606:4700:4700::1111"))

    def test_loopback_ipv4_is_rejected(self):
        self.assertFalse(bridge._public("127.0.0.1"))

    def test_private_ipv4_is_rejected(self):
        self.assertFalse(bridge._public("10.0.0.1"))

    def test_private_172_range_is_rejected(self):
        self.assertFalse(bridge._public("172.16.0.1"))

    def test_private_192_range_is_rejected(self):
        self.assertFalse(bridge._public("192.168.1.1"))

    def test_loopback_ipv6_is_rejected(self):
        self.assertFalse(bridge._public("::1"))

    def test_ipv4_mapped_private_ipv6_is_rejected(self):
        self.assertFalse(bridge._public("::ffff:127.0.0.1"))

    def test_resolver_rejects_private_addresses(self):
        answer = [(None, None, None, None, ("127.0.0.1", 0))]
        with patch.object(bridge.socket, "getaddrinfo", return_value=answer):
            with self.assertRaises(bridge.BridgeError):
                bridge._resolve_public("localhost", 443)

    def test_resolver_accepts_public_addresses(self):
        answer = [(None, None, None, None, ("8.8.8.8", 0))]
        with patch.object(bridge.socket, "getaddrinfo", return_value=answer):
            result = bridge._resolve_public("example.invalid", 443)
        self.assertTrue(result)

    def test_guarded_fetch_blocks_loopback_url(self):
        with self.assertRaises(bridge.BridgeError):
            bridge.guarded_fetch("http://127.0.0.1:8765/")

    def test_guarded_fetch_blocks_private_network_url(self):
        with self.assertRaises(bridge.BridgeError):
            bridge.guarded_fetch("http://192.168.1.10/private")

    def test_id_regex_accepts_simple_id(self):
        self.assertRegex("nexus-device_01", bridge.ID_RE)

    def test_id_regex_rejects_path_traversal(self):
        self.assertNotRegex("../secret", bridge.ID_RE)

    def test_id_regex_rejects_whitespace(self):
        self.assertNotRegex("not a valid id", bridge.ID_RE)

    def test_requirement_regex_accepts_version_pin(self):
        self.assertRegex("numpy>=1.24", bridge.REQ_RE)

    def test_requirement_regex_rejects_shell_injection(self):
        self.assertNotRegex("numpy; rm -rf /", bridge.REQ_RE)

    def test_local_origin_accepts_loopback_http(self):
        self.assertRegex("http://127.0.0.1:8765", bridge.LOCAL_ORIGIN)

    def test_local_origin_rejects_remote_host(self):
        self.assertNotRegex("https://example.com", bridge.LOCAL_ORIGIN)


if __name__ == "__main__":
    unittest.main()
