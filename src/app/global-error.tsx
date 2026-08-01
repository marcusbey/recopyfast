"use client";

/**
 * Root-layout error boundary.
 *
 * This is the only boundary that catches render errors thrown by `app/layout.tsx`
 * itself, so it replaces the root layout and must render its own <html>/<body>.
 * Because the layout is bypassed, the global stylesheet is imported here directly
 * and the markup avoids app components — if a shared chunk is what broke, this
 * page still has to render.
 *
 * Sentry cannot see these errors on its own: Next.js swallows them into the
 * boundary, so `Sentry.captureException` is called explicitly.
 * See https://docs.sentry.io/platforms/javascript/guides/nextjs/ ("Capture React
 * rendering errors with global-error.tsx").
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-lg text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              {/* Inline SVG rather than lucide-react: this boundary must not
                  depend on chunks that may have failed to load. */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-8 h-8 text-red-600"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-gray-600 mb-6">
              ReCopyFast hit an unexpected error and couldn&apos;t finish
              loading this page. The problem has been reported to our team.
            </p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={reset}
                className="w-full h-10 rounded-md px-4 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-colors"
              >
                Try again
              </button>
              {/* Deliberately a plain anchor, not next/link: the root layout has
                  crashed, so a hard navigation that rebuilds the whole document
                  is the reliable escape. A soft client-side transition would
                  reuse the same broken router state. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="w-full h-10 inline-flex items-center justify-center rounded-md border border-gray-200 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
              >
                Go to Homepage
              </a>
            </div>

            {error.digest && (
              <p className="text-xs text-gray-500 mt-6">
                If the problem persists, contact support with error ID:{" "}
                <span className="font-mono">{error.digest}</span>
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
