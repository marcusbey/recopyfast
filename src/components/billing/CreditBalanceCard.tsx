"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PurchaseCreditsDialog } from "./PurchaseCreditsDialog";
import type { CreditTransaction, CreditWallet } from "@/types/billing";
import type { CreditPackConfig } from "@/lib/stripe/plan-types";

interface CreditBalanceCardProps {
  wallet?: CreditWallet;
  recentTransactions: CreditTransaction[];
  creditPack: CreditPackConfig;
}

/** Below this many credits the card nudges the customer to top up. */
const LOW_BALANCE_THRESHOLD = 5;

export function CreditBalanceCard({
  wallet,
  recentTransactions,
  creditPack,
}: CreditBalanceCardProps) {
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);

  const balance = wallet?.balance || 0;
  const totalPurchased = wallet?.totalPurchased || 0;
  const totalConsumed = wallet?.totalConsumed || 0;

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case "purchase":
        return (
          <div className="w-2 h-2 rounded-full bg-tone-success-text"></div>
        );
      case "consumption":
        return <div className="w-2 h-2 rounded-full bg-tone-danger-text"></div>;
      case "refund":
        return <div className="w-2 h-2 rounded-full bg-tone-info-text"></div>;
      default:
        return (
          <div className="w-2 h-2 rounded-full bg-tone-neutral-text"></div>
        );
    }
  };

  const formatTransactionAmount = (transaction: CreditTransaction) => {
    const prefix = transaction.type === "consumption" ? "" : "+";
    return `${prefix}${Math.abs(transaction.amount)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card className="p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold">AI credits</h3>
          <p className="text-muted-foreground mt-1">
            Pay-per-use for AI features
          </p>
        </div>
        <Button onClick={() => setShowPurchaseDialog(true)} size="sm">
          Buy credits
        </Button>
      </div>

      <div className="space-y-4">
        <div className="text-center p-4 bg-tone-accent-surface rounded-lg">
          <div className="text-3xl font-semibold text-primary tabular">
            {balance}
          </div>
          <div className="text-sm text-muted-foreground">Available credits</div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="text-center p-3 bg-surface-1 rounded">
            <div className="font-semibold tabular">{totalPurchased}</div>
            <div className="text-muted-foreground">Total purchased</div>
          </div>
          <div className="text-center p-3 bg-surface-1 rounded">
            <div className="font-semibold tabular">{totalConsumed}</div>
            <div className="text-muted-foreground">Total used</div>
          </div>
        </div>

        {balance < LOW_BALANCE_THRESHOLD && (
          <div className="p-3 bg-tone-warning-surface border border-tone-warning-border rounded-lg">
            <div className="flex items-center text-tone-warning-text">
              <svg
                className="w-4 h-4 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm font-medium">Low credit balance</span>
            </div>
            <p className="text-sm text-tone-warning-text mt-1">
              Purchase more credits to continue using AI features
            </p>
          </div>
        )}

        <div>
          <h4 className="font-medium mb-3">Recent activity</h4>
          {recentTransactions.length > 0 ? (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {recentTransactions.slice(0, 5).map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    {getTransactionIcon(transaction.type)}
                    <span className="truncate">
                      {transaction.description || transaction.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        transaction.type === "consumption"
                          ? "tone-danger"
                          : "tone-success"
                      }
                      className="text-xs tabular"
                    >
                      {formatTransactionAmount(transaction)}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(transaction.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-4">
              No credit activity yet
            </p>
          )}
        </div>
      </div>

      <PurchaseCreditsDialog
        open={showPurchaseDialog}
        onOpenChange={setShowPurchaseDialog}
        creditPack={creditPack}
      />
    </Card>
  );
}
