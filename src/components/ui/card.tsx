"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const cardVariants = cva(
  [
    "rounded-xl border bg-card text-card-foreground",
    "transition-all duration-300 ease-out",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "shadow-sm",
        elevated: [
          "shadow-lg",
          "hover:shadow-xl",
          "hover:-translate-y-0.5",
        ].join(" "),
        outline: ["border-2 shadow-none", "hover:border-primary/50"].join(" "),
        ghost: [
          "border-transparent bg-transparent shadow-none",
          "hover:bg-accent/50",
        ].join(" "),
        glass: [
          "bg-card/80 backdrop-blur-xl",
          "border-white/10",
          "shadow-lg",
        ].join(" "),
        interactive: [
          "shadow-sm cursor-pointer",
          "hover:shadow-md hover:border-primary/30",
          "active:scale-[0.99]",
        ].join(" "),
        staging: ["border-orange-500/30 bg-orange-500/5", "shadow-sm"].join(
          " ",
        ),
        success: ["border-emerald-500/30 bg-emerald-500/5", "shadow-sm"].join(
          " ",
        ),
        gradient: [
          "border-0 shadow-lg",
          "bg-gradient-to-br from-card via-card to-primary/5",
        ].join(" "),
      },
      padding: {
        default: "",
        none: "[&>*]:p-0",
        sm: "[&_.card-header]:p-4 [&_.card-content]:p-4 [&_.card-content]:pt-0 [&_.card-footer]:p-4",
        lg: "[&_.card-header]:p-8 [&_.card-content]:p-8 [&_.card-content]:pt-0 [&_.card-footer]:p-8",
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

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("card-header flex flex-col space-y-1.5 p-6", className)}
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
      "text-xl font-semibold leading-none tracking-tight",
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
    className={cn("text-sm text-muted-foreground", className)}
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
    className={cn("card-content p-6 pt-0", className)}
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
    className={cn("card-footer flex items-center p-6 pt-0", className)}
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
