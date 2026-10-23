/**
 * trackGoal: DataFast's documented queue, installed on first use instead of an
 * inline CSP-hashed snippet, and nothing at all when DataFast is disabled.
 */

import { trackGoal, trackToolGoal } from "@/lib/analytics/datafast-client";

type QueueWindow = Window & {
  datafast?: ((...args: unknown[]) => void) & { q?: unknown[][] };
};
const w = window as QueueWindow;

describe("trackGoal", () => {
  const saved = process.env.NEXT_PUBLIC_DATAFAST_DISABLED;

  afterEach(() => {
    delete w.datafast;
    if (saved === undefined) delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;
    else process.env.NEXT_PUBLIC_DATAFAST_DISABLED = saved;
  });

  it("queues on window.datafast.q before the script has loaded", () => {
    expect(trackGoal("demo_edit", { surface: "demo" })).toBe(true);
    expect(trackGoal("signup_email_submitted")).toBe(true);
    expect(w.datafast?.q).toEqual([
      ["demo_edit", { surface: "demo" }],
      ["signup_email_submitted"],
    ]);
  });

  it("calls the loaded script directly", () => {
    const loaded = jest.fn();
    w.datafast = loaded;
    trackGoal("install_snippet_copied", { location: "dashboard_site" });
    expect(loaded).toHaveBeenCalledWith("install_snippet_copied", {
      location: "dashboard_site",
    });
  });

  it("never forwards a non-categorical value", () => {
    const loaded = jest.fn();
    w.datafast = loaded;
    trackGoal("tool_run", { tool: "https://evil.example/?e=a@b.c" });
    expect(loaded).toHaveBeenCalledWith("tool_run");
  });

  it("no-ops cleanly, leaving window untouched, when DataFast is disabled", () => {
    process.env.NEXT_PUBLIC_DATAFAST_DISABLED = "true";
    expect(trackGoal("login_email_submitted")).toBe(false);
    expect(w.datafast).toBeUndefined();
  });

  it("never throws into the caller", () => {
    w.datafast = () => {
      throw new Error("script bug");
    };
    expect(trackGoal("login_email_submitted")).toBe(false);
  });
});

describe("trackToolGoal", () => {
  afterEach(() => {
    delete w.datafast;
  });

  it("sends the dedicated goal for a known tool and tool_run otherwise", () => {
    const loaded = jest.fn();
    w.datafast = loaded;
    trackToolGoal("website-spell-checker");
    trackToolGoal("website-broken-links");
    expect(loaded).toHaveBeenNthCalledWith(1, "tool_typo_finder_run");
    expect(loaded).toHaveBeenNthCalledWith(2, "tool_run", {
      tool: "website-broken-links",
    });
  });
});
