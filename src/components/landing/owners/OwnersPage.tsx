import Image from "next/image";
import Link from "next/link";
import Footer from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import InteractiveHero from "@/components/landing/InteractiveHero";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";
import { OwnerStarterPrice } from "./OwnerStarterPrice";
import styles from "./owners-page.module.css";

/**
 * /for/owners (s120): the site-owner acquisition page.
 *
 * Buyer: the "owner-champion" — a local business owner whose site someone
 * else built, who changes hours, prices or specials often, and who has either
 * WordPress admin access or a developer who still answers
 * (.omc/gtm/research/site-owner-angle-2026-10-22.md).
 *
 * EVERY CLAIM HERE IS BOUNDED BY THE CODE, NOT BY THE PITCH. Read these
 * before changing a sentence:
 * - SEO / first paint: published copy is applied in the browser after load
 *   (src/lib/docs/installation-content.ts, "Rendering at first paint";
 *   src/lib/seo/llms-txt.ts says the same to crawlers). Never promise SEO.
 * - Developer updates: an edit is matched by the element's position, or its
 *   author-written data-rcf-id; moving an element orphans its edit, and a
 *   changed source value under an unmoved element is overridden silently
 *   (public/embed/recopyfast.src.js, `computeStableElementId`). There is no
 *   reversion warning on main. Do not claim "edits survive updates" until a
 *   detector ships.
 * - Price: read from /api/pricing at view time (OwnerStarterPrice), never
 *   typed here (AGENTS.md non-negotiable 7).
 * - Money figures: "$50–150" is the typical freelance hourly rate or
 *   per-change cost for small website edits, from the research brief's cited
 *   sources (WebsiteMaintenance.com, r/webdev rate threads). The "$75" in the
 *   problem headline is owner-approved messaging (headline option 2 of the
 *   brief), an illustrative point inside that sourced range — not a measured
 *   price of ours. The sentence under it carries the sourced range; keep the
 *   two together. No other money figure is typed on this page.
 * - Approval: the owner who registers a site is its admin, which includes
 *   publish. Edit-without-publish exists only when someone else holds the
 *   account and invites the owner, and Starter includes no collaborator seats
 *   (src/lib/feature-gating/permissions.ts, canShareSite; enforced in
 *   src/app/api/sites/[siteId]/share/route.ts). Name the plan that has seats.
 *
 * Never: "take control of your website" (a ghosted owner reads "control" as
 * domain, hosting and logins, which we don't give), testimonials, customer
 * logos or counts. None exist.
 */
export default function OwnersPage() {
  return (
    <div className={styles.page} data-theme="light">
      <Header variant="editorial" />
      <main>
        <section className={styles.hero} aria-labelledby="owners-title">
          <div>
            <p className={styles.eyebrow}>For business owners</p>
            <h1 id="owners-title" className={styles.heroTitle}>
              <span>Change your hours, prices</span>{" "}
              <span>and specials yourself —</span>{" "}
              <span>without waiting on your web developer.</span>
            </h1>
            <p className={styles.lead}>
              Your developer adds one line, once. After that, the words are
              yours: click them on your own site, type, publish.
            </p>
            <div className={styles.actions}>
              <Link
                href="/try"
                {...dataFastCtaAttributes("owners_hero", "try")}
                className={styles.primaryButton}
              >
                Try it on your own site
              </Link>
              {/* Signup is a nonce document (ADR 059): a full navigation. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/signup"
                data-cta-location="owners_hero"
                {...dataFastCtaAttributes("owners_hero", "signup")}
                className={styles.secondaryButton}
              >
                Start your free trial
              </a>
              <a href="#handoff" className={styles.textLink}>
                Send this to your developer
              </a>
            </div>
          </div>
          <Image
            src="/brand/editorial/client-ownership.webp"
            alt="A small-business owner updating the wording on their own website."
            width={1100}
            height={825}
            sizes="(max-width: 1024px) 100vw, 46vw"
            priority
            className={styles.heroImage}
          />
        </section>

        <section className={styles.section} aria-labelledby="owners-problem">
          <p className={styles.eyebrow}>The problem</p>
          <h2 id="owners-problem">Stop paying $75 to fix a typo.</h2>
          <p className={styles.prose}>
            Small website edits typically cost $50–150 each when you pay your
            developer per change, so even a one-line fix costs real money, and
            it waits for their schedule. Meanwhile the old hours stay up and
            last month&apos;s special is still on the homepage.
          </p>
          <ul className={styles.ruledList}>
            <li>Waiting days for a change that takes a minute.</li>
            <li>Paying for every small edit.</li>
            <li>Afraid to touch the site in case something breaks.</li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="owners-how">
          <p className={styles.eyebrow}>How it works</p>
          <h2 id="owners-how">
            Three steps. The first one is your developer&apos;s.
          </h2>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNumber}>01</span>
              <h3>Your developer pastes one line</h3>
              <p>
                Once, into your site. We give you a ready-made message to send
                them, with the line and where it goes.
              </p>
            </li>
            <li>
              <span className={styles.stepNumber}>02</span>
              <h3>You click the text on your site</h3>
              <p>
                Open your own website, click the hours, a price or a special,
                and type the new words.
              </p>
            </li>
            <li>
              <span className={styles.stepNumber}>03</span>
              <h3>Publish</h3>
              <p>
                Visitors see the new text. Every change you publish is kept in
                your history, and you can revert one.
              </p>
            </li>
          </ol>
          <p className={styles.note}>
            <strong>Want your developer to check first?</strong> If your
            developer holds the account on the Pro plan, they can invite you to
            edit without publishing: you save drafts, they publish.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="owners-demo">
          <p className={styles.eyebrow}>Try it here</p>
          <h2 id="owners-demo">Change the words on a sample site.</h2>
          <p className={styles.prose}>
            Click a headline, a price or a paragraph in the sample site below.
            Your changes stay in this tab until you reload.
          </p>
          <div className={styles.demoFrame}>
            <InteractiveHero />
          </div>
        </section>

        <section
          className={styles.section}
          aria-labelledby="owners-what-you-can-change"
        >
          <p className={styles.eyebrow}>What you can change</p>
          <h2 id="owners-what-you-can-change">
            The words on your site. Not the site itself.
          </h2>
          <div className={styles.twoLists}>
            <div>
              <h3>You can change</h3>
              <ul>
                <li>Opening hours and holiday hours</li>
                <li>Prices, menu items and services</li>
                <li>Specials, offers and announcements</li>
                <li>Headings, paragraphs and button labels</li>
                <li>An existing photo, swapped for a new one in its place</li>
              </ul>
            </div>
            <div>
              <h3>You can&apos;t change</h3>
              <ul>
                <li>The layout, colours or fonts</li>
                <li>New pages, new sections or new images</li>
                <li>Links, unless your developer opens one up</li>
                <li>Forms, checkout, payments or code</li>
              </ul>
            </div>
          </div>
          <p className={styles.prose}>
            That&apos;s on purpose: you can&apos;t break the design, and bigger
            changes stay with your developer, who now only hears from you for
            the work that needs them.
          </p>
        </section>

        <section
          id="handoff"
          className={styles.section}
          aria-labelledby="owners-handoff"
        >
          <p className={styles.eyebrow}>The handoff</p>
          <h2 id="owners-handoff">Send this to your developer.</h2>
          <p className={styles.prose}>
            When you add your site, choose &ldquo;My developer will&rdquo;. You
            get a ready-to-send email with your site&apos;s line, where to paste
            it on WordPress, Webflow, Framer or a custom site, and a short
            security note. You send it from your own email; we send nothing.
          </p>
          <p className={styles.prose}>
            Nobody shares a password. Your developer pastes the line; you sign
            in to ReCopyFast with your own email address.
          </p>
          <div className={styles.actions}>
            <Link
              href="/docs/install/for-developers"
              {...dataFastCtaAttributes("owners_handoff", "docs")}
              className={styles.secondaryButton}
            >
              See what your developer gets
            </Link>
            <Link
              href="/docs/install/wordpress"
              {...dataFastCtaAttributes("owners_handoff", "docs")}
              className={styles.textLink}
            >
              Have WordPress admin? Do it yourself
            </Link>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="owners-platforms">
          <p className={styles.eyebrow}>Will it work on my site?</p>
          <h2 id="owners-platforms">Built by someone else? Probably.</h2>
          <div className={styles.platforms}>
            <div>
              <h3>WordPress</h3>
              <p>
                Yes, including Elementor and Divi. With admin access you can add
                the line yourself with the free WPCode plugin.
              </p>
            </div>
            <div>
              <h3>Webflow and Framer</h3>
              <p>
                Yes. Your designer adds the line in the site&apos;s custom code
                settings, which can need a paid plan on those platforms.
              </p>
            </div>
            <div>
              <h3>Custom-built or static sites</h3>
              <p>
                Yes, including sites built with AI tools. Whoever publishes the
                site pastes the line once.
              </p>
            </div>
            <div>
              <h3>Squarespace, Wix and Shopify</h3>
              <p>
                These come with their own editors. If you can log in and the
                editor feels comfortable, you may not need us. ReCopyFast helps
                when someone else built and runs the site, or the built-in
                editor is locked or daunting. Adding the line there can need a
                higher plan (for example Squarespace Core or a paid Wix plan
                with a connected domain).
              </p>
            </div>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.sectionNarrow}`}
          aria-labelledby="owners-faq"
        >
          <p className={styles.eyebrow}>Questions</p>
          <h2 id="owners-faq">The honest answers.</h2>
          <div className={styles.faq}>
            <div>
              <h3>Is it safe to add a script to my site?</h3>
              <p>
                The script reads the text on your pages and swaps in the words
                you publish. It can&apos;t change your layout, code, payments or
                forms, and links stay locked unless your developer opens one up.
                The line contains a site token that is public by design and only
                works on your domain. You never give anyone your website login
                or admin password, and we never ask for it.
              </p>
            </div>
            <div>
              <h3>Can I break my website?</h3>
              <p>
                You can only change existing words and swap existing photos. The
                design and code stay as your developer built them. Every change
                you publish is saved in your history, and you can revert one
                from your dashboard.
              </p>
            </div>
            <div>
              <h3>What about Google and SEO?</h3>
              <p>
                Your changes are applied in the visitor&apos;s browser just
                after the page loads, so the original text can show for a moment
                first. Google can run JavaScript when it indexes pages, but many
                other crawlers and AI tools read only the page&apos;s original
                text. So use ReCopyFast for what changes often (hours, prices,
                specials), ask your developer to keep your main headline and key
                search text in the site itself, and keep your Google Business
                Profile hours up to date too. We don&apos;t promise any SEO
                benefit.
              </p>
            </div>
            <div>
              <h3>What happens when my developer updates the site?</h3>
              <p>
                If the text stays in the same place on the page, your published
                words keep showing after their update, even if they changed that
                same text. If they move things around or redesign the page, some
                of your changes can stop showing and the original text comes
                back.{" "}
                {/* Update when s119 source-drift detection (PR #119) ships. */}
                We don&apos;t warn you about that yet. Every change you publish
                stays in your history, so you or your developer can see it and
                publish it again, and developers can tag the text you edit most
                so it keeps matching after a redesign.
              </p>
            </div>
            <div>
              <h3>How much does it cost compared with paying per change?</h3>
              <OwnerStarterPrice />
              <p>
                For comparison, small website edits typically cost $50–150 each
                when you pay your developer per change.
              </p>
            </div>
            <div>
              <h3>Will my developer mind?</h3>
              <p>
                It&apos;s text only: their code and design stay theirs, and they
                stop getting asked to change &ldquo;5pm&rdquo; to
                &ldquo;6pm&rdquo;. Bigger changes still go to them. Our{" "}
                <Link href="/docs/install/for-developers">developer guide</Link>{" "}
                answers their technical questions.
              </p>
            </div>
            <div>
              <h3>My developer disappeared and I don&apos;t have access.</h3>
              <p>
                Then we can&apos;t help yet, honestly: someone has to be able to
                add the line to your site once. Getting your domain, hosting and
                logins into your own name comes first.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="owners-final">
          <p className={styles.eyebrow}>Your words, your timing</p>
          <h2 id="owners-final">
            Your hours change. Your website should keep up.
          </h2>
          <p className={styles.prose}>
            See your own site editable in one click, without installing
            anything. Nothing is installed or saved.
          </p>
          <div className={styles.actions}>
            <Link
              href="/try"
              {...dataFastCtaAttributes("owners_final", "try")}
              className={styles.primaryButton}
            >
              Try it on your own site
            </Link>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/signup"
              data-cta-location="owners_final"
              {...dataFastCtaAttributes("owners_final", "signup")}
              className={styles.secondaryButton}
            >
              Start your free trial
            </a>
          </div>
        </section>
      </main>
      <Footer variant="editorial" />
    </div>
  );
}
