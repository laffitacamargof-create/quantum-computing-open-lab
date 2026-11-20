import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

BRIDGE_PATH = Path(__file__).resolve().parents[1] / "nexus_bridge.py"
spec = importlib.util.spec_from_file_location("nexus_bridge_under_test", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CommunityConnectorSecurityTests(unittest.TestCase):
    def test_ast_rejects_reported_escape_payloads(self):
        payloads = {
            "asyncio subprocess shell": 'import asyncio\nfrom nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    await asyncio.create_subprocess_shell("id")\n',
            "asyncio raw socket": 'import asyncio\nfrom nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    await asyncio.open_connection("127.0.0.1", 8765)\n',
            "numpy file read": 'import numpy\nfrom nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return numpy.loadtxt("/etc/hostname")\n',
            "numpy file write": 'import numpy\nfrom nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    numpy.savetxt("/tmp/pwn", [1])\n',
            "multi import os": 'import json, os\nfrom nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return 1\n',
            "importlib module access": 'import asyncio\nfrom nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return asyncio.sys.modules["os"]\n',
            "format dunder": 'from nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return "{0.__class__}".format(1)\n',
            "dunder traversal": 'from nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return ().__class__.__bases__\n',
            "getattr": 'from nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return getattr(ctx, "fs")\n',
            "eval": 'from nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return eval("1")\n',
            "open file": 'from nexus import connector\n@connector.tool("apps", allow=["net.http"])\nasync def run(ctx):\n    return open("/etc/passwd").read()\n',
            "proc permission": 'from nexus import connector\n@connector.tool("apps", allow=["proc.run"])\nasync def run(ctx):\n    return 1\n',
        }
        for name, code in payloads.items():
            with self.subTest(payload=name):
                self.assertTrue(bridge.analyze(code, "community")["errors"])

    def test_ast_accepts_multiline_decorator_and_ignores_comment(self):
        code = '''# @connector.tool("apps", allow=["net.http"])
from nexus import connector
@connector.tool(
    "notebook",
    allow=("file.read",),
)
async def run(ctx):
    return 1
'''
        result = bridge.analyze(code, "community")
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["tools"], {"notebook": ["file.read"]})

    def test_guarded_fetch_rejects_private_and_unsafe_urls(self):
        urls = [
            "http://example.com/",
            "https://127.0.0.1/",
            "https://10.0.0.1/",
            "https://169.254.169.254/",
            "https://[::1]/",
            "https://user:pass@example.com/",
        ]
        for url in urls:
            with self.subTest(url=url):
                with self.assertRaises(bridge.BridgeError):
                    bridge.guarded_fetch(url)

    def test_community_audit_blocks_read_and_rename_escape(self):
        with tempfile.TemporaryDirectory() as root:
            data = Path(root) / "data"
            data.mkdir()
            outside = Path(root) / "outside.txt"
            source = data / "source.txt"
            source.write_text("inside", encoding="utf-8")
            outside.write_text("outside", encoding="utf-8")
            script = r'''
import importlib.util, os, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("bridge", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
data = Path(sys.argv[2]); outside = Path(sys.argv[3])
os.chdir(data)
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
if not blocked_read or outside.read_text(encoding="utf-8") != "outside" or not (data / "source.txt").exists():
    raise SystemExit("filesystem audit did not enforce the private data boundary")
print("ok")
'''
            result = subprocess.run(
                [sys.executable, "-c", script, str(BRIDGE_PATH), str(data), str(outside)],
                cwd=str(data), text=True, capture_output=True, timeout=20
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
