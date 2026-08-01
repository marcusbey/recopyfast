"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Ten variants, down from twenty-two.
 *
 * The removed set was every combination of a hardcoded Tailwind palette colour
 * with a fill or an outline (emerald fills, yellow outlines with a per-call-site
 * dark-mode override), three glow box-shadow variants, and a pair of dot
 * variants. They were unreachable except through the tones, and they were the
 * main reason the dashboard read as a colour chart.
 *
 * What survives: the four structural variants (default / secondary /
 * destructive / outline) and the six status tones. A tone resolves to a
 * surface / text / border triplet from globals.css, so it is legible in both
 * themes with no `dark:` variant at the call site.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center rounded-full border",
    "px-2 py-0.5 text-xs font-medium",
    "transition-colors duration-200 ease-out",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "border-transparent bg-primary text-primary-foreground",
          "hover:bg-primary/80",
        ].join(" "),
        secondary: [
          "border-transparent bg-secondary text-secondary-foreground",
          "hover:bg-secondary/80",
        ].join(" "),
        destructive: [
          "border-transparent bg-destructive text-destructive-foreground",
          "hover:bg-destructive/80",
        ].join(" "),
        outline: "text-foreground border-border",
        "tone-neutral":
          "bg-tone-neutral-surface text-tone-neutral-text border-tone-neutral-border",
        "tone-info":
          "bg-tone-info-surface text-tone-info-text border-tone-info-border",
        "tone-success":
          "bg-tone-success-surface text-tone-success-text border-tone-success-border",
        "tone-warning":
          "bg-tone-warning-surface text-tone-warning-text border-tone-warning-border",
        "tone-danger":
          "bg-tone-danger-surface text-tone-danger-text border-tone-danger-border",
        "tone-accent":
          "bg-tone-accent-surface text-tone-accent-text border-tone-accent-border",
      },
      size: {
        default: "px-2 py-0.5 text-xs",
        sm: "px-1.5 py-0 text-[0.6875rem]",
        lg: "px-2.5 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Leading dot. Inherits the badge's own text colour — never a second hue. */
  dot?: boolean;
  /** Pulses the dot. Use only for genuinely live state. */
  pulse?: boolean;
}

function Badge({
  className,
  variant,
  size,
  dot,
  pulse,
  children,
  ...props
}: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && (
        <span className="relative mr-1.5 flex h-1.5 w-1.5" aria-hidden="true">
          {pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          )}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
