/**
 * @jest-environment node
 *
 * s66a AC 6 / ADR 051 — every form select on the app surface is a NativeSelect.
 *
 * Research (fact 7) found 8 reachable native <select>s styled with 5 different
 * class strings, none with `appearance-none`, so the browser drew its own
 * chevron about 6 px from the border: the owner's second screenshot ("Expires
 * in", Share preview link). Fixing the eight strings would leave nothing to
 * stop the ninth, so the raw element is allowed in exactly one file: the
 * primitive that draws the chevron 12 px inside the border.
 */

import { appSurfaceFiles, readSource, stripComments } from "./app-surface";

const PRIMITIVE = "src/components/ui/native-select.tsx";

function rawSelectLines(source: string): number[] {
  return stripComments(source)
    .split("\n")
    .flatMap((text, index) =>
      /<select(?=[\s>/]|$)/.test(text) ? [index + 1] : [],
    );
}

describe("native select guard (ADR 051)", () => {
  it("renders no raw <select> outside ui/native-select.tsx", () => {
    const offenders = appSurfaceFiles()
      .filter((file) => file !== PRIMITIVE)
      .flatMap((file) =>
        rawSelectLines(readSource(file)).map((line) => `${file}:${line}`),
      );
    expect(offenders).toEqual([]);
  });

  it("finds a raw select, and ignores one quoted in a comment (self-test)", () => {
    expect(rawSelectLines('<div>\n  <select id="expiry">')).toEqual([2]);
    // Prettier puts a multi-line element's attributes on the next lines.
    expect(rawSelectLines('<div>\n  <select\n    id="expiry"')).toEqual([2]);
    expect(rawSelectLines("// a native <select> keeps the OS picker")).toEqual(
      [],
    );
    expect(rawSelectLines("<SelectTrigger />")).toEqual([]);
  });
});
