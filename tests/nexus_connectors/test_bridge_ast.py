import pathlib
import sys
import unittest

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
