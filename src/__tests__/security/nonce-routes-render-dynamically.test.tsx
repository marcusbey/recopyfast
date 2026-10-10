/**
 * s79 (ADR 059) — every segment served under the nonce policy renders per
 * request.
 *
 * Next stamps the per-request nonce only while rendering a request. A page it
 * prerendered at build time carries no nonce, and under the nonce policy its
 * scripts are all refused: measured on this repo, `/signup` left static under
 * the policy blocked fourteen chunks and three inline scripts and never
 * hydrated (docs/research/s79-headers-csp-ws.md). Nothing in a unit test can
 * prerender a page, so the property pinned here is the cause: each segment's
 * layout waits for the request (`connection()`) before it renders anything,
 * which is what makes Next render every page below it per request. The
 * browser half is `e2e/csp.spec.ts`, against a production build.
 *
 * The layout table is keyed by `NONCE_POLICY_PATH_PREFIXES` and compared with
 * it, so adding a prefix without a layout fails here rather than in production.
 *
 * s79 review F1: a URL under a segment that matches no page (`/login/x`, a
 * signed-in owner's mistyped `/dashboard/...`) used to get Next's prebuilt
 * `/_not-found` — static, so no nonce — served under the nonce policy: every
 * script refused, a 404 that never hydrated. Each segment therefore owns a
 * catch-all page that calls `notFound()`. It sits below the segment's layout,
 * so the 404 renders per request like every other page there. The table of
 * catch-alls is keyed and compared the same way as the layouts.
 */

import React, { isValidElement, type ReactNode } from "react";

jest.mock("next/server", () => ({ connection: jest.fn() }));

jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { connection } from "next/server";
import { notFound } from "next/navigation";
import RootLayout from "@/app/layout";
import { DashboardFrame } from "@/app/dashboard/DashboardFrame";
import { NONCE_POLICY_PATH_PREFIXES } from "@/lib/security/content-security-policy";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme-init-script";

type Layout = (props: { children: ReactNode }) => Promise<ReactNode>;

const LAYOUTS: Record<string, () => Promise<{ default: Layout }>> = {
  "/dashboard": () => import("@/app/dashboard/layout"),
  "/login": () => import("@/app/login/layout"),
  "/signup": () => import("@/app/signup/layout"),
  "/edit": () => import("@/app/edit/layout"),
};

type CatchAllPage = () => unknown;

const UNMATCHED_URL_PAGES: Record<
  string,
  () => Promise<{ default: CatchAllPage }>
> = {
  "/dashboard": () => import("@/app/dashboard/[...missing]/page"),
  "/login": () => import("@/app/login/[...missing]/page"),
  "/signup": () => import("@/app/signup/[...missing]/page"),
  "/edit": () => import("@/app/edit/[...missing]/page"),
};

/** Depth-first: is `target` somewhere in this element tree? */
function contains(node: ReactNode, target: ReactNode): boolean {
  if (node === target) return true;
  if (Array.isArray(node)) return node.some((child) => contains(child, target));
  if (!isValidElement(node)) return false;
  const props = node.props as { children?: ReactNode };
  return contains(props.children, target);
}

/** Every element of a type in this tree, props included. */
function findAll(node: ReactNode, type: string): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  const here = node.type === type ? [node] : [];
  return [...here, ...findAll(props.children, type)];
}

beforeEach(() => {
  (connection as jest.Mock).mockReset();
  (notFound as unknown as jest.Mock).mockClear();
});

it("covers exactly the nonce-policy segments", () => {
  expect(Object.keys(LAYOUTS)).toEqual([...NONCE_POLICY_PATH_PREFIXES]);
  expect(Object.keys(UNMATCHED_URL_PAGES)).toEqual([
    ...NONCE_POLICY_PATH_PREFIXES,
  ]);
});

describe.each(NONCE_POLICY_PATH_PREFIXES)(
  "a URL under %s that matches no page",
  (prefix) => {
    it("lands on the segment's own catch-all and invokes notFound()", async () => {
      const { default: Page } = await UNMATCHED_URL_PAGES[prefix]();

      expect(() => Page()).toThrow("NEXT_NOT_FOUND");
      expect(notFound).toHaveBeenCalledTimes(1);
    });
  },
);

describe.each(NONCE_POLICY_PATH_PREFIXES)("the %s layout", (prefix) => {
  it("renders nothing until the request is there", async () => {
    let release: () => void = () => undefined;
    (connection as jest.Mock).mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const { default: Layout } = await LAYOUTS[prefix]();
    const child = <p>page</p>;

    let isSettled = false;
    const rendering = Layout({ children: child }).then((tree) => {
      isSettled = true;
      return tree;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(connection).toHaveBeenCalledTimes(1);
    expect(isSettled).toBe(false);

    release();
    expect(contains(await rendering, child)).toBe(true);
  });

  it("fails the render when the request cannot be awaited", async () => {
    (connection as jest.Mock).mockRejectedValue(new Error("no request"));
    const { default: Layout } = await LAYOUTS[prefix]();

    await expect(Layout({ children: <p>page</p> })).rejects.toThrow(
      "no request",
    );
  });
});

it("draws the dashboard inside its client frame", async () => {
  (connection as jest.Mock).mockResolvedValue(undefined);
  const { default: Layout } = await LAYOUTS["/dashboard"]();
  const child = <p>page</p>;

  const tree = (await Layout({ children: child })) as React.ReactElement;

  expect(tree.type).toBe(DashboardFrame);
  expect((tree.props as { children: ReactNode }).children).toBe(child);
});

it("the root layout renders the very script the policy hashes", () => {
  const tree = RootLayout({ children: null });
  const scripts = findAll(tree, "script");

  expect(scripts).toHaveLength(1);
  expect(
    (scripts[0].props as { dangerouslySetInnerHTML: { __html: string } })
      .dangerouslySetInnerHTML.__html,
  ).toBe(THEME_INIT_SCRIPT);
});
