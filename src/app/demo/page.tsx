"use client";

import {
  ArrowRight,
  MousePointerClick,
  Type,
  Image as ImageIcon,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import InteractiveHero from "@/components/landing/InteractiveHero";
import styles from "@/components/marketing/editorial-content.module.css";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";

/**
 * The demo page.
 *
 * REBUILT, and worth recording why rather than leaving it looking like a
 * restyle. The previous version mounted `ReCopyFastLoader`, which redirected the
 * page into staging mode carrying a hard-coded token —
 * `test_staging_token_valid_123` — against a site id that exists in no database.
 * The widget then did exactly the right thing with a token it cannot find: it
 * refused. Every visitor to /demo was met with "Access Denied — Invalid or
 * expired staging link". The page could not have worked in production, because
 * the credential it authenticated with was a test fixture.
 *
 * It now runs the same `InteractiveHero` the landing page uses. That engine
 * keeps its edits in React state and needs no site, no token and no backend, so
 * there is nothing left that can expire — which is the right shape for a public
 * demo nobody has signed in to. It also means the demo can no longer drift from
 * the one on the landing page, because there is only one of them.
 */

const AFFORDANCES = [
  {
    icon: MousePointerClick,
    title: "Click anything",
    body: "Every headline, paragraph, price and button is editable. There is no edit mode to switch on first.",
  },
  {
    icon: Type,
    title: "Type over it",
    body: "Text edits in place, in the site's own typography. What you see while typing is what the page renders.",
  },
  {
    icon: ImageIcon,
    title: "Swap the photographs",
    body: "Hover any image and shuffle it. The layout holds — replacing a photo cannot break the design around it.",
  },
] as const;

export default function Demo() {
  return (
    <div className={styles.page}>
      <Header variant="editorial" />

      <main className={styles.main}>
        <section className={`${styles.frame} ${styles.intro}`}>
          <p className={styles.eyebrow}>Interactive demo</p>
          <h1 className={styles.displayTitle}>
            Edit a real website, right here
          </h1>
          <p className={styles.lede}>
            Three sample sites, three different styles. Change any word or
            photograph and see the page respond in place. Nothing to install,
            and no account required.
          </p>
          <p className={styles.steps}>
            <span>01 Click</span>
            <span>02 Type</span>
            <span>03 Swap an image</span>
          </p>
        </section>

        {/* The demo itself, on solid white and out of the article measure: these
            are meant to read as whole websites, and boxing them into a text
            column is what stops them doing that. */}
        <section className={styles.demoSection}>
          <div className={styles.demoFrame}>
            <InteractiveHero tracksDemoEdit />
          </div>
        </section>

        <section className={`${styles.frame} ${styles.featureGrid}`}>
          {AFFORDANCES.map(({ icon: Icon, title, body }, index) => (
            <div key={title} className={styles.feature}>
              <span className={styles.featureNumber}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <Icon
                className="mt-5 h-5 w-5 text-[#287f7c]"
                aria-hidden="true"
              />
              <h2 className={styles.featureTitle}>{title}</h2>
              <p className={styles.featureBody}>{body}</p>
            </div>
          ))}
        </section>

        <section className={`${styles.frame} ${styles.closeSection}`}>
          <h2 className={styles.closeTitle}>That is the whole product</h2>
          <p className={styles.closeBody}>
            One script tag on your site turns it into the page you just edited.
            Your developers keep the codebase; everyone else stops queueing for
            copy changes.
          </p>
          {/* Static demo -> nonce signup document (ADR 059). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/signup"
            data-cta-location="demo"
            {...dataFastCtaAttributes("demo", "signup")}
            className={`${styles.primaryAction} pressable group gap-2`}
          >
            <span>Add it to your site</span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </a>
        </section>
      </main>

      <Footer variant="editorial" />
    </div>
  );
}
