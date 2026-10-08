import { within } from "@testing-library/react";

/**
 * A confirm dialog with nothing to say between its header and its footer must
 * not draw an empty band there (s66a review m4: about 36 px of body padding
 * under the description).
 *
 * Every dialog keeps its `DialogBody` (design system, Dialogs and sheets:
 * the anatomy is header, body, optional footer), so the band is closed in two
 * halves: the call site renders no node into the body when there is nothing
 * to show, and the primitive hides an empty body (`empty:hidden`).
 *
 * The body is found as the footer's previous sibling, the footer as the
 * parent of the dialog's Cancel button.
 */
export function expectNoEmptyBodyBand(dialog: HTMLElement): void {
  const cancel = within(dialog).getByRole("button", { name: /^cancel$/i });
  const body = cancel.parentElement?.previousElementSibling ?? null;
  expect(body).not.toBeNull();
  expect(body).toBeEmptyDOMElement();
  expect(body).toHaveClass("empty:hidden");
}
