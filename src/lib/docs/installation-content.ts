import { buildEmbedScript } from "@/lib/sites/embed-script";

export interface InstallationSnippetPart {
  attribute: string;
  purpose: string;
}

export interface InstallationPlatform {
  id: "html" | "builders" | "spa";
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
}

export interface InstallationTroubleshootingRow {
  symptom: string;
  checks: string;
}

export interface InstallationGuideContent {
  title: string;
  introduction: string;
  requirement: string;
  copySnippet: {
    id: string;
    title: string;
    steps: readonly string[];
    hostnameGuidance: string;
    exampleLead: string;
    snippetParts: readonly InstallationSnippetPart[];
    tokenGuidance: string;
  };
  pageScope: {
    id: string;
    title: string;
    choices: readonly string[];
    instanceGuidance: string;
    permissionGuidance: string;
  };
  install: {
    id: string;
    title: string;
    platforms: readonly InstallationPlatform[];
    renderingTitle: string;
    renderingGuidance: string;
    analyticsTitle: string;
    analyticsParagraphs: readonly string[];
  };
  verify: {
    id: string;
    title: string;
    steps: readonly string[];
    cspGuidance: string;
  };
  invite: {
    id: string;
    title: string;
    steps: readonly string[];
    planGuidance: string;
  };
  troubleshooting: {
    id: string;
    title: string;
    rows: readonly InstallationTroubleshootingRow[];
  };
  rollback: {
    id: string;
    title: string;
    guidance: string;
  };
}

const INSTALLATION_APP_URL = "https://www.recopyfa.st";
const INSTALLATION_WS_URL = "wss://recopyfast-ws.fly.dev";

function formatSnippetForDisplay(snippet: string): string {
  return snippet
    .replace(/ (src|data-[a-z-]+)=/g, "\n  $1=")
    .replace("></script>", "\n></script>");
}

const installationExampleSnippet = buildEmbedScript({
  siteId: "YOUR_SITE_ID",
  siteToken: "YOUR_SITE_TOKEN",
  appUrl: INSTALLATION_APP_URL,
  wsUrl: INSTALLATION_WS_URL,
});

/**
 * Public documentation must never grow a handwritten imitation of the embed
 * tag. The dashboard builder has already changed for canonical hosts and an
 * optional websocket; using it here makes those changes visible to this guide
 * instead of leaving a plausible but stale example behind.
 */
export const INSTALLATION_EXAMPLE = {
  siteId: "YOUR_SITE_ID",
  siteToken: "YOUR_SITE_TOKEN",
  appUrl: INSTALLATION_APP_URL,
  wsUrl: INSTALLATION_WS_URL,
  snippet: installationExampleSnippet,
  displaySnippet: formatSnippetForDisplay(installationExampleSnippet),
} as const;

export const AGENT_INSTRUCTIONS_DOWNLOAD_PATH =
  "/docs/install/agent-instructions.md";

export const INSTALLATION_GUIDE: InstallationGuideContent = {
  title: "Install ReCopyFast on your website",
  introduction:
    "Add your site's snippet once to each page you want to edit. Then open the live site, confirm installation, and invite an editor.",
  requirement:
    "You need access to publish changes to the website and an active ReCopyFast plan for editing.",
  copySnippet: {
    id: "copy-snippet",
    title: "1. Copy your site's snippet",
    steps: [
      "Sign in to ReCopyFast and open Sites.",
      "Add your website, or choose View Details on an existing site.",
      "In Installation, select Copy snippet. On an installed site, select View install snippet first if needed.",
      "Copy the complete snippet from that site. Do not use another site's snippet or the placeholder example below.",
    ],
    hostnameGuidance:
      "Register the hostname people actually visit after redirects. For example, if example.com redirects to www.example.com, register www.example.com. A subdomain such as shop.example.com is a different hostname; the snippet is not a wildcard installation.",
    exampleLead:
      "This is an illustration, not a working installation. The dashboard normally returns the same tag on one line.",
    snippetParts: [
      {
        attribute: "src",
        purpose: "Loads the ReCopyFast widget. Keep the generated URL.",
      },
      {
        attribute: "data-site-id",
        purpose: "Identifies the website you registered.",
      },
      {
        attribute: "data-site-token",
        purpose:
          "Authorizes the installed widget's site requests. It is designed to appear in page HTML; it is not an editor sign-in credential.",
      },
      {
        attribute: "data-api-url",
        purpose: "Tells the widget where to read and save content.",
      },
      {
        attribute: "data-ws-url",
        purpose:
          "Enables realtime updates. Some deployments omit it; preserve what the dashboard generated.",
      },
    ],
    tokenGuidance:
      "Never substitute a Supabase service key, Stripe key, site signing secret, editor token, or magic-link URL into the snippet. Do not select Regenerate snippet just to copy it: regeneration invalidates the previous snippet, which must then be replaced wherever it was installed.",
  },
  pageScope: {
    id: "page-scope",
    title: "2. Choose which pages to install it on",
    choices: [
      "One page: add the snippet only to that page.",
      "Several pages: add it to each selected page or their shared footer or layout.",
      "Whole website: use a shared footer or layout that runs on every intended page, and check at least two different paths.",
    ],
    instanceGuidance:
      "Include one instance per loaded page. Do not install it both in a template and in a tag manager.",
    permissionGuidance:
      "An invitation grants permissions for the registered site. It is not a restriction to one URL path. Editing controls require the widget to be running on the page. ReCopyFast stores content by page; changing /about should not change /.",
  },
  install: {
    id: "add-snippet",
    title: "3. Add the snippet",
    platforms: [
      {
        id: "html",
        title: "Plain HTML and sites with full page navigation",
        paragraphs: [
          "Paste the exact generated tag immediately before </body>. If a shared footer produces every page, paste it there once. Otherwise, add it to each intended page. Publish the updated site, then open its public URL.",
        ],
      },
      {
        id: "builders",
        title: "WordPress and website builders",
        paragraphs: [
          "Use the platform's supported custom-code or footer setting to insert the exact script before the closing body tag on the intended pages. A WordPress footer-injection plugin can preserve the installation across theme updates; editing a parent theme directly may not. A visual text block that displays the tag as text will not execute it.",
          "Custom JavaScript may require a particular plan or permission. If the platform strips the tag or offers no script-injection setting, use its documented integration path or ask its administrator. Do not assume every builder or subscription supports this installation. Publish changes; checking only the builder preview is insufficient.",
        ],
      },
      {
        id: "spa",
        title: "React, Next.js and other single-page applications",
        paragraphs: [
          "The plain snippet follows client-side route changes made with the History API (links, Back and Forward in a history-mode router): on each in-app navigation it loads that page's published copy and makes the newly rendered elements editable, with no framework-specific code.",
          "Hash routes (/#/route) are not supported: every hash route shares one page path, so their elements collide. The workaround is to switch the router to history mode, or to give each route's elements an author-written, unique data-rcf-id.",
          "Each site still needs an integration check, which is why the guide does not promise a universal React copy-and-paste recipe. An agent or developer should verify the site's routing and analytics before installing.",
        ],
        bullets: [
          'Load it after the page has hydrated, preserving every generated attribute and value. For Next.js, next/script with strategy="afterInteractive" is one loading mechanism.',
          "Verify a full page load and an in-app navigation: both should show published copy, and an invited editor should be able to edit on both. Then check Back, reload, and returning to an edited page.",
          "Do not claim SPA support from the first page loading successfully.",
        ],
      },
    ],
    renderingTitle: "Rendering at first paint",
    renderingGuidance:
      "ReCopyFast applies saved copy after the widget starts and fetches published content. The page's original HTML can appear briefly first, so installing the snippet does not guarantee zero-flash initial rendering. For critical hero copy that must be stable at first paint, keep the initial value in the site's source and report this limitation.",
    analyticsTitle: "Protect editor links from analytics",
    analyticsParagraphs: [
      "Editor-entry URLs can contain temporary credentials such as rcf_handoff or rcf_edit_token. Analytics and session-replay tools may read the full URL before ReCopyFast removes them.",
      "On any document with rcf_handoff, rcf_edit_token, rcf_staging or rcf_token in the query, suppress URL-collecting third-party scripts before they execute, or use a verified ordering that prevents them from seeing the credentials. A Referrer-Policy header alone does not stop a script reading window.location.href. Never copy an editor-entry URL into a public issue or analytics log.",
    ],
  },
  verify: {
    id: "verify",
    title: "4. Verify the installation",
    steps: [
      "Open the published URL on the registered hostname.",
      "Check that the original page still renders and its links and forms work.",
      "Confirm exactly one widget script loads. If it is blocked, inspect browser network and Content Security Policy errors.",
      "Return to Sites, choose View Details, then Installation. It should move from awaiting installation to live after the widget reports. The dashboard checks automatically; its status is not a substitute for testing edits.",
      "Repeat on another installed path if you installed across multiple pages.",
    ],
    cspGuidance:
      "If CSP blocks the integration, have the site administrator review the required script, API, WebSocket and style permissions. Do not remove CSP or add broad wildcard or unsafe-inline allowances merely to make the widget load.",
  },
  invite: {
    id: "invite",
    title: "5. Invite someone and test a real edit",
    steps: [
      "In the site's activation checklist, choose Invite a client.",
      "Enter their email and give them edit and publish if they should make public changes. Editing without publish permission only supports the actions their permissions allow.",
      "For someone already invited, use Resend invite rather than creating another entry.",
      "The recipient opens the editor hub at https://www.recopyfa.st/edit, enters the invited email, and verifies the emailed code themselves. They do not need to create an owner account to be an invited editor.",
      "They choose the site and test a small, agreed change. Save keeps a draft; Publish makes the saved change public.",
      "Open the clean website URL in a separate visitor session and reload it to confirm the result. Restore any temporary test copy and publish that restoration.",
    ],
    planGuidance:
      "Editing depends on the site owner's active plan and the editor's permissions. A script can still be installed while a lapsed plan prevents editing.",
  },
  troubleshooting: {
    id: "troubleshooting",
    title: "Troubleshooting",
    rows: [
      {
        symptom: "Awaiting installation",
        checks:
          "Published page rather than preview; exact hostname after redirects; script stripped by builder; network or CSP errors.",
      },
      {
        symptom: "Homepage works, another page does not",
        checks:
          "Snippet coverage on that page; a hash route (/#/…) rather than history mode; duplicate loaders.",
      },
      {
        symptom: "Visitors cannot see an edit",
        checks:
          "It was saved but not published; wrong page path; cached page; verify from a fresh visitor session.",
      },
      {
        symptom: "Invitation received, editing unavailable",
        checks:
          "Sign-in email matches invitation; permissions include needed actions; owner's plan is active.",
      },
      {
        symptom: "Site requests fail after regeneration",
        checks:
          "Replace the old snippet on every installed page with the newly generated one.",
      },
      {
        symptom: "Same script loads twice",
        checks:
          "Remove the duplicate from the page, shared layout, plugin or tag manager.",
      },
    ],
  },
  rollback: {
    id: "rollback",
    title: "Remove or roll back an installation",
    guidance:
      "Restore the previous website deployment or remove the snippet from its installation point and republish. Confirm the script no longer loads on the intended pages. Removing the snippet does not revoke editor access or delete content stored in ReCopyFast. Manage those separately in the dashboard.",
  },
};

/**
 * One runtime source feeds both the copy control and the Markdown response.
 * Keeping it here, rather than importing the design draft at runtime or
 * maintaining a second route string, makes byte-for-byte parity testable.
 */
export const AGENT_INSTALLATION_INSTRUCTIONS = `# Install ReCopyFast for a website owner

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
6. For React/Next.js, inspect hydration and navigation first. Preserve the generated data attributes in a framework script loader after hydration. History-mode routers work with the plain snippet: it follows pushState, replaceState and Back, loads each page's published copy and makes newly rendered elements editable. Hash routes (/#/route) are not supported; switch the router to history mode or give each route's elements a unique author-written data-rcf-id. Verify a full page load and an in-app navigation, then Back and return navigation. If you cannot make it reliable without a material website change, explain the concrete blocker before expanding the work.
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
- The recipient enters their own six-digit emailed sign-in code. Do not read their inbox code, mint an administrative impersonation session, or mark authentication complete without evidence.
- With the user's authorization and authenticated session, change one agreed element, save a draft, publish, verify from a separate visitor session, then restore the original and verify the restoration. If authentication or publication is unavailable, mark those exact steps untested.

## Report back

Report these fields concisely:

- Installed URL(s), exact page coverage and source/deployment revision.
- Installation location and changed files/settings.
- What was verified: script load, installation report, invitation delivery, sign-in, save, publish, visitor reload, restoration.
- What remains untested or blocked and why.
- Rollback steps and whether source merge is still pending.

Do not equate a green build, a Live badge, a sent email or a visible widget with a completed edit/save/publish test. Never charge a card, buy credits, create an account or send invitations unless the user authorized that action.
`;
