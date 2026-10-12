/**
 * `wordlist-english` 1.2.1 ships no types. Its default export maps keys such
 * as `english/10`, `english/american/35` or `english` (a dialect's union) to
 * arrays of words. Read by `src/lib/tools/lenses/typos/dictionary.ts` only.
 */
declare module "wordlist-english" {
  const wordlist: Record<string, string[]>;
  export default wordlist;
}
