/**
 * The words s99 gives the shared English-language gate.
 *
 * This deliberately reuses the Typo Finder's public tokenizer and contraction
 * reducer. Before this repaired plan, s99 assumed a page-level language helper
 * that did not exist; keeping the adapter here means neither the shared helper
 * nor the measured Typo Finder rules need to change for this lens.
 */

import type { ExtractedPage } from "@/lib/tools/extract/extract-page";
import { isLikelyEnglish } from "../language";
import type { Dictionary } from "../typos/dictionary";
import { reduceContraction, tokenizeBlock } from "../typos/tokenize";

const MIN_PROSE_BLOCK_WORDS = 4;
const MIN_EVIDENCE_WORD_LENGTH = 3;

export function languageEvidenceWords(page: ExtractedPage): string[] {
  const words: string[] = [];
  for (const block of page.blocks) {
    const tokens = tokenizeBlock(block.text);
    if (tokens.length < MIN_PROSE_BLOCK_WORDS) continue;
    for (const token of tokens) {
      if (token.touchesDigit) continue;
      const word = reduceContraction(token.text);
      if (!word || word.length < MIN_EVIDENCE_WORD_LENGTH) continue;
      words.push(word);
    }
  }
  return words;
}

export function isOutdatedLensEnglishPage(
  page: ExtractedPage,
  dictionary: Dictionary,
): boolean {
  return isLikelyEnglish({
    lang: page.lang,
    words: languageEvidenceWords(page),
    isKnown: dictionary.isKnown,
  });
}
