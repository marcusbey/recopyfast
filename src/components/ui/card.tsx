"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Square and flat (s66a, ADR 050). A card is a container, so it takes the 0
 * radius; nesting reads through borders and surface steps, not through a
 * container softer than its contents. That older rule ("rounded-xl here,
 * rounded-md for controls") is superseded on app surfaces by ADR 050: it is
 * how the owner's site-registered panel ended up as rounded boxes inside a
 * rounded modal.
 *
 * Static panels cast no shadow and never move. Only `elevated`, for surfaces
 * that float (dialogs, popovers), keeps `shadow-md`; shadows come from the
 * tinted `--shadow-*` scale in globals.css. `interactive` signals itself with
 * its border colour alone.
 */
const cardVariants = cva(
  [
    "rounded-container border bg-card text-card-foreground",
    "transition-[box-shadow,border-color,transform,background-color] duration-200 ease-out",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "",
        /** Sits above the page — dialogs, popovers, the one focal panel. */
        elevated: "shadow-md",
        /** Structure without weight. The dashboard's workhorse. */
        outline: "shadow-none",
        /** No chrome at all; groups content without drawing a box. */
        ghost: "border-transparent bg-transparent shadow-none",
        /**
         * The whole card is a link or button. Hover changes the border colour
         * only: no lift, no shadow (s66a).
         */
        interactive: "cursor-pointer hover:border-primary/40",
      },
      padding: {
        default: "",
        none: "[&>*]:p-0",
        sm: "[&_.card-header]:p-4 [&_.card-content]:p-4 [&_.card-content]:pt-0 [&_.card-footer]:p-4",
        lg: "[&_.card-header]:p-7 [&_.card-content]:p-7 [&_.card-content]:pt-0 [&_.card-footer]:p-7",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "default",
    },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  asChild?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, padding }), className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

/**
 * Optical rather than mathematical padding: the top inset is a touch larger
 * than the bottom because the cap height of the title leaves visual space that
 * the box model does not account for.
 */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "card-header flex flex-col space-y-1 px-6 pb-4 pt-5",
      className,
    )}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-base font-semibold leading-6", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("card-content px-6 pb-5 pt-0", className)}
    {...props}
  />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("card-footer flex items-center px-6 pb-5 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  cardVariants,
};
