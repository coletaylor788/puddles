#!/bin/bash
# Double-click from the OpenClaw owner's Mini desktop.
set +x
/usr/bin/python3 "$HOME/.local/bin/open-puddles-browser.py"
result=$?
if [ "$result" -ne 0 ]; then
  read -r -p "Press Return to close. "
fi
exit "$result"
