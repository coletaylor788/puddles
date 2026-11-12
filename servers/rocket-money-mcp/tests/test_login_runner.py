"""Installed checks report the first failure before running later browser cases."""

import subprocess
import sys
from pathlib import Path


def test_installed_runner_reports_first_failure_without_running_later_tests(tmp_path):
    library = tmp_path / "library"
    for name in (
        "puddles_browser_auth/__init__.py",
        "rocket_money_mcp/__init__.py",
        "rocket_money_mcp/login.py",
        "rocket_money_mcp/service.py",
    ):
        path = library / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("")
    marker = tmp_path / "later-test-ran"
    tests = tmp_path / "checks.py"
    tests.write_text(
        "import unittest\nfrom pathlib import Path\n"
        "class Checks(unittest.TestCase):\n"
        "    def test_a_failure(self):\n"
        "        self.fail('expected diagnostic')\n"
        "    def test_b_later(self):\n"
        f"        Path({str(marker)!r}).touch()\n"
    )
    runner = (
        Path(__file__).resolve().parents[3]
        / "openclaw-plugins/rocket-money/scripts/check-login-verification.py"
    )
    result = subprocess.run(
        [sys.executable, "-B", "-I", str(runner), str(library), str(tests)],
        capture_output=True, text=True, timeout=10, check=False,
    )
    assert result.returncode == 1
    assert "test_a_failure" in result.stderr
    assert "AssertionError: expected diagnostic" in result.stderr
    assert "Ran 1 test" in result.stderr
    assert not marker.exists()
