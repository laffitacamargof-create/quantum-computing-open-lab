import importlib.util
import pathlib
import unittest

BRIDGE_PATH = pathlib.Path(__file__).resolve().parents[1] / "nexus-bridge" / "nexus_bridge.py"
SPEC = importlib.util.spec_from_file_location("nexus_bridge_under_test", BRIDGE_PATH)
BRIDGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE)

DECLARATION = """from nexus import connector
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return await ctx.http.request(url="https://example.com")
"""


class CommunityConnectorASTTests(unittest.TestCase):
    def test_rejects_six_reported_escape_payloads(self):
        payloads = [
            "import asyncio\nasyncio.create_subprocess_shell('id')",
            "import asyncio\nasyncio.open_connection('127.0.0.1', 80)",
            "import numpy\nnumpy.loadtxt('/etc/hostname')",
            "import numpy\nnumpy.savetxt('/tmp/out', [1])",
            "import asyncio\nasyncio.sys.modules['os']",
            "x = ().__class__.__bases__",
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                result = BRIDGE.analyze(DECLARATION + "\n" + payload, "community")
                self.assertTrue(result["errors"], payload)

    def test_accepts_multiline_decorator_and_tuple_permissions(self):
        code = """from nexus import connector
@connector.tool(
    "apps",
    allow=("net.http",)
)
async def run(ctx):
    return await ctx.http.request(url="https://example.com")
"""
        result = BRIDGE.analyze(code, "community")
        self.assertEqual(result["errors"], [])

    def test_does_not_reject_a_legitimate_object_open_method(self):
        code = """from nexus import connector
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    reader = Device()
    return reader.open()
"""
        result = BRIDGE.analyze(code, "community")
        self.assertEqual(result["errors"], [])

    def test_rejects_attribute_access_in_format_fields(self):
        code = DECLARATION + "\ntext = '{0.__class__}'.format(object())"
        result = BRIDGE.analyze(code, "community")
        self.assertTrue(any("format fields" in error for error in result["errors"]))


if __name__ == "__main__":
    unittest.main()
