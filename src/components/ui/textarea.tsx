import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Multi-line entry with Input's box (design system, Controls): the same
 * `border-input` boundary that clears 3:1, the same 2px control radius and the
 * same focus ring. It grows vertically only, so it can never push a dialog or
 * a card wider than its column.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-20 w-full resize-y rounded-control border border-input bg-card px-3 py-2 text-sm text-foreground",
          "transition-[border-color,box-shadow] duration-200 ease-out",
          "placeholder:text-muted-foreground",
          "hover:border-foreground/40",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
