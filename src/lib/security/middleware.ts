import { NextRequest, NextResponse } from 'next/server';
import { rateLimiter, createRateLimitConfig, abuseDetector } from './rate-limiter';
import { sanitizeJSONData } from './content-sanitizer';
import { extractDomainFromURL, isDomainWhitelisted } from './domain-verification';

export interface SecurityMiddlewareConfig {
  enableRateLimit?: boolean;
  enableContentSanitization?: boolean;
  enableDomainValidation?: boolean;
  enableAbuseDetection?: boolean;
  rateLimitConfig?: {
    windowMs: number;
    maxRequests: number;
  };
  whitelistedDomains?: string[];
  bypassRules?: {
    paths?: string[];
    methods?: string[];
    userAgents?: string[];
  };
}

export interface SecurityContext {
  request: NextRequest;
  identifier: string;
  identifierType: 'user' | 'ip' | 'api_key';
  endpoint: string;
  userAgent: string;
  ip: string;
  referrer?: string;
  origin?: string;
}

/**
 * Extract security context from request
 */
export function extractSecurityContext(request: NextRequest): SecurityContext {
  const ip = request.ip || 
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
    request.headers.get('x-real-ip') || 
    'unknown';

  const userAgent = request.headers.get('user-agent') || 'unknown';
  const referrer = request.headers.get('referer') || undefined;
  const origin = request.headers.get('origin') || undefined;
  const endpoint = new URL(request.url).pathname;

  // Determine identifier and type
  const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
  const userId = request.headers.get('x-user-id'); // Assuming user ID is passed in header

  let identifier: string;
  let identifierType: 'user' | 'ip' | 'api_key';

  if (apiKey) {
    identifier = apiKey;
    identifierType = 'api_key';
  } else if (userId) {
    identifier = userId;
    identifierType = 'user';
  } else {
    identifier = ip;
    identifierType = 'ip';
  }

  return {
    request,
    identifier,
    identifierType,
    endpoint,
    userAgent,
    ip,
    referrer,
    origin
  };
}

/**
 * Rate limiting middleware
 */
export async function applyRateLimit(
  context: SecurityContext,
  config: SecurityMiddlewareConfig
): Promise<NextResponse | null> {
  if (!config.enableRateLimit) return null;

  try {
    // Check if path should bypass rate limiting
    if (config.bypassRules?.paths?.some(path => context.endpoint.startsWith(path))) {
      return null;
    }

    // Create rate limit configuration
    const rateLimitConfig = createRateLimitConfig(
      context.identifier,
      context.identifierType,
      context.identifierType === 'api_key' ? 'API_KEY_DEFAULT' : 
      context.identifierType === 'user' ? 'USER_GENERAL' : 'IP_GENERAL',
      context.endpoint
    );

    // Override with custom config if provided
    if (config.rateLimitConfig) {
      rateLimitConfig.windowMs = config.rateLimitConfig.windowMs;
      rateLimitConfig.maxRequests = config.rateLimitConfig.maxRequests;
    }

    const result = await rateLimiter.checkLimit(rateLimitConfig);

    if (!result.allowed) {
      // Log rate limit exceeded event
      console.warn('Rate limit exceeded:', {
        identifier: context.identifier,
        identifierType: context.identifierType,
        endpoint: context.endpoint,
        ip: context.ip,
        userAgent: context.userAgent,
        remaining: result.remaining,
        resetTime: new Date(result.resetTime).toISOString()
      });

      return new NextResponse(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': rateLimitConfig.maxRequests.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(),
            'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString()
          }
        }
      );
    }

    // Add rate limit headers to successful responses
    return NextResponse.next({
      headers: {
        'X-RateLimit-Limit': rateLimitConfig.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString()
      }
    });

  } catch (error) {
    console.error('Rate limiting error:', error);
    // Continue without rate limiting on error
    return null;
  }
}

/**
 * Abuse detection middleware
 */
export async function checkAbuseDetection(
  context: SecurityContext,
  config: SecurityMiddlewareConfig
): Promise<NextResponse | null> {
  if (!config.enableAbuseDetection) return null;

  try {
    const detection = abuseDetector.detectRapidRequests(context.identifier);

    if (detection.shouldBan) {
      console.error('Suspicious activity detected - banning:', {
        identifier: context.identifier,
        identifierType: context.identifierType,
        endpoint: context.endpoint,
        ip: context.ip,
        userAgent: context.userAgent
      });

      return new NextResponse(
        JSON.stringify({
          error: 'Access denied',
          message: 'Suspicious activity detected. Access temporarily restricted.'
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    if (detection.isSuspicious) {
      console.warn('Suspicious activity detected:', {
        identifier: context.identifier,
        identifierType: context.identifierType,
        endpoint: context.endpoint,
        ip: context.ip
      });
    }

    return null;
  } catch (error) {
    console.error('Abuse detection error:', error);
    return null;
  }
}

/**
 * Domain validation middleware
 */
export async function validateDomain(
  context: SecurityContext,
  config: SecurityMiddlewareConfig
): Promise<NextResponse | null> {
  if (!config.enableDomainValidation || !config.whitelistedDomains) return null;

  try {
    // Only validate for embed endpoints or CORS requests
    const isEmbedRequest = context.endpoint.startsWith('/embed') || 
                          context.endpoint.startsWith('/api/content');

    if (!isEmbedRequest) return null;

    let domain: string | null = null;

    // Extract domain from origin or referrer
    if (context.origin) {
      domain = extractDomainFromURL(context.origin);
    } else if (context.referrer) {
      domain = extractDomainFromURL(context.referrer);
    }

    if (!domain) {
      return new NextResponse(
        JSON.stringify({
          error: 'Invalid request',
          message: 'Origin or referrer required for this endpoint'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    if (!isDomainWhitelisted(domain, config.whitelistedDomains)) {
      console.warn('Domain not whitelisted:', {
        domain,
        endpoint: context.endpoint,
        ip: context.ip,
        userAgent: context.userAgent
      });

      return new NextResponse(
        JSON.stringify({
          error: 'Unauthorized domain',
          message: 'Domain not authorized to access this resource'
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    return null;
  } catch (error) {
    console.error('Domain validation error:', error);
    return null;
  }
}

/**
 * Content sanitization middleware
 */
export async function sanitizeRequestContent(
  context: SecurityContext,
  config: SecurityMiddlewareConfig
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ sanitizedBody?: any; error?: NextResponse }> {
  if (!config.enableContentSanitization) return {};

  try {
    const request = context.request;
    const contentType = request.headers.get('content-type') || '';

    // Only sanitize JSON content
    if (!contentType.includes('application/json')) {
      return {};
    }

    const body = await request.json().catch(() => null);
    if (!body) return {};

    // Sanitize the JSON data
    const sanitizedBody = sanitizeJSONData(body);

    return { sanitizedBody };

  } catch (error) {
    console.error('Content sanitization error:', error);
    
    return {
      error: new NextResponse(
        JSON.stringify({
          error: 'Invalid content',
          message: 'Request content failed sanitization'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    };
  }
}

/**
 * Security headers middleware
 */
export function addSecurityHeaders(response: NextResponse): NextResponse {
  // CORS headers
  response.headers.set('Access-Control-Allow-Origin', '*'); // Configure properly for production
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);

  return response;
}

/**
 * Main security middleware
 */
export async function securityMiddleware(
  request: NextRequest,
  config: SecurityMiddlewareConfig
): Promise<NextResponse> {
  const context = extractSecurityContext(request);

  try {
    // 1. Check abuse detection first
    const abuseResponse = await checkAbuseDetection(context, config);
    if (abuseResponse) return abuseResponse;

    // 2. Apply rate limiting
    const rateLimitResponse = await applyRateLimit(context, config);
    if (rateLimitResponse && rateLimitResponse.status !== 200) {
      return rateLimitResponse;
    }

    // 3. Validate domain for embed requests
    const domainResponse = await validateDomain(context, config);
    if (domainResponse) return domainResponse;

    // 4. Sanitize request content
    const { sanitizedBody, error: sanitizationError } = await sanitizeRequestContent(context, config);
    if (sanitizationError) return sanitizationError;

    // 5. Continue with the request
    let response = NextResponse.next();

    // Add rate limit headers if available
    if (rateLimitResponse && rateLimitResponse.headers) {
      for (const [key, value] of rateLimitResponse.headers.entries()) {
        response.headers.set(key, value);
      }
    }

    // Add security headers
    response = addSecurityHeaders(response);

    // Attach sanitized body to request for downstream use
    if (sanitizedBody) {
      response.headers.set('X-Sanitized-Content', 'true');
    }

    return response;

  } catch (error) {
    console.error('Security middleware error:', error);
    
    // Return a generic error response
    return new NextResponse(
      JSON.stringify({
        error: 'Security check failed',
        message: 'Request could not be processed due to security restrictions'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
}

/**
 * Create security middleware with configuration
 */
export function createSecurityMiddleware(config: SecurityMiddlewareConfig) {
  return (request: NextRequest) => securityMiddleware(request, config);
}