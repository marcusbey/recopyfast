"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-foreground/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * The frame: a flex column that never scrolls. Its only scroll region is
 * `DialogBody`.
 *
 * Until s66a this was `grid … gap-4 overflow-y-auto p-6`. A grid item keeps
 * `min-width: auto`, so the 300-character embed snippet in the site-registered
 * panel set the implicit column to 2,524 px inside a 588 px dialog. The header
 * centred itself in that track, off-screen (the "tall empty band" in the
 * owner's screenshot, 2026-10-07), the Copy button sat 2,000 px to the right,
 * and the dialog grew a horizontal scrollbar, on all 12 call sites (s66
 * research, fact 1). Do not put `grid`, padding or `overflow-*` back on the
 * frame, here or at a call site: `src/__tests__/design/dialog-structure.test.ts`
 * fails on it, and e2e/app-layout.spec.ts measures the result.
 *
 * Below 640px the frame is a full-width bottom sheet (`max-sm:`), with a top
 * border only. Width is the one thing a call site may set (`max-w-*`).
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * The corner X. Defaults to `true` — every existing call site is unchanged.
     *
     * Pass `false` only where an accidental dismissal destroys something that
     * cannot be recovered: the show-once webhook secret is displayed exactly
     * once, so a stray click on the X costs the owner a delete-and-recreate.
     * Overlay-click and Escape are suppressed separately, by the caller passing
     * `onInteractOutside`/`onEscapeKeyDown` through the props spread below.
     */
    showClose?: boolean;
  }
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-container border border-border bg-card text-card-foreground shadow-md",
        "max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:max-h-[92dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:border-x-0 max-sm:border-b-0",
        "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className,
      )}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-control text-muted-foreground opacity-70 transition-colors hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/** Title and description, left-aligned at every width; `pr-12` clears the X. */
const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-col gap-1.5 px-4 pb-4 pr-12 pt-5 text-left sm:px-6 sm:pr-12",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

/**
 * The one scroll region. `min-h-0` lets it shrink inside the frame's flex
 * column so it scrolls instead of pushing the footer out; `[&>*]:min-w-0`
 * lets a long string inside a child wrap instead of widening the dialog.
 *
 * A `<form>` that spans body and footer must itself be the flex region
 * (`flex min-h-0 flex-1 flex-col`), or this stops being a direct flex child
 * and the form overflows the frame (design system, Dialogs and sheets).
 *
 * `empty:hidden`: a confirm dialog keeps its body for an error it may never
 * show (`{error && …}`). Rendered empty, the body's bottom padding drew a
 * blank band between the description and the footer (s66a review m4), so an
 * empty body takes no space. It only works if nothing at all is rendered into
 * it: an always-present wrapper brings the band back.
 */
const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6 empty:hidden [&>*]:min-w-0",
      className,
    )}
    {...props}
  />
);
DialogBody.displayName = "DialogBody";

/** Actions: right-aligned from 640px; stacked full width, primary on top, below. */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-6 max-sm:[&>*]:w-full",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-semibold leading-6 text-foreground",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
