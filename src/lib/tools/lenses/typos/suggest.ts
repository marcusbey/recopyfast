/**
 * One-edit suggestions for an unknown word (s96, plan decision 11).
 *
 * A word is flagged ONLY when this finds a Damerau-1 neighbour — one letter
 * inserted, swapped with its neighbour, replaced or removed — among COMMON
 * words (SCOWL bands ≤ 50). A word with no such neighbour (a brand, a name,
 * jargon) is counted, never listed: precision first.
 *
 * The suggestion must keep the word's FIRST LETTER. Few real misspellings get
 * the first letter wrong, while a name loses it easily ("Laura" → "aura",
 * "Jason" → "mason", "David" → "avid" — all seen on live homepages while this
 * was measured). Joined words ("alot") are the one exception.
 *
 * Ranking: the most common band first; then the kind of edit, in the order
 * typos are usually made — a missing letter ("wich" → "which"), two letters
 * swapped ("teh" → "the"), a wrong letter, an extra letter; then
 * alphabetically, so the same word always gets the same suggestion.
 */

import { MAX_SUGGESTION_BAND, type Dictionary } from "./dictionary";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Two words run together, where one edit would suggest the wrong word. */
const JOINED_WORDS: Record<string, string> = {
  alot: "a lot",
  aswell: "as well",
  atleast: "at least",
  eachother: "each other",
  incase: "in case",
  infact: "in fact",
};

type Edit = "insert" | "transpose" | "substitute" | "delete";
const EDIT_RANK: Record<Edit, number> = {
  insert: 0,
  transpose: 1,
  substitute: 2,
  delete: 3,
};

function* neighbours(word: string): Generator<[Edit, string]> {
  for (let index = 0; index <= word.length; index += 1) {
    for (const letter of LETTERS) {
      yield ["insert", word.slice(0, index) + letter + word.slice(index)];
    }
  }
  for (let index = 0; index < word.length; index += 1) {
    if (index < word.length - 1 && word[index] !== word[index + 1]) {
      yield [
        "transpose",
        word.slice(0, index) +
          word[index + 1] +
          word[index] +
          word.slice(index + 2),
      ];
    }
    for (const letter of LETTERS) {
      if (letter !== word[index]) {
        yield [
          "substitute",
          word.slice(0, index) + letter + word.slice(index + 1),
        ];
      }
    }
    yield ["delete", word.slice(0, index) + word.slice(index + 1)];
  }
}

/** The best common one-edit neighbour of a lower-case word, or null. */
export function suggestCorrection(
  word: string,
  dictionary: Dictionary,
): string | null {
  if (word in JOINED_WORDS) return JOINED_WORDS[word];

  let best: { word: string; band: number; rank: number } | null = null;
  for (const [edit, candidate] of neighbours(word)) {
    if (candidate.length < 2 || candidate[0] !== word[0]) continue;
    const band = dictionary.band(candidate);
    if (band === undefined || band > MAX_SUGGESTION_BAND) continue;
    const rank = EDIT_RANK[edit];
    if (
      !best ||
      band < best.band ||
      (band === best.band && rank < best.rank) ||
      (band === best.band && rank === best.rank && candidate < best.word)
    ) {
      best = { word: candidate, band, rank };
    }
  }
  return best?.word ?? null;
}
