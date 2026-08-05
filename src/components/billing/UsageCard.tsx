"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";

interface UsageCardProps {
  currentUsage: {
    websites: number;
    collaborators: number;
    aiUsage: number;
    translations: number;
  };
  /** Plan in force, resolved server-side from the `plans` table. */
  plan: SubscriptionPlan;
}

export function UsageCard({ currentUsage, plan }: UsageCardProps) {
  const getUsageStatus = (current: number, limit: number) => {
    if (limit === -1) return "unlimited";
    if (current >= limit) return "exceeded";
    if (current >= limit * 0.8) return "warning";
    return "normal";
  };

  const getUsageBadge = (current: number, limit: number) => {
    const status = getUsageStatus(current, limit);

    if (limit === -1) {
      return <Badge variant="secondary">Unlimited</Badge>;
    }

    const variant =
      status === "exceeded"
        ? "destructive"
        : status === "warning"
          ? "secondary"
          : "default";

    return (
      <Badge variant={variant}>
        {current} / {limit}
      </Badge>
    );
  };

  const getProgressBarColor = (current: number, limit: number) => {
    const status = getUsageStatus(current, limit);

    return status === "exceeded"
      ? "bg-destructive"
      : status === "warning"
        ? "bg-warning"
        : "bg-primary";
  };

  const getProgressPercentage = (current: number, limit: number) => {
    if (limit === -1) return 0;
    return Math.min((current / limit) * 100, 100);
  };

  const usageItems = [
    {
      label: "Websites",
      current: currentUsage.websites,
      limit: plan.limits.websites,
      icon: "🌐",
    },
    {
      label: "AI Usage (this month)",
      current: currentUsage.aiUsage,
      limit: plan.limits.aiFeatures ? -1 : 0,
      icon: "🤖",
    },
    {
      label: "Translations (this month)",
      current: currentUsage.translations,
      limit: plan.limits.translations,
      icon: "🌍",
    },
  ];

  return (
    <Card className="p-6">
      <h3 className="text-xl font-semibold mb-4">Current usage</h3>

      <div className="space-y-4">
        {usageItems.map((item) => (
          <div key={item.label} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </div>
              {getUsageBadge(item.current, item.limit)}
            </div>

            {item.limit !== -1 && (
              <div className="w-full bg-surface-3 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${getProgressBarColor(item.current, item.limit)}`}
                  style={{
                    width: `${getProgressPercentage(item.current, item.limit)}%`,
                  }}
                ></div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-tone-info-surface rounded-lg">
        <h4 className="font-medium text-tone-info-text mb-2">
          {plan.name} plan benefits
        </h4>
        <ul className="text-sm text-tone-info-text space-y-1">
          <li>
            • {plan.limits.websites === -1 ? "Unlimited" : plan.limits.websites}{" "}
            website{plan.limits.websites !== 1 ? "s" : ""}
          </li>
          <li>
            •{" "}
            {plan.limits.aiFeatures
              ? "AI features included"
              : "No AI features (buy credits to use them)"}
          </li>
          <li>
            •{" "}
            {plan.limits.translations === -1
              ? "Unlimited"
              : plan.limits.translations === 0
                ? "No"
                : plan.limits.translations}{" "}
            translation{plan.limits.translations !== 1 ? "s" : ""}
          </li>
          <li>
            •{" "}
            {plan.limits.collaborators === -1
              ? "Unlimited"
              : plan.limits.collaborators}{" "}
            collaborator{plan.limits.collaborators !== 1 ? "s" : ""} per site
          </li>
        </ul>
      </div>
    </Card>
  );
}
