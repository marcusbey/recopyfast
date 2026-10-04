import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "../page";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", user_metadata: {} } }),
}));
jest.mock("@/components/dashboard/TrialStatusBadge", () => ({
  TrialStatusBadge: () => null,
}));
jest.mock("@/components/dashboard/SiteRegistrationModal", () => ({
  SiteRegistrationModal: () => null,
}));
jest.mock("@/components/dashboard/ActivationChecklist", () => ({
  ActivationChecklist: ({
    siteId,
    userId,
    installation,
  }: {
    siteId: string;
    userId: string;
    installation: { headBootstrap: string; runtimeTag: string };
  }) => (
    <div
      data-testid="activation-checklist"
      data-site-id={siteId}
      data-user-id={userId}
      data-head-bootstrap={installation.headBootstrap}
      data-runtime-tag={installation.runtimeTag}
    />
  ),
}));

const sites = Array.from({ length: 7 }, (_, index) => ({
  id: `site-${index + 1}`,
  name: `Site ${index + 1}`,
  domain: `site-${index + 1}.example.com`,
  created_at: new Date(2026, 0, index + 1).toISOString(),
  updated_at: new Date(2026, 0, index + 1).toISOString(),
  status: "awaiting-install",
  ...(index < 6
    ? {
        siteToken: `token-${index + 1}`,
        embedScript: `<script data-site-id="site-${index + 1}"></script>`,
        installation: {
          protocolVersion: "2",
          headBootstrap: `<script data-head="site-${index + 1}"></script>`,
          runtimeTag: `<script data-runtime="site-${index + 1}"></script>`,
          csp: {
            scriptHash: "sha256-script",
            styleHash: "sha256-style",
            scriptSource: "https://www.recopyfa.st",
            connectSources: ["https://www.recopyfa.st"],
          },
        },
      }
    : {}),
}));

describe("dashboard activation integration", () => {
  it("renders a checklist for every admin site beyond the five recent rows", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      return {
        ok: true,
        json: async () =>
          url === "/api/sites" ? { sites } : { currentUsage: { aiUsage: 0 } },
      } as Response;
    }) as typeof fetch;

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getAllByTestId("activation-checklist")).toHaveLength(6),
    );
    expect(screen.getAllByTestId("activation-checklist")[5]).toHaveAttribute(
      "data-site-id",
      "site-6",
    );
    expect(
      screen
        .getAllByTestId("activation-checklist")
        .map((checklist) => checklist.getAttribute("data-site-id")),
    ).not.toContain("site-7");
    expect(screen.getAllByTestId("activation-checklist")[0]).toHaveAttribute(
      "data-user-id",
      "user-1",
    );
    expect(screen.getAllByTestId("activation-checklist")[0]).toHaveAttribute(
      "data-head-bootstrap",
      '<script data-head="site-1"></script>',
    );
  });
});
