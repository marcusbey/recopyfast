// Mock dependencies first before any imports
jest.mock('@/lib/ai/openai-service', () => ({
  aiService: {
    batchTranslate: jest.fn(),
    translateText: jest.fn(),
    generateContentSuggestion: jest.fn(),
    detectLanguage: jest.fn(),
  },
}));
jest.mock('@/lib/supabase/server');

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/ai/translate/route';
import { aiService } from '@/lib/ai/openai-service';
import { createClient } from '@/lib/supabase/server';

const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  upsert: jest.fn().mockReturnThis(),
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockAiService = aiService as jest.Mocked<typeof aiService>;

describe('/api/ai/translate - POST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase as ReturnType<typeof createClient>);
  });

  it('should successfully translate elements', async () => {
    const mockElements = [
      { id: 'header-1', text: 'Welcome to our website' },
      { id: 'btn-1', text: 'Get Started' },
    ];

    const mockTranslations = [
      { 
        id: 'header-1', 
        originalText: 'Welcome to our website', 
        translatedText: 'Bienvenido a nuestro sitio web' 
      },
      { 
        id: 'btn-1', 
        originalText: 'Get Started', 
        translatedText: 'Empezar' 
      },
    ];

    // Mock site verification
    mockSupabase.single.mockResolvedValueOnce({ 
      data: { id: 'site-123' }, 
      error: null 
    });

    // Mock AI service
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: mockTranslations,
      tokensUsed: 150,
    });

    // Mock database upsert
    mockSupabase.upsert.mockResolvedValueOnce({ error: null });

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'site-123',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: mockElements,
        context: 'website homepage',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      translations: mockTranslations,
      tokensUsed: 150,
      message: 'Successfully translated 2 elements to es',
    });

    // Verify AI service call
    expect(mockAiService.batchTranslate).toHaveBeenCalledWith(
      mockElements,
      'en',
      'es',
      'website homepage'
    );

    // Verify database upsert
    expect(mockSupabase.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          site_id: 'site-123',
          element_id: 'header-1',
          original_content: 'Welcome to our website',
          current_content: 'Bienvenido a nuestro sitio web',
          language: 'es',
          variant: 'default',
          metadata: {
            translatedFrom: 'en',
            aiGenerated: true,
            tokensUsed: 150,
          },
        }),
      ]),
      { onConflict: 'site_id,element_id,language,variant' }
    );
  });

  it('should return 400 when required fields are missing', async () => {
    const testCases = [
      { siteId: 'site-123', fromLanguage: 'en', toLanguage: 'es' }, // missing elements
      { fromLanguage: 'en', toLanguage: 'es', elements: [] }, // missing siteId
      { siteId: 'site-123', toLanguage: 'es', elements: [] }, // missing fromLanguage
      { siteId: 'site-123', fromLanguage: 'en', elements: [] }, // missing toLanguage
    ];

    for (const testCase of testCases) {
      const request = new NextRequest('http://localhost/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify(testCase),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Missing required fields: siteId, fromLanguage, toLanguage, elements',
      });
    }
  });

  it('should return 404 when site not found', async () => {
    // Mock site verification failure
    mockSupabase.single.mockResolvedValueOnce({ 
      data: null, 
      error: null 
    });

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'non-existent-site',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: [{ id: 'test', text: 'test' }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: 'Site not found',
    });
  });

  it('should return 500 when AI service fails', async () => {
    // Mock site verification
    mockSupabase.single.mockResolvedValueOnce({ 
      data: { id: 'site-123' }, 
      error: null 
    });

    // Mock AI service failure
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: false,
      error: 'OpenAI API error',
    });

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'site-123',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: [{ id: 'test', text: 'test' }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'OpenAI API error',
    });
  });

  it('should still return success when database save fails', async () => {
    const mockElements = [
      { id: 'header-1', text: 'Welcome' },
    ];

    const mockTranslations = [
      { 
        id: 'header-1', 
        originalText: 'Welcome', 
        translatedText: 'Bienvenido' 
      },
    ];

    // Mock site verification
    mockSupabase.single.mockResolvedValueOnce({ 
      data: { id: 'site-123' }, 
      error: null 
    });

    // Mock AI service success
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: mockTranslations,
      tokensUsed: 50,
    });

    // Mock database upsert failure
    mockSupabase.upsert.mockResolvedValueOnce({ 
      error: { message: 'Database error' }
    });

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'site-123',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: mockElements,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      translations: mockTranslations,
      tokensUsed: 50,
      message: 'Successfully translated 1 elements to es',
    });
  });

  it('should handle translation without context', async () => {
    const mockElements = [
      { id: 'test', text: 'Hello' },
    ];

    // Mock site verification
    mockSupabase.single.mockResolvedValueOnce({ 
      data: { id: 'site-123' }, 
      error: null 
    });

    // Mock AI service
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'test', originalText: 'Hello', translatedText: 'Hola' }],
      tokensUsed: 25,
    });

    // Mock database upsert
    mockSupabase.upsert.mockResolvedValueOnce({ error: null });

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'site-123',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: mockElements,
        // No context provided
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockAiService.batchTranslate).toHaveBeenCalledWith(
      mockElements,
      'en',
      'es',
      undefined
    );
  });

  it('should handle empty elements array', async () => {
    // Mock site verification
    mockSupabase.single.mockResolvedValueOnce({ 
      data: { id: 'site-123' }, 
      error: null 
    });

    // Mock AI service
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: true,
      data: [],
      tokensUsed: 0,
    });

    // Mock database upsert
    mockSupabase.upsert.mockResolvedValueOnce({ error: null });

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'site-123',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: [],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      translations: [],
      tokensUsed: 0,
      message: 'Successfully translated 0 elements to es',
    });
  });

  it('should handle malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api/ai/translate', {
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

  it('should handle unsupported language codes', async () => {
    // Mock site verification
    mockSupabase.single.mockResolvedValueOnce({ 
      data: { id: 'site-123' }, 
      error: null 
    });

    // Mock AI service failure for unsupported language
    mockAiService.batchTranslate.mockResolvedValueOnce({
      success: false,
      error: 'Unsupported language: xyz',
    });

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'site-123',
        fromLanguage: 'en',
        toLanguage: 'xyz',
        elements: [{ id: 'test', text: 'test' }],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Unsupported language: xyz',
    });
  });

  it('should handle AI service exception', async () => {
    // Mock site verification
    mockSupabase.single.mockResolvedValueOnce({ 
      data: { id: 'site-123' }, 
      error: null 
    });

    // Mock AI service throwing an exception
    mockAiService.batchTranslate.mockRejectedValueOnce(new Error('Network error'));

    const request = new NextRequest('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({
        siteId: 'site-123',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: [{ id: 'test', text: 'test' }],
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