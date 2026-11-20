import html.parser
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = [
    ROOT / "index.html",
    ROOT / "quolab-nexus-connectors.html",
    ROOT / "quolab-nexus-quantum-puzzle.html",
]


class ScriptCollector(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.parts = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        attrs = dict(attrs)
        kind = (attrs.get("type") or "").lower()
        if kind in ("", "text/javascript", "application/javascript", "module"):
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.current is not None:
            self.scripts.append("".join(self.current))
            self.current = None


ui_source = (ROOT / "quolab-nexus-connectors.html").read_text(encoding="utf-8")
for marker in (
    "function toolPicker(r)",
    "data-card-tool",
    "Assign it to a tool later using the selector on its connector card",
    "NC.ai.list('chat').some",
    "if(tool!=='apps')records.filter",
    "record.kind==='ext'&&next!=='off'",
    "previousAssignments=NC.Assignments.all()",
    "editing.tools||[]",
):
    if marker not in ui_source:
        raise AssertionError("Connector UI regression guard missing: " + marker)

for html in FILES:
    parser = ScriptCollector()
    parser.feed(html.read_text(encoding="utf-8"))
    for script in parser.scripts:
        if not script.strip():
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as f:
            f.write(script)
            f.flush()
            subprocess.run(["node", "--check", f.name], check=True)
    print("JavaScript syntax OK:", html.relative_to(ROOT))
