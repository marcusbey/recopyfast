/**
 * @jest-environment node
 */

/**
 * DataFast on every page — including the nonce (app) surface, so the signup
 * funnel is attributable.
 *
 * The root layout cannot read the request nonce itself: `headers()` there
 * would make every page dynamic, which ADR 059 rejects for the marketing
 * surface. It does not need to. While rendering a request, Next provides the
 * nonce it parsed from the request's CSP header through `HeadManagerContext`,
 * and `next/script` stamps it on the script preload it emits. These tests
 * render the component through Next's real `next/script` and React's real
 * server renderer to pin that: nonce present → preload stamped; static
 * prerender (no nonce) → no nonce attribute, allowed by host instead.
 */

import React from "react";
import { renderToString } from "react-dom/server";
import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context.shared-runtime";
import { DataFastScript } from "@/components/analytics/DataFastScript";
import RootLayout from "@/app/layout";

const NONCE = "bm9uY2UtdmFsdWUtMTIzNA==";

/** Renders a full document, as Next's app renderer does, with an optional nonce. */
function renderDocument(nonce?: string): string {
  return renderToString(
    <HeadManagerContext.Provider value={{ appDir: true, nonce }}>
      <html>
        <head />
        <body>
          <DataFastScript />
        </body>
      </html>
    </HeadManagerContext.Provider>,
  );
}

function scriptPreloads(html: string): string[] {
  return Array.from(html.matchAll(/<link\b[^>]*\bas="script"[^>]*>/g)).map(
    ([tag]) => tag,
  );
}

describe("<DataFastScript />", () => {
  const saved = process.env.NEXT_PUBLIC_DATAFAST_DISABLED;

  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;
    else process.env.NEXT_PUBLIC_DATAFAST_DISABLED = saved;
  });

  it("is next/script, after hydration, with the owner's data attributes", () => {
    delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;

    const element = DataFastScript();

    expect(element).not.toBeNull();
    expect(element?.props).toEqual({
      src: "https://datafa.st/js/script.js",
      strategy: "afterInteractive",
      "data-website-id": "dfid_Vk5ah6dRMY195GtTY4lIP",
      "data-domain": "recopyfa.st",
    });
  });

  it("stamps the request nonce on its preload under the nonce policy", () => {
    delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;

    const preloads = scriptPreloads(renderDocument(NONCE));

    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain('href="https://datafa.st/js/script.js"');
    expect(preloads[0]).toContain(`nonce="${NONCE}"`);
  });

  it("carries no nonce on a prerendered (static policy) page", () => {
    delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;

    const preloads = scriptPreloads(renderDocument());

    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain('href="https://datafa.st/js/script.js"');
    expect(preloads[0]).not.toContain("nonce=");
  });

  it("renders nothing when NEXT_PUBLIC_DATAFAST_DISABLED=true", () => {
    process.env.NEXT_PUBLIC_DATAFAST_DISABLED = "true";

    expect(DataFastScript()).toBeNull();
    expect(scriptPreloads(renderDocument(NONCE))).toEqual([]);
  });
});

/** Depth-first search of a React element tree for an element of `type`. */
function findElements(
  node: React.ReactNode,
  type: unknown,
  parents: unknown[] = [],
): unknown[][] {
  if (!React.isValidElement(node)) {
    return Array.isArray(node)
      ? node.flatMap((child) => findElements(child, type, parents))
      : [];
  }
  const props = node.props as { children?: React.ReactNode };
  const here = node.type === type ? [[...parents, node.type]] : [];
  return [
    ...here,
    ...findElements(props.children, type, [...parents, node.type]),
  ];
}

describe("the root layout", () => {
  it("mounts DataFast once, in <body>, outside any consent gate", () => {
    const tree = RootLayout({ children: null });

    const found = findElements(tree, DataFastScript);

    expect(found).toHaveLength(1);
    // html > body > DataFastScript: not wrapped by AuthProvider or the GA
    // consent runtime, so it runs on every page whatever the consent state.
    expect(found[0]).toEqual(["html", "body", DataFastScript]);
  });
});
