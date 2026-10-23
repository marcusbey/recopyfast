import { render, screen } from "@testing-library/react";
import DeveloperGuidePage, {
  metadata,
} from "@/app/docs/install/for-developers/page";
import { DEVELOPER_GUIDE_CSP_LINES } from "@/lib/docs/developer-guide-content";
import { INSTALLATION_EXAMPLE } from "@/lib/docs/installation-content";

jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => <footer>Footer</footer>,
}));

describe("developer guide page", () => {
  it("is its own canonical page", () => {
    expect(metadata.alternates?.canonical).toBe("/docs/install/for-developers");
    expect(metadata.openGraph).toMatchObject({
      url: "/docs/install/for-developers",
    });
  });

  it("renders one h1 and the sections a developer needs, at h2", () => {
    render(<DeveloperGuidePage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const name of [
      "What the script does",
      "The snippet",
      "Where to paste it",
      "Content Security Policy",
      "Verify the install",
      "How editing works for your client",
      "When you deploy",
      "Remove it",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });

  it("shows the generated placeholder snippet and CSP derived from it", () => {
    render(<DeveloperGuidePage />);

    expect(screen.getByTestId("developer-guide-example").textContent).toBe(
      INSTALLATION_EXAMPLE.displaySnippet,
    );
    expect(screen.getByTestId("developer-guide-csp").textContent).toBe(
      DEVELOPER_GUIDE_CSP_LINES.join("\n"),
    );
    expect(DEVELOPER_GUIDE_CSP_LINES).toEqual([
      `script-src ${INSTALLATION_EXAMPLE.appUrl}`,
      `connect-src ${INSTALLATION_EXAMPLE.appUrl} ${INSTALLATION_EXAMPLE.wsUrl}`,
    ]);
    expect(document.body.textContent).not.toMatch(/'unsafe-inline' to/);
  });

  it("is truthful about deploys and links the WordPress guide", () => {
    render(<DeveloperGuidePage />);

    expect(document.body.textContent).toContain(
      "There is no warning for this yet.",
    );
    expect(
      screen.getByRole("link", { name: "WordPress guide" }),
    ).toHaveAttribute("href", "/docs/install/wordpress");
    expect(
      screen.getByRole("link", { name: "Start your free trial" }),
    ).toHaveAttribute("data-fast-goal-location", "dev_guide");
  });
});
