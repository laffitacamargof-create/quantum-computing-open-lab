import sys
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


if __name__ == "__main__":
    unittest.main()
