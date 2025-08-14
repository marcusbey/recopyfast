import { CollaborationPermissions } from '@/lib/collaboration/permissions';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
};

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

describe('CollaborationPermissions', () => {
  let permissions: CollaborationPermissions;

  beforeEach(() => {
    permissions = new CollaborationPermissions();
    jest.clearAllMocks();
  });

  describe('checkTeamPermission', () => {
    it('should return permission granted for team member with required role', async () => {
      mockSupabase.from.mockReturnValue({
        select: mockSupabase.select.mockReturnValue({
          eq: mockSupabase.eq.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              single: mockSupabase.single.mockResolvedValue({
                data: { role: 'manager' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await permissions.checkTeamPermission('user-id', 'team-id', ['manager', 'owner']);
      
      expect(result.hasPermission).toBe(true);
      expect(result.userRole).toBe('manager');
    });

    it('should return permission denied for user not in team', async () => {
      mockSupabase.from.mockReturnValue({
        select: mockSupabase.select.mockReturnValue({
          eq: mockSupabase.eq.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              single: mockSupabase.single.mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            }),
          }),
        }),
      });

      const result = await permissions.checkTeamPermission('user-id', 'team-id', ['manager', 'owner']);
      
      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('User is not a member of this team');
    });

    it('should return permission denied for insufficient role', async () => {
      mockSupabase.from.mockReturnValue({
        select: mockSupabase.select.mockReturnValue({
          eq: mockSupabase.eq.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              single: mockSupabase.single.mockResolvedValue({
                data: { role: 'viewer' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await permissions.checkTeamPermission('user-id', 'team-id', ['manager', 'owner']);
      
      expect(result.hasPermission).toBe(false);
      expect(result.userRole).toBe('viewer');
      expect(result.reason).toBe('Requires one of: manager, owner');
    });
  });

  describe('checkSitePermission', () => {
    it('should return permission granted for direct site permission', async () => {
      mockSupabase.from.mockReturnValue({
        select: mockSupabase.select.mockReturnValue({
          eq: mockSupabase.eq.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              single: mockSupabase.single.mockResolvedValue({
                data: { role: 'editor' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await permissions.checkSitePermission('user-id', 'site-id', ['editor', 'manager']);
      
      expect(result.hasPermission).toBe(true);
      expect(result.userRole).toBe('editor');
    });

    it('should check team-based permissions when direct permission not found', async () => {
      // First call for direct permission returns null
      mockSupabase.from
        .mockReturnValueOnce({
          select: mockSupabase.select.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              eq: mockSupabase.eq.mockReturnValue({
                single: mockSupabase.single.mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        })
        // Second call for team permissions
        .mockReturnValueOnce({
          select: mockSupabase.select.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              eq: mockSupabase.eq.mockResolvedValue({
                data: [
                  {
                    role: 'editor',
                    team: {
                      team_members: [{ role: 'manager' }],
                    },
                  },
                ],
                error: null,
              }),
            }),
          }),
        });

      const result = await permissions.checkSitePermission('user-id', 'site-id', ['editor']);
      
      expect(result.hasPermission).toBe(true);
    });
  });

  describe('checkContentEditPermission', () => {
    it('should check for active editing sessions by other users', async () => {
      // Mock content element lookup
      mockSupabase.from
        .mockReturnValueOnce({
          select: mockSupabase.select.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              single: mockSupabase.single.mockResolvedValue({
                data: { site_id: 'site-id' },
                error: null,
              }),
            }),
          }),
        })
        // Mock active sessions check
        .mockReturnValueOnce({
          select: mockSupabase.select.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              is: mockSupabase.is.mockReturnValue({
                gt: mockSupabase.gt.mockReturnValue({
                  neq: mockSupabase.neq.mockResolvedValue({
                    data: [{ user_id: 'other-user' }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        });

      const result = await permissions.checkContentEditPermission('user-id', 'content-id');
      
      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('Content is currently being edited by another user');
    });
  });

  describe('startEditingSession', () => {
    it('should create editing session when user has permission', async () => {
      // Mock permission check
      const permissionCheck = jest.spyOn(permissions, 'checkContentEditPermission')
        .mockResolvedValue({ hasPermission: true });

      // Mock session creation
      mockSupabase.from
        .mockReturnValueOnce({
          update: mockSupabase.update.mockReturnValue({
            eq: mockSupabase.eq.mockReturnValue({
              eq: mockSupabase.eq.mockReturnValue({
                is: mockSupabase.is.mockResolvedValue({
                  data: {},
                  error: null,
                }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          insert: mockSupabase.insert.mockReturnValue({
            select: mockSupabase.select.mockReturnValue({
              single: mockSupabase.single.mockResolvedValue({
                data: { session_token: 'session-token' },
                error: null,
              }),
            }),
          }),
        });

      const token = await permissions.startEditingSession('user-id', 'content-id');
      
      expect(token).toBe('session-token');
      expect(permissionCheck).toHaveBeenCalledWith('user-id', 'content-id');
    });

    it('should return null when user lacks permission', async () => {
      const permissionCheck = jest.spyOn(permissions, 'checkContentEditPermission')
        .mockResolvedValue({ hasPermission: false, reason: 'No permission' });

      const token = await permissions.startEditingSession('user-id', 'content-id');
      
      expect(token).toBeNull();
      expect(permissionCheck).toHaveBeenCalledWith('user-id', 'content-id');
    });
  });

  describe('endEditingSession', () => {
    it('should end editing session successfully', async () => {
      mockSupabase.from.mockReturnValue({
        update: mockSupabase.update.mockReturnValue({
          eq: mockSupabase.eq.mockReturnValue({
            is: mockSupabase.is.mockResolvedValue({
              data: {},
              error: null,
            }),
          }),
        }),
      });

      const result = await permissions.endEditingSession('session-token');
      
      expect(result).toBe(true);
    });
  });

  describe('getActiveEditingSessions', () => {
    it('should return list of active editing sessions', async () => {
      const mockSessions = [
        {
          id: 'session1',
          user_id: 'user1',
          user: { email: 'user1@example.com' },
        },
        {
          id: 'session2',
          user_id: 'user2',
          user: { email: 'user2@example.com' },
        },
      ];

      mockSupabase.from.mockReturnValue({
        select: mockSupabase.select.mockReturnValue({
          eq: mockSupabase.eq.mockReturnValue({
            is: mockSupabase.is.mockReturnValue({
              gt: mockSupabase.gt.mockResolvedValue({
                data: mockSessions,
                error: null,
              }),
            }),
          }),
        }),
      });

      const sessions = await permissions.getActiveEditingSessions('content-id');
      
      expect(sessions).toEqual(mockSessions);
    });
  });
});