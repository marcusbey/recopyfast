/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditableImage from "../EditableImage";

// This repo's convention (see `InteractiveHero.test.tsx`): framer-motion is
// swapped for plain elements, so the dialog leaves the DOM as soon as it
// closes instead of after an exit animation jsdom never runs.
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => (
      <div {...props}>{children}</div>
    ),
    // createElement, not JSX: the stub forwards the real alt, which the
    // img-element lint rules cannot see through a spread.
    img: (props: React.ComponentProps<"img">) =>
      React.createElement("img", props),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

afterEach(cleanup);

const POOL = ["/photos/pasta.jpg", "/photos/terrace.jpg", "/photos/chef.jpg"];

function renderImage(onReplace = jest.fn()) {
  render(
    <EditableImage
      src={POOL[0]}
      pool={POOL}
      alt="Fresh pasta"
      className=""
      onReplace={onReplace}
    />,
  );
  return onReplace;
}

/**
 * s50 — the homepage demo offered "Generate with AI" behind a sign-in. No
 * image-generation feature exists anywhere in the product: its own image
 * modal takes a URL or an upload. The demo may only show what the product
 * does, so it replaces a photo and nothing more.
 */
describe("EditableImage", () => {
  it("offers replacement only, with no AI image generation", async () => {
    const user = userEvent.setup();
    renderImage();

    await user.click(screen.getByRole("button", { name: /replace image/i }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /use the next photo/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/generate with ai/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/describe the image you want/i),
    ).not.toBeInTheDocument();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("swaps to the next photo in the pool", async () => {
    const user = userEvent.setup();
    const onReplace = renderImage();

    await user.click(screen.getByRole("button", { name: /replace image/i }));
    await user.click(
      screen.getByRole("button", { name: /use the next photo/i }),
    );

    expect(onReplace).toHaveBeenCalledWith(POOL[1]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
