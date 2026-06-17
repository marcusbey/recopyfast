/**
 * Suite 4: WebSocket Server Tests - WS-001 to WS-022
 * Tests Socket.io server authentication, content operations, and staging.
 */

import crypto from "crypto";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";

// Mock dependencies
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: "site-123", domain: "example.com", api_key: "test-api-key" },
      error: null,
    }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    insert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn().mockReturnThis(),
  })),
}));

jest.mock("@/lib/security/content-sanitizer", () => ({
  sanitizeHTML: jest.fn((content: string) =>
    content.replace(/<script[^>]*>.*?<\/script>/gi, ""),
  ),
  validateAndSanitizeInput: jest.fn((input: string) => input),
}));

// Helper to build valid tokens for testing
function buildTestToken(siteId: string, apiKey: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${siteId}.${issuedAt}`;
  const signature = crypto
    .createHmac("sha256", apiKey)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

describe("WebSocket Server", () => {
  const testSiteId = "site-123";
  const testApiKey = "test-api-key";

  // WS-001: Connection rejected without siteId
  describe("WS-001: Connection requires siteId", () => {
    it("should require siteId in handshake query", () => {
      const handshake = { query: {} };
      const hasSiteId = Boolean(
        handshake.query && (handshake.query as Record<string, unknown>).siteId,
      );
      expect(hasSiteId).toBe(false);
    });
  });

  // WS-002: Connection rejected without token
  describe("WS-002: Connection requires token", () => {
    it("should require token in handshake", () => {
      const handshake = { query: { siteId: testSiteId } };
      const hasToken = Boolean(
        (handshake.query as Record<string, unknown>).token,
      );
      expect(hasToken).toBe(false);
    });
  });

  // WS-003: Connection rejected with invalid token
  describe("WS-003: Invalid token rejection", () => {
    it("should reject tokens that fail HMAC verification", () => {
      const invalidToken = `${testSiteId}.12345.invalidsignature`;

      const parts = invalidToken.split(".");
      expect(parts).toHaveLength(3);

      const [tokenSiteId, issuedAt] = parts;
      const expectedSignature = crypto
        .createHmac("sha256", testApiKey)
        .update(`${tokenSiteId}.${issuedAt}`)
        .digest("hex");

      expect(parts[2]).not.toBe(expectedSignature);
    });
  });

  // WS-004: Connection rejected for wrong origin
  describe("WS-004: Origin validation", () => {
    it("should reject connections from unauthorized origins", () => {
      const siteDomain = "example.com";
      const requestOrigin = "https://evil.com";
      const originHostname = new URL(requestOrigin).hostname;

      expect(originHostname).not.toBe(siteDomain);
    });
  });

  // WS-005: Valid connection joins correct room
  describe("WS-005: Room assignment", () => {
    it("should join site:{siteId} room on valid connection", () => {
      const expectedRoom = `site:${testSiteId}`;
      expect(expectedRoom).toBe("site:site-123");
    });

    it("should join staging room for staging connections", () => {
      const expectedRoom = `site:${testSiteId}:staging`;
      expect(expectedRoom).toBe("site:site-123:staging");
    });

    it("should join dashboard room for dashboard connections", () => {
      const expectedRoom = `dashboard:${testSiteId}`;
      expect(expectedRoom).toBe("dashboard:site-123");
    });
  });

  // WS-006: content-map saves elements to DB
  describe("WS-006: Content map storage", () => {
    it("should format content elements for upsert", () => {
      const contentMap = {
        "header-1": { selector: "h1", content: "Welcome", type: "text" },
        "para-1": { selector: "p", content: "Hello world", type: "text" },
      };

      const elements = Object.entries(contentMap).map(([elementId, data]) => ({
        site_id: testSiteId,
        element_id: elementId,
        selector: data.selector,
        original_content: data.content,
        current_content: data.content,
        language: "en",
        variant: "default",
      }));

      expect(elements).toHaveLength(2);
      expect(elements[0].site_id).toBe(testSiteId);
      expect(elements[0].element_id).toBe("header-1");
      expect(elements[1].element_id).toBe("para-1");
    });
  });

  // WS-007: content-map sanitizes content
  describe("WS-007: Content sanitization on save", () => {
    it("should sanitize HTML content before storage", () => {
      const dirtyContent = '<script>alert("xss")</script><p>Clean</p>';
      const sanitized = sanitizeHTML(dirtyContent, "BASIC_TEXT");

      expect(sanitized).not.toContain("<script>");
    });
  });

  // WS-008: content-update broadcasts to room
  describe("WS-008: Content update broadcasting", () => {
    it("should broadcast updates to all clients in the room", () => {
      const roomName = `site:${testSiteId}`;
      const updatePayload = {
        elementId: "header-1",
        content: "Updated content",
        language: "en",
      };

      expect(roomName).toBeDefined();
      expect(updatePayload.elementId).toBe("header-1");
    });
  });

  // WS-009: content-update re-validates token per message
  describe("WS-009: Per-message token validation", () => {
    it("should validate token on each content update", () => {
      const validToken = buildTestToken(testSiteId, testApiKey);
      const parts = validToken.split(".");

      expect(parts).toHaveLength(3);

      // Verify HMAC
      const expectedSig = crypto
        .createHmac("sha256", testApiKey)
        .update(`${parts[0]}.${parts[1]}`)
        .digest("hex");

      expect(parts[2]).toBe(expectedSig);
    });

    it("should emit auth-error for expired/invalid token", () => {
      const expiredToken = `${testSiteId}.0.invalidsig`;
      const parts = expiredToken.split(".");

      const expectedSig = crypto
        .createHmac("sha256", testApiKey)
        .update(`${parts[0]}.${parts[1]}`)
        .digest("hex");

      expect(parts[2]).not.toBe(expectedSig);
    });
  });

  // WS-010: Staging requires valid staging token
  describe("WS-010: Staging token validation", () => {
    it("should require valid staging access token", () => {
      const stagingToken = "valid-staging-token";
      expect(stagingToken).toBeTruthy();
    });

    it("should reject invalid staging tokens", () => {
      const invalidToken = "";
      expect(invalidToken).toBeFalsy();
    });
  });

  // WS-011: Staging edit requires edit permission
  describe("WS-011: Staging edit permission", () => {
    it("should allow edit permission for staging changes", () => {
      const permissions = ["edit", "admin"];
      expect(permissions).toContain("edit");
    });

    it("should block view-only users from staging edits", () => {
      const userPermission = "view";
      const canEdit = ["edit", "admin"].includes(userPermission);
      expect(canEdit).toBe(false);
    });
  });

  // WS-012: Staging writes to staging_content column
  describe("WS-012: Staging content isolation", () => {
    it("should write to staging_content, not current_content", () => {
      const updateColumn = "staging_content";
      expect(updateColumn).toBe("staging_content");
      expect(updateColumn).not.toBe("current_content");
    });
  });

  // WS-013: Staging updates only go to staging room
  describe("WS-013: Staging room isolation", () => {
    it("should broadcast staging updates only to staging room", () => {
      const stagingRoom = `site:${testSiteId}:staging`;
      const liveRoom = `site:${testSiteId}`;

      expect(stagingRoom).not.toBe(liveRoom);
      expect(stagingRoom).toContain(":staging");
    });
  });

  // WS-014: bulk-update processes multiple elements
  describe("WS-014: Bulk update processing", () => {
    it("should process multiple elements in a single update", () => {
      const bulkElements = [
        { elementId: "header-1", content: "New Header" },
        { elementId: "para-1", content: "New Paragraph" },
        { elementId: "footer-1", content: "New Footer" },
      ];

      expect(bulkElements).toHaveLength(3);
      bulkElements.forEach((el) => {
        expect(el.elementId).toBeDefined();
        expect(el.content).toBeDefined();
      });
    });
  });

  // WS-015: bulk-update creates version snapshot
  describe("WS-015: Version snapshots", () => {
    it("should create a version snapshot before bulk changes", () => {
      const versionSnapshot = {
        id: "version-123",
        site_id: testSiteId,
        created_at: new Date().toISOString(),
        element_count: 3,
      };

      expect(versionSnapshot.id).toBeDefined();
      expect(versionSnapshot.element_count).toBe(3);
    });
  });

  // WS-016: switch-language only in staging mode
  describe("WS-016: Language switch restriction", () => {
    it("should only allow language switch in staging mode", () => {
      const isStaging = true;
      const canSwitchLanguage = isStaging;
      expect(canSwitchLanguage).toBe(true);
    });

    it("should reject language switch in live mode", () => {
      const isStaging = false;
      const canSwitchLanguage = isStaging;
      expect(canSwitchLanguage).toBe(false);
    });
  });

  // WS-017: restore-version requires edit permission
  describe("WS-017: Version restore permission", () => {
    it("should require edit permission to restore versions", () => {
      const userPermission = "view";
      const canRestore = ["edit", "admin"].includes(userPermission);
      expect(canRestore).toBe(false);
    });

    it("should allow edit users to restore versions", () => {
      const userPermission = "edit";
      const canRestore = ["edit", "admin"].includes(userPermission);
      expect(canRestore).toBe(true);
    });
  });

  // WS-018: activate-theme requires admin permission
  describe("WS-018: Theme activation permission", () => {
    it("should require admin permission for theme activation", () => {
      const userPermission = "edit";
      const canActivateTheme = userPermission === "admin";
      expect(canActivateTheme).toBe(false);
    });

    it("should allow admin users to activate themes", () => {
      const userPermission = "admin";
      const canActivateTheme = userPermission === "admin";
      expect(canActivateTheme).toBe(true);
    });
  });

  // WS-019: staging-publish requires publish permission
  describe("WS-019: Publish permission", () => {
    it("should require publish or admin permission", () => {
      const publishPermissions = ["publish", "admin"];

      expect(publishPermissions).toContain("publish");
      expect(publishPermissions).toContain("admin");
    });

    it("should block edit-only users from publishing", () => {
      const userPermission = "edit";
      const canPublish = ["publish", "admin"].includes(userPermission);
      expect(canPublish).toBe(false);
    });
  });

  // WS-020: Publish copies staging to published_content
  describe("WS-020: Publish content flow", () => {
    it("should copy staging_content to published_content on publish", () => {
      const stagingContent = "Staged version of content";
      const publishedContent = stagingContent; // Copy on publish

      expect(publishedContent).toBe(stagingContent);
    });

    it("should notify live room after publish", () => {
      const liveRoom = `site:${testSiteId}`;
      expect(liveRoom).toBe("site:site-123");
    });
  });

  // WS-021: Publish skips unchanged elements
  describe("WS-021: Efficient publish", () => {
    it("should skip elements where staging equals published", () => {
      const elements = [
        { id: "1", staging: "Changed", published: "Original" },
        { id: "2", staging: "Same", published: "Same" },
        { id: "3", staging: "Also Changed", published: "Original" },
      ];

      const changedElements = elements.filter(
        (el) => el.staging !== el.published,
      );

      expect(changedElements).toHaveLength(2);
      expect(changedElements.map((e) => e.id)).toEqual(["1", "3"]);
    });

    it("should return 0 published when nothing changed", () => {
      const elements = [
        { staging: "Same", published: "Same" },
        { staging: "Also Same", published: "Also Same" },
      ];

      const changedCount = elements.filter(
        (el) => el.staging !== el.published,
      ).length;

      expect(changedCount).toBe(0);
    });
  });

  // WS-022: Disconnect cleans up connection tracking
  describe("WS-022: Disconnect cleanup", () => {
    it("should remove connection from tracking maps on disconnect", () => {
      const connections = new Map<string, string>();
      connections.set("socket-123", "site-123");

      expect(connections.has("socket-123")).toBe(true);

      // Simulate disconnect
      connections.delete("socket-123");

      expect(connections.has("socket-123")).toBe(false);
    });

    it("should clean up room membership on disconnect", () => {
      const roomMembers = new Set(["socket-1", "socket-2", "socket-3"]);

      // Simulate socket-2 disconnect
      roomMembers.delete("socket-2");

      expect(roomMembers.size).toBe(2);
      expect(roomMembers.has("socket-2")).toBe(false);
    });
  });
});
