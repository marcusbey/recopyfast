/**
 * Text hygiene shared by every step of the free tools (s96): extraction,
 * findings, the stored report and the code that reads it back.
 *
 * Page text is attacker-chosen. It is never markup here (React renders it as
 * text), but two kinds of character still do damage as plain text:
 *
 * - bidi controls (Unicode's `Bidi_Control`: U+061C, U+200E–U+200F,
 *   U+202A–U+202E, U+2066–U+2069) reorder what a reader SEES without changing
 *   the bytes, so a report could display a sentence the page never said — the
 *   "Trojan Source" class;
 * - default-ignorable characters (Unicode's `Default_Ignorable_Code_Point`:
 *   zero-width characters, the soft hyphen U+00AD, the Mongolian vowel
 *   separator U+180E, the combining grapheme joiner U+034F, the Hangul fillers,
 *   variation selectors, tag characters, …) render as nothing and split one
 *   word into two tokens invisibly, which turns "spell<U+00AD>ing" into a
 *   false typo.
 *
 * Both are stripped at extraction, and stripped again by the report schema on
 * read, so a row written by a buggy or older build cannot reintroduce them.
 * They are matched by Unicode PROPERTY (s96 review round 2, nit 7): the
 * hand-kept list this replaced missed U+034F, U+115F, U+3164, U+FE0F and the
 * tag block. The property set covers every character that list had.
 */

/** C0 and C1 control characters, as `src/lib/api/validation.ts` defines them. */
export const TEXT_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

const INVISIBLE_CHARACTERS =
  /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;

/** Removes bidi controls and default-ignorable characters. */
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
