/**
 * The copy of the /tools hub and the Website Typo Finder page (s96), kept as
 * data so the visible FAQ and the FAQPage JSON-LD come from one list, and so
 * `src/__tests__/app/tools-pages.test.tsx` can hold every line to the claims
 * ledger: no "free plan", "free forever", "no login", "instantly", "any
 * website" or "works everywhere" (launch kit §11–12).
 *
 * "About our scanner" says exactly what the fetcher does
 * (`src/lib/tools/fetch/safe-fetch.ts`, `src/lib/tools/scan/run-scan.ts`) and
 * how a site owner opts out — robots.txt, which the scanner obeys (architect
 * decision 3). No contact address is published until support@ works.
 */

import { SCANNER_USER_AGENT } from "@/lib/tools/scanner-identity";

export const HUB_PATH = "/tools";
export const HUB_TITLE = "Free website tools";
export const HUB_DESCRIPTION =
  "Free tools from ReCopyFast that read a public website and report what to fix, each finding shown in context. No account needed.";

export const HUB_FAQS = [
  {
    question: "Do I need an account?",
    answer:
      "No. Enter a website address and the tool runs. Each connection gets a limited number of scans a day, so the tools stay available for everyone.",
  },
  {
    question: "Who can see a report?",
    answer:
      "Anyone you share its link with. Reports are not listed anywhere, search engines are asked not to index them, and they are kept for up to 30 days.",
  },
  {
    question: "Can I stop these tools from reading my site?",
    answer:
      "Yes. Add a rule for RecopyFastToolsBot to your site's robots.txt, as shown above, and the scanner will not read the pages it disallows.",
  },
] as const;

export const SCANNER_ROBOTS_RULE =
  "User-agent: RecopyFastToolsBot\nDisallow: /";

export const ABOUT_SCANNER = {
  fetched:
    "A scan reads only public pages of the site you enter: its robots.txt, its homepage, up to two sitemap files and up to nine more pages on the same host — never more than 24 requests in all. The same address is read at most once a day per tool; asking again within 24 hours returns the saved report.",
  identity: `It identifies itself as ${SCANNER_USER_AGENT}, sends no cookies and does not run the page's JavaScript.`,
  stored:
    "We store the address you entered, without anything after a ? or #, and the report: short excerpts of public page text around each finding. Reports are kept for up to 30 days; when many scans run at once, older ones can be removed sooner. The address your request came from is used only to limit how many scans it can run; it is kept for about 24 hours and never stored with a report.",
  optOut:
    "To keep the scanner off your site, add this to your robots.txt. It is checked before every page it reads.",
} as const;

/** Equal to the catalogue slug and to `TYPO_TOOL_SLUG` (tools-discovery test). */
export const TYPO_SLUG = "website-spell-checker";
export const TYPO_PATH = `/tools/${TYPO_SLUG}`;
export const TYPO_TITLE = "Website Typo Finder";
export const TYPO_DESCRIPTION =
  "Free website spell checker: find likely typos and doubled words on up to ten pages of your site, each shown in the sentence it sits in.";
export const TYPO_SUBMIT_LABEL = "Check for typos";

export const TYPO_FAQS = [
  {
    question: "Is the Website Typo Finder free?",
    answer:
      "Yes, and there is no account to create. Each connection gets a limited number of scans a day, so the tool stays available for everyone.",
  },
  {
    question: "Which pages does it check?",
    answer:
      "Your homepage plus up to nine more public pages on the same host, taken from your sitemap.xml or, if there is none, from the links on your homepage.",
  },
  {
    question: "Why didn't it flag a word I know is wrong?",
    answer:
      "It flags a word only when a common English word is one letter away, so it leaves most names, brands and jargon alone. It also skips words written with a capital letter, short lines like menus and buttons, and words your site uses three or more times.",
  },
  {
    question: "Does it check pages in other languages?",
    answer:
      "No. A page that says it is in another language, or whose words are mostly not English, is reported as not checked rather than as full of typos.",
  },
  {
    question: "Does it read text that JavaScript adds to the page?",
    answer:
      "No. It reads the HTML your server sends. A page that builds its text in the browser is reported as having almost no text to check.",
  },
  {
    question: "How do I fix a typo it finds?",
    answer:
      "Change the text where your site keeps it. With ReCopyFast installed you can also click the line on your live page and retype it; search engines that don't run JavaScript keep reading your original text.",
  },
] as const;
