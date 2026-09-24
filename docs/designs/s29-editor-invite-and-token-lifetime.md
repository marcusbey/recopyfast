# Design — s29 editor invitations and snippet regeneration

Use the existing app design system (docs/design-system.md): Card, Button, Alert, Dialog and
status tones. Keep existing dashboard layout. Invitation success says "We emailed <email> an
invitation"; delivery failure keeps the existing manual hub instructions and adds Copy link
with success/failure feedback. Active editor rows add Resend invite with a disabled pending
state and readable rate-limit failures. Each button names its recipient for assistive technology.
A failed resend says the invitation failed and access is unchanged; it does not announce new
access. Revoked rows have no resend.

The existing snippet panel adds Regenerate snippet for admins (presence of server-issued
install credentials). A confirmation dialog warns that old snippets fail subsequent page
requests and new connections, while existing live connections last until reconnect. Old snippets
must be replaced. Confirming updates all snippet/token displays, including installation copy
and history use; failures preserve the prior snippet with an alert. Reuse existing email
template structure and include a single hub CTA plus plain-text equivalent.
