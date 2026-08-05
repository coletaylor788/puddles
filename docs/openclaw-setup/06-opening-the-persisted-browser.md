# Opening the persisted browser

Use these steps when you need to sign in to a website for `browser-agent`. The
Chromium profile is stored outside its container, so cookies and site sessions
survive a browser-container recreate.

Do all of this from the Mac mini's desktop. Do not send the viewer address,
credentials, or anything from the browser profile through chat, an issue, or a
remote shell transcript.

## Open the browser

1. Open Terminal on the Mac mini.
2. Check that the `browser-agent` browser container is running:

   ```bash
   openclaw sandbox list --browser
   ```

   Look for a running entry whose session is exactly `agent:browser-agent` and
   which shows a noVNC port. If there is no such entry, start it with a harmless
   local turn, then check again:

   ```bash
   openclaw agent --agent browser-agent --message \
     'Open about:blank, then reply only ready.'
   ```

   The turn is not delivered to any chat channel.
3. Run this snippet in the same Terminal window:

   ```bash
   STATE=$(mktemp)
   trap 'rm -f "$STATE"; unset PW' EXIT

   openclaw sandbox list --browser --json > "$STATE"
   C=$(jq -r \
     '[.browsers[] | select(.running == true and .sessionKey == "agent:browser-agent" and (.noVncPort != null))][0].containerName // empty' \
     "$STATE")
   PORT=$(jq -r --arg container "$C" \
     '[.browsers[] | select(.containerName == $container)][0].noVncPort // empty' \
     "$STATE")

   if [[ -z "$C" || -z "$PORT" ]]; then
     echo "A running browser-agent noVNC container was not found."
     exit 1
   fi

   PW=$(docker exec "$C" sh -c \
     'printf "%s" "$OPENCLAW_BROWSER_NOVNC_PASSWORD"')
   if [[ -z "$PW" ]]; then
     echo "The browser container did not provide a noVNC password."
     exit 1
   fi

   open "http://127.0.0.1:${PORT}/vnc.html#autoconnect=1&resize=remote&password=${PW}"
   unset PW
   ```

   The password and complete viewer address are kept in shell variables and are
   not printed. The address opens directly in the Mac mini's default browser.
   It contains a rotating password in the URL fragment, so do not copy or share
   it.
4. Use the address bar inside the noVNC view to open the website. Sign in there,
   including any two-factor prompt.

Do not let Chromium save the password. Its container uses a basic local password
store, not the macOS keychain. The website's session cookies can still remain in
the persisted profile.

## Finish safely

When sign-in is complete, close the outer noVNC viewer tab. Leave the Chromium
window inside the viewer open. Closing Chromium's last window stops the browser
process.

The next browser-agent run uses the same profile. The simplest non-secret check
is to reopen the viewer and confirm that the site recognizes the session. Do not
inspect or list the profile directory, cookies, local storage, or container
environment.

## Recover a connection

If the viewer does not connect or Chromium reports that the profile is already
in use, recreate only the browser-agent browser container:

```bash
openclaw sandbox recreate --browser --agent browser-agent
```

Confirm the prompt, start the browser with the harmless `about:blank` turn, then
run the connection snippet again. The profile remains on the host, and the
patched browser startup removes stale Chromium singleton locks before opening
it. The viewer port and password can change after a recreate.

If the connection snippet cannot find a running browser, check the browser
container without reading its environment:

```bash
openclaw sandbox list --browser
```

The `browser-agent` entry should be running and show a noVNC port. If it does
not, repair the sandbox setup before attempting a login. Do not print the
container environment or change the connection snippet to echo its password or
complete viewer address.

The persistent-profile setup and patch lifecycle are documented in
[`browser-userdata-dir-fix.md`](./patches/browser-userdata-dir-fix.md).
