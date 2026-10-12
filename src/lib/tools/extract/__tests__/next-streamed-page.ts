/**
 * A real Next.js App Router page that streams through a Suspense boundary
 * (s96c). Trimmed from `curl -s https://www.recopyfa.st/terms` on 2026-10-12.
 *
 * The body is the root `loading.tsx` fallback ("Loading…") inside
 * `<!--$?--><template id="B:0">…<!--/$-->`. The real page arrives later in the
 * same response, in `<div hidden id="S:0">`, and React's `$RC("B:0","S:0")`
 * swaps it in. Head, shell, scripts and markup are copied byte for byte. Only
 * the header, `<main>` and footer were cut down, and one real sentence was
 * changed to plant the typo "recieve" ("…you enter, and you recieve a
 * report.").
 *
 * Shared by the extractor, typo-lens and run-scan suites. It is not a suite:
 * `testMatch` only collects `*.test.*`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export const NEXT_STREAMED_PAGE = readFileSync(
  path.join(__dirname, "next-streamed-page.html"),
  "utf8",
);

/** The text React shows while the segment is still on its way. */
export const NEXT_STREAMED_FALLBACK_TEXT = "Loading…";
