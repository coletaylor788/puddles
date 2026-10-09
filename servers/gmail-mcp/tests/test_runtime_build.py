"""Exercise the artifact builder and its relocated entry point without downloads."""

import runpy
import shutil
import sys
from pathlib import Path

import pytest


def test_runtime_is_relocatable_and_uses_only_locked_dependencies(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    source = tmp_path / "source"
    (source / "scripts").mkdir(parents=True)
    shutil.copy(root / "scripts/build-runtime.py", source / "scripts/build-runtime.py")
    (source / "requirements.lock").write_text("fixture lock")
    package = source / "src/gmail_mcp"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("")
    (package / "server.py").write_text("async def main():\n    pass\n")
    (package / "__pycache__").mkdir()
    (package / "__pycache__/stale.pyc").write_bytes(b"stale")
    out = tmp_path / "build"
    commands = []

    def install(command, *, check):
        assert check
        commands.append(command)
        scripts = out / "lib/bin"
        scripts.mkdir(parents=True)
        (scripts / "nonportable").write_text("build-host shebang")

    monkeypatch.setattr("subprocess.run", install)
    monkeypatch.setattr(sys, "version_info", (3, 11, 0))
    monkeypatch.setattr(sys, "argv", ["build-runtime.py", "--output", str(out)])
    runpy.run_path(str(source / "scripts/build-runtime.py"), run_name="__main__")
    assert "--require-hashes" in commands[0]
    assert "--only-binary=:all:" in commands[0]
    assert str(source / "requirements.lock") in commands[0]
    assert not (out / "lib/bin").exists()
    assert not list(out.rglob("*.pyc"))
    with pytest.raises(SystemExit):
        runpy.run_path(str(source / "scripts/build-runtime.py"), run_name="__main__")
    moved = tmp_path / "relocated"
    out.rename(moved)
    shutil.rmtree(source)
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setattr(sys, "dont_write_bytecode", False)
    for name in list(sys.modules):
        if name == "gmail_mcp" or name.startswith("gmail_mcp."):
            monkeypatch.delitem(sys.modules, name)
    runpy.run_path(str(moved / "run.py"), run_name="__main__")
    assert sys.dont_write_bytecode
    assert not list(moved.rglob("*.pyc"))
