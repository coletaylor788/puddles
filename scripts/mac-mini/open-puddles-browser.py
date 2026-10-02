#!/usr/bin/python3
"""Open the personal OpenClaw browser's local noVNC viewer. No secrets logged."""

import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request


class LauncherError(Exception):
    pass


def run(args, timeout=30):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise LauncherError("A browser command failed or timed out. Check that OpenClaw and Docker are running.") from None
    if result.returncode:
        # Child errors may contain credentials or authenticated URLs.
        raise LauncherError("A browser command failed. Check the OpenClaw browser setup on this Mac.")
    return result.stdout


def runtime_command():
    # Read only executable arguments. Never load the gateway's credential env.
    plist = Path.home() / "Library/LaunchAgents/ai.openclaw.gateway.plist"
    if plist.exists():
        try:
            args = plistlib.loads(plist.read_bytes())["ProgramArguments"]
            index = args.index("gateway")
            node, entry = args[index - 2:index]
            if Path(node).name == "node" and all(Path(x).is_file() for x in (node, entry)):
                return [node, entry]
        except (ValueError, KeyError, TypeError, plistlib.InvalidFileException):
            pass
    cli = shutil.which("openclaw")
    if cli:
        return [cli]
    raise LauncherError("OpenClaw was not found. Repair its local gateway installation, then reopen this shortcut.")


def browser_state(command):
    raw = run(command + ["sandbox", "list", "--browser", "--json"])
    # Some CLI versions prepend diagnostics before the JSON document.
    state = None
    for offset in [0] + [i + 1 for i, c in enumerate(raw) if c == "\n"]:
        try:
            candidate = json.loads(raw[offset:])
            if isinstance(candidate, dict) and isinstance(candidate.get("browsers"), list):
                state = candidate
                break
        except ValueError:
            continue
    if state is None:
        raise LauncherError("OpenClaw did not return a usable browser registry.")
    matches = [b for b in state["browsers"] if isinstance(b, dict) and b.get("sessionKey") == "agent:browser-agent"]
    if len(matches) > 1:
        raise LauncherError("More than one personal browser was found. Resolve browser ownership before opening the viewer.")
    if not matches or not matches[0].get("running"):
        return None
    browser = matches[0]
    port = browser.get("noVncPort")
    name = browser.get("containerName")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535 or not isinstance(name, str) or not name or name.startswith("-"):
        raise LauncherError("The personal browser has no usable noVNC viewer. Check its browser configuration.")
    return browser


def viewer_ready(port):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url = f"http://127.0.0.1:{port}/vnc.html"
        with opener.open(url, timeout=3) as response:
            return response.status == 200 and response.geturl() == url
    except OSError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check readiness without starting a browser, reading its password or opening a window")
    options = parser.parse_args()
    # Finder does not inherit the interactive shell PATH.
    os.environ["PATH"] = os.pathsep.join([str(Path.home()/".npm-global/bin"), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])
    command = runtime_command()
    browser = browser_state(command)
    if options.check:
        if not browser or not viewer_ready(browser["noVncPort"]):
            raise LauncherError("The personal browser viewer is not running. Open the desktop shortcut to start it.")
        print("Personal browser viewer is ready.")
        return
    if Path("/dev/console").stat().st_uid != os.getuid():
        raise LauncherError("Open this shortcut from the browser owner's logged-in Mini desktop.")
    docker = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
    if not Path(docker).is_file():
        raise LauncherError("Docker is not installed. Restore the browser's Docker setup first.")
    if browser is None:
        print("Starting the personal browser. This can take a moment...", flush=True)
        run(command + ["agent", "--agent", "browser-agent", "--message", "Open about:blank, then reply only ready.", "--timeout", "90"], timeout=100)
    deadline = time.monotonic() + 30
    while True:
        browser = browser_state(command)
        if browser and viewer_ready(browser["noVncPort"]):
            break
        if time.monotonic() >= deadline:
            raise LauncherError("The browser viewer did not become ready. Check Docker and the persisted-browser setup guide; the profile was not reset.")
        time.sleep(2)
    password = run([docker, "exec", browser["containerName"], "sh", "-c", 'printf "%s" "$OPENCLAW_BROWSER_NOVNC_PASSWORD"']).strip()
    if not password:
        raise LauncherError("The browser did not provide its viewer password. Check the noVNC setup.")
    url = f'http://127.0.0.1:{browser["noVncPort"]}/vnc.html#' + urllib.parse.urlencode({"autoconnect": "1", "resize": "remote", "password": password})
    run(["/usr/bin/open", url], timeout=10)
    print("Browser viewer opened. Sign in there, then close the outer viewer tab and leave Chromium open.")


if __name__ == "__main__":
    try:
        main()
    except (LauncherError, OSError) as error:
        message = str(error) if isinstance(error, LauncherError) else "The local browser setup could not be read. Check its installation and file permissions."
        print(f"Open Puddles Browser: {message}", file=sys.stderr)
        sys.exit(1)
