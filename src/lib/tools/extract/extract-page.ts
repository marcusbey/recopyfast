/**
 * What a lens may read off a fetched page (s96, plan decision 5).
 *
 * WHY parse5 AND NOT jsdom. parse5 builds a tree and does nothing else: no DOM,
 * no script execution, no subresource loading, no CSS — by construction, not
 * by configuration. jsdom (already a dependency, for content-sanitizer.ts) is
 * a browser emulation whose safety depends on options staying off, and it
 * costs an order of magnitude more memory on a 2 MB page. parse5 is the parser
 * jsdom itself uses, already in the lockfile, now a direct dependency.
 *
 * THE CONTRACT IS FROZEN HERE. `ExtractedPage` carries the text blocks the
 * Typo Finder reads AND the images, meta tags, script sources and captured
 * headers that the CSP checker (s97) and the Alt Text Checker (s101) read.
 * Those two stories are fixed by the architect, so these fields are not
 * speculative; keeping them here stops three parallel PRs editing one file.
 *
 * WHAT COUNTS AS VISIBLE TEXT. Block by block, inline elements merged into
 * their block. Script, style, template, code-like and form-control content is
 * excluded, as is anything `hidden`, `aria-hidden="true"` or styled
 * `display:none` / `visibility:hidden` inline. Bidi controls, zero-width
 * characters and soft hyphens are stripped (`@/lib/tools/text`). One `hidden`
 * is read: a React streaming segment, `<div hidden id="S:0">`. The Suspense
 * fallback that segment replaces is skipped instead (s96c, see
 * `STREAMED_SEGMENT_ID`).
 *
 * BOUNDED AND ITERATIVE. Every list is capped, and the tree is walked with an
 * explicit stack: 50,000 nested `<div>`s would overflow a recursive walk.
 * Malformed or binary input never throws — parse5 recovers from anything, and
 * the walk only reads what it finds.
 *
 * THE PARSER ITSELF IS BOUNDED TOO (found while writing this module). The
 * HTML tree-construction algorithm scans the stack of open elements on many
 * tokens, so parse5 is quadratic in nesting depth: measured on Node 24.14,
 * 200 KB of `<ul><li>` took 18 s, `<dl><dt>` 17 s, `<b><div>` 14 s, and one
 * tag with 40,000 distinct attributes 3.2 s. A 2 MB page is a 100× larger
 * input. The fetch cap bounds bytes, not this. So the parse runs:
 * - with a tree adapter that refuses a document deeper than 512 elements
 *   (Chrome's own parser nesting limit) or holding more than 100,000;
 * - in 16 KB chunks, abandoning the page once 1.5 s of parsing is spent — the
 *   backstop for any blow-up the two caps do not name.
 * A refused page is `too_complex`; the scan reports it like a page over the
 * size cap. `Parser` is parse5's streaming entry point (what
 * parse5-parser-stream drives); a version that changes it fails this suite.
 */

import {
  defaultTreeAdapter,
  Parser,
  type DefaultTreeAdapterMap,
  type TreeAdapter,
} from "parse5";

import type { CapturedHeaders } from "@/lib/tools/fetch/captured-headers";
import {
  clampText,
  collapseWhitespace,
  stripInvisibleCharacters,
} from "@/lib/tools/text";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];
type CommentNode = DefaultTreeAdapterMap["commentNode"];

export const MAX_BLOCKS = 2_000;
export const MAX_BLOCK_CHARS = 2_000;
export const MAX_PAGE_TEXT_CHARS = 200 * 1024;
export const MAX_IMAGES = 200;
export const MAX_ASSET_REFERENCES = 50;
export const MAX_ROOT_ATTRIBUTES = 40;
export const MAX_SAME_HOST_LINKS = 100;
const MAX_META_CSP = 10;
export const MAX_TREE_DEPTH = 512;
export const MAX_ELEMENTS = 100_000;
export const PARSE_BUDGET_MS = 1_500;
const PARSE_CHUNK_CHARS = 16 * 1024;
const MAX_URL_LENGTH = 2_048;

export interface ExtractedBlock {
  tag: string;
  text: string;
}

export interface ExtractedImage {
  /** Absolute http(s) URL, `data:<mime>` for an inline image, else null. */
  src: string | null;
  /** null when the attribute is ABSENT; "" when it is present and empty. */
  alt: string | null;
  role: string | null;
  ariaHidden: boolean;
  width: number | null;
  height: number | null;
  inLink: boolean;
  linkHasText: boolean;
}

export interface RootAttribute {
  element: "html" | "body";
  name: string;
  value: string;
}

export interface ExtractedPage {
  url: string;
  title: string;
  lang: string | null;
  baseUrl: string;
  blocks: ExtractedBlock[];
  wordCount: number;
  siteName: string | null;
  generator: string | null;
  metaCsp: string[];
  metaRefresh: string | null;
  images: ExtractedImage[];
  scriptSrcs: string[];
  scriptIds: string[];
  stylesheetHrefs: string[];
  rootAttributes: RootAttribute[];
  sameHostLinks: string[];
  headers: CapturedHeaders;
  /** True when any cap above cut something off. */
  truncated: boolean;
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "button",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const EXCLUDED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "code",
  "pre",
  "kbd",
  "samp",
  "textarea",
  "select",
  "iframe",
  "object",
  "title",
]);

const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;

/**
 * A React streaming segment: `<div hidden id="S:<id>">` (s96c).
 *
 * THE INCIDENT. Right after s96 shipped, the Typo Finder told us that our own
 * https://www.recopyfa.st/terms "shows almost no text in its HTML". The page
 * is server-rendered, but a Next.js App Router page that streams through a
 * Suspense boundary (there, the root `loading.tsx`) sends the boundary's
 * FALLBACK in the visible shell. The real content arrives later in the same
 * response inside `<div hidden id="S:0">`, and React's inline
 * `$RC("B:0","S:0")` moves it into place. Reading every `hidden` as hidden
 * left one word, "Loading…", on every such page — and many of the sites our
 * users build are App Router sites.
 *
 * So a hidden element whose id is a segment id is read where it sits. Its
 * place in the page does not matter for what a lens looks for; leaving it out
 * does. Only the `hidden` attribute is waived: `aria-hidden` and an inline
 * `display:none` still hide it. The fallback it replaces is skipped by the
 * walk (`PENDING_BOUNDARY_START`).
 *
 * HEXADECIMAL, NOT DIGITS. React writes the id as `id.toString(16)`
 * (`writeStartSegment` in react-dom/server, and in Next's compiled copy), so
 * the eleventh segment is `S:a`. `/^S:\d+$/` would silently drop it.
 */
const STREAMED_SEGMENT_ID = /^S:[0-9a-f]+$/;

/**
 * The fallback that a segment replaces (s96c). React writes a pending boundary
 * as `<!--$?--><template id="B:<id>"></template>FALLBACK<!--/$-->`, and its
 * `$RV` removes the template and every next sibling up to the MATCHING
 * `<!--/$-->`. It counts depth: `$`, `$?`, `$!`, `$~` and `&` open a level,
 * `/$` and `/&` close one. Then it moves the segment in. The walk skips that
 * same run. On /terms the fallback was "Loading…": loading UI is not the
 * page's copy, so it is never read and never counts toward "has text",
 * whether or not its segment arrived.
 *
 * A `<!--$!-->` boundary (rendered on the client after a server error) is not
 * pending. Its content stays on screen, so it is read as before.
 */
const PENDING_BOUNDARY_START = "$?";
const PENDING_BOUNDARY_TEMPLATE_ID = /^B:[0-9a-f]+$/;
const BOUNDARY_OPENERS: ReadonlySet<string> = new Set([
  "$",
  "$?",
  "$!",
  "$~",
  "&",
]);
const BOUNDARY_CLOSERS: ReadonlySet<string> = new Set(["/$", "/&"]);

function attr(element: Element, name: string): string | null {
  const found = element.attrs.find((attribute) => attribute.name === name);
  return found ? found.value : null;
}

function isStreamedSegment(element: Element): boolean {
  return STREAMED_SEGMENT_ID.test(attr(element, "id") ?? "");
}

/**
 * Not rendered, or not exposed. `aria-hidden` hides TEXT from the reading we
 * do, but an aria-hidden image is still an image on the page — the Alt Text
 * Checker reports it as decorative — so images ask without it.
 */
function isHidden(element: Element, countAriaHidden = true): boolean {
  if (attr(element, "hidden") !== null && !isStreamedSegment(element)) {
    return true;
  }
  if (
    countAriaHidden &&
    (attr(element, "aria-hidden") ?? "").trim().toLowerCase() === "true"
  ) {
    return true;
  }
  return HIDDEN_STYLE.test(attr(element, "style") ?? "");
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function isText(node: Node): node is TextNode {
  return node.nodeName === "#text";
}

function isComment(node: Node): node is CommentNode {
  return node.nodeName === "#comment";
}

function cleanText(raw: string): string {
  return collapseWhitespace(stripInvisibleCharacters(raw));
}

function optionalText(raw: string | null, max: number): string | null {
  if (raw === null) return null;
  const text = clampText(cleanText(raw), max);
  return text ? text : null;
}

function webUrl(raw: string, base: string): URL | null {
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.length <= MAX_URL_LENGTH ? url : null;
  } catch {
    return null;
  }
}

function resolveImageSource(raw: string | null, base: string): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^data:/i.test(trimmed)) {
    const mime = /^data:([\w.+-]+\/[\w.+-]+)/i.exec(trimmed)?.[1];
    return mime ? `data:${mime.toLowerCase()}` : "data:";
  }
  return webUrl(trimmed, base)?.href ?? null;
}

function firstSrcsetCandidate(srcset: string | null): string | null {
  if (!srcset) return null;
  const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
  return first ? first : null;
}

function dimension(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function countWords(text: string): number {
  return text.split(" ").filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

interface RawImage {
  src: string | null;
  alt: string | null;
  role: string | null;
  ariaHidden: boolean;
  width: number | null;
  height: number | null;
  inLink: boolean;
  linkHasText: boolean;
}

interface LinkContext {
  hasText: boolean;
  images: RawImage[];
}

type Frame = { node: Node; exit: boolean };

/**
 * True when `comment` opens a pending boundary: `<!--$?-->` directly followed
 * by `<template id="B:<id>">`. A comment has no children, so the frame on top
 * of the stack is its next sibling (or its parent's exit). Peeking at it costs
 * O(1); looking the sibling up by index would be quadratic on a page made of
 * 100,000 templates.
 */
function opensPendingFallback(
  comment: CommentNode,
  stack: readonly Frame[],
): boolean {
  if (comment.data !== PENDING_BOUNDARY_START) return false;
  const next = stack[stack.length - 1];
  return (
    next !== undefined &&
    !next.exit &&
    isElement(next.node) &&
    next.node.tagName === "template" &&
    PENDING_BOUNDARY_TEMPLATE_ID.test(attr(next.node, "id") ?? "")
  );
}

/** The fallback depth after skipping `node`, or null once its closer is passed. */
function depthAfter(node: Node, depth: number): number | null {
  if (!isComment(node)) return depth;
  if (BOUNDARY_CLOSERS.has(node.data)) return depth === 0 ? null : depth - 1;
  return BOUNDARY_OPENERS.has(node.data) ? depth + 1 : depth;
}

class PageTooComplexError extends Error {
  constructor() {
    super("The page is too deeply nested or too large to parse");
    this.name = "PageTooComplexError";
  }
}

/** The default tree adapter, refusing depth and element counts past the caps. */
function boundedTreeAdapter(): TreeAdapter<DefaultTreeAdapterMap> {
  const depthOf = new WeakMap<object, number>();
  let elements = 0;
  const place = (parent: object, node: Node) => {
    const depth = (depthOf.get(parent) ?? 0) + 1;
    if (depth > MAX_TREE_DEPTH) throw new PageTooComplexError();
    depthOf.set(node, depth);
    // A template's children live in its content fragment, which would
    // otherwise restart the count at zero.
    if (isElement(node) && node.tagName === "template") {
      depthOf.set(
        defaultTreeAdapter.getTemplateContent(
          node as DefaultTreeAdapterMap["template"],
        ),
        depth,
      );
    }
  };
  return {
    ...defaultTreeAdapter,
    createElement(tagName, namespaceURI, attrs) {
      elements += 1;
      if (elements > MAX_ELEMENTS) throw new PageTooComplexError();
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
    },
    appendChild(parent, node) {
      place(parent, node);
      defaultTreeAdapter.appendChild(parent, node);
    },
    insertBefore(parent, node, reference) {
      place(parent, node);
      defaultTreeAdapter.insertBefore(parent, node, reference);
    },
  };
}

function parseBounded(
  html: string,
  budgetMs: number,
): DefaultTreeAdapterMap["document"] {
  const parser = new Parser<DefaultTreeAdapterMap>({
    treeAdapter: boundedTreeAdapter(),
  });
  const started = performance.now();
  for (let offset = 0; offset < html.length; offset += PARSE_CHUNK_CHARS) {
    parser.tokenizer.write(
      html.slice(offset, offset + PARSE_CHUNK_CHARS),
      false,
    );
    if (performance.now() - started > budgetMs) throw new PageTooComplexError();
  }
  parser.tokenizer.write("", true);
  return parser.document;
}

export type ExtractResult =
  | { ok: true; page: ExtractedPage }
  | { ok: false; reason: "too_complex" };

export interface ExtractOptions {
  /** The final URL the page was fetched from. */
  url: string;
  headers: CapturedHeaders;
  /** Parse time allowed for this page. Tests shorten it. */
  parseBudgetMs?: number;
}

export function extractPage(
  html: string,
  { url, headers, parseBudgetMs = PARSE_BUDGET_MS }: ExtractOptions,
): ExtractResult {
  const page: ExtractedPage = {
    url,
    title: "",
    lang: null,
    baseUrl: url,
    blocks: [],
    wordCount: 0,
    siteName: null,
    generator: null,
    metaCsp: [],
    metaRefresh: null,
    images: [],
    scriptSrcs: [],
    scriptIds: [],
    stylesheetHrefs: [],
    rootAttributes: [],
    sameHostLinks: [],
    headers,
    truncated: false,
  };

  let document: DefaultTreeAdapterMap["document"];
  try {
    document = parseBounded(html, parseBudgetMs);
  } catch (error) {
    if (error instanceof PageTooComplexError) {
      return { ok: false, reason: "too_complex" };
    }
    // parse5 does not throw on malformed input; anything else here is a bug in
    // a dependency, and a page that cannot be read is reported as one.
    console.error("[tools/extract] parse failed:", error);
    return { ok: false, reason: "too_complex" };
  }

  const rawImages: RawImage[] = [];
  const rawScriptSrcs: string[] = [];
  const rawStylesheets: string[] = [];
  const rawLinks: string[] = [];
  let rawBase: string | null = null;
  let hasTitle = false;

  const blockStack: string[] = [];
  const links: LinkContext[] = [];
  let buffer = "";
  let textChars = 0;

  const flush = () => {
    if (!buffer) return;
    const text = cleanText(buffer);
    buffer = "";
    if (!text) return;
    if (page.blocks.length >= MAX_BLOCKS || textChars >= MAX_PAGE_TEXT_CHARS) {
      page.truncated = true;
      return;
    }
    let kept = clampText(text, MAX_BLOCK_CHARS);
    if (kept.length < text.length) page.truncated = true;
    if (textChars + kept.length > MAX_PAGE_TEXT_CHARS) {
      kept = clampText(kept, MAX_PAGE_TEXT_CHARS - textChars);
      page.truncated = true;
    }
    if (!kept) return;
    textChars += kept.length;
    page.wordCount += countWords(kept);
    page.blocks.push({
      tag: blockStack[blockStack.length - 1] ?? "body",
      text: kept,
    });
  };

  const readHead = (element: Element, tag: string) => {
    if (tag === "base" && rawBase === null) {
      rawBase = attr(element, "href");
    } else if (tag === "meta") {
      const property = (attr(element, "property") ?? "").toLowerCase();
      const name = (attr(element, "name") ?? "").toLowerCase();
      const equiv = (attr(element, "http-equiv") ?? "").toLowerCase();
      const content = attr(element, "content");
      if (property === "og:site_name" && page.siteName === null) {
        page.siteName = optionalText(content, 200);
      } else if (name === "generator" && page.generator === null) {
        page.generator = optionalText(content, 200);
      } else if (equiv === "content-security-policy" && content !== null) {
        if (page.metaCsp.length < MAX_META_CSP) {
          page.metaCsp.push(clampText(content.trim(), 4_096));
        }
      } else if (equiv === "refresh" && page.metaRefresh === null) {
        page.metaRefresh = optionalText(content, 300);
      }
    } else if (tag === "link") {
      const rel = (attr(element, "rel") ?? "").toLowerCase().split(/\s+/);
      const href = attr(element, "href");
      if (rel.includes("stylesheet") && href !== null)
        rawStylesheets.push(href);
    } else if (tag === "script") {
      const src = attr(element, "src");
      const id = attr(element, "id");
      if (src !== null) rawScriptSrcs.push(src);
      if (id !== null && page.scriptIds.length < MAX_ASSET_REFERENCES) {
        page.scriptIds.push(clampText(id, 200));
      }
    } else if (tag === "title" && !hasTitle) {
      hasTitle = true;
      const text = element.childNodes
        .filter(isText)
        .map((node) => node.value)
        .join("");
      page.title = clampText(cleanText(text), 300);
    }
  };

  const readImage = (element: Element) => {
    const image: RawImage = {
      src:
        attr(element, "src") ??
        attr(element, "data-src") ??
        firstSrcsetCandidate(attr(element, "srcset")),
      alt: attr(element, "alt"),
      role: optionalText(attr(element, "role"), 50),
      ariaHidden:
        (attr(element, "aria-hidden") ?? "").trim().toLowerCase() === "true",
      width: dimension(attr(element, "width")),
      height: dimension(attr(element, "height")),
      inLink: links.length > 0,
      linkHasText: false,
    };
    if (image.alt !== null) image.alt = clampText(cleanText(image.alt), 1_000);
    rawImages.push(image);
    links[links.length - 1]?.images.push(image);
  };

  const stack: Frame[] = document.childNodes
    .slice()
    .reverse()
    .map((node) => ({ node, exit: false }));

  // Depth inside a pending boundary's fallback (s96c), null outside one.
  let fallbackDepth: number | null = null;

  while (stack.length > 0) {
    const { node, exit } = stack.pop() as Frame;

    if (fallbackDepth !== null) {
      if (!exit) {
        // A sibling inside the fallback: skipped whole, children and all.
        fallbackDepth = depthAfter(node, fallbackDepth);
        continue;
      }
      // Its parent ended before the closer did (malformed markup): the
      // fallback cannot reach past it, so reading resumes here.
      fallbackDepth = null;
    }

    if (isComment(node)) {
      if (opensPendingFallback(node, stack)) {
        fallbackDepth = 0;
        // Like an excluded element, the fallback still separates words.
        buffer += " ";
      }
      continue;
    }

    if (isText(node)) {
      buffer += node.value;
      if (links.length > 0 && /\S/.test(node.value)) {
        links[links.length - 1].hasText = true;
      }
      continue;
    }
    if (!isElement(node)) continue;

    const tag = node.tagName.toLowerCase();

    if (exit) {
      if (BLOCK_TAGS.has(tag)) {
        flush();
        blockStack.pop();
      }
      if (tag === "a") {
        const link = links.pop();
        for (const image of link?.images ?? [])
          image.linkHasText = link!.hasText;
      }
      continue;
    }

    readHead(node, tag);

    if (tag === "html" && page.lang === null) {
      const lang = optionalText(attr(node, "lang"), 35);
      page.lang = lang ? lang.toLowerCase() : null;
    }
    if (tag === "html" || tag === "body") {
      for (const attribute of node.attrs) {
        if (page.rootAttributes.length >= MAX_ROOT_ATTRIBUTES) break;
        page.rootAttributes.push({
          element: tag,
          name: clampText(attribute.name, 100),
          value: clampText(attribute.value, 200),
        });
      }
    }

    if (tag === "img") {
      if (!isHidden(node, false)) readImage(node);
      continue;
    }

    if (EXCLUDED_TAGS.has(tag) || isHidden(node)) {
      // An excluded inline element still separates the words either side.
      buffer += " ";
      continue;
    }

    if (tag === "br" || tag === "wbr") {
      buffer += tag === "br" ? " " : "";
      continue;
    }
    if (tag === "a") {
      const href = attr(node, "href");
      if (href !== null) rawLinks.push(href);
      links.push({ hasText: false, images: [] });
    }
    if (BLOCK_TAGS.has(tag)) {
      flush();
      blockStack.push(tag);
    }

    stack.push({ node, exit: true });
    const children = node.childNodes;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], exit: false });
    }
  }
  flush();

  // The document's base URL is the FIRST <base href>, wherever it sits, so
  // every relative reference is resolved only once the walk is over.
  const base = rawBase !== null ? webUrl(rawBase, url) : null;
  page.baseUrl = base?.href ?? url;

  if (rawImages.length > MAX_IMAGES) page.truncated = true;
  page.images = rawImages.slice(0, MAX_IMAGES).map((image) => ({
    ...image,
    src: resolveImageSource(image.src, page.baseUrl),
  }));

  const resolveAll = (raw: string[]) =>
    Array.from(
      new Set(
        raw
          .map((value) => webUrl(value, page.baseUrl)?.href)
          .filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, MAX_ASSET_REFERENCES);
  page.scriptSrcs = resolveAll(rawScriptSrcs);
  page.stylesheetHrefs = resolveAll(rawStylesheets);

  const pageHost = webUrl(url, url)?.hostname;
  const sameHost = new Set<string>();
  for (const raw of rawLinks) {
    if (sameHost.size >= MAX_SAME_HOST_LINKS) break;
    const link = webUrl(raw, page.baseUrl);
    if (!link || link.hostname !== pageHost) continue;
    link.hash = "";
    link.search = "";
    sameHost.add(link.href);
  }
  page.sameHostLinks = Array.from(sameHost);

  return { ok: true, page };
}
