"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface AgentInstructionsCopyProps {
  instructions: string;
}

type CopyStatus = "idle" | "copied" | "failed";

const COPY_CONFIRMATION_MS = 2000;

export function AgentInstructionsCopy({
  instructions,
}: AgentInstructionsCopyProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status !== "failed") return;

    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [status]);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(instructions);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), COPY_CONFIRMATION_MS);
    } catch {
      // Clipboard access is commonly denied on non-secure previews and by
      // browser policy. Claiming success here strands the user with nothing to
      // paste, so the complete source becomes an ordinary selectable field.
      setStatus("failed");
    }
  };

  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" onClick={handleCopy}>
        {status === "copied" ? (
          <>
            <CheckCircle2 aria-hidden="true" />
            Copied
          </>
        ) : (
          <>
            <Copy aria-hidden="true" />
            Copy agent instructions
          </>
        )}
      </Button>

      {status === "failed" && (
        <Alert variant="warning">
          <AlertDescription className="space-y-3">
            <p>Copy failed. Select and copy the instructions below.</p>
            <textarea
              ref={fallbackRef}
              aria-label="Agent instructions fallback"
              className="min-h-64 w-full resize-y rounded-md border border-input bg-card p-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              readOnly
              value={instructions}
            />
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
