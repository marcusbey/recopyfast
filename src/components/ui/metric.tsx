"use client";

import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { IconTile } from "@/components/ui/icon-tile";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusTone } from "@/components/ui/status-badge";

/**
 * One number and what it means.
 *
 * Values are always `tabular-nums`: these are figures in a data view and they
 * must not change width as they change value, or the row jitters on every
 * poll. `emphasis="lead"` sizes the one metric that actually leads the page;
 * everything else is subordinate. Four equally-weighted metrics in a row is
 * decoration pretending to be information architecture.
 */
export type MetricState = "loading" | "ready" | "error";

interface MetricProps {
  label: string;
  /** Formatted value, or `null` when the source could not supply one. */
  value: string | null;
  state: MetricState;
  icon?: LucideIcon;
  /** Short qualifier under the value — a period, a unit, a caveat. */
  hint?: string;
  href?: string;
  emphasis?: "lead" | "default";
  /** Only when the number itself is a state signal (e.g. failures). */
  tone?: StatusTone;
  className?: string;
}

function MetricBody({
  label,
  value,
  state,
  icon: Icon,
  hint,
  emphasis = "default",
  tone = "neutral",
  href,
}: MetricProps) {
  const isLead = emphasis === "lead";

  return (
    <div className="flex h-full items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-eyebrow">{label}</p>

        {state === "loading" && (
          <Skeleton
            className={cn("mt-2.5", isLead ? "h-10 w-28" : "h-7 w-16")}
          />
        )}

        {state === "error" && (
          <p className="mt-2 text-sm text-muted-foreground">Unavailable</p>
        )}

        {state === "ready" &&
          (value === null ? (
            <p className="mt-2 text-sm text-muted-foreground">Unavailable</p>
          ) : (
            <p
              className={cn(
                "text-metric mt-2 truncate",
                isLead ? "text-[2.5rem]" : "text-2xl",
              )}
            >
              {value}
            </p>
          ))}

        {hint && state === "ready" && (
          <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>

      {Icon && (
        <IconTile tone={tone} size={isLead ? "lg" : "default"}>
          <Icon aria-hidden="true" />
        </IconTile>
      )}

      {!Icon && href && (
        <ArrowUpRight
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:-translate-y-px group-hover:translate-x-px"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function Metric(props: MetricProps) {
  const { href, className, emphasis = "default" } = props;

  const shell = cn(
    "block h-full rounded-xl border border-border bg-card",
    emphasis === "lead" ? "p-6" : "px-5 py-4",
    className,
  );

  if (!href) {
    return (
      <div className={shell}>
        <MetricBody {...props} />
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        shell,
        "group surface-interactive",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <MetricBody {...props} />
    </Link>
  );
}
