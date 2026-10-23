import type { ReactNode } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import Footer from "@/components/layout/Footer";

export interface DocsPageShellProps {
  eyebrow: string;
  title: string;
  introduction: ReactNode;
  children: ReactNode;
}

/**
 * The frame of a single-topic install guide (s120: the developer guide and
 * the WordPress guide). Same header, hero and footer as `/docs/install`, with
 * a single readable column: these pages are short, so they need no contents
 * rail. Server component — the pages stay static.
 */
export function DocsPageShell({
  eyebrow,
  title,
  introduction,
  children,
}: DocsPageShellProps) {
  return (
    <div
      data-theme="light"
      className="min-h-screen bg-background font-sans text-foreground"
    >
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-md font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Zap className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-xl">ReCopyFast</span>
          </Link>
          <Link
            href="/docs/install"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Installation guide
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b border-border bg-card px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
              {eyebrow}
            </p>
            <h1 className="mt-4 font-sans text-3xl font-semibold leading-[1.17] tracking-[-0.025em] sm:text-[2.625rem]">
              {title}
            </h1>
            <div className="mt-6 max-w-3xl space-y-3 text-lg leading-relaxed text-muted-foreground">
              {introduction}
            </div>
          </div>
        </section>

        <article className="mx-auto max-w-3xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
          {children}
        </article>
      </main>

      <Footer />
    </div>
  );
}

/** One guide section: an h2 with an anchor, then prose. */
export function DocsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 space-y-4"
    >
      <h2
        id={`${id}-title`}
        className="text-2xl font-semibold leading-tight tracking-[-0.014em]"
      >
        {title}
      </h2>
      <div className="space-y-4 leading-relaxed text-foreground [&_code]:rounded-control [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
