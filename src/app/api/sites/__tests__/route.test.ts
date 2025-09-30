import { GET } from '../route';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

// Mock Supabase clients
jest.mock('@/lib/supabase/server');
jest.mock('@/lib/supabase/service');
jest.mock('@/lib/security/site-auth');

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockCreateServiceRoleClient = createServiceRoleClient as jest.MockedFunction<
  typeof createServiceRoleClient
>;

describe('GET /api/sites', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  };

  const mockSites = [
    {
      id: 'site-1',
      domain: 'example.com',
      name: 'Example Site',
      api_key: 'test-api-key-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
    },
  ];

  const mockPermissions = [
    {
      site_id: 'site-1',
      permission: 'admin',
    },
  ];

  let mockSupabaseClient: any;
  let mockServiceClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Supabase client
    mockSupabaseClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: mockUser },
          error: null,
        }),
      },
    };

    // Mock service client with chainable methods
    mockServiceClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
    };

    mockCreateClient.mockResolvedValue(mockSupabaseClient as any);
    mockCreateServiceRoleClient.mockReturnValue(mockServiceClient);
  });

  it('returns sites for authenticated user', async () => {
    // Setup mock responses
    mockServiceClient.select.mockResolvedValueOnce({
      data: mockPermissions,
      error: null,
    });

    mockServiceClient.in.mockResolvedValueOnce({
      data: mockSites,
      error: null,
    });

    // Mock count queries for stats
    mockServiceClient.eq.mockResolvedValue({
      count: 0,
    });

    mockServiceClient.single.mockResolvedValue({
      data: null,
      error: null,
    });

    const request = new NextRequest('http://localhost:3000/api/sites');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sites).toBeDefined();
    expect(Array.isArray(data.sites)).toBe(true);
  });

  it('returns 401 for unauthenticated users', async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const request = new NextRequest('http://localhost:3000/api/sites');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns empty array when user has no sites', async () => {
    mockServiceClient.select.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const request = new NextRequest('http://localhost:3000/api/sites');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sites).toEqual([]);
  });

  it('handles database errors gracefully', async () => {
    mockServiceClient.select.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database error' },
    });

    const request = new NextRequest('http://localhost:3000/api/sites');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch site permissions');
  });

  it('includes site statistics in response', async () => {
    mockServiceClient.select.mockResolvedValueOnce({
      data: mockPermissions,
      error: null,
    });

    mockServiceClient.in.mockResolvedValueOnce({
      data: mockSites,
      error: null,
    });

    // Mock stats queries
    mockServiceClient.eq.mockResolvedValueOnce({ count: 5 }); // elements count
    mockServiceClient.in.mockResolvedValueOnce({ count: 10 }); // edits count
    mockServiceClient.single.mockResolvedValueOnce({
      data: { created_at: '2024-01-15T00:00:00Z' },
      error: null,
    });

    const request = new NextRequest('http://localhost:3000/api/sites');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sites[0].stats).toBeDefined();
  });

  it('includes embed script in response', async () => {
    mockServiceClient.select.mockResolvedValueOnce({
      data: mockPermissions,
      error: null,
    });

    mockServiceClient.in.mockResolvedValueOnce({
      data: mockSites,
      error: null,
    });

    // Mock stats queries
    mockServiceClient.eq.mockResolvedValue({ count: 0 });
    mockServiceClient.single.mockResolvedValue({
      data: null,
      error: null,
    });

    const request = new NextRequest('http://localhost:3000/api/sites');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sites[0].embedScript).toBeDefined();
    expect(data.sites[0].embedScript).toContain('recopyfast.js');
  });
});