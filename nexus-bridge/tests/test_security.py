import importlib.util
import os
import sys
import unittest
from unittest.mock import patch

HERE = os.path.dirname(__file__)
BRIDGE_PATH = os.path.abspath(os.path.join(HERE, "..", "nexus_bridge.py"))
spec = importlib.util.spec_from_file_location("nexus_bridge_under_test", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)


def connector(code):
    return "from nexus import connector\n" + code


DANGEROUS = {
    "asyncio subprocess shell": """import asyncio
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    p = await asyncio.create_subprocess_shell("id")
    await p.wait()
""",
    "asyncio subprocess exec": """import asyncio
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    p = await asyncio.create_subprocess_exec("id")
    await p.wait()
""",
    "raw asyncio socket": """import asyncio
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    await asyncio.open_connection("127.0.0.1", 8765)
""",
    "numpy file read": """import numpy
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return numpy.loadtxt("/etc/hostname")
""",
    "numpy file write": """import numpy
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    numpy.savetxt("/tmp/pwn", [1])
""",
    "multiple imports with os": """import json, os
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return 1
""",
    "from os import path": """from os import path
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return 1
""",
    "sys modules escape": """import asyncio
@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return asyncio.sys.modules["os"].getcwd()
""",
    "format dunder escape": """@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return "{0.__class__}".format(1)
""",
    "dunder traversal": """@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return ().__class__.__bases__
""",
    "getattr": """@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return getattr(ctx, "fs")
""",
    "eval": """@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return eval("1")
""",
    "open builtin": """@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return open("/etc/passwd").read()
""",
    "proc.run": """@connector.tool("apps", allow=["proc.run"])
async def run(ctx):
    return 1
""",
}

VALID = {
    "multiline tuple decorator": """@connector.tool(
    "apps",
    allow=("net.http", "file.read"),
)
async def run(ctx):
    return 1
""",
    "comment is not a declaration": """# @connector.tool("apps", allow=["net.http"])
@connector.tool("notebook", allow=["file.read"])
async def run(ctx):
    return 1
""",
    "ordinary open method": """@connector.tool("apps", allow=["net.http"])
async def run(ctx):
    return ctx.fs.open_dir()
""",
}


class CommunityAstSecurityTests(unittest.TestCase):
    def test_known_attack_payloads_are_rejected(self):
        for label, code in DANGEROUS.items():
            with self.subTest(payload=label):
                result = bridge.analyze(connector(code), "community")
                self.assertTrue(result["errors"], label + " unexpectedly passed")

    def test_valid_python_constructs_are_not_false_positives(self):
        for label, code in VALID.items():
            with self.subTest(payload=label):
                result = bridge.analyze(connector(code), "community")
                self.assertEqual(result["errors"], [], label)
                self.assertTrue(result["tools"])

    def test_private_and_special_addresses_are_not_public(self):
        for address in (
            "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1",
            "169.254.169.254", "100.64.0.1", "198.18.0.1", "224.0.0.1",
        ):
            with self.subTest(address=address):
                self.assertFalse(bridge._public(address))

    def test_public_address_is_allowed(self):
        self.assertTrue(bridge._public("1.1.1.1"))

    def test_dns_failures_are_normalized(self):
        with patch.object(bridge.socket, "getaddrinfo", side_effect=OSError("private resolver detail")):
            with self.assertRaises(bridge.BridgeError) as caught:
                bridge._resolve_public("does-not-resolve.invalid", 443)
        self.assertEqual(caught.exception.code, "dns")
        self.assertEqual(caught.exception.status, 502)
        self.assertNotIn("private resolver detail", str(caught.exception))

    def test_community_runner_checks_both_path_arguments(self):
        self.assertIn('path_pair_events = {"os.rename", "os.link", "os.symlink"}', bridge.RUNNER)
        self.assertIn("any(not _inside(path, data_root) for path in args[:2])", bridge.RUNNER)


if __name__ == "__main__":
    unittest.main()
