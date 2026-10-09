/**
 * Where a piece of copy is, in words an owner understands (s70b).
 *
 * The old Content page titled every card with the id the embed assigned
 * (`rcf-1gom2eazz3g`) and the CSS selector it recorded
 * (`div:nth-child(7) > div > button:nth-child(3) > span:nth-child(1)`), and the
 * owner asked what the page was about. Both are support data: they stay in the
 * expanded row's "Technical details" and never reach a label built here. Every
 * output is rebuilt from words — a segment's letters and digits, a fixed
 * vocabulary — so no `#`, `>`, `:nth` or `rcf-` can pass through, whatever an
 * author put in a `data-rcf-id` or a path.
 *
 * Signals, all already on the row (no embed bytes): the page path, the tag
 * discovery stored in `metadata.type`, landmarks / ids / class words in the
 * selector, and an author's own `data-rcf-id`. The text itself is the row's
 * primary identifier; this label only orients. Pure, no DOM.
 * docs/designs/s70-content-changes.md, "Human-readable location".
 */

const SEPARATOR = " › ";
const PLACE_SEPARATOR = " · ";
/** Paths deeper than this keep their last two segments behind an ellipsis. */
const MAX_PAGE_SEGMENTS = 2;

const ELEMENT_LABELS: Readonly<Record<string, string>> = {
  h1: "Main heading",
  h2: "Heading",
  h3: "Subheading",
  h4: "Subheading",
  h5: "Subheading",
  h6: "Subheading",
  p: "Paragraph",
  li: "List item",
  button: "Button",
  a: "Link",
  img: "Image",
  label: "Form label",
  td: "Table cell",
  th: "Table cell",
};

const FALLBACK_ELEMENT = "Text";

const LANDMARKS: Readonly<Record<string, string>> = {
  header: "Header",
  nav: "Navigation",
  footer: "Footer",
  aside: "Sidebar",
  form: "Form",
};

/** Ids a framework puts on its mount point: they say nothing about a place. */
const FRAMEWORK_ROOTS: ReadonlySet<string> = new Set([
  "root",
  "__next",
  "app",
  "__nuxt",
  "___gatsby",
]);

const CLASS_WORDS: Readonly<Record<string, string>> = {
  hero: "Hero",
  pricing: "Pricing",
  faq: "FAQ",
  features: "Features",
  testimonials: "Testimonials",
  cta: "Call to action",
  banner: "Banner",
  about: "About",
  contact: "Contact",
  team: "Team",
  blog: "Blog",
};

/** The prefix of an id the embed assigned; an author's own id never has it. */
const EMBED_ID_PREFIX = "rcf-";

/**
 * Letters and digits only, sentence case: `how-we-ship` → "How we ship",
 * `heroTitle` → "Hero title". Everything else is a word break, which is what
 * keeps selector syntax out of every label.
 */
function humanize(raw: string): string {
  const words = raw
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The band label for a page path. `NULL` is an author-declared id shared by
 * every page (`data-rcf-id` rows carry no page).
 */
export function describePage(pagePath: string | null | undefined): string {
  if (pagePath === null || pagePath === undefined) return "Every page";

  const labels = pagePath
    .split(/[?#]/)[0]
    .split("/")
    .map((segment) => humanize(decodeSegment(segment)))
    .filter(Boolean);
  if (labels.length === 0) {
    return pagePath.replace(/[?#].*$/, "").replace(/\/+/g, "") === ""
      ? "Homepage"
      : "Page";
  }
  if (labels.length <= MAX_PAGE_SEGMENTS) return labels.join(SEPARATOR);
  return ["…", ...labels.slice(-MAX_PAGE_SEGMENTS)].join(SEPARATOR);
}

interface SelectorSegment {
  tag: string | null;
  id: string | null;
  classes: string[];
  hasContentAttribute: boolean;
}

/**
 * Splits on `>` and whitespace outside brackets and quotes, so an attribute
 * value (`[data-rcf-id="a > b"]`) stays inside its segment.
 */
function splitSelector(selector: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  for (const char of selector) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ">" || /\s/.test(char))) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function parseSegment(raw: string): SelectorSegment {
  const bare = raw.replace(/\[[^\]]*\]|\([^)]*\)/g, "");
  return {
    tag: /^[a-z][a-z0-9-]*/i.exec(bare)?.[0].toLowerCase() ?? null,
    id: /#([\w-]+)/.exec(bare)?.[1] ?? null,
    classes: Array.from(bare.matchAll(/\.([\w-]+)/g), (match) =>
      match[1].toLowerCase(),
    ),
    hasContentAttribute: /\[\s*data-rcf-content\s*[\]=~|^$*]/i.test(raw),
  };
}

function elementLabel(tag: string | null, segments: SelectorSegment[]) {
  if (!tag) return FALLBACK_ELEMENT;
  if (tag === "span") {
    // A span is usually the label inside a control; the control says more.
    for (let index = segments.length - 2; index >= 0; index -= 1) {
      if (segments[index].tag === "button") return "Button label";
      if (segments[index].tag === "a") return "Link text";
    }
    return FALLBACK_ELEMENT;
  }
  if (tag === "div" && segments.at(-1)?.hasContentAttribute) {
    return "Content block";
  }
  return ELEMENT_LABELS[tag] ?? FALLBACK_ELEMENT;
}

/** The nearest ancestor that names a place, or null. */
function placeLabel(ancestors: SelectorSegment[]): string | null {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const segment = ancestors[index];
    if (segment.tag && LANDMARKS[segment.tag]) return LANDMARKS[segment.tag];
    if (segment.id && !FRAMEWORK_ROOTS.has(segment.id.toLowerCase())) {
      const place = humanize(segment.id);
      if (place) return place;
    }
    const word = segment.classes.find((name) => CLASS_WORDS[name]);
    if (word) return CLASS_WORDS[word];
  }
  return null;
}

export interface ElementLocationInput {
  selector: string | null | undefined;
  /** `metadata.type`: the tag name discovery stored. */
  elementType: string | null | undefined;
  elementId: string | null | undefined;
  /** The page band's label; a place equal to it is not repeated. */
  pageLabel: string;
}

/**
 * `[place · ]element`: "Hero · Main heading", "Navigation · Link", "Button".
 * An author's `data-rcf-id` replaces the element ("hero-title" → "Hero
 * title"); an id the embed assigned (`rcf-…`) never shows.
 */
export function describeElement({
  selector,
  elementType,
  elementId,
  pageLabel,
}: ElementLocationInput): string {
  const segments = splitSelector(selector ?? "").map(parseSegment);
  const tag = elementType?.trim().toLowerCase() || segments.at(-1)?.tag || null;

  const authorId =
    elementId && !elementId.toLowerCase().startsWith(EMBED_ID_PREFIX)
      ? humanize(elementId)
      : "";
  const element = authorId || elementLabel(tag, segments);

  const place = placeLabel(segments.slice(0, -1));
  if (!place || place.toLowerCase() === pageLabel.trim().toLowerCase()) {
    return element;
  }
  return `${place}${PLACE_SEPARATOR}${element}`;
}
