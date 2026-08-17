import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SiteInstallationCard } from "../SiteInstallationCard";

jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(() => "5 hours ago"),
}));

/**
 * One card, four states, one fixed anatomy.
 *
 * This replaces two surfaces that answered the same question in different
 * words: the header status pill, and an "Integration Status" card whose
 * "Script Installation / API Connection" rows were both derived from the same
 * `content_elements` count. An owner reading two verdicts on one fact has to
 * work out which one to believe.
 */
describe("SiteInstallationCard", () => {
  const EMBED_SCRIPT =
    '<script src="https://example.test/embed/recopyfast.js" data-site-id="site-1"></script>';

  const site = (overrides: Record<string, unknown> = {}) => ({
    id: "site-1",
    domain: "example.com",
    status: "awaiting-install" as const,
    live_at: null,
    last_reported_at: null,
    last_mismatch_domain: null,
    embedScript: EMBED_SCRIPT,
    siteToken: "site-token-abc",
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  describe("awaiting install", () => {
    it("shows the state, the snippet and a copy control", () => {
      render(<SiteInstallationCard site={site()} />);

      expect(screen.getByText("Installation")).toBeInTheDocument();
      expect(screen.getByText("Awaiting install")).toBeInTheDocument();
      expect(screen.getByText(EMBED_SCRIPT)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /copy snippet/i }),
      ).toBeInTheDocument();
    });

    /** AC 5 — WordPress, Next.js and plain HTML, each with its own location. */
    it("offers an install location for each of the three stacks", () => {
      render(<SiteInstallationCard site={site()} />);

      for (const stack of ["WordPress", "Next.js", "Plain HTML"]) {
        expect(screen.getByRole("tab", { name: stack })).toBeInTheDocument();
      }

      expect(screen.getByText(/footer\.php/i)).toBeInTheDocument();
    });

    it("switches the instructions with the stack", async () => {
      render(<SiteInstallationCard site={site()} />);

      // Radix selects a tab on mousedown, not on the synthetic click event —
      // the same reason SiteCard's dropdown test drives a real pointer
      // sequence. userEvent is avoided here because it replaces
      // navigator.clipboard for the whole file, which the copy test below owns.
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Next.js" }));

      expect(await screen.findByText(/app\/layout\.tsx/i)).toBeInTheDocument();
    });

    it("confirms a copy in place, since there is nowhere else to put it", async () => {
      render(<SiteInstallationCard site={site()} />);

      fireEvent.click(screen.getByRole("button", { name: /copy snippet/i }));

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          EMBED_SCRIPT,
        );
      });
      expect(await screen.findByText("Copied")).toBeInTheDocument();
    });

    it("says the check is automatic, so nobody waits on us", () => {
      render(<SiteInstallationCard site={site()} />);

      expect(screen.getByText(/no refresh needed/i)).toBeInTheDocument();
    });
  });

  /**
   * AC 4 — a report from another domain is shown, and does not verify anything.
   * The commonest cause is the snippet pasted on staging, or on the apex when
   * the site is registered on www; without this the owner only sees a card that
   * never turns green.
   */
  describe("a report from an unregistered domain", () => {
    const mismatched = site({ last_mismatch_domain: "staging.example.net" });

    it("names both domains", () => {
      render(<SiteInstallationCard site={mismatched} />);

      expect(screen.getByText(/staging\.example\.net/)).toBeInTheDocument();
      expect(screen.getAllByText(/example\.com/).length).toBeGreaterThan(0);
    });

    it("stays in awaiting install, with the snippet still on screen", () => {
      render(<SiteInstallationCard site={mismatched} />);

      expect(screen.getByText("Awaiting install")).toBeInTheDocument();
      expect(screen.queryByText("Live")).not.toBeInTheDocument();
      expect(screen.getByText(EMBED_SCRIPT)).toBeInTheDocument();
    });
  });

  describe("live", () => {
    const liveSite = site({
      status: "live" as const,
      live_at: "2026-08-16T10:42:00Z",
      last_reported_at: "2026-08-16T11:42:00Z",
    });

    it("reports the detection without asking for anything", () => {
      render(<SiteInstallationCard site={liveSite} />);

      expect(screen.getByText("Live")).toBeInTheDocument();
      expect(screen.getByText(/editing is on/i)).toBeInTheDocument();
    });

    it("keeps the snippet available but out of the way", () => {
      render(<SiteInstallationCard site={liveSite} />);

      expect(screen.queryByText(EMBED_SCRIPT)).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: /view install snippet/i }),
      );

      expect(screen.getByText(EMBED_SCRIPT)).toBeInTheDocument();
    });
  });

  /**
   * AC 7 — `stale` is a nudge and never a blocker. Nothing in this card may
   * suggest that content has stopped serving or that editing is off, because
   * neither is true: staleness is computed from a timestamp and gates nothing.
   */
  describe("stale", () => {
    const staleSite = site({
      status: "stale" as const,
      live_at: "2026-01-01T00:00:00Z",
      last_reported_at: "2026-08-01T00:00:00Z",
    });

    it("says plainly that nothing is blocked", () => {
      render(<SiteInstallationCard site={staleSite} />);

      expect(screen.getByText("Stale")).toBeInTheDocument();
      expect(
        screen.getByText(/keeps working and stays editable/i),
      ).toBeInTheDocument();
    });

    it("disables no control anywhere on the card", () => {
      render(<SiteInstallationCard site={staleSite} />);

      for (const control of screen.getAllByRole("button")) {
        expect(control).toBeEnabled();
      }
    });

    it("still shows when the site was last heard from", () => {
      render(<SiteInstallationCard site={staleSite} />);

      expect(screen.getAllByText(/5 hours ago/).length).toBeGreaterThan(0);
    });
  });
});
