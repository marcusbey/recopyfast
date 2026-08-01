import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";
import type { StatusTone } from "@/components/ui/status-badge";

/**
 * The container an icon sits in.
 *
 * The version this replaces gave every tile its own gradient — blue/cyan for
 * sites, purple/pink for content, yellow/orange for AI, green/emerald for
 * activity. Four hues in a row encoding nothing but "these are four different
 * things", which the labels already said.
 *
 * Here the default is a neutral surface. A tone is only passed when the colour
 * is carrying state: a failure is `danger`, something awaiting action is
 * `warning`. Category never gets a colour.
 */
const iconTileVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg border",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-2 text-muted-foreground",
        accent:
          "border-tone-accent-border bg-tone-accent-surface text-tone-accent-text",
        info: "border-tone-info-border bg-tone-info-surface text-tone-info-text",
        success:
          "border-tone-success-border bg-tone-success-surface text-tone-success-text",
        warning:
          "border-tone-warning-border bg-tone-warning-surface text-tone-warning-text",
        danger:
          "border-tone-danger-border bg-tone-danger-surface text-tone-danger-text",
      },
      size: {
        sm: "h-7 w-7 rounded-md [&_svg]:size-3.5",
        default: "h-9 w-9 [&_svg]:size-4",
        lg: "h-11 w-11 rounded-xl [&_svg]:size-5",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  },
);

export interface IconTileProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof iconTileVariants> {
  tone?: StatusTone;
}

export function IconTile({
  className,
  tone,
  size,
  children,
  ...props
}: IconTileProps) {
  return (
    <span
      className={cn(iconTileVariants({ tone, size }), className)}
      aria-hidden="true"
      {...props}
    >
      {children}
    </span>
  );
}
