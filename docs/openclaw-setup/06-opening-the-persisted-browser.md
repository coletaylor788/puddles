# Opening the persisted browser

Use these steps when you need to sign in to a website for `browser-agent`. The
Chromium profile is stored outside its container, so cookies and site sessions
survive a browser-container recreate.

Do all of this from the Mac mini's desktop. Do not send the observer link,
credentials, or anything from the browser profile through chat, an issue, or a
remote shell transcript.

## Open the browser

1. Open Terminal on the Mac mini.
2. Ask `browser-agent` for its temporary local viewer link:

   ```bash
   openclaw agent --agent browser-agent --message \
     'Do not open or inspect any page. Reply with only the sandbox browser observer URL from your runtime context.'
   ```

   This turn does not deliver a message to any chat channel. It starts or reuses
   the browser sandbox and prints a short-lived, one-use observer link in the
   local terminal. The link is temporary access to the live browser, so do not
   paste it anywhere else.
3. Open the link in a browser on the Mac mini. It loads the noVNC viewer and
   connects to Chromium without printing the container's noVNC password.
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

If the observer link expires or was already opened, run the same `openclaw
agent` command again to get a fresh one.

If the viewer does not connect or Chromium reports that the profile is already
in use, recreate only the browser-agent browser container:

```bash
openclaw sandbox recreate --browser --agent browser-agent
```

Confirm the prompt, then request a fresh observer link. The profile remains on
the host, and the patched browser startup removes stale Chromium singleton
locks before opening it.

If the agent does not return an observer link, check the browser container
without reading its environment:

```bash
openclaw sandbox list --browser
```

The `browser-agent` entry should be running and show a noVNC port. If it does
not, repair the sandbox setup before attempting a login. Do not work around the
missing link by reading `OPENCLAW_BROWSER_NOVNC_PASSWORD` from Docker.

The persistent-profile setup and patch lifecycle are documented in
[`browser-userdata-dir-fix.md`](./patches/browser-userdata-dir-fix.md).
