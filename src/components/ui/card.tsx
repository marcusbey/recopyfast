"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Container radius is softer than the radius of anything nested inside it
 * (`rounded-xl` here, `rounded-md`/`rounded-lg` for controls and rows), which
 * is what makes nesting read as nesting rather than as repetition.
 *
 * Shadows come from the tinted `--shadow-*` scale in globals.css — the surface
 * hue at low alpha, not black at low opacity, so a raised card sits in the same
 * light as the page.
 */
const cardVariants = cva(
  [
    "rounded-xl border bg-card text-card-foreground",
    "transition-[box-shadow,border-color,transform,background-color] duration-200 ease-out",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "shadow-sm",
        /** Sits above the page — dialogs, popovers, the one focal panel. */
        elevated: "shadow-md",
        /** Structure without weight. The dashboard's workhorse. */
        outline: "shadow-none",
        /** No chrome at all; groups content without drawing a box. */
        ghost: "border-transparent bg-transparent shadow-none",
        /**
         * The whole card is a link or button. Hover lifts, press settles.
         * Pair with `surface-interactive` only when the card is not already
         * inside a Link that supplies the affordance.
         */
        interactive: [
          "shadow-xs cursor-pointer",
          "hover:border-primary/40 hover:shadow-md hover:-translate-y-px",
          "active:translate-y-0 active:shadow-xs",
        ].join(" "),
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
    className={cn(
      "text-xl font-semibold leading-tight tracking-[-0.014em]",
      className,
    )}
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
