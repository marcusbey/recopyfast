"use client";

import { Clock, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusTone } from "@/components/ui/status-badge";

/**
 * What is left of a trial: time, and AI credits.
 *
 * Two rows rather than one summary because the two run out on different clocks
 * and a single tone would have to lie about one of them — nine days left with
 * no credits is not the same situation as two days left with a full allowance.
 *
 * Pure presentation: everything here arrives as a prop from
 * `/api/billing/dashboard`, which the page already fetches. There is no second
 * request, and nothing here is consulted by any gate.
 */

export interface TrialCardData {
  daysRemaining: number;
  endsAt: string;
  creditsUsed: number;
  creditsLimit: number;
}

interface TrialStatusCardProps {
  /** Null both for "not trialling" and for "we could not find out". */
  trial: TrialCardData | null;
  isLoading?: boolean;
}

/** Below this many days left, the countdown stops informing and starts asking. */
const WARNING_THRESHOLD_DAYS = 3;

/** Fraction of the allowance spent before the credit row raises its voice. */
const CREDITS_WARNING_RATIO = 0.8;

function timeTone(daysRemaining: number): StatusTone {
  return daysRemaining <= WARNING_THRESHOLD_DAYS ? "warning" : "info";
}

function creditsTone(used: number, limit: number): StatusTone {
  if (limit <= 0 || used >= limit) return "danger";
  return used / limit >= CREDITS_WARNING_RATIO ? "warning" : "info";
}

const TONE_FILL: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  accent: "bg-tone-accent-text",
  info: "bg-tone-info-text",
  success: "bg-tone-success-text",
  warning: "bg-tone-warning-text",
  danger: "bg-tone-danger-text",
};

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

function LoadingRows() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading trial status">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TrialStatusCard({ trial, isLoading }: TrialStatusCardProps) {
  if (isLoading) {
    return (
      <Card variant="outline" className="mb-6 p-6">
        <LoadingRows />
      </Card>
    );
  }

  // Hidden, not an error. This data comes from a route that is explicitly not
  // load-bearing for authorisation, so a failed read must not surface as a
  // destructive alert about the reader's own account — that would state a
  // problem with their trial when the only problem is one request.
  if (!trial) return null;

  const { daysRemaining, endsAt, creditsUsed, creditsLimit } = trial;
  const spent = Math.min(creditsUsed, Math.max(creditsLimit, 0));
  const percentUsed =
    creditsLimit > 0 ? Math.min((creditsUsed / creditsLimit) * 100, 100) : 100;
  const tone = creditsTone(creditsUsed, creditsLimit);
  const isExhausted = tone === "danger";

  return (
    <Card variant="outline" className="mb-6 space-y-5 p-6">
      <div className="flex items-start gap-3">
        <IconTile tone={timeTone(daysRemaining)}>
          <Clock aria-hidden="true" />
        </IconTile>
        <div className="min-w-0">
          <p className="text-title">
            {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left in your
            trial
          </p>
          <p className="text-sm text-muted-foreground">
            Ends {formatEndDate(endsAt)}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <IconTile tone={tone}>
          <Zap aria-hidden="true" />
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="text-title text-[0.9375rem]">
            <span className="text-metric tabular">{creditsUsed}</span>{" "}
            <span className="font-normal text-muted-foreground">
              of {creditsLimit} trial AI credits used
            </span>
          </p>
          <div
            className="mt-2 h-2 w-full rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Trial AI credits used"
            aria-valuenow={spent}
            aria-valuemin={0}
            aria-valuemax={creditsLimit}
          >
            <div
              className={`h-2 rounded-full transition-all ${TONE_FILL[tone]}`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          {isExhausted && (
            <p className="mt-2 text-sm text-muted-foreground">
              AI suggestions and translations are paused until you upgrade.
              Editing text by hand still works.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
