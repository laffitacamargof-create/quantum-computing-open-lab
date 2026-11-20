import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nexus-bridge"))
import nexus_bridge as bridge


def connector(code):
    return "from nexus import connector\n" + code


class CommunityASTSecurityTests(unittest.TestCase):
    def rejected(self, body):
        result = bridge.analyze(connector(body), "community")
        self.assertTrue(result["errors"], body)

    def test_rejects_process_and_socket_escape_imports(self):
        for body in (
            "import asyncio\n@connector.tool('apps', allow=['net.http'])\nasync def run(ctx):\n return 1",
            "import os\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return 1",
            "import numpy\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return 1",
            "from os import path\n@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return 1",
        ):
            with self.subTest(body=body):
                self.rejected(body)

    def test_rejects_attribute_and_dynamic_execution_escapes(self):
        for body in (
            "@connector.tool('apps', allow=['net.http'])\nasync def run(ctx):\n return asyncio.sys.modules['os']",
            "@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return '{0.__class__}'.format(1)",
            "@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return ().__class__.__bases__",
            "@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return getattr(ctx, 'fs')",
            "@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return eval('1')",
            "@connector.tool('apps', allow=['net.http'])\ndef run(ctx):\n return open('/etc/passwd').read()",
        ):
            with self.subTest(body=body):
                self.rejected(body)

    def test_rejects_proc_run_permission(self):
        self.rejected("@connector.tool('apps', allow=['proc.run'])\ndef run(ctx):\n return 1")

    def test_accepts_multiline_tuple_decorator(self):
        result = bridge.analyze(
            "from nexus import connector\n"
            "@connector.tool(\n 'apps',\n allow=('net.http', 'file.read'),\n)\n"
            "async def run(ctx):\n return 1\n",
            "community",
        )
        self.assertEqual([], result["errors"])
        self.assertEqual(["net.http", "file.read"], result["tools"]["apps"])

    def test_ignores_decorator_text_inside_comments(self):
        result = bridge.analyze(
            "# @connector.tool('apps', allow=['net.http'])\n"
            "from nexus import connector\n"
            "@connector.tool('notebook', allow=['file.read'])\n"
            "def run(ctx):\n return 1\n",
            "community",
        )
        self.assertEqual([], result["errors"])
        self.assertEqual({"notebook": ["file.read"]}, result["tools"])

    def test_public_ip_filter_rejects_private_and_reserved_ranges(self):
        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254",
                        "192.168.1.1", "100.64.0.1", "::1",
                        "fc00::1", "fe80::1", "::ffff:127.0.0.1"):
            with self.subTest(address=address):
                self.assertFalse(bridge._public(address))
        for address in ("1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"):
            with self.subTest(address=address):
                self.assertTrue(bridge._public(address))


    def test_community_audit_blocks_external_reads_and_rename_escape(self):
        with tempfile.TemporaryDirectory() as root:
            data = Path(root) / "data"
            data.mkdir()
            outside = Path(root) / "outside.txt"
            source = data / "source.txt"
            source.write_text("inside", encoding="utf-8")
            outside.write_text("outside", encoding="utf-8")
            script = r"""
import importlib.util, os, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("bridge", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
data = Path(sys.argv[2]); outside = Path(sys.argv[3])
os.chdir(data)
outside_fd = os.open(str(outside), os.O_RDONLY)
m._community_audit(str(Path(sys.argv[1])))
blocked_read = False
try:
    open(str(outside), "r").read()
except PermissionError:
    blocked_read = True
try:
    os.rename("source.txt", str(outside))
except PermissionError:
    pass
else:
    raise SystemExit("rename escape was not blocked")
os.lseek(outside_fd, 0, os.SEEK_SET)
outside_contents = os.read(outside_fd, 100).decode("utf-8")
os.close(outside_fd)
if not blocked_read or outside_contents != "outside" or not outside.exists() or not (data / "source.txt").exists():
    raise SystemExit("filesystem audit did not enforce the private data boundary")
print("ok")
"""
            result = subprocess.run(
                [sys.executable, "-c", script, str(ROOT / "nexus-bridge" / "nexus_bridge.py"), str(data), str(outside)],
                cwd=str(data), text=True, capture_output=True, timeout=20
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
