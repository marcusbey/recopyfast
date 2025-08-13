import { NextRequest } from 'next/server';
import { GET, POST, PUT } from '@/app/api/content/[siteId]/route';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
jest.mock('@/lib/supabase/server');

const mockSupabase = {
  from: jest.fn(() => mockSupabase),
  select: jest.fn(() => mockSupabase),
  eq: jest.fn(() => mockSupabase),
  single: jest.fn(),
  insert: jest.fn(() => mockSupabase),
  upsert: jest.fn(),
  update: jest.fn(() => mockSupabase),
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('/api/content/[siteId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase as unknown as ReturnType<typeof createClient>);
  });

  describe('GET', () => {
    const mockContentElements = [
      {
        id: 1,
        site_id: 'site-123',
        element_id: 'header-1',
        selector: 'h1',
        original_content: 'Welcome',
        current_content: 'Welcome',
        language: 'en',
        variant: 'default',
        metadata: { type: 'text' },
      },
      {
        id: 2,
        site_id: 'site-123',
        element_id: 'btn-1',
        selector: '.btn-primary',
        original_content: 'Click here',
        current_content: 'Click here',
        language: 'en',
        variant: 'default',
        metadata: { type: 'button' },
      },
    ];

    it('should fetch content elements with default parameters', async () => {
      // Mock the final method in the chain to return the promise
      
      // The third eq() call should return the final promise
      mockSupabase.eq
        .mockReturnValueOnce(mockSupabase) // first eq (site_id)
        .mockReturnValueOnce(mockSupabase) // second eq (language)
        .mockResolvedValueOnce({ data: mockContentElements, error: null }); // third eq (variant) returns result

      const request = new NextRequest('http://localhost/api/content/site-123');
      const response = await GET(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockContentElements);
      
      expect(mockSupabase.from).toHaveBeenCalledWith('content_elements');
      expect(mockSupabase.select).toHaveBeenCalledWith('*');
      expect(mockSupabase.eq).toHaveBeenCalledWith('site_id', 'site-123');
      expect(mockSupabase.eq).toHaveBeenCalledWith('language', 'en');
      expect(mockSupabase.eq).toHaveBeenCalledWith('variant', 'default');
    });

    it('should fetch content elements with custom language and variant', async () => {
      mockSupabase.eq
        .mockReturnValueOnce(mockSupabase) // first eq (site_id)
        .mockReturnValueOnce(mockSupabase) // second eq (language)
        .mockResolvedValueOnce({ data: mockContentElements, error: null }); // third eq (variant) returns result

      const request = new NextRequest('http://localhost/api/content/site-123?language=es&variant=mobile');
      const response = await GET(request, { params: { siteId: 'site-123' } });

      expect(response.status).toBe(200);
      expect(mockSupabase.eq).toHaveBeenCalledWith('language', 'es');
      expect(mockSupabase.eq).toHaveBeenCalledWith('variant', 'mobile');
    });

    it('should return empty array when no content found', async () => {
      mockSupabase.eq
        .mockReturnValueOnce(mockSupabase) // first eq (site_id)
        .mockReturnValueOnce(mockSupabase) // second eq (language)
        .mockResolvedValueOnce({ data: null, error: null }); // third eq (variant) returns result

      const request = new NextRequest('http://localhost/api/content/site-123');
      const response = await GET(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual([]);
    });

    it('should return 500 on database error', async () => {
      mockSupabase.eq
        .mockReturnValueOnce(mockSupabase) // first eq (site_id)
        .mockReturnValueOnce(mockSupabase) // second eq (language)
        .mockResolvedValueOnce({ data: null, error: { message: 'Database error' } }); // third eq (variant) returns error

      const request = new NextRequest('http://localhost/api/content/site-123');
      const response = await GET(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Failed to fetch content',
      });
    });

    it('should handle internal server error', async () => {
      mockCreateClient.mockRejectedValueOnce(new Error('Connection failed'));

      const request = new NextRequest('http://localhost/api/content/site-123');
      const response = await GET(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });
  });

  describe('POST', () => {
    const mockContentMap = {
      'header-1': {
        selector: 'h1',
        content: 'Welcome to our site',
        type: 'text',
      },
      'btn-1': {
        selector: '.btn-primary',
        content: 'Get Started',
        type: 'button',
      },
    };

    it('should successfully save content map', async () => {
      // Mock site verification
      mockSupabase.single.mockResolvedValueOnce({ 
        data: { id: 'site-123' }, 
        error: null 
      });

      // Mock upsert success
      mockSupabase.upsert.mockResolvedValueOnce({ error: null });

      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'POST',
        body: JSON.stringify(mockContentMap),
      });

      const response = await POST(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      expect(mockSupabase.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            site_id: 'site-123',
            element_id: 'header-1',
            selector: 'h1',
            original_content: 'Welcome to our site',
            current_content: 'Welcome to our site',
            language: 'en',
            variant: 'default',
            metadata: { type: 'text' },
          }),
          expect.objectContaining({
            site_id: 'site-123',
            element_id: 'btn-1',
            selector: '.btn-primary',
            original_content: 'Get Started',
            current_content: 'Get Started',
            language: 'en',
            variant: 'default',
            metadata: { type: 'button' },
          }),
        ]),
        { onConflict: 'site_id,element_id,language,variant' }
      );
    });

    it('should return 404 when site not found', async () => {
      // Mock site verification failure
      mockSupabase.single.mockResolvedValueOnce({ 
        data: null, 
        error: null 
      });

      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'POST',
        body: JSON.stringify(mockContentMap),
      });

      const response = await POST(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        error: 'Site not found',
      });
    });

    it('should return 500 on upsert error', async () => {
      // Mock site verification success
      mockSupabase.single.mockResolvedValueOnce({ 
        data: { id: 'site-123' }, 
        error: null 
      });

      // Mock upsert failure
      mockSupabase.upsert.mockResolvedValueOnce({ 
        error: { message: 'Upsert failed' }
      });

      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'POST',
        body: JSON.stringify(mockContentMap),
      });

      const response = await POST(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Failed to save content',
      });
    });

    it('should handle empty content map', async () => {
      // Mock site verification
      mockSupabase.single.mockResolvedValueOnce({ 
        data: { id: 'site-123' }, 
        error: null 
      });

      // Mock upsert success
      mockSupabase.upsert.mockResolvedValueOnce({ error: null });

      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });
      expect(mockSupabase.upsert).toHaveBeenCalledWith([], expect.any(Object));
    });

    it('should handle malformed JSON', async () => {
      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'POST',
        body: 'invalid-json',
      });

      const response = await POST(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });
  });

  describe('PUT', () => {
    it('should successfully update content element', async () => {
      // Mock the chain: update().eq().eq().eq().eq()
      mockSupabase.eq
        .mockReturnValueOnce(mockSupabase) // first eq (site_id)
        .mockReturnValueOnce(mockSupabase) // second eq (element_id)
        .mockReturnValueOnce(mockSupabase) // third eq (language)
        .mockResolvedValueOnce({ error: null }); // fourth eq (variant) returns result

      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'PUT',
        body: JSON.stringify({
          elementId: 'header-1',
          content: 'Updated welcome message',
          language: 'en',
          variant: 'default',
        }),
      });

      const response = await PUT(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      expect(mockSupabase.from).toHaveBeenCalledWith('content_elements');
      expect(mockSupabase.update).toHaveBeenCalledWith({ 
        current_content: 'Updated welcome message' 
      });
      expect(mockSupabase.eq).toHaveBeenCalledWith('site_id', 'site-123');
      expect(mockSupabase.eq).toHaveBeenCalledWith('element_id', 'header-1');
      expect(mockSupabase.eq).toHaveBeenCalledWith('language', 'en');
      expect(mockSupabase.eq).toHaveBeenCalledWith('variant', 'default');
    });

    it('should use default language and variant when not provided', async () => {
      mockSupabase.eq
        .mockReturnValueOnce(mockSupabase) // first eq (site_id)
        .mockReturnValueOnce(mockSupabase) // second eq (element_id)
        .mockReturnValueOnce(mockSupabase) // third eq (language)
        .mockResolvedValueOnce({ error: null }); // fourth eq (variant) returns result

      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'PUT',
        body: JSON.stringify({
          elementId: 'header-1',
          content: 'Updated welcome message',
        }),
      });

      const response = await PUT(request, { params: { siteId: 'site-123' } });

      expect(response.status).toBe(200);
      expect(mockSupabase.eq).toHaveBeenCalledWith('language', 'en');
      expect(mockSupabase.eq).toHaveBeenCalledWith('variant', 'default');
    });

    it('should return 500 on update error', async () => {
      mockSupabase.eq
        .mockReturnValueOnce(mockSupabase) // first eq (site_id)
        .mockReturnValueOnce(mockSupabase) // second eq (element_id)
        .mockReturnValueOnce(mockSupabase) // third eq (language)
        .mockResolvedValueOnce({ error: { message: 'Update failed' } }); // fourth eq (variant) returns error

      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'PUT',
        body: JSON.stringify({
          elementId: 'header-1',
          content: 'Updated welcome message',
        }),
      });

      const response = await PUT(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Failed to update content',
      });
    });

    it('should handle missing elementId', async () => {
      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'PUT',
        body: JSON.stringify({
          content: 'Updated welcome message',
        }),
      });

      const response = await PUT(request, { params: { siteId: 'site-123' } });

      expect(response.status).toBe(200); // The API doesn't validate required fields
      expect(mockSupabase.eq).toHaveBeenCalledWith('element_id', undefined);
    });

    it('should handle malformed JSON', async () => {
      const request = new NextRequest('http://localhost/api/content/site-123', {
        method: 'PUT',
        body: 'invalid-json',
      });

      const response = await PUT(request, { params: { siteId: 'site-123' } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });
  });
});