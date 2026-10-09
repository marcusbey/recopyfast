/**
 * @jest-environment node
 */
/**
 * s72 — every `innerHTML` in the embed is a literal.
 *
 * The embed runs on customer domains, beside the edit link's bearer tokens and
 * whatever the customer's own origin keeps in reach. Its contract is copy,
 * never code. One `innerHTML` built from a response — the Edit Board History
 * tab's "by <author>", where the author was a staging invite's address a site
 * admin chose unchecked (s70a review, F1) — was enough to run an attacker's
 * markup there. edit-board-history-xss.test.ts pins that line and the restore
 * panel's two; this guard makes the next dynamic `innerHTML` a red test rather
 * than a review finding. It reads the forms below; a key built at run time
 * (`el['inner' + 'HTML']`) or `document['write']` would slip past it — none
 * exists, and review is the backstop for those (s72 review, minor 1).
 *
 * The rule: the right-hand side of every `.innerHTML =` / `+=` is string
 * literals joined by `+`. The one exception is `svg.innerHTML = ICONS[name]`,
 * an index into a const map whose every value is a literal (checked below).
 * Text a response carries goes in through `textContent`, an attribute, or a
 * DOM node — never through a markup parser.
 *
 * The source is parsed with the TypeScript compiler (already the repo's
 * type-checker), not scanned line by line: a sink split across lines, a
 * template literal, or a markup string in a comment — the s72 tombstone
 * quotes the old line on purpose — must be read as JavaScript reads it.
 * The node environment is deliberate: nothing here needs a DOM.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

const SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

/** The one non-literal sink allowed, by its exact text. */
const ALLOWED_SINK = "svg.innerHTML = ICONS[name]";

/** Every other way to hand a string to the HTML parser. None may occur. */
const OTHER_HTML_SINKS = [
  "outerHTML",
  "insertAdjacentHTML",
  "document.write",
  "createContextualFragment",
  "DOMParser",
  // s72 review minor 1: an iframe's markup, and the HTML Sanitizer API's
  // setHTML / setHTMLUnsafe.
  "srcdoc",
  "setHTML",
];

/** Assignments that hand their right-hand side to `innerHTML`. */
const SINK_ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

interface Sink {
  line: number;
  statement: string;
  rhs: string;
  isLiteral: boolean;
}

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "recopyfast.src.js",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
}

/** A string literal, or string literals joined by `+` (parentheses allowed). */
function isLiteralConcatenation(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) {
    return isLiteralConcatenation(node.expression);
  }
  if (ts.isStringLiteral(node)) return true;
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    isLiteralConcatenation(node.left) &&
    isLiteralConcatenation(node.right)
  );
}

function isInnerHtmlTarget(node: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "innerHTML";
  }
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === "innerHTML"
  );
}

/** Every `innerHTML =` / `+=` / `||=` / `??=` / `&&=` in `text`, comments excluded. */
function htmlSinks(text: string): Sink[] {
  const file = parse(text);
  const sinks: Sink[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      SINK_ASSIGNMENTS.has(node.operatorToken.kind) &&
      isInnerHtmlTarget(node.left)
    ) {
      sinks.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        statement: node.getText(file),
        rhs: node.right.getText(file),
        isLiteral: isLiteralConcatenation(node.right),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return sinks;
}

/**
 * Every place the name `innerHTML` occurs in code (comments excluded): a
 * property access, an element access by literal, an object-literal key
 * (`Object.assign(el, { innerHTML: x })`), a destructuring target, a literal
 * handed to `Reflect.set`. Each must be one of the sinks above — a mention
 * that is not is a sink this scanner cannot judge (s72 review, minor 1).
 */
function innerHtmlMentions(text: string): number {
  const file = parse(text);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) &&
      node.text === "innerHTML"
    ) {
      count += 1;
    } else if (ts.isStringLiteralLike(node) && node.text === "innerHTML") {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

interface IconMember {
  text: string;
  isLiteral: boolean;
}

/**
 * The members of the `const ICONS = { … }` the allowed sink indexes. A member
 * that is not `key: 'literal'` (a shorthand, a spread, a computed value) is
 * reported as not literal.
 */
function iconMapMembers(text: string): IconMember[] {
  const file = parse(text);
  const members: IconMember[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "ICONS" &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        members.push({
          text: property.getText(file),
          isLiteral:
            ts.isPropertyAssignment(property) &&
            ts.isStringLiteral(property.initializer),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return members;
}

describe("the scanner sees what it guards (vacuity guards)", () => {
  it("finds the embed's innerHTML sinks — at least 25 of them", () => {
    expect(htmlSinks(SOURCE).length).toBeGreaterThanOrEqual(25);
  });

  it("reads ||=, ??= and &&= as sinks, and counts a mention it cannot judge", () => {
    const fixture = [
      "el.innerHTML ||= name;",
      "el.innerHTML ??= name;",
      "el.innerHTML &&= name;",
    ].join("\n");
    expect(htmlSinks(fixture).map((sink) => sink.isLiteral)).toEqual([
      false,
      false,
      false,
    ]);
    expect(
      innerHtmlMentions(
        "Object.assign(el, { innerHTML: name }); Reflect.set(el, 'innerHTML', name);",
      ),
    ).toBe(2);
  });

  it("flags a dynamic fixture as dynamic", () => {
    const [fixture] = htmlSinks("el.innerHTML = '<b>' + name + '</b>';");

    expect(fixture).toMatchObject({
      rhs: "'<b>' + name + '</b>'",
      isLiteral: false,
    });
  });
});

describe("the embed hands the HTML parser literals only", () => {
  it("every innerHTML right-hand side is string literals joined by +, but the icon map", () => {
    const dynamic = htmlSinks(SOURCE)
      .filter((sink) => !sink.isLiteral && sink.statement !== ALLOWED_SINK)
      .map((sink) => `line ${sink.line}: ${sink.rhs}`);

    expect(dynamic).toEqual([]);
  });

  it("the allowed icon sink indexes a const map whose every value is a literal", () => {
    expect(
      htmlSinks(SOURCE).filter((sink) => sink.statement === ALLOWED_SINK),
    ).toHaveLength(1);

    const members = iconMapMembers(SOURCE);
    expect(members.length).toBeGreaterThan(0);
    expect(
      members.filter((member) => !member.isLiteral).map((m) => m.text),
    ).toEqual([]);
  });

  it("innerHTML occurs only as the target of a sink this guard judges", () => {
    expect(innerHtmlMentions(SOURCE)).toBe(htmlSinks(SOURCE).length);
  });

  it.each(OTHER_HTML_SINKS)("%s does not occur", (name) => {
    expect(SOURCE.split(name).length - 1).toBe(0);
  });
});
