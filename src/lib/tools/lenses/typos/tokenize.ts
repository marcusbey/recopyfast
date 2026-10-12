/**
 * Words of one text block, as the Typo Finder sees them (s96, plan decision
 * 11).
 *
 * - Whitespace-separated chunks that look like an address, a path, a handle or
 *   a file name — `://`, `www.`, `@`, `/`, `_`, `#`, `=`, or a dot between two
 *   letters or digits (`example.com`, `node.js`, `e.g.`) — are blanked out
 *   before anything else, so "exampel" in `https://exampel.com` is never a
 *   typo, and the period that ends `example.com.` never makes the next word a
 *   "sentence start".
 * - A word is a run of letters with internal apostrophes (' or U+2019):
 *   "don’t", "company's". Hyphens split it, so each part of
 *   "state-of-the-art" is checked on its own.
 * - A word touching a digit ("abc123", "3rd") is marked, and never checked.
 * - A word is a sentence start when it opens the block or follows `.`, `!`,
 *   `?`, `…`, `:` or a bullet. Only there may a capitalised word be checked.
 */

export interface Token {
  text: string;
  start: number;
  end: number;
  isSentenceStart: boolean;
  touchesDigit: boolean;
}

const IGNORED_CHUNK =
  /:\/\/|^www\.|[@/\\_=#|<>{}~^]|[\p{L}\p{N}]\.[\p{L}\p{N}]/u;
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const SENTENCE_BREAK = /[.!?…:•·▪►✓✔]/;
const DIGIT = /\p{N}/u;

/** The text with every address-like chunk replaced by spaces, offsets kept. */
function blankIgnoredChunks(text: string): string {
  return text.replace(/\S+/g, (chunk) =>
    IGNORED_CHUNK.test(chunk) ? " ".repeat(chunk.length) : chunk,
  );
}

export function tokenizeBlock(text: string): Token[] {
  const cleaned = blankIgnoredChunks(text);
  const tokens: Token[] = [];
  let previousEnd = -1;

  for (const match of cleaned.matchAll(WORD)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const gap = previousEnd < 0 ? "" : cleaned.slice(previousEnd, start);
    tokens.push({
      text: match[0],
      start,
      end,
      isSentenceStart: previousEnd < 0 || SENTENCE_BREAK.test(gap),
      touchesDigit:
        DIGIT.test(cleaned.charAt(start - 1)) ||
        DIGIT.test(cleaned.charAt(end)),
    });
    previousEnd = end;
  }
  return tokens;
}

const IRREGULAR_NEGATIONS: Record<string, string | null> = {
  "won't": "will",
  "can't": "can",
  "shan't": "shall",
  "ain't": null,
};

const CONTRACTION_SUFFIXES = ["n't", "'s", "'re", "'ve", "'ll", "'d", "'m"];

/**
 * The plain word under a contraction or possessive ("don't" → "do",
 * "company's" → "company"), lower-cased. Null when it does not reduce to a
 * plain word ("o'clock", "rock'n'roll"): such a token is never flagged.
 */
export function reduceContraction(word: string): string | null {
  const lower = word.toLowerCase().replace(/’/g, "'");
  if (!lower.includes("'")) return lower;
  if (lower in IRREGULAR_NEGATIONS) return IRREGULAR_NEGATIONS[lower];
  for (const suffix of CONTRACTION_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      const base = lower.slice(0, -suffix.length);
      return base && !base.includes("'") ? base : null;
    }
  }
  return null;
}
