/**
 * Is this page in English? Shared by the lenses that read words (s96 for
 * typos; s99 outdated content and s100 AI phrasing reuse it).
 *
 * A page is reported as NOT CHECKED rather than full of typos when:
 * - its `<html lang>` names another language (`fr`, `de-DE`), or
 * - more than 40% of the words a lens could check are unknown to it — the
 *   honest signal when `lang` is missing or wrong, as it often is on site
 *   builders that default it to `en`.
 *
 * The word test needs at least 10 words to say anything; below that the page
 * is given the benefit of the doubt (the no-text rule catches empty pages).
 */

export const MAX_UNKNOWN_SHARE = 0.4;
const MIN_WORDS_FOR_RATIO = 10;

/** `lang` is set and is not English (`en`, `en-GB`, `en_US` are English). */
export function isDeclaredNonEnglish(lang: string | null): boolean {
  if (!lang) return false;
  return !/^en(?:$|[-_])/i.test(lang.trim());
}

export interface LanguageEvidence {
  lang: string | null;
  /** Lower-case words the lens would check, one entry per occurrence. */
  words: readonly string[];
  isKnown: (word: string) => boolean;
}

export function isLikelyEnglish({
  lang,
  words,
  isKnown,
}: LanguageEvidence): boolean {
  if (isDeclaredNonEnglish(lang)) return false;
  if (words.length < MIN_WORDS_FOR_RATIO) return true;
  const unknown = words.filter((word) => !isKnown(word)).length;
  return unknown / words.length <= MAX_UNKNOWN_SHARE;
}
