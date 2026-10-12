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
  everything below them. Never `/dashboard`, `/settings`, `/edit`, `/login`, `/signup`, `/auth/*`,
  the API, `/embed/*` or `/try/rcf-try.js`.
- **Loading:** the shell in the root layout fetches the runtime chunk (`import()`) after
  hydration on allowlisted pages only and mounts it in `startTransition`. Then the first-party
  `/analytics/gtag-init.js` (route handler: Consent Mode
  defaults, `url_passthrough: false`, `ads_data_redaction: true`, and the country hint as one
  boolean; `private, no-store`, 404 without an id). On its `onReady`, gtag.js
  (`https://www.googletagmanager.com/gtag/js?id=…`, `afterInteractive`) is requested only when no
  consent is needed or the visitor allowed it. No inline script.
- **Consent:** EEA + UK + CH (and the EU outermost regions with their own ISO codes) default to
  everything denied, by Google's `region` match and by our hint. Elsewhere analytics is granted,
  ads always denied. Missing or malformed `x-vercel-ip-country` → consent required. Where consent
  is required, **nothing is requested from Google until "Allow analytics"**. The choice is the
  first-party cookie `rcf_analytics_consent=granted|denied`, 180 days, `SameSite=Lax`, `Secure`.
  "Cookie settings" in the footer reopens the banner. Declining after allowing denies consent,
  sets `window['ga-disable-<id>']`, and deletes `_ga`/`_ga_*`.
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
| `tool_scan_completed` | a free tool produced the visitor's own result: the calculator, once per page view, the first time the inputs settle while analytics is active (`track` returns whether it sent; a result before consent does not use the event up) | `tool_slug` | yes |
| `sign_up` | **not sent yet** — see below | — | yes |

`cta_location` values: `hero`, `header`, `final_cta`, `founding_offer`, `pricing_plan`,
`pricing_lifetime_pro`, `pricing_founding_agency`, `comparison_page`, `compare_index`,
`tool_page`, `try_page`, `demo`, `blog_index` (from `data-cta-location`), else `header`,
`footer`, the enclosing `section` id, or `page`. Every param value must match
`^[a-z0-9][a-z0-9_-]{0,63}$` or it is dropped.

### Hook for s96 (free-tools platform)

When a scan report is ready on a tool page, call:

```ts
import { track } from "@/lib/analytics/google-analytics/gtag";
track("tool_scan_completed", { tool_slug: TOOL_SLUG });
```

It is a no-op unless analytics runs on that page, and returns whether it sent: if the event
should go once per page view, mark it sent only on `true`. The allowlist already covers `/tools/**`, and
UUID report ids are replaced by `[id]` before anything is sent (a report URL is a capability).
**Rebase note:** s96's ADR 062 puts `/tools/<slug>/r/<id>` under the nonce policy. The CSP builder
ignores `analytics` under a nonce (this story's brief: nothing on the app policy), so on report
pages `connect-src` would refuse Google's hosts. s96 decides: keep reports unmeasured (the tool
page measures the scan), or amend ADR 063 for that one path. Report pages also render text
scraped off a stranger's site in their title, which GA would record as `page_title`.

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
