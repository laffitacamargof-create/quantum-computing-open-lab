"""Regression tests for the fail-closed community connector sandbox."""
import unittest
from unittest import mock

import nexus_bridge


class CommunitySandboxTests(unittest.TestCase):
    def test_non_linux_platform_fails_closed(self):
        with mock.patch.object(nexus_bridge.sys, "platform", "win32"):
            with self.assertRaises(nexus_bridge.BridgeError) as caught:
                nexus_bridge._community_sandbox_command(
                    "/usr/bin/python", "/home/nexus/runner.py",
                    "/home/nexus/connectors/demo/connector.py",
                    "/home/nexus/connectors/demo", "/home/nexus/data/demo", {}
                )
        self.assertEqual(caught.exception.code, "sandbox-unavailable")

    def test_missing_bubblewrap_fails_closed(self):
        with mock.patch.object(nexus_bridge.sys, "platform", "linux"):
            with mock.patch.object(nexus_bridge.shutil, "which", return_value=None):
                with self.assertRaises(nexus_bridge.BridgeError) as caught:
                    nexus_bridge._community_sandbox_command(
                        "/usr/bin/python", "/home/nexus/runner.py",
                        "/home/nexus/connectors/demo/connector.py",
                        "/home/nexus/connectors/demo", "/home/nexus/data/demo", {}
                    )
        self.assertEqual(caught.exception.code, "sandbox-unavailable")

    def test_sandbox_is_networkless_and_limits_writable_mounts(self):
        with mock.patch.object(nexus_bridge.sys, "platform", "linux"):
            with mock.patch.object(nexus_bridge.shutil, "which", return_value="/usr/bin/bwrap"):
                command = nexus_bridge._community_sandbox_command(
                    "/home/nexus/connectors/demo/venv/bin/python",
                    "/home/nexus/runner.py",
                    "/home/nexus/connectors/demo/connector.py",
                    "/home/nexus/connectors/demo",
                    "/home/nexus/data/demo",
                    {"PATH": "/usr/bin"}
                )
        self.assertIn("--unshare-all", command)
        self.assertIn("--clearenv", command)
        self.assertIn("--bind", command)
        self.assertIn("/home/nexus/data/demo", command)
        self.assertIn("--ro-bind", command)
        self.assertIn("/home/nexus/connectors/demo", command)
        self.assertLess(command.index("--dir"), command.index("/etc/ld.so.cache") if "/etc/ld.so.cache" in command else command.index("--dev"))
        self.assertNotIn("--share-net", command)

    def test_community_install_requires_supported_sandbox(self):
        bridge = object.__new__(nexus_bridge.Bridge)
        with mock.patch.object(nexus_bridge.sys, "platform", "darwin"):
            with self.assertRaises(nexus_bridge.BridgeError) as caught:
                bridge.start_install({
                    "id": "community-demo", "origin": "community",
                    "py": "", "ui": "", "web": ""
                })
        self.assertEqual(caught.exception.code, "sandbox-unavailable")


if __name__ == "__main__":
    unittest.main()
