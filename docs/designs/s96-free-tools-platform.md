# Design — s96-free-tools-platform

Marketing surface (`docs/design-system.md`, the pinned-light `data-theme="light"` pattern of
`/compare` and `/try`): slate and sky on a `slate-50` page, `font-display` headings, rounded
white cards with a `sky-100` border. Every interactive element is an existing primitive from
`src/components/ui/`: `Input`, `Label`, `Button`, `Alert`, `Skeleton`, `Badge`, `CodeBlock`. No new
primitive, no new token.

## `/tools` — the hub

- Breadcrumb "Home / Free tools", eyebrow "Free tools", h1 "Free website tools", one intro line.
- One card per catalogue tool (`ToolCard`): name (h2), one sentence, "Open the <name>" link.
- **About our scanner** (`#about-our-scanner`): what a scan reads (≤ 24 requests: robots.txt, the
  homepage, ≤ 2 sitemap files, ≤ 9 pages; once a day per address and tool), the user agent, what
  is stored and for how long, and the robots.txt opt-out in a `CodeBlock` (copyable). No contact
  address (architect decision 3).
- FAQ (visible `dl`, and the same list as `FAQPage` JSON-LD).

## `/tools/website-spell-checker` — the tool page

- Breadcrumb "Home / Free tools / Website Typo Finder", eyebrow "Free tool", h1, intro.
- **Scan form** (`ToolScanForm`), a white card:
  - **Idle:** label "Website address", `Input type="url"` (placeholder `example.com`), primary
    `Button` "Check for typos" (disabled while empty), hint: "We read your homepage and up to nine
    more public pages. Anything after a ? or # in the address is left out…".
  - **Scanning:** input and button disabled, button reads "Scanning…"; a polite status region says
    "Scanning your pages. This can take up to 20 seconds." over two `Skeleton` bars.
  - **Refused / rate-limited / daily capacity reached / store down / scan failed:** a destructive
    `Alert` with the server's fixed message (never an empty state). The form stays usable.
  - **Success:** the browser loads the report as a new document.
- "What it checks" and "What it leaves alone" cards, side by side from `lg`, stacked below.
- FAQ.

## `/tools/<slug>/r/<id>` — the report

- Eyebrow "<Tool> report", h1 = the scanned host (wraps anywhere), a line with the scan time and
  "public to anyone with this link … deleted after 30 days".
- **Summary card:** verdict `Badge` (`tone-warning` "Worth a look", `tone-success` "Looks good",
  `tone-neutral` "Not checked", …), the headline (h2), facts in a two-column `dl`.
- **Partial:** an info `Alert` when a page was not reached in time; another when findings were
  truncated.
- **Findings:** grouped by page under the page URL (an external link, `rel="nofollow ugc noopener
  noreferrer"`); each finding is a white card: kind label, the sentence with the match in an amber
  `<mark>` (screen readers hear "Start of possible typo: … (end of possible typo)"), the
  suggestion, a note. `code` → `CodeBlock`; an image → a "View image" link, never a thumbnail.
- **Zero findings:** a success `Alert` with the headline. **Not English / no text:** an info `Alert`.
- **Pages not checked:** a list with each reason.
- **CTA** (`ToolCta`, a `sky-100` panel): "Fix it on your live page", the pinned sub-line, two
  buttons (`/try#install`, `/signup`), the crawler footnote. The `alt-text` variant (s101) has no
  `/try` link.
- "Scan another site" link.
- **404 / expired:** h1 "This report isn't available", the 30-day explanation, "Run a new scan" →
  `/tools`.

## Widths

- **390 px:** single column; the form's input and button stack; cards keep a 24 px gutter; long
  URLs and excerpts wrap (`overflow-wrap: anywhere`); nothing scrolls sideways.
- **1440 px:** content capped at `max-w-5xl` (hub, tool page) or `max-w-4xl` (report); tool cards
  two per row; the checks cards side by side.

## Social cards

`src/lib/tools/og-image.tsx`: the `<>` mark on the solid teal tile, eyebrow, title, one line, on a
solid dark ground — no gradient (design system: "No gradient, ever — including … OG images"). No
scanned text is ever drawn.

## Design system gaps

None new. The verdict badge reuses the six status tones. The `<mark>` highlight is a literal
Tailwind `amber-200` on the pinned-light marketing surface; the design system has no highlight
token, which is acceptable on a pinned page but would be a gap on an app surface.
