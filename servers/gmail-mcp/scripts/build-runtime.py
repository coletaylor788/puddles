"""Build a relocatable Gmail runtime for the native plugin artifact."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
if sys.version_info[:2] != (3, 11):
    parser.error("Build and run this artifact with Python 3.11")
root = Path(__file__).resolve().parents[1]
out = args.output.resolve()
if out.exists():
    parser.error("output already exists; select an empty task-owned output")
out.mkdir(parents=True, mode=0o700)
subprocess.run(
    [sys.executable, "-m", "pip", "install", "--no-compile", "--require-hashes",
     "--only-binary=:all:", "--target", str(out / "lib"), "-r", str(root / "requirements.lock")],
    check=True,
)
shutil.copytree(root / "src/gmail_mcp", out / "lib/gmail_mcp",
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
(out / "run.py").write_text('''import asyncio
import sys
from pathlib import Path
if sys.version_info[:2] != (3, 11):
    raise SystemExit("Gmail requires Python 3.11")
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from gmail_mcp.server import main
asyncio.run(main())
''')
# Generated console scripts contain build-machine paths. Only run.py is used.
shutil.rmtree(out / "lib/bin", ignore_errors=True)
