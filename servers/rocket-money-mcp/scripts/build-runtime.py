"""Build an isolated, relocatable Python 3.11 runtime before artifact sealing."""

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
root = Path(__file__).resolve().parents[3]
out = args.output.resolve()
if out.exists():
    parser.error("output already exists; select an empty task-owned output")
out.mkdir(parents=True, mode=0o700)
subprocess.run(
    [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--no-compile",
        "--require-hashes",
        "--only-binary=:all:",
        "--target",
        str(out / "lib"),
        "-r",
        str(root / "servers/rocket-money-mcp/requirements.lock"),
    ],
    check=True,
)
for source in (
    root / "packages/browser-auth/src/puddles_browser_auth",
    root / "servers/rocket-money-mcp/src/rocket_money_mcp",
):
    shutil.copytree(source, out / "lib" / source.name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
(out / "run.py").write_text("""import sys
from pathlib import Path
if sys.version_info[:2] != (3, 11):
    raise SystemExit("Rocket Money requires Python 3.11")
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from rocket_money_mcp.__main__ import main
raise SystemExit(main())
""")
# pip-generated scripts have build-machine shebangs. Only run.py is an entry point.
shutil.rmtree(out / "lib/bin", ignore_errors=True)
