# Google Analytics 4 — the marketing site

Story `s107-google-analytics`, [ADR 063](../decisions/063-google-analytics-on-the-marketing-surface.md).
Configured 2026-10-12 in the owner's Google account (`rboboe@gmail.com`). This page records every
setting with its value, so a later change is a diff against something written down.

## Where it lives

| What | Value |
|---|---|
| GA account | `marcusbey` (104640178), organisation "Romain BOBOE StudioLab". Existing account: creating a new one would have required the owner to accept Google's terms, so the property was added here |
| Property | **RecopyFast** (558499366) |
| Time zone / currency | Canada, (GMT-04:00) Toronto Time (America/Toronto) / US Dollar |
| Business details | Internet & Telecom, Small (1–10). Objectives: generate leads, drive sales, understand web traffic |
| Web stream | **RecopyFast web**, `https://www.recopyfa.st`, stream id 16109846324 |
| Measurement id | `G-DQ…` (public by design: it is in every page that loads gtag.js). Read it in GA: Admin → Data streams → RecopyFast web |
| Vercel env | `NEXT_PUBLIC_GA_MEASUREMENT_ID`, **Production only** (`vercel env ls` shows `Production`). Previews build without it and load nothing |

## Admin settings, as applied

Each was re-read after saving (page reloaded, value read back), and every row was read back again
later the same day, in a fresh session, unchanged.

| Setting | Where in GA | Value | Why |
|---|---|---|---|
| Data retention, event data | Admin → Data collection and modification → Data retention | **14 months** | Brief; the longest GA4 offers |
| Data retention, user data | same | **14 months** | Brief |
| Reset user data on new activity | same | **Off** | So 14 months is a hard limit; /privacy says "a new visit does not extend that period" |
| Google signals | Admin → Data collection → Google signals data collection | **Off** (never turned on) | Brief. The code also sends `allow_google_signals: false` |
| User-provided data collection | Admin → Data collection | **Off** | Not used |
| Granular location and device data | Admin → Data collection → Granular location and device data collection | **Off in 39 regions**, on in 268 of 307 | Off for EU 27, IS, LI, NO, GB, CH, and AX, GF, GP, MF, MQ, RE, YT — the same list as `CONSENT_REQUIRED_REGIONS` |
| Ads personalization | Admin → Data collection → Advanced settings to allow for ads personalization | **Disallowed in all 307 regions** | Brief: no ads. The code also sends `allow_ad_personalization_signals: false` |
| Enhanced measurement: page views | Data streams → RecopyFast web → Enhanced measurement | **On**, page loads only. **"Page changes based on browser history events": Off** | See "Deviation" below. Client-side navigations are counted by our code |
| Enhanced measurement: scrolls | same | **On** | Brief |
| Enhanced measurement: outbound clicks | same | **On** | Brief |
| Enhanced measurement: site search | same | **Off** | Brief: no site search |
| Enhanced measurement: video engagement | same | **Off** | Brief |
| Enhanced measurement: file downloads | same | **On** | Brief |
| Enhanced measurement: form interactions | same | **Off** | Brief: noisy |
| Key events | Admin → Data display → Events → Key events | **`sign_up`, `generate_lead`, `begin_checkout`, `tool_scan_completed`**, created "with code", no default value, counted once per event | Brief. `close_convert_lead` and `qualify_lead` (added by the "generate leads" objective) were unmarked. `purchase` is Google's built-in key event and cannot be unmarked; nothing sends it |
| Custom dimensions | Admin → Data display → Custom definitions | **`tool_slug`** (event scope, parameter `tool_slug`); **`cta_location`** (event scope, parameter `cta_location`) | Brief |
| Unwanted referrals | Data streams → RecopyFast web → Configure tag settings → List unwanted referrals | Referral domain contains **`checkout.stripe.com`**; contains **`js.stripe.com`** | Brief: a return from Stripe Checkout is not a new referral |
| User-provided data capabilities (Google tag) | Configure tag settings → Allow user-provided data capabilities | **Off** | It was **on by default, with automatic detection of emails, phone numbers and addresses on the page**. Turned off: the site sends no personal data to Google |
| Redact data | Data streams → RecopyFast web → Redact data | Email: **on** (default). URL query parameters: **on**, keys `rcf_edit_token`, `rcf_token`, `rcf_handoff`, `email` | A second layer under the code's sanitiser, which already drops every non-`utm_*` key |
| Collect Universal Analytics events | Configure tag settings | Off (default) | — |
| Developer traffic filter | Admin → Data filters | **"Developer Traffic", Exclude, state Testing** | Brief. Events carrying `debug_mode`/`debug_event` are tagged, not dropped |
| Internal traffic filter | Admin → Data filters | "Internal Traffic", Exclude, **Testing** (GA's default), **no rule defined** | Brief: only if the owner's IP is stable. It is not known to be — skipped. To add: Configure tag settings → Define internal traffic, then activate the filter |
| Account-level data sharing | Admin → Account details | Not changed | Account-wide: it also covers the account's six other properties, outside this story |

## Deviation from the brief: browser-history page views

The brief asked for enhanced-measurement page views "including browser-history events". That
setting is **off**, and the code sends those page views instead. Two reasons, both verified:

1. Google: enhanced measurement's history page views are sent "even if you set `send_page_view:
   false`", and they use the raw `location.href`
   ([developers.google.com/analytics/devguides/collection/ga4/views](https://developers.google.com/analytics/devguides/collection/ga4/views)).
   With them on, every client-side navigation would be counted twice (ours and Google's) and
   Google's copy would carry the query string — on `/tools/website-maintenance-cost` that is the
   visitor's own figures (`?sites=…&rate=…`), which the calculator writes with `router.replace` as
   they type.
2. Google's listener runs inside `pushState`, before React knows the route changed, so it would
   also count a client navigation onto a page off the allowlist before the component can switch
   GA off.

`GoogleAnalytics` sends one `page_view` per allowlisted pathname, sanitised, so client-side
navigation is still measured. To revert, both the GA checkbox and the code must change together.

## What the code does

- **Pages:** `isAnalyticsRoute` (`src/lib/analytics/google-analytics/routes.ts`): `/`, `/try`,
  `/pricing`, `/privacy`, `/terms`, `/demo`, and `/compare`, `/tools`, `/blog`, `/docs` with
  everything below them — **except s96's scan reports, `/tools/<slug>/r/…`**. Never `/dashboard`,
  `/settings`, `/edit`, `/login`, `/signup`, `/auth/*`, the API, `/embed/*` or `/try/rcf-try.js`.
  A test pins that no path is both on the allowlist and under the nonce policy.
- **The document, too** (`isAnalyticsPage`, independent review F1): the client also requires the
  path the *document* was loaded on to be allowlisted (`getDocumentPathname`, `document-path.ts`:
  the navigation entry, else `location.pathname` when the module first ran). The CSP belongs to
  the document and a client navigation keeps it, so a marketing page reached by a `<Link>` from
  `/login`, `/signup`, the dashboard or a report loads nothing and shows no "Cookie settings";
  the next full page load measures normally.
- **Loading:** the shell in the root layout fetches the runtime chunk (`import()`) after
  hydration on allowlisted pages only and mounts it in `startTransition`. Then the first-party
  `/analytics/gtag-init.js` (route handler: Consent Mode
  defaults, `url_passthrough: false`, `ads_data_redaction: true`, and the country hint as one
  boolean; `private, no-store`, 404 without an id). On its `onReady`, gtag.js
  (`https://www.googletagmanager.com/gtag/js?id=…`, `afterInteractive`) is requested only when no
  consent is needed or the visitor allowed it. No inline script.
- **Consent:** EEA + UK + CH (and the EU outermost regions with their own ISO codes) and Quebec
  (`CA-QC`, by `x-vercel-ip-country-region`) default to everything denied, by Google's `region`
  match and by our hint. Elsewhere analytics is granted, ads always denied. Fail-closed → consent
  required: a missing or malformed `x-vercel-ip-country`, a code that is not one of ISO 3166-1's
  249 assigned codes (GeoIP placeholders XX, ZZ, T1, A1, A2, O1, EU, AP), or `CA` without a known
  province. Where consent is required, **nothing is requested from Google until "Allow
  analytics"**. The choice is the first-party cookie `rcf_analytics_consent=granted|denied`, 180
  days, `SameSite=Lax`, `Secure`. "Cookie settings" in the footer reopens the banner (only where
  GA can run on that page); the banner describes the choice in effect — outside the consent
  regions with nothing stored, "analytics is on", "Allow" pressed, closable. Declining after
  allowing denies consent, sets `window['ga-disable-<id>']`, and deletes `_ga`/`_ga_*`/`_gid`/
  `_gat*` host-only and on every parent domain (`.recopyfa.st`, where gtag.js writes them;
  `googleAnalyticsCookieDeletions`).
- **GA admin, unchanged for Quebec:** "Granular location and device data collection" stays as
  configured above (off for the EEA, the UK and Switzerland); it was not touched for Canada when
  Quebec joined the consent rule (code-only change, 2026-10-12). The privacy page's "city-level
  location … not collected" sentence names the EEA, the UK and Switzerland only, so it stays
  true. Turning it off for Canada too is an owner choice in the property.
- **Config:** `send_page_view: false`, `allow_google_signals: false`,
  `allow_ad_personalization_signals: false`, `cookie_expires` 395 days (13 months).
- **`page_location`:** no fragment, no query key but `utm_*` (and those only on the landing page
  view; a `utm_*` value with `@` is dropped), UUID path segments become `[id]`. `page_referrer`
  is sanitised the same way.
- **CSP:** on an allowlisted page with an id, the static policy adds `https://www.googletagmanager.com`
  to `script-src`/`script-src-elem`, `https://*.google-analytics.com https://*.analytics.google.com
  https://*.googletagmanager.com` to `connect-src` and `https://*.google-analytics.com
  https://*.googletagmanager.com` to `img-src`. The nonce (app) policy never changes.

## Events

| Event | Sent when | Params | Key event |
|---|---|---|---|
| `page_view` | each allowlisted pathname (client navigations included) | `page_location`, `page_referrer` | — |
| `generate_lead` | click on a same-origin link to `/signup` | `cta_location` | yes |
| `begin_checkout` | click on a same-origin link to `/dashboard/billing` (Pricing's "Buy Lifetime Pro", "Buy founding access") | `cta_location` | yes |
| `try_started` | the `/try` sample preview becomes active | — | no |
| `tool_scan_completed` | a free tool produced the visitor's own result. Scanning tools (s96, `ToolScanForm`): on the tool page, when the scan succeeds, just before the report opens. The calculator: once per page view, the first time the inputs settle while analytics is active (`track` returns whether it sent; a result before consent does not use the event up) | `tool_slug` (never the scanned address) | yes |
| `sign_up` | **not sent yet** — see below | — | yes |

`cta_location` values: `hero`, `header`, `final_cta`, `founding_offer`, `pricing_plan`,
`pricing_lifetime_pro`, `pricing_founding_agency`, `comparison_page`, `compare_index`,
`tool_page`, `try_page`, `demo`, `blog_index` (from `data-cta-location`), else `header`,
`footer`, the enclosing `section` id, or `page`. Every param value must match
`^[a-z0-9][a-z0-9_-]{0,63}$` or it is dropped.

### Free tools (s96): the tool page is measured, the report is not

Architect decision on merging s96 (2026-10-12), recorded in ADR 063:

- **Scan reports, `/tools/<slug>/r/<id>`, carry no analytics.** They stay on the strict nonce
  policy (s96's ADR 062) with no Google host, and `isAnalyticsRoute` excludes them (and anything
  below a tool's `r` segment), so the runtime is not even fetched there. A report renders text
  scraped off a stranger's site and its URL is a capability: neither may reach Google.
- **The scan is measured where it starts.** `ToolScanForm`, on the tool page (marketing policy,
  allowlisted), sends `tool_scan_completed` with the tool's slug when the scan API answers with a
  valid report path, just before the report opens as a new document. gtag.js flushes queued
  events with `sendBeacon` as the page unloads. Refused or failed scans send nothing.
- The `/tools` hub has no scan of its own; its CTAs and the tool pages' `ToolCta` links
  (`data-cta-location="tool_cta"`) feed `generate_lead` like every other CTA.

A new scanning tool that uses `ToolScanForm` is measured with no extra code. A tool that
produces its result differently calls:

```ts
import { track } from "@/lib/analytics/google-analytics/gtag";
track("tool_scan_completed", { tool_slug: TOOL_SLUG });
```

It is a no-op unless analytics runs on that page, and returns whether it sent: if the event
should go once per page view, mark it sent only on `true`.

### `sign_up`: Measurement Protocol follow-up (not built)

`/signup` is on the nonce policy and off the allowlist, so it is not tracked client-side. The
follow-up: when `auth/confirm` completes a first sign-in, send `sign_up` server-side through the
Measurement Protocol (`POST https://region1.google-analytics.com/mp/collect?measurement_id=…&api_secret=…`)
with the visitor's GA `client_id` (read from `_ga`, only if `rcf_analytics_consent=granted` or the
visitor is outside the consent regions), no user id, no email. It needs an API secret (Data
streams → RecopyFast web → Measurement Protocol API secrets) stored as a server-only env var.

## Checking it in production

- Realtime: GA → Reports → Realtime, from a non-EEA connection, or after "Allow analytics".
- DebugView (GA → Admin → DebugView) shows only events flagged `debug_mode`, which the site never
  sets. Connect a debug session with Google Tag Assistant (tagassistant.google.com) instead.
- In the browser: `window.dataLayer` lists every command queued (consent defaults first); the
  network panel shows `/analytics/gtag-init.js` and, unless consent is pending, `gtag/js?id=G-DQ…`.
- The Developer Traffic filter is in **Testing**: tagged, still counted. Activate it once the
  owner's own visits are tagged.

## Consented attribution context (s110, ADR070)

A public eligible interaction may capture a validated documented `gtag get`
client ID into `analytics_contexts`. No session ID is stored or sent: the get
callback alone does not establish both boundaries of the true session. No private
page loads Google. Auth and checkout only bind existing captures after verified
`getUser`; analytics failure never changes their business outcome.

Each capture is a new record, with server capture/consent time and a maximum
30-day expiry, capped by the recorded explicit-choice expiry. Legacy `granted`
cookies without a valid signed server receipt remain usable for visitor analytics but cannot
create conversion attribution until a fresh choice. A settled regional default
uses the same existing trusted edge rule. A stored denial always wins.

The host-only `__Host-rcf_analytics_context` cookie is Secure, HttpOnly and
SameSite=Lax. Only its SHA256 hash is stored. Existing capabilities may refresh
only while a live row exists; an erased/stale capability cannot resurrect an old
capture. A successful eligible refresh renews the same capability cookie to the
new capture's retention ceiling, never beyond consent expiry. A verified account
binding cannot switch users. Sign-out revokes this
browser capability before auth sign-out; denial also revokes the verified
account's other contexts. Failed browser revocation stores only a pending-action
record with separately versioned revoke/signout slots, blocks capture/binding,
and retries on subsequent first-party interaction. Only the exact sent generation
is acknowledged. A settled denial with no pending work sends no repeated requests.
A failed remote request cannot promise immediate global withdrawal.

Revoke erases the hash/client ID synchronously. Expiry prevents selection
immediately. `/api/cron/analytics-context-cleanup`, authenticated by the existing
CRON_SECRET check, sweeps at most1000 records every five minutes independently of
any dispatcher. It reports aggregate counts and logs an error for rows overdue by
more than ten minutes. Monitor the cron's non-2xx responses and this overdue signal;
an outage may delay physical deletion but never extends eligibility. The
`ANALYTICS_CONTEXT_DISABLED=1` switch stops capture/binding but preserves revoke
and cleanup. Deploy the migration before enabling application paths.

Integration contract for s111/s112: service-only `eligible_analytics_context`
selects the latest captured-before-occurrence record, stable UUID tie-break.
Pass a signup capability hash only on verified confirmation through that same
browser; normal payment selection also requires binding before occurrence.
Freeze the selected context ID in the source disposition. Future FKs use
`ON DELETE SET NULL`, never cascade, so cleanup cannot destroy dedupe records.
Claim must acquire `pg_advisory_xact_lock(710110)` and recheck the frozen context's
expiry/revocation. Revoke-before-claim suppresses; already claimed work is in
flight. Release the transaction before Google HTTP. No outbox or fake future
table is introduced by s110. Internal source/account metadata remains sensitive
and follows its source retention/account deletion, not this identifier lifetime.

### Explicit-consent issuance integrity

The explicit Allow handler posts the guarded `grant` action; page load, capture,
binding and legacy readable cookies never mint a receipt. The server issues
`__Host-rcf_analytics_consent` as Secure/HttpOnly/SameSite=Lax with a purpose/version-bound
HMAC over server issuance and expiry only. Its maximum lifetime is180 days; it
contains no GA/account identifier. This establishes server-recorded issuance and
expiry integrity, not cryptographic proof that a human clicked. Both a readable
`granted` choice and a valid receipt are required for explicit context, including
outside consent-required geography. Denial/pending work always overrides it.

`ANALYTICS_CONSENT_SIGNING_KEY` must be a dedicated server-only32-byte random key
encoded as exactly64 hexadecimal characters. Provision it separately; never reuse
the service-role key or use the public CI fixture. Missing/malformed keys fail
explicit attribution closed without blocking authentication or payment. Key rotation
invalidates existing receipts until a fresh Allow choice. Regional default consent
is unchanged. No additional database table is introduced.

The readable choice is synchronized to the receipt's fixed expiry only if the
original Allow interaction is still current. Grant, capture and withdrawal responses
are serialized; a delayed grant cannot overwrite a newer Decline. Capture/bind never
renew receipts. Withdrawal clears the receipt even when an account-wide retry must
remain pending. Sign-out clears the identifier capability, not this identifier-free
choice receipt: a fresh eligible public interaction may create a new context without
requiring another Allow. A delayed pre-signout callback remains invalidated.

Root authentication imports only lightweight first-party lifecycle controls; it
must not import gtag, page-location or the geography catalog. The deferred public
runtime owns GA capture. Keep the module-boundary regression and the unchanged
40-sample comparison Lighthouse gate when changing these dependencies.
