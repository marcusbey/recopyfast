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
 *   separator U+180E, the combining grapheme joiner U+034F, the Hangul
 *   fillers, …) have no glyph of their own — some, like the joiners, only
 *   change how their neighbours join — and split one word into two tokens
 *   invisibly, which turns "spell<U+00AD>ing" into a false typo.
 *
 * Both are stripped at extraction, and stripped again by the report schema on
 * read, so a row written by a buggy or older build cannot reintroduce them.
 * They are matched by Unicode PROPERTY (s96 review round 2, nit 7): the
 * hand-kept list this replaced missed U+034F, U+115F and U+3164. The property
 * set covers every character that list had.
 *
 * EXCEPT the characters an emoji, a flag or an ideograph is drawn with
 * (verification review of e7bdd09, F2). The stripped text is what a report
 * SHOWS, and dropping them turned ❤️ into ❤ and the England flag into a
 * black flag: variation selectors U+FE00–FE0F and U+E0100–E01EF, and the
 * tag characters of a flag's tag sequence (U+1F3F4, tags U+E0020–E007E,
 * U+E007F). A tag character ANYWHERE ELSE is invisible and is stripped
 * (verification review of b6ad9ff, N1): kept everywhere, "fre<U+E0041>sh"
 * read as the false typo "fre". The joiners (ZWJ, ZWNJ) are still stripped,
 * as they were before the property set.
 */

/** C0 and C1 control characters, as `src/lib/api/validation.ts` defines them. */
export const TEXT_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Either a whole emoji tag sequence (group 1, kept as is) or one invisible
 * character (stripped). At each position the sequence is tried first, so its
 * tag characters are never matched one by one.
 */
const INVISIBLE_CHARACTERS =
  /(\u{1f3f4}[\u{e0020}-\u{e007e}]+\u{e007f})|(?![\ufe00-\ufe0f\u{e0100}-\u{e01ef}])[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;

/** Removes bidi controls and default-ignorable characters. */
export function stripInvisibleCharacters(text: string): string {
  return text.replace(
    INVISIBLE_CHARACTERS,
    (_match, tagSequence: string | undefined) => tagSequence ?? "",
  );
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
