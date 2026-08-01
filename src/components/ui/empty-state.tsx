import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { IconTile } from "@/components/ui/icon-tile";
import type { StatusTone } from "@/components/ui/status-badge";

/**
 * The database this dashboard sits on is genuinely empty for a new account, so
 * empty states are the first thing most people see. They should say what this
 * screen is for, what to do next, and — where it helps — what will happen once
 * the action is taken.
 *
 * `steps` is for exactly that: a short, factual list of what follows. It is not
 * a place for invented numbers, testimonials or sample records.
 */
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Primary action. Render a Button or a Link-wrapped Button. */
  action?: React.ReactNode;
  /** Secondary action, shown beside the primary one. */
  secondaryAction?: React.ReactNode;
  /** What happens after the primary action. Keep to three or fewer. */
  steps?: readonly string[];
  /** Only pass a tone when the emptiness itself is a problem state. */
  tone?: StatusTone;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  steps,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center",
        className,
      )}
    >
      <IconTile tone={tone} size="lg">
        <Icon aria-hidden="true" />
      </IconTile>

      <h3 className="mt-4 text-title">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>

      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}

      {steps && steps.length > 0 && (
        <ol className="mt-7 w-full space-y-2.5 border-t border-border pt-6 text-left">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm text-muted-foreground">
              <span
                className="tabular mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.6875rem] font-semibold text-foreground"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
