import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamDashboard } from '@/components/collaboration/TeamDashboard';
import { TeamSelector } from '@/components/collaboration/TeamSelector';
import { NotificationCenter } from '@/components/collaboration/NotificationCenter';
import { Team, TeamMember, TeamInvitation } from '@/types';

// Mock fetch
global.fetch = jest.fn();

// Mock collaboration realtime
jest.mock('@/lib/collaboration/realtime', () => ({
  collaborationRealtime: {
    connect: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    isConnected: true,
  },
}));

const mockTeam: Team = {
  id: 'team-1',
  name: 'Test Team',
  description: 'A test team',
  owner_id: 'user-1',
  billing_plan: 'free',
  max_members: 5,
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
};

const mockMembers: TeamMember[] = [
  {
    id: 'member-1',
    team_id: 'team-1',
    user_id: 'user-1',
    role: 'owner',
    joined_at: '2023-01-01T00:00:00Z',
    user: {
      email: 'owner@example.com',
      raw_user_meta_data: { name: 'Team Owner' },
    },
  },
  {
    id: 'member-2',
    team_id: 'team-1',
    user_id: 'user-2',
    role: 'editor',
    joined_at: '2023-01-02T00:00:00Z',
    user: {
      email: 'editor@example.com',
      raw_user_meta_data: { name: 'Team Editor' },
    },
  },
];

const mockInvitations: TeamInvitation[] = [
  {
    id: 'invite-1',
    team_id: 'team-1',
    email: 'newuser@example.com',
    role: 'editor',
    invited_by: 'user-1',
    token: 'invite-token',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: '2023-01-03T00:00:00Z',
    team: { name: 'Test Team' },
    inviter: { email: 'owner@example.com' },
  },
];

describe('Collaboration Components Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockClear();
  });

  describe('TeamDashboard', () => {
    it('should render team information and load data', async () => {
      // Mock API calls
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ members: mockMembers }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ invitations: mockInvitations }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ activities: [] }),
        });

      render(
        <TeamDashboard 
          team={mockTeam} 
          userRole="owner"
          onUpdateTeam={jest.fn()}
        />
      );

      // Check team header
      expect(screen.getByText('Test Team')).toBeInTheDocument();
      expect(screen.getByText('A test team')).toBeInTheDocument();
      expect(screen.getByText('2 / 5 members')).toBeInTheDocument();
      expect(screen.getByText('free plan')).toBeInTheDocument();

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('Team Members (2)')).toBeInTheDocument();
      });

      // Check member display
      expect(screen.getByText('Team Owner')).toBeInTheDocument();
      expect(screen.getByText('owner@example.com')).toBeInTheDocument();
      expect(screen.getByText('Team Editor')).toBeInTheDocument();
      expect(screen.getByText('editor@example.com')).toBeInTheDocument();
    });

    it('should allow team managers to invite new members', async () => {
      const user = userEvent.setup();

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ members: mockMembers }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ invitations: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ activities: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ invitation: mockInvitations[0] }),
        });

      render(
        <TeamDashboard 
          team={mockTeam} 
          userRole="manager"
          onUpdateTeam={jest.fn()}
        />
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText('Invite Member')).toBeInTheDocument();
      });

      // Click invite button
      await user.click(screen.getByText('Invite Member'));

      // Fill invitation form
      const emailInput = screen.getByLabelText('Email Address');
      await user.type(emailInput, 'newuser@example.com');

      const roleSelect = screen.getByLabelText('Role');
      await user.selectOptions(roleSelect, 'editor');

      // Submit invitation
      await user.click(screen.getByText('Send Invitation'));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          `/api/teams/${mockTeam.id}/invitations`,
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'newuser@example.com',
              role: 'editor',
              teamId: mockTeam.id,
            }),
          })
        );
      });
    });

    it('should not show invite button for viewers', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ members: mockMembers }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ activities: [] }),
        });

      render(
        <TeamDashboard 
          team={mockTeam} 
          userRole="viewer"
          onUpdateTeam={jest.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Test Team')).toBeInTheDocument();
      });

      expect(screen.queryByText('Invite Member')).not.toBeInTheDocument();
    });
  });

  describe('TeamSelector', () => {
    it('should load and display teams', async () => {
      const onTeamSelect = jest.fn();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          teams: [
            { ...mockTeam, team_members: [{ role: 'owner' }] },
          ],
        }),
      });

      render(
        <TeamSelector 
          onTeamSelect={onTeamSelect}
          onCreateTeam={jest.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Test Team')).toBeInTheDocument();
      });

      expect(fetch).toHaveBeenCalledWith('/api/teams');
    });

    it('should create a new team', async () => {
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
        />
      );

      // Wait for load
      await waitFor(() => {
        expect(screen.getByText('Create Team')).toBeInTheDocument();
      });

      // Click create team button
      await user.click(screen.getByText('Create Team'));

      // Fill form
      const nameInput = screen.getByLabelText('Team Name *');
      await user.type(nameInput, 'New Team');

      const descriptionInput = screen.getByLabelText('Description (Optional)');
      await user.type(descriptionInput, 'New team description');

      // Submit form
      await user.click(screen.getByRole('button', { name: 'Create Team' }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/teams',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              name: 'New Team',
              description: 'New team description',
            }),
          })
        );
      });

      expect(onCreateTeam).toHaveBeenCalledWith(expect.objectContaining({
        ...mockTeam,
        role: 'owner',
      }));
    });
  });

  describe('NotificationCenter', () => {
    const mockNotifications = [
      {
        id: 'notif-1',
        user_id: 'user-1',
        type: 'invitation' as const,
        title: 'Team Invitation',
        message: 'You have been invited to join Test Team',
        data: {},
        read_at: null,
        created_at: '2023-01-01T00:00:00Z',
      },
      {
        id: 'notif-2',
        user_id: 'user-1',
        type: 'team_update' as const,
        title: 'Team Updated',
        message: 'Team settings have been updated',
        data: {},
        read_at: '2023-01-01T01:00:00Z',
        created_at: '2023-01-01T00:30:00Z',
      },
    ];

    it('should load and display notifications', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notifications: mockNotifications }),
      });

      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText('Team Invitation')).toBeInTheDocument();
        expect(screen.getByText('Team Updated')).toBeInTheDocument();
      });

      expect(fetch).toHaveBeenCalledWith('/api/notifications?unread_only=true&limit=10');
    });

    it('should mark notifications as read', async () => {
      const user = userEvent.setup();

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ notifications: mockNotifications }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'Updated' }),
        });

      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText('Team Invitation')).toBeInTheDocument();
      });

      // Click mark all read button
      await user.click(screen.getByText('Mark all read'));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/notifications',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              notificationIds: ['notif-1'],
              markAsRead: true,
            }),
          })
        );
      });
    });

    it('should show empty state when no notifications', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notifications: [] }),
      });

      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText('All caught up!')).toBeInTheDocument();
      });
    });
  });
});