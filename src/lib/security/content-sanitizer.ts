import DOMPurify from 'dompurify';

// Create DOMPurify instance - works both client and server side
let createDOMPurify: typeof DOMPurify;

if (typeof window !== 'undefined') {
  // Browser environment
  createDOMPurify = DOMPurify;
} else {
  // Server environment
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JSDOM } = require('jsdom');
    const window = new JSDOM('').window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createDOMPurify = DOMPurify(window as any);
  } catch {
    // Fallback if JSDOM is not available
    console.warn('JSDOM not available for server-side sanitization');
    createDOMPurify = {
      sanitize: (content: string) => content.replace(/<[^>]*>/g, ''),
      clearConfig: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
}

/**
 * Content sanitization configuration for different contexts
 */
export const SANITIZATION_CONFIGS = {
  // For rich text content (user-generated content)
  RICH_TEXT: {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'span', 'div',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'img'
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src', 'width', 'height',
      'class', 'id', 'style'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp):\/\/|mailto:|tel:|#)/i,
    FORBID_TAGS: ['script', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    STRIP_EMPTY: true,
    RETURN_DOM_FRAGMENT: false,
    RETURN_DOM_IMPORT: false,
    SANITIZE_DOM: true,
    WHOLE_DOCUMENT: false
  },

  // For basic text content (minimal HTML)
  BASIC_TEXT: {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'span'],
    ALLOWED_ATTR: ['class'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    STRIP_EMPTY: true
  },

  // For embedded content (very restrictive)
  EMBED_SAFE: {
    ALLOWED_TAGS: ['span', 'div', 'p', 'strong', 'em'],
    ALLOWED_ATTR: ['class', 'data-element-id'],
    FORBID_TAGS: [
      'script', 'style', 'iframe', 'object', 'embed', 'form', 'input',
      'button', 'a', 'img', 'video', 'audio', 'source'
    ],
    STRIP_EMPTY: true,
    SANITIZE_DOM: true
  }
} as const;

/**
 * Sanitize HTML content based on context
 */
export function sanitizeHTML(
  content: string,
  config: keyof typeof SANITIZATION_CONFIGS = 'RICH_TEXT'
): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  try {
    const sanitizationConfig = SANITIZATION_CONFIGS[config];
    
    // Configure DOMPurify
    createDOMPurify.clearConfig();
    
    const sanitized = createDOMPurify.sanitize(content, sanitizationConfig);
    
    return sanitized;
  } catch (error) {
    console.error('Content sanitization failed:', error);
    // In case of error, return empty string for security
    return '';
  }
}

/**
 * Validate and sanitize user input for XSS prevention
 */
export function validateAndSanitizeInput(input: unknown): string {
  if (!input) return '';
  
  const stringInput = String(input);
  
  // Check for common XSS patterns
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onerror\s*=/gi,
    /onclick\s*=/gi,
    /onmouseover\s*=/gi,
    /onfocus\s*=/gi,
    /onblur\s*=/gi,
    /expression\s*\(/gi,
    /eval\s*\(/gi,
    /setTimeout\s*\(/gi,
    /setInterval\s*\(/gi
  ];

  // Check if input contains potential XSS
  const hasXSS = xssPatterns.some(pattern => pattern.test(stringInput));
  
  if (hasXSS) {
    // Log security event
    console.warn('Potential XSS attempt detected:', {
      input: stringInput.substring(0, 100),
      timestamp: new Date().toISOString()
    });
    
    // Return sanitized version
    return sanitizeHTML(stringInput, 'BASIC_TEXT');
  }

  // For non-HTML content, just sanitize basic patterns
  return stringInput
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize JSON data recursively
 */
export function sanitizeJSONData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return validateAndSanitizeInput(data);
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeJSONData);
  }

  if (typeof data === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Sanitize both key and value
      const sanitizedKey = validateAndSanitizeInput(key);
      sanitized[sanitizedKey] = sanitizeJSONData(value);
    }
    return sanitized;
  }

  return data;
}

/**
 * Content Security Policy configuration
 */
export const CSP_CONFIG = {
  DEFAULT_SRC: ["'self'"],
  SCRIPT_SRC: ["'self'", "'unsafe-inline'"], // Consider removing unsafe-inline in production
  STYLE_SRC: ["'self'", "'unsafe-inline'"],
  IMG_SRC: ["'self'", "data:", "https:"],
  FONT_SRC: ["'self'", "https:"],
  CONNECT_SRC: ["'self'"],
  FRAME_SRC: ["'none'"],
  OBJECT_SRC: ["'none'"],
  BASE_URI: ["'self'"],
  FORM_ACTION: ["'self'"]
};

/**
 * Generate CSP header string
 */
export function generateCSPHeader(): string {
  const directives = Object.entries(CSP_CONFIG)
    .map(([key, values]) => {
      const directive = key.toLowerCase().replace(/_/g, '-');
      return `${directive} ${values.join(' ')}`;
    })
    .join('; ');

  return directives;
}

/**
 * Validate file upload content
 */
export function validateFileContent(content: string): {
  isValid: boolean;
  sanitized: string;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!content) {
    errors.push('Content is empty');
    return { isValid: false, sanitized: '', errors };
  }

  // Check for suspicious patterns in file content
  const suspiciousPatterns = [
    /<\?php/gi,
    /<script/gi,
    /<%/gi, // ASP
    /#!\s*\/bin/gi, // Shell scripts
    /import\s+os/gi, // Python os module
    /require\s*\(/gi, // Node.js require
    /eval\s*\(/gi,
    /exec\s*\(/gi,
    /system\s*\(/gi
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(content)) {
      errors.push(`Suspicious content pattern detected: ${pattern.source}`);
    }
  }

  // Sanitize content
  const sanitized = sanitizeHTML(content, 'BASIC_TEXT');

  return {
    isValid: errors.length === 0,
    sanitized,
    errors
  };
}

/**
 * Rate limiting for content operations
 */
export class ContentRateLimiter {
  private operations: Map<string, number[]> = new Map();
  private readonly maxOperations: number;
  private readonly windowMs: number;

  constructor(maxOperations = 100, windowMs = 60000) {
    this.maxOperations = maxOperations;
    this.windowMs = windowMs;
  }

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const operations = this.operations.get(identifier) || [];
    
    // Remove old operations outside the window
    const validOperations = operations.filter(time => now - time < this.windowMs);
    
    if (validOperations.length >= this.maxOperations) {
      return false;
    }

    // Add current operation
    validOperations.push(now);
    this.operations.set(identifier, validOperations);
    
    return true;
  }

  getRemainingOperations(identifier: string): number {
    const now = Date.now();
    const operations = this.operations.get(identifier) || [];
    const validOperations = operations.filter(time => now - time < this.windowMs);
    
    return Math.max(0, this.maxOperations - validOperations.length);
  }

  reset(identifier?: string): void {
    if (identifier) {
      this.operations.delete(identifier);
    } else {
      this.operations.clear();
    }
  }
}

// Export a default instance
export const contentRateLimiter = new ContentRateLimiter();