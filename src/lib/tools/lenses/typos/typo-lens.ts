/**
 * The Website Typo Finder's lens (s96, plan decision 11). PRECISION FIRST.
 *
 * A typo report that flags a business's own name, its product, its jargon or
 * its British spelling teaches the reader to ignore the report — and the
 * report is the product's first impression. So a word is flagged only when
 * EVERY rule below lets it through AND the dictionary has a common one-edit
 * neighbour to suggest (`suggest.ts`). A word with no suggestion is counted,
 * never listed.
 *
 * Never flagged, each pinned by a fixture in `__tests__/typo-lens.test.ts`:
 * - a word touching a digit, shorter than 3 or longer than 24 letters;
 * - ALL CAPS, or a capital inside the word (CamelCase, iPhone);
 * - a Capitalised word, anywhere — mid-sentence it is a name, and at the
 *   start of a sentence it was, on the live homepages measured, almost always
 *   a first name ("Fred and Brian met…", "Claude power users…") or a brand;
 * - a word from a page title, the site name or the host name;
 * - a word used 3+ times across the pages scanned (a name, a term of art);
 * - a contraction or possessive whose plain word is known ("don’t", "Acme's");
 * - addresses, e-mail, handles and file names (blanked by the tokenizer);
 * - non-ASCII words (other languages, accents);
 * - any word in a block of fewer than 4 words — a menu item, a name card, a
 *   button: such blocks are mostly names and abbreviations;
 * - a word with no vowel ("hlth"), a letter tripled ("sooo"), a short word
 *   ending in a period ("approx.", "misc.") or an elision ("havin'");
 * - code-like text: a word followed by "(" ("cos()") or right after "." or
 *   ")" (".ing" file types), and a hyphen part of four letters or fewer
 *   ("robo-advisor").
 *
 * MEASURED, NOT GUESSED. The first version followed the plan's rules alone
 * and was run on 20 public homepages before review (2026-10-11): first names
 * at the start of team cards ("Jason", "Laura"), brands ("Zapier → zanier"),
 * menu abbreviations and tech words ("tech → teach", "admin → admit") made it
 * average well over one false positive per site. Each rule above removed a
 * class seen there; the suggestion must also keep the word's first letter
 * (`suggest.ts`). The re-measurement is in the review doc.
 *
 * Repeated words ("the the") are reported too, minus a pinned allowlist of
 * idioms ("had had", "Bora Bora"), and only across whitespace — "yes. Yes"
 * is two sentences.
 *
 * A page that declares another language, or whose checkable words are more
 * than 40% unknown, is NOT CHECKED (`../language.ts`) — reported as such,
 * never as a page full of typos. A single block whose lower-case words are
 * more than 40% unknown is skipped too: a bilingual page often says
 * `lang="en"` around its other language. A page with fewer than 20 words of HTML text
 * is not checked either: it probably builds its text with JavaScript.
 *
 * At most 500 distinct unknown words get suggestion work per scan; the rest
 * are counted. Findings are bounded to 40 by `boundFindings`.
 */

import type { ExtractedPage } from "@/lib/tools/extract/extract-page";
import {
  boundFindings,
  createFinding,
  type Finding,
  type Lens,
  type LensContext,
  type LensResult,
  type SkippedPage,
  type SummaryFact,
} from "@/lib/tools/lens";
import {
  isDeclaredNonEnglish,
  isLikelyEnglish,
  MAX_UNKNOWN_SHARE,
} from "../language";
import { getDictionary, type Dictionary } from "./dictionary";
import { suggestCorrection } from "./suggest";
import { reduceContraction, tokenizeBlock, type Token } from "./tokenize";

export const TYPO_TOOL_SLUG = "website-spell-checker";
export const MIN_PAGE_WORDS = 20;
export const MIN_WORD_LENGTH = 3;
export const MAX_WORD_LENGTH = 24;
export const FREQUENT_WORD_USES = 3;
export const MAX_SUGGESTION_WORDS = 500;
/** A block shorter than this is a label, a name card or a menu item, not prose. */
export const MIN_PROSE_BLOCK_WORDS = 4;
const MIN_FOREIGN_BLOCK_WORDS = 3;

export const NO_TEXT_MESSAGE =
  "This page shows almost no text in its HTML — it may build its text with JavaScript, which this check doesn't run.";
export const NOT_ENGLISH_MESSAGE =
  "This page doesn't look like it's written in English, so it wasn't checked.";

/** Doubled words that are idioms or names, not slips (lower case). */
export const REPEATED_WORD_ALLOWLIST: ReadonlySet<string> = new Set([
  "aye",
  "baden",
  "bang",
  "blah",
  "boo",
  "bora",
  "bye",
  "cha",
  "chop",
  "choo",
  "da",
  "dee",
  "do",
  "doo",
  "dub",
  "dum",
  "go",
  "ha",
  "haha",
  "had",
  "hee",
  "ho",
  "hush",
  "is",
  "knock",
  "la",
  "mahi",
  "night",
  "no",
  "now",
  "pom",
  "really",
  "sing",
  "so",
  "that",
  "there",
  "tick",
  "tsk",
  "tut",
  "very",
  "walla",
  "well",
  "woo",
  "yada",
  "yeah",
  "yes",
  "yum",
]);

interface PageWords {
  page: ExtractedPage;
  pageIndex: number;
  blocks: { text: string; tokens: Token[] }[];
}

interface Occurrence {
  pageIndex: number;
  blockIndex: number;
  token: Token;
  word: string;
}

const LETTERS_ONLY = /^[a-z]+$/;

function isAllCaps(text: string): boolean {
  const letters = text.replace(/['’]/g, "");
  return (
    letters.length >= 2 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  );
}

function hasInnerCapital(text: string): boolean {
  return /\p{Lu}/u.test(text.slice(1).replace(/['’]\p{Lu}?/gu, ""));
}

function isCapitalised(text: string): boolean {
  return /^\p{Lu}/u.test(text);
}

/** Lower-case words of the page titles, site names and host name labels. */
function identityWords(
  pages: readonly ExtractedPage[],
  hostname: string,
): Set<string> {
  const words = new Set<string>();
  const add = (text: string | null) => {
    for (const word of (text ?? "").toLowerCase().match(/\p{L}+/gu) ?? []) {
      words.add(word);
    }
  };
  for (const page of pages) {
    add(page.title);
    add(page.siteName);
  }
  add(hostname.replace(/\./g, " ").replace(/-/g, " "));
  return words;
}

const NO_VOWEL = /^[^aeiouy]+$/;
const TRIPLED_LETTER = /([a-z])\1\1/;
const ELISION = /^['’]/;
const ABBREVIATION_LENGTH = 4;
const SHORT_HYPHEN_PART = 4;

/** The checkable word under a token, lower-case, or null. */
function checkableWord(token: Token, text: string): string | null {
  if (token.touchesDigit) return null;
  const word = reduceContraction(token.text);
  if (!word || !LETTERS_ONLY.test(word)) return null;
  if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) {
    return null;
  }
  if (isAllCaps(token.text) || hasInnerCapital(token.text)) return null;
  if (NO_VOWEL.test(word) || TRIPLED_LETTER.test(word)) return null;
  const next = text.charAt(token.end);
  if (ELISION.test(next) || ELISION.test(text.charAt(token.start - 1))) {
    return null;
  }
  if (next === "." && word.length <= ABBREVIATION_LENGTH) return null;
  const previous = text.charAt(token.start - 1);
  if (next === "(" || previous === "." || previous === ")") return null;
  if ((next === "-" || previous === "-") && word.length <= SHORT_HYPHEN_PART) {
    return null;
  }
  return word;
}

function wordCount(tokens: readonly Token[]): number {
  return tokens.length;
}

/** Words that count as evidence of the page's language (unknown non-ASCII included). */
function languageEvidence(blocks: PageWords["blocks"]): string[] {
  const words: string[] = [];
  for (const { tokens } of blocks) {
    // Menus and name cards say little about the language and a lot about
    // brands; prose decides.
    if (wordCount(tokens) < MIN_PROSE_BLOCK_WORDS) continue;
    for (const token of tokens) {
      if (token.touchesDigit || isAllCaps(token.text)) continue;
      if (hasInnerCapital(token.text)) continue;
      if (isCapitalised(token.text)) continue;
      const word = reduceContraction(token.text);
      if (!word || word.length < MIN_WORD_LENGTH) continue;
      words.push(word);
    }
  }
  return words;
}

/**
 * A block in another language inside an English page — the Welsh half of a
 * bilingual site whose `<html lang>` says "en" (gov.uk/cymraeg, seen on a
 * real scan while this was measured). Every lower-case word counts here,
 * short ones included ("yn", "y"), because short function words are the
 * clearest signal of a language.
 */
function isForeignBlock(
  tokens: readonly Token[],
  dictionary: Dictionary,
): boolean {
  const words = tokens
    .filter((token) => !isCapitalised(token.text) && !token.touchesDigit)
    .map((token) => reduceContraction(token.text))
    .filter((word): word is string => word !== null && LETTERS_ONLY.test(word));
  if (words.length < MIN_FOREIGN_BLOCK_WORDS) return false;
  const unknown = words.filter((word) => !dictionary.isKnown(word)).length;
  return unknown / words.length > MAX_UNKNOWN_SHARE;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function readPages(
  pages: readonly ExtractedPage[],
  dictionary: Dictionary,
): { checked: PageWords[]; skipped: SkippedPage[] } {
  const checked: PageWords[] = [];
  const skipped: SkippedPage[] = [];
  pages.forEach((page, pageIndex) => {
    if (isDeclaredNonEnglish(page.lang)) {
      skipped.push({ url: page.url, reason: NOT_ENGLISH_MESSAGE });
      return;
    }
    if (page.wordCount < MIN_PAGE_WORDS) {
      skipped.push({ url: page.url, reason: NO_TEXT_MESSAGE });
      return;
    }
    const blocks = page.blocks.map((block) => ({
      text: block.text,
      tokens: tokenizeBlock(block.text),
    }));
    const isEnglish = isLikelyEnglish({
      lang: page.lang,
      words: languageEvidence(blocks),
      isKnown: dictionary.isKnown,
    });
    if (!isEnglish) {
      skipped.push({ url: page.url, reason: NOT_ENGLISH_MESSAGE });
      return;
    }
    checked.push({ page, pageIndex, blocks });
  });
  return { checked, skipped };
}

function repeatedWordFindings(checked: PageWords[]): {
  finding: Finding;
  order: [number, number, number];
}[] {
  const found: { finding: Finding; order: [number, number, number] }[] = [];
  for (const { page, pageIndex, blocks } of checked) {
    blocks.forEach(({ text, tokens }, blockIndex) => {
      // "undefined undefined" in a two-word widget is a rendering artefact,
      // not a sentence; prose decides here too.
      if (wordCount(tokens) < MIN_PROSE_BLOCK_WORDS) return;
      for (let index = 1; index < tokens.length; index += 1) {
        const first = tokens[index - 1];
        const second = tokens[index];
        const lower = first.text.toLowerCase();
        if (lower !== second.text.toLowerCase()) continue;
        if (!/^\s+$/.test(text.slice(first.end, second.start))) continue;
        if (first.touchesDigit || second.touchesDigit) continue;
        if (lower.length < 2 && lower !== "a") continue;
        if (REPEATED_WORD_ALLOWLIST.has(lower)) continue;
        if (isCapitalised(second.text) && !second.isSentenceStart) continue;
        // Three in a row ("dub dub dub", "no no no") is deliberate.
        const third = tokens[index + 1];
        const before = tokens[index - 2];
        if (
          (third && third.text.toLowerCase() === lower) ||
          (before && before.text.toLowerCase() === lower)
        ) {
          continue;
        }
        found.push({
          order: [pageIndex, blockIndex, first.start],
          finding: createFinding({
            page: page.url,
            kind: "repeated",
            match: text.slice(first.start, second.end),
            before: text.slice(0, first.start),
            after: text.slice(second.end),
            suggestion: first.text,
            note: "The same word twice in a row.",
          }),
        });
      }
    });
  }
  return found;
}

export function analyzeTypos(
  pages: readonly ExtractedPage[],
  context: LensContext,
  dictionary: Dictionary = getDictionary(),
): LensResult {
  const { checked, skipped } = readPages(pages, dictionary);

  if (checked.length === 0) {
    return {
      summary: {
        headline: skipped[0]?.reason ?? NO_TEXT_MESSAGE,
        verdict: "skipped",
        facts: [{ label: "Pages checked", value: "0" }],
      },
      findings: [],
      skippedPages: skipped,
    };
  }

  const identity = identityWords(
    checked.map((entry) => entry.page),
    context.hostname,
  );
  const uses = new Map<string, number>();
  for (const { blocks } of checked) {
    for (const { tokens } of blocks) {
      for (const token of tokens) {
        const word = reduceContraction(token.text);
        if (!word) continue;
        uses.set(word, (uses.get(word) ?? 0) + 1);
      }
    }
  }

  const unknown: Occurrence[] = [];
  for (const { pageIndex, blocks } of checked) {
    blocks.forEach(({ text, tokens }, blockIndex) => {
      if (wordCount(tokens) < MIN_PROSE_BLOCK_WORDS) return;
      if (isForeignBlock(tokens, dictionary)) return;
      tokens.forEach((token) => {
        if (isCapitalised(token.text)) return;
        const word = checkableWord(token, text);
        if (!word) return;
        if (identity.has(word)) return;
        if ((uses.get(word) ?? 0) >= FREQUENT_WORD_USES) return;
        if (dictionary.isKnown(word)) return;
        unknown.push({ pageIndex, blockIndex, token, word });
      });
    });
  }

  const suggestions = new Map<string, string | null>();
  let beyondLimit = 0;
  for (const { word } of unknown) {
    if (suggestions.has(word)) continue;
    if (suggestions.size >= MAX_SUGGESTION_WORDS) {
      beyondLimit += 1;
      suggestions.set(word, null);
      continue;
    }
    suggestions.set(word, suggestCorrection(word, dictionary));
  }
  const withoutSuggestion =
    Array.from(suggestions.values()).filter((suggestion) => suggestion === null)
      .length - beyondLimit;

  const ordered: { finding: Finding; order: [number, number, number] }[] = [];
  for (const { pageIndex, blockIndex, token, word } of unknown) {
    const suggestion = suggestions.get(word);
    if (!suggestion) continue;
    const entry = checked.find(
      (item) => item.pageIndex === pageIndex,
    ) as PageWords;
    const { text } = entry.blocks[blockIndex];
    ordered.push({
      order: [pageIndex, blockIndex, token.start],
      finding: createFinding({
        page: entry.page.url,
        kind: "typo",
        match: token.text,
        before: text.slice(0, token.start),
        after: text.slice(token.end),
        suggestion,
      }),
    });
  }
  ordered.push(...repeatedWordFindings(checked));
  ordered.sort(
    (a, b) =>
      a.order[0] - b.order[0] ||
      a.order[1] - b.order[1] ||
      a.order[2] - b.order[2],
  );

  const keyOf = (finding: Finding) =>
    `${finding.kind}:${finding.match.toLowerCase()}`;
  const all = ordered.map((entry) => entry.finding);
  const findings = boundFindings(all, { dedupeKey: keyOf });

  const distinct = (kind: string) =>
    new Set(all.filter((finding) => finding.kind === kind).map(keyOf)).size;
  // More distinct findings than the list keeps: the report must say so.
  const findingsTruncated = new Set(all.map(keyOf)).size > findings.length;
  const typoCount = distinct("typo");
  const repeatedCount = distinct("repeated");
  const pagesWithFindings = new Set(all.map((finding) => finding.page)).size;
  const total = typoCount + repeatedCount;

  const facts: SummaryFact[] = [
    { label: "Pages checked", value: String(checked.length) },
    { label: "Possible typos", value: String(typoCount) },
    { label: "Repeated words", value: String(repeatedCount) },
    {
      label: "Unrecognised words with no close match (not listed)",
      value: String(withoutSuggestion),
    },
  ];
  if (beyondLimit > 0) {
    facts.push({
      label: "Unrecognised words over the checking limit",
      value: String(beyondLimit),
    });
  }
  if (skipped.length > 0) {
    facts.push({ label: "Pages not checked", value: String(skipped.length) });
  }

  return {
    summary: {
      headline:
        total > 0
          ? `${plural(total, "possible typo")} on ${plural(pagesWithFindings, "page")} of ${checked.length}`
          : `No likely typos on the ${plural(checked.length, "page")} we checked`,
      verdict: total > 0 ? "warn" : "pass",
      facts,
    },
    findings,
    findingsTruncated,
    skippedPages: skipped,
  };
}

export const typoLens: Lens = {
  id: "typos",
  tool: TYPO_TOOL_SLUG,
  pages: { max: 10, sample: "sitemap" },
  analyze: (pages, context) => analyzeTypos(pages, context),
};
