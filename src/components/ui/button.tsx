"use client";

import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
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
    // s66a (ADR 050): one 2px control radius at every size. The legacy scale
    // grew it with the button, to 16px at `xl`.
    "rounded-control text-sm font-medium",
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
        // Flat: buttons cast no shadow (design system, Surfaces and elevation).
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
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
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-[0.9375rem]",
        xl: "h-14 px-8 text-base",
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

/** True when `children` is exactly one React element — what asChild needs. */
function isSingleElement(children: React.ReactNode): boolean {
  const nodes = React.Children.toArray(children);
  return nodes.length === 1 && React.isValidElement(nodes[0]);
}

/** Native elements that honour the `disabled` attribute. */
const DISABLEABLE_TAGS = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "fieldset",
]);

/**
 * True when the single asChild child is a native element `disabled` works on
 * (Devin review, PR #78): a slotted submit button must be disabled while its
 * Button is disabled or loading. A link, or a component, is not.
 */
function childHonoursDisabled(children: React.ReactNode): boolean {
  const nodes = React.Children.toArray(children);
  const only = nodes.length === 1 ? nodes[0] : null;
  return (
    React.isValidElement(only) &&
    typeof only.type === "string" &&
    DISABLEABLE_TAGS.has(only.type)
  );
}

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
    // A <button> (or other form control) child honours `disabled`; a link does
    // not, so there it is never forwarded (s73 review minor 1).
    const forwardsDisabled = !asChild || childHonoursDisabled(children);

    // s73 review minor 1. `disabled` is not valid on an <a> and stops no
    // navigation, so it is not forwarded there; and Slot renders nothing for a
    // child that is not one element. Both are call-site mistakes, said out
    // loud in development rather than shipped silently.
    if (asChild && process.env.NODE_ENV !== "production") {
      if (disabled && !forwardsDisabled) {
        console.error(
          "Button: `disabled` has no effect with asChild — the child element decides whether it can be used.",
        );
      }
      if (!isSingleElement(children)) {
        console.error(
          "Button: asChild needs one element child (a link or button); text or several children render nothing.",
        );
      }
    }
    // The dimmed label is a <button>-only detail. With asChild the content
    // belongs to the call site's element, which Button cannot wrap without
    // changing that element's structure.
    const label =
      loading && !asChild ? (
        <span className="opacity-70">{children}</span>
      ) : (
        children
      );

    /**
     * s73: the children are listed flat, with the label inside `Slottable`.
     *
     * Until s73 they were one Fragment (`<>{leftIcon}{children}{rightIcon}</>`).
     * Radix `Slot` clones its single child, so with asChild it cloned that
     * Fragment: className, ref and every prop landed on React.Fragment and were
     * dropped ("Invalid prop `className` supplied to `React.Fragment`"), and
     * ten call sites shipped a bare <a> where they asked for a button.
     *
     * `Slottable` marks which child is the call site's element: Slot clones it
     * with the merged props and puts the icons inside it, around its content.
     * It must stay a direct child of `Comp` — `Slot` does not look inside a
     * Fragment, so wrapping these three again brings the bug back. For a
     * <button>, `Slottable` renders `<>{children}</>`: the markup is unchanged.
     */
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={forwardsDisabled ? isDisabled : undefined}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          leftIcon
        )}
        <Slottable>{label}</Slottable>
        {loading ? null : rightIcon}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
