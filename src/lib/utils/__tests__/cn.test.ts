/**
 * `cn()` must know ADR 050's two radius tokens.
 *
 * tailwind-merge v3 only recognises T-shirt sizes as radius values. Without the
 * extension, `cn("rounded-container", "rounded-2xl")` ships both classes and
 * CSS source order picks the winner, so a call-site override could silently
 * lose to the primitive's radius (or the other way round).
 */

import { cn } from "@/lib/utils/cn";

describe("cn", () => {
  it("lets a later legacy radius replace rounded-container", () => {
    expect(cn("rounded-container", "rounded-2xl")).toBe("rounded-2xl");
  });

  it("lets rounded-control replace an earlier legacy radius", () => {
    expect(cn("rounded-lg", "rounded-control")).toBe("rounded-control");
  });

  it("lets rounded-none replace rounded-control", () => {
    expect(cn("rounded-control", "rounded-none")).toBe("rounded-none");
  });

  it("still merges unrelated utilities as before", () => {
    expect(cn("px-2 rounded-control", "px-4")).toBe("rounded-control px-4");
  });
});
