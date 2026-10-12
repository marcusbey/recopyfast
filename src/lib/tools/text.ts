/**
 * Text hygiene shared by every step of the free tools (s96): extraction,
 * findings, the stored report and the code that reads it back.
 *
 * Page text is attacker-chosen. It is never markup here (React renders it as
 * text), but two kinds of character still do damage as plain text:
 *
 * - bidi controls (U+061C, U+200E–U+200F, U+202A–U+202E, U+2066–U+2069)
 *   reorder what a reader SEES without changing the bytes, so a report could
 *   display a sentence the page never said — the "Trojan Source" class;
 * - zero-width characters, soft hyphens (U+00AD) and the Mongolian vowel
 *   separator (U+180E, no longer whitespace to `\s`) split one word into two
 *   tokens invisibly, which turns "spell<U+00AD>ing" into a false typo.
 *
 * Both are stripped at extraction, and stripped again by the report schema on
 * read, so a row written by a buggy or older build cannot reintroduce them.
 */

/** C0 and C1 control characters, as `src/lib/api/validation.ts` defines them. */
export const TEXT_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

const INVISIBLE_CHARACTERS =
  /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** Removes bidi controls, zero-width characters and soft hyphens. */
export function stripInvisibleCharacters(text: string): string {
  return text.replace(INVISIBLE_CHARACTERS, "");
}

/** Collapses every run of whitespace (and controls) to one space, trimmed. */
export function collapseWhitespace(text: string): string {
  return text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}

/**
 * At most `max` UTF-16 code units, never splitting a surrogate pair (a split
 * pair renders as a replacement character and fails `JSON` round trips in
 * some clients).
 */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** Same as `clampText`, from the END of the string (the text before a match). */
export function clampTextStart(text: string, max: number): string {
  if (text.length <= max) return text;
  let start = text.length - max;
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start += 1;
  return text.slice(start);
}
