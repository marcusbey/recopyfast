# Per-environment environment variables

A runbook for the variables that must differ between local, preview and
production. Everything else (Supabase URL, OpenAI key, Redis) is the same value
everywhere and is documented in `.env.example`.

Two variables have already caused incidents by carrying a production value into
a non-production run. Both are listed below with the failure they cause.

## Set these per environment

| Variable                     | Local (`.env.local`)                     | Preview                                                                     | Production                                                        |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`        | `http://localhost:3000`                  | leave **unset**, or set to the alias you actually browse                    | `https://www.recopyfa.st`                                         |
| `STRIPE_WEBHOOK_SECRET`      | the `whsec_…` printed by `stripe listen` | the signing secret of the **test-mode** endpoint pointed at the preview URL | — (production uses `STRIPE_WEBHOOK_SECRET_LIVE`)                  |
| `STRIPE_WEBHOOK_SECRET_LIVE` | —                                        | —                                                                           | the signing secret of the **live-mode** endpoint on `recopyfa.st` |
| `ALLOWED_ORIGINS`            | `http://localhost:3000`                  | the preview origin                                                          | `https://recopyfa.st,https://www.recopyfa.st`                     |

On Vercel, set these under **Settings → Environment Variables** and untick the
environments they do not apply to. A variable ticked for all three environments
is a production value waiting to leak.

## Leaving `NEXT_PUBLIC_APP_URL` unset on Preview has other consequences

The table above recommends unsetting it on Preview so auth and Stripe returns
stay on the deployment. That is right for those two, but the variable has three
more consumers, and an operator who unsets it should know what changes:

- **`src/lib/sites/embed-script.ts`** falls back to `http://localhost:3000`, so
  the install snippet a preview shows a customer points at their own machine.
  Harmless on a preview, confusing if anyone copies it.
- **`src/app/api/content/[siteId]/route.ts`** and the `edit-board` routes default
  `Access-Control-Allow-Origin` to `*` beside `Allow-Credentials: true`. Browsers
  refuse that combination outright, so it is not a credential leak — but
  credentialed cross-origin calls from a preview will fail rather than work.
- **OG / Twitter image URLs** become relative to the deployment, which is
  usually what you want on a preview anyway.

If a preview is being used to demo the install flow to somebody, set
`NEXT_PUBLIC_APP_URL` to that preview's own alias rather than leaving it unset.

## Supabase Auth is configured in the Supabase dashboard, not here

These are project settings, not environment variables, and they bit us once
already — `site_url` was `http://localhost:3000` on the production project, so
every confirmation email sent a real customer to their own machine.

| Setting                   | Value                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| Site URL                  | `https://recopyfa.st`                                                     |
| Redirect allow-list       | `https://recopyfa.st/**`, `https://www.recopyfa.st/**`, `http://localhost:3000/**` |
| SMTP host / port          | `smtp.resend.com` / `465`                                                 |
| SMTP user                 | `resend`                                                                  |
| SMTP pass                 | the `RESEND_API_KEY`                                                      |
| Sender                    | `ReCopyFast <noreply@recopyfa.st>` — `recopyfa.st` is the verified domain |

Supabase's built-in SMTP is rate-limited to a handful of messages an hour and is
explicitly not for production; on it, signup email delivery was unproven at any
volume. Email templates must link to `/auth/confirm?token_hash=…`, never to
`/auth/callback`, which needs the PKCE verifier cookie and so breaks whenever
the link is opened on a different device from the one that requested it.

## Applied to the production database by hand

`supabase/migrations/20260805190000_lock_down_content_version_rpcs.sql` was run
against the live project on 2026-08-05, because what it fixes was live.

`create_content_version` and `restore_content_version` are `SECURITY DEFINER`
and were executable by `PUBLIC`, `anon` and `authenticated`. PostgREST publishes
every function in `public` as an RPC, so the anon key — which ships in the
client bundle by design — could call them, and neither asks who the caller is.
Confirmed before the fix: `POST /rest/v1/rpc/restore_content_version` with the
anon key returned `Version not found`, an error raised *inside* the function
body. With a real version id it would have rewritten another tenant's drafts.

After applying, the same call returns `42501 permission denied`, and the ACL is
`postgres=X, service_role=X` on both. Every caller in this codebase — the two
history routes, the styles route, `server/index.js` — uses the service-role
client, so nothing legitimate lost access; `npm run qa:journey` passes 43/43
against the live project, rollback included.

## `NEXT_PUBLIC_APP_URL`

Used to build every absolute URL the app hands back to a user: auth callback
redirects, Stripe Checkout `success_url` / `cancel_url`, embed snippets, OG
tags.

**Why it must differ.** `NEXT_PUBLIC_*` variables are inlined at build time, so
a preview deployment bakes in whatever value the project had when it built. A
project that defines `NEXT_PUBLIC_APP_URL` once, for all environments, ships the
production origin inside every preview bundle. Confirming a magic link on a
preview then set the session cookie on the preview host and redirected to
production — where that cookie does not exist, so the user landed logged out.
Stripe returns bounced the same way. (QA register F-14.)

**What the code does now.** `resolvePublicOrigin`
(`src/app/auth/public-origin.ts`) prefers the hostname Vercel assigned the
deployment (`VERCEL_URL` / `VERCEL_BRANCH_URL`) over `NEXT_PUBLIC_APP_URL`
whenever `VERCEL_ENV` says this is a non-production deployment. Those variables
are set by the platform per deployment and read at runtime, so they cannot be
inherited or spoofed. Leaving `NEXT_PUBLIC_APP_URL` unset on Preview is
therefore fine, and is the simplest correct configuration.

It is _not_ fine to set it to the production URL on Preview. Nothing outside the
auth redirect path consults `VERCEL_ENV` — embed snippets, Checkout return URLs
and OG tags all read `NEXT_PUBLIC_APP_URL` directly and will still point at
production.

**Local.** `.env.local` overrides `.env` and is gitignored, so put
`NEXT_PUBLIC_APP_URL=http://localhost:3000` there. The committed `.env.example`
already carries that default.

## `STRIPE_WEBHOOK_SECRET`

**Read this first: the `_LIVE` suffix, not the value, decides the mode.**
`src/lib/stripe/mode.ts` picks live vs test from `VERCEL_ENV` alone —
`production` is live, everything else is test. So a preview deployment reads
`STRIPE_WEBHOOK_SECRET` and production reads `STRIPE_WEBHOOK_SECRET_LIVE`.
Putting a live secret in the unsuffixed variable does not make anything live; it
makes signature verification fail everywhere that is not production.

**Why it must differ.** Every Stripe webhook _endpoint_ has its own signing
secret. The endpoint delivering to `recopyfa.st`, the endpoint delivering to a
preview URL, and a local `stripe listen` session are three different endpoints
with three different secrets. `requireWebhookSecret` fails closed on an unset
one, and `constructEvent` rejects a wrong one — either way every webhook 400s
and subscriptions and credit purchases silently never provision.

**Local.**

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the whsec_… it prints into .env.local as STRIPE_WEBHOOK_SECRET
```

The secret changes each time `stripe listen` starts unless you pass
`--load-from-webhooks-api`.

## Checking a deployment

```bash
# What Vercel thinks this deployment is. "production" is the only value that
# selects live Stripe keys and the canonical origin.
vercel env pull .env.preview --environment=preview
curl -s https://<deployment>/api/health | jq '.environment'
```

If a preview redirects you to `www.recopyfa.st` after sign-in, check
`NEXT_PUBLIC_APP_URL` is not ticked for Preview. If preview webhooks return 400,
check `STRIPE_WEBHOOK_SECRET` matches the test-mode endpoint, not the live one.
