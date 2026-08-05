/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DomainVerification } from "../DomainVerification";
import { fileDeclaresCode } from "@/lib/security/domain-challenge";
import "@testing-library/jest-dom";

const IN_A_DAY = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

interface VerificationFixture {
  id: string;
  siteId: string;
  domain: string;
  verificationMethod: "dns" | "file";
  verificationCode: string;
  isVerified: boolean;
  verifiedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

const aVerification = (
  overrides: Partial<VerificationFixture> = {},
): VerificationFixture => ({
  id: "verification-1",
  siteId: "site-1",
  domain: "example.com",
  verificationMethod: "dns",
  verificationCode: "abc123",
  isVerified: false,
  verifiedAt: null,
  expiresAt: IN_A_DAY,
  createdAt: YESTERDAY,
  ...overrides,
});

const mockList = (
  verifications: VerificationFixture[],
  canManage = true,
): void => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ verifications, canManage }),
  });
};

describe("DomainVerification", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("does not claim domain verification is what secures the embed", async () => {
    mockList([]);
    render(<DomainVerification siteId="site-1" siteDomain="example.com" />);

    expect(await screen.findByText("Domain ownership")).toBeInTheDocument();

    // `authorizeSiteRequest` admits the widget on a signed site token plus an
    // origin match against `sites.domain`; it never reads
    // `domain_verifications`. The old copy — "Verify domain ownership to enable
    // secure embeds" — sent owners hunting for a blocker that does not exist.
    expect(
      screen.getByText(/Your embed script does not wait on this/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/to enable secure embeds/i),
    ).not.toBeInTheDocument();
  });

  it("prefills the domain the site is already registered under", async () => {
    mockList([]);
    const user = userEvent.setup();
    render(<DomainVerification siteId="site-1" siteDomain="example.com" />);

    await user.click(
      await screen.findByRole("button", { name: /Add domain/i }),
    );

    expect(screen.getByLabelText("Domain")).toHaveValue("example.com");
  });

  /**
   * Regression for the shape mismatch that made this component unusable: the
   * route returned raw snake_case rows while the component read camelCase, so
   * every field was `undefined` and `verificationMethod.toUpperCase()` threw
   * the moment a single row existed.
   */
  it("renders a pending verification from the normalised API shape", async () => {
    mockList([aVerification()]);
    render(<DomainVerification siteId="site-1" siteDomain="example.com" />);

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("Awaiting your DNS record")).toBeInTheDocument();
    expect(screen.getByText("DNS")).toBeInTheDocument();
    expect(
      screen.getByText("recopyfast-verification=abc123"),
    ).toBeInTheDocument();
  });

  /**
   * The button used to copy the bare code for the file method, while the block
   * beside it displayed the path — so an owner who followed it wrote a file the
   * checker refuses, with nothing to explain why. The instructions panel that
   * produces a correct file is dismissible and cannot be reopened for a row
   * that already exists, so this button was the only affordance left.
   *
   * Asserted against `fileDeclaresCode` itself rather than against a literal:
   * the point is not that some particular string is copied, it is that what
   * lands on the clipboard is what the verifier accepts.
   */
  it("copies a file body the verifier will accept, not the bare code", async () => {
    mockList([
      aVerification({ verificationMethod: "file", verificationCode: "abc123" }),
    ]);
    const user = userEvent.setup();
    render(<DomainVerification siteId="site-1" siteDomain="example.com" />);

    await user.click(
      await screen.findByRole("button", {
        name: /Copy file contents for example\.com/i,
      }),
    );

    const copied = await waitFor(async () => {
      const text = await navigator.clipboard.readText();
      expect(text).not.toBe("");
      return text;
    });
    expect(fileDeclaresCode(copied, "abc123")).toBe(true);
    // The bare code on its own is exactly what the checker refuses.
    expect(copied).not.toBe("abc123");

    // And the owner is still told where to put it.
    expect(
      screen.getByText("/.well-known/recopyfast-verification-abc123.txt"),
    ).toBeInTheDocument();
  });

  it("offers no controls to somebody who cannot manage the site", async () => {
    mockList([aVerification()], false);
    render(<DomainVerification siteId="site-1" siteDomain="example.com" />);

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add domain/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Check$/i }),
    ).not.toBeInTheDocument();
  });

  it("surfaces the reason a check failed instead of silently doing nothing", async () => {
    mockList([aVerification()]);
    const user = userEvent.setup();
    render(<DomainVerification siteId="site-1" siteDomain="example.com" />);

    await screen.findByText("example.com");

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: "DNS TXT record not found or incorrect",
      }),
    });

    await user.click(screen.getByRole("button", { name: /^Check$/i }));

    await waitFor(() => {
      expect(
        screen.getByText("DNS TXT record not found or incorrect"),
      ).toBeInTheDocument();
    });
  });

  it("explains an expired challenge rather than leaving a dead row", async () => {
    mockList([aVerification({ expiresAt: YESTERDAY })]);
    render(<DomainVerification siteId="site-1" siteDomain="example.com" />);

    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(
      screen.getByText(/Remove it and add the domain again/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Check$/i }),
    ).not.toBeInTheDocument();
  });
});
