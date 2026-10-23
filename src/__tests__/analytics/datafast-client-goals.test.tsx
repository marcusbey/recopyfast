/**
 * DataFast client goals at their firing points (ADR 074): the magic-link
 * forms, the copy buttons and the /try sample. Each fires on success only and
 * never carries the email, a name, a URL or a token.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockTrackGoal = jest.fn();
jest.mock("@/lib/analytics/datafast-client", () => ({
  trackGoal: (...args: unknown[]) => mockTrackGoal(...args),
}));
jest.mock("@/lib/analytics/google-analytics/gtag", () => ({
  track: jest.fn(),
}));
const signInWithMagicLink = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signInWithMagicLink }),
}));
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/login",
}));

import { SignupForm } from "@/components/auth/SignupForm";
import { LoginForm } from "@/components/auth/LoginForm";
import { CodeBlock } from "@/components/ui/code-block";
import { AgentInstructionsCopy } from "@/components/docs/AgentInstructionsCopy";
import { TryExperience } from "@/components/try/TryExperience";

function mockClipboard(writeText: jest.Mock) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  signInWithMagicLink.mockResolvedValue(undefined);
});

describe("magic-link forms", () => {
  it("signup sends signup_email_submitted with no params once the link is sent", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);
    await user.type(screen.getByLabelText(/name/i), "Jane Doe");
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));
    await screen.findByText(/check your email/i);

    expect(mockTrackGoal).toHaveBeenCalledTimes(1);
    expect(mockTrackGoal.mock.calls[0]).toEqual(["signup_email_submitted"]);
  });

  it("signup sends nothing when the request fails", async () => {
    const user = userEvent.setup();
    signInWithMagicLink.mockRejectedValueOnce(new Error("smtp"));
    render(<SignupForm />);
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));
    await screen.findByRole("alert");
    expect(mockTrackGoal).not.toHaveBeenCalled();
  });

  it("login sends login_email_submitted with no params", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText(/email/i), "me@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));
    await screen.findByText(/check your email/i);
    expect(mockTrackGoal.mock.calls).toEqual([["login_email_submitted"]]);
  });
});

describe("copy buttons", () => {
  it("CodeBlock calls onCopied only after a real copy", async () => {
    const onCopied = jest.fn();
    mockClipboard(jest.fn().mockResolvedValue(undefined));
    const { unmount } = render(
      <CodeBlock value="<script></script>" onCopied={onCopied} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    });
    expect(onCopied).toHaveBeenCalledTimes(1);
    unmount();

    mockClipboard(jest.fn().mockRejectedValue(new Error("NotAllowedError")));
    render(<CodeBlock value="<script></script>" onCopied={onCopied} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    });
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  it("a throwing onCopied never turns a copy into 'Copy failed'", async () => {
    mockClipboard(jest.fn().mockResolvedValue(undefined));
    render(
      <CodeBlock
        value="x"
        onCopied={() => {
          throw new Error("analytics bug");
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    });
    expect(screen.getByRole("button", { name: "Copy code" })).toHaveTextContent(
      /^Copied$/,
    );
  });

  it("/docs/install agent brief copy sends install_snippet_copied", async () => {
    mockClipboard(jest.fn().mockResolvedValue(undefined));
    render(<AgentInstructionsCopy instructions="# brief" />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /copy agent instructions/i }),
      );
    });
    expect(mockTrackGoal).toHaveBeenCalledWith("install_snippet_copied", {
      location: "docs_agent_instructions",
    });
  });
});

describe("/try sample", () => {
  type PreviewWindow = Window & {
    __rcfTryPreview?: { exit: () => void; resume: () => void };
  };

  async function activate() {
    const user = userEvent.setup();
    render(<TryExperience />);
    await user.click(screen.getByRole("button", { name: "Edit this sample" }));
    (window as PreviewWindow).__rcfTryPreview = {
      exit: jest.fn(),
      resume: jest.fn(),
    };
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="/try/rcf-try.js"]',
    );
    act(() => {
      script?.onload?.(new Event("load"));
    });
  }

  afterEach(() => {
    delete (window as PreviewWindow).__rcfTryPreview;
  });

  it("sends demo_edit once, on the first text change inside the sample", async () => {
    await activate();
    const root = document.getElementById("rcf-try-sample")!;
    const text = Array.from(root.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.childNodes))
      .find(
        (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim(),
      ) as Text;

    // Activation toggles attributes only; that is not an edit.
    root.setAttribute("data-rcf-try-editing", "");
    await act(async () => {});
    expect(mockTrackGoal).not.toHaveBeenCalled();

    await act(async () => {
      text.nodeValue = "Edited by the visitor";
    });
    await act(async () => {
      text.nodeValue = "Edited again";
    });
    expect(mockTrackGoal.mock.calls).toEqual([
      ["demo_edit", { surface: "try" }],
    ]);
  });
});
