# Blog — AI drafts, human review, publish

The blog cron **drafts**; a platform admin **publishes**. Nothing written by a model reaches
`/blog/<slug>` or the sitemap until a person has read it and published it through the route below.
Story `s89-blog-drafts-only`, decision [ADR 057](../decisions/057-ai-blog-posts-are-drafts-platform-admin-publishes.md).

`<app>` below is the production origin you sign in on (the value of `NEXT_PUBLIC_APP_URL`, e.g.
`https://www.recopyfa.st`). Use the exact same origin for signing in and for the calls: the publish
route refuses a request from any other origin, including the apex host and branded subdomains.

## Once, before the first deploy of s89

1. **Apply the migration first** — `supabase/migrations/20261009150000_blog_posts_daily_draft_key.sql`.
   It only adds the nullable column `blog_posts.generated_on` and a unique index on it, so the code
   already in production is unaffected. The new code reads that column: deployed without it, the
   cron answers 500 (see Troubleshooting) and publishes nothing.
2. **Set `ADMIN_EMAILS`** in Vercel → Project → Settings → Environment Variables → Production to the
   owner's sign-in address (comma-separated for more than one; case and spaces do not matter), then
   redeploy — env changes apply to new deployments only. A user whose server-managed
   `app_metadata.role` is `"admin"` (Supabase Admin SDK) is also admin. `user_metadata` never is.
3. Already required and unchanged: `CRON_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. **Review what is already live.** Before s89 the cron inserted posts as `published`. Production
   most likely holds none (the insert was refused by RLS — `docs/research/s89-blog-drafts-only.md`,
   fact 2), but check: list published posts (below) and unpublish any that fail review.

## How drafts are created

- **Daily, 14:00 UTC** (`vercel.json`): Vercel calls `GET /api/cron/generate-blog-post` with
  `Authorization: Bearer $CRON_SECRET`. It picks a listed topic, asks OpenAI for a post and stores it
  with `status = 'draft'`, `published_at = NULL`, `generated_on = <UTC day>`.
- **One per UTC day.** A second run the same day — a Vercel duplicate delivery, a retry, a manual
  run — answers with the day's draft and `"created": false`, and does not call OpenAI. The database
  enforces it (unique `generated_on`). Response:

  ```json
  { "success": true, "created": true,
    "draft": { "id": "…", "title": "…", "slug": "…", "category": "…", "status": "draft",
               "excerpt": "…", "generated_on": "2026-10-09", "published_at": null, "created_at": "…" } }
  ```

- **Run it by hand** (idempotent, so safe to repeat), with the secret read from your shell, never
  typed into a shared log: `curl -sS -H "Authorization: Bearer $CRON_SECRET" <app>/api/cron/generate-blog-post`.
- **On demand, as an admin** (any number per day, never published): signed in, in the browser
  console on `<app>`:

  ```js
  await (await fetch("/api/blog/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "Your topic", category: "development" }), // or {} for a random listed topic
  })).json();
  ```

  `topic` (≤ 200 characters) and `category` (≤ 50) go together; `targetKeywords` (≤ 500) is optional.
  Ten calls a minute per admin — each one is an OpenAI spend. The cron secret does not open this route.

## Review

1. Sign in at `<app>/login` with an admin account.
2. Open `<app>/api/admin/blog/posts` in the same browser. It lists drafts, newest first, each with its
   full markdown `content`. `<app>/api/admin/blog/posts?status=published` lists what is live.
3. Read the draft. Check at least:
   - every claim about RecopyFast is true today — the prompt asks the model to mention the product,
     and it will invent features; nothing from the PRD's graveyard (`docs/prd.md`, "Explicitly NOT
     replicated") may be promised;
   - no invented statistics, quotes, customers or sources;
   - it is not a near-duplicate of a post already live (the topic list is fixed; a repeated title
     gets the day appended to its slug — `…-2026-10-09`);
   - the title and slug are what you want public.
4. There is no in-app editor. To fix wording, edit `title`, `content`, `excerpt` or `slug` of the draft
   in the Supabase dashboard (Table Editor → `blog_posts`) **before** publishing. Do not change
   `status` or `published_at` there — publish through the route, so the transition is checked and
   logged.

## Publish and unpublish

In the browser console on `<app>`, signed in as an admin, with the draft's `id`:

```js
await (await fetch("/api/admin/blog/posts/<id>", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "publish" }), // or "unpublish"
})).json();
```

- `publish`: draft → `published`, `published_at` = now. The post is served at `<app>/blog/<slug>` and
  listed in the sitemap.
- `unpublish`: published → `draft`, `published_at` cleared; its URL answers 404 again. Fix it and
  publish again later.
- Answers: `200 { post }` · `400` malformed id or action · `401` not signed in · `403` not an admin, or
  the call came from another origin / without an `Origin` header · `404` no such post · `409` the post
  is not in the state the action expects (already published, still a draft, archived) · `429`/`503`
  rate limited / limiter store down (fails closed).
- **Known gap:** the `/blog` index page is a static list (`src/app/blog/page.tsx`), not the published
  posts. A published post is reachable at its URL and through the sitemap only (follow-up story).

## Audit trail

Every successful publish or unpublish logs one line in the Vercel function logs:
`[admin-blog] publish post <post-id> by user <auth-user-id>`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Cron 500, log `Failed to read the day's blog draft: column … generated_on does not exist` | The migration is not applied (step 1 above). |
| Cron 500, log `OPENAI_API_KEY is not configured` | Env var missing in Production. |
| Cron 500, log `Supabase service role environment variables are not configured` | `SUPABASE_SERVICE_ROLE_KEY` or `NEXT_PUBLIC_SUPABASE_URL` missing. |
| Cron 401 | `CRON_SECRET` unset, or not the value Vercel sends. |
| `403` although your address is in `ADMIN_EMAILS` | The variable is not in the **Production** environment, the deployment predates it (redeploy), or you signed in with another address. |
| `403` on the `fetch` from the console | The tab is not on `<app>` (apex vs `www`, a branded subdomain, another site). |
| `401` on the list URL | Not signed in on that origin. |
