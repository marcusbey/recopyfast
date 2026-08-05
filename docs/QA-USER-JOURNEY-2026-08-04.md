# Full user-journey QA — 2026-08-04

A single tester walked the product the way a customer would: landed on the
marketing site, signed up with a real address, paid with a real card, registered
a site, took the generated script, put it on a page served from a different
origin, and tried to invite somebody to edit it.

Everything below was executed against the **live Supabase project** and **live
Stripe (test mode)**, in a real browser. Nothing here is inferred from reading
code alone; every ✅ and every ❌ has an observation behind it.

**Test account:** `rboboe+rcfqa1@gmail.com` (`87f71f43-…`), Pro, active.
**Real money paths exercised:** Pro subscription $19/mo, credit pack $19/1,000.

---

## Headline

The product was **unsellable and unusable end to end**. Two independent
defects each broke it completely, and the second only became visible once the
first was fixed:

1. **Nobody could pay.** Checkout died before reaching Stripe.
2. **Anybody who did pay was locked out.** The card was charged, the
   subscription row was written, and the app still said "No plan".

Both are fixed and verified. A third class of defect — sixteen tables with row
level security switched on and no policies behind it — was the shared root cause
of (2) and of the dashboard being blank in several places. That is also fixed.

Beyond those, the invite email had never been capable of sending: the sender
address used a domain that is not on the Resend account.

---

## Journey checklist

Legend: ✅ works · 🔧 was broken, fixed and re-verified in this pass · ❌ still
broken · ⚠️ works but misleads the user

### 1. Discover — marketing site

| # | Step | Result |
|---|---|---|
| 1.1 | Landing page renders, no console errors | ✅ |
| 1.2 | Pricing section shows Starter $9 / Pro $19 / Lifetime $199 | ✅ renders |
| 1.3 | Hero CTA "Start editing for free" | 🔧 **F-12** — copy corrected (2nd pass) |
| 1.4 | "Lifetime Pro — Buy once $199" is purchasable | 🔧 **F-9** — buyable, verified at Stripe (2nd pass) |
| 1.5 | Install snippet shown in "How it works" matches the real one | 🔧 **F-12** (2nd pass) |
| 1.6 | "Real-time sync enabled" / "changes go live instantly" claims | 🔧 **F-12** (2nd pass) |
| 1.7 | "Headlines, paragraphs, buttons, links — all ready to edit" | 🔧 **F-12** (2nd pass) |
| 1.8 | `/demo`, `/blog`, `/privacy`, `/terms`, `/login`, 404 page | ✅ all 200, no console errors |

### 2. Sign up

| # | Step | Result |
|---|---|---|
| 2.1 | `/signup` renders, validates empty email | ✅ |
| 2.2 | Submitting shows "Check your email" | ✅ |
| 2.3 | `auth.users` row created with name + `source: magic-link` metadata | ✅ verified in DB |
| 2.4 | Magic-link email actually arrives | 🔧 **F-16** — Supabase now sends via Resend, `delivered` (2nd pass) |
| 2.5 | `/auth/confirm?token_hash=…` signs the session in | ✅ |
| 2.6 | …and lands the user on the right host | ⚠️ redirects to production (see F-14) |
| 2.7 | Unpaid session is held at the paywall | ✅ correct by design |

### 3. Pay

| # | Step | Result |
|---|---|---|
| 3.1 | Paywall explains why and offers plans | ✅ |
| 3.2 | Plan dialog lists Starter and Pro, monthly/yearly | ✅ |
| 3.3 | "Continue to payment" reaches Stripe Checkout | 🔧 **F-1 — was totally broken** |
| 3.4 | Stripe page shows the right product and price | 🔧 **F-13** — projected from the catalogue (2nd pass) |
| 3.5 | Paying with `4242…` succeeds | ✅ |
| 3.6 | All webhooks return 200 | ✅ 10/10 |
| 3.7 | `billing_customers` + `billing_subscriptions` written (`pro`, `active`) | ✅ |
| 3.8 | Paid user can then reach the dashboard | 🔧 **F-2 — was totally broken** |
| 3.9 | Billing page shows plan, period, next billing date | ✅ |
| 3.10 | Credit pack purchase ($19 → 1,000 credits) | ✅ granted, `expires_at` NULL |

### 4. Connect a site

| # | Step | Result |
|---|---|---|
| 4.1 | "Add site" form validates and submits | ✅ |
| 4.2 | Site row + owner `admin` permission created | ✅ |
| 4.3 | Embed script generated with site id + signed token | ✅ |
| 4.4 | Sites list renders the new site | 🔧 fixed by F-3 (was empty) |
| 4.5 | Overview refreshes after registering | 🔧 **F-11** (2nd pass) |
| 4.6 | Site ever leaves "Verifying" | 🔧 **F-10** — goes Active on discovery (2nd pass) |
| 4.7 | Registered `localhost:8080` stored as `localhost` (port dropped) | ⚠️ cosmetic; matching still worked |

### 5. Install the script on a real site

| # | Step | Result |
|---|---|---|
| 5.1 | `/embed/recopyfast.js` serves (173 KB) | ✅ |
| 5.2 | Widget boots on a foreign origin, no errors | ✅ |
| 5.3 | CORS preflight from the **registered** domain → 204 + correct ACAO | ✅ |
| 5.4 | CORS from an **unregistered** origin → refused | ✅ correct |
| 5.5 | Editable elements detected | ✅ 2 of 3 (`<a>` excluded by design) |
| 5.6 | Saved content applied on load | ✅ |
| 5.7 | `?rcf_staging=1&rcf_token=test_…` demo mode on localhost | ✅ UI only — API still 401s |

### 6. Edit and collaborate

| # | Step | Result |
|---|---|---|
| 6.1 | Dashboard → Content lists content | 🔧 **F-4 — "Origin not allowed"** |
| 6.2 | Share → "Anyone with link" | 🔧 **F-5 — offered a retired feature** |
| 6.3 | Share → email invite creates access | ✅ |
| 6.4 | Invite email actually delivered | 🔧 **F-6 — never sent, UI claimed success** |
| 6.5 | Failed sends are surfaced to the user | 🔧 fixed with F-6 |
| 6.6 | Invited editor completes sign-in and edits | 🔧 **verified end to end** (2nd pass, `qa:journey` 5c) |

### 7. Account

| # | Step | Result |
|---|---|---|
| 7.1 | Settings (Profile / Notifications / Security / API keys / Appearance) | ✅ renders |
| 7.2 | Analytics renders with filters and export | 🔧 **F-10** — counts owned sites (2nd pass) |
| 7.3 | Teams page | 🔧 **F-8 — told a Pro user to upgrade to Pro** |
| 7.4 | Billing: change plan, cancel, cards, invoices, buy credits | ✅ all present |

---

## Findings

### 🔧 F-1 — Checkout failed for every customer, before Stripe (P0, fixed)

Clicking "Continue to payment" returned:

```
Failed to create customer: new row violates row-level security policy
for table "billing_customers"
```

`createOrGetCustomer` wrote `billing_customers` with the **caller's** Supabase
client, which is subject to RLS. Production allows no such insert, so checkout
never reached Stripe. Reproduced independently through PostgREST with the user's
own JWT, so this was not a Next.js artefact.

It also leaked: the Stripe customer is created *before* the row that records it,
so every failed attempt orphaned a customer at Stripe. One was left behind by
this test and has been deleted.

**Fix** — `src/lib/stripe/customer.ts`: the write now goes through the
service-role client, matching how every other billing write in this codebase
already works (the Stripe webhook, `billing_invoices`, `billing_payment_methods`).
`userId` is resolved from the verified session by the route before this function
is called, so nothing is widened. Added: unique-violation handling for two
concurrent checkouts, and deletion of the just-created Stripe customer when the
insert fails, so retries stop accumulating orphans.

Also added `supabase/migrations/20260804120000_billing_customers_write_policy.sql`,
because the repo's schema and production disagreed: migration `20250817000000`
declares `FOR ALL USING (user_id = auth.uid())`, which Postgres reuses as the
`WITH CHECK`, so a fresh database **would have let checkout through** while
production refused it. The migration states production's (correct) posture
explicitly: user reads own row, service role writes.

**Verified:** checkout now reaches `checkout.stripe.com`; a real Pro subscription
was purchased.

### 🔧 F-2 / F-3 — Sixteen tables had RLS on and no policies (P0, fixed)

RLS with no policy is not "open", it is **deny everything**. The service role
bypasses RLS, so no server-side code and no test ever noticed.

```
api_keys              content_history    content_versions   copy_styles
billing_customers     billing_subscriptions                 domain_verifications
rate_limits           security_events    site_analytics     site_languages
site_permissions      site_themes        team_members       teams
```

Two consequences, both fatal:

- **The paywall locked out paying customers.** `billing_subscriptions` was
  unreadable under the user's token, so `readEffectivePlanId` found no live
  subscription, `resolveEntitlement` returned `none`, and middleware bounced the
  customer to `/dashboard/billing?checkout=required`. Card charged, subscription
  row present, access denied — for every paying customer, every time.
  `GET /api/billing/entitlement` returned `{"kind":"none"}` while the database
  held an active `pro` row.
- **The dashboard was blind.** `sites` and `content_elements` authorise via
  `EXISTS (SELECT 1 FROM site_permissions …)`. With `site_permissions`
  unreadable, that predicate matched nothing, so a site's own owner saw an empty
  list.

**Fix** — `supabase/migrations/20260804130000_restore_missing_rls_policies.sql`,
applied to production. Policies follow the shape already live on the tables that
work: the owning user may `SELECT` their own rows, the service role may write.
`rate_limits` and `security_events` deliberately get **no** user-facing policy —
they are server infrastructure, and a security log readable by its own subject
is worse than one that is unreadable. The `teams`/`team_members` policies
deliberately do not reference each other, which would recurse (42P17).

**Verified:** no table is left with RLS on and zero policies; the entitlement
endpoint now returns `{"kind":"plan","planId":"pro"}`; dashboard, sites and
content all render.

### 🔧 F-4 — The dashboard's Content page could never load (P0, fixed)

`/dashboard/content` showed **"Failed to load content — QA Test Site: Origin not
allowed"**. `authorizeSiteRequest` only modelled one caller: the embed widget,
which is cross-origin from the customer's site and must prove itself with a site
token whose `Origin` matches the registered domain. Our own dashboard is
same-origin and already authenticated, and can never present the customer's
domain as its origin — so the page was structurally broken for every real site.
The code comment at `src/app/dashboard/content/page.tsx` already admitted the
dashboard "can never satisfy" the check.

**Fix** — `authorizeFirstPartySiteRequest` in `src/lib/security/site-auth.ts`
authorises a first-party caller by **session + a `site_permissions` row**, never
by origin, and returns `null` (rather than throwing) so the content route falls
through to the unchanged widget path. The widget path is untouched: a bad token
with a wrong origin is still rejected exactly as before, and the first-party
path never echoes a caller-supplied origin into `Access-Control-Allow-Origin`.

**Verified:** the Content page loads, lists both sites in its filter, and reports
"No content found" (correct — nothing has been edited yet).

### 🔧 F-5 — Share offered a feature the backend had retired (P1, fixed)

Choosing "Anyone with link" always failed with **"Make sure you have admin
permission"** — for the site's own creator, who holds `admin`. The message was
false. `createStagingAccess` throws *"Shareable staging links are retired"* for
`type: "link"`, its catch swallowed the error into `null`, and the route turned
every `null` into one blanket 403 about permissions.

**Fix** — the retired option is gone from `ShareSiteDialog`; email invite is the
only path, as the backend intends. `createStagingAccess` now propagates its real
error instead of returning `null`, and the route maps it to a truthful status
(403 admin / 400 retired / 400 missing email / 500 generic, with database
errors logged server-side rather than returned).

**Verified:** the dialog no longer offers the retired option; an email invite
succeeds and appears under Active Links.

### 🔧 F-6 — No transactional email had ever been deliverable (P0, fixed)

The invite was created, the UI said *"Link created and copied to clipboard!"*,
and **nothing was sent**. Server log:

```
[email] Resend send failed:
  The recopyfast.com domain is not verified.
```

`EMAIL_FROM` is unset, so the code default applied — `noreply@recopyfast.com`.
That domain is not on the Resend account. The account **does** have
`recopyfa.st` verified, which is the domain the product actually runs on. So
every staging invite and every editor sign-in code failed silently. Since an
invite is worthless without its emailed code, this alone meant nobody could ever
be invited to edit — which is the product.

**Fix** — default sender corrected to `noreply@recopyfa.st` in
`src/lib/email/resend.ts` and in `.env.example` (which carried the same wrong
value). The API now returns `emailDelivered`, and the dialog reports the failure
instead of claiming success.

**Verified:** a new invite produced a Resend record —
`ReCopyFast <noreply@recopyfa.st>` → `rboboe+rcfeditor2@gmail.com`,
*"Your ReCopyFast staging access code"*, status **delivered**.

### 🔧 F-8 — Pro subscribers were told to upgrade to Pro (P2, fixed)

`/dashboard/teams` rendered a locked "Pro Feature — Upgrade to Pro" card as
unconditional JSX, with no plan check anywhere on the page. Every customer saw
it, including Pro subscribers, next to a sidebar that read "PLAN: Pro".

**Fix** — the page reads `/api/billing/entitlement` and shows the card only when
the resolved plan is not `pro`. It stays hidden while the plan is unknown and if
the read fails, because a missing upsell costs nothing whereas showing a
subscriber an upgrade prompt reads as a billing bug.

**Verified:** the card is gone for the Pro account; typecheck clean.

---

## Still open

### ❌ F-9 — Lifetime Pro is advertised but cannot be bought (P1)

> **Superseded — closed in the second pass below.**


The landing page sells **"Lifetime Pro — $199, Buy once"**. The plan dialog
offers only Starter and Pro; the billing page has no lifetime option anywhere.
The backend is ready — `/api/billing/checkout` accepts `intent: "lifetime"`,
the `plans` table has an active `lifetime_pro` row at $199, and
`STRIPE_LIFETIME_PRICE_ID` is configured. This is a missing UI affordance on a
product that is being advertised for sale.

### ❌ F-10 — Sites never leave "Verifying" (P1)

> **Superseded — closed in the second pass below.**


Both registered sites sit at "Verifying" indefinitely; Sites reports
"Active 0", and Analytics reports "Total Sites 0" — while the embed script
works correctly on a real page. Nothing in the dashboard tells the owner what
verification is waiting for or how to complete it. There is a
`domain_verifications` table and API with no UI attached.

### ❌ F-11 — Overview does not refresh after registering a site (P3)

> **Superseded — closed in the second pass below.**


Immediately after "Site Registered Successfully!", the page behind the dialog
still reads "0 active sites" and "No sites connected yet". Correct after a
reload.

### ⚠️ F-12 — Marketing claims the product does not honour (P1)

> **Superseded — closed in the second pass below.**


- **"Start editing for free"** — the free plan is retired; payment is required
  before anything is usable. This is the same class as the "14-day free trial"
  copy removed earlier.
- **The install snippet is wrong.** The site shows
  `<script src="https://cdn.recopyfast.com/embed.js" data-site-id="your-site-id">`.
  The snippet the product actually issues is
  `<script src="https://<app>/embed/recopyfast.js" data-site-id="…" data-site-token="…" data-api-url="…">`.
  `cdn.recopyfast.com` is not a host this product serves, and a copied snippet
  without `data-site-token` is rejected — the widget refuses to start without it.
- **"Real-time sync enabled"** and **"changes go live instantly"** — real-time
  was deliberately removed; editing and publishing are plain HTTP.
- **"buttons, links — all ready to edit"** — `<button>` yes, but a plain `<a>`
  is detected only with `class="rcf-editable-link"`. The opt-in is a sound
  design decision (otherwise every nav link becomes editable); the copy and docs
  should say so.

### ⚠️ F-13 — Stripe's product description contradicts the app (P2)

> **Superseded — closed in the second pass below.**


Stripe Checkout shows Pro as *"Up to 3 websites, all features, $6 per additional
website"*. The app and the landing page both say **5 websites, +$5**. The
customer sees different terms at the exact moment they hand over a card. The
Stripe product description needs to match the catalogue.

### ⚠️ F-14 — `NEXT_PUBLIC_APP_URL` makes non-production environments redirect to production (P2)

`resolvePublicOrigin` always prefers `NEXT_PUBLIC_APP_URL`, and `.env` sets it
to `https://recopyfa.st`. Confirming a magic link against localhost signed the
session in **locally** and then redirected to `https://www.recopyfa.st/login`.
The preference itself is a deliberate, sound anti-open-redirect decision — the
problem is that Vercel preview deployments inherit the production value, so
preview auth and preview Stripe returns both bounce users to production. A
per-environment `NEXT_PUBLIC_APP_URL` fixes it. A local `.env.local` (gitignored)
was added for this session.

### ⚠️ F-15 — Share option toggles are invisible to assistive technology (P2)

> **Superseded — closed in the second pass below.**


In `ShareSiteDialog`, Permissions (View/Edit/Publish/Admin) and "Expires in" are
plain `<button>`s with no `role="radio"`, `aria-pressed` or `aria-checked`.
Selection state is conveyed by colour alone, so a screen-reader user cannot tell
what is selected. WCAG 2.2 4.1.2 (Name, Role, Value) and 1.4.1 (Use of Colour).

### 🔴 F-16 — Owner actions, unchanged from the previous register

- **Supabase auth email never arrived** (2.4). Supabase is on its own SMTP,
  which is heavily rate-limited and not production-grade — and it is not the
  Resend account that already has `recopyfa.st` verified. Point Supabase's SMTP
  at Resend, then re-test signup end to end. Until then signup email delivery is
  unproven at any volume.
- **Supabase email templates** still point at `/auth/callback`, which needs the
  PKCE verifier cookie and therefore breaks cross-device. `/auth/confirm` is
  built for exactly this and works — it is what this test used to sign in.
- **Rotate `SUPABASE_PASSWORD`.** Still outstanding from the previous register;
  this session used it for the migrations.

---

---

# Second pass — 2026-08-04 (later the same day)

Everything in "Still open" above was re-attacked. Each fix was written by one
agent and then judged by a **separate** agent that read the finding's own text
first and tried to refute the claim — one of them proved its lane's tests were
real by inserting `return null` into the implementation and confirming they went
red, then restoring the file.

## What closed

| Finding | Verdict | What a user can now do |
|---|---|---|
| **F-9** Lifetime Pro unbuyable | ✅ CLOSED | Buy it. `LifetimeOfferCard` renders on the paywall and billing page, priced from the catalogue, and reaches Stripe Checkout. **Verified in a browser:** the Stripe page reads *RecopyFast Lifetime Pro · $199.00*. |
| **F-12** false marketing claims | ✅ CLOSED | Believe the landing page. Free CTA, `cdn.recopyfast.com` snippet, real-time claims and the `<a>` copy all now match what the code does. |
| **F-13** Stripe contradicts the app | ✅ CLOSED | See the same terms at the moment of payment. Live Pro had said *"unlimited websites"*. |
| **F-15** Share toggles inaccessible | ✅ CLOSED | Hear the permission toggles as a named group with checked state. |
| **F-11** overview stale after register | ✅ CLOSED | See the new site without reloading. |
| **F-10** sites stuck "Verifying" | ✅ CLOSED | See a site go Active on its own, and Analytics count it. |
| **6.6** invited editor loop | ✅ **now verified** | Invite → code → verify → edit → owner publishes. Was the register's "next thing to test". |
| **Edit → save → publish** | ✅ **now verified** | Previously untestable: no content had ever been saved. |
| **F-16** auth email unusable | ✅ CLOSED | Receive a signup email at all — via Resend, `delivered`. |
| **Version history & rollback** | ✅ **now verified** | Snapshot, list, restore — rollback had never worked. |
| **Multi-site limits** | ✅ **now verified** | A 1-site plan refuses the second site with a 403 that explains itself. |

## New defects found in this pass

Not in the original register — surfaced by the work itself.

### 🔧 N-1 — The site owner could not edit their own site (P1, fixed)

`PUT /api/staging/content/[siteId]` authorised **only** an editor token. The
owner is signed in, holds `site_permissions.admin`, and carries no token — and
never can. Meanwhile `POST /api/staging/publish` had grown its own inline
session check, so the owner could **publish edits they had no way to make**.
This is the register's "the owner has no first-party editing surface", and the
same defect shape as F-4: a route modelling one caller and refusing the one
guaranteed to hold every right.

**Fix** — `authorizeFirstPartyEditorAccess` in `src/lib/auth/editor-access.ts`,
deliberately shaped like the F-4 fix: session + `site_permissions`, never
Origin, returns `null` so the token path is untouched. Now used by staging
content GET/PUT and publish, replacing a hand-rolled check that spelled the
permission set `["admin", "owner", "publish"]` — inventing an `owner` level the
model does not have. The row is read with the **user's** client, not the service
role, so an RLS regression fails loudly instead of hiding.

### 🔧 N-2 — Yearly billing quoted a price it did not charge (P1, fixed)

Found by `scripts/sync-stripe-catalogue.mjs`. Stripe charged **$90.00** and
**$189.00** a year; the app rendered *"Billed $189.24 once a year"*. The seed had
derived the monthly equivalent as 17%-off-monthly (19 × 0.83 = 15.77) and
multiplied back. F-13's defect class, on the money rather than the copy.
`20260804140000_yearly_price_matches_stripe.sql`, applied. Nobody is repriced.

### 🔧 N-3 — The API would sell Lifetime Pro twice (P1, fixed)

`intent: "lifetime"` had no duplicate guard. The card hides itself for an
existing owner, but that is a rendering decision and this is a money decision —
and the grant is keyed on the payment intent, so a second $199 would not even
have been deduplicated on the way back. Now 409s, like the subscription intent
beside it.

### 🔧 N-4 — Hosted-file domain verification could never succeed (P1, fixed)

`generateFileVerificationContent` bakes `Generated: <ISO timestamp>` into the
file; `verifyDomainFile` regenerated that body at check time and required exact
equality, so the expected value differed from the owner's file by however long
they took to upload it. Harmless while the component was mounted nowhere —
newly reachable once the F-10 work mounted it, turning it into a download button
leading to a permanent failure. Now matches on the **code**, which is the actual
secret, and tolerates trailing newlines and CRLF.

### 🔧 F-10 — Sites never left "Verifying" (P1, fixed)

Three separate causes, all now closed and all asserted by `npm run qa:journey`.

**The widget never told us what it found.** `/api/sites` derives a site's status
from `content_elements` (`elementsCount > 0 ? "active" : "verifying"`), and the
only thing that ever wrote that table for a live site was
`socket.emit('content-map', …)`. Since real-time became opt-in, `RECOPYFAST_WS`
is unset on every real install, so `sendContentMap` hit `if (!this.socket)
return` and sent the map **nowhere** — and the one listener for that event lives
in `server/index.js`, an Express process Vercel cannot host anyway. Worse, it was
only ever *called* from inside the socket's `connect` handler, so with no socket
it never even ran. Every customer's site read "Verifying" forever while their
page worked perfectly.

**Fix** — `sendContentMap` now POSTs to `/api/content/:siteId`, the same
endpoint the dashboard reads back, authorised the way every other widget call is
(site token + registered Origin). The socket is kept as a live-fanout
enhancement rather than the delivery mechanism, and discovery is invoked from
`init()` regardless of whether a socket came up. The route upserts with
`ignoreDuplicates`, so reporting on every page load and every MutationObserver
rescan can never overwrite a published edit; a fingerprint check skips the
request entirely when the element set has not changed.

**Analytics said "Total Sites 0".** Every query in the all-sites view fell back
to `.eq("id", "")` — a filter matching nothing. That was a deliberate stopgap
(an empty chart beats a cross-tenant leak), but it zeroed the whole dashboard for
anyone who had not picked a single site. And `total_sites` counted *distinct
site_ids in the activity log*, so a site nobody had visited this month did not
exist. Now scoped to the caller's own sites via `site_permissions` — the same
predicate `/api/sites` authorises through — and counted from that set. The
tracker holds a service-role client, so the scoping is explicit and commented as
load-bearing.

**The hosted-file method could not complete** — see N-4.

**Verified:** `5b.1b` reports `status=active` immediately after discovery, and
`5d.1` reports `total_sites=1` for a freshly registered site.

### 🔧 N-5 — Buying Lifetime left the monthly subscription running (P1, fixed)

A Pro subscriber who bought Lifetime Pro kept being charged $19/mo for a plan
they now owned outright. `readEffectivePlanId` ranks a grant above a
subscription, so they had Pro and the subscription renewed silently beside it —
invisible until a card statement. The webhook now sets `cancel_at_period_end` on
any live subscription when a lifetime grant lands. Deliberately *at period end*,
not immediately: the period is already paid for, and the grant outranks the
subscription throughout, so there is no access gap and nothing to refund.
Failures are logged, never thrown — a retry would hit the duplicate-grant
short-circuit and never reach the cancellation again.

### 🔧 F-16 — Supabase auth email was unusable in production (P0, fixed)

The original register logged this as an owner action. It was worse than it
looked, and it is now done and verified.

Reading the live project's auth config turned up three faults at once:

- **`site_url` was `http://localhost:3000`.** Every template interpolates
  `{{ .SiteURL }}`, so every confirmation email sent a real customer **to their
  own machine**. Signup could not have worked in production for anybody.
- **No custom SMTP.** Supabase's built-in sender is rate-limited to a handful of
  messages an hour and is explicitly not for production — the reason the
  register's magic link "never arrived" — while the Resend account already had
  `recopyfa.st` verified and was being used successfully for editor invites.
- **`uri_allow_list` was empty**, so no `redirect_to` could be honoured.

Two template faults sat behind those: the **signup confirmation** template
still used `{{ .ConfirmationURL }}` → `/auth/callback`, which needs the PKCE
verifier cookie and therefore breaks whenever the link is opened on a different
device. (The magic-link template had already been repointed at `/auth/confirm`;
the signup one, which is what a *new* user actually receives, had not.)

**Fix** — applied to the live project via the Management API: SMTP → Resend
(`smtp.resend.com:465`, sender `ReCopyFast <noreply@recopyfa.st>`), `site_url` →
`https://recopyfa.st`, an allow-list covering production, `www` and localhost,
and the signup template repointed at
`/auth/confirm?token_hash=…&type=signup&redirect_to=…`.

**Verified:** a real signup was requested and Resend recorded
`ReCopyFast <noreply@recopyfa.st>` → *"Confirm your email address"*, status
**delivered**. Recorded in `docs/DEPLOYMENT-ENV.md`, because these are dashboard
settings that no migration or `.env` will restore.

**Still an owner action:** rotate `SUPABASE_PASSWORD`. Outstanding since the
previous register, and used again this session for the migrations.

### 🔧 N-6 — Rollback had never worked (P1, fixed)

Giving the owner a first-party path to version history (N-1's shape, third
instance) exposed the next defect immediately: every restore returned 500.

```
Could not find the function public.restore_content_version(
  p_restored_by, p_site_id, p_version_id) in the schema cache
```

The route passed `p_site_id`; the function takes `(p_version_id, p_restored_by)`
and derives the site from the version row itself. PostgREST resolves RPC by
*named* arguments, so one extra argument is a miss, not a loose fit. Nobody had
noticed because the route was reachable only with a staging invite token — the
owner was refused before ever reaching the broken call, and the register listed
rollback simply as "untested".

The repo's own migration declares the three-argument shape that no database
has, so schema and production disagreed exactly as they did for
`billing_customers` in F-1 — a fresh database would have flipped the bug rather
than fixed it. `20260804150000_reconcile_restore_content_version.sql` states the
live (correct) shape; applied.

Reconciling the restore alone was not enough, and review caught the half left
behind. `create_content_version` — the function that *writes* the snapshot the
restore reads — is split the same way. Production keys the snapshot by
`element_id`, which is what the reconciled restore matches on and why rollback
works against the live database. `20251230100000_edit_board.sql` keys it by the
row `id` and reads a column, `element_type`, that exists in no database and no
migration: on a repository-provisioned schema the first call to record a version
raises `column "element_type" does not exist`, and had it survived that, every
restore would have matched zero rows and still reported success.
`20260805120000_reconcile_create_content_version.sql` states the live shape.
Nothing to apply — production already holds it; the migration exists so a fresh
database does too.

**Verified:** `qa:journey` 5e now creates a snapshot, lists history and restores,
all as the owner — asserting the draft comes back to the snapshotted value, not
merely that the endpoint returned 200.

### 🔧 N-7 — Three more surfaces locked the owner out (P1, fixed)

`GET`/`POST /api/edit-board/history` and `/api/edit-board/history/[versionId]`
authorised by staging token alone — the same defect as F-4 and N-1, in its third
and fourth instances. The site's own owner could not read their version history
or roll anything back. Both now try `authorizeFirstPartyEditorAccess` first and
fall through to the token path unchanged.

## What did not close

Everything still outstanding is consolidated in **Open backlog** at the end of
this document; the entry below is kept because it is the only *finding* that
did not fully close.

### ⚠️ F-14 — Half closed (P2)

The auth half is fixed and the Stripe half now shares the same resolver
(`src/lib/deployment/origin.ts`), so a preview no longer returns a paying
customer to production. But the case the register actually reproduced was
**local**, and the resolver deliberately no-ops when `VERCEL_ENV` is unset. Row
2.6 is green on this laptop only because of a gitignored `.env.local`. Any
developer whose `.env` carries the production URL is still bounced. Closing it
properly is a configuration change, not a code change — see
`docs/DEPLOYMENT-ENV.md`.

## The guard that would have caught all of it

`npm run qa:journey` — 41 assertions, nothing mocked, against the real Supabase
project and real Stripe. It signs up (minting its own magic-link token via the
admin API, so no inbox is in the loop), is held at the paywall, reaches Stripe
for all five intents including Lifetime, is admitted once entitled, registers a
site, discovers content as the widget, edits, publishes, invites an editor,
verifies that editor by reading the code from `staging_access`, proves the
editor **cannot** publish, and deletes everything it made.

`npm run check:stripe` / `check:stripe:live` proves every price resolves in the
right mode, charges what the catalogue says, and describes the product the way
the app does.

Both exit non-zero on failure, so they can gate a deploy. This is the "one path,
run for real, on every deploy" the lesson below asks for — every P0 in the
original register except the marketing copy would have failed it.

---

## Not covered

Stated plainly rather than left to look green:

- ~~**The invited editor's side of the journey (6.6).**~~ **Now covered** —
  `qa:journey` 5c walks invite → code → verify → edit → owner publishes, and
  asserts the editor is refused publish rights they were not granted.
- ~~**Editing → save → publish.**~~ **Now covered** — `qa:journey` 5b walks
  discovery → draft → publish → live. The owner's missing first-party editing
  surface turned out to be a real defect, not a gap in the test; see N-1.
- ~~**Version history and rollback.**~~ **Now covered** — `qa:journey` 5e
  snapshots, lists and restores. Rollback turned out never to have worked at
  all; see N-6.
- **Yearly billing, plan changes, proration, cancellation** — the controls are
  present and were not exercised. Yearly checkout *sessions* are created and
  priced correctly (`qa:journey` 3.2), but no annual subscription was completed.
- **Starter checkout.** A Starter Checkout Session is now created successfully
  every run (`qa:journey` 3.3), so the 23514 warning was indeed stale at the
  session stage. No Starter payment has been *completed*, so the webhook's
  Starter path remains unexercised.
- ~~**Multi-site limits.**~~ **The limit boundary is now covered** —
  `qa:journey` 5f drops the account to Starter and proves the second site is
  refused with a 403 that names the limit. Deliberately probed on Starter, not
  Pro: `IP_REGISTRATION` allows 5 registrations an hour and Pro allows 5 sites,
  so on Pro the rate limiter answers first and a green result would have meant
  nothing. The **"+$5 per additional website" charge** is still unexercised —
  nothing in the product appears to bill for it yet.

---

## Changed in this pass

```
src/lib/stripe/customer.ts                    F-1  service-role write, orphan cleanup, race handling
src/lib/security/site-auth.ts                 F-4  first-party authorisation path
src/app/api/content/[siteId]/route.ts         F-4  try first-party, fall back to widget
src/__tests__/api/content/[siteId]/route.test.ts   F-4  coverage for the new path
src/lib/auth/staging-access.ts                F-5  propagate the real error
src/app/api/staging/access/route.ts           F-5/F-6  truthful statuses, emailDelivered
src/components/dashboard/ShareSiteDialog.tsx  F-5/F-6  retired option removed, failure surfaced
src/lib/email/resend.ts                       F-6  sender → verified recopyfa.st
.env.example                                  F-6  same, plus why
src/app/dashboard/teams/page.tsx              F-8  upsell gated on plan
src/app/dashboard/content/page.tsx            F-4  stale comment removed

supabase/migrations/20260804120000_billing_customers_write_policy.sql
supabase/migrations/20260804130000_restore_missing_rls_policies.sql   ← applied to production
```

---

---

# Open backlog — everything still to fix

One list, ordered by what it costs the business. Everything above this line is
either fixed and verified, or restated here. Nothing else is outstanding from
the two QA passes.

## P1 — costs money or misleads a paying customer

### B-1. "+$5 per additional website" is advertised and never charged

`plans.additional_site_price` is `5.00` for Pro, surfaced through
`/api/pricing` and rendered on the pricing card and the billing page. Nothing
bills for it. `canCreateWebsite` refuses the 6th site outright rather than
charging for it, so the sentence describes a product that does not exist.

Decide which is true and make both surfaces agree:
- **Hard limit** (what the code does) — delete the "+$5" copy and the
  `additional_site_price` column, and the refusal message becomes the whole
  story. Cheapest, and honest today.
- **Metered overage** (what the copy sells) — needs a Stripe metered price, a
  usage record on site creation, and a proration story when a site is deleted.
  Real work; do not start it because of a stray sentence.

### B-2. No payment has ever been completed except Pro monthly

`qa:journey` proves a Checkout Session is *created* and correctly priced for
Starter, Pro monthly, Pro yearly, credits and Lifetime. Only **Pro monthly**
has been paid for end to end. The webhook branches for Starter, for annual
subscriptions, and for `lifetime_purchase` are therefore unexercised against a
real payment — and the lifetime branch is the one that grants a $199
entitlement and now cancels a running subscription (N-5).

Needs a browser against Stripe's hosted page (test mode, `4242…`) with
`stripe listen` forwarding. Half an hour, and it retires the largest remaining
unknown in the billing system.

### B-3. Rotate `SUPABASE_PASSWORD`

Outstanding since the register before last. Used again this session to apply
migrations. Rotating it invalidates the pooler URL in `supabase/.temp`, so
re-link the CLI afterwards.

## P2 — real cost, no immediate customer harm

### B-4. The widget ships 41 KB of socket.io that never connects

`scripts/build-embed.mjs` compiles `socket.io-client` into the served bundle:
169.7 KB total, of which 41.2 KB is the socket client. Real-time is opt-in and
`RECOPYFAST_WS` is unset on every real install, so `establishConnection`
returns before using it — every visitor to every customer's site downloads a
quarter of the widget for nothing.

Load it dynamically from `socket.io-client.min.js` (already built and served
beside the bundle) only when `RECOPYFAST_WS` is set. The fallback loader
already exists; the inline copy is what needs removing.

### B-5. `server/index.js` is a real-time server nothing can host

An Express + socket.io process that Vercel cannot run, still wired into
`npm run dev` and still the only listener for the `content-map` event the
widget no longer relies on. It is the reason F-10 hid for so long: the code
looked like it had a delivery mechanism.

Either host it somewhere and re-enable real-time deliberately, or delete it and
the `dev:ws` scripts. Leaving it is what made "the widget reports its content"
look true.

### B-6. `NEXT_PUBLIC_APP_URL` locally (F-14's remaining half)

Preview deployments are fixed in code. The **local** case is configuration: a
developer whose `.env` carries the production URL still gets signed in locally
and redirected to production. A development-only warning now names both hosts
and the fix, but the fix itself is a `.env.local` entry — see
`docs/DEPLOYMENT-ENV.md`.

### B-7. Supabase `smtp_max_frequency` is 60 seconds

One auth email per address per minute. Correct as anti-abuse, but a user who
mistypes their address and retries immediately gets silence with no
explanation. Worth surfacing in the signup UI rather than changing.

## P3 — quality and maintenance

### B-8. No automated accessibility assertions

F-15 was fixed by hand and is covered by hand-written role assertions. There is
no `jest-axe` in the project, so the next dialog can regress the same way.

### B-9. 44 pre-existing lint warnings

Unused imports and `react-hooks/exhaustive-deps` across ~25 files. None
introduced by the QA passes (the count is unchanged), all suppressible or
fixable mechanically. Worth clearing so a *new* warning is visible.

### B-10. `POST /api/domains/verify` has no server-side tests

The route was rewritten during this pass, including the column-name fix that
was the root cause of "no verification row was ever created". Its component has
tests; the route does not, and those tests mock `fetch`, so they prove the
component reads the contract, not that the route produces it.

## Not defects, but unproven

- **Plan changes, proration and cancellation.** The controls exist and are
  wired; none was exercised against Stripe.
- **Rollback beyond one version.** `qa:journey` restores a single snapshot.
  Multi-version history, and restoring an *older* version after several edits,
  is untested.
- **Supabase SMTP at volume.** One signup email was sent and `delivered`
  through Resend. Nothing has tested a burst.


## The lesson worth keeping

Every P0 here was invisible to the test suite, and for one reason: **the tests
mock Supabase, and the mock has no row-level security.** A mock more permissive
than the platform does not merely miss bugs — it certifies them as correct. That
is the same failure mode the previous register recorded for `NextResponse` (a
jest mock accepted a body on a 204 that the runtime rejects), now repeated at the
database layer with far worse consequences: 1,300 passing tests over a product
that could not take a payment and could not admit a customer who had paid.

The cheapest guard is not more unit tests. It is one path, run for real against
a real project, on every deploy: sign up, pay with a test card, reach the
dashboard, register a site, fetch the script. Every defect above except the
marketing copy would have been caught by that single run.
