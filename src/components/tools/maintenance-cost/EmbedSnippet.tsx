import { CodeBlock } from "@/components/ui/code-block";
import type { CostResult } from "@/lib/tools/maintenance-cost/calculate";
import { buildEmbedSnippet } from "@/lib/tools/maintenance-cost/embed-snippet";

/**
 * The card's HTML in a `CodeBlock`: it wraps, so nothing scrolls sideways at
 * 390 px, and its Copy button is always visible. The snippet is shown as text,
 * never injected as markup.
 */
export function EmbedSnippet({
  result,
  siteOrigin,
}: {
  result: CostResult;
  siteOrigin: string;
}) {
  return (
    <CodeBlock
      label="HTML"
      copyLabel="Copy card HTML"
      value={buildEmbedSnippet(result, siteOrigin)}
    />
  );
}
