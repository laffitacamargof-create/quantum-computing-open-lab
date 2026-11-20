import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nexus-bridge"))
import nexus_bridge


class CommunityASTSecurityTests(unittest.TestCase):
    def assert_rejected(self, source):
        result = nexus_bridge.analyze(source, "community")
        self.assertTrue(result["errors"], source)

    def test_dangerous_imports_and_execution_are_rejected(self):
        cases = [
            "import asyncio\nfrom nexus import connector\n@connector.tool('apps', allow=['net.http'])\nasync def run(ctx):\n    await asyncio.create_subprocess_shell('id')\n",
            "import numpy\nfrom nexus import connector\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n    return numpy.loadtxt('/etc/passwd')\n",
            "import os\nfrom nexus import connector\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n    return 1\n",
            "import socket\nfrom nexus import connector\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n    return 1\n",
            "from nexus import connector\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n    return ().__class__.__bases__\n",
            "from nexus import connector\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n    return 'x'.format()\n",
            "from nexus import connector\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n    return 'x'.format_map({})\n",
            "from nexus import connector\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n    return getattr(ctx, 'fs')\n",
        ]
        for source in cases:
            with self.subTest(source=source):
                self.assert_rejected(source)

    def test_multiline_valid_decorator_is_accepted(self):
        source = (
            "from nexus import connector\n"
            "@connector.tool(\n"
            "  'notebook',\n"
            "  allow=('file.read',),\n"
            ")\n"
            "async def run(ctx):\n"
            "  return await ctx.fs.list('.')\n"
        )
        result = nexus_bridge.analyze(source, "community")
        self.assertEqual([], result["errors"])
        self.assertIn("notebook", result["tools"])



    def test_community_runner_audit_blocks_outside_file_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            runner = pathlib.Path(folder) / "runner.py"
            connector = pathlib.Path(folder) / "connector.py"
            runner.write_text(nexus_bridge.RUNNER, encoding="utf-8")
            connector.write_text("open('/etc/hostname').read()\n", encoding="utf-8")
            env = dict(os.environ, NEXUS_CONNECTOR_ORIGIN="community", PYTHONIOENCODING="utf-8")
            result = subprocess.run(
                [sys.executable, str(runner), str(connector)],
                cwd=folder, env=env, input="", text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8,
            )
            self.assertIn('"fatal"', result.stdout)
            self.assertIn("may read only", result.stdout)

    def test_community_runner_audit_blocks_subprocess(self):
        with tempfile.TemporaryDirectory() as folder:
            runner = pathlib.Path(folder) / "runner.py"
            connector = pathlib.Path(folder) / "connector.py"
            runner.write_text(nexus_bridge.RUNNER, encoding="utf-8")
            connector.write_text("import subprocess\nsubprocess.Popen(['id'])\n", encoding="utf-8")
            env = dict(os.environ, NEXUS_CONNECTOR_ORIGIN="community", PYTHONIOENCODING="utf-8")
            result = subprocess.run(
                [sys.executable, str(runner), str(connector)],
                cwd=folder, env=env, input="", text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8,
            )
            self.assertIn('"fatal"', result.stdout)
            self.assertIn("subprocess.Popen", result.stdout)


    def test_community_execution_fails_closed_without_bubblewrap(self):
        with tempfile.TemporaryDirectory() as folder:
            with mock.patch.object(nexus_bridge.shutil, "which", return_value=None):
                with self.assertRaises(nexus_bridge.BridgeError) as caught:
                    nexus_bridge._community_sandbox_command(
                        os.path.join(folder, "venv", "bin", "python"), str(pathlib.Path(folder) / "runner.py"), folder, folder
                    )
            self.assertEqual("sandbox-unavailable", caught.exception.code)

    def test_community_sandbox_unshares_network_and_mounts_connector_read_only(self):
        with tempfile.TemporaryDirectory() as folder:
            with mock.patch.object(nexus_bridge.shutil, "which", return_value="/usr/bin/bwrap"):
                command = nexus_bridge._community_sandbox_command(
                    sys.executable, str(pathlib.Path(folder) / "runner.py"), folder, folder
                )
            self.assertIn("--unshare-all", command)
            self.assertIn("--ro-bind", command)
            self.assertIn("--bind", command)
            self.assertIn("/nexus-data", command)
            self.assertIn("/nexus-connector", command)

    def test_local_origin_allowlist_is_narrow(self):
        self.assertTrue(nexus_bridge.LOCAL_ORIGIN.match("http://localhost:8765"))
        self.assertFalse(nexus_bridge.LOCAL_ORIGIN.match("http://localhost:9999"))
        self.assertFalse(nexus_bridge.LOCAL_ORIGIN.match("http://127.0.0.1:8799"))

    def test_dns_errors_are_reported_as_gateway_errors(self):
        original = nexus_bridge.socket.getaddrinfo
        try:
            nexus_bridge.socket.getaddrinfo = lambda *a, **k: (_ for _ in ()).throw(nexus_bridge.socket.gaierror("no host"))
            with self.assertRaises(nexus_bridge.BridgeError) as caught:
                nexus_bridge._resolve_public("invalid.example", 443)
            self.assertEqual(502, caught.exception.status)
        finally:
            nexus_bridge.socket.getaddrinfo = original

    def test_community_cannot_request_process_permission(self):
        source = (
            "from nexus import connector\n"
            "@connector.tool('apps', allow=['proc.run'])\n"
            "async def run(ctx):\n"
            "  return 1\n"
        )
        self.assert_rejected(source)


if __name__ == "__main__":
    unittest.main()
