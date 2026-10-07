# Published-copy snapshot — rendering ReCopyFast copy in your own HTML

Subordinate to [`../architecture.md`](../architecture.md). Decision and security rationale:
[ADR 046](../decisions/046-unauthenticated-published-copy-snapshot.md). Story: `s65a`.

## Why this exists

The embed (`/embed/recopyfast.js`) fetches published copy **in the visitor's browser**, after
your authored HTML has already painted. On a page whose copy was edited in ReCopyFast, visitors
therefore see the authored text first and the published text a network round trip later. **The
embed alone is not flash-free**, and no faster script can make it so: production content reads
take roughly half a second.

The snapshot is the opt-in fix. Your server, edge function or build fetches the published copy
of a page and renders it into the HTML it sends. The browser paints published copy first; the
embed then boots, finds the text already correct, and changes nothing. Sites that only install
the embed keep working exactly as before — the snapshot is never required.

## The request

```
GET https://www.recopyfa.st/api/published/<siteId>?page=<pagePath>&language=<language>&variant=<variant>
```

No token, no cookie, no `Origin` and no `Authorization` header. Do not send `Authorization`: a
request carrying it is never served from the CDN.

**Build the query with `URLSearchParams`, in exactly this order**, so that every caller shares
the same CDN entry. Parameters in another order, an extra parameter (a cache buster, say), a
repeated or a missing parameter are refused with `400`. Spell the values exactly as
`URLSearchParams` does too (`%2F` for `/`, `+` for a space). Other percent-encodings of the same
value (`page=/`, `page=%2f`) are served as the same snapshot, with the same body and `ETag`, but
each spelling may be a separate CDN entry, so it can only be slower.

An exception to the `400` for an extra parameter: the server removes Next's internal query keys
(`nextInternalLocale`, and any key that starts with `nxtP` or `nxtI` and is longer than that
prefix) before the check, so a request carrying one is served like the request without it —
again as a separate CDN entry. Do not send them.

```js
const query = new URLSearchParams([
  ["page", pagePath], // e.g. "/pricing"
  ["language", "en"],
  ["variant", "default"],
]).toString();

const response = await fetch(
  `https://www.recopyfa.st/api/published/${siteId}?${query}`,
);
```

| Parameter  | Rule                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `siteId`   | The site's UUID, lowercase — the `data-site-id` of your snippet.                                                                                                                                                                                                                                                                                                                                                |
| `page`     | The page key the embed uses: `decodeURI(location.pathname)`, then remove a final `/index.html` (or `.htm`) or else any trailing slashes, as the embed's `normalizedPagePath()` does; the root is `/`. So `/pricing/` and `/pricing/index.html` are both `page=/pricing`. Must start with `/`, no `?` or `#`, no control characters, ≤ 1,024 characters and bytes. A trailing slash (other than `/`) is refused. |
| `language` | The language the copy was published in; `en` unless you publish translations. 1–64 characters, no control characters.                                                                                                                                                                                                                                                                                           |
| `variant`  | `default` unless you write named variants through the API. 1–64 characters, no control characters.                                                                                                                                                                                                                                                                                                              |

## The response

`200`, `Content-Type: application/json`:

```json
{
  "format": "rcf-published-v1",
  "siteId": "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4",
  "pagePath": "/pricing",
  "language": "en",
  "variant": "default",
  "rows": [
    {
      "id": "…",
      "site_id": "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4",
      "element_id": "pricing-headline",
      "selector": "[data-rcf-id=\"pricing-headline\"]",
      "published_content": "Plans that grow with you",
      "original_content": "Pricing",
      "language": "en",
      "variant": "default",
      "page_path": null,
      "metadata": {},
      "published_at": "2026-10-06T12:00:00.000Z",
      "current_content": "Plans that grow with you"
    }
  ]
}
```

- **Render `current_content`.** It is what the embed applies: the published value, falling back
  to the authored value, then to an empty string. Treat it as **text** and escape it into your
  HTML — the embed applies it as `textContent`, never as markup. Skip a row whose
  `current_content` is empty; the embed does the same.
- `rows` holds the page's own rows plus **all** of the site's shared rows (`page_path: null`),
  ordered by `element_id`. Every author-written `data-rcf-id` anchor is a shared row (see
  [Anchoring](#anchoring-data-rcf-id)), so an unknown page is `200` with the site's shared rows,
  and `rows: []` only when the site has none. Each anchor you add grows every page's response,
  and a response over 1 MiB is refused with `500`.
- For a link (`<a>`) the embed also applies `metadata.href`, and for an image `metadata.alt`;
  for an image, `current_content` is the `src`.
- The rows are the same, field for field, as the embed's own read for that page. Staging drafts,
  unpublished link targets and publisher identity are never included.

Other statuses: `400` for another parameter order or set, or an invalid value (never cached),
`404` with `{ "error": "Site not found" }` for an unknown or deleted site (cached like a `200`),
`429` when one IP sends too many uncached requests, `500` on a server fault or an oversized
response (never cached). On anything but `200`, render your authored copy — the embed will still
apply published copy in the browser.

## Request budget

Only CDN misses reach our origin, and the origin allows **200 uncached requests per minute per
client IP** (the `IP_GENERAL` preset, counted in its own `published/read` bucket, in fixed
one-minute windows). Past that it answers `429`, with a `Retry-After` header in seconds, until
the next window. CDN hits do not count, but every distinct page, language and variant is a miss
the first time, and each of our deploys starts the CDN cold.

- **Static builds** that fetch many pages at once: pace the requests (200 a minute is just over
  3 a second from one IP), and on `429` wait `Retry-After` and retry instead of building that
  page with authored copy.
- **Hosts behind shared egress IPs** (serverless platforms where many functions leave through
  the same addresses) share the budget with everything else sent from that IP, including
  traffic you do not control. Retry after `Retry-After` where your render can wait; otherwise
  render authored copy, as for any other non-`200`.

## Anchoring: `data-rcf-id`

The embed matches rows to elements by id. For an element without a `data-rcf-id`, it derives the
id from the page path and the element's position in the DOM — a hash your server cannot
reproduce. So **pin the elements you render from the snapshot with an explicit `data-rcf-id`**,
the same value as the row's `element_id`:

```html
<h1 data-rcf-id="pricing-headline">Plans that grow with you</h1>
```

An author-written `data-rcf-id` is honoured verbatim by the embed, and its row is stored as a
shared row (`page_path: null`), so it is returned for every page. Use ids that are unique across
your site, or prefix them with the page.

Keep the embed installed: it is still the editor, the fallback when your render could not fetch
the snapshot, and how new elements are discovered. With the published text already in the HTML,
it leaves the element alone. Discovery only inserts rows that do not exist yet, so an existing
row's `original_content` is never overwritten with the published text you rendered.

## Freshness and retraction

- **At most 60 seconds after a change, at our edge.** The CDN holds a response for 30 seconds
  and may serve it stale for 30 more while it refreshes in the background. This covers every way
  copy changes — publishing, bulk edits, the API, translation, deletion.
- **Your own caching adds to that bound.** If your server caches rendered pages for five minutes,
  a change can take up to six. Choose accordingly. A signed change webhook for hosts that rebuild statically is planned
  (s65b); until then, revalidate on a timer.
- **Retraction has the same bound.** An unpublished or deleted element disappears, and a deleted
  site answers `404`, within 60 seconds. There are no permanent versioned snapshot URLs.
- Browsers and caches in front of you are told to revalidate every time
  (`Cache-Control: public, max-age=0, must-revalidate`). Each response carries a strong `ETag`;
  send it back as `If-None-Match` to get a `304` with no body.

## Plan

Published copy is served whatever the site owner's plan (ADR 041): a lapsed plan stops editing,
never delivery. The snapshot follows the same rule.
