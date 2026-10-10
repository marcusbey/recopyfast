import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeysPanel } from "../ApiKeysPanel";

/**
 * s66c2 AC 5 — API keys get a per-site home in the site's advanced
 * Settings. Keys are issued per site (`/api/api-keys?siteId=`), so on a site's
 * own page the panel takes that site and has nothing to choose. The account
 * Settings › API Keys tab keeps today's site selector, unchanged (s66b
 * decides its fate).
 */

const SITES = [
  { id: "site-a", name: "Site A", domain: "a.example" },
  { id: "site-b", name: "Site B", domain: "b.example" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = jest.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/sites") return jsonResponse({ sites: SITES });
    if (url === "/api/api-keys" && init?.method === "POST") {
      return jsonResponse({ apiKey: { key: "rcf_fixture_secret" } }, 201);
    }
    const siteId = new URL(url, "http://localhost").searchParams.get("siteId");
    if (url.startsWith("/api/api-keys?siteId=") && siteId) {
      return jsonResponse({
        apiKeys: [
          {
            id: `key-${siteId}`,
            name: `Key for ${siteId}`,
            key_prefix: "rcf_fixture",
            is_active: true,
            created_at: "2026-10-01T00:00:00Z",
            last_used_at: null,
            rate_limit_per_minute: 60,
          },
        ],
      });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  },
);

const calledUrls = () => fetchMock.mock.calls.map(([input]) => String(input));

describe("ApiKeysPanel", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("with a siteId (a site's Settings)", () => {
    it("lists that site's keys, with no site select and no site list request", async () => {
      render(<ApiKeysPanel siteId="site-b" />);

      expect(await screen.findByText("Key for site-b")).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Site")).not.toBeInTheDocument();
      expect(calledUrls()).toEqual(["/api/api-keys?siteId=site-b"]);
    });

    it("generates a key for that site", async () => {
      const user = userEvent.setup();
      render(<ApiKeysPanel siteId="site-b" />);
      await screen.findByText("Key for site-b");

      await user.type(screen.getByLabelText("New key name"), "Production");
      await user.click(screen.getByRole("button", { name: /generate key/i }));

      expect(await screen.findByText("rcf_fixture_secret")).toBeInTheDocument();
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "POST",
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        siteId: "site-b",
        name: "Production",
      });
    });
  });

  // Today's behaviour, unchanged: the account tab chooses the site.
  describe("without a siteId (account Settings)", () => {
    it("keeps the site selector and lists the selected site's keys", async () => {
      const user = userEvent.setup();
      render(<ApiKeysPanel />);

      const select = await screen.findByRole("combobox", { name: "Site" });
      expect(
        within(select)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["Site A", "Site B"]);
      expect(await screen.findByText("Key for site-a")).toBeInTheDocument();
      expect(calledUrls()).toContain("/api/sites");

      await user.selectOptions(select, "site-b");

      expect(await screen.findByText("Key for site-b")).toBeInTheDocument();
      await waitFor(() =>
        expect(calledUrls()).toContain("/api/api-keys?siteId=site-b"),
      );
    });
  });
});
