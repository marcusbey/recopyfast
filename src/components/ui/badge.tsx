"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  [
    "inline-flex items-center rounded-full border",
    "px-2.5 py-0.5 text-xs font-semibold",
    "transition-all duration-200",
    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
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
        outline: ["text-foreground border-border", "hover:bg-accent/50"].join(
          " ",
        ),
        // New premium variants
        staging: [
          "border-transparent",
          "bg-gradient-to-r from-orange-500 to-amber-500",
          "text-white",
          "shadow-sm",
        ].join(" "),
        "staging-outline": [
          "border-orange-500/50 bg-orange-500/10",
          "text-orange-600 dark:text-orange-400",
        ].join(" "),
        success: ["border-transparent bg-emerald-500", "text-white"].join(" "),
        "success-outline": [
          "border-emerald-500/50 bg-emerald-500/10",
          "text-emerald-600 dark:text-emerald-400",
        ].join(" "),
        warning: ["border-transparent bg-yellow-500", "text-black"].join(" "),
        "warning-outline": [
          "border-yellow-500/50 bg-yellow-500/10",
          "text-yellow-600 dark:text-yellow-400",
        ].join(" "),
        info: ["border-transparent bg-blue-500", "text-white"].join(" "),
        "info-outline": [
          "border-blue-500/50 bg-blue-500/10",
          "text-blue-600 dark:text-blue-400",
        ].join(" "),
        // Glow variants
        "glow-primary": [
          "border-transparent bg-primary text-primary-foreground",
          "shadow-[0_0_10px_hsl(var(--primary)/0.5)]",
        ].join(" "),
        "glow-staging": [
          "border-transparent",
          "bg-gradient-to-r from-orange-500 to-amber-500",
          "text-white",
          "shadow-[0_0_10px_rgba(249,115,22,0.5)]",
        ].join(" "),
        "glow-success": [
          "border-transparent bg-emerald-500 text-white",
          "shadow-[0_0_10px_rgba(16,185,129,0.5)]",
        ].join(" "),
        // Dot indicator variants
        live: [
          "border-emerald-500/50 bg-emerald-500/10",
          "text-emerald-600 dark:text-emerald-400",
          "pl-2",
        ].join(" "),
        offline: [
          "border-gray-500/50 bg-gray-500/10",
          "text-gray-600 dark:text-gray-400",
          "pl-2",
        ].join(" "),
      },
      size: {
        default: "px-2.5 py-0.5 text-xs",
        sm: "px-2 py-0.5 text-[10px]",
        lg: "px-3 py-1 text-sm",
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
  dot?: boolean;
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
  const showDot = dot || variant === "live" || variant === "offline";
  const dotColor =
    variant === "live"
      ? "bg-emerald-500"
      : variant === "offline"
        ? "bg-gray-400"
        : "bg-current";

  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {showDot && (
        <span className="relative mr-1.5 flex h-2 w-2">
          {pulse && variant === "live" && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                dotColor,
              )}
            />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              dotColor,
            )}
          />
        </span>
      )}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
