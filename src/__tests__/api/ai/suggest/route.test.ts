import { NextRequest } from 'next/server';
import { POST } from '@/app/api/ai/suggest/route';
import { aiService } from '@/lib/ai/openai-service';

// Mock dependencies
jest.mock('@/lib/ai/openai-service');

const mockAiService = aiService as jest.Mocked<typeof aiService>;

describe('/api/ai/suggest - POST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully generate content suggestions', async () => {
    const mockSuggestions = [
      'Transform your business with our innovative solutions',
      'Revolutionize your workflow with cutting-edge technology',
      'Elevate your operations with advanced digital tools',
    ];

    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: true,
      data: mockSuggestions,
      tokensUsed: 75,
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Improve your business',
        context: 'homepage hero section',
        tone: 'professional',
        goal: 'improve',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      suggestions: mockSuggestions,
      tokensUsed: 75,
      originalText: 'Improve your business',
    });

    expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
      originalText: 'Improve your business',
      context: 'homepage hero section',
      tone: 'professional',
      goal: 'improve',
    });
  });

  it('should use default tone and goal when not provided', async () => {
    const mockSuggestions = ['Default suggestion'];

    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: true,
      data: mockSuggestions,
      tokensUsed: 50,
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Sample text',
        context: 'button text',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
      originalText: 'Sample text',
      context: 'button text',
      tone: 'professional',
      goal: 'improve',
    });
  });

  it('should return 400 when text is missing', async () => {
    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        context: 'button text',
        tone: 'professional',
        goal: 'improve',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Missing required fields: text, context',
    });
  });

  it('should return 400 when context is missing', async () => {
    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Sample text',
        tone: 'professional',
        goal: 'improve',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Missing required fields: text, context',
    });
  });

  it('should return 400 when both text and context are missing', async () => {
    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        tone: 'professional',
        goal: 'improve',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Missing required fields: text, context',
    });
  });

  it('should handle empty strings as missing fields', async () => {
    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: '',
        context: 'button text',
        tone: 'professional',
        goal: 'improve',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Missing required fields: text, context',
    });
  });

  it('should return 500 when AI service fails', async () => {
    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: false,
      error: 'OpenAI API rate limit exceeded',
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Sample text',
        context: 'button text',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'OpenAI API rate limit exceeded',
    });
  });

  it('should handle different tone options', async () => {
    const tones = ['professional', 'casual', 'marketing', 'technical'] as const;
    
    for (const tone of tones) {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: [`${tone} suggestion`],
        tokensUsed: 25,
      });

      const request = new NextRequest('http://localhost/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Sample text',
          context: 'test context',
          tone,
          goal: 'improve',
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(200);
      expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
        originalText: 'Sample text',
        context: 'test context',
        tone,
        goal: 'improve',
      });
    }
  });

  it('should handle different goal options', async () => {
    const goals = ['improve', 'shorten', 'expand', 'optimize'] as const;
    
    for (const goal of goals) {
      mockAiService.generateContentSuggestion.mockResolvedValueOnce({
        success: true,
        data: [`${goal} suggestion`],
        tokensUsed: 25,
      });

      const request = new NextRequest('http://localhost/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Sample text',
          context: 'test context',
          tone: 'professional',
          goal,
        }),
      });

      const response = await POST(request);
      
      expect(response.status).toBe(200);
      expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
        originalText: 'Sample text',
        context: 'test context',
        tone: 'professional',
        goal,
      });
    }
  });

  it('should handle invalid tone gracefully', async () => {
    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: true,
      data: ['Suggestion with invalid tone'],
      tokensUsed: 30,
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Sample text',
        context: 'test context',
        tone: 'invalid-tone',
        goal: 'improve',
      }),
    });

    const response = await POST(request);
    
    expect(response.status).toBe(200);
    expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
      originalText: 'Sample text',
      context: 'test context',
      tone: 'invalid-tone',
      goal: 'improve',
    });
  });

  it('should handle invalid goal gracefully', async () => {
    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: true,
      data: ['Suggestion with invalid goal'],
      tokensUsed: 30,
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Sample text',
        context: 'test context',
        tone: 'professional',
        goal: 'invalid-goal',
      }),
    });

    const response = await POST(request);
    
    expect(response.status).toBe(200);
    expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
      originalText: 'Sample text',
      context: 'test context',
      tone: 'professional',
      goal: 'invalid-goal',
    });
  });

  it('should handle malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api/ai/suggest', {
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

  it('should handle AI service throwing an exception', async () => {
    mockAiService.generateContentSuggestion.mockRejectedValueOnce(new Error('Network timeout'));

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Sample text',
        context: 'test context',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Internal server error',
    });
  });

  it('should handle empty suggestions from AI service', async () => {
    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: true,
      data: [],
      tokensUsed: 20,
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Sample text',
        context: 'test context',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      suggestions: [],
      tokensUsed: 20,
      originalText: 'Sample text',
    });
  });

  it('should handle long text input', async () => {
    const longText = 'A'.repeat(1000);
    
    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: true,
      data: ['Shortened version of very long text'],
      tokensUsed: 200,
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: longText,
        context: 'article content',
        goal: 'shorten',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.originalText).toBe(longText);
    expect(mockAiService.generateContentSuggestion).toHaveBeenCalledWith({
      originalText: longText,
      context: 'article content',
      tone: 'professional',
      goal: 'shorten',
    });
  });

  it('should handle unicode and special characters', async () => {
    const unicodeText = '🚀 Innovación tecnológica para empresas modernas';
    
    mockAiService.generateContentSuggestion.mockResolvedValueOnce({
      success: true,
      data: ['🌟 Soluciones tecnológicas avanzadas para negocios'],
      tokensUsed: 40,
    });

    const request = new NextRequest('http://localhost/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({
        text: unicodeText,
        context: 'Spanish website header',
        tone: 'marketing',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.originalText).toBe(unicodeText);
  });
});