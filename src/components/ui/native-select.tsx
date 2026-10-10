import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface NativeSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Layout for the wrapper (margin, width). The select always fills it. */
  wrapperClassName?: string;
}

/**
 * Every form select on the app surface (ADR 051).
 *
 * A real <select>, so phones keep their OS picker and `<Label htmlFor>`,
 * `getByLabelText` and `userEvent.selectOptions` all reach the element. What
 * changes is the chevron. The eight hand-styled selects this replaces set no
 * `appearance-none`, so the browser drew its own arrow wherever it liked,
 * about 6 px from the border: the owner's "Expires in" screenshot
 * (2026-10-07). Here the native arrow is removed and a 16 px `ChevronDown`
 * is drawn with its right edge 12 px inside the border (`right-3`), and
 * `pr-9` keeps option text from ever running under it. The Playwright harness
 * measures that inset.
 *
 * Every prop but `wrapperClassName` goes to the <select>.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn("relative w-full", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full appearance-none rounded-control border border-input bg-card pl-3 pr-9 text-sm text-foreground",
          "transition-[border-color,box-shadow] duration-200 ease-out",
          "hover:border-foreground/40",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  ),
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
