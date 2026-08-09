/**
 * Validation for the copy the widget discovers on a customer's page.
 *
 * Discovery reports `element.textContent` — the customer's prose, never markup
 * (public/embed/recopyfast.src.js:2363) — and every consumer writes it back as
 * text: the widget uses `target.textContent = content`
 * (recopyfast.src.js:3246) and the dashboard renders it through JSX, which
 * escapes (VersionPreviewDialog.tsx:154, TranslationDashboard.tsx:202). Nothing
 * on any of those paths interprets the value as HTML.
 *
 * So an HTML sanitizer is the wrong tool here, and it was the tool: every `<` a
 * customer typed came back as `&lt;`, and anything that parsed as a tag was
 * deleted along with the rest of the string — "Setup in <2 minutes" became
 * "Setup in &lt;2 minutes", "Paste the <script> tag into your page" became
 * "Paste the ". Truncation ran first, so a cut could also land mid-entity. See
 * A-1 in docs/QA-PRODUCTION-AUDIT-2026-08-07.md.
 *
 * What is left to check is therefore not "is this safe markup" but "is this a
 * plain string worth storing": no control characters, and a bounded length.
 * Both answers are refusals rather than repairs. A rewritten string is
 * indistinguishable from copy the customer actually wrote, and the write is an
 * `ignoreDuplicates` upsert into `original_content` — the restore target — so a
 * silent repair is permanent and survives a rollback. A 400 is recoverable: the
 * widget re-reports on its next scan.
 */

/**
 * Longest text node discovery will store, in UTF-16 code units.
 *
 * Generous on purpose: roughly three thousand words inside a single element,
 * which no real heading, paragraph, list item or table cell reaches, so the cap
 * only ever answers a caller sending something that is not page copy. Kept
 * finite so one row cannot become an unbounded blob.
 */
export const MAX_DISCOVERED_TEXT_LENGTH = 20_000;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const C0_END = 0x1f;
const C1_START = 0x7f;
const C1_END = 0x9f;

/**
 * True when the string carries a C0 or C1 control character.
 *
 * Tab, newline and carriage return are excluded: they occur in ordinary
 * multi-line text nodes and are stored verbatim like any other character.
 */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) {
      continue;
    }
    if (code <= C0_END || (code >= C1_START && code <= C1_END)) {
      return true;
    }
  }
  return false;
}

export type DiscoveredTextResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Accept a discovered text node verbatim, or say why it was refused.
 *
 * The returned string is identical to the input: this function never escapes,
 * strips or truncates.
 */
export function validateDiscoveredText(content: unknown): DiscoveredTextResult {
  if (typeof content !== "string") {
    return { ok: false, error: "content must be a string" };
  }

  if (content.length > MAX_DISCOVERED_TEXT_LENGTH) {
    return {
      ok: false,
      error: `content exceeds ${MAX_DISCOVERED_TEXT_LENGTH} characters (${content.length})`,
    };
  }

  if (hasControlCharacter(content)) {
    return { ok: false, error: "content contains control characters" };
  }

  return { ok: true, value: content };
}
