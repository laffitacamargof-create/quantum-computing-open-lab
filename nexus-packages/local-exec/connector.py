# Local Python — lets the ecosystem run Python on THIS computer (the computer does the server's work).
# requires: numpy, scipy
from nexus import connector


@connector.tool("open_lab", allow=["proc.run"])
async def run_python(ctx, code, timeout=30):
    """Run a Python program in a separate process. Returns {code, stdout, stderr}."""
    return await ctx.proc.run(cmd=["python", "-I", "-c", code], timeout=timeout)


@connector.tool("open_lab", allow=["proc.run"])
async def python_info(ctx):
    return await ctx.proc.run(cmd=["python", "-I", "-c", "import sys, platform; print(platform.python_version(), platform.platform())"], timeout=10)
