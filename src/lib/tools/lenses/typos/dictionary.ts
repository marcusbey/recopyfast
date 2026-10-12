/**
 * The Typo Finder's dictionary (s96, plan decision 11).
 *
 * WHY wordlist-english. Measured in a scratch install on Node 24.14
 * (2026-10-11): `dictionary-en` + `nspell` is en-US only — it flags "colour"
 * and "organised" — and ships as ESM with top-level await. `wordlist-english`
 * 1.2.1 (MIT, SCOWL data, 1.49 MB, no dependencies, CommonJS) carries five
 * dialects (all English, American, British, Canadian, Australian) in SCOWL size
 * bands 10–70: 115,780 words, ≈ 60 ms and ≈ 8 MB of heap to load.
 *
 * Loaded LAZILY, once per isolate, on the first scan that needs it — not when
 * this module is imported — so a route that only imports the lens registry
 * (the report page, say) never pays for it. The package reads its JSON through
 * a `__dirname` trick, which is why `next.config.ts` lists it in
 * `serverExternalPackages` and traces its `*.json` and `Copyright` into the scan
 * function (`outputFileTracingIncludes`), pinned by
 * `src/__tests__/next-config-tools-packaging.test.ts`.
 *
 * SIZE BANDS. SCOWL's band says how common a word is (10 = most common,
 * 70 = rare). Every band counts as "known"; only bands ≤ 50 may be SUGGESTED,
 * so a typo is never "corrected" to an obscure word.
 */

import { SUPPLEMENT_WORDS } from "./supplement";

/** Bands a suggestion may come from (plan decision 11). */
export const MAX_SUGGESTION_BAND = 50;

/** Prefixes a known word may carry and still be known ("reimagined", "nonprofit"). */
const KNOWN_PREFIXES = [
  "re",
  "un",
  "pre",
  "non",
  "co",
  "multi",
  "sub",
  "over",
  "under",
  "out",
  "mis",
  "inter",
  "super",
  "micro",
  "auto",
  "eco",
  "e",
] as const;

export interface Dictionary {
  /** Lower-case input. True for any listed word, supplement word or simple variant. */
  isKnown(word: string): boolean;
  /** The word's most common SCOWL band, if listed. */
  band(word: string): number | undefined;
}

let loaded: Dictionary | null = null;

function loadWordlist(): Record<string, string[]> {
  // A require, not an import, so loading is deferred to the first call (see
  // the header). It stays a runtime require because the package is in
  // `serverExternalPackages`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const required = require("wordlist-english") as
    | Record<string, string[]>
    | { default: Record<string, string[]> };
  return "default" in required && !Array.isArray(required.default)
    ? (required.default as Record<string, string[]>)
    : (required as Record<string, string[]>);
}

function buildDictionary(): Dictionary {
  const bands = new Map<string, number>();
  const wordlist = loadWordlist();
  for (const [key, words] of Object.entries(wordlist)) {
    const band = /\/(\d+)$/.exec(key);
    if (!band) continue;
    const size = Number(band[1]);
    if (size > 70) continue;
    for (const raw of words) {
      const word = raw.toLowerCase();
      const known = bands.get(word);
      if (known === undefined || size < known) bands.set(word, size);
    }
  }
  const supplement = new Set(SUPPLEMENT_WORDS);
  const isListed = (word: string) => bands.has(word) || supplement.has(word);

  return {
    isKnown(word) {
      if (isListed(word)) return true;
      if (word.length > 3 && word.endsWith("s")) {
        if (isListed(word.slice(0, -1))) return true;
        if (word.endsWith("es") && isListed(word.slice(0, -2))) return true;
      }
      return KNOWN_PREFIXES.some(
        (prefix) =>
          word.length - prefix.length >= 3 &&
          word.startsWith(prefix) &&
          isListed(word.slice(prefix.length)),
      );
    },
    band: (word) => bands.get(word),
  };
}

export function getDictionary(): Dictionary {
  if (!loaded) loaded = buildDictionary();
  return loaded;
}
