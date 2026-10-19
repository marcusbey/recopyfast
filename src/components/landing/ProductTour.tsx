"use client";

import Image from "next/image";
import { type KeyboardEvent, useRef, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import styles from "./editorial-homepage.module.css";

const CHAPTERS = [
  {
    title: "Add your website",
    caption: "Register the site and copy its generated snippet.",
    benefit: "Start with the website you already have.",
    image: "/brand/product-tour/01-register.webp",
    alt: "Site registered screen with the generated installation snippet for Bella Vista.",
  },
  {
    title: "Install once",
    caption:
      "Add the snippet to the pages you want to edit, then confirm the site is detected.",
    benefit: "Initial setup connects the pages you choose.",
    image: "/brand/product-tour/02-install.webp",
    alt: "Installation instructions and detection status for the example website.",
  },
  {
    title: "Make the next change",
    caption:
      "Open the website editor, update the opening hours and save the draft.",
    benefit: "Routine copy updates reuse the installed script.",
    image: "/brand/product-tour/03-edit.webp",
    alt: "Opening hours being edited on the example restaurant website.",
  },
  {
    title: "Publish and revisit",
    caption:
      "Publish when ready, then reload the website as a visitor to confirm the update.",
    benefit: "Visitors see the approved hours after publication.",
    image: "/brand/product-tour/04-publish.webp",
    alt: "Published opening hours visible on the example website.",
  },
  {
    title: "Find recent changes",
    caption:
      "Filter by site and status to find what is waiting and what is live.",
    benefit: "Draft and published work stay easy to distinguish.",
    image: "/brand/product-tour/05-changes.webp",
    alt: "Changes list filtered to the example restaurant update.",
  },
  {
    title: "See exactly what changed",
    caption:
      "Compare the original and live copy, then review the dated change history.",
    benefit: "Site admins can review who changed the copy and when.",
    image: "/brand/product-tour/06-history.webp",
    alt: "Dated change history for the example restaurant opening hours.",
  },
] as const;

export default function ProductTour() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chapter = CHAPTERS[selectedIndex];
  const hasImageError = failedImages.has(chapter.image);

  const selectAndFocus = (index: number) => {
    setSelectedIndex(index);
    tabRefs.current[index]?.focus();
  };

  const handleChapterKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % CHAPTERS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + CHAPTERS.length) % CHAPTERS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = CHAPTERS.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    selectAndFocus(nextIndex);
  };

  const markImageFailed = () => {
    setFailedImages((current) => {
      const next = new Set(current);
      next.add(chapter.image);
      return next;
    });
  };

  return (
    <section id="product-tour" className={styles.productTour}>
      <div className={styles.productTourIntro}>
        <div>
          <p className={styles.eyebrow}>Example walkthrough</p>
          <h2>From one script to your next update.</h2>
        </div>
        <p>
          One restaurant website. One opening-hours change. Follow it from setup
          to history.
        </p>
      </div>

      <div className={styles.productTourLayout}>
        <div
          className={styles.productTourChapters}
          role="tablist"
          aria-label="Walkthrough chapters"
          aria-orientation="vertical"
        >
          {CHAPTERS.map((item, index) => (
            <button
              key={item.image}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`product-tour-tab-${index + 1}`}
              type="button"
              role="tab"
              aria-controls="product-tour-panel"
              aria-selected={selectedIndex === index}
              tabIndex={selectedIndex === index ? 0 : -1}
              className={styles.productTourChapter}
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => handleChapterKeyDown(event, index)}
            >
              <span className={styles.productTourChapterIndex}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{item.title}</span>
            </button>
          ))}
        </div>

        <div
          id="product-tour-panel"
          className={styles.productTourPanel}
          role="tabpanel"
          aria-labelledby="product-tour-chapter-title"
          tabIndex={0}
        >
          <p className={styles.productTourCount}>
            Chapter {selectedIndex + 1} of {CHAPTERS.length}
          </p>
          <h3 id="product-tour-chapter-title">{chapter.title}</h3>

          <figure className={styles.productTourMedia}>
            <div className={styles.productTourImageFrame}>
              {hasImageError ? (
                <div
                  className={styles.productTourImageError}
                  role="status"
                  aria-label="Screenshot unavailable"
                >
                  <strong>Screenshot unavailable</strong>
                  <span>
                    This screenshot could not load. The chapter notes and
                    controls are still available.
                  </span>
                </div>
              ) : (
                <Image
                  key={chapter.image}
                  className={styles.productTourImage}
                  src={chapter.image}
                  alt={chapter.alt}
                  width={1440}
                  height={900}
                  sizes="(max-width: 1024px) 88vw, 70vw"
                  loading={selectedIndex === 0 ? "eager" : "lazy"}
                  onError={markImageFailed}
                />
              )}
            </div>
            <figcaption>{chapter.caption}</figcaption>
          </figure>

          <p className={styles.productTourBenefit}>
            <strong>Why it matters</strong>
            <span>{chapter.benefit}</span>
          </p>

          <div className={styles.productTourControls}>
            <button
              type="button"
              className={styles.productTourControl}
              disabled={selectedIndex === 0}
              onClick={() => setSelectedIndex((current) => current - 1)}
              aria-label="Previous chapter"
            >
              ← Previous
            </button>
            <button
              type="button"
              className={styles.productTourControl}
              disabled={selectedIndex === CHAPTERS.length - 1}
              onClick={() => setSelectedIndex((current) => current + 1)}
              aria-label="Next chapter"
            >
              Next →
            </button>

            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className={`${styles.productTourControl} ${styles.productTourExpand}`}
                  disabled={hasImageError}
                >
                  View full screenshot
                </button>
              </DialogTrigger>
              <DialogContent className={styles.productTourDialog}>
                <DialogHeader className={styles.productTourDialogHeader}>
                  <DialogTitle>{chapter.title} — full screenshot</DialogTitle>
                  <DialogDescription>{chapter.caption}</DialogDescription>
                </DialogHeader>
                <DialogBody className={styles.productTourDialogBody}>
                  <p className={styles.productTourDialogHint}>
                    Scroll to inspect the full-size screen.
                  </p>
                  <Image
                    className={styles.productTourDialogImage}
                    src={chapter.image}
                    alt={chapter.alt}
                    width={1440}
                    height={900}
                    sizes="(max-width: 1024px) 1440px, calc(100vw - 64px)"
                    onError={markImageFailed}
                  />
                </DialogBody>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </section>
  );
}
