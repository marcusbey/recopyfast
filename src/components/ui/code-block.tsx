"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * Every machine string a person has to copy: snippets, tokens, examples
 * (design system, Code blocks and machine strings).
 *
 * The site-registered panel used to render its 300-character embed snippet in
 * a `<pre>` that never wrapped, with Copy absolutely positioned at its far
 * end. Inside the old grid dialog that block was 2,524 px wide, so the only
 * Copy button sat off-screen and the snippet could not be read (s66 research,
 * fact 1). Six hand-rolled code renderings used two wrapping strategies.
 *
 * So, here:
 * - the text wraps by default (`pre-wrap` + `overflow-wrap: anywhere`), and
 *   `wrap={false}` scrolls inside the block itself, never the panel;
 * - Copy sits in the label bar and is always visible: touch has no hover;
 * - what is copied is exactly `value`; display differs only by wrapping;
 * - a refused clipboard write says so ("Copy failed") and selects the text,
 *   so Cmd/Ctrl+C still works. It never claims "Copied" for a write that did
 *   not happen.
 */
export interface CodeBlockProps {
  value: string;
  /** Short name for the bar, e.g. "HTML". */
  label?: string;
  /** Wrap long lines (default). `false` scrolls horizontally inside the block. */
  wrap?: boolean;
  className?: string;
}

type CopyState = "idle" | "copied" | "failed";

const COPY_STATE_MS = 2_000;

const BUTTON_LABEL: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

function selectContents(element: HTMLElement | null): void {
  const selection = window.getSelection();
  if (!element || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function CodeBlock({
  value,
  label,
  wrap = true,
  className,
}: CodeBlockProps) {
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const preRef = React.useRef<HTMLPreElement>(null);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const show = (state: CopyState) => {
    setCopyState(state);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), COPY_STATE_MS);
  };

  const handleCopy = async () => {
    try {
      // Throws, rather than resolving, where the API is missing (an insecure
      // origin) — which is exactly the case that must not say "Copied".
      await navigator.clipboard.writeText(value);
      show("copied");
    } catch {
      selectContents(preRef.current);
      show("failed");
    }
  };

  return (
    <div
      className={cn(
        "min-w-0 rounded-container border border-border bg-surface-1",
        className,
      )}
    >
      <div className="flex h-10 items-center justify-between gap-2 border-b border-border pl-4 pr-1">
        <span className="text-eyebrow">{label}</span>
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          {BUTTON_LABEL[copyState]}
        </Button>
      </div>
      <pre
        ref={preRef}
        className={cn(
          "px-4 py-3 font-mono text-[13px] leading-5 text-foreground",
          wrap
            ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
            : "overflow-x-auto whitespace-pre",
        )}
      >
        <code>{value}</code>
      </pre>
    </div>
  );
}
