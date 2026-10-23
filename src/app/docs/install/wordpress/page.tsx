import type { Metadata } from "next";
import Link from "next/link";
import { DocsPageShell, DocsSection } from "@/components/docs/DocsPageShell";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";

const PATH = "/docs/install/wordpress";
const TITLE = "Add ReCopyFast to WordPress with WPCode";
const DESCRIPTION =
  "Step by step: paste your ReCopyFast snippet into a WordPress site with the free WPCode plugin, check it works, clear your cache, and what not to do.";

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

const LINK_CLASS_NAME =
  "font-medium text-primary underline-offset-4 hover:underline";

/*
 * WPCode's labels were read from its own documentation on 2026-10-22
 * (wpcode.com: "How To Insert Scripts In WordPress" and "A Complete Guide to
 * Snippet Locations"): Code Snippets > Header & Footer > Save Changes, and
 * Add Snippet > Add Your Custom Code (New Snippet) > Use snippet, Code Type,
 * Auto Insert, Location "Site Wide Footer", the Active switch, Save Snippet.
 * Plugins rename menus; when a label here stops matching, fix it from their
 * docs rather than from memory.
 */
export default function WordPressGuidePage() {
  return (
    <DocsPageShell
      eyebrow="WordPress"
      title={TITLE}
      introduction={
        <>
          <p>
            About five minutes, using the free WPCode plugin. You don&apos;t
            edit any theme file, and the line survives theme updates.
          </p>
          <p className="text-base">
            You need to be an Administrator on the WordPress site. On
            WordPress.com, your plan must allow plugins. Not you? Send your
            developer the message from your dashboard instead, or the{" "}
            <Link
              href="/docs/install/for-developers"
              className={LINK_CLASS_NAME}
            >
              developer guide
            </Link>
            .
          </p>
        </>
      }
    >
      <DocsSection id="before" title="1. Copy your snippet">
        <ol>
          <li>Sign in to ReCopyFast and open Sites.</li>
          <li>Choose your site, then Install.</li>
          <li>
            Select Copy snippet. Use your own site&apos;s snippet: the example
            in the guides is not a working install.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="install-wpcode" title="2. Install WPCode">
        <ol>
          <li>In WordPress admin, go to Plugins &gt; Add New Plugin.</li>
          <li>
            Search for &ldquo;WPCode&rdquo; (shown as WPCode, Insert Headers and
            Footers + Custom Code Snippets), then Install Now and Activate.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="paste" title="3. Paste the snippet">
        <p>
          <strong>The simple way: Header &amp; Footer.</strong>
        </p>
        <ol>
          <li>Go to Code Snippets &gt; Header &amp; Footer.</li>
          <li>
            Paste the snippet into the <strong>Footer</strong> box. The Header
            box works too; the Footer box loads it after the rest of your page.
          </li>
          <li>Select Save Changes.</li>
        </ol>
        <p>
          <strong>Or as a snippet you can switch on and off.</strong>
        </p>
        <ol>
          <li>
            Go to Code Snippets &gt; Add Snippet, then Add Your Custom Code (New
            Snippet) &gt; Use snippet.
          </li>
          <li>
            Set Code Type to <strong>HTML Snippet</strong> and paste the
            snippet.
          </li>
          <li>
            Under Insertion, keep Auto Insert and choose the location{" "}
            <strong>Site Wide Footer</strong>.
          </li>
          <li>Switch the snippet to Active, then select Save Snippet.</li>
        </ol>
        <p>Use one of the two, not both: the line should load once per page.</p>
      </DocsSection>

      <DocsSection id="verify" title="4. Check it works">
        <ol>
          <li>
            Open your site in a private browser window (so you see it as a
            visitor).
          </li>
          <li>
            Back in ReCopyFast, open your site&apos;s Install page. It changes
            from &ldquo;Awaiting install&rdquo; to &ldquo;Live&rdquo; within
            about 10 seconds of that visit.
          </li>
          <li>
            Still waiting? Clear your cache (next step) and visit the site
            again.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="cache" title="5. Clear your cache">
        <p>
          Caching plugins can keep serving the old page, without the line, for
          hours. After saving, clear the cache:
        </p>
        <ul>
          <li>
            WP Rocket, LiteSpeed Cache, W3 Total Cache and similar plugins: use
            the plugin&apos;s clear or purge all caches option, usually in the
            top admin bar.
          </li>
          <li>Your host or CDN (for example Cloudflare) may have its own.</li>
        </ul>
        <p>
          If your caching plugin combines, minifies or delays JavaScript and the
          site stays &ldquo;Awaiting install&rdquo;, exclude{" "}
          <code>recopyfast.js</code> from those options.
        </p>
      </DocsSection>

      <DocsSection
        id="page-builders"
        title="Elementor, Divi and other page builders"
      >
        <p>
          They work as they are. ReCopyFast edits the text your visitors see on
          the finished page, so you can change your hours or prices without
          opening the builder. Your layout stays exactly as it was built.
        </p>
        <p>
          If someone later changes the same text in the builder, the text
          published in ReCopyFast still shows. If a block is moved or rebuilt,
          its ReCopyFast text can stop showing there; every change stays in your
          ReCopyFast history so you can apply it again.
        </p>
      </DocsSection>

      <DocsSection id="dont" title="What not to do">
        <ul>
          <li>
            Don&apos;t paste it into your theme files (such as footer.php): a
            theme update can remove it.
          </li>
          <li>
            Don&apos;t paste it into a text or paragraph block on a page: it
            shows as text instead of running.
          </li>
          <li>
            Don&apos;t add it twice (WPCode plus another plugin or a tag
            manager).
          </li>
          <li>
            Don&apos;t select Regenerate snippet just to copy it: that switches
            off the old one wherever it is installed.
          </li>
          <li>
            Never give anyone your WordPress password to do this. ReCopyFast
            never asks for it.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="remove" title="Removing it">
        <p>
          Delete the line from Header &amp; Footer (or deactivate the snippet),
          save, and clear your cache. Your site shows its own text again.
        </p>
      </DocsSection>

      <p className="border-t border-border pt-8 text-sm text-muted-foreground">
        No account yet? {/* Signup is a nonce document (ADR 059). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/signup"
          {...dataFastCtaAttributes("wp_guide", "signup")}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Start free
        </a>
        , register your site and copy its snippet. All platforms:{" "}
        <Link href="/docs/install" className={LINK_CLASS_NAME}>
          installation guide
        </Link>
        .
      </p>
    </DocsPageShell>
  );
}
