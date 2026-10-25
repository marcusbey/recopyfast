import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { RichText } from "@/lib/guides/guide-registry";

type GuideRichTextProps = {
  text: RichText;
};

/**
 * Inline guide copy. Internal links are Next links (every allowed target is a
 * static marketing route, so no CSP document boundary is crossed — ADR 059);
 * external links are the guide's own sources, opened in a new tab with
 * `noopener noreferrer`, the same as the comparison sources.
 */
export function GuideRichText({ text }: GuideRichTextProps) {
  if (typeof text === "string") return <>{text}</>;
  return (
    <>
      {text.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : part.href.startsWith("/") ? (
          <Link
            key={`${part.href}-${index}`}
            href={part.href}
            className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800"
          >
            {part.label}
          </Link>
        ) : (
          <a
            key={`${part.href}-${index}`}
            href={part.href}
            rel="noopener noreferrer"
            target="_blank"
            className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800"
          >
            {part.label}
            <ExternalLink
              aria-hidden="true"
              className="ml-0.5 inline h-3.5 w-3.5 align-baseline"
            />
          </a>
        ),
      )}
    </>
  );
}
