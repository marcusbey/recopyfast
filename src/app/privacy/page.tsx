import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Shield, Lock, Eye, Database, Mail, AlertCircle } from "lucide-react";

// Until s88 this page inherited the root layout's canonical, which named the
// homepage. Every indexable page names itself.
export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
};

/**
 * s54 — every sentence on this page is backed by code or infrastructure, or is
 * a commitment the owner honours by hand (a mailbox, an email to users).
 *
 * Until s54 this page was boilerplate written before the product existed. It
 * promised SOC 2 Type II compliance, MFA enforcement, TLS 1.3, end-to-end and
 * client-side encryption, audit logs, RBAC, SIEM, a 24/7 SOC, IDS/IPS,
 * retention periods (12 months, 7 years, 3 years) and cryptographic erasure,
 * AWS and Google Cloud hosting, a cookie banner, a Data Protection Officer and
 * an EU representative. None of it was backed: there is no audit, settings
 * says two-factor is "Not available yet", Vercel and Fly both accept TLS 1.2,
 * the only crons generate blog posts and dispatch webhooks, and the
 * "representative" was our own mailbox. Signing in binds users to this page.
 *
 * Do not restore "standard" privacy copy. A new claim needs its evidence first
 * (the inventory is docs/research/s54-legal-pages-truth.md), and a new
 * commitment needs the owner. src/__tests__/app/legal-pages-truth.test.tsx
 * fails if a graveyard feature or a removed claim comes back.
 */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-24">
        {/* Hero section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-100 mb-6">
            <Shield className="w-8 h-8 text-sky-600" />
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-4">
            Privacy Policy
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Your privacy matters. We&apos;re committed to protecting your data
            with transparency and care.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-slate-500">
            <span>
              <strong>Effective:</strong> September 28, 2026
            </span>
            <span className="hidden sm:inline">|</span>
            <span>
              <strong>Last Updated:</strong> October 12, 2026
            </span>
          </div>
        </div>

        {/* Quick summary cards */}
        <div className="grid sm:grid-cols-3 gap-4 mb-16">
          <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
            <Lock className="w-6 h-6 text-sky-600 mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">
              Encrypted Data
            </h3>
            <p className="text-sm text-slate-600">
              AES-256 at rest in our database, TLS in transit
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
            <Eye className="w-6 h-6 text-sky-600 mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">No Data Sales</h3>
            <p className="text-sm text-slate-600">
              We never sell your personal information
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
            <Database className="w-6 h-6 text-sky-600 mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">Your Control</h3>
            {/* Not "anytime": without a plan, the middleware sends every
                dashboard page but Billing to checkout, so the export and
                site-deletion screens are out of reach (s54 review). */}
            <p className="text-sm text-slate-600">
              Export your site content or delete a site from your dashboard
              while your plan is active. After it ends, email{" "}
              <a
                href="mailto:privacy@recopyfa.st"
                className="text-sky-600 hover:underline font-medium"
              >
                privacy@recopyfa.st
              </a>{" "}
              and we will export or delete it for you.
            </p>
          </div>
        </div>

        {/* Main content */}
        <div className="prose prose-slate max-w-none">
          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                1
              </span>
              Information We Collect
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              1.1 Information You Provide
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                Email address and profile information when you create an account
              </li>
              <li>
                Website domains and associated metadata when you register sites
              </li>
              <li>
                Content modifications and version history made through our
                service
              </li>
              <li>
                Payment information (processed securely by third-party
                providers)
              </li>
              <li>Support communications and feedback</li>
              <li>API keys and integration settings</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              1.2 Automatically Collected Information
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>Usage analytics and feature interaction data</li>
              {/* Not "hashed": IPs are stored raw in edit_sessions and
                  user_activity_logs, and hashed only in log lines. No
                  geolocation either: only the parked A/B bucket route derives
                  a location. Re-add a location disclosure when A/B ships
                  (s11b/s12). */}
              <li>IP addresses</li>
              <li>Browser and device information for compatibility</li>
              <li>Session data and authentication tokens</li>
              <li>Performance metrics and error logs</li>
              <li>Security event logs and access patterns</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              1.3 Website Integration Data
            </h3>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>
                Website structure and content elements (for editing
                functionality)
              </li>
              <li>Edit session tokens and authentication data</li>
              <li>Script integration status and configuration</li>
            </ul>

            {/* s96 (architect decision 9, 2026-10-11): factual wording only,
                each line backed by the scan route and its migration —
                src/app/api/tools/scan/route.ts, src/lib/tools/scan/*,
                supabase/migrations/20261011120000_tool_reports.sql. */}
            <h3 className="text-lg font-medium text-slate-800 mb-3 mt-6">
              1.4 Free Website Tools
            </h3>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>
                When you run a free tool, we process the website address you
                enter, without anything after a ? or #, and the public text of
                the pages we read from that site.
              </li>
              <li>
                Your IP address is used only to limit how many scans can be run
                from it. Our rate limiter holds it for about 24 hours, and it is
                never stored with a report.
              </li>
              <li>
                The report is stored with short excerpts of that public page
                text. It is public to anyone with its link and is kept for up to
                30 days.
              </li>
              <li>
                A site owner can keep our scanner, RecopyFastToolsBot, off their
                site with a robots.txt rule; the scanner checks robots.txt
                before reading a page.
              </li>
            </ul>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                2
              </span>
              How We Use Your Information
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              2.1 Service Delivery
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                Provide secure content editing and management capabilities
              </li>
              <li>Maintain user accounts and authentication systems</li>
              <li>
                Process and store content modifications with version control
              </li>
              <li>Generate AI rewrite suggestions</li>
              <li>Ensure cross-browser and device compatibility</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              2.2 Security
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>Monitor for security threats and unauthorized access</li>
              <li>Prevent fraud, abuse, and malicious activities</li>
              <li>Implement access controls and session management</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              2.3 Service Improvement
            </h3>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>Analyze usage patterns to enhance user experience</li>
              <li>Optimize performance and reduce loading times</li>
              <li>Develop new features based on user needs</li>
              <li>Send important service notifications and security updates</li>
              <li>Provide customer support and technical assistance</li>
            </ul>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                3
              </span>
              Information Sharing & Data Transfers
            </h2>

            <div className="bg-sky-50 border-l-4 border-sky-400 p-4 mb-6 rounded-r-lg">
              <p className="text-sm text-sky-800">
                <strong>Zero-Sale Policy:</strong> We never sell, trade, or rent
                your personal information to third parties. Your data is not a
                product.
              </p>
            </div>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              3.1 Limited Sharing Circumstances
            </h3>
            <p className="text-slate-600 mb-4">
              We may share information only in these strictly limited
              circumstances:
            </p>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>With your explicit, informed consent</li>
              <li>
                To comply with valid legal processes (subpoenas, court orders)
              </li>
              <li>
                To protect against immediate threats to safety or security
              </li>
              <li>
                In connection with business transfers (with continued privacy
                protection)
              </li>
              <li>
                With the service providers listed below, who process data on our
                behalf to run the Service
              </li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              3.2 Service Providers & Processors
            </h3>
            <p className="text-slate-600 mb-4">
              We use these service providers to run ReCopyFast:
            </p>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                Vercel — hosts the website, the API and the ReCopyFast script
              </li>
              <li>Supabase — database, sign-in and image storage</li>
              <li>Fly.io — the real-time editing server</li>
              <li>Stripe — payments</li>
              <li>
                OpenAI — generates AI rewrite suggestions from the text you
                submit
              </li>
              <li>Resend — transactional email</li>
              <li>Upstash — rate limiting</li>
              <li>Sentry — error monitoring</li>
              {/* s107: Google LLC, on the public pages only — see section 6. */}
              <li>
                Google Analytics — visit statistics for our public pages (see
                section 6)
              </li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              3.3 International Transfers
            </h3>
            <p className="text-slate-600">
              Some of these providers process data in the United States. Our
              real-time server runs in Fly.io&apos;s US-East region.
            </p>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                4
              </span>
              Data Security & Protection
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              4.1 Encryption & Data Protection
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>AES-256 encryption at rest for our database (Supabase)</li>
              {/* Not "TLS 1.3": on 2026-09-28 both www.recopyfa.st (Vercel)
                  and recopyfast-ws.fly.dev (Fly) still accepted TLS 1.2. */}
              <li>TLS encryption for data in transit</li>
              <li>Encrypted database connections</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              4.2 Access Controls & Authentication
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              {/* Not MFA: owners have no password to add a factor to, and
                  settings says two-factor is "Not available yet". Claim 2FA
                  only once it ships. */}
              <li>
                Passwordless sign-in: a one-time email link for account owners,
                a one-time code for invited editors
              </li>
              <li>
                Per-site permissions for invited editors: view, edit, publish or
                admin
              </li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              4.3 Monitoring
            </h3>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>Automated rate limiting on the API</li>
              <li>Error monitoring with Sentry</li>
            </ul>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                5
              </span>
              Your Privacy Rights & Controls
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              5.1 Your Data Protection Rights
            </h3>
            <p className="text-slate-600 mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                <strong>Access:</strong> Request copies of your personal data
                and understand how it&apos;s processed
              </li>
              <li>
                <strong>Rectification:</strong> Correct inaccurate or incomplete
                personal information
              </li>
              <li>
                <strong>Erasure:</strong> Request deletion of your personal data
                (&ldquo;right to be forgotten&rdquo;)
              </li>
              <li>
                <strong>Portability:</strong> Export your data in a structured,
                machine-readable format
              </li>
              <li>
                <strong>Restriction:</strong> Limit the processing of your
                personal information
              </li>
              <li>
                <strong>Objection:</strong> Object to processing based on
                legitimate interests
              </li>
              <li>
                <strong>Opt-out:</strong> Withdraw consent or opt out of
                marketing communications
              </li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              5.2 Exercising Your Rights
            </h3>
            <p className="text-slate-600">
              To exercise any of these rights, contact us at{" "}
              <a
                href="mailto:privacy@recopyfa.st"
                className="text-sky-600 hover:underline font-medium"
              >
                privacy@recopyfa.st
              </a>
              . We will respond within 30 days and may require identity
              verification for security.
            </p>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                6
              </span>
              Cookies & Tracking
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              Types of Cookies We Use
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                <strong>Essential:</strong> Required for authentication and
                basic functionality
              </li>
              <li>
                <strong>Functional:</strong> Remember your preferences and
                settings
              </li>
              <li>
                <strong>Analytics:</strong> Google Analytics on our public
                pages, described below
              </li>
            </ul>

            <p className="text-slate-600 mb-8">
              You can control cookies through your browser settings.
            </p>

            {/*
              s107 (ADR 063). Every sentence below is what the code or the GA
              property does, recorded in docs/operations/analytics.md:
              - the pages: isAnalyticsRoute (src/lib/analytics/google-analytics/routes.ts);
              - what is sent: page-location.ts and gtag.ts (no query string but
                utm_*, no fragment, slug-only event values);
              - the consent rule: consent.ts (EEA + UK + CH + Quebec, fail-closed) and
                GoogleAnalytics.tsx (nothing requested before "Allow analytics");
              - the cookies: CONSENT_COOKIE_* and GA_COOKIE_EXPIRES_SECONDS;
              - 14 months, signals off, ads personalisation off, no city-level
                location in the EEA/UK/CH: the GA admin settings.
              No "cookie consent" phrase and no "geolocation": the s54 tripwires
              in legal-pages-truth.test.tsx stay as they are.
            */}
            <div id="analytics" className="scroll-mt-24">
              <h3 className="text-lg font-medium text-slate-800 mb-3">
                Google Analytics
              </h3>
              <p className="text-slate-600 mb-4">
                On our public pages — the homepage, comparisons, free tools, the
                /try preview, the blog, the documentation, pricing, the demo and
                these legal pages — we use Google Analytics 4, provided by
                Google LLC, to count visits and see which pages and links are
                used. It never runs in your dashboard, on our sign-in and
                sign-up pages, in the editor, on a free tool&apos;s scan report,
                or in the ReCopyFast script on your website.
              </p>
              <ul className="list-disc pl-6 mb-4 text-slate-600 space-y-2">
                <li>
                  <strong>What is sent:</strong> the pages you view (their
                  address without the query string — campaign tags such as
                  utm_source are kept on the page you arrive on — and never the
                  part after #), the page you came from, clicks on sign-up and
                  checkout links, that a free tool scan or calculation completed
                  (which tool, never the address you scanned), use of the /try
                  sample, scrolling to the end of a page, links to other sites
                  and file downloads. Google adds your browser and device type
                  and an approximate location it derives from your IP address.
                  In the European Economic Area, the United Kingdom and
                  Switzerland, city-level location and detailed device data are
                  not collected.
                </li>
                <li>
                  <strong>Your choice:</strong> in the European Economic Area,
                  the United Kingdom, Switzerland and Quebec, Google Analytics
                  does not load until you choose &ldquo;Allow analytics&rdquo;
                  in the banner. To know whether to ask, we use the country —
                  and in Canada the province — our host, Vercel, reports for the
                  request; it is not stored. When it cannot tell, it asks.
                  Elsewhere it loads with analytics allowed, and you can
                  decline. Advertising storage is denied everywhere: we run no
                  ads, Google signals and ad personalisation are off, and the
                  data is not used for advertising.
                </li>
                <li>
                  <strong>Cookies:</strong> Google Analytics sets{" "}
                  <code>_ga</code> and <code>_ga_&lt;ID&gt;</code> on our
                  domain, only once analytics is allowed. They expire after 13
                  months unless you visit again. We set{" "}
                  <code>{"rcf_analytics_consent"}</code> to remember your answer
                  for 6 months. After Allow, a separate secure cookie records
                  when our server received that choice and its expiry, for at
                  most 180 days. This receipt contains no account or Analytics
                  identifier and is cleared when you withdraw consent. Signing
                  out clears the separate identifier context.
                </li>
                <li>
                  <strong>First-party conversion attribution:</strong> while
                  analytics is allowed, we retain its pseudonymous client ID
                  with an opaque, secure browser cookie for up to 30 days from
                  an eligible public visit, never beyond your consent expiry.
                  This can connect a confirmed signup or payment after the
                  14-day trial to your visit. No Google script runs on private
                  account, authentication or report pages. Analytics is a
                  consented subset; our account and billing records remain the
                  complete business records.
                </li>
                <li>
                  <strong>Context deletion:</strong> withdrawal requests erase
                  the retained identifiers; expiry immediately prevents further
                  use. A cleanup job normally removes expired records within
                  five minutes. An outage may delay deletion but cannot extend
                  eligibility. We alert on cleanup more than ten minutes
                  overdue. Failed withdrawal requests retry on your next
                  same-origin interaction. Requests already claimed for delivery
                  may still arrive, and data already sent cannot be recalled by
                  this control. Minimal internal conversion records follow the
                  underlying account and billing retention; they are sensitive,
                  not anonymous.
                </li>
                <li>
                  <strong>Retention:</strong> Google Analytics keeps this data
                  for 14 months, then deletes it. A new visit does not extend
                  that period.
                </li>
                <li>
                  <strong>Opting out:</strong> choose &ldquo;Decline&rdquo; in
                  the banner; reopen it with &ldquo;Cookie settings&rdquo; at
                  the bottom of any public page to change your answer (declining
                  also deletes the <code>_ga</code> cookies); or install the{" "}
                  <a
                    href="https://tools.google.com/dlpage/gaoptout"
                    className="text-sky-600 hover:underline font-medium"
                    rel="noopener noreferrer"
                  >
                    Google Analytics opt-out browser add-on
                  </a>
                  .
                </li>
              </ul>
            </div>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                7
              </span>
              Data Retention
            </h2>

            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                <strong>Account Data:</strong> Retained for the duration of your
                account
              </li>
              <li>
                <strong>Content Data:</strong> Retained as long as needed for
                service delivery
              </li>
              <li>
                <strong>Free tool reports:</strong> Kept for up to 30 days
              </li>
            </ul>
          </section>

          <section className="bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-6 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                8
              </span>
              Contact Us
            </h2>

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 mb-1">
                    Privacy Requests
                  </h4>
                  <a
                    href="mailto:privacy@recopyfa.st"
                    className="text-sky-600 hover:underline text-sm"
                  >
                    privacy@recopyfa.st
                  </a>
                  <p className="text-xs text-slate-500 mt-1">
                    Privacy rights & policy questions
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 mb-1">
                    Security Issues
                  </h4>
                  <a
                    href="mailto:privacy@recopyfa.st"
                    className="text-sky-600 hover:underline text-sm"
                  >
                    privacy@recopyfa.st
                  </a>
                  <p className="text-xs text-slate-500 mt-1">
                    Security concerns & vulnerability reports
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 mb-1">
                    General Support
                  </h4>
                  <a
                    href="mailto:support@recopyfa.st"
                    className="text-sky-600 hover:underline text-sm"
                  >
                    support@recopyfa.st
                  </a>
                  <p className="text-xs text-slate-500 mt-1">
                    General inquiries & technical support
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 p-4 bg-sky-50 rounded-xl">
              <p className="text-sm text-slate-600">
                <strong>Response Time:</strong> We respond to privacy requests
                within 30 days.
              </p>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
