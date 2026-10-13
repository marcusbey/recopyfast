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

`/signup` and all private authentication documents stay on the nonce policy, with no Google
script. s111 freezes the eligible first-party source after verified authentication and delivers
`sign_up` from the bounded server worker, as specified below. Reading the current `_ga` cookie
or counting every successful callback is not the signup contract.

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

## Verified signup delivery (s111, ADR071)

The explicit `type=signup` production confirmation template is the supported first-confirmation
path. A successful provider verification plus `getUser()` precedes the atomic freeze. Explicit
invite can also qualify. Generic email, magic-link and PKCE successes do not expose a trusted
initial-confirmation flag; they remain successful sign-ins but cannot invent a GA signup. A
no-code existing-session callback never creates a candidate. The activation baseline permanently
suppresses already-confirmed accounts even if their Auth confirmation timestamp later changes.

`freeze_analytics_signup` atomically binds the request capability and saves one immutable source
selection/absence. The unique `signup:<account>` key survives context cleanup. A later consent
choice, campaign or login on another device cannot repair absent attribution. If the complete
freeze transaction fails, the original browser is unknowable; aggregate warnings and the count
gap below expose possible loss. A lost acknowledgement of a committed transaction can return its
existing disposition safely. No cron scans current account contexts to reconstruct missing ones.

`/api/cron/analytics-dispatch` uses the existing fail-closed CRON_SECRET gate every five minutes.
It reconciles up to100 already durable candidates, then claims at most five eligible rows and
sends one request per claim with a five-second timeout. Maximum route runtime is60 seconds; the
loop stops taking work after40 seconds. No lock is held over network. A claim committed before
withdrawal is already in flight; earlier withdrawal suppresses it. Sending claims older than
five minutes become uncertain, never pending. Maintenance continues with sending disabled.
Terminal/uncertain payloads are discarded; the private source/state tombstone follows the
account's retention. The independent s110 cleanup removes context identifiers and reports
physical deletion overdue by ten minutes. Account deletion cascades outbox rows and replay
cannot reconstruct a deleted account.

Production server variables:

- `GA4_MP_ENABLED=0` until migrations, exact deployed code and configuration are verified;
  only the exact value `1` enables sending.
- `GA4_MP_MEASUREMENT_ID=G-DQ00NEM3WE`, with `VERCEL_ENV=production`.
- `GA4_MP_API_SECRET` is server-only. Never put it in a URL log, command argument, client bundle
  or file. Sentry MP fetch instrumentation/breadcrumbs/spans are excluded by exact collector
  URL; other monitoring remains active.

Migration first, code second, configuration/health verification third, sending enablement last.
Rollback sets `GA4_MP_ENABLED=0`; capture can separately be disabled with
`ANALYTICS_CONTEXT_DISABLED=1`. Do not delete source dispositions or automatically replay
uncertain events. Auth success/trial grants do not depend on Google or analytics persistence.

### QA and evidence boundaries

Use Node24 and `node scripts/check-analytics-conversions.mjs --mode=validate` with the QA key
in `GA4_MP_QA_API_SECRET` supplied through a protected child environment. This imports the exact
application payload/transport module. `--mode=receipt` sends one synthetic signup only to fixed
`G-JHTG44WQ5W`; there is no arbitrary target, URL, event or production fallback. Purchase/refund
fixtures are not added until s112. Never use production credentials in tests.

Validation uses ENFORCE_RECOMMENDATIONS but neither records an event nor authenticates the
secret. `accepted_http` means only a2xx response. Actual RecopyFast QA report receipt is separate
proof. Without a proven session boundary this payload omits session/engagement, so an event
count with zero active users is expected and is not a reason to fabricate engagement. Parent
verification recorded exactly one synthetic QA `sign_up` receipt; auth→outbox→dispatch remains
an additional acceptance gate. No synthetic production signup was sent. Observing a genuine
eligible production signup after release is separate from local fixtures and QA receipt.

### Current surviving-account completeness query (read only)

Run with an authorized read-only principal. This is current account stock, not a durable
historical first-signup series. `email_confirmed_at` can reset or clear, so any period filter on
it must disclose that limitation. Account deletion is excluded equally from every column.

```sql
BEGIN READ ONLY;
SELECT
 count(*) AS current_confirmed_accounts,
 count(e.id) AS classified_accounts,
 count(*) FILTER (WHERE e.id IS NULL) AS possible_unattributed_gap,
 count(*) FILTER (WHERE e.reason='preexisting_confirmed') AS activation_baseline,
 count(*) FILTER (WHERE e.reason='initial_confirmation_unproven') AS initial_proof_unavailable,
 count(*) FILTER (WHERE e.frozen_context_id IS NOT NULL) AS initially_attributable,
 count(*) FILTER (WHERE e.state='pending') AS awaiting_dispatch,
 count(*) FILTER (WHERE e.state='sending') AS in_flight,
 count(*) FILTER (WHERE e.state='accepted_http') AS http_accepted_not_proven_ingested,
 count(*) FILTER (WHERE e.state='uncertain') AS uncertain_delivery,
 count(*) FILTER (WHERE e.state IN ('expired','invalid')) AS expired_or_invalid,
 count(*) FILTER (WHERE e.state='suppressed' AND e.reason NOT IN
   ('preexisting_confirmed','initial_confirmation_unproven')) AS other_suppressed
FROM auth.users u
LEFT JOIN public.analytics_delivery_events e
 ON e.user_id=u.id AND e.kind='signup'
WHERE u.email_confirmed_at IS NOT NULL;
ROLLBACK;
```

These counts cannot determine paying customers; verified live billing reconciliation remains
s112. A zero GA count never proves zero confirmed accounts, and an HTTP-accepted row is not a
provider ingestion receipt.

## Verified purchases and paying accounts (s112)

Release order is s110 → s111 → s112. Apply the reviewed forward payment migration before the s112 code; keep `GA4_MP_ENABLED=0` during the migration/deployment boundary. Set `ANALYTICS_PAYMENT_NORMALIZATION_ENABLED=1` only after the migration and exact deployed code are verified. The separate `/api/cron/analytics-payments` route uses the same fail-closed cron bearer guard. It performs read-only provider/billing normalization, never Google sends or financial mutations. Disable its flag to pause new normalization; disabling dispatch independently preserves pending source identities.

`analytics_delivery_sources` reserves new/retry slots independently and discovers processed sources without a created-at cutoff. A late-processed old event remains discoverable. An interrupted normalization claim expires after five minutes and can be reclaimed. This does **not** reclaim an outbox `sending`/`uncertain` Google request. The receipt can finish multiple refund children atomically; its optional outbox reference is not a one-refund limit.

Each verified live invoice or one-off PI has one purchase source key and one opaque GA transaction UUID. TEST sources cannot enqueue commerce delivery. Invoice allocations prove cash; customer credits do not become collected revenue. Current support is USD, recognized catalog items and provable payment allocation. Partial/mixed-credit invoices, unavailable events, unsupported currency and ambiguous splits are visible unknowns rather than guessed revenue. No raw Stripe/account IDs, emails, URLs or invented session IDs leave for GA.

Refund payloads carry proven returned money and the opaque transaction ID; they omit item quantities because a cash amount does not prove returned subscription units or credit packs. A refund needs its own causal successful transition. `Refund.created` is request time, and a current list of many refunds does not assign them the latest charge event's time. Pending/requires-action automatic returns hold acquisition; succeeded automatic duplicate returns exclude it. If a purchase was already sent before the later automatic return, the existing frozen context may carry a correction. Known-unsent parents suppress refunds; sending/uncertain parents require reconciliation. Ordinary refunds and lost disputes do not erase historical paid status. Overlap that cannot be reconciled makes net money unknown instead of subtracting principal twice.

Refund delivery reuses the purchase's frozen context and requires consent at refund occurrence and dispatch. Expired/revoked contexts cannot be rescued by a new visit. Thus GA revenue remains a consented subset and may omit later corrections; the first-party readout owns net revenue.

### Bounded first-party readout

`scripts/check-payment-evidence.mjs` bundles and runs the same read-only application normalizer. It loads no `.env` files and never claims, enqueues, sends analytics, charges, refunds or changes billing. Supply provider/database configuration through a deliberately isolated process environment, set `ANALYTICS_AUDIT_READONLY=1`, and run `node scripts/check-payment-evidence.mjs --accounts=10` (maximum 100). Do not run a Vercel env command inside a checkout whose local `.env` can shadow the intended provider mode. The configured mode is not evidence of an individual payment's mode; event and object checks still apply.

Output contains aggregates only: verified live unique paying accounts, canonical transactions, proven first payments, returning payments, gross collected USD minor units, net retained amount or explicit unknown, history completeness and source/delivery reason counts. Accounts outside the bound and unresolved legacy evidence make payer totals lower bounds. The same source can appear through Checkout and PI events without adding a transaction. A genuine full refund can leave a historical payer with net zero; an automatic returned duplicate is excluded from acquisition. Current paid entitlement/trial status is separate and is never substituted for these money measures.

For current confirmed-account stock, use a read-only `SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL`; this is not a historical signup-series replacement. For provider-independent pipeline diagnostics, use the service-only read-only `analytics_payment_diagnostics()` function. It reports source states/reasons, commerce delivery states and omitted context without exposing client identifiers.

### Separate QA commerce proof

With the QA secret supplied only through the environment, `node scripts/check-analytics-conversions.mjs --scenario=payments --mode=validate` validates shared production payload construction without ingestion. `--mode=receipt` explicitly submits synthetic TEST fixtures only to RecopyFast QA: purchase, duplicate purchase with the same opaque transaction ID, renewal with a different ID, and partial refund linked to the first ID. Both paths refuse a production measurement ID override. HTTP acceptance is not receipt; independently verify QA ingestion/deduplication and record it. These fixtures are never traction and never evidence of a real live payer.


### Compatibility and readout completeness corrections

The migration preserves `claim_analytics_delivery()` as a signup-only four-column RPC for running s111 workers and rollback. New code calls `claim_analytics_delivery_v2()`; shared claim logic remains service-only. Disabling an environment flag is still useful for rollout but is not the compatibility boundary for old processes.

Exact aggregate money totals are null if any scanned history or the account scan is incomplete. `observed_*` amounts describe only the verified subset and are not complete totals. `verified_live_transactions` and paying accounts exclude automatic returned charges; `verified_live_cash_transactions`, gross collected cash and successful refund totals still expose those actual cash movements. Unknown allocation/history counts qualify these numbers. Subscription renewals come specifically from authoritative invoice `billing_reason=subscription_cycle`; returning customers buying another one-off product are not renewals.

Current paid-entitlement coverage describes the application's reconciled entitlement snapshot backed by a verified live payment: an active/past-due subscription with a qualifying paid invoice, or a non-trial purchased grant that is unrevoked and unexpired. Trial-only access, TEST payments and support comps are not counted as paid. Missing payment/reference proof or an incomplete account scan makes the total unknown; the verified subset is separately named. This is not a claim that every current Stripe subscription was freshly retrieved.

A complete refund of a taxed invoice has known returned product value and tax. A complete PI return funding several known invoice shares has known per-invoice refund allocations and zero retained principal; these corrections use refund-plus-parent source keys. Unprovable partial mixed/taxed allocations remain unknown. Item quantities remain omitted from refund payloads.
