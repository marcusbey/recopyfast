# Installation guide screen

Route: `/docs/install`. Public, readable without sign-in. Agent-produced reference
for the requested documentation page, using the existing app design system.

## Structure

A compact ReCopyFast header with a Sites action, title and short introduction.
On desktop, a narrow contents column beside the article; on mobile, a contents
disclosure before the article. Lead with Copy your snippet, the placeholder code
example and an attribute explanation. Follow with page coverage, installation
choices, verification, invitation and troubleshooting. Advanced React/analytics
notes are clearly labeled but never hidden behind an unrelated screen.

A dedicated Agent installation brief section includes editable input placeholders,
a Copy agent instructions button and a plain-text download. The generated site
snippet itself is copied from the user's dashboard, not from this public page.
Example code is visibly marked as placeholders and never executed.

## Components and tokens

Reuse Button, Card, Alert and existing header/footer conventions. Body uses
Instrument Sans; code uses JetBrains Mono. Use background/card/surface-1,
foreground/muted-foreground, border/input and primary tokens already defined.
No WebGL background, new visual palette, dependency or custom primitive.

## States

Reading is server-rendered and usable without client JavaScript. Agent copy button:
Copy agent instructions → Copied; on denied/unavailable clipboard, show a selectable
text fallback with a short error message. Never display Copied after a failed write.
Section anchors and external links remain ordinary keyboard-accessible links.

## Content

`docs/designs/s59-installation-guide-copy.md` and
`docs/designs/s59-agent-installation-copy.md` contain the complete proposed copy.
`docs/designs/s59-installation-guide.html` is a reference preview, not product code.

## Design system gaps

None. Copy feedback follows the existing button-label pattern, with an explicit
clipboard-failure state. The user requested documentation, not a redesign.

## Reference verification

The local preview renders in the Codex browser. All section anchors resolve,
IDs are unique, and the downloadable Markdown returns 200 and exactly matches
the agent brief. The browser denied clipboard access; the selectable fallback
and honest failure message were verified. Product implementation and its full
keyboard/mobile checks remain behind plan validation.
