"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { EntitlementSummary, TrialSummary } from "@/types/billing";

/**
 * How many days a trial has left, on the overview page.
 *
 * The whole of screen 1 in this story's design: one pill in the page header,
 * absent for everyone who is not trialling. It reads
 * `/api/billing/entitlement`, the cheap per-page call the dashboard shell
 * already makes — presentation only, by that route's own contract. A failed
 * read renders nothing rather than an error, because a badge that says
 * something wrong about someone's own account is worse than a badge that says
 * nothing, and every actual gate resolves entitlement server-side regardless.
 */

/** Below this, the countdown stops being informative and starts being urgent. */
const WARNING_THRESHOLD_DAYS = 3;

function toneFor(daysRemaining: number): StatusTone {
  return daysRemaining <= WARNING_THRESHOLD_DAYS ? "warning" : "info";
}

function formatEndDate(endsAt: string): string {
  const date = new Date(endsAt);
  return Number.isNaN(date.getTime())
    ? "soon"
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

export function TrialStatusBadge() {
  const [trial, setTrial] = useState<TrialSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/billing/entitlement", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EntitlementSummary | null) => {
        if (data?.trial) setTrial(data.trial);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("[dashboard] trial countdown lookup failed:", error);
      });

    return () => controller.abort();
  }, []);

  if (!trial) return null;

  const { daysRemaining } = trial;
  const label = `Trial — ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`;

  return (
    <Link
      href="/dashboard/billing"
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <StatusBadge
        status={{
          label,
          tone: toneFor(daysRemaining),
          icon: Clock,
          description: `Your Pro trial ends ${formatEndDate(trial.endsAt)}. Open billing to upgrade.`,
        }}
      />
    </Link>
  );
}
