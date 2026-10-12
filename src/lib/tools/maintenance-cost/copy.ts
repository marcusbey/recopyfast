/**
 * Every sentence the calculator page pins (s98). One file so the claims test
 * and the page read the same strings.
 *
 * Held to the launch kit's claims ledger (docs/gtm/launch-2026-09-28.md
 * §11-12): the numbers on this page are the visitor's own arithmetic. No
 * ReCopyFast average, benchmark or "save X%". The CTA copy repeats only what
 * the ledger already supports: an invited client changes the words with an
 * emailed code and no account, and ReCopyFast works where a script tag can be
 * added and the site's Content Security Policy allows it.
 */

export const TOOL_SLUG = "website-maintenance-cost";
export const TOOL_PATH = `/tools/${TOOL_SLUG}`;
export const TOOL_NAME = "Website maintenance cost calculator";

export const PAGE_TITLE = "What free copy changes cost you";

export const PAGE_DESCRIPTION =
  "Add up the hours you give away on small website copy changes. Enter your sites, changes and hourly rate; everything is calculated in your browser.";

export const EYEBROW = "Free calculator";

export const INTRO =
  "Every typo fix and price tweak you do for a client for nothing is time you could have billed. Enter your own numbers to see what that adds up to.";

export const RESULT_LABEL = "Unbilled copy changes, per year";

/** Shown instead of a figure while any field is empty. */
export const EMPTY_RESULT = "Fill in all fields to see your number";

/**
 * The honesty line. The page's claims test forbids the phrase used in the
 * launch kit's "what not to say" list, so this names what is not published
 * without repeating it.
 */
export const HONESTY_LINE =
  "Your numbers, not ours. ReCopyFast doesn't publish averages, benchmarks or savings estimates.";

export const CTA_HEADING = "Let clients change their own copy";

export const CTA_BODY =
  "ReCopyFast lets the people you invite edit the words on a site you already built, with an emailed code and no account. You choose, per client, who can publish.";

/**
 * The hrefs are written out in the page, not here: the ADR 059 boundary test
 * reads that file's source for the literal `/signup?...` anchor, and a constant
 * would hide it. Campaign: architect decision 5 (`utm_source=tools`,
 * `utm_medium=free_tool`, `utm_campaign=<slug>`).
 */
export const SIGNUP_CTA_LABEL = "Let clients change their own copy";
export const TRY_CTA_LABEL = "See it on one of your sites first";
export const TRY_CTA_NOTE = "(desktop)";

export const CARD_HEADING = "Share your result";

export const CARD_BODY =
  "Paste this where you want the card to appear. It is a link with inline styles: no script and no iframe.";

export const FAQS = [
  {
    question: "How is this calculated?",
    answer:
      "Sites times changes per site per month times minutes per change gives the hours you spend each month. The share you don't bill, times your hourly rate, is the monthly cost; twelve months is the yearly figure. Every term is a number you typed. Nothing is added for context switching or overhead.",
  },
  {
    question: "What is not included?",
    answer:
      "Waiting on clients, email back and forth, review rounds and the work you turn down while you are busy are not counted. The figure only reflects the time you entered, at the rate you entered.",
  },
  {
    question: "What does ReCopyFast do about it?",
    answer:
      "ReCopyFast adds in-place copy editing to a website that already exists. You invite a client by email, they sign in with a one-time code with no account, and they change the words on the page, never the layout or the code. It works where you can add one script tag and the site's Content Security Policy allows it.",
  },
] as const;
