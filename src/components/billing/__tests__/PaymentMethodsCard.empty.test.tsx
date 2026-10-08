import React from "react";
import { render, screen } from "@testing-library/react";
import { PaymentMethodsCard } from "../PaymentMethodsCard";

/**
 * s71: the empty payment-methods state, for the account it is shown to.
 *
 * A lifetime owner — whose plan card says "Lifetime access" — was told to "Add
 * a card to start a subscription": there is nothing left for them to subscribe
 * to. A card is only for AI credits once the plan is held for life.
 */

describe("the empty payment-methods state", () => {
  it("tells an account whose plan is held for life a card is for AI credits", () => {
    render(
      <PaymentMethodsCard
        paymentMethods={[]}
        isPlanHeldForLife
        onUpdate={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Add a card to buy AI credits"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/start a subscription/i)).toBeNull();
  });

  it("keeps the subscription copy for every other account", () => {
    render(<PaymentMethodsCard paymentMethods={[]} onUpdate={jest.fn()} />);

    expect(
      screen.getByText("Add a card to start a subscription or buy AI credits"),
    ).toBeInTheDocument();
  });
});
