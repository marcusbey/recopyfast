"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  [
    // Base styles
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg text-sm font-medium",
    // Focus & accessibility
    "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    // Disabled state
    "disabled:pointer-events-none disabled:opacity-50",
    // Icon sizing
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    // Transitions
    "transition-all duration-200 ease-out",
    // Active press effect
    "active:scale-[0.98]",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90",
          "shadow-sm hover:shadow-md",
        ].join(" "),
        destructive: [
          "bg-destructive text-destructive-foreground",
          "hover:bg-destructive/90",
          "shadow-sm hover:shadow-md",
        ].join(" "),
        outline: [
          "border border-input bg-background",
          "hover:bg-accent/50 hover:text-accent-foreground hover:border-accent",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-foreground",
          "hover:bg-secondary/80",
        ].join(" "),
        ghost: ["hover:bg-accent/50 hover:text-accent-foreground"].join(" "),
        link: ["text-primary underline-offset-4", "hover:underline"].join(" "),
        // New premium variants
        gradient: [
          "bg-gradient-to-r from-primary to-primary/80",
          "text-primary-foreground",
          "hover:from-primary/90 hover:to-primary/70",
          "shadow-md hover:shadow-lg",
          "border-0",
        ].join(" "),
        glow: [
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90",
          "shadow-[0_0_20px_hsl(var(--primary)/0.3)]",
          "hover:shadow-[0_0_30px_hsl(var(--primary)/0.5)]",
        ].join(" "),
        staging: [
          "bg-gradient-to-r from-orange-500 to-amber-500",
          "text-white",
          "hover:from-orange-600 hover:to-amber-600",
          "shadow-md hover:shadow-lg",
          "border-0",
        ].join(" "),
        success: [
          "bg-emerald-500 text-white",
          "hover:bg-emerald-600",
          "shadow-sm hover:shadow-md",
        ].join(" "),
        glass: [
          "bg-white/10 backdrop-blur-md",
          "text-foreground",
          "border border-white/20",
          "hover:bg-white/20",
        ].join(" "),
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-8 text-base",
        xl: "h-14 rounded-xl px-10 text-lg font-semibold",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
        "icon-lg": "h-12 w-12",
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
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            <span className="opacity-70">{children}</span>
          </>
        ) : (
          <>
            {leftIcon && <span className="mr-1">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="ml-1">{rightIcon}</span>}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
