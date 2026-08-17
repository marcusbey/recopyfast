import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamSelector } from "@/components/collaboration/TeamSelector";
import { NotificationCenter } from "@/components/collaboration/NotificationCenter";
import { Team } from "@/types";

// Mock fetch
global.fetch = jest.fn();

// There was a `jest.mock("@/lib/collaboration/realtime", …)` here. It was
// mocking a module neither component under test ever imported — the dashboard
// has never opened a socket — and the module itself was deleted as dead code on
// 2026-08-17. A mock of a non-existent path throws at collection, so it goes
// with it. Nothing in the assertions below changes.

const mockTeam: Team = {
  id: "team-1",
  name: "Test Team",
  description: "A test team",
  owner_id: "user-1",
  billing_plan: "free",
  max_members: 5,
  created_at: "2023-01-01T00:00:00Z",
  updated_at: "2023-01-01T00:00:00Z",
};

describe("Collaboration Components Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockClear();
  });

  describe("TeamSelector", () => {
    it("should load and display teams", async () => {
      const onTeamSelect = jest.fn();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            teams: [{ ...mockTeam, team_members: [{ role: "owner" }] }],
          }),
      });

      const user = userEvent.setup();
      render(
        <TeamSelector onTeamSelect={onTeamSelect} onCreateTeam={jest.fn()} />,
      );

      // With no `selectedTeam` prop the trigger keeps its placeholder; the
      // observable effect of loading is that the first team is auto-selected.
      await waitFor(() => {
        expect(onTeamSelect).toHaveBeenCalledWith(
          expect.objectContaining({ id: mockTeam.id, role: "owner" }),
        );
      });

      expect(fetch).toHaveBeenCalledWith("/api/teams");

      // The loaded team is listed once the dropdown is opened.
      await user.click(screen.getByRole("button", { name: /Select Team/i }));
      expect(await screen.findByText("Test Team")).toBeInTheDocument();
    });

    it("should create a new team", async () => {
      const user = userEvent.setup();
      const onTeamSelect = jest.fn();
      const onCreateTeam = jest.fn();

      // Mock teams list (empty)
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ teams: [] }),
        })
        // Mock team creation
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ team: mockTeam }),
        });

      render(
        <TeamSelector
          onTeamSelect={onTeamSelect}
          onCreateTeam={onCreateTeam}
        />,
      );

      // Wait for load
      await waitFor(() => {
        expect(screen.getByText("Create Team")).toBeInTheDocument();
      });

      // Click create team button
      await user.click(screen.getByText("Create Team"));

      // Fill form
      const nameInput = screen.getByLabelText("Team Name *");
      await user.type(nameInput, "New Team");

      const descriptionInput = screen.getByLabelText("Description (Optional)");
      await user.type(descriptionInput, "New team description");

      // Submit form
      await user.click(screen.getByRole("button", { name: "Create Team" }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/teams",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              name: "New Team",
              description: "New team description",
            }),
          }),
        );
      });

      expect(onCreateTeam).toHaveBeenCalledWith(
        expect.objectContaining({
          ...mockTeam,
          role: "owner",
        }),
      );
    });
  });

  describe("NotificationCenter", () => {
    const mockNotifications = [
      {
        id: "notif-1",
        user_id: "user-1",
        type: "invitation" as const,
        title: "Team Invitation",
        message: "You have been invited to join Test Team",
        data: {},
        read_at: null,
        created_at: "2023-01-01T00:00:00Z",
      },
      {
        id: "notif-2",
        user_id: "user-1",
        type: "team_update" as const,
        title: "Team Updated",
        message: "Team settings have been updated",
        data: {},
        read_at: "2023-01-01T01:00:00Z",
        created_at: "2023-01-01T00:30:00Z",
      },
    ];

    it("should load and display notifications", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notifications: mockNotifications }),
      });

      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText("Team Invitation")).toBeInTheDocument();
        expect(screen.getByText("Team Updated")).toBeInTheDocument();
      });

      expect(fetch).toHaveBeenCalledWith(
        "/api/notifications?unread_only=true&limit=10",
      );
    });

    it("should mark notifications as read", async () => {
      const user = userEvent.setup();

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ notifications: mockNotifications }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: "Updated" }),
        });

      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText("Team Invitation")).toBeInTheDocument();
      });

      // Click mark all read button
      await user.click(screen.getByText("Mark all read"));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/notifications",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({
              notificationIds: ["notif-1"],
              markAsRead: true,
            }),
          }),
        );
      });
    });

    it("should show empty state when no notifications", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notifications: [] }),
      });

      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText("All caught up!")).toBeInTheDocument();
      });
    });
  });
});
