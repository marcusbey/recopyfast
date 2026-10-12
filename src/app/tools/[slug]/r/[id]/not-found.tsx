import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

/**
 * A report that does not exist, has expired, belongs to another tool or could
 * not be read back (s96). One message for all of them: which of the four it
 * was is nobody's business, and "expired" is the likeliest. Rendered below the
 * report layout, so per request, under the nonce policy.
 */
export default function ToolReportNotFound() {
  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="px-6 pb-24 pt-36">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">
            This report isn&apos;t available
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            The link may be mistyped, or the report may have expired. Reports
            are kept for 30 days, and when many scans run at once older ones can
            be removed sooner.
          </p>
          {/* A native anchor: leaving the nonce document for a static page
              loads that page's own policy. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/tools"
            className="pressable mt-8 inline-flex items-center rounded-full bg-slate-900 px-7 py-3.5 font-semibold text-white hover:bg-slate-800"
          >
            Run a new scan
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}
