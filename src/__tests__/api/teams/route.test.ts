import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/teams/route";

// Mock Supabase
const mockSupabase = {
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockReturnThis(),
};

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

// NOTE: `next/server` is mocked globally in jest.setup.js, which supplies both
// NextRequest and NextResponse. A local mock here used to shadow it with only
// NextResponse, which broke `new NextRequest(...)`.

describe("/api/teams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/teams", () => {
    it("should return teams for authenticated user", async () => {
      // Mock authenticated user
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-id", email: "user@example.com" } },
        error: null,
      });

      // Mock teams query
      mockSupabase.from.mockReturnValue({
        select: mockSupabase.select.mockReturnValue({
          eq: mockSupabase.eq.mockResolvedValue({
            data: [
              {
                id: "team-1",
                name: "Team 1",
                owner_id: "user-id",
                team_members: [{ role: "owner", joined_at: "2023-01-01" }],
              },
            ],
            error: null,
          }),
        }),
      });

      const request = new NextRequest("http://localhost/api/teams");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSupabase.auth.getUser).toHaveBeenCalled();
      expect(mockSupabase.from).toHaveBeenCalledWith("teams");
    });

    it("should return 401 for unauthenticated user", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Not authenticated" },
      });

      const request = new NextRequest("http://localhost/api/teams");
      const response = await GET(request);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    });

    it("should handle database errors", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-id" } },
        error: null,
      });

      mockSupabase.from.mockReturnValue({
        select: mockSupabase.select.mockReturnValue({
          eq: mockSupabase.eq.mockResolvedValue({
            data: null,
            error: { message: "Database error" },
          }),
        }),
      });

      const request = new NextRequest("http://localhost/api/teams");
      const response = await GET(request);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to fetch teams",
      });
    });
  });

  describe("POST /api/teams", () => {
    it("should create a new team", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-id", email: "user@example.com" } },
        error: null,
      });

      mockSupabase.from.mockReturnValue({
        insert: mockSupabase.insert.mockReturnValue({
          select: mockSupabase.select.mockReturnValue({
            single: mockSupabase.single.mockResolvedValue({
              data: {
                id: "team-id",
                name: "New Team",
                description: "Team description",
                owner_id: "user-id",
              },
              error: null,
            }),
          }),
        }),
      });

      const request = new NextRequest("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: "New Team",
          description: "Team description",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        team: expect.objectContaining({ name: "New Team" }),
      });
    });

    it("should validate team name", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-id" } },
        error: null,
      });

      const request = new NextRequest("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: "", // Empty name
          description: "Team description",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Team name is required",
      });
    });

    it("should validate team name length", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-id" } },
        error: null,
      });

      const longName = "a".repeat(101); // Over 100 characters

      const request = new NextRequest("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: longName,
          description: "Team description",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Team name must be less than 100 characters",
      });
    });

    it("should handle team creation errors", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-id" } },
        error: null,
      });

      mockSupabase.from.mockReturnValue({
        insert: mockSupabase.insert.mockReturnValue({
          select: mockSupabase.select.mockReturnValue({
            single: mockSupabase.single.mockResolvedValue({
              data: null,
              error: { message: "Creation failed" },
            }),
          }),
        }),
      });

      const request = new NextRequest("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: "New Team",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to create team",
      });
    });

    it("should trim team name and description", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-id" } },
        error: null,
      });

      mockSupabase.from.mockReturnValue({
        insert: mockSupabase.insert.mockReturnValue({
          select: mockSupabase.select.mockReturnValue({
            single: mockSupabase.single.mockResolvedValue({
              data: {
                id: "team-id",
                name: "Trimmed Team",
                description: "Trimmed description",
                owner_id: "user-id",
              },
              error: null,
            }),
          }),
        }),
      });

      const request = new NextRequest("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: "  Trimmed Team  ",
          description: "  Trimmed description  ",
        }),
      });

      await POST(request);

      expect(mockSupabase.from).toHaveBeenCalledWith("teams");
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        name: "Trimmed Team",
        description: "Trimmed description",
        owner_id: "user-id",
      });
    });
  });
});
