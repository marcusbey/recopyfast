import type { Finding } from "@/lib/tools/lens";

/**
 * One finding, shown in the sentence it sits in (s96).
 *
 * Every string here came off a stranger's web page. It is rendered as React
 * TEXT only — no `dangerouslySetInnerHTML` anywhere under
 * `src/components/tools/` (pinned by a source scan) — so `<script>` in a
 * scanned page reads as the characters "<script>". The report route also runs
 * under the nonce CSP, so an escaping bug would still not run an injected
 * script or handler (ADR 062).
 *
 * The match sits in a `<mark>`; screen readers hear where it starts and ends,
 * because a highlight is not announced.
 */

const KIND_LABELS: Record<string, string> = {
  typo: "possible typo",
  repeated: "repeated word",
};

export function findingKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "flagged text";
}

export function FindingInSentence({ finding }: { finding: Finding }) {
  const label = findingKindLabel(finding.kind);
  return (
    <div className="min-w-0">
      <p className="leading-relaxed text-slate-700 [overflow-wrap:anywhere]">
        {finding.before}
        <mark className="rounded-sm bg-amber-200 px-0.5 font-semibold text-slate-900">
          <span className="sr-only">{`Start of ${label}: `}</span>
          {finding.match}
          <span className="sr-only">{` (end of ${label})`}</span>
        </mark>
        {finding.after}
      </p>
      {finding.suggestion ? (
        <p className="mt-2 text-sm text-slate-600">
          Suggestion:{" "}
          <strong className="text-slate-900">{finding.suggestion}</strong>
        </p>
      ) : null}
    </div>
  );
}
