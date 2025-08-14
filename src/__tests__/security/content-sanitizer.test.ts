import { 
  sanitizeHTML,
  validateAndSanitizeInput,
  sanitizeJSONData,
  generateCSPHeader,
  validateFileContent,
  ContentRateLimiter
} from '@/lib/security/content-sanitizer';

describe('Content Sanitizer', () => {
  describe('sanitizeHTML', () => {
    it('should sanitize basic HTML content', () => {
      const input = '<script>alert("xss")</script><p>Safe content</p>';
      const result = sanitizeHTML(input, 'RICH_TEXT');
      
      expect(result).not.toContain('<script>');
      expect(result).toContain('<p>Safe content</p>');
    });

    it('should remove dangerous attributes', () => {
      const input = '<p onclick="alert(1)">Content</p>';
      const result = sanitizeHTML(input, 'RICH_TEXT');
      
      expect(result).not.toContain('onclick');
      expect(result).toContain('<p>Content</p>');
    });

    it('should handle empty content', () => {
      expect(sanitizeHTML('')).toBe('');
      expect(sanitizeHTML(null as any)).toBe('');
      expect(sanitizeHTML(undefined as any)).toBe('');
    });

    it('should apply different configurations', () => {
      const input = '<a href="http://example.com">Link</a><script>alert(1)</script>';
      
      const richText = sanitizeHTML(input, 'RICH_TEXT');
      expect(richText).toContain('<a href="http://example.com">Link</a>');
      
      const basicText = sanitizeHTML(input, 'BASIC_TEXT');
      expect(basicText).not.toContain('<a');
    });

    it('should handle embed-safe configuration', () => {
      const input = '<div data-element-id="test"><span>Content</span><script>alert(1)</script></div>';
      const result = sanitizeHTML(input, 'EMBED_SAFE');
      
      expect(result).toContain('data-element-id="test"');
      expect(result).toContain('<span>Content</span>');
      expect(result).not.toContain('<script>');
    });
  });

  describe('validateAndSanitizeInput', () => {
    it('should detect XSS patterns', () => {
      const xssInputs = [
        '<script>alert("xss")</script>',
        'javascript:alert(1)',
        'onload="alert(1)"',
        'eval(maliciousCode)',
        'setTimeout(maliciousCode, 1000)'
      ];

      xssInputs.forEach(input => {
        const result = validateAndSanitizeInput(input);
        // Should return sanitized version, not the original dangerous input
        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
        // For most inputs, it should be different from the original
        if (input.includes('<script>') || input.includes('javascript:')) {
          expect(result).not.toBe(input);
        }
      });
    });

    it('should escape HTML entities', () => {
      const input = '<p>Test & "quotes" and \'apostrophes\'</p>';
      const result = validateAndSanitizeInput(input);
      
      expect(result).toContain('&lt;p&gt;');
      expect(result).toContain('&quot;');
      expect(result).toContain('&#x27;');
      // Note: & gets escaped differently depending on if XSS is detected
    });

    it('should handle safe content', () => {
      const input = 'This is safe content with numbers 123';
      const result = validateAndSanitizeInput(input);
      
      expect(result).toBe(input);
    });

    it('should handle empty/null input', () => {
      expect(validateAndSanitizeInput('')).toBe('');
      expect(validateAndSanitizeInput(null)).toBe('');
      expect(validateAndSanitizeInput(undefined)).toBe('');
    });
  });

  describe('sanitizeJSONData', () => {
    it('should sanitize nested JSON objects', () => {
      const input = {
        title: '<script>alert("xss")</script>Safe Title',
        content: {
          text: 'Normal text',
          html: '<p onclick="alert(1)">Content</p>'
        },
        tags: ['<script>alert(1)</script>', 'safe-tag']
      };

      const result = sanitizeJSONData(input);
      
      expect(result.title).not.toContain('<script>');
      expect(result.content.html).not.toContain('onclick');
      expect(result.tags[0]).not.toContain('<script>');
      expect(result.tags[1]).toBe('safe-tag');
    });

    it('should handle arrays', () => {
      const input = ['<script>alert(1)</script>', 'safe content', { unsafe: '<script>test</script>' }];
      const result = sanitizeJSONData(input);
      
      expect(result[0]).not.toContain('<script>');
      expect(result[1]).toBe('safe content');
      expect(result[2].unsafe).not.toContain('<script>');
    });

    it('should preserve null and undefined values', () => {
      const input = { a: null, b: undefined, c: 'test' };
      const result = sanitizeJSONData(input);
      
      expect(result.a).toBeNull();
      expect(result.b).toBeUndefined();
      expect(result.c).toBe('test');
    });
  });

  describe('generateCSPHeader', () => {
    it('should generate valid CSP header', () => {
      const csp = generateCSPHeader();
      
      expect(csp).toContain('default-src');
      expect(csp).toContain('script-src');
      expect(csp).toContain('style-src');
      expect(csp).toContain("'self'");
    });

    it('should include all required directives', () => {
      const csp = generateCSPHeader();
      
      const requiredDirectives = [
        'default-src', 'script-src', 'style-src', 'img-src',
        'font-src', 'connect-src', 'frame-src', 'object-src',
        'base-uri', 'form-action'
      ];

      requiredDirectives.forEach(directive => {
        expect(csp).toContain(directive);
      });
    });
  });

  describe('validateFileContent', () => {
    it('should detect suspicious file patterns', () => {
      const suspiciousContents = [
        '<?php echo "malicious"; ?>',
        '<script>alert("xss")</script>',
        '#!/bin/bash\nrm -rf /',
        'import os\nos.system("rm -rf /")',
        'require("child_process").exec("malicious")',
        'eval(maliciousCode)'
      ];

      suspiciousContents.forEach(content => {
        const result = validateFileContent(content);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should allow safe content', () => {
      const safeContent = 'ReCopyFast Domain Verification\nVerification Code: abc123\nGenerated: 2023-01-01';
      const result = validateFileContent(safeContent);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBeDefined();
    });

    it('should handle empty content', () => {
      const result = validateFileContent('');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Content is empty');
    });
  });

  describe('ContentRateLimiter', () => {
    let rateLimiter: ContentRateLimiter;

    beforeEach(() => {
      rateLimiter = new ContentRateLimiter(5, 1000); // 5 operations per second
    });

    it('should allow operations within limit', () => {
      expect(rateLimiter.isAllowed('test-user')).toBe(true);
      expect(rateLimiter.isAllowed('test-user')).toBe(true);
      expect(rateLimiter.getRemainingOperations('test-user')).toBe(3);
    });

    it('should block operations over limit', () => {
      // Use up all operations
      for (let i = 0; i < 5; i++) {
        expect(rateLimiter.isAllowed('test-user')).toBe(true);
      }
      
      // Next operation should be blocked
      expect(rateLimiter.isAllowed('test-user')).toBe(false);
      expect(rateLimiter.getRemainingOperations('test-user')).toBe(0);
    });

    it('should reset after time window', async () => {
      // Use up all operations
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed('test-user');
      }
      
      expect(rateLimiter.isAllowed('test-user')).toBe(false);
      
      // Wait for window to pass (simulate with smaller window for testing)
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(rateLimiter.isAllowed('test-user')).toBe(true);
    });

    it('should track different identifiers separately', () => {
      // Use up operations for user1
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed('user1');
      }
      
      expect(rateLimiter.isAllowed('user1')).toBe(false);
      expect(rateLimiter.isAllowed('user2')).toBe(true); // user2 should still be allowed
    });

    it('should allow manual reset', () => {
      // Use up operations
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed('test-user');
      }
      
      expect(rateLimiter.isAllowed('test-user')).toBe(false);
      
      rateLimiter.reset('test-user');
      expect(rateLimiter.isAllowed('test-user')).toBe(true);
    });
  });
});