import type { CostResult } from "@/lib/tools/maintenance-cost/calculate";
import { buildCardText } from "@/lib/tools/maintenance-cost/embed-snippet";

/**
 * On-page preview of the pasteable card. It renders `buildCardText`, the same
 * four lines `buildEmbedSnippet` writes into the HTML, through React, so what
 * the visitor sees is what they paste. It is deliberately not a link: the real
 * card is, and a preview that navigated would take the visitor off the page
 * they are still editing.
 *
 * The colours are fixed, not tokens: the pasted card has a white ground on the
 * host's page whatever theme this page is in.
 */
export function CostResultCard({ result }: { result: CostResult }) {
  const text = buildCardText(result);

  return (
    <div
      role="group"
      aria-label="Card preview"
      className="max-w-[360px] rounded-xl border border-[#cbd5d9] bg-white px-5 py-4 leading-snug text-[#14191c]"
    >
      <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-[#4d5b61]">
        {text.eyebrow}
      </span>
      <span className="my-1 block text-[32px] font-bold text-[#14191c]">
        {text.figure}
      </span>
      <span className="block text-[13px] text-[#4d5b61]">{text.inputs}</span>
      <span className="mt-2.5 block text-[13px] font-semibold text-[#1d6560]">
        {text.cta}
      </span>
    </div>
  );
}
