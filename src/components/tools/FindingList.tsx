import { Alert, AlertDescription } from "@/components/ui/alert";
import { CodeBlock } from "@/components/ui/code-block";
import type { Finding } from "@/lib/tools/lens";
import type { ToolReport } from "@/lib/tools/report/report-schema";
import { FindingInSentence, findingKindLabel } from "./FindingInSentence";

/**
 * A report's findings, grouped by page (s96). Generic: every tool's findings
 * render here, with no per-tool code (plan decision 6).
 *
 * - A link to a scanned page is drawn only for an http(s) URL, and carries
 *   `rel="nofollow ugc noopener noreferrer"`: a public report must not pass
 *   ranking to, or open a window handle for, whatever site a stranger scanned.
 * - `code` renders in `CodeBlock` (s97's directive lines).
 * - `imageSrc` renders as a "View image" LINK, never an `<img>`: a hotlinked
 *   image would hand every report viewer's IP address to the scanned site.
 * - No findings is a success state; a report whose lens skipped the site (not
 *   English, no text in the HTML) is an info state. Neither is ever drawn as
 *   an empty list.
 */

export const EXTERNAL_LINK_REL = "nofollow ugc noopener noreferrer";

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function PageLink({ url }: { url: string }) {
  if (!isWebUrl(url)) {
    return <span className="[overflow-wrap:anywhere]">{url}</span>;
  }
  return (
    <a
      href={url}
      rel={EXTERNAL_LINK_REL}
      target="_blank"
      className="font-semibold text-sky-700 underline-offset-2 hover:underline [overflow-wrap:anywhere]"
    >
      {url}
    </a>
  );
}

function FindingItem({ finding }: { finding: Finding }) {
  return (
    <li className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {findingKindLabel(finding.kind)}
      </p>
      <FindingInSentence finding={finding} />
      {finding.note ? (
        <p className="mt-2 text-sm text-slate-600">{finding.note}</p>
      ) : null}
      {finding.code ? (
        <CodeBlock
          className="mt-3"
          value={finding.code}
          copyLabel="Copy these lines"
        />
      ) : null}
      {finding.imageSrc ? (
        <p className="mt-3 text-sm">
          <a
            href={finding.imageSrc}
            rel={EXTERNAL_LINK_REL}
            target="_blank"
            className="font-semibold text-sky-700 hover:underline"
          >
            View image
          </a>
        </p>
      ) : null}
    </li>
  );
}

export function FindingList({ report }: { report: ToolReport }) {
  if (report.summary.verdict === "skipped") {
    return (
      <Alert variant="info">
        <AlertDescription>{report.summary.headline}</AlertDescription>
      </Alert>
    );
  }
  if (report.findings.length === 0) {
    return (
      <Alert variant="success">
        <AlertDescription>{report.summary.headline}</AlertDescription>
      </Alert>
    );
  }

  const groups = new Map<string, Finding[]>();
  for (const finding of report.findings) {
    const group = groups.get(finding.page) ?? [];
    group.push(finding);
    groups.set(finding.page, group);
  }

  return (
    <div className="space-y-10">
      {Array.from(groups.entries()).map(([page, findings]) => (
        <section key={page} className="min-w-0">
          <h3 className="mb-4 text-base text-slate-900">
            <PageLink url={page} />
          </h3>
          <ul className="space-y-4">
            {findings.map((finding, index) => (
              <FindingItem
                key={`${finding.match}-${index}`}
                finding={finding}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
