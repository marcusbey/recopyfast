import { render, screen } from "@testing-library/react";
import Footer from "../Footer";

describe("Footer", () => {
  it("links the public installation guide", () => {
    render(<Footer />);

    expect(
      screen.getByRole("link", { name: "Installation guide" }),
    ).toHaveAttribute("href", "/docs/install");
  });
});
