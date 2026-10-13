# Design — s99-outdated-website-checker

Agent-generated low-fidelity reference:
`docs/designs/s99-outdated-website-checker.html`.

This story inherits the s96 free-tools surface: pinned-light marketing UI, `slate-50` page,
`font-display` headings, white bordered cards and the existing sky accent. It composes only
`ToolPageLayout`, `ToolScanForm`, `Input`, `Label`, `Button`, `Alert`, `Skeleton`, `Badge`,
`ReportSummary`, `FindingList` and `ToolCta`. No primitive, token, gradient or motion is added.

The HTML is a layout and state reference. Execute must build the page with the real components and
must not copy the mockup's markup into production.

## `/tools/outdated-website-checker`

### Header

- Breadcrumb: `Home / Free tools / Is your website out of date?`
- Eyebrow: `Free tool`
- H1: `Is your website out of date?`
- Intro: `Check up to ten public pages for dates, prices and promotions that may have passed. Each result shows the exact line and why it was flagged.`

### Scan form

Use the existing `ToolScanForm` card.

- Label: `Website address`
- Placeholder: `example.com`
- Primary action: `Check for outdated copy`
- Hint: `We read your homepage and up to nine more public pages. Anything after a ? or # in the address is left out, so links with tokens stay private.` The JavaScript limitation is explained in the adjacent card and FAQ because `ToolScanForm` owns one shared hint for every scanning tool.

States remain the shared s96 states:

1. **Idle:** empty input, primary action disabled until an address is present.
2. **Scanning:** input and action disabled; the shared action reads `Scanning…`; the shared polite
   status reads `Scanning your pages. This can take up to 20 seconds.` above two `Skeleton` rows.
3. **Refused or failed:** the fixed server message appears in a destructive `Alert`; the form
   remains usable.
4. **Success:** load the report as a new document. The tool page never tries to render result data.

### Explanation cards

Two white cards sit side by side from `lg` and stack below it.

**What it checks**

- copyright years behind the current year;
- past dates still described as upcoming, bookable or a deadline;
- year-stamped prices, rates, menus and schedules;
- “coming”, “opening” or “launching” in a past year;
- past-year and clearly out-of-season promotions;
- `last updated` labels more than two calendar years old, shown as information.

**What it leaves alone**

- blog and publication dates without future/deadline wording;
- historical copy such as “since 2015” or “founded in 2015”;
- numeric slash dates such as `03/04/2025`;
- non-English pages and copy added only after JavaScript runs.

The second card ends with: `A warning means “review this line”, not “the page is wrong”.`

### FAQ

The visible list and `FAQPage` JSON-LD use the same data.

1. **Which pages does it check?** `Your homepage plus up to nine public pages on the same host, taken from the sitemap or homepage links.`
2. **Does every old date mean the page is outdated?** `No. A date is flagged only when nearby wording still presents it as upcoming, bookable, a deadline, a current price or a promotion. Blog dates and company history are left alone.`
3. **How are month-only dates treated?** `A month such as “October 2026” is not past until that month has ended in UTC.`
4. **Does it read text added by JavaScript?** `No. It reads the HTML the server sends. Pages or lines not present there cannot be checked.`
5. **Does it check other languages?** `No. A page that declares another language, or whose prose does not look English, is listed as not checked.`

## `/tools/outdated-website-checker/r/<id>`

The generic report page remains unchanged.

- Eyebrow: `Is your website out of date? report`
- H1: scanned hostname.
- Summary uses the existing status badge and facts grid.
- Findings remain grouped by page. Each card shows the flagged text in amber `<mark>` and a plain
  reason in `note`; no new kind-specific component is introduced.
- Partial, truncated and pages-not-checked states use the existing information `Alert`s.
- The existing `fix-on-page` `ToolCta` follows the findings.

### Verdict copy

| State   | Badge          | Headline pattern                                         |
| ------- | -------------- | -------------------------------------------------------- |
| Fail    | `Needs fixing` | `2 lines look out of date`                               |
| Warn    | `Worth a look` | `2 lines may need review`                                |
| Pass    | `Looks good`   | `No clearly out-of-date lines on the 6 pages we checked` |
| Skipped | `Not checked`  | `No English pages were checked`                          |

January copyright grace, old `last updated` labels and undated out-of-season promotions produce the
review state. A single clearly stale line makes the report fail. A report with checked pages and no
findings passes.

## Widths

- **390 px:** input and action stack; both explanation cards and every report card are one column;
  dates and URLs wrap anywhere; 24 px page gutter; no horizontal scrolling.
- **1440 px:** tool page stays within `max-w-5xl`; report stays within `max-w-4xl`; explanation
  cards and summary facts use two columns where the shared components already do.

## Accessibility and safety

- Status is text plus tone; color is never the only verdict signal.
- Scanning uses the existing polite status region and shaped skeletons.
- Findings remain attacker-chosen text rendered by React, never HTML.
- The highlighted match keeps s96's screen-reader start/end labels.
- Links to scanned pages keep `nofollow ugc noopener noreferrer`.
- Social cards use only the tool name and static description, never scanned text.

## Design system gaps

None. Every layout, state and component already exists in the s96 free-tools design and current
source. The story changes copy and report data only.

Design ready (docs/designs/s99-outdated-website-checker.md + .html). Next step: /ks-plan s99-outdated-website-checker
