import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentInstructionsCopy } from "@/components/docs/AgentInstructionsCopy";

const INSTRUCTIONS = "# Install ReCopyFast\n\nUse the supplied snippet.";

describe("AgentInstructionsCopy", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it("confirms only after the browser accepts the clipboard write", async () => {
    render(<AgentInstructionsCopy instructions={INSTRUCTIONS} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy agent instructions" }),
    );

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(INSTRUCTIONS);
    });
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Agent instructions fallback"),
    ).not.toBeInTheDocument();
  });

  it("shows selectable instructions and an honest error when copying is denied", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("permission denied")),
      },
    });

    render(<AgentInstructionsCopy instructions={INSTRUCTIONS} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy agent instructions" }),
    );

    expect(
      await screen.findByText(
        "Copy failed. Select and copy the instructions below.",
      ),
    ).toBeInTheDocument();
    const fallback = screen.getByLabelText("Agent instructions fallback");
    expect(fallback).toHaveValue(INSTRUCTIONS);
    expect(fallback).toHaveFocus();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("uses the same fallback when the Clipboard API is unavailable", async () => {
    Object.assign(navigator, { clipboard: undefined });

    render(<AgentInstructionsCopy instructions={INSTRUCTIONS} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy agent instructions" }),
    );

    expect(
      await screen.findByLabelText("Agent instructions fallback"),
    ).toHaveValue(INSTRUCTIONS);
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
