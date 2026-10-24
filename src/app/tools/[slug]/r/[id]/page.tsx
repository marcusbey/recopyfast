import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FindingList } from "@/components/tools/FindingList";
import { ReportSummary } from "@/components/tools/ReportSummary";
import { ToolCta } from "@/components/tools/ToolCta";
import { OwnerNextStep } from "@/components/tools/OwnerNextStep";
import { getToolEntry } from "@/lib/tools/catalogue";
import { loadReport } from "@/lib/tools/report/load-report";
import { PAGE_SKIP_REASONS } from "@/lib/tools/report/report-schema";

/**
 * A free-tool report: `/tools/<slug>/r/<id>` (s96, ADR 062).
 *
 * Rendered per request under the nonce CSP (see `layout.tsx`). Every string
 * from the scanned site is React text; links to scanned pages are http(s)
 * only with `rel="nofollow ugc noopener noreferrer"`; a scanned image is a
 * "View image" link, never an `<img>`. `noindex, nofollow`: a report is a
 * stranger's page, and it is neither in the sitemap nor disallowed in
 * robots.txt (a disallowed page's noindex is never read).
 */

type ReportRouteProps = {
  params: Promise<{ slug: string; id: string }>;
};

export async function generateMetadata({
  params,
}: ReportRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = getToolEntry(slug);
  return {
    title: entry ? `${entry.name} report` : "Report",
    robots: { index: false, follow: false },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default async function ToolReportPage({ params }: ReportRouteProps) {
  const { slug, id } = await params;
  const report = await loadReport(slug, id);
  const entry = getToolEntry(slug);
  if (!report || !entry) notFound();

  const isPartial = report.pages.some(
    (page) => page.reason === PAGE_SKIP_REASONS.timeLimit,
  );
  const skipped = report.pages.filter((page) => page.status === "skipped");
  const scannedOn = new Date(report.scannedAt).toUTCString();
  // s121: a report that found something leads with the owner next step.
  const hasIssues = report.findings.length > 0;

  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="px-6 pb-20 pt-32">
        <div className="mx-auto max-w-4xl space-y-8">
          <header>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
              {entry.name} report
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl [overflow-wrap:anywhere]">
              {hostOf(report.finalUrl)}
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Scanned {scannedOn}. Reports are public to anyone with this link
              and are kept for up to 30 days.
            </p>
          </header>

          <ReportSummary report={report} />

          {isPartial ? (
            <Alert variant="info">
              <AlertDescription>
                This report is partial: some pages were not reached within the
                scan&apos;s time limit.
              </AlertDescription>
            </Alert>
          ) : null}
          {report.truncated ? (
            <Alert variant="info">
              <AlertDescription>
                Only the first findings are shown; the report keeps a limited
                number.
              </AlertDescription>
            </Alert>
          ) : null}

          <FindingList report={report} />

          {skipped.length > 0 ? (
            <section aria-labelledby="pages-not-checked">
              <h2
                id="pages-not-checked"
                className="font-display text-xl font-bold text-slate-900"
              >
                Pages not checked
              </h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {skipped.map((page) => (
                  <li key={page.url} className="[overflow-wrap:anywhere]">
                    <span className="font-medium text-slate-800">
                      {page.url}
                    </span>
                    {page.reason ? ` — ${page.reason}` : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {hasIssues ? (
            <OwnerNextStep slug={entry.slug} hasIssues emphasis="primary" />
          ) : null}

          {entry.cta ? <ToolCta variant={entry.cta} slug={entry.slug} /> : null}

          {hasIssues ? null : (
            <OwnerNextStep
              slug={entry.slug}
              hasIssues={false}
              emphasis="secondary"
            />
          )}

          <p>
            {/* A native anchor: the tool page is a static document with its
                own policy. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href={`/tools/${entry.slug}`}
              className="font-semibold text-sky-700 hover:underline"
            >
              Scan another site
            </a>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
