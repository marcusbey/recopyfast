import { render, screen } from "@testing-library/react";
import InstallGuidePage from "@/app/docs/install/page";
import {
  AGENT_INSTALLATION_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_DOWNLOAD_PATH,
  INSTALLATION_EXAMPLE,
  INSTALLATION_GUIDE,
} from "@/lib/docs/installation-content";

jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => <footer>Footer</footer>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("@/components/docs/AgentInstructionsCopy", () => ({
  AgentInstructionsCopy: ({ instructions }: { instructions: string }) => (
    <button type="button" data-instructions={instructions}>
      Copy agent instructions
    </button>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("installation guide page", () => {
  it("renders the approved guide and generated placeholder snippet", () => {
    render(<InstallGuidePage />);

    expect(
      screen.getByRole("heading", { name: INSTALLATION_GUIDE.title, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("installation-example").textContent).toBe(
      INSTALLATION_EXAMPLE.displaySnippet,
    );
    expect(
      screen.getByRole("heading", {
        name: "React, Next.js and other single-page applications",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Protect editor links from analytics",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Troubleshooting" }),
    ).toBeInTheDocument();
  });

  it("exposes keyboard-native section links and the Sites destination", () => {
    render(<InstallGuidePage />);

    expect(screen.getByRole("link", { name: "Sites" })).toHaveAttribute(
      "href",
      "/dashboard/sites",
    );
    expect(
      screen.getAllByRole("link", { name: "Verify the installation" })[0],
    ).toHaveAttribute("href", "#verify");
    expect(
      screen.getAllByRole("link", { name: "Troubleshooting" })[0],
    ).toHaveAttribute("href", "#troubleshooting");
  });

  it("keeps major sections at h2 and their subsections at h3", () => {
    render(<InstallGuidePage />);

    expect(
      screen.getByRole("heading", {
        name: INSTALLATION_GUIDE.copySnippet.title,
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "What the generated snippet looks like",
        level: 3,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "React, Next.js and other single-page applications",
        level: 3,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Protect editor links from analytics",
        level: 3,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Rendering at first paint",
        level: 3,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Agent installation brief",
        level: 2,
      }),
    ).toBeInTheDocument();
  });

  it("uses the canonical brief for copy and Markdown download", () => {
    render(<InstallGuidePage />);

    const copyButton = screen.getByRole("button", {
      name: "Copy agent instructions",
    });
    expect(copyButton).toHaveAttribute(
      "data-instructions",
      AGENT_INSTALLATION_INSTRUCTIONS,
    );

    const download = screen.getByRole("link", {
      name: "Download Markdown",
    });
    expect(download).toHaveAttribute("href", AGENT_INSTRUCTIONS_DOWNLOAD_PATH);
    expect(download).toHaveAttribute("download");

    const brief = screen.getByTestId("agent-installation-brief");
    expect(brief.textContent).toBe(AGENT_INSTALLATION_INSTRUCTIONS);
  });
});
