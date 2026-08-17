import '@testing-library/jest-dom'
import 'whatwg-fetch'

// Polyfill TextEncoder/TextDecoder for Node.js
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

// Polyfill setImmediate for jsdom, which omits it.
//
// Winston's transport queue calls it, so `logger.info` THROWS under jsdom —
// which meant any route that logs on its success path could only ever reach its
// outer catch and answer 503 in a test. That is not theoretical: it is why
// `src/__tests__/api/health/route.test.ts` asserted `[200, 503]` and passed on
// the 503 for as long as it existed, verifying nothing about a healthy handler.
// Both routes return their real status once logging works.
if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args)
  global.clearImmediate = (id) => clearTimeout(id)
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

// NOTE: MSW is deliberately NOT started here. Starting it globally makes
// @mswjs/interceptors replace `globalThis.fetch` in `beforeAll`, which runs
// *after* a suite's module body — clobbering every `global.fetch = jest.fn()`
// set at the top of a test file. Suites that want MSW call `server.listen()`
// themselves (see src/__tests__/integration/*).

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

    // The real NextRequest exposes the body as text too, and a route that has
    // to measure what it received before parsing it — bulk import refuses an
    // oversized file *before* `JSON.parse` — can only be written that way. The
    // mock omitting `text()` made that route untestable rather than wrong.
    async text() {
      return this.body || ''
    }
  },
  // Constructible, and faithful about which statuses may carry a body.
  //
  // This mock used to be a bare object exposing only `json`, which meant two
  // things it should not have meant. `new NextResponse(null, ...)` was not
  // possible at all, so route code written the correct way could not be
  // tested; and `NextResponse.json({}, { status: 204 })` happily returned a
  // 204 here while the real Response constructor throws "Invalid response
  // status code 204" on it, because 204, 205 and 304 forbid a body.
  //
  // The consequence was not theoretical. Every CORS preflight written that way
  // threw in production and was caught into a blanket 403, so the widget's
  // cross-origin content fetch never happened — and the unit test asserting
  // "returns 204" passed the whole time, because this mock said it did.
  // A mock that is more permissive than the runtime does not just fail to
  // catch a bug, it certifies the bug as correct.
  NextResponse: Object.assign(
    function NextResponse(body, init) {
      const status = init?.status || 200
      return {
        json: () => Promise.resolve(body),
        status,
        headers: new Headers(init?.headers),
        ok: status >= 200 && status < 300,
        _data: body,
        _status: status,
      }
    },
    {
      // Mirrors the real signature: 307 by default, destination in `Location`.
      // Absent entirely until now, so any route that redirects could not be
      // tested at all — which is why the auth confirm route had no coverage of
      // where it actually sends people.
      redirect: (url, status = 307) => ({
        json: () => Promise.resolve(null),
        status,
        headers: new Headers({ location: String(url) }),
        ok: false,
        _status: status,
      }),
      json: (data, init) => {
        const status = init?.status || 200
        if (status === 204 || status === 205 || status === 304) {
          throw new TypeError(`Invalid response status code ${status}`)
        }
        return {
          json: () => Promise.resolve(data),
          status,
          headers: new Headers(init?.headers),
          ok: status >= 200 && status < 300,
          _data: data,
          _status: status,
        }
      },
    },
  ),
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

// Browser-only globals, guarded.
//
// `testEnvironment` is jsdom for the whole project, but a suite may opt into the
// node environment with a `@jest-environment node` docblock — the realtime
// server harness has to, because it boots a real HTTP listener and drives it
// with socket.io-client, and jsdom's fetch/WebSocket shims get in the way of
// both. This file runs in `setupFilesAfterEach` for EVERY suite, so an
// unguarded `window`/`navigator` reference here makes any node-environment
// suite fail to run at all, with "ReferenceError: window is not defined"
// pointing at the setup file rather than at the test.
const hasBrowserGlobals = typeof window !== 'undefined'

// Mock window.matchMedia
if (hasBrowserGlobals) {
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
}

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
if (hasBrowserGlobals) {
  Object.assign(navigator, {
    clipboard: {
      writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      readText: jest.fn().mockImplementation(() => Promise.resolve('')),
    },
  })
}

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