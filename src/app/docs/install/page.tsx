import type { Metadata } from "next";
import Link from "next/link";
import { Download, ExternalLink, Zap } from "lucide-react";
import Footer from "@/components/layout/Footer";
import { AgentInstructionsCopy } from "@/components/docs/AgentInstructionsCopy";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AGENT_INSTALLATION_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_DOWNLOAD_PATH,
  INSTALLATION_EXAMPLE,
  INSTALLATION_GUIDE,
} from "@/lib/docs/installation-content";

const DESCRIPTION =
  "Install the ReCopyFast snippet, verify page coverage, and hand a bounded installation brief to your agent.";

export const metadata: Metadata = {
  title: "Installation guide",
  description: DESCRIPTION,
  alternates: { canonical: "/docs/install" },
  openGraph: {
    type: "article",
    url: "/docs/install",
    siteName: "ReCopyFast",
    title: "Installation guide | ReCopyFast",
    description: DESCRIPTION,
    locale: "en_US",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Installation guide | ReCopyFast",
    description: DESCRIPTION,
    images: ["/twitter-image"],
  },
};

const contents = [
  { href: `#${INSTALLATION_GUIDE.copySnippet.id}`, label: "Copy your snippet" },
  { href: `#${INSTALLATION_GUIDE.pageScope.id}`, label: "Choose page scope" },
  { href: `#${INSTALLATION_GUIDE.install.id}`, label: "Add the snippet" },
  {
    href: `#${INSTALLATION_GUIDE.verify.id}`,
    label: "Verify the installation",
  },
  { href: `#${INSTALLATION_GUIDE.invite.id}`, label: "Invite and test" },
  {
    href: `#${INSTALLATION_GUIDE.troubleshooting.id}`,
    label: "Troubleshooting",
  },
  { href: "#agent-brief", label: "Agent installation brief" },
] as const;

const SECTION_HEADING_CLASS_NAME =
  "text-2xl font-semibold leading-tight tracking-[-0.014em]";
const SUBSECTION_HEADING_CLASS_NAME =
  "text-xl font-semibold leading-tight tracking-[-0.014em]";
const ALERT_HEADING_CLASS_NAME = "mb-1 font-medium leading-none tracking-tight";

function ContentsLinks() {
  return (
    <ol className="space-y-2 text-sm">
      {contents.map((item) => (
        <li key={item.href}>
          <a
            href={item.href}
            className="inline-flex min-h-8 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.label}
          </a>
        </li>
      ))}
    </ol>
  );
}

export default function InstallGuidePage() {
  const guide = INSTALLATION_GUIDE;

  return (
    <div
      data-theme="light"
      className="min-h-screen bg-background font-sans text-foreground"
    >
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-md font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Zap className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-xl">ReCopyFast</span>
          </Link>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/sites">Sites</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="border-b border-border bg-card px-6 py-14 sm:py-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
              Installation guide
            </p>
            <h1 className="mt-4 font-sans text-4xl font-semibold leading-[1.17] tracking-[-0.025em] sm:text-[2.625rem]">
              {guide.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {guide.introduction}
            </p>
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground">
              {guide.requirement}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
          <details className="mb-8 rounded-xl border border-border bg-card p-5 shadow-sm lg:hidden">
            <summary className="cursor-pointer font-semibold">
              On this page
            </summary>
            <div className="mt-4">
              <ContentsLinks />
            </div>
          </details>

          <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <nav
                aria-label="Installation guide contents"
                className="sticky top-6 rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <p className="mb-4 font-semibold">On this page</p>
                <ContentsLinks />
              </nav>
            </aside>

            <article className="min-w-0 space-y-8">
              <section id={guide.copySnippet.id} className="scroll-mt-6">
                <Card>
                  <CardHeader>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      {guide.copySnippet.title}
                    </h2>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <ol className="list-decimal space-y-3 pl-5 text-foreground">
                      {guide.copySnippet.steps.map((step) => (
                        <li key={step} className="pl-1 leading-relaxed">
                          {step}
                        </li>
                      ))}
                    </ol>
                    <Alert variant="info">
                      <h3 className={ALERT_HEADING_CLASS_NAME}>
                        Use the final hostname
                      </h3>
                      <AlertDescription>
                        <p>{guide.copySnippet.hostnameGuidance}</p>
                      </AlertDescription>
                    </Alert>

                    <div>
                      <h3 className={SUBSECTION_HEADING_CLASS_NAME}>
                        What the generated snippet looks like
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {guide.copySnippet.exampleLead}
                      </p>
                      <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-2 p-4 font-mono text-sm leading-relaxed text-foreground">
                        <code data-testid="installation-example">
                          {INSTALLATION_EXAMPLE.displaySnippet}
                        </code>
                      </pre>
                    </div>

                    <div
                      className="overflow-x-auto rounded-lg border border-border"
                      role="region"
                      aria-label="Snippet attributes"
                      tabIndex={0}
                    >
                      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-3 font-semibold" scope="col">
                              Part
                            </th>
                            <th className="px-4 py-3 font-semibold" scope="col">
                              Purpose
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {guide.copySnippet.snippetParts.map((part) => (
                            <tr
                              key={part.attribute}
                              className="border-t border-border"
                            >
                              <th className="px-4 py-3 align-top" scope="row">
                                <code className="font-mono text-xs">
                                  {part.attribute}
                                </code>
                              </th>
                              <td className="px-4 py-3 leading-relaxed text-muted-foreground">
                                {part.purpose}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <Alert variant="warning">
                      <h3 className={ALERT_HEADING_CLASS_NAME}>
                        Keep the generated credentials intact
                      </h3>
                      <AlertDescription>
                        <p>{guide.copySnippet.tokenGuidance}</p>
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              </section>

              <section id={guide.pageScope.id} className="scroll-mt-6">
                <Card>
                  <CardHeader>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      {guide.pageScope.title}
                    </h2>
                  </CardHeader>
                  <CardContent className="space-y-5 text-foreground">
                    <ul className="list-disc space-y-3 pl-5">
                      {guide.pageScope.choices.map((choice) => (
                        <li key={choice} className="pl-1 leading-relaxed">
                          {choice}
                        </li>
                      ))}
                    </ul>
                    <p className="leading-relaxed">
                      {guide.pageScope.instanceGuidance}
                    </p>
                    <p className="leading-relaxed">
                      {guide.pageScope.permissionGuidance}
                    </p>
                  </CardContent>
                </Card>
              </section>

              <section id={guide.install.id} className="scroll-mt-6">
                <Card>
                  <CardHeader>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      {guide.install.title}
                    </h2>
                  </CardHeader>
                  <CardContent className="space-y-8">
                    {guide.install.platforms.map((platform) => (
                      <div key={platform.id} className="space-y-3">
                        <h3 className={SUBSECTION_HEADING_CLASS_NAME}>
                          {platform.title}
                        </h3>
                        {platform.paragraphs.map((paragraph) => (
                          <p
                            key={paragraph}
                            className="leading-relaxed text-foreground"
                          >
                            {paragraph}
                          </p>
                        ))}
                        {platform.bullets && (
                          <ul className="list-disc space-y-3 pl-5 text-foreground">
                            {platform.bullets.map((bullet) => (
                              <li key={bullet} className="pl-1 leading-relaxed">
                                {bullet}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}

                    <Alert variant="info">
                      <h3 className={ALERT_HEADING_CLASS_NAME}>
                        {guide.install.renderingTitle}
                      </h3>
                      <AlertDescription>
                        <p>{guide.install.renderingGuidance}</p>
                      </AlertDescription>
                    </Alert>

                    <Alert variant="warning">
                      <h3 className={ALERT_HEADING_CLASS_NAME}>
                        {guide.install.analyticsTitle}
                      </h3>
                      <AlertDescription className="space-y-2">
                        {guide.install.analyticsParagraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              </section>

              <section id={guide.verify.id} className="scroll-mt-6">
                <Card>
                  <CardHeader>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      {guide.verify.title}
                    </h2>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <ol className="list-decimal space-y-3 pl-5 text-foreground">
                      {guide.verify.steps.map((step) => (
                        <li key={step} className="pl-1 leading-relaxed">
                          {step}
                        </li>
                      ))}
                    </ol>
                    <Alert variant="info">
                      <h3 className={ALERT_HEADING_CLASS_NAME}>
                        Keep CSP changes narrow
                      </h3>
                      <AlertDescription>
                        <p>{guide.verify.cspGuidance}</p>
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              </section>

              <section id={guide.invite.id} className="scroll-mt-6">
                <Card>
                  <CardHeader>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      {guide.invite.title}
                    </h2>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <ol className="list-decimal space-y-3 pl-5 text-foreground">
                      {guide.invite.steps.map((step) => (
                        <li key={step} className="pl-1 leading-relaxed">
                          {step}
                        </li>
                      ))}
                    </ol>
                    <p className="leading-relaxed text-foreground">
                      {guide.invite.planGuidance}
                    </p>
                  </CardContent>
                </Card>
              </section>

              <section id={guide.troubleshooting.id} className="scroll-mt-6">
                <Card>
                  <CardHeader>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      {guide.troubleshooting.title}
                    </h2>
                  </CardHeader>
                  <CardContent>
                    <div
                      className="overflow-x-auto rounded-lg border border-border"
                      role="region"
                      aria-label="Installation troubleshooting"
                      tabIndex={0}
                    >
                      <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-3 font-semibold" scope="col">
                              What you see
                            </th>
                            <th className="px-4 py-3 font-semibold" scope="col">
                              What to check
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {guide.troubleshooting.rows.map((row) => (
                            <tr
                              key={row.symptom}
                              className="border-t border-border"
                            >
                              <th
                                className="px-4 py-3 align-top font-semibold"
                                scope="row"
                              >
                                {row.symptom}
                              </th>
                              <td className="px-4 py-3 leading-relaxed text-muted-foreground">
                                {row.checks}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section id={guide.rollback.id} className="scroll-mt-6">
                <Card>
                  <CardHeader>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      {guide.rollback.title}
                    </h2>
                  </CardHeader>
                  <CardContent>
                    <p className="leading-relaxed text-foreground">
                      {guide.rollback.guidance}
                    </p>
                  </CardContent>
                </Card>
              </section>

              <section id="agent-brief" className="scroll-mt-6">
                <Card variant="elevated">
                  <CardHeader>
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                      Agent handoff
                    </p>
                    <h2 className={SECTION_HEADING_CLASS_NAME}>
                      Agent installation brief
                    </h2>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <p className="leading-relaxed text-foreground">
                      Give this brief to an agent that can inspect and publish
                      the website. Replace the bracketed inputs first. The exact
                      same Markdown is available to copy or download.
                    </p>
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                      <AgentInstructionsCopy
                        instructions={AGENT_INSTALLATION_INSTRUCTIONS}
                      />
                      <Button asChild variant="outline">
                        <a href={AGENT_INSTRUCTIONS_DOWNLOAD_PATH} download>
                          <Download aria-hidden="true" />
                          Download Markdown
                        </a>
                      </Button>
                    </div>
                    <pre
                      data-testid="agent-installation-brief"
                      className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-4 font-mono text-xs leading-relaxed text-foreground sm:p-5"
                      tabIndex={0}
                    >
                      {AGENT_INSTALLATION_INSTRUCTIONS}
                    </pre>
                  </CardContent>
                </Card>
              </section>

              <p className="text-sm text-muted-foreground">
                Need help with a platform-specific blocker? Email{" "}
                <a
                  href="mailto:support@recopyfa.st"
                  className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
                >
                  support@recopyfa.st
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                .
              </p>
            </article>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
