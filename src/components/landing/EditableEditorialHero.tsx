"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CompositionEvent as ReactCompositionEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import styles from "./editorial-homepage.module.css";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";

const START_DELAY_MS = 1_400;
const MAX_EDIT_LENGTH = 120;

function placeCaretAfter(node: Node) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * The homepage demonstrates the product promise without pretending that this
 * local edit is a published ReCopyFast change. The DOM is intentionally the
 * only store: a reload restores authored copy, and no visitor-written text is
 * allowed onto the analytics or network paths.
 */
export default function EditableEditorialHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<SVGSVGElement>(null);
  const siteRef = useRef<HTMLSpanElement>(null);
  const stuckRef = useRef<HTMLSpanElement>(null);
  const runRef = useRef(0);
  const timersRef = useRef<Set<number>>(new Set());
  const animationsRef = useRef<Set<Animation>>(new Set());
  const automaticEditRef = useRef<{
    target: HTMLElement;
    original: string;
    replacement: string;
  } | null>(null);
  const composingElementsRef = useRef<WeakSet<HTMLElement>>(new WeakSet());

  const cancelSequence = () => {
    runRef.current += 1;
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    animationsRef.current.forEach((animation) => animation.cancel());
    animationsRef.current.clear();
    const automaticEdit = automaticEditRef.current;
    if (
      automaticEdit &&
      automaticEdit.target.isConnected &&
      automaticEdit.target.textContent !== automaticEdit.original &&
      automaticEdit.target.textContent !== automaticEdit.replacement
    ) {
      // An interrupted typewriter must never leave "webs" or "do" in the
      // authored headline. This happens before the visitor's pointer/key event
      // edits the DOM, so their text remains entirely under their control.
      automaticEdit.target.textContent = automaticEdit.replacement;
    }
    automaticEditRef.current = null;
    cursorRef.current?.classList.remove(
      styles.cursorVisible,
      styles.cursorClick,
    );
    siteRef.current?.classList.remove(
      styles.wordHovered,
      styles.wordEditing,
      styles.wordSelected,
      styles.wordTyping,
    );
    stuckRef.current?.classList.remove(
      styles.wordHovered,
      styles.wordEditing,
      styles.wordSelected,
      styles.wordTyping,
    );
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;

    let isDisposed = false;
    const token = runRef.current;

    const wait = (duration: number) =>
      new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(timer);
          resolve(!isDisposed && token === runRef.current);
        }, duration);
        timersRef.current.add(timer);
      });

    const moveCursor = async (target: HTMLElement, bend: number) => {
      const container = containerRef.current;
      const cursor = cursorRef.current;
      if (!container || !cursor || isDisposed || token !== runRef.current) {
        return false;
      }

      const outer = container.getBoundingClientRect();
      const destination = target.getBoundingClientRect();
      const currentLeft = Number.parseFloat(cursor.style.left || "0");
      const currentTop = Number.parseFloat(cursor.style.top || "0");
      const targetLeft =
        destination.left - outer.left + destination.width * 0.48;
      const targetTop = destination.top - outer.top + destination.height * 0.62;
      cursor.classList.add(styles.cursorVisible);

      if (typeof cursor.animate !== "function") {
        cursor.style.left = `${targetLeft}px`;
        cursor.style.top = `${targetTop}px`;
        return wait(2_300);
      }

      const animation = cursor.animate(
        [
          { left: `${currentLeft}px`, top: `${currentTop}px` },
          {
            left: `${(currentLeft + targetLeft) / 2 + bend}px`,
            top: `${(currentTop + targetTop) / 2 - Math.abs(bend) * 0.55}px`,
            offset: 0.52,
          },
          { left: `${targetLeft}px`, top: `${targetTop}px` },
        ],
        { duration: 2_300, easing: "ease-in-out", fill: "forwards" },
      );
      animationsRef.current.add(animation);
      try {
        await animation.finished;
      } catch {
        return false;
      } finally {
        animationsRef.current.delete(animation);
      }
      cursor.style.left = `${targetLeft}px`;
      cursor.style.top = `${targetTop}px`;
      return !isDisposed && token === runRef.current;
    };

    const typeReplacement = async (
      target: HTMLElement,
      replacement: string,
      bend: number,
    ) => {
      if (!(await moveCursor(target, bend))) return false;
      target.classList.add(styles.wordHovered);
      if (!(await wait(850))) return false;

      cursorRef.current?.classList.add(styles.cursorClick);
      if (!(await wait(190))) return false;
      cursorRef.current?.classList.remove(styles.cursorClick);
      target.classList.add(styles.wordEditing, styles.wordTyping);
      if (!(await wait(480))) return false;

      target.classList.add(styles.wordSelected);
      if (!(await wait(430))) return false;
      target.classList.remove(styles.wordSelected);
      automaticEditRef.current = {
        target,
        original: target.textContent ?? "",
        replacement,
      };
      target.textContent = "";
      for (const character of replacement) {
        if (!(await wait(155))) return false;
        target.textContent += character;
      }
      if (!(await wait(650))) return false;
      target.classList.remove(
        styles.wordHovered,
        styles.wordEditing,
        styles.wordSelected,
        styles.wordTyping,
      );
      automaticEditRef.current = null;
      return true;
    };

    const play = async () => {
      const container = containerRef.current;
      const cursor = cursorRef.current;
      const site = siteRef.current;
      const stuck = stuckRef.current;
      if (!container || !cursor || !site || !stuck) return;

      cursor.style.left = `${Math.max(container.clientWidth - 34, 0)}px`;
      cursor.style.top = `${Math.max(container.clientHeight - 46, 0)}px`;
      if (!(await typeReplacement(site, "website", -54))) return;
      if (!(await wait(850))) return;
      if (!(await typeReplacement(stuck, "done", 64))) return;
      if (!(await wait(500))) return;
      cursor.classList.remove(styles.cursorVisible);
    };

    const startTimer = window.setTimeout(() => {
      timersRef.current.delete(startTimer);
      void play();
    }, START_DELAY_MS);
    timersRef.current.add(startTimer);

    const handleVisibility = () => {
      if (document.hidden) cancelSequence();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      isDisposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      cancelSequence();
    };
  }, []);

  const preventLineBreak = (event: ReactKeyboardEvent<HTMLElement>) => {
    cancelSequence();
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") event.currentTarget.blur();
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLElement>) => {
    cancelSequence();
    event.preventDefault();
    const text = event.clipboardData
      .getData("text/plain")
      .replace(/[\r\n]+/g, " ")
      .slice(0, MAX_EDIT_LENGTH);
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    placeCaretAfter(node);
  };

  const handleInput = (event: FormEvent<HTMLElement>) => {
    cancelSequence();
    const element = event.currentTarget;
    if (composingElementsRef.current.has(element)) return;
    normalizeEditable(element);
  };

  const normalizeEditable = (element: HTMLElement) => {
    const text = (element.textContent ?? "").replace(/[\r\n]+/g, " ");
    if (text.length > MAX_EDIT_LENGTH || text !== element.textContent) {
      element.textContent = text.slice(0, MAX_EDIT_LENGTH);
      const last = element.lastChild;
      if (last) placeCaretAfter(last);
    }
  };

  const handleCompositionStart = (
    event: ReactCompositionEvent<HTMLElement>,
  ) => {
    cancelSequence();
    composingElementsRef.current.add(event.currentTarget);
  };

  const handleCompositionEnd = (event: ReactCompositionEvent<HTMLElement>) => {
    composingElementsRef.current.delete(event.currentTarget);
    normalizeEditable(event.currentTarget);
  };

  const editableProps = (label: string) => ({
    contentEditable: "plaintext-only" as const,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-label": label,
    spellCheck: true,
    onPointerDown: cancelSequence,
    onFocus: cancelSequence,
    onKeyDown: preventLineBreak,
    onPaste: handlePaste,
    onInput: handleInput,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
  });

  return (
    <section className={styles.hero} data-testid="editorial-hero">
      <Image
        className={styles.heroArtwork}
        src="/brand/editorial/hero-request-loop.webp"
        alt="A freelancer interrupted by a looping stream of client requests."
        width={1600}
        height={800}
        priority
        sizes="(max-width: 1024px) 100vw, 58vw"
      />
      <div ref={containerRef} className={styles.heroCopy}>
        <p className={styles.eyebrow}>For freelancers + small web studios</p>
        <h1 className={styles.heroTitle}>
          <span
            className={styles.heroLine}
            {...editableProps("Headline line 1")}
          >
            You built the{" "}
            <span ref={siteRef} className={styles.editWord}>
              site
            </span>
            .
          </span>
          <span
            className={styles.heroLine}
            {...editableProps("Headline line 2")}
          >
            Now you’re{" "}
            <span ref={stuckRef} className={styles.editWord}>
              stuck
            </span>
          </span>
          <span
            className={styles.heroLine}
            {...editableProps("Headline line 3")}
          >
            updating it.
          </span>
        </h1>
        <svg
          ref={cursorRef}
          className={styles.demoCursor}
          aria-hidden="true"
          viewBox="0 0 24 32"
        >
          <path
            d="M2 1 L2 25 L8 19 L13 30 L18 27 L13 17 L23 17 Z"
            fill="#142024"
            stroke="#fff"
            strokeWidth="2"
          />
        </svg>
        <p className={styles.payoff}>
          <span {...editableProps("Supporting text line 1")}>
            Let clients edit the words.
          </span>
          <br />
          <span {...editableProps("Supporting text line 2")}>
            Make time for the work that matters.
          </span>
        </p>
        <div className={styles.heroActions}>
          {/* Establish signup as a fresh nonce document (ADR 059). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/signup"
            data-cta-location="editorial_hero"
            {...dataFastCtaAttributes("editorial_hero", "signup")}
            className={styles.primaryButton}
          >
            Start your free trial
          </a>
          <a href="#product-tour" className={styles.secondaryButton}>
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
