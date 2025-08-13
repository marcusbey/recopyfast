import { NextRequest } from 'next/server';
import { POST } from '@/app/api/sites/register/route';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

// Mock dependencies
jest.mock('@/lib/supabase/server');
jest.mock('crypto');

const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  insert: jest.fn().mockReturnThis(),
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockCrypto = crypto as jest.Mocked<typeof crypto>;

describe('/api/sites/register - POST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase as ReturnType<typeof createClient>);
    
    // Mock crypto.randomBytes to return a buffer that toString('hex') gives our expected string
    const mockBuffer = {
      toString: jest.fn().mockReturnValue('test-api-key')
    };
    mockCrypto.randomBytes.mockReturnValue(mockBuffer as Buffer);
    
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
    };

    // Mock domain check (not exists)
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: null });
    
    // Mock site creation
    mockSupabase.single.mockResolvedValueOnce({ 
      data: mockSite, 
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

    expect(response.status).toBe(200);
    expect(data).toEqual({
      site: {
        id: 'site-123',
        domain: 'example.com',
        name: 'Example Site',
        created_at: '2024-01-01T00:00:00Z',
      },
      apiKey: 'test-api-key',
      embedScript: '<script src="https://recopyfast.com/embed/recopyfast.js" data-site-id="site-123"></script>',
    });

    // Verify database calls
    expect(mockSupabase.from).toHaveBeenCalledWith('sites');
    expect(mockSupabase.select).toHaveBeenCalledWith('id');
    expect(mockSupabase.eq).toHaveBeenCalledWith('domain', 'example.com');
    expect(mockSupabase.insert).toHaveBeenCalledWith({
      domain: 'example.com',
      name: 'Example Site',
      api_key: 'test-api-key',
    });
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
    mockSupabase.single.mockResolvedValueOnce({ 
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
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: null });
    
    // Mock site creation failure
    mockSupabase.single.mockResolvedValueOnce({ 
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

  it('should generate unique API keys for each registration', async () => {
    const mockSite = {
      id: 'site-123',
      domain: 'example.com',
      name: 'Example Site',
      created_at: '2024-01-01T00:00:00Z',
    };

    // First call
    const mockBuffer1 = { toString: jest.fn().mockReturnValue('api-key-1') };
    mockCrypto.randomBytes.mockReturnValueOnce(mockBuffer1 as Buffer);
    mockSupabase.single
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: mockSite, error: null });

    const request1 = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'example1.com',
        name: 'Example Site 1',
      }),
    });

    const response1 = await POST(request1);
    const data1 = await response1.json();

    // Second call
    const mockBuffer2 = { toString: jest.fn().mockReturnValue('api-key-2') };
    mockCrypto.randomBytes.mockReturnValueOnce(mockBuffer2 as Buffer);
    mockSupabase.single
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { ...mockSite, domain: 'example2.com' }, error: null });

    const request2 = new NextRequest('http://localhost/api/sites/register', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'example2.com',
        name: 'Example Site 2',
      }),
    });

    const response2 = await POST(request2);
    const data2 = await response2.json();

    expect(data1.apiKey).toBe('api-key-1');
    expect(data2.apiKey).toBe('api-key-2');
    expect(mockCrypto.randomBytes).toHaveBeenCalledTimes(2);
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