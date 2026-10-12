import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { Verdict } from "@/lib/tools/lens";
import type { ToolReport } from "@/lib/tools/report/report-schema";

const VERDICTS: Record<
  Verdict,
  { label: string; tone: BadgeProps["variant"] }
> = {
  pass: { label: "Looks good", tone: "tone-success" },
  warn: { label: "Worth a look", tone: "tone-warning" },
  fail: { label: "Needs fixing", tone: "tone-danger" },
  info: { label: "For information", tone: "tone-info" },
  skipped: { label: "Not checked", tone: "tone-neutral" },
};

/** The report's verdict, headline and facts (s96). Text only. */
export function ReportSummary({ report }: { report: ToolReport }) {
  const verdict = VERDICTS[report.summary.verdict];
  return (
    <section
      aria-labelledby="report-summary"
      className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
    >
      <Badge variant={verdict.tone} size="lg">
        {verdict.label}
      </Badge>
      <h2
        id="report-summary"
        className="mt-4 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
      >
        {report.summary.headline}
      </h2>
      {report.summary.facts.length > 0 ? (
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {report.summary.facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-sm text-slate-500">{fact.label}</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
