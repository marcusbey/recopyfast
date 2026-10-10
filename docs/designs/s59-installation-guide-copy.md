# Install ReCopyFast on your website

Add your site's snippet once to each page you want to edit. Then open the live site, confirm installation, and invite an editor. You need access to publish changes to the website and an active ReCopyFast plan for editing.

## 1. Copy your site's snippet

1. Sign in to ReCopyFast and open **Sites**.
2. Add your website, or choose **View Details** on an existing site.
3. In **Installation**, select **Copy snippet**. On an installed site, select **View install snippet** first if needed.
4. Copy the complete snippet from that site. Do not use another site's snippet or the placeholder example below.

Register the hostname people actually visit after redirects. For example, if `example.com` redirects to `www.example.com`, register `www.example.com`. A subdomain such as `shop.example.com` is a different hostname; the snippet is not a wildcard installation.

### What the generated snippet looks like

This is an illustration, not a working installation:

```html
<script
  src="https://www.recopyfa.st/embed/recopyfast.js"
  data-site-id="YOUR_SITE_ID"
  data-site-token="YOUR_SITE_TOKEN"
  data-api-url="https://www.recopyfa.st/api"
  data-ws-url="wss://recopyfast-ws.fly.dev"
></script>
```

The dashboard normally returns the same tag on one line.

| Part | Purpose |
| --- | --- |
| `src` | Loads the ReCopyFast widget. Keep the generated URL. |
| `data-site-id` | Identifies the website you registered. |
| `data-site-token` | Authorizes the installed widget's site requests. It is designed to appear in page HTML; it is not an editor sign-in credential. |
| `data-api-url` | Tells the widget where to read and save content. |
| `data-ws-url` | Enables realtime updates. Some deployments omit it; preserve what the dashboard generated. |

Never substitute a Supabase service key, Stripe key, site signing secret, editor token, or magic-link URL into the snippet. Do not click **Regenerate snippet** just to copy it: regeneration invalidates the previous snippet, which must then be replaced wherever it was installed.

## 2. Choose which pages to install it on

- **One page:** add the snippet only to that page.
- **Several pages:** add it to each selected page or their shared footer/layout.
- **Whole website:** use a shared footer/layout that runs on every intended page, and check at least two different paths.

Include one instance per loaded page. Do not install it both in a template and in a tag manager.

An invitation grants permissions for the registered site. It is not a restriction to one URL path. Editing controls require the widget to be running on the page. ReCopyFast stores content by page; changing `/about` should not change `/`.

## 3. Add the snippet

### Plain HTML and sites with full page navigation

Paste the exact generated tag immediately before `</body>`. If a shared footer produces every page, paste it there once. Otherwise, add it to each intended page. Publish the updated site, then open its public URL.

### WordPress and website builders

Use the platform's supported custom-code/footer setting to insert the exact script before the closing body tag on the intended pages. A WordPress footer-injection plugin can preserve the installation across theme updates; editing a parent theme directly may not. A visual text block that displays the tag as text will not execute it.

Custom JavaScript may require a particular plan or permission. If the platform strips the tag or offers no script-injection setting, use its documented integration path or ask its administrator. Do not assume every builder or subscription supports this installation. Publish changes; checking only the builder preview is insufficient.

### React, Next.js and other single-page applications

These require an integration check. The current widget scans the rendered DOM and does not provide a complete lifecycle for client-side route changes.

- Load it after the page has hydrated, preserving every generated attribute and value. For Next.js, `next/script` with `strategy="afterInteractive"` is one loading mechanism.
- A root layout or a one-time script load is not proof that subsequent client-side pages will initialize, restore saved content or clean up correctly.
- Verify full page loads, internal navigation, Back, reload, and returning to an edited page. Do not claim SPA support from the first page loading successfully.
- Where appropriate, use full document navigation on the pages with the widget. If that would disrupt the website, pause the installation and resolve the integration rather than adding an incomplete cleanup workaround.

This is why the guide does not promise a universal React copy-and-paste recipe. An agent or developer should verify the site's routing and analytics before installing.

### Rendering at first paint

ReCopyFast applies saved copy after the widget starts and fetches published content. The page's original HTML can appear briefly first, so installing the snippet does not guarantee zero-flash initial rendering. For critical hero copy that must be stable at first paint, keep the initial value in the site's source and report this limitation.

### Protect editor links from analytics

Editor-entry URLs can contain temporary credentials such as `rcf_handoff` or `rcf_edit_token`. Analytics and session-replay tools may read the full URL before ReCopyFast removes them.

On any document with `rcf_handoff`, `rcf_edit_token`, `rcf_staging` or `rcf_token` in the query, suppress URL-collecting third-party scripts before they execute, or use a verified ordering that prevents them from seeing the credentials. A `Referrer-Policy` header alone does not stop a script reading `window.location.href`. Never copy an editor-entry URL into a public issue or analytics log.

## 4. Verify the installation

1. Open the published URL on the registered hostname.
2. Check that the original page still renders and its links and forms work.
3. Confirm exactly one widget script loads. If it is blocked, inspect browser network and Content Security Policy errors.
4. Return to **Sites → View Details → Installation**. It should move from awaiting installation to live after the widget reports. The dashboard checks automatically; its status is not a substitute for testing edits.
5. Repeat on another installed path if you installed across multiple pages.

If CSP blocks the integration, have the site administrator review the required script, API, WebSocket and style permissions. Do not remove CSP or add broad `*`/`unsafe-inline` allowances merely to make the widget load.

## 5. Invite someone and test a real edit

1. In the site's activation checklist, choose **Invite a client**.
2. Enter their email and give them **edit** and **publish** if they should make public changes. Editing without publish permission only supports the actions their permissions allow.
3. For someone already invited, use **Resend invite** rather than creating another entry.
4. The recipient opens the editor hub at `https://www.recopyfa.st/edit`, enters the invited email, and verifies the emailed code themselves. They do not need to create an owner account to be an invited editor.
5. They choose the site and test a small, agreed change. **Save** keeps a draft; **Publish** makes the saved change public.
6. Open the clean website URL in a separate visitor session and reload it to confirm the result. Restore any temporary test copy and publish that restoration.

Editing depends on the site owner's active plan and the editor's permissions. A script can still be installed while a lapsed plan prevents editing.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Awaiting installation | Published page rather than preview; exact hostname after redirects; script stripped by builder; network/CSP errors. |
| Homepage works, another page does not | Snippet coverage on that page; client-side navigation retaining an old widget; duplicate loaders. |
| Visitors cannot see an edit | It was saved but not published; wrong page path; cached page; verify from a fresh visitor session. |
| Invitation received, editing unavailable | Sign-in email matches invitation; permissions include needed actions; owner's plan is active. |
| Site requests fail after regeneration | Replace the old snippet on every installed page with the newly generated one. |
| Same script loads twice | Remove the duplicate from the page, shared layout, plugin or tag manager. |

## Remove or roll back an installation

Restore the previous website deployment or remove the snippet from its installation point and republish. Confirm the script no longer loads on the intended pages. Removing the snippet does not revoke editor access or delete content stored in ReCopyFast. Manage those separately in the dashboard.
