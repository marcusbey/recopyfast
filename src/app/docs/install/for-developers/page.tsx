import type { Metadata } from "next";
import Link from "next/link";
import { DocsPageShell, DocsSection } from "@/components/docs/DocsPageShell";
import {
  INSTALLATION_EXAMPLE,
  INSTALLATION_GUIDE,
} from "@/lib/docs/installation-content";
import { DEVELOPER_GUIDE_CSP_LINES } from "@/lib/docs/developer-guide-content";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";

const PATH = "/docs/install/for-developers";
const TITLE = "ReCopyFast for developers";
const DESCRIPTION =
  "Your client asked you to add ReCopyFast. What the one-line script does, the CSP it needs, how to verify and remove it, and how your client's edits behave when you deploy.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    type: "article",
    url: PATH,
    siteName: "ReCopyFast",
    title: `${TITLE} | ReCopyFast`,
    description: DESCRIPTION,
    locale: "en_US",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | ReCopyFast`,
    description: DESCRIPTION,
    images: ["/twitter-image"],
  },
};

/** The origin the example snippet loads from (see developer-guide-content). */
const APP_ORIGIN = INSTALLATION_EXAMPLE.appUrl;

const CODE_BLOCK_CLASS_NAME =
  "overflow-x-auto rounded-container border border-border bg-surface-2 p-4 font-mono text-sm leading-relaxed text-foreground";

export default function DeveloperGuidePage() {
  return (
    <DocsPageShell
      eyebrow="For the developer"
      title={TITLE}
      introduction={
        <>
          <p>
            Your client wants to change their own hours, prices and specials
            without asking you each time. ReCopyFast is one script tag you add
            once. After that they click existing text on the live site, edit it
            and publish. Your code, layout and design stay yours.
          </p>
          <p className="text-base">
            Five minutes, no account needed on your side, and no password
            changes hands.
          </p>
        </>
      }
    >
      <DocsSection id="what-it-does" title="What the script does">
        <ul>
          <li>
            On each page view it loads the copy your client has published for
            that page and applies it to the matching elements after the page
            loads. Nothing in your source or your repository changes.
          </li>
          <li>
            It finds headings, paragraphs, list items, table cells, labels,
            buttons and images on its own. Links are skipped unless you opt one
            in with <code>class=&quot;rcf-editable-link&quot;</code>, so nobody
            can rewrite your navigation by accident.
          </li>
          <li>
            Opt an element out with <code>data-rcf-ignore</code>, opt a
            container in with <code>data-rcf-content</code>, and give an element
            a stable identity with <code>data-rcf-id</code> (see &ldquo;When you
            deploy&rdquo; below).
          </li>
          <li>
            The editing interface only appears for someone signed in as an
            editor of the site. Visitors only ever see the published text.
          </li>
          <li>
            It fails quietly: if it cannot load or is blocked, the page keeps
            its own HTML.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="snippet" title="The snippet">
        <p>
          Your client sends you the exact tag from their dashboard. It looks
          like this (placeholders here, not a working install):
        </p>
        <pre className={CODE_BLOCK_CLASS_NAME}>
          <code data-testid="developer-guide-example">
            {INSTALLATION_EXAMPLE.displaySnippet}
          </code>
        </pre>
        <ul>
          {INSTALLATION_GUIDE.copySnippet.snippetParts.map((part) => (
            <li key={part.attribute}>
              <code>{part.attribute}</code>: {part.purpose}
            </li>
          ))}
        </ul>
        <p>
          The site token is public by design: it sits in the page HTML and is
          only accepted from the registered domain. Your client can revoke it by
          regenerating the snippet in their dashboard, after which the tag must
          be replaced. Never substitute any other key or token into it.
        </p>
      </DocsSection>

      <DocsSection id="where" title="Where to paste it">
        <p>
          One copy per page, ideally in the shared footer just before{" "}
          <code>&lt;/body&gt;</code>, then publish or deploy. Do not add it a
          second time through a tag manager.
        </p>
        <ul>
          <li>
            WordPress: the free WPCode plugin, see the{" "}
            <Link
              href="/docs/install/wordpress"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              WordPress guide
            </Link>
            .
          </li>
          <li>
            Webflow, Framer and other builders: their site-wide custom code
            setting (end of <code>&lt;body&gt;</code>), then publish. Some
            builders only allow custom code on paid plans.
          </li>
          <li>
            React, Next.js and other single-page apps: load it after hydration
            and keep every attribute. History-mode routing is followed; hash
            routes are not supported. Details in the{" "}
            <Link
              href="/docs/install#add-snippet"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              installation guide
            </Link>
            .
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="csp" title="Content Security Policy">
        <p>If the site sends a CSP, the snippet needs these two sources:</p>
        <pre className={CODE_BLOCK_CLASS_NAME}>
          <code data-testid="developer-guide-csp">
            {DEVELOPER_GUIDE_CSP_LINES.join("\n")}
          </code>
        </pre>
        <ul>
          <li>
            Add them to your existing directives (or to <code>default-src</code>
            &apos;s sources, if that is the fallback) rather than replacing what
            the site already allows.
          </li>
          <li>
            The realtime connection is optional: without the websocket source
            the widget falls back to plain HTTP requests.
          </li>
          <li>
            The editing interface adds its own <code>&lt;style&gt;</code>{" "}
            elements while someone edits, and a swapped image loads from the URL
            it was uploaded to. If either is blocked, report the exact directive
            from the browser console rather than adding a broad{" "}
            <code>&apos;unsafe-inline&apos;</code> or wildcard.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="verify" title="Verify the install">
        <ol>
          <li>Open the published page on the registered domain.</li>
          <li>
            Check that exactly one <code>recopyfast.js</code> loads and that the
            page, its links and its forms still work.
          </li>
          <li>
            In the console, <code>window.RECOPYFAST_API</code> should be{" "}
            <code>{APP_ORIGIN}/api</code>.
          </li>
          <li>
            Your client&apos;s dashboard flips the site from &ldquo;Awaiting
            install&rdquo; to &ldquo;Live&rdquo; within about 10 seconds of that
            page view. A reply of &ldquo;done&rdquo; is enough for them to
            check.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="editing" title="How editing works for your client">
        <ol>
          <li>
            They open their site through &ldquo;Edit website&rdquo; in their
            dashboard, or through the editor sign-in with a code emailed to
            them. No shared login.
          </li>
          <li>They click a piece of text and type.</li>
          <li>
            Save keeps a draft. Publish makes it public. Every change is kept in
            their history, and they can revert one.
          </li>
        </ol>
        <p>
          <strong>Want to approve changes first?</strong> If you hold the
          ReCopyFast account, invite your client as an editor with edit but
          without publish permission: their saves stay drafts until you publish
          them. Inviting editors depends on the account&apos;s plan.
        </p>
      </DocsSection>

      <DocsSection id="deploys" title="When you deploy">
        <p>
          Published copy is matched to elements by their position in the page,
          or by <code>data-rcf-id</code> when an element has one. Today that
          means:
        </p>
        <ul>
          <li>
            If the element stays where it is, your client&apos;s published text
            keeps showing after your deploy, even if you changed that same text
            in source. Their edit wins.
          </li>
          {/* Update when s119 source-drift detection (PR #119) ships. */}
          <li>
            If you move or restructure the element, its published text no longer
            matches and the page shows your source text again. There is no
            warning for this yet. Your client&apos;s history still has every
            change, so either of you can re-apply it.
          </li>
          <li>
            For copy your client edits often (hours, prices), add an
            author-written <code>data-rcf-id</code> to keep its identity across
            redesigns.
          </li>
        </ul>
        <p>
          Published copy is applied after the page loads, so the original HTML
          can show briefly, and crawlers that do not run JavaScript read the
          original. Keep SEO-critical headings in source.
        </p>
      </DocsSection>

      <DocsSection id="remove" title="Remove it">
        <p>{INSTALLATION_GUIDE.rollback.guidance}</p>
      </DocsSection>

      <p className="border-t border-border pt-8 text-sm text-muted-foreground">
        Installing it for your own clients?{" "}
        {/* Signup is a nonce document (ADR 059). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/signup"
          {...dataFastCtaAttributes("dev_guide", "signup")}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Start your free trial
        </a>{" "}
        and register their site yourself. Questions:{" "}
        <a
          href="mailto:support@recopyfa.st"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          support@recopyfa.st
        </a>
        .
      </p>
    </DocsPageShell>
  );
}
