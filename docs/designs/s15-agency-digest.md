# Design — Story s15-agency-digest

> Surface: **email** — the one surface `docs/design-system.md` records as fully off-system
> (`docs/design-system.md:182-205`). This design is the fix: a shared shell derived from the
> light-theme tokens, applied to all three templates (`s15`'s new digest plus the two existing
> transactional sends), so a fourth template cannot repeat the drift.
>
> Email cannot use CSS custom properties, external stylesheets or webfonts (`docs/design-system.md`
> is explicit on this). Every colour below is a **literal**, commented with the token it was
> derived from. No literal appears here that isn't named in `docs/design-system.md:182-205`.

---

## Screen(s)

### 1. Shared shell (new — closes design-system gap #3)

One table-based skeleton, parameterised by a body slot and a footer slot, so the header/brand
mark/canvas can never diverge between templates again.

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:hsl(200 24% 98%);"> <!-- --canvas -->
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;width:100%;background:#ffffff; /* --surface-card */
                  border:1px solid hsl(200 15% 87%);border-radius:12px;overflow:hidden;"> <!-- --line, radius scale -->

      <!-- header: brand mark + wordmark -->
      <tr><td style="padding:24px 32px;border-bottom:1px solid hsl(200 15% 87%);"> <!-- --line -->
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="32" height="32" style="width:32px;height:32px;
                     background:hsl(176 54% 28%); /* --accent-solid */
                     border-radius:8px;text-align:center;vertical-align:middle;">
            <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;
                         color:#ffffff; /* --accent-on-solid */
                         font-size:16px;font-weight:600;line-height:32px;">&lt;&gt;</span>
          </td>
          <td style="padding-left:10px;
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                     font-size:16px;font-weight:600;color:hsl(200 22% 11%);"> <!-- --text-strong -->
            ReCopyFast
          </td>
        </tr></table>
      </td></tr>

      <!-- body slot -->
      <tr><td style="padding:32px;
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                     color:hsl(200 22% 11%);"> <!-- --text-strong -->
        {{BODY}}
      </td></tr>

      <!-- footer slot -->
      <tr><td style="padding:20px 32px;border-top:1px solid hsl(200 15% 87%); /* --line */
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                     font-size:12px;line-height:18px;color:hsl(200 11% 38%);"> <!-- --text-muted -->
        {{FOOTER}}
      </td></tr>

    </table>
  </td></tr>
</table>
```

Weights used: 400 (body), 500 (labels), 600 (wordmark, headings) — never 700, per the
design-system's "never jump 400 → 700" rule applied literally even though email has no
Instrument Sans to jump from.

### 2. The two existing transactional emails, reflowed into the shell

Both currently hand-roll `system-ui` + slate hexes + zero teal
(`src/lib/email/resend.ts:101-107`, `:132-138`). Reflowed, both become: shell header (now
carrying the brand mark for the first time) → body slot with a title, one muted sentence, the
code block → footer slot with the standard expiry/ignore line. No unsubscribe link — these are
transactional, never gated by the digest's opt-out (see States, "unsubscribed").

**Staging access code — body slot:**
```html
<h2 style="margin:0 0 12px;font-size:18px;font-weight:600;color:hsl(200 22% 11%);">
  Staging access code
</h2>
<p style="margin:0 0 16px;color:hsl(200 11% 38%);font-size:14px;line-height:20px;">
  Use this code to verify your access{{FOR_SITE}}:
</p>
<div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;
            font-size:28px;font-weight:600;letter-spacing:6px;font-variant-numeric:tabular-nums;
            padding:16px 0;text-align:center;
            background:hsl(200 24% 97%); /* --surface-1 */
            border-radius:8px;color:hsl(200 22% 11%);">
  {{CODE}}
</div>
```
Footer slot: `Expires in 10 minutes. If you didn't request access, ignore this email.` (muted,
12px — same copy the code already sends as `text`, just now inside the shell's footer style).

**Editor sign-in code — body slot:** identical shape, swap heading to "Your editing code" and
the paragraph to "Enter this code to start editing{{FOR_SITE}}:"; footer swaps to "Expires in
10 minutes and can be used once. If you didn't ask to edit, ignore this email — nothing has
changed." Both keep the monospace / tabular-numeral / wide-letter-spacing treatment the design
system names as the numeric-emphasis pattern — it is the one thing in these templates that
already read as "machine string" and survives unchanged.

### 3. The agency digest (new — `s15`'s deliverable)

**Body slot:**

```html
<p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.075em;
          text-transform:uppercase;color:hsl(200 11% 38%);"> <!-- --text-muted; eyebrow semantics -->
  Monthly digest — July 2026
</p>
<h2 style="margin:0 0 20px;font-size:20px;font-weight:600;color:hsl(200 22% 11%);">
  What your clients changed this month
</h2>

<!-- summary tile: success tone, since this is a positive-outcome callout -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:hsl(162 46% 93%);border-radius:10px;margin:0 0 24px;"> <!-- tone-success-surface -->
  <tr><td style="padding:20px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:28px;font-weight:600;color:hsl(166 72% 24%);"> <!-- tone-success-text -->
        47 edits
      </td>
      <td align="right" style="font-size:28px;font-weight:600;color:hsl(166 72% 24%);">
        ~7.8 hrs saved
      </td>
    </tr></table>
    <p style="margin:10px 0 0;font-size:12px;line-height:17px;color:hsl(166 72% 24%);">
      We estimate time saved by counting 10 minutes per edit — an estimate, not a measurement.
    </p>
  </td></tr>
</table>

<h3 style="margin:0 0 10px;font-size:13px;font-weight:600;color:hsl(200 22% 11%);">
  Edits by site
</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid hsl(200 15% 87%);font-size:14px;color:hsl(200 22% 11%);">acme-dental.com</td>
    <td align="right" style="padding:10px 0;border-bottom:1px solid hsl(200 15% 87%);font-size:14px;font-weight:600;color:hsl(200 22% 11%);">18 edits</td>
  </tr>
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid hsl(200 15% 87%);font-size:14px;color:hsl(200 22% 11%);">riverside-law.com</td>
    <td align="right" style="padding:10px 0;border-bottom:1px solid hsl(200 15% 87%);font-size:14px;font-weight:600;color:hsl(200 22% 11%);">15 edits</td>
  </tr>
  <tr>
    <td style="padding:10px 0;font-size:14px;color:hsl(200 22% 11%);">oakwood-gym.com</td>
    <td align="right" style="padding:10px 0;font-size:14px;font-weight:600;color:hsl(200 22% 11%);">14 edits</td>
  </tr>
</table>

<!-- CTA: table-based button, the email-safe substitute for the app's Button `default` variant -->
<table role="presentation" cellpadding="0" cellspacing="0">
  <tr><td style="background:hsl(176 54% 28%);border-radius:8px;"> <!-- --accent-solid -->
    <a href="https://app.recopyfa.st/dashboard/analytics"
       style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;
              color:#ffffff;text-decoration:none;"> <!-- --accent-on-solid -->
      View full activity in your dashboard
    </a>
  </td></tr>
</table>
```

**Footer slot:**

```html
<p style="margin:0 0 8px;">
  You're receiving this because your account has agency features enabled.
</p>
<p style="margin:0 0 8px;">
  <a href="https://app.recopyfa.st/account/email-preferences/digest-unsubscribe?token={{TOKEN}}"
     style="color:hsl(176 54% 28%);"> <!-- --accent-solid, the link-colour rule applied to email -->
    Unsubscribe from monthly digests
  </a>
  — this won't affect security codes or other account emails.
</p>
<p style="margin:0;">ReCopyFast, [registered postal address]</p>
```

Numbers (`47 edits`, `~7.8 hrs saved`, per-site counts) render right-aligned rather than in
`.tabular` — email has no reliable `font-feature-settings` support, so right-alignment is the
email-safe substitute for the app's tabular-numeral rule; it serves the same purpose (columns of
numbers stay visually aligned as values change).

### Full plain-text version

Required by the story's own acceptance criterion: "renders correctly as plain text... no HTML
tags, all links present as URLs." This is what the paired `text` part sends alongside the HTML
above — no template, no markup, matching `resend.ts`'s existing hand-built-`text` convention:

```
ReCopyFast — Monthly digest — July 2026

What your clients changed this month

47 edits — about 7.8 hours saved
(We estimate time saved by counting 10 minutes per edit — an estimate, not a measurement.)

Edits by site:
- acme-dental.com: 18 edits
- riverside-law.com: 15 edits
- oakwood-gym.com: 14 edits

View full activity: https://app.recopyfa.st/dashboard/analytics

---
You're receiving this because your account has agency features enabled.
Unsubscribe from monthly digests: https://app.recopyfa.st/account/email-preferences/digest-unsubscribe?token={{TOKEN}}
This won't affect security codes or other account emails.

ReCopyFast, [registered postal address]
```

Every link in the HTML (`dashboard/analytics`, the unsubscribe link) appears in the text part as
a bare URL, satisfying the criterion mechanically — this is the seam the research doc already
identified (`docs/research/s15-agency-digest.md:135-141`).

---

## Mockup

**REFERENCE only** — see `docs/designs/s15-agency-digest.html`. It renders the digest (shell +
body + footer from section 3 above) as a real, paste-able HTML email: table layout, inline
styles, literal colours with token-name comments, max-width 600px. It is not production code —
Execute wires the same literals into `src/lib/email/resend.ts` as constants, not by copying this
file's markup verbatim (same "mockup is reference, not code" rule as every other surface).

---

## Reused components

Email cannot import `src/components/ui/*` — no React, no CSS variables, no webfonts survive an
email client. What this design reuses instead, so "off-system" does not mean "unrelated to the
system":

- **The shared shell** (section 1) — the direct email-medium equivalent of the app's `Card` +
  `PageHeader` composition: one skeleton, parameterised, so behaviour (here: visual identity)
  cannot diverge per-caller the way `Card` prevents divergent panel chrome.
- **Derived literals**, not tokens — every hex/hsl value in this document is copied verbatim from
  `docs/design-system.md`'s "Email — off-system" section (canvas, card, text, muted, line, accent,
  accent-on, success surface/text), each with a comment naming its source token. No new colour is
  introduced.
- **The numeric-emphasis pattern** (monospace + wide letter-spacing) from `--font-mono`'s "machine
  strings" role — applied to the two verification codes exactly as the design system specifies for
  tokens/ids, since a one-time code is the same category of string.
- **The `Button` `default` variant's visual contract**, not the component — solid `accent-solid`
  fill, `accent-on-solid` text, no gradient — rebuilt as a table-based link because email cannot
  render a React `<Button>`.
- **Sentence-case, active-voice copy** — "View full activity in your dashboard," not "View Full
  Activity," matching the design system's copy rule verbatim.

---

## States

Email has no interactive states (no hover, no loading spinner reachable inside a client), so the
four app-standard states (skeleton/empty/error/success) do not map directly. What does apply,
named per the story's acceptance criteria:

| State | Behaviour |
|---|---|
| **Zero edits in the period** | **No email is sent at all.** This is not an empty-state screen — there is nothing to design here, and building one would violate the story's own acceptance criterion ("An account with zero edits in the period receives no email"). Stated explicitly so Execute does not invent a "no activity this month" email. |
| **Send failure** | No user-visible email state — the failure happens server-side in the cron job, before anything reaches an inbox. Logged with account and period per the story's criterion; retried without re-sending on success (idempotency ledger, `s15`'s data layer, out of this design's scope). No screen to design. |
| **Unsubscribed** | The recipient stops receiving future digests; this transactional-vs-digest distinction is enforced in data, not in the email's visual design. The unsubscribe **link's destination** (a confirmation page) is an **app surface** — token-driven, on-system — not an email surface, and is out of scope for this document. Flagged here so Execute does not treat the confirmation page as needing email-safe markup; it should be built with `src/components/ui/*` like any other app page. |
| **Sent successfully** | The one state this document designs — sections 2 and 3 above. |

---

## Design system gaps

Record-only, per the contract — none of these is filled freestyle here.

1. **Email had no shared shell (design-system gap #3).** This design closes it: section 1 above
   is the shell; sections 2 and 3 show both existing templates and the new digest riding on it.
   Execute should implement the shell as a small template-literal helper in
   `src/lib/email/resend.ts` (or a sibling module it imports), not duplicate the header/footer
   markup a fourth time.
2. **No documented dark-mode treatment for email (gap #5, restated for this story).** This design
   is light-only by the design system's own instruction ("do not attempt `prefers-color-scheme`
   in email"). Not a gap this story can close — recorded so it isn't silently expected later.
3. **The unsubscribe confirmation page has no design of its own yet.** It's an app surface (see
   States, "unsubscribed"), not an email surface, so it belongs to a future `/ks-design` pass
   once the underlying preference-storage schema exists (research doc flags this schema as
   greenfield: `docs/research/s15-agency-digest.md:193` — "no existing 'preferences' table of any
   kind exists to extend"). Not designed here; not invented here either.
4. **No component-level pattern for "disclosed estimate" exists anywhere in the app design
   system** (`StatusBadge`, `Alert`, etc. all signal state, not methodology). The digest's
   assumption-disclosure sentence ("we estimate... an estimate, not a measurement") is composed
   from existing primitives — `tone-success` surface/text, body copy — rather than a new pattern,
   because the design system has no dedicated "disclosed estimate" component to invent one from.
   If this pattern recurs (e.g. other billing-adjacent estimates), it may be worth promoting to a
   real design-system entry — noted, not acted on here.
