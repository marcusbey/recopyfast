import { render, screen } from "@testing-library/react";
import WordPressGuidePage, {
  metadata,
} from "@/app/docs/install/wordpress/page";

jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => <footer>Footer</footer>,
}));

describe("WordPress install guide page", () => {
  it("is its own canonical page", () => {
    expect(metadata.alternates?.canonical).toBe("/docs/install/wordpress");
    expect(metadata.openGraph).toMatchObject({
      url: "/docs/install/wordpress",
    });
  });

  it("walks through WPCode with its own labels", () => {
    render(<WordPressGuidePage />);
    const text = document.body.textContent ?? "";

    expect(
      screen.getByRole("heading", { level: 1, name: /WPCode/ }),
    ).toBeInTheDocument();
    for (const label of [
      "Code Snippets > Header & Footer",
      "Save Changes",
      "HTML Snippet",
      "Site Wide Footer",
      "Save Snippet",
    ]) {
      expect(text).toContain(label);
    }
  });

  it("covers verification, caching, page builders and what not to do", () => {
    render(<WordPressGuidePage />);

    for (const name of [
      "4. Check it works",
      "5. Clear your cache",
      "Elementor, Divi and other page builders",
      "What not to do",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
    const text = document.body.textContent ?? "";
    expect(text).toContain("WP Rocket, LiteSpeed Cache, W3 Total Cache");
    expect(text).toContain("Don't paste it into your theme files");
  });

  it("tags its signup CTA and links the developer guide", () => {
    render(<WordPressGuidePage />);

    expect(screen.getByRole("link", { name: "Start free" })).toHaveAttribute(
      "data-fast-goal-location",
      "wp_guide",
    );
    expect(
      screen.getByRole("link", { name: "developer guide" }),
    ).toHaveAttribute("href", "/docs/install/for-developers");
  });
});
