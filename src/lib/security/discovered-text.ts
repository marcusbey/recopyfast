/**
 * Validation for what content discovery is allowed to store.
 *
 * THE TEXT. Discovery reports `element.textContent` — the customer's prose,
 * never markup (public/embed/recopyfast.src.js:2363) — and every consumer writes
 * it back as text: the widget uses `target.textContent = content`
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
 *
 * THE REST OF THE ROW. `content` is not the only caller-controlled field that
 * reaches the service-role write: the element id keys the upsert, and `selector`
 * and `type` ride along in the same entry. `selector` is `NOT NULL` in the schema
 * (20250817000000_complete_database_setup.sql:30), so a missing one is a 500 out
 * of Postgres rather than something the caller can act on. Everything the route
 * persists is checked here, so it holds no field the database was not promised.
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

/** Widget ids are `rcf-<hash>`; 255 matches the repo's other id caps. */
export const MAX_ELEMENT_ID_LENGTH = 255;

/** A generated CSS path (`#main > section:nth-of-type(2) > h1`), not free text. */
export const MAX_SELECTOR_LENGTH = 1024;

/**
 * `type` is `element.tagName.toLowerCase()` (recopyfast.src.js:2376).
 *
 * A pattern rather than an allowlist of the tags today's scan selector matches:
 * the widget on a customer's page is a cached copy that can be months older or
 * newer than this route, so pinning the exact set would refuse a live install the
 * moment either side learned a new tag. The shape is what matters — a tag name,
 * not a payload — and `type` only ever lands in `metadata` as a display hint,
 * never as a key and never as something rendered.
 */
const ELEMENT_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

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

/** U+FFFD REPLACEMENT CHARACTER, written by code point to keep this source ASCII. */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/**
 * Replace every C0 and C1 control character — tab, newline and carriage return
 * included — with U+FFFD.
 *
 * Deliberately stricter than `hasControlCharacter` above, which tolerates those
 * three because a text node legitimately contains them. This is for a string
 * about to be echoed into a log line or a JSON error, where a carriage return is
 * not whitespace but a way to forge a second log entry. A value that is refused
 * must not be able to write the record of its own refusal.
 */
export function redactControlCharacters(text: string): string {
  let redacted = "";

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const isControl = code <= C0_END || (code >= C1_START && code <= C1_END);
    redacted += isControl ? REPLACEMENT_CHARACTER : text[index];
  }

  return redacted;
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

/** Accept an element id fit to key the upsert's conflict target. */
export function validateElementId(elementId: unknown): DiscoveredTextResult {
  if (typeof elementId !== "string" || elementId.length === 0) {
    return { ok: false, error: "element id must be a non-empty string" };
  }

  if (elementId.length > MAX_ELEMENT_ID_LENGTH) {
    return {
      ok: false,
      error: `element id exceeds ${MAX_ELEMENT_ID_LENGTH} characters`,
    };
  }

  // Stricter than the rule for content, and tab, newline and carriage return are
  // the difference. Content is prose and legitimately contains all three; an id is
  // a machine-generated token (`rcf-<hash>`) that never does — and unlike content
  // it gets echoed back, into a JSON refusal and a log line, where a carriage
  // return is how a rejected value forges the record of its own rejection. Written
  // as a comparison against the redaction so there is only one definition of
  // "control character" to keep in step.
  if (redactControlCharacters(elementId) !== elementId) {
    return { ok: false, error: "element id contains control characters" };
  }

  return { ok: true, value: elementId };
}

/**
 * One content-map entry, carrying every field the route persists.
 *
 * `type` is optional because the database treats it as optional — `metadata`
 * defaults to `{}` — and because callers that report only the copy and its
 * selector are legitimate: scripts/qa-journey.mjs does exactly that. When it is
 * present it has to look like a tag name.
 */
export interface DiscoveredElement {
  selector: string;
  content: string;
  type?: string;
}

export type DiscoveredElementResult =
  | { ok: true; value: DiscoveredElement }
  | { ok: false; error: string };

/** Accept one content-map entry, or say which field was refused and why. */
export function validateDiscoveredElement(
  entry: unknown,
): DiscoveredElementResult {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return { ok: false, error: "entry must be an object" };
  }

  const { selector, content, type } = entry as Record<string, unknown>;

  const text = validateDiscoveredText(content);
  if (!text.ok) {
    return text;
  }

  if (typeof selector !== "string" || selector.length === 0) {
    return { ok: false, error: "selector must be a non-empty string" };
  }

  if (selector.length > MAX_SELECTOR_LENGTH) {
    return {
      ok: false,
      error: `selector exceeds ${MAX_SELECTOR_LENGTH} characters`,
    };
  }

  if (hasControlCharacter(selector)) {
    return { ok: false, error: "selector contains control characters" };
  }

  if (type === undefined || type === null) {
    return { ok: true, value: { selector, content: text.value } };
  }

  if (typeof type !== "string" || !ELEMENT_TYPE_PATTERN.test(type)) {
    return { ok: false, error: "type must be an HTML tag name" };
  }

  return { ok: true, value: { selector, content: text.value, type } };
}
