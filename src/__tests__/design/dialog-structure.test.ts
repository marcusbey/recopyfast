/**
 * @jest-environment node
 *
 * s66a AC 5 — every dialog is a frame, a body that scrolls, and nothing else.
 *
 * `DialogContent` used to be a padded, scrolling grid. A grid item keeps
 * `min-width: auto`, so one unwrapped 300-character snippet set the column to
 * 2,524 px inside a 588 px panel (s66 research, fact 1), on all 12 call sites.
 * The fix lives in the primitive, and it only holds if call sites stop
 * re-adding the layout the primitive took away: `overflow-y-auto` on the frame
 * brings back a second scroll region, `grid`/`gap-*` brings back the grid,
 * padding fights the header/body/footer insets.
 *
 * So, for every `<DialogContent` call site on an app surface:
 * - its own children include a `<DialogBody`, the one scroll region. Per call
 *   site, not per file: a file with two dialogs and one body passed the old
 *   per-file check. A body with nothing to show collapses by itself
 *   (`empty:hidden` in the primitive), so confirm dialogs keep it too;
 * - the `className` it passes carries width only (`max-w-*` / `w-*`, any
 *   breakpoint prefix).
 *
 * A source scan cannot see a `<form>` that wraps body and footer without
 * `flex min-h-0 flex-1 flex-col`; the Playwright harness's single-scroll
 * assertion is the check for that (plan "where this could be wrong" 3).
 */

import {
  appSurfaceFiles,
  baseUtility,
  readSource,
  stripComments,
} from "./app-surface";

interface OpeningTag {
  line: number;
  text: string;
  /** Index just past the tag's closing `>`. */
  end: number;
}

const DIALOG_CONTENT_OPEN = /<DialogContent(?=[\s>/])/g;
const DIALOG_CONTENT_CLOSE = "</DialogContent>";

/** Each `<DialogContent …>` opening tag, read to its closing `>`. */
function dialogContentTags(code: string): OpeningTag[] {
  const tags: OpeningTag[] = [];
  for (const match of code.matchAll(DIALOG_CONTENT_OPEN)) {
    const start = match.index ?? 0;
    let depth = 0;
    let quote: string | null = null;
    let end = start;
    for (let index = start; index < code.length; index += 1) {
      const char = code[index];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        end = index;
        break;
      }
    }
    tags.push({
      line: code.slice(0, start).split("\n").length,
      text: code.slice(start, end + 1),
      end: end + 1,
    });
  }
  return tags;
}

interface DialogContentElement {
  line: number;
  /** The source between the opening tag and its own `</DialogContent>`. */
  children: string;
}

/**
 * Each `<DialogContent>` call site with its own children, so the body check
 * is per dialog: a file with two dialogs and one `DialogBody` is not enough
 * (s66a review m1). Nested `DialogContent`s are depth-counted.
 */
function dialogContentElements(code: string): DialogContentElement[] {
  return dialogContentTags(code).map((tag) => {
    if (tag.text.endsWith("/>")) return { line: tag.line, children: "" };
    let depth = 1;
    let cursor = tag.end;
    while (depth > 0) {
      const close = code.indexOf(DIALOG_CONTENT_CLOSE, cursor);
      if (close === -1)
        return { line: tag.line, children: code.slice(tag.end) };
      const opens = Array.from(
        code.slice(cursor, close).matchAll(DIALOG_CONTENT_OPEN),
      ).length;
      depth += opens - 1;
      if (depth === 0) {
        return { line: tag.line, children: code.slice(tag.end, close) };
      }
      cursor = close + DIALOG_CONTENT_CLOSE.length;
    }
    return { line: tag.line, children: "" };
  });
}

function hasDialogBody(children: string): boolean {
  return /<DialogBody(?=[\s>/])/.test(children);
}

/** The class tokens a tag passes through `className`, from every literal in it. */
function classNameTokens(tag: string): string[] {
  const at = tag.indexOf("className=");
  if (at === -1) return [];
  const rest = tag.slice(at + "className=".length);
  let value = rest;
  if (rest.startsWith("{")) {
    let depth = 0;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === "{") depth += 1;
      if (rest[index] === "}") depth -= 1;
      if (depth === 0) {
        value = rest.slice(0, index + 1);
        break;
      }
    }
  } else {
    const quote = rest[0];
    value = rest.slice(0, rest.indexOf(quote, 1) + 1);
  }
  const literals = Array.from(
    value.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  return literals.join(" ").split(/\s+/).filter(Boolean);
}

const WIDTH_ONLY = /^(max-w-|w-)/;

function layoutViolations(tag: string): string[] {
  return classNameTokens(tag).filter(
    (token) => !WIDTH_ONLY.test(baseUtility(token)),
  );
}

describe("dialog structure (design system, Dialogs and sheets)", () => {
  const dialogFiles = appSurfaceFiles()
    .map((file) => ({ file, code: stripComments(readSource(file)) }))
    .filter(({ code }) => /<DialogContent(?=[\s>/])/.test(code));

  it("finds the reachable dialog call sites", () => {
    // 11 files, 12 call sites at s66a (sites/page.tsx has two).
    expect(dialogFiles.length).toBeGreaterThanOrEqual(11);
  });

  it("renders a DialogBody inside every DialogContent call site", () => {
    const missing = dialogFiles.flatMap(({ file, code }) =>
      dialogContentElements(code)
        .filter((element) => !hasDialogBody(element.children))
        .map((element) => `${file}:${element.line}`),
    );
    expect(missing).toEqual([]);
  });

  it("passes width only to DialogContent", () => {
    const violations = dialogFiles.flatMap(({ file, code }) =>
      dialogContentTags(code)
        .map((tag) => ({ tag, tokens: layoutViolations(tag.text) }))
        .filter(({ tokens }) => tokens.length > 0)
        .map(({ tag, tokens }) => `${file}:${tag.line} ${tokens.join(" ")}`),
    );
    expect(violations).toEqual([]);
  });

  describe("the parser (self-test)", () => {
    it.each([
      ['<DialogContent className="sm:max-w-md">', []],
      ['<DialogContent className="max-w-[40rem] w-full">', []],
      ["<DialogContent>", []],
      [
        '<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">',
        ["max-h-[90vh]", "overflow-y-auto"],
      ],
      [
        '<DialogContent\n  className={cn("sm:max-w-md", "rounded-2xl p-6")}\n  onEscapeKeyDown={(e) => e.preventDefault()}\n>',
        ["rounded-2xl", "p-6"],
      ],
      ['<DialogContent className="grid gap-4 sm:max-w-md">', ["grid", "gap-4"]],
    ])("reads %s", (source, expected) => {
      const [tag] = dialogContentTags(source);
      expect(layoutViolations(tag.text)).toEqual(expected);
    });

    it("does not mistake an arrow function for the end of the tag", () => {
      const [tag] = dialogContentTags(
        '<DialogContent onInteractOutside={(e) => e.preventDefault()} className="p-4">',
      );
      expect(layoutViolations(tag.text)).toEqual(["p-4"]);
    });

    it("checks each DialogContent on its own, not the file", () => {
      const source = [
        "<Dialog>",
        '  <DialogContent className="sm:max-w-md">',
        "    <DialogHeader />",
        "    <DialogBody>first</DialogBody>",
        "  </DialogContent>",
        "</Dialog>",
        "<Dialog>",
        '  <DialogContent className="sm:max-w-md">',
        "    <DialogHeader />",
        "    <div>second</div>",
        "  </DialogContent>",
        "</Dialog>",
      ].join("\n");
      const missing = dialogContentElements(source)
        .filter((element) => !hasDialogBody(element.children))
        .map((element) => element.line);
      expect(missing).toEqual([8]);
    });

    it("reads a self-closing DialogContent as having no body", () => {
      const [element] = dialogContentElements(
        '<DialogContent className="sm:max-w-md" />',
      );
      expect(hasDialogBody(element.children)).toBe(false);
    });
  });
});
