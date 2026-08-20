"""Read-only production smoke check for Gmail authentication."""

import argparse
import json
import time

from gmail_mcp.auth import get_gmail_service


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deadline-seconds", type=float, default=60.0)
    args = parser.parse_args()
    if args.deadline_seconds <= 0:
        parser.error("--deadline-seconds must be positive")

    deadline = time.monotonic() + args.deadline_seconds
    service = get_gmail_service(deadline=deadline)
    if service is None:
        raise RuntimeError("Gmail credentials are unavailable")
    service.users().getProfile(userId="me").execute()
    print(json.dumps({"ok": True, "checks": ["credentials", "profile"]}))


if __name__ == "__main__":
    main()
