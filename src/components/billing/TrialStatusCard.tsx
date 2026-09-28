"use client";

import { useState } from "react";
import { Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusTone } from "@/components/ui/status-badge";
import type { CreditPackConfig } from "@/lib/stripe/plan-types";
import type { FoundingOfferId } from "@/types/billing";
import { PurchaseCreditsDialog } from "./PurchaseCreditsDialog";

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
  /** s47a: set when the running trial is a founding offer grant. */
  offerId?: FoundingOfferId;
}

interface TrialStatusCardProps {
  /** Null both for "not trialling" and for "we could not find out". */
  trial: TrialCardData | null;
  isLoading?: boolean;
  /**
   * s47a: the pack the founding offer card's action row prices and sells.
   * The offer card shows its actions only when this and `onChoosePlan` are
   * both given; a plain 14-day trial never shows them.
   */
  creditPack?: CreditPackConfig;
  /** s47a: opens the page's plans (its `UpgradeDialog`). */
  onChoosePlan?: () => void;
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

function formatShortDate(endsAt: string): string | null {
  const date = new Date(endsAt);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysLeft(daysRemaining: number): string {
  return `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`;
}

/**
 * The words on the card, for a plain 14-day trial or a founding offer.
 *
 * s47a: the offer is the account's one trial row, so the layout, tones and
 * bar are the trial's. Only what the card says differs — it is 90 days of Pro
 * metered at a monthly allowance, and must never read as a 14-day trial or
 * as "trial AI credits" (docs/designs/s47a-founding-20-grant.md, screen 2).
 */
interface CardCopy {
  timeTitle: string;
  timeTitleClassName: string;
  timeLine: string;
  creditsLabel: string;
  creditsAriaLabel: string;
  creditsNote: string | null;
}

function trialCopy(trial: TrialCardData, isExhausted: boolean): CardCopy {
  return {
    timeTitle: `${daysLeft(trial.daysRemaining)} in your trial`,
    timeTitleClassName: "text-title",
    timeLine: `Ends ${formatEndDate(trial.endsAt)}`,
    creditsLabel: `of ${trial.creditsLimit} trial AI credits used`,
    creditsAriaLabel: "Trial AI credits used",
    creditsNote: isExhausted
      ? "AI suggestions and translations are paused until you upgrade. Editing text by hand still works."
      : null,
  };
}

function foundingOfferCopy(
  trial: TrialCardData,
  isExhausted: boolean,
): CardCopy {
  const until = `Pro until ${formatEndDate(trial.endsAt)}.`;
  return {
    timeTitle: `Founding offer — ${daysLeft(trial.daysRemaining)}`,
    timeTitleClassName: "text-title tabular",
    timeLine:
      trial.daysRemaining <= WARNING_THRESHOLD_DAYS
        ? `${until} After that, choose a plan to keep editing. Your site keeps serving its content either way.`
        : `${until} Nothing is charged when it ends.`,
    creditsLabel: `of ${trial.creditsLimit} AI credits used this month`,
    creditsAriaLabel: "AI credits used this month",
    // Used up replaces the allowance line rather than adding to it. It says AI
    // now runs on bought credits, which is true whether or not any were bought,
    // and promises no reset date: the payload does not carry one.
    creditsNote: isExhausted
      ? `This month's ${trial.creditsLimit} AI credits are used. AI suggestions now run on credits you buy. Editing text by hand still works.`
      : `${trial.creditsLimit} AI credits a month for all 3 months. Credits you buy are spent after these.`,
  };
}

interface FoundingOfferActionsProps {
  endsAt: string;
  creditPack: CreditPackConfig;
  onChoosePlan: () => void;
  isExhausted: boolean;
}

/**
 * s47a: the offer card's third row. The paragraph says when a plan starts
 * billing, because checkout bills at once (no `trial_end`): choosing a plan on
 * day 10 gives up the free days left, and "choose before it ends" alone would
 * not say so. The pack is the catalogue's, never a literal. With the
 * allowance used up, buying credits takes the weight; the order stays.
 */
function FoundingOfferActions({
  endsAt,
  creditPack,
  onChoosePlan,
  isExhausted,
}: FoundingOfferActionsProps) {
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
  const endDate = formatShortDate(endsAt);
  const keepEditing = endDate
    ? `To keep editing after ${endDate}, choose a plan before then.`
    : "To keep editing after the offer ends, choose a plan before then.";
  const pack = `${creditPack.creditsPerPack.toLocaleString("en-US")} credits for $${creditPack.pricePerPack}`;

  return (
    <div className="border-t pt-5">
      <p className="mb-3 text-sm text-muted-foreground">
        {`${keepEditing} A plan is billed from the day you choose it. Need more AI now? ${pack}.`}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant={isExhausted ? "outline" : "default"}
          onClick={onChoosePlan}
        >
          Choose a plan
        </Button>
        <Button
          variant={isExhausted ? "default" : "outline"}
          onClick={() => setShowPurchaseDialog(true)}
        >
          Buy more AI credits
        </Button>
      </div>
      <PurchaseCreditsDialog
        open={showPurchaseDialog}
        onOpenChange={setShowPurchaseDialog}
        creditPack={creditPack}
      />
    </div>
  );
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

export function TrialStatusCard({
  trial,
  isLoading,
  creditPack,
  onChoosePlan,
}: TrialStatusCardProps) {
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
  const isFoundingOffer = Boolean(trial.offerId);
  const copy = isFoundingOffer
    ? foundingOfferCopy(trial, isExhausted)
    : trialCopy(trial, isExhausted);

  return (
    <Card variant="outline" className="mb-6 space-y-5 p-6">
      <div className="flex items-start gap-3">
        <IconTile tone={timeTone(daysRemaining)}>
          <Clock aria-hidden="true" />
        </IconTile>
        <div className="min-w-0">
          <p className={copy.timeTitleClassName}>{copy.timeTitle}</p>
          <p className="text-sm text-muted-foreground">{copy.timeLine}</p>
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
              {copy.creditsLabel}
            </span>
          </p>
          <div
            className="mt-2 h-2 w-full rounded-full bg-surface-3"
            role="progressbar"
            aria-label={copy.creditsAriaLabel}
            aria-valuenow={spent}
            aria-valuemin={0}
            aria-valuemax={creditsLimit}
          >
            <div
              className={`h-2 rounded-full transition-all ${TONE_FILL[tone]}`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          {copy.creditsNote && (
            <p className="mt-2 text-sm text-muted-foreground">
              {copy.creditsNote}
            </p>
          )}
        </div>
      </div>

      {isFoundingOffer && creditPack && onChoosePlan && (
        <FoundingOfferActions
          endsAt={endsAt}
          creditPack={creditPack}
          onChoosePlan={onChoosePlan}
          isExhausted={isExhausted}
        />
      )}
    </Card>
  );
}
