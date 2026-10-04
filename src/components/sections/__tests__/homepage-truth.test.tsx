import React from "react";
import { render, screen } from "@testing-library/react";
import Footer from "@/components/layout/Footer";
import {
  buildStableEmbedInstallation,
  canonicalizePublicAppUrl,
} from "@/lib/sites/embed-script";
import Benefits from "../Benefits";
import FinalCTA from "../FinalCTA";
import HowItWorks from "../HowItWorks";
import Pricing from "../Pricing";
import ValueProposition from "../ValueProposition";

/**
 * s50 — every claim on the homepage is one the product backs.
 *
 * The launch-kit fact check of 2026-09-28 found a money-back guarantee with no
 * refund clause behind it, two headline features with no customer surface,
 * graveyard features, a dead contact domain and a status line nothing checked.
 * Each section below asserts that its new copy is present and the retired copy
 * absent, so a revert cannot pass by rendering nothing.
 *
 * Kept in its own file on purpose: s47b rewrites the trust rows that
 * trial-claims.test.tsx pins, and these assertions must not sit in its hunks.
 */

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ plans: [], oneTimeProducts: [] }),
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Pricing", () => {
  it("makes no money-back promise", async () => {
    render(<Pricing offer={{ status: "closed" }} />);

    // The trust row rendered, so the absence below is not vacuous.
    expect(await screen.findByText(/cancel anytime/i)).toBeInTheDocument();
    expect(screen.queryByText(/money-back/i)).not.toBeInTheDocument();
  });
});

describe("Benefits", () => {
  it("leads with inviting editors and AI rewrite, not translation or A/B tests", () => {
    render(<Benefits />);

    expect(screen.getByText("Invite")).toBeInTheDocument();
    expect(
      screen.getByText("Hand a client the words, not the site"),
    ).toBeInTheDocument();
    expect(screen.getByText("Rewrite")).toBeInTheDocument();
    expect(screen.getByText("AI rewrites, in place")).toBeInTheDocument();

    // Who publishes is chosen per editor, and the dashboard's own "Invite a
    // client" dialog pre-selects Publish (ActivationChecklist), so the card may
    // not promise that an invited editor's edits wait as drafts.
    expect(
      screen.getByText(/You choose, per editor, who can publish\.$/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Publish stays off unless you grant it/),
    ).not.toBeInTheDocument();

    expect(screen.queryByText("Translate")).not.toBeInTheDocument();
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Every string on the site, in another language"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Find out which words actually win"),
    ).not.toBeInTheDocument();
  });

  it("lists only shipped capabilities", () => {
    const { container } = render(<Benefits />);

    for (const title of [
      "Click. Edit. Done.",
      "Swap images too",
      "Draft, then publish",
      "Two small script placements",
      "Save and restore",
      "Secure by default",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    const text = (container.textContent ?? "").toLowerCase();
    for (const retired of [
      "Role-based permissions",
      "audit log",
      "Works everywhere",
      "Full version history",
      "Roll back at any point",
      "Your whole team",
      "Knowing which words to use",
      "ReCopyFast does both",
    ]) {
      expect(text).not.toContain(retired.toLowerCase());
    }
  });

  it("keeps the #features anchor", () => {
    const { container } = render(<Benefits />);

    expect(container.querySelector("section#features")).not.toBeNull();
  });
});

describe("ValueProposition", () => {
  it("does not list A/B tests among the jobs it takes off developers", () => {
    const { container } = render(<ValueProposition />);

    expect(
      screen.getByText(
        "Every typo fix, every price change, every campaign update requires a developer ticket and days of waiting.",
      ),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("A/B");
  });
});

describe("HowItWorks", () => {
  it("shows both placements the dashboard issues for production", () => {
    const { container } = render(<HowItWorks />);

    const templates = Array.from(container.querySelectorAll("pre")).map(
      (node) => node.textContent ?? "",
    );
    const installation = buildStableEmbedInstallation({
      siteId: "YOUR_SITE_ID",
      siteToken: "YOUR_SITE_TOKEN",
      appUrl: canonicalizePublicAppUrl("https://recopyfa.st"),
      wsUrl: "",
    });

    expect(templates[0]).toContain(
      `data-rcf-startup="${installation.protocolVersion}"`,
    );
    expect(templates[0]).toContain('data-site-id="YOUR_SITE_ID"');
    expect(templates[0]).toContain('data-site-token="YOUR_SITE_TOKEN"');
    expect(templates[0]).toContain("Generated by the ReCopyFast dashboard");
    expect(templates).toContain(installation.runtimeTag);
    expect(
      screen.getAllByText(/native head bootstrap/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/after hydration/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/beforeInteractive/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /copy the template/i }),
    ).not.toBeInTheDocument();
  });

  it("makes no five-minute claim", () => {
    const { container } = render(<HowItWorks />);

    expect(screen.getByText("A few minutes.")).toBeInTheDocument();
    expect(screen.getByText("Set up in minutes")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/five minutes|5 minutes/i);
  });
});

describe("FinalCTA", () => {
  it("makes no five-minute claim", () => {
    const { container } = render(<FinalCTA offer={{ status: "closed" }} />);

    expect(screen.getByText("Set up in minutes")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/5 minutes/);
  });
});

describe("Footer", () => {
  it("describes the product without 'any website' or a CMS claim", () => {
    const { container } = render(<Footer />);

    expect(
      screen.getByText(
        "Make the copy on the site you already built editable with two small script placements. No backend changes, no migration.",
      ),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("Transform any website");
    expect(container.textContent).not.toContain("content management platform");
  });

  it("sends email to support@recopyfa.st", () => {
    render(<Footer />);

    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:support@recopyfa.st",
    );
  });

  it("shows no status, version or docs claim", () => {
    const { container } = render(<Footer />);

    for (const retired of [
      "All systems operational",
      "v1.0.0",
      "Comprehensive docs",
      "Secure & lightweight",
    ]) {
      expect(container.textContent).not.toContain(retired);
    }
    expect(screen.getByText("Secure by default")).toBeInTheDocument();
    // The footer still renders its real links, so the absences are not vacuous.
    for (const link of [
      "Privacy Policy",
      "Terms of Service",
      "Compare tools",
      "GitHub",
    ]) {
      expect(screen.getByText(link)).toBeInTheDocument();
    }
  });
});
