# Shared browser authentication

Trusted host integrations use `BrowserAuth` to own one private Chrome profile and
an HTTP client sharing its cookie jar. Neither the profile nor this library is a
model tool. Configure destinations in trusted code.

The owner signs in through the host desktop. Chrome may save the password in its
native credential store. Renewal follows the configured silent-login route and
waits for delayed redirects, autofill and account verification. It may submit an
already autofilled password once on an approved login origin. MFA,
passkeys and OS unlock prompts require the owner. The library never extracts a
password or exports session data to a caller outside the trusted host.

Automatic renewal requires a trusted account-verification callback. Only an
expired-session result is retried; other verification failures stop recovery.
The recovery loop has a 60-second deadline, with each in-flight HTTP check bounded
by the client timeout. Run the browser in the owner's desktop login session so
Chrome can access its native saved-login store.

Keep the state directory owner-only and outside all agent workspace mounts.
Playwright uses a pipe to Chrome, with no debugging network port. A lifetime lock
prevents concurrent browser owners. Session cookies survive restart in a private
file; that file is a credential and belongs inside the same trusted boundary.

The synthetic browser regression lives in the Rocket Money server test suite.
