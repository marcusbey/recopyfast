"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConsentChoice } from "@/lib/analytics/google-analytics/consent";

export interface ConsentBannerProps {
  /** The stored choice, if any. With one, Escape and the close button dismiss. */
  currentChoice: ConsentChoice | null;
  /** Opened from "Cookie settings": take focus now, give it back on close. */
  shouldTakeFocus: boolean;
  onChoose: (choice: ConsentChoice) => void;
  onDismiss: () => void;
}

/**
 * The analytics consent banner (s107, ADR 063).
 *
 * Shown on marketing pages only, where the visitor's country needs consent
 * and no choice is stored, or when "Cookie settings" reopens it. Fixed to the
 * bottom so inserting it moves nothing already on screen (no layout shift); a
 * spacer of its height, in flow at the very end of the document, keeps the
 * footer reachable above it.
 *
 * Accessibility: a labelled, described region (a landmark a screen reader can
 * jump to); two buttons of equal weight — declining is exactly as easy as
 * allowing; native buttons, so Tab/Enter/Space work with no handlers of ours.
 * Escape and the close button exist only once a choice exists: the first
 * visit asks for an explicit answer, though nothing on the page is blocked
 * meanwhile. Reopened from the footer, it moves focus to its first button and
 * returns it to the footer on close.
 *
 * Composed from `Button` and card tokens, pinned light like the marketing
 * surface. The design system has no banner/toast primitive (gap 1); this is a
 * composition, not a new primitive.
 */
export function ConsentBanner({
  currentChoice,
  shouldTakeFocus,
  onChoose,
  onDismiss,
}: ConsentBannerProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const firstButtonRef = React.useRef<HTMLButtonElement>(null);
  const [reservedHeight, setReservedHeight] = React.useState(0);
  const canDismiss = currentChoice !== null;

  React.useEffect(() => {
    if (!shouldTakeFocus) return;
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    firstButtonRef.current?.focus();
    return () => {
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [shouldTakeFocus]);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => setReservedHeight(panel.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && canDismiss) {
      event.stopPropagation();
      onDismiss();
    }
  };

  return (
    <>
      <div aria-hidden="true" style={{ height: reservedHeight }} />
      <div
        ref={panelRef}
        data-theme="light"
        data-testid="consent-banner"
        className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onKeyDown={onKeyDown}
      >
        <section
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative mx-auto max-w-3xl rounded-container border border-border bg-card p-4 text-foreground shadow-md sm:p-5"
        >
          <h2 id={titleId} className="pr-10 text-base font-semibold">
            Analytics cookies
          </h2>
          <p
            id={descriptionId}
            className="mt-1 text-sm leading-relaxed text-muted-foreground"
          >
            May we use Google Analytics to count visits to these public pages?
            It sets cookies only if you allow it. You can change your answer any
            time under &ldquo;Cookie settings&rdquo; at the bottom of the page.{" "}
            <a
              href="/privacy#analytics"
              className="font-medium text-foreground underline underline-offset-2"
            >
              How we use analytics
            </a>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              ref={firstButtonRef}
              type="button"
              variant="outline"
              aria-pressed={currentChoice === "granted"}
              onClick={() => onChoose("granted")}
            >
              Allow analytics
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={currentChoice === "denied"}
              onClick={() => onChoose("denied")}
            >
              Decline
            </Button>
          </div>
          {canDismiss ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close cookie settings"
              className="absolute right-2 top-2"
              onClick={onDismiss}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </section>
      </div>
    </>
  );
}
