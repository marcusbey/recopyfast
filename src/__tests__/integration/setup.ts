import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock handlers for all API routes
export const handlers = [
  // Site registration
  http.post('/api/sites/register', async ({ request }) => {
    const body = await request.json() as { domain: string; name: string };
    
    if (!body.domain || !body.name) {
      return HttpResponse.json(
        { error: 'Domain and name are required' },
        { status: 400 }
      );
    }

    // Simulate domain already exists error
    if (body.domain === 'existing.com') {
      return HttpResponse.json(
        { error: 'Domain already registered' },
        { status: 400 }
      );
    }

    const siteId = `site-${Date.now()}`;
    const apiKey = 'test-api-key-' + Math.random().toString(36).substring(7);
    
    return HttpResponse.json({
      site: {
        id: siteId,
        domain: body.domain,
        name: body.name,
        created_at: new Date().toISOString()
      },
      apiKey,
      embedScript: `<script src="http://localhost:3000/embed/recopyfast.js" data-site-id="${siteId}"></script>`
    });
  }),

  // Content management
  http.get('/api/content/:siteId', ({ params, request }) => {
    const url = new URL(request.url);
    const language = url.searchParams.get('language') || 'en';
    const variant = url.searchParams.get('variant') || 'default';
    
    const mockContent = [
      {
        id: `content-1-${params.siteId}`,
        site_id: params.siteId,
        element_id: 'hero-title',
        selector: '#hero-title',
        original_content: 'Welcome to Our Site',
        current_content: 'Welcome to Our Site',
        language,
        variant,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { type: 'heading' }
      },
      {
        id: `content-2-${params.siteId}`,
        site_id: params.siteId,
        element_id: 'hero-subtitle',
        selector: '#hero-subtitle',
        original_content: 'We provide amazing services',
        current_content: 'We provide amazing services',
        language,
        variant,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { type: 'text' }
      }
    ];

    return HttpResponse.json(mockContent);
  }),

  http.post('/api/content/:siteId', async ({ params, request }) => {
    const contentMap = await request.json();
    
    // Simulate site not found
    if (params.siteId === 'nonexistent-site') {
      return HttpResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({ success: true });
  }),

  http.put('/api/content/:siteId', async ({ request }) => {
    const body = await request.json() as {
      elementId: string;
      content: string;
      language?: string;
      variant?: string;
    };

    // Simulate validation error
    if (!body.elementId || !body.content) {
      return HttpResponse.json(
        { error: 'ElementId and content are required' },
        { status: 400 }
      );
    }

    return HttpResponse.json({ success: true });
  }),

  // AI Translation
  http.post('/api/ai/translate', async ({ request }) => {
    const body = await request.json() as {
      siteId: string;
      fromLanguage: string;
      toLanguage: string;
      elements: Array<{ id: string; text: string }>;
      context?: string;
    };

    // Simulate validation error
    if (!body.siteId || !body.fromLanguage || !body.toLanguage || !body.elements) {
      return HttpResponse.json(
        { error: 'Missing required fields: siteId, fromLanguage, toLanguage, elements' },
        { status: 400 }
      );
    }

    // Simulate site not found
    if (body.siteId === 'nonexistent-site') {
      return HttpResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    // Simulate translation service error
    if (body.toLanguage === 'error-lang') {
      return HttpResponse.json(
        { error: 'Translation service unavailable' },
        { status: 500 }
      );
    }

    // Mock successful translation
    const translations = body.elements.map(element => ({
      id: element.id,
      originalText: element.text,
      translatedText: `[${body.toLanguage.toUpperCase()}] ${element.text}`
    }));

    return HttpResponse.json({
      success: true,
      translations,
      tokensUsed: 150,
      message: `Successfully translated ${translations.length} elements to ${body.toLanguage}`
    });
  }),

  // AI Suggestions
  http.post('/api/ai/suggest', async ({ request }) => {
    const body = await request.json() as {
      text: string;
      context: string;
      tone?: string;
      goal?: string;
    };

    // Simulate validation error
    if (!body.text || !body.context) {
      return HttpResponse.json(
        { error: 'Missing required fields: text, context' },
        { status: 400 }
      );
    }

    // Simulate AI service error
    if (body.text.includes('ERROR_TEXT')) {
      return HttpResponse.json(
        { error: 'AI service temporarily unavailable' },
        { status: 500 }
      );
    }

    // Mock suggestions based on goal
    const suggestions = [];
    const baseText = body.text;

    switch (body.goal) {
      case 'improve':
        suggestions.push(
          `Enhanced: ${baseText}`,
          `Improved version of: ${baseText}`,
          `Better: ${baseText}`
        );
        break;
      case 'shorten':
        suggestions.push(
          baseText.split(' ').slice(0, 3).join(' '),
          baseText.substring(0, baseText.length / 2),
          `Brief: ${baseText.split(' ')[0]}`
        );
        break;
      case 'expand':
        suggestions.push(
          `${baseText} with additional details and context`,
          `Expanded version: ${baseText} including more information`,
          `${baseText} - comprehensive version with extra content`
        );
        break;
      default:
        suggestions.push(
          `Optimized: ${baseText}`,
          `Enhanced for engagement: ${baseText}`,
          `Improved version: ${baseText}`
        );
    }

    return HttpResponse.json({
      success: true,
      suggestions,
      tokensUsed: 75,
      originalText: baseText
    });
  })
];

// Setup MSW server
export const server = setupServer(...handlers);

// Test utilities
export const mockFetch = (url: string, options: RequestInit = {}) => {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
};

export const createMockSite = (overrides: Partial<any> = {}) => ({
  id: 'test-site-id',
  domain: 'test.com',
  name: 'Test Site',
  api_key: 'test-api-key',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

export const createMockContentElement = (overrides: Partial<any> = {}) => ({
  id: 'test-content-1',
  site_id: 'test-site-id',
  element_id: 'test-element',
  selector: '#test-element',
  original_content: 'Original test content',
  current_content: 'Current test content',
  language: 'en',
  variant: 'default',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  metadata: { type: 'text' },
  ...overrides,
});

export const waitFor = (condition: () => boolean, timeout = 5000): Promise<void> => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(check, 100);
      }
    };
    
    check();
  });
};

// Mock WebSocket for real-time features
export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  
  url: string;
  readyState: number = 1; // OPEN
  onopen?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  onclose?: (event: CloseEvent) => void;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    
    // Simulate connection opening
    setTimeout(() => {
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 100);
  }

  send(data: string) {
    // Simulate echo response
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage(new MessageEvent('message', { data }));
      }
    }, 50);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  static mockImplementation() {
    global.WebSocket = MockWebSocket as any;
  }

  static cleanup() {
    MockWebSocket.instances.forEach(ws => ws.close());
    MockWebSocket.instances = [];
  }
}

// This file is just utilities and doesn't need its own tests
// The describe block below ensures Jest sees this as a valid test file
describe('Integration Test Setup', () => {
  it('should export MSW server and utilities', () => {
    expect(server).toBeDefined();
    expect(handlers).toBeDefined();
    expect(MockWebSocket).toBeDefined();
    expect(mockFetch).toBeDefined();
  });
});