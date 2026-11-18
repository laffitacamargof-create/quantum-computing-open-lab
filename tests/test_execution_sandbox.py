import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quolab_execution_sandbox import is_safe, execute_isolated, MAX_CODE_BYTES
class SandboxSecurityTests(unittest.TestCase):
    def test_rejects_import_escape_variants(self):
        payloads = ["__import__('os').system('id')","from os import system\nsystem('id')","import importlib\nimportlib.import_module('os')","getattr(__builtins__, '__import__')('os')","import subprocess\nsubprocess.run(['id'])","import socket\nsocket.socket()"]
        for code in payloads:
            with self.subTest(code=code): self.assertFalse(is_safe(code)[0])
    def test_rejects_dunder_and_dangerous_builtins(self):
        for code in ["x.__class__.__mro__","open('/etc/passwd').read()","eval('1+1')"]:
            with self.subTest(code=code): self.assertFalse(is_safe(code)[0])
    def test_server_execution_path_rejects_import_escape(self):
        for code in ["__import__('os').system('id')", "from os import system", "import importlib\nimportlib.import_module('os')"]:
            with self.subTest(code=code):
                result = execute_isolated(code)
                self.assertFalse(result["success"])
                self.assertIn("no permitido", result["output"].lower())

    def test_allows_scientific_imports(self):
        self.assertTrue(is_safe("import math\nimport numpy as np\nfrom qiskit import QuantumCircuit")[0])
    def test_allows_runtime_and_plotting_imports(self):
        code = (
            "import time\\nimport re\\nimport typing\\n"
            "from dataclasses import dataclass\\n"
            "import matplotlib\\nmatplotlib.use('Agg')"
        )
        self.assertTrue(is_safe(code)[0], "Common runtime and Agg plotting imports must pass validation.")

    def test_rejects_unapproved_imports_after_allowlist_expansion(self):
        for code in ["import os", "import subprocess", "import socket"]:
            with self.subTest(code=code):
                self.assertFalse(is_safe(code)[0])

    def test_allows_json_wrapper_used_by_quantum_app_bridges(self):
        # Puzzle and App Studio append this exact serialization wrapper to every pyCall.
        code = (
            "def calculate():\n    return {'answer': 42}\n"
            "import json\n"
            "_result = calculate(*[])\n"
            "print(json.dumps(_result, ensure_ascii=False))"
        )
        self.assertTrue(is_safe(code)[0], "The generated pyCall wrapper must pass sandbox validation.")
    def test_rejects_ctypes_and_file_escape_surfaces(self):
        for code in ["import numpy.ctypeslib", "np.ctypeslib.as_ctypes(x)", "np.load('/etc/passwd')"]:
            with self.subTest(code=code):
                self.assertFalse(is_safe(code)[0])

    def test_rejects_oversized_code(self):
        self.assertFalse(is_safe("x=1\n"+(" "*MAX_CODE_BYTES))[0])
if __name__ == "__main__": unittest.main()
