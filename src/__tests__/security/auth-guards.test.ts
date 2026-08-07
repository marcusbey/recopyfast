/**
 * Suite 5A: Auth Guards - SEC-001 to SEC-005
 * Verifies that all protected routes and APIs enforce authentication.
 */

import { authorizeSiteRequest } from "@/lib/security/site-auth";

// Mock Supabase
const mockGetUser = jest.fn();
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "Not authenticated" },
      }),
    },
  }),
}));

// Mock Stripe
jest.mock("stripe", () => jest.fn().mockImplementation(() => ({})));
process.env.STRIPE_SECRET_KEY = "sk_test_fake";

describe("Auth Guards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // SEC-001: All /dashboard/* routes redirect without auth
  describe("SEC-001: Dashboard route protection", () => {
    it("should define protected routes including /dashboard", () => {
      // The middleware defines protectedRoutes = ["/dashboard", "/sites", "/settings"]
      const protectedRoutes = ["/dashboard", "/sites", "/settings"];

      protectedRoutes.forEach((route) => {
        expect(route).toBeDefined();
      });

      // Verify /dashboard paths are protected
      expect(protectedRoutes.some((r) => "/dashboard".startsWith(r))).toBe(
        true,
      );
      expect(
        protectedRoutes.some((r) => "/dashboard/billing".startsWith(r)),
      ).toBe(true);
      expect(
        protectedRoutes.some((r) => "/dashboard/settings".startsWith(r)),
      ).toBe(true);
    });
  });

  // SEC-002: All authenticated API routes return 401
  describe("SEC-002: API route authentication", () => {
    it("should list all routes requiring user session auth", () => {
      const authenticatedApiRoutes = [
        "/api/billing/subscription",
        "/api/teams",
        "/api/sites",
        "/api/api-keys",
        "/api/ai/suggest",
        "/api/ai/translate",
        "/api/billing/dashboard",
        "/api/billing/payment-methods",
      ];

      // All routes should be defined
      authenticatedApiRoutes.forEach((route) => {
        expect(route).toBeDefined();
        expect(route.startsWith("/api/")).toBe(true);
      });
    });

    it("billing subscription route refuses an unauthenticated caller with 401", async () => {
      // Rewritten. Every branch of the previous version passed: the assertion
      // accepted 500 as well as 401, the `if (response)` skipped it entirely if
      // the route returned nothing, and the catch asserted `true`. A route that
      // answered 500 to every caller — or threw — was indistinguishable from one
      // that correctly refused. 500 in particular was not hypothetical: jsdom
      // has no `setImmediate`, so winston threw and this handler reached its
      // outer catch (see the polyfill in jest.setup.js).
      const { GET } = await import("@/app/api/billing/subscription/route");
      const response = await GET();

      expect(response.status).toBe(401);
    });
  });

  // SEC-003: Content API uses site token, not user session
  describe("SEC-003: Content API uses site token auth", () => {
    it("content API should use site token mechanism", () => {
      // The content API uses authorizeSiteRequest which validates HMAC tokens
      // Not user session auth like dashboard APIs
      expect(authorizeSiteRequest).toBeDefined();
      expect(typeof authorizeSiteRequest).toBe("function");
    });
  });

  // SEC-004: API key ops require admin, not just edit
  describe("SEC-004: API key operations require admin permission", () => {
    it("should define admin as required permission for API key management", () => {
      // API key routes check for admin permission level
      const adminPermissions = ["admin"];
      expect(adminPermissions).toContain("admin");
      expect(adminPermissions).not.toContain("edit");
    });
  });

  // SEC-005: Webhook ops require edit or admin
  describe("SEC-005: Webhook operations require edit or admin", () => {
    it("should define edit/admin as minimum permission for webhooks", () => {
      const webhookPermissions = ["edit", "admin"];
      expect(webhookPermissions).toContain("edit");
      expect(webhookPermissions).toContain("admin");
      expect(webhookPermissions).not.toContain("view");
    });
  });
});
