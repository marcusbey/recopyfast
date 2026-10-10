# Install ReCopyFast for a website owner

Use this brief with an agent that can inspect the website source or builder and publish changes. Work only within the user's authorized website and page scope.

## Inputs

- Website URL: [actual production URL]
- Pages to make editable: [homepage / explicit paths / whole site]
- Exact snippet copied from this site's ReCopyFast dashboard: [paste complete script tag]
- Website repository, CMS or builder access: [location]
- Publishing authority: [preview only / production installation authorized]
- Optional editor invitation: [email plus edit/publish permissions; only send when requested]

If any input cannot be established from the user's request, the source or the current authenticated dashboard, ask for that specific missing detail. Do not guess a site ID, token, hostname, deployment project or publication approval.

## Installation procedure

1. Resolve the website's final hostname after redirects. Match it to the registered ReCopyFast site. Treat www, apex and other subdomains as distinct hosts.
2. Inspect the correct repository or builder and applicable project instructions. Preserve unrelated edits. For source changes, use an isolated branch/worktree from the current deployed baseline, and follow that project's plan/review gates.
3. Save a before screenshot and note the current deployment and rollback path. Establish exactly which pages the user authorized; do not substitute a QA route or extend to other pages silently.
4. Use the existing dashboard snippet. If it is already installed, verify or move it; do not regenerate it unless rotation was explicitly requested. Never use privileged backend credentials to replace the public site token.
5. For a full-document site, place one exact tag immediately before the closing body tag on each intended page or their shared footer. On a builder, use its supported script/footer feature and publish the result. Do not modify authored marketing copy, forms or unrelated integrations.
6. For React/Next.js, inspect hydration and navigation first. Preserve the generated data attributes in a framework script loader after hydration. The current widget has no complete SPA teardown/reinitialization contract. Verify route transitions and return navigation; use full document navigation only when appropriate to the authorized scope. If you cannot make the lifecycle reliable without a material website change, explain the concrete blocker before expanding the work.
7. Inspect analytics, tag managers and session replay before loading the widget. Prevent them from collecting editor-entry query credentials. Suppress collectors before execution on documents with rcf_handoff, rcf_edit_token, rcf_staging or rcf_token, or prove a safe ordering. A referrer header alone is insufficient. Do not put edit tokens in logs, screenshots, commits, reports or shared links.
8. Account for first paint. Published content is applied after the widget starts and fetches it, so the original HTML can appear briefly. Do not claim zero-flash rendering or seamless SSR from snippet installation. For critical hero copy, report this limitation and keep the first-paint value in the site's source when zero-flash rendering matters.
9. If CSP blocks the integration, report the exact blocked resource/directive and propose the narrow required change. Do not weaken global security policies or claim an unverified platform integration works.
10. Run checks relevant to the changed source and a browser check on the built result. If production is authorized, deploy only the reviewed installation diff. Otherwise return the verified preview and precise remaining publication step.

## Verify the published result

- Public URL and deployment are the intended target; the original page, navigation and forms remain usable.
- Exactly one ReCopyFast script loads with the supplied attributes. Report token match as a boolean, not the token itself.
- Installation status updates after a real page visit. Record this separately from editing proof.
- Every in-scope page initializes correctly on direct load, internal navigation, reload and Back/return. For a one-page installation, verify the widget does not persist onto an out-of-scope page.
- For editor-entry pages, verify URL-collecting analytics cannot see the temporary credentials. Use synthetic values for automated leakage probes, never a real editor token.
- If the user requested an invitation, send it with the requested permissions through the application's normal flow. Reuse an existing editor record and resend when appropriate. Distinguish request acceptance, provider delivery and recipient sign-in.
- The recipient enters their own email sign-in code or magic link. Do not read their inbox codes, mint an administrative impersonation session, or mark authentication complete without evidence.
- With the user's authorization and authenticated session, change one agreed element, save a draft, publish, verify from a separate visitor session, then restore the original and verify the restoration. If authentication or publication is unavailable, mark those exact steps untested.

## Report back

Report these fields concisely:

- Installed URL(s), exact page coverage and source/deployment revision.
- Installation location and changed files/settings.
- What was verified: script load, installation report, invitation delivery, sign-in, save, publish, visitor reload, restoration.
- What remains untested or blocked and why.
- Rollback steps and whether source merge is still pending.

Do not equate a green build, a Live badge, a sent email or a visible widget with a completed edit/save/publish test. Never charge a card, buy credits, create an account or send invitations unless the user authorized that action.
