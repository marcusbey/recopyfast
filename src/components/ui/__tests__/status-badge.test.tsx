import { render, screen } from "@testing-library/react";
import {
  StatusBadge,
  resolveSiteStatus,
  siteStatuses,
} from "@/components/ui/status-badge";

/**
 * The site status vocabulary, pinned where it is defined.
 *
 * `siteStatuses` is the single registry every site pill in the dashboard reads
 * — SiteCard, the overview, the sites list and the installation card all render
 * whatever this file says. Until now nothing tested it directly: the three
 * existing `ui/__tests__` files cover Badge, Button and Card, and the labels
 * were only asserted second-hand through component tests that happened to
 * render a site.
 *
 * The old vocabulary was `active` / `inactive` / `verifying`, and it described a
 * process that did not exist ("Verifying" named a check nothing in the product
 * performs). `awaiting-install` / `live` / `stale` name what is actually true:
 * we have never heard from this site's script, we have, or we have not heard
 * recently. See docs/decisions/006-site-status-persisted-state-machine.md.
 */
describe("site status registry", () => {
  it.each([
    ["awaiting-install", "Awaiting install", "tone-neutral"],
    ["live", "Live", "tone-success"],
    ["stale", "Stale", "tone-warning"],
  ])("renders %s as %s", (status, label, toneClass) => {
    render(<StatusBadge status={resolveSiteStatus(status)} />);

    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain(`bg-${toneClass}-surface`);
  });

  /**
   * `stale` is a nudge, never a verdict. AC 7 says it must not block content
   * delivery or editing, and a red pill is how a non-blocking state starts
   * being read as a broken one.
   */
  it("never paints any site state in the danger tone", () => {
    for (const definition of Object.values(siteStatuses)) {
      expect(definition.tone).not.toBe("danger");
    }
  });

  it("describes each state in words an owner can act on", () => {
    expect(siteStatuses["awaiting-install"].description).toMatch(/snippet/i);
    expect(siteStatuses.live.description).toMatch(/reported/i);
    expect(siteStatuses.stale.description).toMatch(/nothing is blocked/i);
  });

  /**
   * A site the API said nothing about used to be drawn as "Inactive", and
   * before that as healthy — the one direction a default must never guess in.
   * The fallback is now the state that claims nothing: we have not heard from
   * this script. `stale` is not a safe fallback either, because it asserts the
   * site was verified once.
   */
  it.each([
    ["an unknown status string", "verifying"],
    ["no status at all", undefined],
  ])("falls back to awaiting-install for %s", (_label, status) => {
    render(<StatusBadge status={resolveSiteStatus(status)} />);

    expect(screen.getByText("Awaiting install")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });
});
