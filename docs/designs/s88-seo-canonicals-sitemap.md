# Design — s88-seo-canonicals-sitemap (review fix: the `/blog` index)

No new screen and no mockup. The story itself changes no visible surface (the homepage gains an
invisible JSON-LD script). Its review fix (minor 2) changes what `/blog` lists: the hard-coded
three posts from January 2024 are gone and the page shows what `blog_posts` publishes. Marketing
surface (`docs/design-system.md`, marketing exception); every piece below is an existing
primitive.

## States

| State | When | Renders |
|---|---|---|
| Success | at least one published post | the category filter and the card grid (`BlogPostList`), newest `published_at` first |
| Empty | the read worked and nothing is published | `EmptyState` — `Newspaper` icon, "No posts yet", one line, one action: outline `Button` → `/docs/install` |
| Error | the read failed, or the client is unconfigured | `Alert variant="destructive"`, "The blog could not be loaded" — never the empty state |
| Loading | — | none: the page is rendered on the server (hourly ISR), the visitor never waits on the read |

The page header (h1 "Blog", the intro line) and the "Start editing your site in minutes" CTA are
unchanged in every state.

## The card

Shows only what the table holds: category badge, title, excerpt (omitted when null), publication
date (omitted when null), "Read more" → `/blog/<slug>`.

Removed from the list: the **"Featured" hero** (no column backs "featured"; it was a claim in the
fake data) and the **read time** (it would mean reading every article's full `content` for the
index; `/blog/<slug>` keeps its own).

## Design system gaps

None.
