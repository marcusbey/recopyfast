"use client";

import { useId, useState, type ReactNode } from "react";
import { trackGoal } from "@/lib/analytics/datafast-client";
import type {
  DataFastInstallChoiceLocation,
  DataFastInstallMethod,
} from "@/lib/analytics/datafast-goals";
import { cn } from "@/lib/utils/cn";
import { DeveloperHandoffMessage } from "./DeveloperHandoffMessage";

export interface InstallMethodChoiceProps {
  embedScript: string;
  siteDomain: string;
  location: DataFastInstallChoiceLocation;
  /** The existing do-it-yourself instructions, shown for "I'll do it myself". */
  children: ReactNode;
}

const OPTIONS: readonly {
  value: DataFastInstallMethod;
  label: string;
  hint: string;
}[] = [
  {
    value: "self",
    label: "I'll do it myself",
    hint: "Copy the snippet and paste it into your site.",
  },
  {
    value: "developer",
    label: "My developer will",
    hint: "Get a ready-to-send message with everything they need.",
  },
];

/**
 * "Who will add the line to your site?" (s120).
 *
 * The owner-champion — a business owner whose site someone else built —
 * usually can't paste a script tag, but their developer can, in five minutes.
 * "I'll do it myself" keeps the existing instructions exactly as they were (the
 * default, so nothing changes for the freelancer installing their own client's
 * site); "My developer will" swaps them for a message the owner sends.
 *
 * Native radios in a fieldset: arrow keys, labels and the group name come
 * from the platform, and the selection is announced without extra ARIA.
 */
export function InstallMethodChoice({
  embedScript,
  siteDomain,
  location,
  children,
}: InstallMethodChoiceProps) {
  const [method, setMethod] = useState<DataFastInstallMethod>("self");
  const name = useId();

  const choose = (next: DataFastInstallMethod) => {
    if (next === method) return;
    setMethod(next);
    trackGoal("install_method_selected", { method: next, location });
  };

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-semibold text-foreground">
          Who will add the line to your site?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const isSelected = method === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-container border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
                  isSelected
                    ? "border-primary bg-surface-1"
                    : "border-border hover:bg-surface-1",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={isSelected}
                  onChange={() => choose(option.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)] focus-visible:outline-none"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="block text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {method === "self" ? (
        children
      ) : (
        <DeveloperHandoffMessage
          embedScript={embedScript}
          siteDomain={siteDomain}
          location={location}
        />
      )}
    </div>
  );
}
