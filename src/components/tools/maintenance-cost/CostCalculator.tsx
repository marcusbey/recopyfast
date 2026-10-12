"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CURRENCIES,
  INPUT_LIMITS,
  calculateCost,
  clampInputs,
  describeFieldIssue,
  type Currency,
  type NumericField,
} from "@/lib/tools/maintenance-cost/calculate";
import {
  CARD_BODY,
  CARD_HEADING,
  HONESTY_LINE,
  RESULT_LABEL,
} from "@/lib/tools/maintenance-cost/copy";
import {
  parseParams,
  serializeParams,
} from "@/lib/tools/maintenance-cost/params";
import { CostResultCard } from "./CostResultCard";
import { EmbedSnippet } from "./EmbedSnippet";

/** How long typing must pause before the address bar follows. */
const URL_SYNC_DEBOUNCE_MS = 300;

type FieldSpec = {
  field: NumericField;
  label: string;
  hint: string;
  inputMode: "numeric" | "decimal";
};

const FIELDS: readonly FieldSpec[] = [
  {
    field: "sites",
    label: "Sites you maintain",
    hint: "Client sites you make copy changes on.",
    inputMode: "numeric",
  },
  {
    field: "changesPerSiteMonthly",
    label: "Copy changes per site, per month",
    hint: "An average month, in steps of half a change.",
    inputMode: "decimal",
  },
  {
    field: "minutesPerChange",
    label: "Minutes per change",
    hint: "Reading the request, editing, checking, replying.",
    inputMode: "numeric",
  },
  {
    field: "hourlyRate",
    label: "Hourly rate",
    hint: "What an hour of your time is worth, in the currency below.",
    inputMode: "numeric",
  },
  {
    field: "billedPercent",
    label: "Share of changes you bill (%)",
    hint: "0 if you do all of them for free.",
    inputMode: "numeric",
  },
];

type FieldTexts = Record<NumericField, string>;

export function CostCalculator({ siteOrigin }: { siteOrigin: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL seeds the state once. After that the text boxes are the source of
  // truth and the URL follows them, so a half-typed value is never fought by a
  // router round trip.
  const [initial] = React.useState(() => parseParams(searchParams));
  const [texts, setTexts] = React.useState<FieldTexts>(() => ({
    sites: String(initial.sites),
    changesPerSiteMonthly: String(initial.changesPerSiteMonthly),
    minutesPerChange: String(initial.minutesPerChange),
    hourlyRate: String(initial.hourlyRate),
    billedPercent: String(initial.billedPercent),
  }));
  const [currency, setCurrency] = React.useState<Currency>(initial.currency);

  const result = calculateCost(clampInputs({ ...texts, currency }));
  const query = serializeParams(result.inputs);

  const syncedQuery = React.useRef(serializeParams(initial));
  React.useEffect(() => {
    if (query === syncedQuery.current) return;
    const timer = setTimeout(() => {
      syncedQuery.current = query;
      router.replace(`${pathname}?${query}`, { scroll: false });
    }, URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, pathname, router]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
      <form
        className="min-w-0 space-y-5 self-start rounded-container border border-border bg-card p-5 sm:p-6"
        onSubmit={(event) => event.preventDefault()}
        noValidate
      >
        {FIELDS.map(({ field, label, hint, inputMode }) => {
          const limit = INPUT_LIMITS[field];
          const issue = describeFieldIssue(field, texts[field]);
          const hintId = `${field}-hint`;
          const issueId = `${field}-issue`;
          return (
            <div key={field} className="space-y-2">
              <Label htmlFor={field}>{label}</Label>
              <Input
                id={field}
                type="number"
                inputMode={inputMode}
                min={limit.min}
                max={limit.max}
                step={limit.step}
                value={texts[field]}
                aria-invalid={issue ? true : undefined}
                aria-describedby={issue ? `${hintId} ${issueId}` : hintId}
                onChange={(event) => {
                  const value = event.target.value;
                  setTexts((current) => ({ ...current, [field]: value }));
                }}
              />
              <p id={hintId} className="text-sm text-muted-foreground">
                {hint}
              </p>
              {issue ? (
                <p
                  id={issueId}
                  className="text-sm font-medium text-destructive"
                >
                  {issue}
                </p>
              ) : null}
            </div>
          );
        })}

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <NativeSelect
            id="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </NativeSelect>
        </div>
      </form>

      <div className="min-w-0 space-y-8">
        <section aria-labelledby="result-heading" className="space-y-4">
          <h2 id="result-heading" className="text-eyebrow">
            Your numbers
          </h2>
          <div
            role="status"
            aria-live="polite"
            aria-label="Result"
            className="rounded-container border border-border bg-card p-5 sm:p-6"
          >
            <p className="text-sm text-muted-foreground">{RESULT_LABEL}</p>
            <p className="mt-1 break-words font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {result.formatted.unbilledYearly}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-foreground">
              {result.formula}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{HONESTY_LINE}</p>
        </section>

        <section aria-labelledby="card-heading" className="space-y-4">
          <h2 id="card-heading" className="text-lg font-semibold">
            {CARD_HEADING}
          </h2>
          <p className="text-sm text-muted-foreground">{CARD_BODY}</p>
          <CostResultCard result={result} />
          <EmbedSnippet result={result} siteOrigin={siteOrigin} />
        </section>
      </div>
    </div>
  );
}
