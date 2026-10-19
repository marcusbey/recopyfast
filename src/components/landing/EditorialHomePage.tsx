"use client";

import Image from "next/image";
import Footer from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import Pricing from "@/components/sections/Pricing";
import {
  toFoundingOfferView,
  useFoundingOffer,
} from "@/hooks/useFoundingOffer";
import EditableEditorialHero from "./EditableEditorialHero";
import InteractiveHero from "./InteractiveHero";
import ProductTour from "./ProductTour";
import styles from "./editorial-homepage.module.css";

export default function EditorialHomePage() {
  const offer = toFoundingOfferView(useFoundingOffer());

  return (
    <div className={styles.page} data-theme="light">
      <Header variant="editorial" />
      <main>
        <EditableEditorialHero />

        <ProductTour />

        <section className={styles.realDemo} data-testid="real-demo-section">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>See it. Then try it.</p>
            <h2>The real editing experience is right here.</h2>
            <p>
              Click a headline, price or paragraph inside the site below. Your
              changes stay in this browser demo.
            </p>
          </div>
          <div className={styles.demoFrame}>
            <InteractiveHero />
          </div>
        </section>

        <section className={`${styles.storySection} ${styles.twoColumn}`}>
          <div>
            <p className={styles.eyebrow}>01 / The interruption loop</p>
            <h2>Every “small change” comes with a whole conversation.</h2>
            <p>
              The message. The clarification. Finding the right page. Making the
              edit. Sending it back. One sentence still becomes another task in
              your day.
            </p>
            <ul className={styles.requestList}>
              <li>“Can you change our opening hours?”</li>
              <li>“That price is out of date.”</li>
              <li>“We need to say this differently.”</li>
            </ul>
          </div>
          <Image
            src="/brand/editorial/request-backlog.webp"
            alt="Recurring client requests looping around a freelancer’s workspace."
            width={1100}
            height={825}
            sizes="(max-width: 800px) 100vw, 48vw"
          />
        </section>

        <section
          id="features"
          className={`${styles.storySection} ${styles.twoColumn} ${styles.reverseOnMobile}`}
        >
          <Image
            src="/brand/editorial/client-ownership.webp"
            alt="A small-business owner taking charge of everyday website wording."
            width={1100}
            height={825}
            sizes="(max-width: 800px) 100vw, 48vw"
          />
          <div>
            <p className={styles.eyebrow}>02 / A different handoff</p>
            <h2>Hand over the words. Keep the design.</h2>
            <p>
              Your client knows when the hours, offer or message changes.
              ReCopyFast gives them a way to edit copy in place while new
              layouts, sections and features stay in your design scope.
            </p>
            <div className={styles.steps}>
              <p>
                <span>01</span>Add ReCopyFast to the site you already built.
              </p>
              <p>
                <span>02</span>Invite the people who own the everyday copy.
              </p>
              <p>
                <span>03</span>Keep bigger changes inside a clear new scope.
              </p>
            </div>
          </div>
        </section>

        <section className={`${styles.storySection} ${styles.twoColumn}`}>
          <div>
            <p className={styles.eyebrow}>03 / Your work again</p>
            <h2>Your next task could be actual design work.</h2>
            <p>
              A new layout. A better concept. The project you were halfway
              through before the request arrived. Let the people who own the
              words take care of the words.
            </p>
          </div>
          <Image
            src="/brand/editorial/designer-focus.webp"
            alt="A designer concentrating on creative layouts at an uncluttered desk."
            width={1100}
            height={825}
            sizes="(max-width: 800px) 100vw, 48vw"
          />
        </section>

        <div className={styles.pricingFrame}>
          <Pricing offer={offer} variant="editorial" />
        </div>

        <section className={styles.finalCta}>
          <Image
            src="/brand/editorial/closing-focus.webp"
            alt=""
            fill
            sizes="100vw"
          />
          <div>
            <p className={styles.eyebrow}>Make room for what matters</p>
            <h2>Your client needs a way to make the next quick change.</h2>
            <p>
              Let clients edit the words. Keep your time for the work that
              matters.
            </p>
            {/* Establish signup as a fresh nonce document (ADR 059). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/signup"
              data-cta-location="editorial_final"
              className={styles.primaryButton}
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
