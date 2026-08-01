"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";
import { Loader2 } from "lucide-react";

/**
 * Six variants, one accent.
 *
 * The previous set carried nine, six of which were decoration: `gradient`,
 * `glow`, `glass`, plus hardcoded orange/emerald `staging` and `success` fills.
 * None were referenced outside this file. Colour on a button now means one of
 * three things — this is the primary action, this destroys something, or this
 * is neither.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md text-sm font-medium",
    // Focus is visible, always. This is an accessibility requirement.
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    // Only colour, shadow and transform animate — all cheap to composite.
    "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground shadow-xs",
          "hover:bg-primary/90 hover:shadow-sm",
        ].join(" "),
        destructive: [
          "bg-destructive text-destructive-foreground shadow-xs",
          "hover:bg-destructive/90 hover:shadow-sm",
        ].join(" "),
        outline: [
          "border border-input bg-card text-foreground",
          "hover:bg-accent hover:text-accent-foreground",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-foreground",
          "hover:bg-secondary/80",
        ].join(" "),
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Heights stay at a 40px default: these controls are used at 390px wide
      // as well as on desktop, and a 36px target is below what a thumb wants.
      // Density comes from type and spacing, not from shrinking hit areas.
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-sm px-3 text-xs",
        lg: "h-12 rounded-lg px-6 text-[0.9375rem]",
        xl: "h-14 rounded-xl px-8 text-base",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8 rounded-sm",
        "icon-lg": "h-12 w-12 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            <span className="opacity-70">{children}</span>
          </>
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
