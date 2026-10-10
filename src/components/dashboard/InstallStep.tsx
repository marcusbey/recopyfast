import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Where a step stands in a process the owner is working through. Absent, the
 * step is an instruction with no progress to show.
 */
export type InstallStepState = "done" | "current" | "next";

interface InstallStepProps {
  number: number;
  title: React.ReactNode;
  state?: InstallStepState;
  children?: React.ReactNode;
  className?: string;
}

const MARKER_TONE: Record<InstallStepState | "plain", string> = {
  plain: "border-border bg-surface-1 text-foreground",
  done: "border-tone-success-border bg-tone-success-surface text-tone-success-text",
  // A selected state is an accent border, never a thicker one (design
  // system, Borders).
  current: "border-primary bg-surface-1 text-foreground",
  next: "border-border bg-surface-1 text-muted-foreground",
};

const TITLE_TONE: Record<InstallStepState | "plain", string> = {
  plain: "font-semibold text-foreground",
  done: "font-medium text-foreground",
  current: "font-semibold text-foreground",
  next: "font-medium text-muted-foreground",
};

/**
 * One numbered step: a square step number, a heading, then its content.
 *
 * Extracted from the site-registered panel (s66c2) so the site Overview's
 * quick setup draws the same marker. There is no stepper primitive
 * (design-system gap 14); with two consumers, both dashboard-local, it stays
 * here rather than becoming `ui/steps.tsx`.
 *
 * The registration panel passes no `state`: its steps are instructions, and
 * they look exactly as they did. The quick setup passes one per step, and the
 * marker says it: a tick in the success tone when done, the number with the
 * accent border when current, the number muted when still ahead. The tick is
 * decorative, so a done step also says "Done" in words, and the current step
 * is `aria-current="step"`.
 */
export function InstallStep({
  number,
  title,
  state,
  children,
  className,
}: InstallStepProps) {
  const tone = state ?? "plain";

  return (
    <li
      className={cn("flex gap-3", className)}
      aria-current={state === "current" ? "step" : undefined}
    >
      <span
        aria-hidden="true"
        className={cn(
          "tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-container border text-xs font-medium",
          MARKER_TONE[tone],
        )}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" /> : number}
      </span>
      {state === "done" && <span className="sr-only">Done</span>}
      <div className="min-w-0 flex-1 space-y-3">
        <h3 className={cn("text-sm leading-6", TITLE_TONE[tone])}>{title}</h3>
        {children}
      </div>
    </li>
  );
}
