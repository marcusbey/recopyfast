/**
 * s04 AC2 — `/dashboard/teams` redirects, it does not 404 and it does not
 * render a team console.
 *
 * Removing the nav entry was never enough. Nothing gated this URL: the page was
 * 538 lines of working team management (list teams, invite by email with a
 * role, remove members) reachable by anyone who typed the address or followed
 * an old bookmark, and `src/middleware.ts` singles out nothing about it. So the
 * page itself has to go, and it has to go somewhere real — a bare deletion
 * turns every existing link into a 404, which reads as a broken product rather
 * than as a retired feature.
 *
 * The destination carries `?notice=teams-moved` so `/dashboard/sites` can say
 * why the user landed there. A silent redirect is the other failure mode: the
 * user asked for teams and got a list of sites with no explanation.
 */

jest.mock("next/navigation", () => ({
  // The real `redirect` throws a NEXT_REDIRECT control-flow error rather than
  // returning, which is why the page needs no return value. A mock that merely
  // recorded the call would let a page that redirects *and then* renders team
  // UI pass this suite.
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { redirect } from "next/navigation";
import TeamsPage from "../page";

const TARGET = "/dashboard/sites?notice=teams-moved";

describe("/dashboard/teams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it("is still a routable page rather than a deleted one", () => {
    // GUARD. Every assertion below describes what the page does *not* do; if
    // the route stopped existing they would all be vacuous, and a 404 is the
    // exact outcome AC2 rules out.
    expect(typeof TeamsPage).toBe("function");
  });

  it("redirects to the site sharing surface", () => {
    expect(() => TeamsPage()).toThrow(`NEXT_REDIRECT:${TARGET}`);
    expect(redirect).toHaveBeenCalledWith(TARGET);
  });

  it("explains the move rather than dropping the user on a bare site list", () => {
    expect(() => TeamsPage()).toThrow();

    // `redirect` is typed as returning `never`, which does not overlap with
    // jest.Mock — the double assertion is the mock, not a claim about Next.
    const [destination] = (redirect as unknown as jest.Mock).mock.calls[0] as [
      string,
    ];
    expect(
      new URL(destination, "https://recopyfast.com").searchParams.get("notice"),
    ).toBe("teams-moved");
  });

  it("never calls the frozen teams API", () => {
    // `/api/teams/*` stays deployed and stays answering — the PRD freezes the
    // feature, it does not delete the routes. What must stop is this surface
    // driving traffic to them.
    expect(() => TeamsPage()).toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
