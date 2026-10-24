import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import {
  OWNER_FIX_BODY,
  OWNER_GENERAL_BODY,
  ownerCtaCopyFor,
} from "@/lib/tools/cta-copy";
import { OwnerNextStep } from "../OwnerNextStep";

describe("OwnerNextStep (s121)", () => {
  it("with issues: 'fix these yourself', /try first, then /for/owners, with owner_path UTMs", () => {
    render(
      <OwnerNextStep
        slug="outdated-website-checker"
        hasIssues
        emphasis="primary"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Fix these yourself in a minute" }),
    ).toBeInTheDocument();
    expect(screen.getByText(OWNER_FIX_BODY)).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/try?utm_source=tools&utm_medium=free_tool&utm_campaign=owner_path&utm_content=outdated-website-checker#install",
      "/for/owners?utm_source=tools&utm_medium=free_tool&utm_campaign=owner_path&utm_content=outdated-website-checker",
    ]);
    expect(
      links.map((link) => [
        link.getAttribute("data-fast-goal"),
        link.getAttribute("data-fast-goal-location"),
        link.getAttribute("data-fast-goal-target"),
      ]),
    ).toEqual([
      ["cta_click", "outdated_checker_result", "try"],
      ["cta_click", "outdated_checker_result", "owners"],
    ]);
  });

  it("without issues: the general owner pitch", () => {
    render(
      <OwnerNextStep
        slug="website-spell-checker"
        hasIssues={false}
        emphasis="secondary"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Change your own website text" }),
    ).toBeInTheDocument();
    expect(screen.getByText(OWNER_GENERAL_BODY)).toBeInTheDocument();
  });

  it("puts no goal on the links of a tool without a result location", () => {
    render(
      <OwnerNextStep slug="unknown-tool" hasIssues emphasis="secondary" />,
    );

    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("data-fast-goal");
    }
  });

  it("stays truthful about the preview and the one-time install", () => {
    for (const hasIssues of [true, false]) {
      const { body } = ownerCtaCopyFor("website-spell-checker", hasIssues);
      expect(body.toLowerCase()).toMatch(/your developer/);
      expect(body.toLowerCase()).toMatch(/once/);
      for (const claim of ["seo", "meta tag", "no install", "free forever"]) {
        expect(body.toLowerCase()).not.toContain(claim);
      }
    }
    expect(OWNER_FIX_BODY).toMatch(/on desktop/);
  });

  it("draws every link as a native <a>", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/tools/OwnerNextStep.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/from "next\/link"/);
  });
});
