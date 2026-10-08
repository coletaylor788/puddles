# Shared browser authentication

Trusted host integrations use `BrowserAuth` to own one private Chrome profile and
an HTTP client sharing its cookie jar. Neither the profile nor this library is a
model tool. Configure destinations in trusted code.

The owner signs in through the host desktop. Chrome may save the password in its
native credential store. Renewal follows the configured silent-login route and
may submit an already autofilled password on an approved login origin. MFA,
passkeys and OS unlock prompts require the owner. The library never extracts a
password or exports session data to a caller outside the trusted host.

Keep the state directory owner-only and outside all agent workspace mounts.
Playwright uses a pipe to Chrome, with no debugging network port. A lifetime lock
prevents concurrent browser owners. Session cookies survive restart in a private
file; that file is a credential and belongs inside the same trusted boundary.

The synthetic browser regression lives in the Rocket Money server test suite.
