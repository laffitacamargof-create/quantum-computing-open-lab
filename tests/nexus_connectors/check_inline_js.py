import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = [
    ROOT / "index.html",
    ROOT / "quolab-nexus-connectors.html",
    ROOT / "quolab-nexus-quantum-puzzle.html",
]

for html in FILES:
    text = html.read_text(encoding="utf-8")
    scripts = re.findall(r"<script\b[^>]*>(.*?)</script\s*>", text, re.I | re.S)
    for number, script in enumerate(scripts):
        if not script.strip():
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as f:
            f.write(script)
            f.flush()
            subprocess.run(["node", "--check", f.name], check=True)
    print("JavaScript syntax OK:", html.relative_to(ROOT))
