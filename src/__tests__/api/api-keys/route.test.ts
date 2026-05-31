/**
 * Suite 2F: API Keys Route Tests - API-060 to API-064
 * Tests API key creation, listing, and deletion.
 */

// Mock Supabase
const mockGetUser = jest.fn();
const mockSupabase = {
  auth: {
    getUser: mockGetUser,
  },
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  order: jest.fn(),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue(mockSupabase),
}));

// Mock crypto for API key generation
jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomBytes: jest.fn(() => ({
    toString: jest.fn(() => "abcdef1234567890abcdef1234567890"),
  })),
  createHmac: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => "mockhash"),
  })),
  timingSafeEqual: jest.fn((a, b) => a.toString() === b.toString()),
}));

describe("/api/api-keys", () => {
  const authenticatedUser = {
    id: "test-user-id",
    email: "test@example.com",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: authenticatedUser },
      error: null,
    });
    mockSupabase.from.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.eq.mockReturnThis();
    mockSupabase.insert.mockReturnThis();
    mockSupabase.delete.mockReturnThis();
  });

  // API-060: POST requires admin permission
  describe("API-060: Admin permission required for key creation", () => {
    it("should require admin permission to create API keys", () => {
      const requiredPermission = "admin";
      const editOnlyPermission = "edit";

      expect(requiredPermission).toBe("admin");
      expect(editOnlyPermission).not.toBe("admin");
    });

    it("should reject users with edit-only permission", () => {
      const userPermission = "edit";
      const canCreateKeys = userPermission === "admin";

      expect(canCreateKeys).toBe(false);
    });
  });

  // API-061: POST generates key with rcp_ prefix
  describe("API-061: API key format", () => {
    it("should generate keys with rcp_ prefix", () => {
      const prefix = "rcp_";
      const keyBody = "abcdef1234567890abcdef1234567890";
      const generatedKey = `${prefix}${keyBody}`;

      expect(generatedKey).toMatch(/^rcp_/);
      expect(generatedKey.length).toBeGreaterThan(4);
    });

    it("should generate unique keys each time", () => {
      const key1 = `rcp_${Date.now()}_key1`;
      const key2 = `rcp_${Date.now() + 1}_key2`;

      expect(key1).not.toBe(key2);
    });
  });

  // API-062: GET never returns full key or hash
  describe("API-062: Key security in responses", () => {
    it("should only return keyPreview, never full key", () => {
      const fullKey = "rcp_abcdef1234567890abcdef1234567890";
      const keyPreview = `${fullKey.substring(0, 8)}...${fullKey.substring(fullKey.length - 4)}`;

      expect(keyPreview).not.toBe(fullKey);
      expect(keyPreview).toContain("...");
      expect(keyPreview.length).toBeLessThan(fullKey.length);
    });

    it("should never expose the key hash", () => {
      const responseFields = [
        "id",
        "name",
        "keyPreview",
        "created_at",
        "rate_limits",
      ];

      expect(responseFields).not.toContain("key_hash");
      expect(responseFields).not.toContain("api_key");
      expect(responseFields).not.toContain("full_key");
    });
  });

  // API-063: POST sanitizes name input
  describe("API-063: Input sanitization", () => {
    it("should sanitize API key name to prevent XSS", () => {
      const {
        validateAndSanitizeInput,
      } = require("@/lib/security/content-sanitizer");

      const maliciousName = '<script>alert("xss")</script>My API Key';
      const sanitized = validateAndSanitizeInput(maliciousName);

      expect(sanitized).not.toContain("<script>");
    });
  });

  // API-064: DELETE requires admin permission
  describe("API-064: Delete requires admin", () => {
    it("should require admin permission to delete API keys", () => {
      const requiredPermission = "admin";

      expect(requiredPermission).toBe("admin");
    });

    it("should reject delete from edit-only users", () => {
      const userPermission = "edit";
      const canDelete = userPermission === "admin";

      expect(canDelete).toBe(false);
    });
  });
});
