import { NextRequest } from 'next/server';
import { POST } from '@/app/api/sites/register/route';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { buildSiteToken } from '@/lib/security/site-auth';

// Mock dependencies
jest.mock('@/lib/supabase/server');
jest.mock('@/lib/supabase/service');
jest.mock('@/lib/security/site-auth', () => {
  const actual = jest.requireActual('@/lib/security/site-auth');
  return {
    ...actual,
    buildSiteToken: jest.fn(),
  };
});

const mockServiceClient = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockReturnThis(),
};

const mockAuthClient = {
  auth: {
    getUser: jest.fn(),
  },
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockCreateServiceClient = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;
const mockBuildSiteToken = buildSiteToken as jest.MockedFunction<typeof buildSiteToken>;

describe('/api/sites/register - POST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockAuthClient as unknown as ReturnType<typeof createClient>);
    mockAuthClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
    mockCreateServiceClient.mockReturnValue(mockServiceClient as unknown as ReturnType<typeof createServiceRoleClient>);
    mockBuildSiteToken.mockReturnValue('signed-site-token');

    mockServiceClient.from.mockReturnThis();
    mockServiceClient.select.mockReturnThis();
    mockServiceClient.eq.mockReturnThis();
    mockServiceClient.insert.mockReturnThis();
    mockServiceClient.upsert.mockReturnThis();
    mockServiceClient.single.mockReset();
    mockServiceClient.upsert.mockResolvedValue({ error: null });
    
    // Mock environment variable
    process.env.NEXT_PUBLIC_APP_URL = 'https://recopyfast.com';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('should successfully register a new site', async () => {
    const mockSite = {
      id: 'site-123',
      domain: 'example.com',
      name: 'Example Site',
      created_at: '2024-01-01T00:00:00Z',
      api_key: 'raw-api-key',
    };

    // Mock domain check (not exists)
    mockServiceClient.single
      .mockResolvedValueOnce({ data: null, error: null }) // domain check
      .mockResolvedValueOnce({ data: mockSite, error: null }); // insert result
    
    mockBuildSiteToken.mockReturnValueOnce('signed-site-token');

    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'example.com',
        name: 'Example Site',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      site: {
        id: 'site-123',
        domain: 'example.com',
        name: 'Example Site',
        created_at: '2024-01-01T00:00:00Z',
      },
      apiKey: 'raw-api-key',
      siteToken: 'signed-site-token',
      embedScript: '<script src="https://recopyfast.com/embed/recopyfast.js" data-site-id="site-123" data-site-token="signed-site-token"></script>',
    });

    // Verify database calls
    expect(mockServiceClient.from).toHaveBeenNthCalledWith(1, 'sites');
    expect(mockServiceClient.select).toHaveBeenNthCalledWith(1, 'id');
    expect(mockServiceClient.eq).toHaveBeenNthCalledWith(1, 'domain', 'example.com');
    expect(mockServiceClient.insert).toHaveBeenCalledWith({
      domain: 'example.com',
      name: 'Example Site',
    });
    expect(mockServiceClient.select).toHaveBeenNthCalledWith(2, 'id, domain, name, created_at, api_key');
    expect(mockServiceClient.upsert).toHaveBeenCalledWith(
      {
        site_id: 'site-123',
        user_id: 'user-123',
        permission: 'admin',
      },
      { onConflict: 'user_id,site_id' }
    );
    expect(mockBuildSiteToken).toHaveBeenCalledWith('site-123', 'raw-api-key');
  });

  it('should return 400 when domain is missing', async () => {
    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Example Site',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Domain and name are required',
    });
  });

  it('should return 400 when name is missing', async () => {
    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'example.com',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Domain and name are required',
    });
  });

  it('should return 400 when domain already exists', async () => {
    // Mock domain check (exists)
    mockServiceClient.single.mockResolvedValueOnce({ 
      data: { id: 'existing-site' }, 
      error: null 
    });

    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'example.com',
        name: 'Example Site',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Domain already registered',
    });
  });

  it('should return 500 when database insertion fails', async () => {
    // Mock domain check (not exists)
    mockServiceClient.single
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ 
      data: null, 
      error: { message: 'Database error' }
      });

    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'example.com',
        name: 'Example Site',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Failed to create site',
    });
  });

  it('should return 500 on JSON parsing error', async () => {
    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: 'invalid-json',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Internal server error',
    });
  });

  it('should handle empty strings as missing fields', async () => {
    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: '',
        name: 'Example Site',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Domain and name are required',
    });
  });

  it('should handle supabase client creation failure', async () => {
    mockCreateClient.mockRejectedValueOnce(new Error('Supabase connection failed'));

    const request = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'example.com',
        name: 'Example Site',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Internal server error',
    });
  });
});
