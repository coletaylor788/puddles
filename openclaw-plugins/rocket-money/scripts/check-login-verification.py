"""Run the synthetic browser suite against the installed Python payload."""

import importlib.util
import sys
import unittest
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: check-login-verification.py <packaged-python-lib> <test-login.py>")
    library, tests = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(library))
    import puddles_browser_auth
    import rocket_money_mcp.login
    import rocket_money_mcp.service

    for module in (puddles_browser_auth, rocket_money_mcp.login, rocket_money_mcp.service):
        if not Path(module.__file__).resolve().is_relative_to(library):
            raise SystemExit("Installed package import escaped the candidate")
    spec = importlib.util.spec_from_file_location("installed_login_tests", tests)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = unittest.TextTestRunner(verbosity=2, failfast=True).run(
        unittest.defaultTestLoader.loadTestsFromModule(module)
    )
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
