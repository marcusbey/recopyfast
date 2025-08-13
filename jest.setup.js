import '@testing-library/jest-dom'
import 'whatwg-fetch'

// Polyfill TextEncoder/TextDecoder for Node.js 
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

// Polyfill TransformStream for Node.js (required by MSW)
if (typeof global.TransformStream === 'undefined') {
  const { TransformStream } = require('node:stream/web')
  global.TransformStream = TransformStream
}

// Polyfill BroadcastChannel for Node.js (required by MSW)
if (typeof global.BroadcastChannel === 'undefined') {
  global.BroadcastChannel = class BroadcastChannel {
    constructor(name) {
      this.name = name
    }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
}

// MSW Setup for Integration Tests
let server
if (process.env.NODE_ENV === 'test') {
  try {
    const { server: mswServer } = require('./src/__tests__/integration/setup')
    server = mswServer
    
    // Start server before all tests
    beforeAll(() => server?.listen())
    
    // Reset handlers after each test  
    afterEach(() => server?.resetHandlers())
    
    // Clean up after all tests
    afterAll(() => server?.close())
  } catch (error) {
    // MSW setup not available, continue without it
    console.warn('MSW setup not available for integration tests')
  }
}

// Polyfill URL and URLSearchParams for Node.js compatibility  
if (typeof global.URL === 'undefined') {
  global.URL = require('url').URL
}

if (typeof global.URLSearchParams === 'undefined') {
  global.URLSearchParams = require('url').URLSearchParams
}

// Mock Next.js server components
jest.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    constructor(url, init) {
      this.url = url
      this.nextUrl = new URL(url)
      this.method = init?.method || 'GET'
      this.headers = new Headers(init?.headers)
      this.body = init?.body
    }
    
    async json() {
      return JSON.parse(this.body || '{}')
    }
  },
  NextResponse: {
    json: (data, init) => ({
      json: () => Promise.resolve(data),
      status: init?.status || 200,
      headers: new Headers(init?.headers),
      ok: (init?.status || 200) >= 200 && (init?.status || 200) < 300,
      _data: data,
      _status: init?.status || 200,
    }),
  },
}))

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
    }
  },
  usePathname() {
    return ''
  },
  useSearchParams() {
    return new URLSearchParams()
  },
}))

// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.OPENAI_API_KEY = 'test-openai-key'

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockImplementation(() => Promise.resolve()),
    readText: jest.fn().mockImplementation(() => Promise.resolve('')),
  },
})

// Global test utilities
global.createMockElement = (id, content = 'Test content') => ({
  id,
  site_id: 'test-site',
  element_id: id,
  selector: `#${id}`,
  original_content: content,
  current_content: content,
  language: 'en',
  variant: 'default',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})

global.createMockSite = (domain = 'test.com') => ({
  id: 'test-site-id',
  domain,
  name: 'Test Site',
  api_key: 'test-api-key',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})