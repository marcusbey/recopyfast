/**
 * Integration coverage for the public /demo route.
 *
 * The previous version of this file mocked `document.createElement` at module
 * scope (which broke Testing Library's own container creation) and then
 * asserted against `MockDemoPage` / `MockRealTimeDemo` components declared
 * inside the test file — exercising React rather than the product. This renders
 * the real `src/app/demo/page.tsx` instead.
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import Demo from "@/app/demo/page";

// The demo page renders <Header/>, which consumes the auth context. Provide a
// signed-out context so the page can mount standalone.
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

const DEMO_SITE_ID = "7e3b2d6c-1ab1-46f3-92fd-493173fa3e17";
const DEMO_STAGING_TOKEN = "test_staging_token_valid_123";

const getEmbedScript = () =>
  document.body.querySelector<HTMLScriptElement>(
    'script[src="/embed/recopyfast.js"]',
  );

describe("Demo page", () => {
  beforeEach(() => {
    // jsdom does not implement navigation; the loader's redirect branch logs
    // through console.error when the staging params are missing.
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(console, "log").mockImplementation();
    delete window.RECOPYFAST_API;
    delete window.RECOPYFAST_WS;
  });

  afterEach(() => {
    document
      .querySelectorAll('script[src="/embed/recopyfast.js"]')
      .forEach((node) => node.remove());
    jest.restoreAllMocks();
  });

  describe("page content", () => {
    beforeEach(() => {
      window.history.replaceState(
        {},
        "",
        `/demo?rcf_staging=1&rcf_token=${DEMO_STAGING_TOKEN}`,
      );
    });

    it("renders the demo headline and instructions", () => {
      render(<Demo />);

      expect(
        screen.getByRole("heading", { name: "See ReCopyFast in Action" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Click on any text element below to edit it/i),
      ).toBeInTheDocument();
    });

    it("renders the simulated customer site used as the edit target", () => {
      render(<Demo />);

      expect(
        screen.getByRole("heading", { name: "Demo Company Website" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/This is a demo site showing ReCopyFast in action/i),
      ).toBeInTheDocument();
    });

    it("renders the closing call to action", () => {
      render(<Demo />);

      expect(
        screen.getByRole("heading", { name: "Ready to Get Started?" }),
      ).toBeInTheDocument();
    });
  });

  describe("embed script wiring", () => {
    it("injects the embed script when the page is in staging mode", () => {
      window.history.replaceState(
        {},
        "",
        `/demo?rcf_staging=1&rcf_token=${DEMO_STAGING_TOKEN}`,
      );

      render(<Demo />);

      const script = getEmbedScript();
      expect(script).not.toBeNull();
      expect(script!.getAttribute("data-site-id")).toBe(DEMO_SITE_ID);
      expect(script!.getAttribute("data-site-token")).toBe(DEMO_STAGING_TOKEN);
    });

    it("publishes the API and websocket endpoints the embed script reads", () => {
      window.history.replaceState(
        {},
        "",
        `/demo?rcf_staging=1&rcf_token=${DEMO_STAGING_TOKEN}`,
      );

      render(<Demo />);

      expect(window.RECOPYFAST_API).toBe(`${window.location.origin}/api`);
      expect(window.RECOPYFAST_WS).toBe(
        process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4001",
      );
    });

    it("renders the page but injects nothing when staging params are absent", () => {
      window.history.replaceState({}, "", "/demo");

      render(<Demo />);

      expect(
        screen.getByRole("heading", { name: "See ReCopyFast in Action" }),
      ).toBeInTheDocument();
      expect(getEmbedScript()).toBeNull();
      expect(window.RECOPYFAST_API).toBeUndefined();
    });

    it("removes the embed script when the page unmounts", () => {
      window.history.replaceState(
        {},
        "",
        `/demo?rcf_staging=1&rcf_token=${DEMO_STAGING_TOKEN}`,
      );

      const { unmount } = render(<Demo />);
      expect(getEmbedScript()).not.toBeNull();

      unmount();

      expect(getEmbedScript()).toBeNull();
    });
  });
});
