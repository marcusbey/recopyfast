(function() {
  'use strict';

  // `document.currentScript` is only meaningful while this script is being
  // parsed, so capture what we need from it up front. Everything that needs the
  // embed's own URL later (e.g. loading socket.io) reads this instead.
  var EMBED_SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';

  // Configuration
  // Derive API/WS URLs from data attributes on the script tag, or window globals.
  // Warn loudly rather than silently falling back to localhost.
  (function() {
    var script = document.currentScript;
    function deriveApiUrl() {
      if (!script || !script.src) return null;
      try {
        var url = new URL(script.src);
        return url.origin + '/api';
      } catch (e) {
        return null;
      }
    }
    function deriveWsUrl() {
      if (!script || !script.src) return null;
      try {
        var url = new URL(script.src);
        if (url.hostname === 'localhost' && url.port === '3000') {
          url.port = '4001';
        }
        return url.origin;
      } catch (e) {
        return null;
      }
    }
    if (!window.RECOPYFAST_API) {
      var apiAttr = script && script.getAttribute('data-api-url');
      if (apiAttr) {
        window.RECOPYFAST_API = apiAttr;
      } else if (deriveApiUrl()) {
        window.RECOPYFAST_API = deriveApiUrl();
      } else {
        console.warn('ReCopyFast: RECOPYFAST_API is not set. Add a data-api-url attribute to the script tag or set window.RECOPYFAST_API before loading this script.');
      }
    }
    if (!window.RECOPYFAST_WS) {
      var wsAttr = script && script.getAttribute('data-ws-url');
      if (wsAttr) {
        window.RECOPYFAST_WS = wsAttr;
      } else if (deriveWsUrl()) {
        window.RECOPYFAST_WS = deriveWsUrl();
      } else {
        console.warn('ReCopyFast: RECOPYFAST_WS is not set. Add a data-ws-url attribute to the script tag or set window.RECOPYFAST_WS before loading this script.');
      }
    }
  })();
  const RECOPYFAST_API = window.RECOPYFAST_API;
  const RECOPYFAST_WS = window.RECOPYFAST_WS;

  // socket.io must never come from a third-party CDN: customer sites (and our
  // own app) serve `script-src 'self'`, which blocks cross-origin scripts. The
  // production build inlines socket.io-client ahead of this file, so
  // `window.__recopyfastSocketIO` is normally already there. When it isn't (raw
  // unbuilt source), fall back to a copy served next to this script — "self"
  // from the browser's point of view is the origin the embed was loaded from,
  // not the customer's page origin.
  const SOCKET_IO_FALLBACK_URL = (function() {
    if (!EMBED_SCRIPT_SRC) return null;
    try {
      const url = new URL(EMBED_SCRIPT_SRC);
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname.replace(/[^/]*$/, 'socket.io-client.min.js');
      return url.href;
    } catch (e) {
      return null;
    }
  })();

  function getSocketIOFactory() {
    if (window.__recopyfastSocketIO && typeof window.__recopyfastSocketIO.io === 'function') {
      return window.__recopyfastSocketIO.io;
    }
    // A socket.io build already on the customer's page is good enough.
    if (typeof window.io === 'function') return window.io;
    return null;
  }
  const SITE_ID = document.currentScript.getAttribute('data-site-id');
  const SITE_TOKEN = document.currentScript.getAttribute('data-site-token');

  // Staging mode detection from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const STAGING_MODE = urlParams.get('rcf_staging') === '1';
  const STAGING_TOKEN = urlParams.get('rcf_token');
  const EDIT_SESSION_TOKEN = urlParams.get('rcf_edit_token');
  const EDITOR_MODE = (STAGING_MODE && STAGING_TOKEN) || !!EDIT_SESSION_TOKEN;

  // Immediately strip staging params from the visible URL so they don't persist
  // in browser history, bookmarks, or copy-pasted links.
  if (STAGING_MODE || STAGING_TOKEN || EDIT_SESSION_TOKEN) {
    const cleanParams = new URLSearchParams(window.location.search);
    cleanParams.delete('rcf_staging');
    cleanParams.delete('rcf_token');
    cleanParams.delete('rcf_edit_token');
    const cleanSearch = cleanParams.toString();
    const cleanUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '') + window.location.hash;
    history.replaceState(history.state, '', cleanUrl);
  }

  if (!SITE_ID) {
    console.error('ReCopyFast: No site ID provided');
    return;
  }

  if (!SITE_TOKEN) {
    console.error('ReCopyFast: No site token provided');
    return;
  }

  // Helper to safely escape HTML for display
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // @rcf-inject:editing-rules
  //
  // `scripts/build-embed.mjs` replaces everything between these two markers with
  // the compiled contents of src/lib/editingRules.core.ts — the same rules the
  // app runs. Do not reimplement colour, contrast or backdrop logic below; edit
  // that file instead.
  //
  // What follows is the unbuilt-source fallback. It deliberately *declines* to
  // make decisions rather than guessing: a second implementation here is exactly
  // the drift this injection exists to prevent.
  var __rcfRules = {
    UNAVAILABLE: true,
    assessReadability: function () {
      return { ratio: null, required: 4.5, scrim: null, guaranteed: null, backdrop: { color: { r: 255, g: 255, b: 255, a: 1 }, certain: false, kind: 'unknown', reason: 'rules unavailable' }, reason: 'rules unavailable' };
    },
    resolveAffordances: function () {
      return {
        backdropIsLight: true,
        caretColor: '#1d4ed8', selectionBackground: 'rgba(59, 130, 246, 0.28)', selectionColor: 'inherit',
        outlineColor: 'rgba(37, 99, 235, 0.9)', chromeBackground: 'rgba(15, 23, 42, 0.92)',
        chromeText: '#e2e8f0', chromeBorder: 'rgba(255, 255, 255, 0.14)'
      };
    },
    measureLayoutFloor: function (el) {
      const cs = window.getComputedStyle(el);
      return {
        minHeight: parseFloat(cs.height) || 0,
        inline: cs.display === 'inline',
        preservesWhitespace: /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace),
        writingMode: cs.writingMode, direction: cs.direction
      };
    },
    readEditableText: function (el) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value || '';
      const raw = el.textContent || '';
      return /^(pre|pre-wrap|break-spaces)$/.test(window.getComputedStyle(el).whiteSpace) ? raw : raw.trim();
    },
    hasMarkupChildren: function (el) {
      for (let i = 0; i < el.children.length; i++) if (el.children[i].tagName !== 'BR') return true;
      return false;
    },
    whenFontsReady: function () { return Promise.resolve(); }
  };
  // @rcf-inject-end

  if (__rcfRules.UNAVAILABLE) {
    console.error(
      'ReCopyFast: running unbuilt source — shared editing rules were never injected. ' +
      'Readability and geometry rules are disabled. Run: npm run build:embed'
    );
  }

  /**
   * Shared editing rules, compiled from src/lib/editingRules.core.ts.
   * See the RULES block at the top of that file for what each one guarantees.
   */
  const Rules = __rcfRules;

  /**
   * Image upload constraints, checked client-side so an oversized file fails
   * instantly instead of after a slow upload. The server enforces these too —
   * this is a courtesy, not a control.
   */
  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  function validateImageFile(file) {
    if (ACCEPTED_IMAGE_TYPES.indexOf(file.type) === -1) {
      return 'Unsupported format (' + (file.type || 'unknown') + '). Use JPEG, PNG, WebP, GIF or AVIF.';
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return 'Image is ' + Math.round(file.size / 1024 / 1024) + ' MB — the limit is ' +
             Math.round(MAX_IMAGE_BYTES / 1024 / 1024) + ' MB.';
    }
    return null;
  }

  /**
   * Swap an image's source without reflowing the page around it.
   *
   * Three things routinely break this:
   *   - `srcset`/`sizes` and <picture><source> outrank `src`, so setting `src`
   *     alone silently does nothing;
   *   - the replacement's intrinsic size differs from the original's, which
   *     resizes any <img> whose box came from its intrinsic dimensions;
   *   - `object-fit` defaults to `fill`, which distorts a new image whose
   *     aspect ratio differs.
   */
  function applyImageSource(element, url) {
    const computed = window.getComputedStyle(element);
    const before = { width: parseFloat(computed.width) || 0, height: parseFloat(computed.height) || 0 };
    const objectFit = computed.objectFit;

    // Responsive candidates win over src; clear them or the swap is a no-op.
    element.removeAttribute('srcset');
    element.removeAttribute('sizes');
    const picture = element.parentElement;
    if (picture && picture.tagName === 'PICTURE') {
      Array.prototype.slice.call(picture.querySelectorAll('source')).forEach(function(source) {
        source.remove();
      });
    }

    element.src = url;

    const pin = function() {
      const after = window.getComputedStyle(element);
      const w = parseFloat(after.width) || 0;
      const h = parseFloat(after.height) || 0;

      // Only intervene when the box actually moved — pinning unconditionally
      // would override the page's own responsive rules for no reason.
      if (before.width && before.height && (Math.abs(w - before.width) > 0.5 || Math.abs(h - before.height) > 0.5)) {
        element.style.width = before.width + 'px';
        element.style.height = before.height + 'px';
        // `fill` would stretch a differently-proportioned replacement.
        if (!objectFit || objectFit === 'fill') element.style.objectFit = 'cover';
      }
    };

    if (element.complete) pin();
    else element.addEventListener('load', pin, { once: true });
  }

  class ReCopyFast {
    constructor() {
      this.elements = new Map();
      this.socket = null;
      this.observer = null;
      this.isInitialized = false;
      this.selectedElement = null;

      // Staging mode properties
      this.stagingMode = EDITOR_MODE;
      this.stagingToken = STAGING_TOKEN;
      this.editSessionToken = EDIT_SESSION_TOKEN;
      this.stagingAccess = null;
      this.editMode = false;

      // A/B testing properties
      this.activeTests = [];
      this.variantAssignments = {};
      this.visitorId = null;
      this.geoData = null;

      this.init();
    }

    async init() {
      try {
        await this.waitForDOM();

        if (this.stagingMode && (this.stagingToken || this.editSessionToken)) {
          await this.initStagingMode();
        } else {
          this.editMode = false;
        }

        // Anything measured before web fonts land describes the fallback face,
        // and the two have different advance widths — capacity estimates and
        // overflow checks taken now would be wrong by the difference. Capped so
        // a font that never arrives cannot wedge edit mode.
        await Rules.whenFontsReady(window);

        this.scanForContent();

        // A/B testing pipeline (non-blocking for staging mode)
        if (!this.stagingMode) {
          this.initVisitorId();
          await this.fetchActiveTests();
          await this.bucketVisitor();
          this.applyVariants();
          this.setupClickTracking();
          this.trackImpressions();
        }

        await this.establishConnection();
        this.setupMutationObserver();

        if (this.editMode) {
          this.setupEditMode();
        }

        this.isInitialized = true;
        console.log('ReCopyFast initialized (' + (this.stagingMode ? 'staging' : 'live') + ' mode)');
      } catch (error) {
        console.error('ReCopyFast initialization error:', error);
      }
    }

    async initStagingMode() {
      try {
        // Demo mode: tokens starting with "test_" enable immediate edit access
        // This allows testing without database validation
        const editorToken = this.editSessionToken || this.stagingToken;
        const isDemoToken = editorToken && editorToken.startsWith('test_');
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        if (isDemoToken && isLocalhost) {
          console.log('ReCopyFast: Demo mode enabled (test token on localhost)');
          this.stagingAccess = {
            verified: true,
            email: 'demo@recopyfast.local',
            permissions: ['view', 'edit', 'publish', 'admin'],
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
          };
          this.editMode = true;
          this.showStagingBanner();
          return;
        }

        const response = await fetch(RECOPYFAST_API + '/staging/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: this.stagingToken || undefined,
            editToken: this.editSessionToken || undefined,
            siteId: SITE_ID
          })
        });

        const result = await response.json();

        if (!result.valid) {
          this.showStagingError('Invalid or expired staging link.');
          return;
        }

        if (result.requiresEmail) {
          await this.showEmailCaptureUI();
          return;
        }

        if (result.requiresVerification) {
          await this.showVerificationUI(result.email);
          return;
        }

        this.stagingAccess = {
          kind: result.kind || (this.editSessionToken ? 'edit-session' : 'staging'),
          verified: true,
          email: result.email,
          permissions: result.permissions,
          expiresAt: result.expiresAt
        };

        const canEdit = result.permissions.includes('edit') ||
                       result.permissions.includes('publish') ||
                       result.permissions.includes('admin');

        this.editMode = canEdit;
        this.showStagingBanner();

      } catch (error) {
        console.error('Staging validation error:', error);
        this.showStagingError('Failed to validate staging access.');
      }
    }

    showEmailCaptureUI() {
      return new Promise((resolve) => {
        const overlay = this.createOverlay();
        const modal = document.createElement('div');
        modal.className = 'rcf-modal';

        // Build modal using DOM methods for security
        const iconContainer = document.createElement('div');
        iconContainer.style.cssText = 'text-align: center; margin-bottom: 24px;';

        const icon = document.createElement('div');
        icon.className = 'rcf-modal-icon';
        icon.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)';
        icon.style.border = '1px solid rgba(59, 130, 246, 0.3)';
        icon.textContent = '🔐';

        const title = document.createElement('h2');
        title.className = 'rcf-modal-title';
        title.textContent = 'Staging Access';

        const subtitle = document.createElement('p');
        subtitle.className = 'rcf-modal-subtitle';
        subtitle.textContent = 'Enter your email to access the staging environment';

        iconContainer.appendChild(icon);
        iconContainer.appendChild(title);
        iconContainer.appendChild(subtitle);

        const formContainer = document.createElement('div');
        formContainer.style.cssText = 'margin-bottom: 24px;';

        const label = document.createElement('label');
        label.className = 'rcf-modal-label';
        label.textContent = 'Email Address';

        const emailInput = document.createElement('input');
        emailInput.type = 'email';
        emailInput.id = 'rcf-email-input';
        emailInput.className = 'rcf-modal-input';
        emailInput.placeholder = 'your@email.com';

        const errorEl = document.createElement('p');
        errorEl.id = 'rcf-email-error';
        errorEl.className = 'rcf-modal-error';

        formContainer.appendChild(label);
        formContainer.appendChild(emailInput);
        formContainer.appendChild(errorEl);

        const submitBtn = document.createElement('button');
        submitBtn.id = 'rcf-email-submit';
        submitBtn.className = 'rcf-modal-btn rcf-modal-btn-primary';
        const btnText = document.createElement('span');
        btnText.textContent = 'Continue';
        const btnArrow = document.createElement('span');
        btnArrow.textContent = '→';
        submitBtn.appendChild(btnText);
        submitBtn.appendChild(btnArrow);

        modal.appendChild(iconContainer);
        modal.appendChild(formContainer);
        modal.appendChild(submitBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        emailInput.focus();

        const submit = async () => {
          const email = emailInput.value.trim();

          if (!email || !email.includes('@')) {
            errorEl.textContent = 'Please enter a valid email address';
            errorEl.style.display = 'block';
            return;
          }

          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Sending code...</span>';

          try {
            const response = await fetch(RECOPYFAST_API + '/staging/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: this.stagingToken,
                email: email,
                action: 'capture'
              })
            });

            const result = await response.json();

            if (result.success) {
              document.body.removeChild(overlay);
              await this.showVerificationUI(email);
              resolve();
            } else {
              errorEl.textContent = result.error || 'Failed to send verification code';
              errorEl.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<span>Continue</span><span>→</span>';
            }
          } catch (error) {
            errorEl.textContent = 'Network error. Please try again.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Continue</span><span>→</span>';
          }
        };

        submitBtn.onclick = submit;
        emailInput.onkeydown = function(e) {
          if (e.key === 'Enter') submit();
        };
      });
    }

    showVerificationUI(email) {
      const self = this;
      return new Promise((resolve) => {
        const overlay = this.createOverlay();
        const modal = document.createElement('div');
        modal.className = 'rcf-modal';

        const iconContainer = document.createElement('div');
        iconContainer.style.cssText = 'text-align: center; margin-bottom: 24px;';

        const icon = document.createElement('div');
        icon.className = 'rcf-modal-icon';
        icon.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)';
        icon.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        icon.textContent = '📧';

        const title = document.createElement('h2');
        title.className = 'rcf-modal-title';
        title.textContent = 'Check Your Email';

        const subtitle = document.createElement('p');
        subtitle.className = 'rcf-modal-subtitle';
        const emailSpan = document.createElement('strong');
        emailSpan.style.color = '#10b981';
        emailSpan.textContent = email;
        subtitle.appendChild(document.createTextNode('We sent a 6-digit code to '));
        subtitle.appendChild(emailSpan);

        iconContainer.appendChild(icon);
        iconContainer.appendChild(title);
        iconContainer.appendChild(subtitle);

        const formContainer = document.createElement('div');
        formContainer.style.cssText = 'margin-bottom: 24px;';

        const label = document.createElement('label');
        label.className = 'rcf-modal-label';
        label.textContent = 'Verification Code';

        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.id = 'rcf-code-input';
        codeInput.className = 'rcf-code-input';
        codeInput.placeholder = '000000';
        codeInput.maxLength = 6;

        const errorEl = document.createElement('p');
        errorEl.id = 'rcf-code-error';
        errorEl.className = 'rcf-modal-error';

        formContainer.appendChild(label);
        formContainer.appendChild(codeInput);
        formContainer.appendChild(errorEl);

        const submitBtn = document.createElement('button');
        submitBtn.className = 'rcf-modal-btn rcf-modal-btn-success';
        submitBtn.style.marginBottom = '12px';
        submitBtn.innerHTML = '<span>Verify & Continue</span>';

        const resendBtn = document.createElement('button');
        resendBtn.className = 'rcf-modal-btn rcf-modal-btn-ghost';
        resendBtn.innerHTML = '<span>Resend Code</span>';

        modal.appendChild(iconContainer);
        modal.appendChild(formContainer);
        modal.appendChild(submitBtn);
        modal.appendChild(resendBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        codeInput.focus();

        codeInput.oninput = function() {
          codeInput.value = codeInput.value.replace(/[^0-9]/g, '').slice(0, 6);
        };

        const submit = async () => {
          const code = codeInput.value.trim();

          if (code.length !== 6) {
            errorEl.textContent = 'Please enter the 6-digit code';
            errorEl.style.display = 'block';
            return;
          }

          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Verifying...</span>';

          try {
            const response = await fetch(RECOPYFAST_API + '/staging/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: self.stagingToken,
                code: code,
                action: 'verify'
              })
            });

            const result = await response.json();

            if (result.success && result.verified) {
              self.stagingAccess = {
                verified: true,
                email: result.email,
                permissions: result.permissions,
                expiresAt: result.expiresAt
              };

              const canEdit = result.permissions.includes('edit') ||
                             result.permissions.includes('publish') ||
                             result.permissions.includes('admin');

              self.editMode = canEdit;

              document.body.removeChild(overlay);
              self.showStagingBanner();

              if (self.editMode) {
                self.setupEditMode();
                self.elements.forEach(function(data) {
                  data.element.classList.add('rcf-editable');
                });
              }

              resolve();
            } else {
              errorEl.textContent = result.error || 'Invalid verification code';
              errorEl.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<span>Verify & Continue</span>';
            }
          } catch (error) {
            errorEl.textContent = 'Network error. Please try again.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Verify & Continue</span>';
          }
        };

        resendBtn.onclick = async function() {
          resendBtn.disabled = true;
          resendBtn.innerHTML = '<span>Sending...</span>';

          try {
            const response = await fetch(RECOPYFAST_API + '/staging/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: self.stagingToken,
                action: 'resend'
              })
            });

            const result = await response.json();

            if (result.success) {
              resendBtn.innerHTML = '<span>✓ Code Sent!</span>';
              setTimeout(function() {
                resendBtn.innerHTML = '<span>Resend Code</span>';
                resendBtn.disabled = false;
              }, 3000);
            } else {
              resendBtn.innerHTML = '<span>Failed - Try Again</span>';
              resendBtn.disabled = false;
            }
          } catch (e) {
            resendBtn.innerHTML = '<span>Failed - Try Again</span>';
            resendBtn.disabled = false;
          }
        };

        submitBtn.onclick = submit;
        codeInput.onkeydown = function(e) {
          if (e.key === 'Enter') submit();
        };
      });
    }

    showStagingBanner() {
      if (!this.stagingAccess) return;

      const self = this;

      // Inject banner-specific styles
      if (!document.querySelector('#rcf-banner-styles')) {
        const style = document.createElement('style');
        style.id = 'rcf-banner-styles';
        style.textContent = `
          @keyframes rcf-pulse-ring {
            0% { transform: scale(1); opacity: 1; }
            100% { transform: scale(1.8); opacity: 0; }
          }
          @keyframes rcf-shimmer {
            0% { background-position: -200% center; }
            100% { background-position: 200% center; }
          }
          .rcf-banner-btn {
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            border: none;
            outline: none;
          }
          .rcf-banner-btn:hover {
            transform: translateY(-1px);
          }
          .rcf-banner-btn:active {
            transform: scale(0.98);
          }
          .rcf-banner-btn-ghost {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.15);
          }
          .rcf-banner-btn-ghost:hover {
            background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.25);
          }
          .rcf-banner-btn-success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
          }
          .rcf-banner-btn-success:hover {
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
          }
          .rcf-status-dot {
            position: relative;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #f97316;
            box-shadow: 0 0 12px rgba(249, 115, 22, 0.6);
          }
          .rcf-status-dot::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: #f97316;
            animation: rcf-pulse-ring 2s ease-out infinite;
          }
          .rcf-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 9999px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.8);
          }
          .rcf-pill strong {
            color: white;
          }
        `;
        document.head.appendChild(style);
      }

      const banner = document.createElement('div');
      banner.id = 'rcf-staging-banner';
      banner.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); color: white; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; z-index: 99999; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1); border-bottom: 1px solid rgba(255, 255, 255, 0.08);';

      const permissions = this.stagingAccess.permissions || [];
      const permText = permissions.map(function(p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(', ');
      const expiresAt = this.stagingAccess.expiresAt
        ? new Date(this.stagingAccess.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '--';

      const infoDiv = document.createElement('div');
      infoDiv.style.cssText = 'display: flex; align-items: center; gap: 16px;';

      // Status indicator with pulse
      const statusContainer = document.createElement('div');
      statusContainer.style.cssText = 'display: flex; align-items: center; gap: 10px;';

      const statusDot = document.createElement('span');
      statusDot.className = 'rcf-status-dot';

      const modeLabel = document.createElement('span');
      modeLabel.style.cssText = 'font-weight: 600; font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; color: #f97316;';
      modeLabel.textContent = 'STAGING';

      statusContainer.appendChild(statusDot);
      statusContainer.appendChild(modeLabel);

      // User info pill
      const userPill = document.createElement('span');
      userPill.className = 'rcf-pill';
      const userIcon = document.createElement('span');
      userIcon.textContent = '👤';
      userIcon.style.fontSize = '11px';
      const userEmail = document.createElement('strong');
      userEmail.textContent = this.stagingAccess.email;
      userPill.appendChild(userIcon);
      userPill.appendChild(userEmail);

      // Permissions pill
      const permPill = document.createElement('span');
      permPill.className = 'rcf-pill';
      const permIcon = document.createElement('span');
      permIcon.textContent = '🔑';
      permIcon.style.fontSize = '11px';
      const permValue = document.createElement('span');
      permValue.textContent = permText;
      permPill.appendChild(permIcon);
      permPill.appendChild(permValue);

      // Expires pill
      const expiresPill = document.createElement('span');
      expiresPill.className = 'rcf-pill';
      const expiresIcon = document.createElement('span');
      expiresIcon.textContent = '⏱️';
      expiresIcon.style.fontSize = '11px';
      const expiresValue = document.createElement('span');
      expiresValue.textContent = expiresAt;
      expiresPill.appendChild(expiresIcon);
      expiresPill.appendChild(expiresValue);

      infoDiv.appendChild(statusContainer);
      infoDiv.appendChild(userPill);
      infoDiv.appendChild(permPill);
      infoDiv.appendChild(expiresPill);

      const buttonsDiv = document.createElement('div');
      buttonsDiv.style.cssText = 'display: flex; gap: 10px;';

      const previewBtn = document.createElement('button');
      previewBtn.id = 'rcf-preview-live';
      previewBtn.className = 'rcf-banner-btn rcf-banner-btn-ghost';
      const previewIcon = document.createElement('span');
      previewIcon.textContent = '👁️';
      const previewText = document.createElement('span');
      previewText.textContent = 'Preview Live';
      previewBtn.appendChild(previewIcon);
      previewBtn.appendChild(previewText);

      buttonsDiv.appendChild(previewBtn);

      // Edit Board button
      const editBoardBtn = document.createElement('button');
      editBoardBtn.id = 'rcf-edit-board-btn';
      editBoardBtn.className = 'rcf-banner-btn rcf-banner-btn-ghost';
      const editBoardIcon = document.createElement('span');
      editBoardIcon.textContent = '📋';
      const editBoardText = document.createElement('span');
      editBoardText.textContent = 'Edit Board';
      editBoardBtn.appendChild(editBoardIcon);
      editBoardBtn.appendChild(editBoardText);
      buttonsDiv.appendChild(editBoardBtn);

      editBoardBtn.onclick = function() {
        if (!self.editBoard) {
          self.editBoard = new EditBoardPanel(self);
        }
        self.editBoard.open();
      };

      if (permissions.includes('publish') || permissions.includes('admin')) {
        const publishBtn = document.createElement('button');
        publishBtn.id = 'rcf-publish-btn';
        publishBtn.className = 'rcf-banner-btn rcf-banner-btn-success';
        const publishIcon = document.createElement('span');
        publishIcon.textContent = '🚀';
        const publishText = document.createElement('span');
        publishText.textContent = 'Publish';
        publishBtn.appendChild(publishIcon);
        publishBtn.appendChild(publishText);
        buttonsDiv.appendChild(publishBtn);

        publishBtn.onclick = function() {
          self.showPublishConfirmation();
        };
      }

      banner.appendChild(infoDiv);
      banner.appendChild(buttonsDiv);
      document.body.appendChild(banner);

      document.body.style.paddingTop = (banner.offsetHeight + parseInt(document.body.style.paddingTop || 0)) + 'px';

      previewBtn.onclick = function() {
        const url = new URL(window.location.href);
        url.searchParams.delete('rcf_staging');
        url.searchParams.delete('rcf_token');
        window.open(url.toString(), '_blank');
      };
    }

    async showPublishConfirmation() {
      const self = this;
      const overlay = this.createOverlay();
      const modal = document.createElement('div');
      modal.className = 'rcf-modal';

      const iconContainer = document.createElement('div');
      iconContainer.style.cssText = 'text-align: center; margin-bottom: 24px;';

      const icon = document.createElement('div');
      icon.className = 'rcf-modal-icon';
      icon.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)';
      icon.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      icon.textContent = '🚀';

      const title = document.createElement('h2');
      title.className = 'rcf-modal-title';
      title.textContent = 'Publish Changes';

      const subtitle = document.createElement('p');
      subtitle.className = 'rcf-modal-subtitle';
      subtitle.textContent = 'This will make your staging changes live on the website.';

      iconContainer.appendChild(icon);
      iconContainer.appendChild(title);
      iconContainer.appendChild(subtitle);

      const statusEl = document.createElement('div');
      statusEl.id = 'rcf-publish-status';
      statusEl.style.cssText = 'margin-bottom: 24px; padding: 16px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px;';
      const statusText = document.createElement('p');
      statusText.style.cssText = 'margin: 0; color: #94a3b8; text-align: center; font-size: 14px;';
      statusText.textContent = 'Loading pending changes...';
      statusEl.appendChild(statusText);

      const buttonsContainer = document.createElement('div');
      buttonsContainer.style.cssText = 'display: flex; gap: 12px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'rcf-modal-btn rcf-modal-btn-ghost';
      cancelBtn.style.flex = '1';
      cancelBtn.innerHTML = '<span>Cancel</span>';

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'rcf-modal-btn rcf-modal-btn-success';
      confirmBtn.style.flex = '1';
      confirmBtn.innerHTML = '<span>🚀</span><span>Publish Now</span>';

      buttonsContainer.appendChild(cancelBtn);
      buttonsContainer.appendChild(confirmBtn);

      modal.appendChild(iconContainer);
      modal.appendChild(statusEl);
      modal.appendChild(buttonsContainer);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const close = function() {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
      };

      cancelBtn.onclick = close;
      overlay.onclick = function(e) { if (e.target === overlay) close(); };

      // Fetch pending changes
      try {
        const publishPreviewUrl =
          RECOPYFAST_API + '/staging/publish?siteId=' + SITE_ID +
          (self.editSessionToken
            ? '&rcf_edit_token=' + encodeURIComponent(self.editSessionToken)
            : '&rcf_token=' + encodeURIComponent(self.stagingToken));
        const response = await fetch(publishPreviewUrl);
        const result = await response.json();

        if (result.success) {
          if (result.pendingChanges === 0) {
            statusText.textContent = '✅ No pending changes to publish.';
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
          } else {
            statusText.textContent = '📝 ' + result.pendingChanges + ' element(s) with changes';
          }
        }
      } catch (error) {
        statusText.textContent = 'Failed to load pending changes.';
        statusText.style.color = '#ef4444';
      }

      confirmBtn.onclick = async function() {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span>Publishing...</span>';

        try {
          const response = await fetch(RECOPYFAST_API + '/staging/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              siteId: SITE_ID,
              stagingToken: self.stagingToken || undefined,
              editToken: self.editSessionToken || undefined
            })
          });

          const result = await response.json();

          if (result.success) {
            statusText.textContent = '✅ Published ' + result.published + ' change(s) successfully!';
            statusText.style.color = '#10b981';
            confirmBtn.innerHTML = '<span>✓ Done!</span>';
            setTimeout(close, 2000);
          } else {
            statusText.textContent = result.error || 'Failed to publish changes.';
            statusText.style.color = '#f87171';
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<span>🚀</span><span>Publish Now</span>';
          }
        } catch (error) {
          statusText.textContent = 'Network error. Please try again.';
          statusText.style.color = '#f87171';
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = '<span>🚀</span><span>Publish Now</span>';
        }
      };
    }

    showStagingError(message) {
      const overlay = this.createOverlay();
      const modal = document.createElement('div');
      modal.className = 'rcf-modal';

      const iconContainer = document.createElement('div');
      iconContainer.style.cssText = 'text-align: center;';

      const icon = document.createElement('div');
      icon.className = 'rcf-modal-icon';
      icon.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.2) 100%)';
      icon.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      icon.textContent = '⚠️';

      const title = document.createElement('h2');
      title.className = 'rcf-modal-title';
      title.textContent = 'Access Denied';

      const subtitle = document.createElement('p');
      subtitle.className = 'rcf-modal-subtitle';
      subtitle.style.marginBottom = '24px';
      subtitle.textContent = message;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rcf-modal-btn rcf-modal-btn-ghost';
      closeBtn.innerHTML = '<span>← Go Back</span>';

      iconContainer.appendChild(icon);
      iconContainer.appendChild(title);
      iconContainer.appendChild(subtitle);
      iconContainer.appendChild(closeBtn);

      modal.appendChild(iconContainer);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      closeBtn.onclick = function() {
        const url = new URL(window.location.href);
        url.searchParams.delete('rcf_staging');
        url.searchParams.delete('rcf_token');
        window.location.href = url.toString();
      };
    }

    createOverlay() {
      const overlay = document.createElement('div');
      overlay.className = 'rcf-overlay';
      overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 100000; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

      if (!document.querySelector('#rcf-modal-styles')) {
        const style = document.createElement('style');
        style.id = 'rcf-modal-styles';
        style.textContent = `
          .rcf-modal {
            background: linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
            border-radius: 20px;
            padding: 32px;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            animation: rcf-modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            color: #e2e8f0;
          }
          @keyframes rcf-modal-in {
            from { opacity: 0; transform: scale(0.95) translateY(20px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          .rcf-modal-input {
            width: 100%;
            padding: 14px 16px;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            font-size: 15px;
            color: #f1f5f9;
            transition: all 0.2s ease;
            box-sizing: border-box;
          }
          .rcf-modal-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
          }
          .rcf-modal-input::placeholder {
            color: rgba(148, 163, 184, 0.6);
          }
          .rcf-modal-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 14px 24px;
            font-size: 15px;
            font-weight: 600;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            border: none;
            outline: none;
          }
          .rcf-modal-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .rcf-modal-btn-primary {
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            color: white;
            box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
          }
          .rcf-modal-btn-primary:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
          }
          .rcf-modal-btn-success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
          }
          .rcf-modal-btn-success:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
          }
          .rcf-modal-btn-ghost {
            background: rgba(255, 255, 255, 0.08);
            color: #94a3b8;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          .rcf-modal-btn-ghost:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.12);
            color: #e2e8f0;
          }
          .rcf-modal-icon {
            width: 72px;
            height: 72px;
            border-radius: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            font-size: 36px;
          }
          .rcf-modal-title {
            margin: 0 0 8px;
            color: #f1f5f9;
            font-size: 22px;
            font-weight: 600;
          }
          .rcf-modal-subtitle {
            margin: 0;
            color: #94a3b8;
            font-size: 14px;
            line-height: 1.5;
          }
          .rcf-modal-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #cbd5e1;
            font-size: 13px;
          }
          .rcf-modal-error {
            color: #f87171;
            font-size: 12px;
            margin: 8px 0 0;
            display: none;
          }
          .rcf-code-input {
            width: 100%;
            padding: 18px;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            font-size: 28px;
            text-align: center;
            letter-spacing: 12px;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace;
            color: #f1f5f9;
            box-sizing: border-box;
          }
          .rcf-code-input:focus {
            outline: none;
            border-color: #10b981;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
          }
        `;
        document.head.appendChild(style);
      }

      return overlay;
    }

    waitForDOM() {
      return new Promise(function(resolve) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', resolve);
        } else {
          resolve();
        }
      });
    }

    /**
     * Collect matches across the document *and* any open shadow roots.
     *
     * querySelectorAll stops at a shadow boundary, so every element inside a web
     * component was previously invisible to the widget. Closed roots stay
     * unreachable by design — there is no API for them.
     */
    queryDeep(selector, root, out) {
      const results = out || [];
      const scope = root || document;

      Array.prototype.push.apply(results, Array.prototype.slice.call(scope.querySelectorAll(selector)));

      const all = scope.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) this.queryDeep(selector, all[i].shadowRoot, results);
      }

      return results;
    }

    scanForContent() {
      const self = this;
      const selector = 'h1, h2, h3, h4, h5, h6, p, span, li, td, th, label, button, ' +
                       'a.rcf-editable-link, img, div[data-rcf-content]';
      const textElements = this.queryDeep(selector);

      textElements.forEach(function(element, index) {
        if (self.shouldSkipElement(element)) return;

        // An <img> is identified by its source, not by text content.
        const isImage = element.tagName === 'IMG';
        const text = isImage ? (element.getAttribute('src') || '') : self.getElementText(element);
        if (!text || text.trim().length < 2) return;

        const elementId = element.getAttribute('data-rcf-id') || 'rcf-' + SITE_ID + '-' + Date.now() + '-' + index;
        element.setAttribute('data-rcf-id', elementId);

        self.elements.set(elementId, {
          element: element,
          originalContent: text,
          selector: self.generateSelector(element),
          type: element.tagName.toLowerCase()
        });

        if (self.editMode) {
          element.classList.add('rcf-editable');
        }
      });

      console.log('ReCopyFast: Found ' + this.elements.size + ' editable elements');
    }

    shouldSkipElement(element) {
      const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'];
      if (skipTags.includes(element.tagName)) return true;
      if (element.hasAttribute('data-rcf-ignore')) return true;
      if (element.closest('[contenteditable="true"]')) return true;
      if (element.closest('#rcf-staging-banner')) return true;
      if (element.closest('#rcf-edit-board')) return true;
      if (element.closest('.rcf-overlay')) return true;
      if (element.closest('[data-rcf-ignore]')) return true;

      // Images carry no text, so the "has real text" test below would reject
      // every one of them. Filter on rendered size instead: tracking pixels,
      // spacers and tiny icons are not content anyone wants to edit.
      if (element.tagName === 'IMG') {
        const MIN_EDITABLE_IMAGE_PX = 48;
        return element.offsetWidth < MIN_EDITABLE_IMAGE_PX ||
               element.offsetHeight < MIN_EDITABLE_IMAGE_PX;
      }

      const hasOnlyElements = Array.from(element.childNodes).every(function(node) {
        return node.nodeType !== Node.TEXT_NODE || !node.textContent.trim();
      });

      return hasOnlyElements && !element.hasAttribute('data-rcf-content');
    }

    getElementText(element) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return element.value;
      }
      return element.textContent;
    }

    /**
     * The editable source text.
     *
     * Never innerText: that returns the *rendered* string, so a heading with
     * `text-transform: uppercase` would round-trip "Ship fast" back into the
     * database as "SHIP FAST" and permanently destroy the author's copy. It
     * also collapses whitespace, which mangles `white-space: pre` blocks.
     */
    getFullElementText(element) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return (element.value || element.placeholder || '').trim();
      }

      const text = Rules.readEditableText(element);

      // Visually truncated copy sometimes stashes the full string out of band.
      if (text.endsWith('...') || text.endsWith('…')) {
        return element.title || element.getAttribute('data-full-text') || text;
      }

      return text;
    }

    /**
     * EDITING STYLE SYSTEM
     *
     * Colour parsing, alpha compositing, backdrop resolution, contrast and the
     * geometry floor all live in src/lib/editingRules.core.ts and are compiled
     * into this file at build time (see the @rcf-inject block above). The
     * methods below are the widget-side adapters — they add no rules of their
     * own, so the app and the widget cannot drift.
     */

    /**
     * Should we intervene to keep this element's text readable while editing,
     * and if so what is the smallest intervention?
     *
     * Returns a verdict whose `scrim` is null in the common case: text that is
     * already legible is left completely alone, because an unnecessary scrim is
     * a visible design change.
     */
    assessReadability(element) {
      return Rules.assessReadability(element);
    }

    /**
     * Caret / selection / outline colours for the surface this element sits on.
     * These paint around and through the text, never replacing it.
     */
    getEditingColors(element) {
      return Rules.resolveAffordances(element);
    }

    // Determine element type for appropriate edit handler
    getElementEditType(element) {
      const tagName = element.tagName.toLowerCase();
      const computed = window.getComputedStyle(element);

      // Image elements
      if (tagName === 'img' ||
          (tagName === 'picture') ||
          (tagName === 'svg' && element.querySelector('image'))) {
        return 'image';
      }

      // Link elements
      if (tagName === 'a') {
        return 'link';
      }

      // Form elements
      if (['input', 'textarea', 'select', 'button'].includes(tagName)) {
        return 'form';
      }

      // Check for ACTUAL animations (not just transitions)
      // Only detect keyframe animations that are actively running
      const animationName = computed.animationName;
      const animationDuration = parseFloat(computed.animationDuration) || 0;

      // Has actual keyframe animation (not 'none', has duration, and is running or exists)
      const hasKeyframeAnimation = animationName !== 'none' &&
                                   animationName !== '' &&
                                   animationDuration > 0;

      // Check for Framer Motion or GSAP markers
      const hasFramerMotion = element.hasAttribute('data-framer-name') ||
                             element.hasAttribute('data-framer-component-type') ||
                             element.classList.contains('framer-motion');
      const hasGSAP = element.hasAttribute('data-gsap') ||
                     element._gsap !== undefined;

      // Only treat as animated if it has REAL animations
      if (hasKeyframeAnimation || hasFramerMotion || hasGSAP) {
        return 'animated';
      }

      // Container elements - check if contains only child elements
      if (['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav'].includes(tagName)) {
        // Check if element has direct text content (not just whitespace)
        const hasDirectText = Array.from(element.childNodes).some(function(node) {
          return node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0;
        });

        if (!hasDirectText && element.children.length > 0) {
          return 'container'; // Not editable - only has child elements
        }
      }

      // Standard text elements
      return 'text';
    }

    generateSelector(element) {
      const path = [];
      let current = element;

      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();

        if (current.id) {
          selector = '#' + current.id;
          path.unshift(selector);
          break;
        }

        if (current.className && typeof current.className === 'string') {
          const classes = current.className.trim().split(/\s+/).filter(function(c) { return !c.startsWith('rcf-'); });
          if (classes.length > 0) {
            selector += '.' + classes.join('.');
          }
        }

        const siblings = Array.from(current.parentNode?.children || []);
        const index = siblings.indexOf(current);
        if (siblings.length > 1) {
          selector += ':nth-child(' + (index + 1) + ')';
        }

        path.unshift(selector);
        current = current.parentNode;
      }

      return path.join(' > ');
    }

    /**
     * Upload an image and get back a hosted URL.
     *
     * Contract (owned by the API agent):
     *   POST /api/upload/image
     *     multipart/form-data: file=<File>, siteId=<uuid>
     *     Authorization: Bearer <site token>
     *   -> 200 { url, width, height } | 400 | 401 | 413
     *
     * XMLHttpRequest rather than fetch because fetch still cannot report upload
     * progress, and a multi-megabyte photo with no feedback reads as a hang.
     */
    uploadImage(file, onProgress) {
      return new Promise(function(resolve, reject) {
        const form = new FormData();
        form.append('file', file);
        form.append('siteId', SITE_ID);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', RECOPYFAST_API + '/upload/image');
        xhr.setRequestHeader('Authorization', 'Bearer ' + SITE_TOKEN);
        xhr.timeout = 120000;

        if (xhr.upload && typeof onProgress === 'function') {
          xhr.upload.onprogress = function(event) {
            if (event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
        }

        xhr.onload = function() {
          let body = {};
          try {
            body = JSON.parse(xhr.responseText || '{}');
          } catch (e) {
            /* fall through to the status-based message */
          }

          if (xhr.status === 200 && body.url) {
            resolve({ url: body.url, width: body.width, height: body.height });
            return;
          }

          if (xhr.status === 401) reject(new Error('Not authorised to upload to this site.'));
          else if (xhr.status === 413) reject(new Error('Image is too large for the server.'));
          else if (xhr.status === 400) reject(new Error(body.error || 'Server rejected this file.'));
          else if (xhr.status === 404) reject(new Error('Image uploads are not enabled yet for this deployment.'));
          else reject(new Error(body.error || 'Upload failed (HTTP ' + xhr.status + ').'));
        };

        xhr.onerror = function() { reject(new Error('Network error during upload.')); };
        xhr.ontimeout = function() { reject(new Error('Upload timed out.')); };
        xhr.onabort = function() { reject(new Error('Upload cancelled.')); };

        xhr.send(form);
      });
    }

    async persistContentUpdate(elementId, content, extra) {
      if (!this.stagingMode) {
        throw new Error('Live editing requires a staging or edit-session token.');
      }

      const tokenQuery = this.editSessionToken
        ? '?rcf_edit_token=' + encodeURIComponent(this.editSessionToken)
        : '?rcf_token=' + encodeURIComponent(this.stagingToken);
      const response = await fetch(RECOPYFAST_API + '/staging/content/' + SITE_ID + tokenQuery, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
          elementId: elementId,
          content: content,
          stagingToken: this.stagingToken || undefined,
          editToken: this.editSessionToken || undefined
        }, extra || {}))
      });

      const result = await response.json().catch(function() { return {}; });
      if (!response.ok || result.error) {
        throw new Error(result.error || 'Failed to save content');
      }

      this.emitRealtimeContentUpdate(Object.assign({
        siteId: SITE_ID,
        elementId: elementId,
        content: content,
        token: SITE_TOKEN,
        stagingMode: this.stagingMode,
        stagingToken: this.stagingToken || '',
        editToken: this.editSessionToken || '',
        persisted: true
      }, extra || {}));

      return result;
    }

    emitRealtimeContentUpdate(payload) {
      if (!this.socket || !this.socket.connected) {
        return;
      }

      try {
        if (typeof this.socket.timeout === 'function') {
          this.socket.timeout(2000).emit('content-update', payload, function(err, response) {
            if (err || (response && response.error)) {
              console.warn('ReCopyFast: Realtime fanout failed:', err || response.error);
            }
          });
        } else {
          this.socket.emit('content-update', payload, function(response) {
            if (response && response.error) {
              console.warn('ReCopyFast: Realtime fanout failed:', response.error);
            }
          });
        }
      } catch (error) {
        console.warn('ReCopyFast: Realtime fanout failed:', error);
      }
    }

    async establishConnection() {
      const self = this;
      try {
        const io = await this.loadSocketIO();

        this.socket = io(RECOPYFAST_WS, {
          query: {
            siteId: SITE_ID,
            editMode: this.editMode,
            token: SITE_TOKEN,
            stagingMode: this.stagingMode,
            stagingToken: this.stagingToken || '',
            editToken: this.editSessionToken || ''
          },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5
        });

        this.socket.on('connect', function() {
          console.log('ReCopyFast: Connected to server');
          self.sendContentMap();
        });

        this.socket.on('content-update', function(data) {
          self.handleContentUpdate(data);
        });

        this.socket.on('ab-test-update', function(data) {
          self.handleABTestUpdate(data);
        });

        this.socket.on('disconnect', function() {
          console.log('ReCopyFast: Disconnected from server');
        });

        this.socket.on('error', function(error) {
          console.error('ReCopyFast: Socket error:', error);
        });

        this.socket.on('auth-error', function(data) {
          console.error('ReCopyFast: Auth error:', data.error);
          if (self.stagingMode) {
            self.showStagingError(data.error);
          }
        });

      } catch (error) {
        console.error('ReCopyFast: Failed to establish connection:', error);
        this.startPolling();
      }
    }

    loadSocketIO() {
      return new Promise(function(resolve, reject) {
        const existing = getSocketIOFactory();
        if (existing) {
          resolve(existing);
          return;
        }

        if (!SOCKET_IO_FALLBACK_URL) {
          reject(new Error('socket.io-client is unavailable and its URL could not be derived from the embed script src'));
          return;
        }

        const script = document.createElement('script');
        script.src = SOCKET_IO_FALLBACK_URL;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.onload = function() {
          const factory = getSocketIOFactory();
          if (factory) {
            resolve(factory);
          } else {
            reject(new Error('socket.io-client loaded but exposed no client factory'));
          }
        };
        script.onerror = function() {
          reject(new Error('Failed to load socket.io-client from ' + SOCKET_IO_FALLBACK_URL));
        };
        document.head.appendChild(script);
      });
    }

    sendContentMap() {
      // Callers include the MutationObserver rescan and the public `rescan()`
      // API, both of which can fire while we're in polling fallback mode with
      // no socket at all.
      if (!this.socket) {
        return;
      }

      const contentMap = {};

      this.elements.forEach(function(data, elementId) {
        contentMap[elementId] = {
          selector: data.selector,
          content: data.originalContent,
          type: data.type
        };
      });

      this.socket.emit('content-map', {
        siteId: SITE_ID,
        url: window.location.href,
        token: SITE_TOKEN,
        stagingMode: this.stagingMode,
        stagingToken: this.stagingToken,
        contentMap: contentMap
      });
    }

    // ==========================================
    // A/B TESTING METHODS
    // ==========================================

    initVisitorId() {
      // Read existing cookie
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var cookie = cookies[i].trim();
        if (cookie.indexOf('rcf_vid=') === 0) {
          this.visitorId = cookie.substring(8);
          return;
        }
      }

      // Generate new visitor ID
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        this.visitorId = crypto.randomUUID();
      } else {
        this.visitorId = 'rcf-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
      }

      // Set first-party cookie (1 year)
      document.cookie = 'rcf_vid=' + this.visitorId + '; path=/; max-age=31536000; SameSite=Lax';
    }

    async fetchActiveTests() {
      try {
        var response = await fetch(
          RECOPYFAST_API + '/ab-tests/active/' + SITE_ID + '?token=' + encodeURIComponent(SITE_TOKEN)
        );
        if (!response.ok) return;
        var data = await response.json();
        this.activeTests = data.tests || [];
      } catch (error) {
        // Silent failure — A/B tests won't run if fetch fails
        console.log('ReCopyFast: A/B tests unavailable');
        this.activeTests = [];
      }
    }

    async bucketVisitor() {
      if (!this.activeTests.length || !this.visitorId) return;

      try {
        var response = await fetch(
          RECOPYFAST_API + '/ab-tests/bucket/' + SITE_ID +
          '?token=' + encodeURIComponent(SITE_TOKEN) +
          '&visitor_id=' + encodeURIComponent(this.visitorId)
        );

        if (response.ok) {
          var data = await response.json();
          this.variantAssignments = data.assignments || {};
          this.geoData = data.geo || null;
          return;
        }
      } catch (error) {
        // Fallback: client-side deterministic bucketing
        console.log('ReCopyFast: Using client-side bucketing fallback');
      }

      // Client-side fallback using FNV-1a hash
      var self = this;
      this.activeTests.forEach(function(test) {
        if (self.variantAssignments[test.id]) return;

        var hash = self.fnv1aHash(self.visitorId + ':' + test.id);
        var bucket = hash % 100;
        var cumulative = 0;

        var eligible = test.variants.filter(function(v) { return true; }); // No geo filter in fallback

        for (var i = 0; i < eligible.length; i++) {
          cumulative += eligible[i].traffic_percentage;
          if (bucket < cumulative) {
            self.variantAssignments[test.id] = eligible[i].id;
            break;
          }
        }
      });
    }

    fnv1aHash(str) {
      var hash = 2166136261;
      for (var i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
      }
      return hash;
    }

    applyVariants() {
      var self = this;

      this.activeTests.forEach(function(test) {
        var assignedVariantId = self.variantAssignments[test.id];
        if (!assignedVariantId) return;

        var variant = test.variants.find(function(v) { return v.id === assignedVariantId; });
        if (!variant) return;

        // Skip replacement for control variants — visitor sees original
        if (variant.is_control) return;

        // Find target element by target_element_id in the elements map
        var targetElementId = test.target_element_id;
        if (!targetElementId) return;

        var elementData = self.elements.get(targetElementId);
        if (!elementData || !elementData.element) return;

        // Replace content
        if (elementData.element.tagName === 'INPUT' || elementData.element.tagName === 'TEXTAREA') {
          elementData.element.value = variant.variant_content;
        } else {
          elementData.element.textContent = variant.variant_content;
        }

        // Add data attributes for debugging/tracking
        elementData.element.setAttribute('data-rcf-test', test.id);
        elementData.element.setAttribute('data-rcf-variant', assignedVariantId);
      });
    }

    setupClickTracking() {
      var self = this;

      this.activeTests.forEach(function(test) {
        var targetElementId = test.target_element_id;
        if (!targetElementId) return;

        var elementData = self.elements.get(targetElementId);
        if (!elementData || !elementData.element) return;

        var el = elementData.element;

        // Track clicks on the element or its clickable parent
        var clickTarget = el;
        if (el.tagName !== 'A' && el.tagName !== 'BUTTON') {
          var clickable = el.closest('a, button');
          if (clickable) clickTarget = clickable;
        }

        clickTarget.addEventListener('click', function() {
          var variantId = self.variantAssignments[test.id];
          if (!variantId || !self.visitorId) return;

          self.sendTrackEvent({
            site_id: SITE_ID,
            test_id: test.id,
            variant_id: variantId,
            visitor_id: self.visitorId,
            event_type: 'click',
            geo_country: self.geoData ? self.geoData.country : null,
            geo_region: self.geoData ? self.geoData.region : null
          });
        });
      });
    }

    trackImpressions() {
      var self = this;
      var events = [];

      this.activeTests.forEach(function(test) {
        var variantId = self.variantAssignments[test.id];
        if (!variantId || !self.visitorId) return;

        events.push({
          site_id: SITE_ID,
          test_id: test.id,
          variant_id: variantId,
          visitor_id: self.visitorId,
          event_type: 'view',
          geo_country: self.geoData ? self.geoData.country : null,
          geo_region: self.geoData ? self.geoData.region : null
        });
      });

      if (events.length > 0) {
        this.sendTrackEvent(events);
      }
    }

    trackConversion(eventName, value) {
      var self = this;
      var events = [];

      this.activeTests.forEach(function(test) {
        var variantId = self.variantAssignments[test.id];
        if (!variantId || !self.visitorId) return;

        events.push({
          site_id: SITE_ID,
          test_id: test.id,
          variant_id: variantId,
          visitor_id: self.visitorId,
          event_type: 'conversion',
          value: value || 1,
          metadata: { event_name: eventName },
          geo_country: self.geoData ? self.geoData.country : null,
          geo_region: self.geoData ? self.geoData.region : null
        });
      });

      if (events.length > 0) {
        this.sendTrackEvent(events);
      }
    }

    sendTrackEvent(eventOrEvents) {
      var payload = JSON.stringify(Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]);
      var url = RECOPYFAST_API + '/ab-tests/track?token=' + encodeURIComponent(SITE_TOKEN);

      // Use sendBeacon for reliability (fires even on page unload)
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        // Fallback to fetch
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function() {});
      }
    }

    handleABTestUpdate(data) {
      var self = this;
      if (data.status === 'active') {
        // Reload test config
        this.fetchActiveTests().then(function() {
          return self.bucketVisitor();
        }).then(function() {
          self.applyVariants();
          self.setupClickTracking();
          self.trackImpressions();
        });
      } else if (data.status === 'completed') {
        // Remove test from active list, winner content stays applied
        self.activeTests = self.activeTests.filter(function(t) { return t.id !== data.test_id; });
        delete self.variantAssignments[data.test_id];
      }
    }

    // ==========================================
    // END A/B TESTING METHODS
    // ==========================================

    handleContentUpdate(data) {
      const elementId = data.elementId;
      const content = data.content;
      const language = data.language;
      const variant = data.variant;

      if ((language && language !== 'en') || (variant && variant !== 'default')) {
        return;
      }

      const elementData = this.elements.get(elementId);
      if (!elementData) return;

      const target = elementData.element;

      // Never overwrite what someone is actively typing.
      if (target.getAttribute('data-rcf-editing')) return;

      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        target.value = content;
      } else if (target.tagName === 'IMG') {
        // Same no-reflow swap the editor uses, so a realtime update from another
        // session cannot resize the page under the reader.
        applyImageSource(target, content);
        if (data.alt !== undefined && data.alt !== null) target.alt = data.alt;
      } else {
        target.textContent = content;
      }

      elementData.element.classList.add('rcf-updated');
      setTimeout(function() {
        elementData.element.classList.remove('rcf-updated');
      }, 300);
    }

    setupMutationObserver() {
      const self = this;
      this.observer = new MutationObserver(function(mutations) {
        let shouldRescan = false;

        mutations.forEach(function(mutation) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            shouldRescan = true;
          }
        });

        if (shouldRescan) {
          clearTimeout(self.rescanTimeout);
          self.rescanTimeout = setTimeout(function() {
            self.scanForContent();
            self.sendContentMap();
          }, 500);
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    setupEditMode() {
      if (!this.editMode) return;

      const self = this;
      this.injectStyles();

      document.addEventListener('click', function(e) {
        const element = e.target.closest('[data-rcf-id]');
        if (!element) return;

        e.preventDefault();
        e.stopPropagation();

        // Route to appropriate handler based on element type
        const editType = self.getElementEditType(element);

        switch (editType) {
          case 'image':
            self.openImageEditor(element);
            break;
          case 'link':
            self.startLinkEdit(element);
            break;
          case 'animated':
            self.startAnimatedEdit(element);
            break;
          case 'form':
            self.startFormEdit(element);
            break;
          case 'container':
            self.showContainerHint(element);
            break;
          case 'text':
          default:
            self.startInlineEdit(element);
            break;
        }
      });

      // One reusable hint node rather than a pseudo-element per target, so no
      // editable element needs `position: relative` to anchor it.
      let hoverHint = null;
      const showHint = function(element) {
        if (!hoverHint) {
          hoverHint = document.createElement('div');
          hoverHint.className = 'rcf-hover-hint';
          hoverHint.textContent = '✏️ Click to edit';
          hoverHint.setAttribute('data-rcf-ignore', '');
          document.body.appendChild(hoverHint);
        }
        hoverHint.style.display = 'flex';

        const r = element.getBoundingClientRect();
        const h = hoverHint.offsetHeight || 28;
        const w = hoverHint.offsetWidth || 120;
        const top = r.top - h - 8 < 4 ? r.bottom + 8 : r.top - h - 8;
        let left = r.left + r.width / 2 - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        hoverHint.style.top = top + 'px';
        hoverHint.style.left = left + 'px';
      };
      const hideHint = function() {
        if (hoverHint) hoverHint.style.display = 'none';
      };

      document.addEventListener('mouseover', function(e) {
        const element = e.target.closest('[data-rcf-id]');
        if (element && !element.getAttribute('data-rcf-editing')) {
          element.classList.add('rcf-hovering');
          showHint(element);
        }
      });

      document.addEventListener('mouseout', function(e) {
        const element = e.target.closest('[data-rcf-id]');
        if (element) {
          element.classList.remove('rcf-hovering');
          hideHint();
        }
      });

      this.hideHoverHint = hideHint;
    }

    injectStyles() {
      const style = document.createElement('style');
      style.textContent = `
        /*
         * Nothing here may participate in layout.
         *
         * The previous version set \`position: relative\` and \`transition: all\`
         * on every editable element the moment edit mode turned on, which moves
         * absolutely-positioned children, creates stacking contexts across the
         * whole page, and animates every property we subsequently touch.
         * Outline, cursor and colour are the only safe affordances: outline is
         * painted outside the box and never reflows anything.
         */
        .rcf-hovering {
          cursor: pointer !important;
          outline: 2px dashed rgba(59, 130, 246, 0.6) !important;
          outline-offset: 4px !important;
        }
        /*
         * The hover hint used to be an ::before/::after on the element itself,
         * which needed \`position: relative\` on every editable element to anchor
         * it. It is now a single fixed-position node positioned from JS, so the
         * page's own layout is never touched.
         */
        .rcf-hover-hint {
          position: fixed;
          display: flex;
          align-items: center;
          gap: 6px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%);
          color: #e2e8f0;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          white-space: nowrap;
          z-index: 9998;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        /*
         * EDIT AFFORDANCE — layout-neutral by construction.
         *
         * Everything the previous version put here changed layout: min/max
         * width and height taken from getBoundingClientRect (which an ancestor
         * transform has already scaled, so a scale(1.35) parent grew the element
         * by 35% on every edit), \`overflow: hidden\` (establishes a block
         * formatting context, so margins stop collapsing and the page shifts),
         * \`contain: layout style\`, a forced \`white-space\`, and a border-radius
         * override. None of that is needed: contenteditable does not resize an
         * element, so the correct number of geometry properties to set is zero.
         * The one floor we do apply — min-height, from computed layout px — is
         * set inline per element in startTextEdit so it can never come from a
         * transformed rect.
         */
        .rcf-editing {
          user-select: text !important;
          -webkit-user-select: text !important;
          cursor: text !important;
        }
        .rcf-editing:focus,
        .rcf-editing:focus-visible {
          /* The outline colour is set inline per element from the backdrop. */
          outline-style: solid !important;
          outline-width: 2px !important;
          outline-offset: 2px !important;
        }
        /* Inline edit toolbar — fixed, floats above the edited element */
        .rcf-actions-inline {
          position: fixed;
          display: flex;
          gap: 6px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          z-index: 10000;
          white-space: nowrap;
          pointer-events: auto;
        }
        .rcf-actions-inline button {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .rcf-actions-inline button:hover {
          transform: translateY(-1px);
        }
        .rcf-actions-inline button:active {
          transform: scale(0.98);
        }
        /* Character counter for in-place editing */
        .rcf-char-counter-inline {
          position: fixed;
          font-size: 11px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          padding: 4px 10px;
          border-radius: 6px;
          backdrop-filter: blur(8px);
          z-index: 10000;
          white-space: nowrap;
          pointer-events: none;
        }
        .rcf-actions {
          position: fixed;
          display: flex;
          gap: 6px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          z-index: 10000;
        }
        .rcf-actions button {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .rcf-actions button:hover {
          transform: translateY(-1px);
        }
        .rcf-actions button:active {
          transform: scale(0.98);
        }
        .rcf-btn-save {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        }
        .rcf-btn-save:hover {
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
        }
        .rcf-btn-cancel {
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .rcf-btn-cancel:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #e2e8f0;
        }
        .rcf-btn-ai {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
          color: #a78bfa;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }
        .rcf-btn-ai:hover {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(59, 130, 246, 0.3) 100%);
          color: #c4b5fd;
        }
        .rcf-updated {
          animation: rcf-highlight 0.6s ease;
        }
        @keyframes rcf-fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes rcf-highlight {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          50% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.3); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        /*
         * Extra scalar fields (a link's href) for the in-place renderer. Fixed
         * to the viewport and parented to <body>, so the edited element is never
         * wrapped or reparented to host them.
         */
        .rcf-field-panel {
          position: fixed;
          z-index: 10000;
          min-width: 280px;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid transparent;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .rcf-field-panel label {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
          opacity: 0.75;
        }
        .rcf-field-panel input {
          width: 100%;
          padding: 8px 12px;
          background: rgba(127, 127, 127, 0.12);
          border: 1px solid transparent;
          border-radius: 6px;
          font-size: 13px;
          outline: none;
          font-family: inherit;
        }
        .rcf-field-panel input:focus {
          border-color: rgba(59, 130, 246, 0.6);
        }
        /* Animation indicator — fixed to the viewport, never a child of the
           edited element (its label used to leak into the saved content). */
        .rcf-animation-indicator {
          position: fixed;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 10001;
          background: rgba(251, 191, 36, 0.22);
          border: 1px solid rgba(251, 191, 36, 0.45);
          color: #b45309;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          white-space: nowrap;
        }
        /* Form popover */
        .rcf-form-popover input:focus {
          border-color: rgba(59, 130, 246, 0.5);
          background: rgba(255, 255, 255, 0.08);
        }
        /* Container hint animation */
        @keyframes rcf-hintFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .rcf-container-hint {
          animation: rcf-hintFadeIn 0.3s ease forwards;
        }
        /* Modal animation */
        @keyframes rcf-modal-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        /* Image editor specific */
        .rcf-modal img {
          transition: opacity 0.2s ease;
        }
        .rcf-modal img.loading {
          opacity: 0.5;
        }
      `;
      document.head.appendChild(style);
    }

    /**
     * Rough capacity estimate for the character counter.
     *
     * Uses computed layout px, not offsetWidth: offsetWidth is scaled by any
     * ancestor transform or zoom, which would make the same paragraph report a
     * different capacity purely because a parent was scaled.
     *
     * Only meaningful once web fonts have settled — a fallback face has
     * different advance widths, so a count taken before the swap is wrong by
     * however much the two faces differ.
     */
    calculateMaxChars(element) {
      const CONTENT_LIMITS = {
        minChars: 50,
        maxCharsAbsolute: 2000,
        maxCharsDefault: 500
      };

      try {
        const computed = window.getComputedStyle(element);
        const width = parseFloat(computed.width) || 0;
        const height = parseFloat(computed.height) || 0;
        const fontSize = parseFloat(computed.fontSize) || 16;
        const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2;

        // ~0.5em average advance width is crude but this only drives a hint.
        const charsPerLine = Math.floor(width / (fontSize * 0.5));
        const maxLines = Math.max(1, Math.floor(height / lineHeight));
        const maxChars = Math.floor(charsPerLine * maxLines * 0.8);

        return Math.max(
          CONTENT_LIMITS.minChars,
          Math.min(maxChars || CONTENT_LIMITS.maxCharsDefault, CONTENT_LIMITS.maxCharsAbsolute)
        );
      } catch (e) {
        return CONTENT_LIMITS.maxCharsDefault;
      }
    }

    /**
     * Would this content grow the element past its current box?
     *
     * The probe clone inherits the element's own white-space and width rather
     * than being forced to `pre-wrap` at `offsetWidth`, which previously made
     * `nowrap` and `pre` elements report overflow for content that fits.
     */
    checkOverflow(element, newContent) {
      try {
        const computed = window.getComputedStyle(element);
        const ghost = element.cloneNode(false);

        ghost.removeAttribute('id');
        ghost.removeAttribute('data-rcf-id');
        ghost.removeAttribute('data-rcf-editing');
        ghost.removeAttribute('data-rcf-edit-session');
        ghost.removeAttribute('contenteditable');
        ghost.className = '';
        ghost.textContent = newContent;

        ghost.style.cssText = [
          'position: absolute',
          'visibility: hidden',
          'pointer-events: none',
          'left: -99999px',
          'top: 0',
          'width: ' + (parseFloat(computed.width) || 0) + 'px',
          'height: auto',
          'max-height: none',
          'min-height: 0',
          'overflow: visible',
          'font: ' + computed.font,
          'letter-spacing: ' + computed.letterSpacing,
          'word-spacing: ' + computed.wordSpacing,
          'white-space: ' + computed.whiteSpace,
          'word-break: ' + computed.wordBreak,
          'padding: ' + computed.padding,
          'text-transform: ' + computed.textTransform
        ].join('; ');

        const host = element.parentNode || document.body;
        host.appendChild(ghost);
        const grew = ghost.scrollHeight > (parseFloat(computed.height) || 0) * 1.1;
        host.removeChild(ghost);

        return grew;
      } catch (e) {
        return false;
      }
    }

    /**
     * THE TEXT RENDERER — the only one.
     *
     * Every text-ish edit (plain copy, links, animated elements, buttons) runs
     * through here. It makes the element itself contenteditable and changes
     * nothing that participates in layout.
     *
     * Why in place rather than an overlay: an overlay has to re-derive every
     * visual property the browser was already applying — font stack, size,
     * weight, tracking, transform, decoration, alignment, direction, writing
     * mode, blend mode, clip, inherited cascade, author !important rules — and
     * it will always miss some. Editing the element itself means there is
     * nothing to re-derive: the browser keeps painting exactly what it was
     * painting. Zero delta is reachable by construction here and unreachable by
     * construction with a substitute node.
     *
     * options:
     *   fields[]         extra scalar inputs (link href) rendered in a popover
     *   onStart(el)      pre-edit hook, may return a teardown function
     *   payload(values)  extra body merged into the persist call
     */
    startTextEdit(element, options) {
      const self = this;
      const opts = options || {};

      const elementId = element.getAttribute('data-rcf-id');
      const elementData = this.elements.get(elementId);
      if (!elementData || element.getAttribute('data-rcf-editing')) return;

      // ---------------------------------------------------------------------
      // Capture everything BEFORE mutating anything.
      // ---------------------------------------------------------------------

      // Restoring this attribute verbatim is the only teardown that cannot
      // clobber an author's own inline styles. Blanking individual properties
      // (the previous approach) permanently deleted any inline background,
      // outline or caret the page had set itself.
      const originalStyleAttr = element.getAttribute('style');

      // Read the text before any hook can append UI into the element — the old
      // animated path appended its "Animation paused" badge as a child first,
      // so that string ended up inside the user's editable content and got
      // saved into the database.
      const originalText = this.getFullElementText(element);
      const hadMarkup = Rules.hasMarkupChildren(element);

      const teardown = [];
      if (typeof opts.onStart === 'function') {
        const undo = opts.onStart(element);
        if (typeof undo === 'function') teardown.push(undo);
      }

      /*
       * Neutralise element-level compositing that makes the painted result
       * unknowable, BEFORE assessing readability.
       *
       * `mix-blend-mode` blends the element's whole rendering — background,
       * scrim and glyphs together — with whatever is behind it, so a scrim
       * cannot rescue it. Under `difference`, white text over a dark scrim
       * paints as |255-B| against |20-B|; at B around 137 those converge to
       * 118 vs 117 and the text vanishes no matter how opaque the scrim is.
       * The same applies to a `filter` on the element itself: it transforms the
       * scrim along with everything else, so `invert(1)` turns a darkening
       * scrim into a lightening one.
       *
       * Both are therefore switched off for the duration of the edit. That is a
       * visible change, and it is the deliberate trade: while the user is
       * actively typing, being able to read the text wins over reproducing an
       * effect whose painted result we cannot predict — and cannot honestly
       * claim a contrast ratio for. Restored wholesale by the style-attribute
       * restore in cleanup().
       *
       * An ancestor's blend/filter is left alone: it transforms the element and
       * its backdrop together, and resolveBackdrop still reports it as
       * uncertain so the scrim is solved for the worst case.
       */
      const preEdit = window.getComputedStyle(element);
      // Read to primitives first — getComputedStyle returns a LIVE view, so
      // holding the object and reading it later gives post-mutation values.
      const preEditBlend = String(preEdit.mixBlendMode || 'normal');
      const preEditFilter = String(preEdit.filter || 'none');

      if (preEditBlend !== 'normal') {
        element.style.setProperty('mix-blend-mode', 'normal', 'important');
      }
      if (preEditFilter !== 'none') {
        element.style.setProperty('filter', 'none', 'important');
      }

      const computed = window.getComputedStyle(element);
      const floor = Rules.measureLayoutFloor(element);
      const verdict = Rules.assessReadability(element);
      const colors = Rules.resolveAffordances(element);
      const originalBoxShadow = String(computed.boxShadow);

      element.setAttribute('data-rcf-editing', 'true');
      element.classList.add('rcf-editing');
      element.classList.remove('rcf-hovering');
      if (this.hideHoverHint) this.hideHoverHint();

      const editSessionId = 'rcf-edit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      element.setAttribute('data-rcf-edit-session', editSessionId);

      // ---------------------------------------------------------------------
      // Affordances. Outline, caret and ::selection only — none of these
      // participate in layout, so none of them can move a single glyph.
      // ---------------------------------------------------------------------
      const selectionStyle = document.createElement('style');
      selectionStyle.id = editSessionId + '-styles';
      const sel = '[data-rcf-edit-session="' + editSessionId + '"]';
      selectionStyle.textContent = [
        sel + '::selection { background: ' + colors.selectionBackground + '; color: ' + colors.selectionColor + '; }',
        sel + '::-moz-selection { background: ' + colors.selectionBackground + '; color: ' + colors.selectionColor + '; }'
      ].join('\n');
      document.head.appendChild(selectionStyle);

      element.style.setProperty('outline', '2px solid ' + colors.outlineColor, 'important');
      element.style.setProperty('outline-offset', '2px', 'important');
      element.style.setProperty('caret-color', colors.caretColor, 'important');

      // R3/R4: the author's text colour is never touched. When the text cannot
      // be proven readable we slide the smallest possible scrim behind it, as an
      // inset box-shadow rather than a background-color so the element's own
      // background (gradient, image, translucent panel) still shows through and
      // the author's border-radius is respected for free.
      if (verdict.scrim) {
        const scrim = 'inset 0 0 0 9999px ' + verdict.scrim;
        element.style.setProperty(
          'box-shadow',
          originalBoxShadow && originalBoxShadow !== 'none' ? scrim + ', ' + originalBoxShadow : scrim,
          'important'
        );
      }

      // R7: a floor so an emptied element cannot collapse to nothing and yank
      // the toolbar across the screen. Computed layout px, never a rect — a
      // rect has already been multiplied by any ancestor transform or zoom.
      // Deliberately no maximum: text that grows should reflow live, because
      // that is what the page will look like once it is saved.
      if (!floor.inline && floor.minHeight > 0) {
        element.style.setProperty('min-height', floor.minHeight + 'px');
      }

      element.setAttribute('contenteditable', 'true');
      element.setAttribute('spellcheck', 'true');
      element.setAttribute('role', 'textbox');
      element.setAttribute('aria-multiline', floor.preservesWhitespace ? 'true' : 'false');

      // ---------------------------------------------------------------------
      // Chrome: toolbar, counter and any extra fields, all fixed-position body
      // children so the edited element is never reparented or wrapped.
      // ---------------------------------------------------------------------
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'rcf-actions-inline';
      actionsDiv.setAttribute('data-rcf-toolbar', editSessionId);
      actionsDiv.setAttribute('data-rcf-ignore', '');

      const aiBtn = document.createElement('button');
      aiBtn.className = 'rcf-btn-ai';
      aiBtn.type = 'button';
      aiBtn.title = 'AI Suggestions';
      aiBtn.textContent = '🪄 AI';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'rcf-btn-save';
      saveBtn.type = 'button';
      saveBtn.title = 'Save changes (Cmd/Ctrl + Enter)';
      saveBtn.textContent = '✓ Save';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'rcf-btn-cancel';
      cancelBtn.type = 'button';
      cancelBtn.title = 'Cancel editing (Esc)';
      cancelBtn.textContent = '✕ Cancel';

      actionsDiv.appendChild(aiBtn);
      actionsDiv.appendChild(saveBtn);
      actionsDiv.appendChild(cancelBtn);

      const counter = document.createElement('div');
      counter.className = 'rcf-char-counter-inline';
      counter.setAttribute('data-rcf-counter', editSessionId);
      counter.setAttribute('data-rcf-ignore', '');
      counter.style.color = colors.chromeText;
      counter.style.background = colors.chromeBackground;
      counter.style.border = '1px solid ' + colors.chromeBorder;

      // Extra scalar fields (a link's href) live in their own popover instead of
      // being nested inside a replacement element.
      const fieldDefs = opts.fields || [];
      const fieldInputs = [];
      let fieldsPanel = null;

      if (fieldDefs.length) {
        fieldsPanel = document.createElement('div');
        fieldsPanel.className = 'rcf-field-panel';
        fieldsPanel.setAttribute('data-rcf-ignore', '');
        fieldsPanel.style.background = colors.chromeBackground;
        fieldsPanel.style.borderColor = colors.chromeBorder;

        fieldDefs.forEach(function(def) {
          const label = document.createElement('label');
          label.textContent = def.label;
          label.style.color = colors.chromeText;

          const input = document.createElement('input');
          input.type = def.type || 'text';
          input.placeholder = def.placeholder || '';
          input.value = def.get(element) || '';
          input.style.color = colors.chromeText;
          input.style.borderColor = colors.chromeBorder;

          fieldsPanel.appendChild(label);
          fieldsPanel.appendChild(input);
          fieldInputs.push({ def: def, input: input, initial: input.value });
        });
      }

      document.body.appendChild(actionsDiv);
      document.body.appendChild(counter);
      if (fieldsPanel) document.body.appendChild(fieldsPanel);

      // ---------------------------------------------------------------------
      // Positioning. Fixed viewport coordinates, recomputed whenever anything
      // that could move the element moves it: page or container scroll, window
      // or visual-viewport resize, the element reflowing (ResizeObserver), and
      // late web fonts landing.
      // ---------------------------------------------------------------------
      let frame = 0;
      const reposition = function() {
        const r = element.getBoundingClientRect();
        const GAP = 8;

        const th = actionsDiv.offsetHeight || 44;
        const tw = actionsDiv.offsetWidth || 200;
        let top = r.top - th - GAP;
        if (top < 4) top = r.bottom + GAP;
        let left = r.left + r.width / 2 - tw / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
        actionsDiv.style.top = top + 'px';
        actionsDiv.style.left = left + 'px';

        const cw = counter.offsetWidth || 80;
        counter.style.top = (r.bottom + 4) + 'px';
        counter.style.left = Math.max(8, Math.min(r.right - cw, window.innerWidth - cw - 8)) + 'px';

        if (fieldsPanel) {
          const fw = fieldsPanel.offsetWidth || 280;
          const fh = fieldsPanel.offsetHeight || 90;
          let fTop = r.bottom + 28;
          if (fTop + fh > window.innerHeight - 8) fTop = Math.max(8, r.top - fh - 28);
          fieldsPanel.style.top = fTop + 'px';
          fieldsPanel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - fw - 8)) + 'px';
        }
      };
      const scheduleReposition = function() {
        if (frame) return;
        frame = requestAnimationFrame(function() {
          frame = 0;
          reposition();
        });
      };

      reposition();

      window.addEventListener('scroll', scheduleReposition, true);
      window.addEventListener('resize', scheduleReposition);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleReposition);
        window.visualViewport.addEventListener('scroll', scheduleReposition);
      }

      let resizeObserver = null;
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(scheduleReposition);
        resizeObserver.observe(element);
      }

      // A web font landing mid-edit reflows the element under the toolbar.
      Rules.whenFontsReady(window).then(scheduleReposition);

      // ---------------------------------------------------------------------
      // Content
      // ---------------------------------------------------------------------
      const sanitizeContent = function() {
        // textContent, never innerText: innerText applies text-transform, so an
        // uppercase heading would save back as SHOUTING and overwrite the
        // author's real copy. It also collapses the whitespace <pre> depends on.
        const raw = element.textContent || '';
        return floor.preservesWhitespace ? raw : raw.trim();
      };

      let maxChars = self.calculateMaxChars(element);
      const updateCounter = function() {
        const current = sanitizeContent().length;
        counter.textContent = current + ' / ' + maxChars;

        if (current > maxChars) {
          counter.style.color = '#ef4444';
          counter.style.background = 'rgba(239, 68, 68, 0.2)';
          counter.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        } else if (current > maxChars * 0.9) {
          counter.style.color = '#f59e0b';
          counter.style.background = 'rgba(245, 158, 11, 0.2)';
          counter.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        } else {
          counter.style.color = colors.chromeText;
          counter.style.background = colors.chromeBackground;
          counter.style.borderColor = colors.chromeBorder;
        }
      };

      // Recount once the real font is in play.
      Rules.whenFontsReady(window).then(function() {
        maxChars = self.calculateMaxChars(element);
        updateCounter();
      });

      element.addEventListener('input', updateCounter);
      element.addEventListener('input', scheduleReposition);
      updateCounter();

      // preventScroll: focusing an element inside a scroll container otherwise
      // scrolls it, which is a visible jump the user did not ask for.
      try {
        element.focus({ preventScroll: true });
      } catch (e) {
        element.focus();
      }

      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // ---------------------------------------------------------------------
      // Lifecycle
      // ---------------------------------------------------------------------
      let isCleaningUp = false;
      let unloadGuard = null;

      const cleanup = function() {
        if (isCleaningUp) return;
        isCleaningUp = true;

        if (unloadGuard) {
          window.removeEventListener('beforeunload', unloadGuard);
          unloadGuard = null;
        }

        window.removeEventListener('scroll', scheduleReposition, true);
        window.removeEventListener('resize', scheduleReposition);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', scheduleReposition);
          window.visualViewport.removeEventListener('scroll', scheduleReposition);
        }
        if (resizeObserver) resizeObserver.disconnect();
        if (frame) cancelAnimationFrame(frame);
        document.removeEventListener('mousedown', outsideClickHandler);

        element.removeAttribute('contenteditable');
        element.removeAttribute('spellcheck');
        element.removeAttribute('role');
        element.removeAttribute('aria-multiline');
        element.removeAttribute('data-rcf-editing');
        element.removeAttribute('data-rcf-edit-session');
        element.classList.remove('rcf-editing');

        // Verbatim restore — puts back exactly the inline styles the page had,
        // including none at all.
        if (originalStyleAttr === null) element.removeAttribute('style');
        else element.setAttribute('style', originalStyleAttr);

        [actionsDiv, counter, fieldsPanel].forEach(function(node) {
          if (node && node.parentNode) node.parentNode.removeChild(node);
        });

        const dynamicStyle = document.getElementById(editSessionId + '-styles');
        if (dynamicStyle) dynamicStyle.remove();

        teardown.forEach(function(fn) {
          try { fn(); } catch (e) { console.warn('ReCopyFast: edit teardown failed', e); }
        });
      };

      const fieldsDirty = function() {
        return fieldInputs.some(function(f) { return f.input.value !== f.initial; });
      };

      /*
       * Editing happens on the customer's own page, where a stray link click,
       * a router push or a form submit can navigate away mid-edit and silently
       * discard everything typed since the editor opened. The browser's own
       * confirmation is the only thing that can interrupt a navigation, and it
       * only fires if a handler is registered while the work is actually dirty.
       */
      unloadGuard = function(event) {
        if (isCleaningUp) return undefined;
        if (sanitizeContent() === originalText && !fieldsDirty()) return undefined;
        event.preventDefault();
        // Legacy browsers require returnValue to be set for the prompt to show.
        event.returnValue = '';
        return '';
      };
      window.addEventListener('beforeunload', unloadGuard);

      const save = async function() {
        const newContent = sanitizeContent();
        const textChanged = newContent !== originalText;

        // Clicking into an element and back out must be a no-op. Rewriting
        // textContent unconditionally flattened every <strong>/<em>/<a> the
        // author had inside the element, so merely opening an editor destroyed
        // their markup.
        if (!textChanged && !fieldsDirty()) {
          cleanup();
          return;
        }

        if (textChanged && newContent.length > 2000) {
          if (!confirm('Content exceeds 2000 characters. This may cause issues. Save anyway?')) return;
        }
        if (textChanged && hadMarkup) {
          if (!confirm('This element contains formatting (bold, links, emphasis) that will be replaced by plain text. Continue?')) return;
        }
        if (textChanged && self.checkOverflow(element, newContent)) {
          if (!confirm('This content may overflow the container and affect layout. Save anyway?')) return;
        }

        const values = {};
        fieldInputs.forEach(function(f) { values[f.def.key] = f.input.value.trim(); });

        try {
          await self.persistContentUpdate(
            elementId,
            newContent,
            typeof opts.payload === 'function' ? opts.payload(values) : undefined
          );
        } catch (error) {
          alert(error.message || 'Failed to save content. Please try again.');
          return;
        }

        if (textChanged) {
          element.textContent = newContent;
          elementData.originalContent = newContent;
        }
        fieldInputs.forEach(function(f) {
          if (f.input.value !== f.initial) f.def.set(element, f.input.value.trim());
        });

        cleanup();

        element.classList.add('rcf-updated');
        setTimeout(function() { element.classList.remove('rcf-updated'); }, 500);
      };

      const cancel = function() {
        // textContent restore is only safe when we would otherwise be leaving
        // edited text behind; if nothing changed, leave the DOM (and any author
        // markup inside it) exactly as it was.
        if (sanitizeContent() !== originalText) element.textContent = originalText;
        cleanup();
      };

      saveBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); save(); };
      cancelBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); cancel(); };
      aiBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        self.showAISuggestions({
          get value() { return sanitizeContent(); },
          set value(v) { element.textContent = v; updateCounter(); scheduleReposition(); }
        }, elementId);
      };

      // Enter saves only where a newline would be meaningless. Multi-line is
      // anything that already contains one, preserves whitespace, or renders
      // taller than two lines.
      const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.2 || 20;
      const isMultiline = originalText.indexOf('\n') !== -1 ||
                          floor.preservesWhitespace ||
                          floor.minHeight > lineHeight * 2;

      element.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        } else if (e.key === 'Enter' && !e.shiftKey && !isMultiline) {
          e.preventDefault();
          save();
        }
      });

      element.addEventListener('paste', function(e) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
        updateCounter();
      });

      fieldInputs.forEach(function(f) {
        f.input.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          else if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
      });

      const outsideClickHandler = function(e) {
        if (element.contains(e.target) ||
            actionsDiv.contains(e.target) ||
            counter.contains(e.target) ||
            (fieldsPanel && fieldsPanel.contains(e.target))) {
          return;
        }
        save();
      };

      setTimeout(function() {
        document.addEventListener('mousedown', outsideClickHandler);
      }, 100);
    }

    /** Plain text. The default path. */
    startInlineEdit(element) {
      this.startTextEdit(element);
    }

    // Image editor modal for image elements
    openImageEditor(element) {
      const self = this;
      const elementId = element.getAttribute('data-rcf-id');
      const elementData = this.elements.get(elementId);
      if (!elementData || element.getAttribute('data-rcf-editing')) return;

      element.setAttribute('data-rcf-editing', 'true');
      element.classList.add('rcf-editing');
      element.classList.remove('rcf-hovering');

      const isImg = element.tagName.toLowerCase() === 'img';
      const currentSrc = isImg ? element.src : (element.style.backgroundImage || '').replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
      const currentAlt = isImg ? element.alt : '';
      const imgComputed = window.getComputedStyle(element);
      const currentWidth = Math.round(parseFloat(imgComputed.width) || 0);
      const currentHeight = Math.round(parseFloat(imgComputed.height) || 0);

      // Set by a successful upload; reported back so the API can store the real
      // intrinsic size alongside the URL.
      let uploadedDimensions = null;

      // Create modal overlay
      const overlay = this.createOverlay();
      const modal = document.createElement('div');
      modal.className = 'rcf-modal';

      // Build modal content using DOM methods
      const iconContainer = document.createElement('div');
      iconContainer.style.cssText = 'text-align: center; margin-bottom: 24px;';

      const icon = document.createElement('div');
      icon.className = 'rcf-modal-icon';
      icon.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)';
      icon.style.border = '1px solid rgba(59, 130, 246, 0.3)';
      icon.textContent = '🖼️';

      const title = document.createElement('h2');
      title.className = 'rcf-modal-title';
      title.textContent = 'Edit Image';

      const subtitle = document.createElement('p');
      subtitle.className = 'rcf-modal-subtitle';
      subtitle.textContent = 'Replace image or edit properties';

      iconContainer.appendChild(icon);
      iconContainer.appendChild(title);
      iconContainer.appendChild(subtitle);
      modal.appendChild(iconContainer);

      // Current image preview
      const previewContainer = document.createElement('div');
      previewContainer.style.cssText = 'margin-bottom: 20px; padding: 16px; background: rgba(15, 23, 42, 0.5); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1);';

      const previewLabel = document.createElement('p');
      previewLabel.style.cssText = 'margin: 0 0 8px 0; font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;';
      previewLabel.textContent = 'Current Image';

      const previewImg = document.createElement('img');
      previewImg.src = currentSrc;
      previewImg.style.cssText = 'max-width: 100%; max-height: 200px; border-radius: 8px; display: block; margin: 0 auto;';

      const dimensions = document.createElement('p');
      dimensions.style.cssText = 'margin: 8px 0 0 0; font-size: 11px; color: #64748b; text-align: center;';
      dimensions.textContent = currentWidth + ' × ' + currentHeight + ' px';

      previewContainer.appendChild(previewLabel);
      previewContainer.appendChild(previewImg);
      previewContainer.appendChild(dimensions);
      modal.appendChild(previewContainer);

      // URL input
      const urlContainer = document.createElement('div');
      urlContainer.style.cssText = 'margin-bottom: 16px;';

      const urlLabel = document.createElement('label');
      urlLabel.className = 'rcf-modal-label';
      urlLabel.textContent = 'Image URL';

      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.className = 'rcf-modal-input';
      urlInput.value = currentSrc;
      urlInput.placeholder = 'https://example.com/image.jpg';

      urlContainer.appendChild(urlLabel);
      urlContainer.appendChild(urlInput);
      modal.appendChild(urlContainer);

      // Alt text input (for img elements)
      let altInput = null;
      if (isImg) {
        const altContainer = document.createElement('div');
        altContainer.style.cssText = 'margin-bottom: 16px;';

        const altLabel = document.createElement('label');
        altLabel.className = 'rcf-modal-label';
        altLabel.textContent = 'Alt Text (accessibility)';

        altInput = document.createElement('input');
        altInput.type = 'text';
        altInput.className = 'rcf-modal-input';
        altInput.value = currentAlt;
        altInput.placeholder = 'Describe this image';

        altContainer.appendChild(altLabel);
        altContainer.appendChild(altInput);
        modal.appendChild(altContainer);
      }

      // Update preview on URL change
      urlInput.addEventListener('input', function() {
        const url = urlInput.value.trim();
        if (url) {
          previewImg.src = url;
        }
      });

      // File upload button
      const uploadContainer = document.createElement('div');
      uploadContainer.style.cssText = 'margin-bottom: 24px; text-align: center;';

      const uploadLabel = document.createElement('label');
      uploadLabel.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: rgba(59, 130, 246, 0.1); border: 1px dashed rgba(59, 130, 246, 0.5); border-radius: 10px; cursor: pointer; color: #93c5fd; font-size: 14px; transition: all 0.2s;';

      const uploadIcon = document.createElement('span');
      uploadIcon.textContent = '📤';
      const uploadText = document.createElement('span');
      uploadText.textContent = 'Upload New Image';
      uploadLabel.appendChild(uploadIcon);
      uploadLabel.appendChild(uploadText);

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = ACCEPTED_IMAGE_TYPES.join(',');
      fileInput.style.display = 'none';

      // Progress / status line for the upload.
      const uploadStatus = document.createElement('div');
      uploadStatus.style.cssText = 'margin-top: 10px; font-size: 12px; color: #94a3b8; min-height: 16px;';

      const progressTrack = document.createElement('div');
      progressTrack.style.cssText = 'margin-top: 8px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.1); overflow: hidden; display: none;';
      const progressBar = document.createElement('div');
      progressBar.style.cssText = 'height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); transition: width 0.15s ease;';
      progressTrack.appendChild(progressBar);

      fileInput.addEventListener('change', async function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        // Validate before touching the network — a 20MB TIFF should fail here,
        // not after the user has waited for the whole upload.
        const problem = validateImageFile(file);
        if (problem) {
          uploadStatus.style.color = '#f87171';
          uploadStatus.textContent = problem;
          fileInput.value = '';
          return;
        }

        // Keep whatever the user already had. If the upload fails they get it
        // back rather than losing their work.
        const previousUrl = urlInput.value;
        const previousPreview = previewImg.src;

        uploadLabel.style.pointerEvents = 'none';
        uploadLabel.style.opacity = '0.6';
        uploadText.textContent = 'Uploading…';
        uploadStatus.style.color = '#94a3b8';
        uploadStatus.textContent = file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
        progressTrack.style.display = 'block';
        progressBar.style.width = '0%';

        // Show the chosen file immediately; the object URL is revoked once the
        // real URL lands so nothing leaks.
        const localPreview = URL.createObjectURL(file);
        previewImg.src = localPreview;

        try {
          const uploaded = await self.uploadImage(file, function(percent) {
            progressBar.style.width = percent + '%';
          });

          urlInput.value = uploaded.url;
          previewImg.src = uploaded.url;
          uploadedDimensions = { width: uploaded.width, height: uploaded.height };
          uploadStatus.style.color = '#34d399';
          uploadStatus.textContent = 'Uploaded' +
            (uploaded.width && uploaded.height ? ' — ' + uploaded.width + ' × ' + uploaded.height + ' px' : '');
        } catch (error) {
          urlInput.value = previousUrl;
          previewImg.src = previousPreview;
          uploadStatus.style.color = '#f87171';
          uploadStatus.textContent = error.message || 'Upload failed. Your previous image is unchanged.';
        } finally {
          URL.revokeObjectURL(localPreview);
          uploadLabel.style.pointerEvents = '';
          uploadLabel.style.opacity = '';
          uploadText.textContent = 'Upload New Image';
          progressTrack.style.display = 'none';
          fileInput.value = '';
        }
      });

      uploadLabel.appendChild(fileInput);
      uploadContainer.appendChild(uploadLabel);
      uploadContainer.appendChild(progressTrack);
      uploadContainer.appendChild(uploadStatus);
      modal.appendChild(uploadContainer);

      // Action buttons
      const footer = document.createElement('div');
      footer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'rcf-modal-btn rcf-modal-btn-ghost';
      cancelBtn.textContent = 'Cancel';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'rcf-modal-btn rcf-modal-btn-success';
      saveBtn.textContent = 'Save Changes';

      footer.appendChild(cancelBtn);
      footer.appendChild(saveBtn);
      modal.appendChild(footer);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const closeModal = function() {
        element.removeAttribute('data-rcf-editing');
        element.classList.remove('rcf-editing');
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
      };

      cancelBtn.onclick = closeModal;
      overlay.onclick = function(e) {
        if (e.target === overlay) closeModal();
      };

      saveBtn.onclick = async function() {
        const newSrc = urlInput.value.trim();
        if (!newSrc) {
          alert('Please enter an image URL');
          return;
        }

        // A data URI would be stored verbatim in the content row and again in
        // content_history on every subsequent edit — a 2 MB photo becomes ~2.7 MB
        // of base64 per revision. Uploads go through /api/upload/image and come
        // back as a URL; anything else here is a bug or a hand-pasted blob.
        if (/^data:/i.test(newSrc)) {
          alert('Inline image data cannot be saved. Use "Upload New Image" so the file is hosted, or paste an image URL.');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        try {
          await self.persistContentUpdate(elementId, newSrc, {
            contentType: 'image',
            alt: isImg ? altInput.value : null,
            width: uploadedDimensions ? uploadedDimensions.width : undefined,
            height: uploadedDimensions ? uploadedDimensions.height : undefined
          });
        } catch (error) {
          alert(error.message || 'Failed to save image. Please try again.');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
          return;
        }

        if (isImg) {
          applyImageSource(element, newSrc);
          if (altInput) {
            element.alt = altInput.value;
          }
        } else {
          element.style.backgroundImage = 'url("' + newSrc + '")';
        }

        elementData.originalContent = newSrc;

        element.classList.add('rcf-updated');
        setTimeout(function() {
          element.classList.remove('rcf-updated');
        }, 500);

        closeModal();
      };

      document.addEventListener('keydown', function onKeyDown(e) {
        if (e.key === 'Escape') {
          closeModal();
          document.removeEventListener('keydown', onKeyDown);
        }
      });
    }

    /**
     * Links: the same in-place renderer, plus an href field.
     *
     * This used to build a `position: fixed` overlay containing an <input
     * style="all: inherit">. `all: inherit` also inherits `position`, so the
     * input became fixed and its `width/height: 100%` resolved against the
     * viewport instead of the overlay — a 1200x2029px input sitting invisibly on
     * top of the whole page (the overlay's `overflow: hidden` hid the damage but
     * not the mis-laid-out text inside it). Editing the <a> directly has none of
     * these problems and inherits the author's underline, colour and font for
     * free.
     */
    startLinkEdit(element) {
      this.startTextEdit(element, {
        fields: [{
          key: 'href',
          label: 'Link URL',
          type: 'url',
          placeholder: 'https://example.com',
          get: function(el) { return el.getAttribute('href') || ''; },
          set: function(el, value) { if (value) el.setAttribute('href', value); }
        }],
        payload: function(values) { return { href: values.href }; }
      });
    }

    /**
     * Animated elements: the same in-place renderer, with animations paused so
     * the caret does not slide out from under the user mid-keystroke.
     *
     * The paused badge is a fixed-position body child. It used to be appended
     * *inside* the edited element, which meant its own label ("⏸ Animation
     * paused") was part of element.textContent and got saved into the database
     * as part of the user's copy.
     */
    startAnimatedEdit(element) {
      this.startTextEdit(element, {
        onStart: function(el) {
          el.style.setProperty('animation-play-state', 'paused', 'important');
          el.style.setProperty('transition', 'none', 'important');

          const badge = document.createElement('div');
          badge.className = 'rcf-animation-indicator';
          badge.setAttribute('data-rcf-ignore', '');
          badge.textContent = '⏸ Animation paused';

          const r = el.getBoundingClientRect();
          badge.style.top = Math.max(4, r.top - 30) + 'px';
          badge.style.left = (r.left + r.width / 2) + 'px';
          document.body.appendChild(badge);

          // Inline styles are restored wholesale by startTextEdit's teardown;
          // only the badge needs removing here.
          return function() {
            if (badge.parentNode) badge.parentNode.removeChild(badge);
          };
        }
      });
    }
    // Form element editing
    startFormEdit(element) {
      const self = this;
      const elementId = element.getAttribute('data-rcf-id');
      const elementData = this.elements.get(elementId);
      if (!elementData || element.getAttribute('data-rcf-editing')) return;

      const tagName = element.tagName.toLowerCase();

      // For buttons, use inline editing
      if (tagName === 'button') {
        this.startInlineEdit(element);
        return;
      }

      // Get adaptive colors based on background luminance
      const editColors = this.getEditingColors(element);
      const isLightBg = editColors.backdropIsLight;

      // For input/textarea, edit placeholder and value
      element.setAttribute('data-rcf-editing', 'true');
      element.classList.add('rcf-editing');
      element.classList.remove('rcf-hovering');

      const originalPlaceholder = element.placeholder || '';
      const originalValue = element.value || '';

      // Create edit popover - adaptive colors based on background
      const rect = element.getBoundingClientRect();
      const popover = document.createElement('div');
      popover.className = 'rcf-form-popover';
      const popoverBg = isLightBg ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)';
      const popoverBorder = isLightBg ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
      popover.style.cssText = 'position: fixed; left: ' + rect.left + 'px; top: ' + (rect.bottom + 8) + 'px; background: ' + popoverBg + '; border-radius: 12px; padding: 16px; box-shadow: 0 12px 36px rgba(0,0,0,0.4); border: 1px solid ' + popoverBorder + '; backdrop-filter: blur(20px); z-index: 10000; min-width: 280px;';

      const title = document.createElement('p');
      const titleColor = isLightBg ? '#94a3b8' : '#475569';
      title.style.cssText = 'margin: 0 0 12px 0; font-size: 12px; color: ' + titleColor + '; text-transform: uppercase; letter-spacing: 0.05em;';
      title.textContent = 'Edit Form Field';

      // Placeholder input
      const placeholderLabel = document.createElement('label');
      const labelColor = isLightBg ? '#64748b' : '#475569';
      placeholderLabel.style.cssText = 'display: block; font-size: 11px; color: ' + labelColor + '; margin-bottom: 4px;';
      placeholderLabel.textContent = 'Placeholder';

      const placeholderInput = document.createElement('input');
      placeholderInput.type = 'text';
      placeholderInput.value = originalPlaceholder;
      const inputBg = isLightBg ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      const inputBorder = isLightBg ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
      const inputColor = isLightBg ? '#e2e8f0' : '#1e293b';
      placeholderInput.style.cssText = 'width: 100%; padding: 8px 12px; background: ' + inputBg + '; border: 1px solid ' + inputBorder + '; border-radius: 6px; color: ' + inputColor + '; font-size: 13px; margin-bottom: 12px; outline: none;';

      // Value input (for inputs with values)
      const valueLabel = document.createElement('label');
      valueLabel.style.cssText = 'display: block; font-size: 11px; color: ' + labelColor + '; margin-bottom: 4px;';
      valueLabel.textContent = 'Default Value';

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.value = originalValue;
      valueInput.style.cssText = 'width: 100%; padding: 8px 12px; background: ' + inputBg + '; border: 1px solid ' + inputBorder + '; border-radius: 6px; color: ' + inputColor + '; font-size: 13px; margin-bottom: 16px; outline: none;';

      // Buttons
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'rcf-btn-cancel';
      cancelBtn.textContent = 'Cancel';
      const cancelBtnBg = isLightBg ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      const cancelBtnBorder = isLightBg ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
      const cancelBtnColor = isLightBg ? '#94a3b8' : '#475569';
      cancelBtn.style.cssText = 'padding: 8px 14px; background: ' + cancelBtnBg + '; border: 1px solid ' + cancelBtnBorder + '; border-radius: 6px; color: ' + cancelBtnColor + '; cursor: pointer; font-size: 12px;';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'rcf-btn-save';
      saveBtn.textContent = 'Save';
      saveBtn.style.cssText = 'padding: 8px 14px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px;';

      btnContainer.appendChild(cancelBtn);
      btnContainer.appendChild(saveBtn);

      popover.appendChild(title);
      popover.appendChild(placeholderLabel);
      popover.appendChild(placeholderInput);
      popover.appendChild(valueLabel);
      popover.appendChild(valueInput);
      popover.appendChild(btnContainer);

      document.body.appendChild(popover);
      placeholderInput.focus();

      const cleanup = function() {
        element.removeAttribute('data-rcf-editing');
        element.classList.remove('rcf-editing');
        if (document.body.contains(popover)) document.body.removeChild(popover);
      };

      const save = async function() {
        try {
          await self.persistContentUpdate(elementId, placeholderInput.value, {
            value: valueInput.value,
            contentType: 'form'
          });
        } catch (error) {
          alert(error.message || 'Failed to save form content. Please try again.');
          return;
        }

        element.placeholder = placeholderInput.value;
        element.value = valueInput.value;

        elementData.originalContent = placeholderInput.value;

        element.classList.add('rcf-updated');
        setTimeout(function() {
          element.classList.remove('rcf-updated');
        }, 500);

        cleanup();
      };

      saveBtn.onclick = save;
      cancelBtn.onclick = cleanup;

      placeholderInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') cleanup();
        else if (e.key === 'Enter') save();
      });

      valueInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') cleanup();
        else if (e.key === 'Enter') save();
      });

      const outsideClickHandler = function(e) {
        if (!popover.contains(e.target) && e.target !== element) {
          cleanup();
          document.removeEventListener('click', outsideClickHandler);
        }
      };

      setTimeout(function() {
        document.addEventListener('click', outsideClickHandler);
      }, 100);
    }

    // Show hint for non-editable containers
    showContainerHint(element) {
      // Show a temporary tooltip indicating the container can't be edited
      element.classList.remove('rcf-hovering');

      // Get adaptive colors based on background luminance
      const editColors = this.getEditingColors(element);
      const isLightBg = editColors.backdropIsLight;

      const rect = element.getBoundingClientRect();
      const hint = document.createElement('div');
      hint.className = 'rcf-container-hint';
      // Use adaptive orange colors for better visibility
      const hintBg = isLightBg ? 'rgba(251, 146, 60, 0.15)' : 'rgba(251, 146, 60, 0.25)';
      const hintBorder = isLightBg ? 'rgba(251, 146, 60, 0.4)' : 'rgba(251, 146, 60, 0.5)';
      const hintColor = isLightBg ? '#c2410c' : '#fb923c';
      hint.style.cssText = 'position: fixed; left: ' + (rect.left + rect.width / 2) + 'px; top: ' + (rect.top - 48) + 'px; transform: translateX(-50%); background: ' + hintBg + '; border: 1px solid ' + hintBorder + '; color: ' + hintColor + '; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-family: ui-sans-serif, system-ui, sans-serif; white-space: nowrap; z-index: 10001; animation: rcf-fadeIn 0.2s ease;';
      hint.textContent = '📦 Click on specific text elements inside';

      document.body.appendChild(hint);

      // Auto-remove after 2 seconds
      setTimeout(function() {
        hint.style.opacity = '0';
        hint.style.transition = 'opacity 0.3s ease';
        setTimeout(function() {
          if (document.body.contains(hint)) {
            document.body.removeChild(hint);
          }
        }, 300);
      }, 2000);
    }

    showAISuggestions(inputElement, elementId) {
      const self = this;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 10001; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

      const modal = document.createElement('div');
      modal.style.cssText = 'background: linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%); border-radius: 20px; padding: 28px; max-width: 500px; width: 90%; max-height: 80%; overflow-y: auto; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1); animation: rcf-modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);';

      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';

      const titleContainer = document.createElement('div');
      titleContainer.style.cssText = 'display: flex; align-items: center; gap: 10px;';

      const titleIcon = document.createElement('span');
      titleIcon.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%); border-radius: 10px; font-size: 18px; border: 1px solid rgba(139, 92, 246, 0.3);';
      titleIcon.textContent = '✨';

      const title = document.createElement('h3');
      title.style.cssText = 'margin: 0; color: #f1f5f9; font-size: 18px; font-weight: 600;';
      title.textContent = 'AI Content Suggestions';

      titleContainer.appendChild(titleIcon);
      titleContainer.appendChild(title);

      const closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); width: 32px; height: 32px; border-radius: 8px; font-size: 18px; cursor: pointer; color: #94a3b8; display: flex; align-items: center; justify-content: center; transition: all 0.2s;';
      closeBtn.textContent = '×';
      closeBtn.onmouseenter = function() { closeBtn.style.background = 'rgba(255, 255, 255, 0.12)'; closeBtn.style.color = '#e2e8f0'; };
      closeBtn.onmouseleave = function() { closeBtn.style.background = 'rgba(255, 255, 255, 0.08)'; closeBtn.style.color = '#94a3b8'; };

      header.appendChild(titleContainer);
      header.appendChild(closeBtn);

      const goalContainer = document.createElement('div');
      goalContainer.style.cssText = 'margin-bottom: 20px;';

      const goalLabel = document.createElement('label');
      goalLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: 500; color: #cbd5e1; font-size: 13px;';
      goalLabel.textContent = 'Optimization Goal';

      const goalSelect = document.createElement('select');
      goalSelect.style.cssText = 'width: 100%; padding: 12px 16px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; background: rgba(15, 23, 42, 0.6); color: #f1f5f9; font-size: 14px; cursor: pointer; transition: all 0.2s; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%2394a3b8\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center;';

      const options = [
        { value: 'improve', text: '✨ Improve clarity and readability' },
        { value: 'shorten', text: '📝 Make more concise' },
        { value: 'expand', text: '📖 Add more detail' },
        { value: 'engage', text: '🎯 Optimize for engagement' },
        { value: 'professional', text: '💼 Make more professional' },
        { value: 'casual', text: '😊 Make more casual' }
      ];

      options.forEach(function(opt) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.text;
        option.style.background = '#1e293b';
        goalSelect.appendChild(option);
      });

      goalContainer.appendChild(goalLabel);
      goalContainer.appendChild(goalSelect);

      const generateBtn = document.createElement('button');
      generateBtn.style.cssText = 'width: 100%; padding: 14px; background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4); transition: all 0.2s;';
      generateBtn.innerHTML = '<span>🪄</span><span>Generate Suggestions</span>';
      generateBtn.onmouseenter = function() { if (!generateBtn.disabled) { generateBtn.style.transform = 'translateY(-1px)'; generateBtn.style.boxShadow = '0 6px 20px rgba(139, 92, 246, 0.5)'; } };
      generateBtn.onmouseleave = function() { generateBtn.style.transform = 'translateY(0)'; generateBtn.style.boxShadow = '0 4px 14px rgba(139, 92, 246, 0.4)'; };

      const suggestionsList = document.createElement('div');
      suggestionsList.style.cssText = 'margin-bottom: 20px;';

      const footer = document.createElement('div');
      footer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.style.cssText = 'padding: 10px 20px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.08); border-radius: 8px; cursor: pointer; color: #94a3b8; font-size: 13px; font-weight: 500; transition: all 0.2s;';
      cancelBtn.textContent = 'Close';
      cancelBtn.onmouseenter = function() { cancelBtn.style.background = 'rgba(255, 255, 255, 0.12)'; cancelBtn.style.color = '#e2e8f0'; };
      cancelBtn.onmouseleave = function() { cancelBtn.style.background = 'rgba(255, 255, 255, 0.08)'; cancelBtn.style.color = '#94a3b8'; };

      footer.appendChild(cancelBtn);

      modal.appendChild(header);
      modal.appendChild(goalContainer);
      modal.appendChild(generateBtn);
      modal.appendChild(suggestionsList);
      modal.appendChild(footer);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const closeModal = function() {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
      };

      closeBtn.onclick = closeModal;
      cancelBtn.onclick = closeModal;
      overlay.onclick = function(e) {
        if (e.target === overlay) closeModal();
      };

      generateBtn.onclick = async function() {
        const currentText = inputElement.value;
        const goal = goalSelect.value;

        if (!currentText.trim()) {
          const errorP = document.createElement('p');
          errorP.style.cssText = 'color: #fbbf24; margin: 0; padding: 16px; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 10px; font-size: 13px;';
          errorP.textContent = '⚠️ Please enter some text first.';
          suggestionsList.textContent = '';
          suggestionsList.appendChild(errorP);
          return;
        }

        generateBtn.innerHTML = '<span>🔄</span><span>Generating...</span>';
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.7';

        try {
          const response = await fetch(RECOPYFAST_API + '/ai/suggest', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + SITE_TOKEN,
            },
            body: JSON.stringify({
              text: currentText,
              context: 'website content',
              goal: goal,
              tone: 'professional'
            }),
          });

          const data = await response.json();

          if (response.ok && data.success) {
            suggestionsList.textContent = '';
            data.suggestions.forEach(function(suggestion, index) {
              const suggestionDiv = document.createElement('div');
              suggestionDiv.style.cssText = 'margin-bottom: 12px; padding: 16px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; transition: all 0.2s ease; animation: rcf-modal-in 0.3s ease; animation-delay: ' + (index * 0.05) + 's; animation-fill-mode: both;';

              const suggestionText = document.createElement('p');
              suggestionText.style.cssText = 'margin: 0 0 12px 0; font-size: 14px; line-height: 1.6; color: #e2e8f0;';
              suggestionText.textContent = suggestion;

              const useBtn = document.createElement('button');
              useBtn.style.cssText = 'padding: 8px 16px; background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);';
              useBtn.textContent = '✓ Use This';
              useBtn.onmouseenter = function() { useBtn.style.transform = 'translateY(-1px)'; useBtn.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)'; };
              useBtn.onmouseleave = function() { useBtn.style.transform = 'translateY(0)'; useBtn.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)'; };

              useBtn.onclick = function() {
                inputElement.value = suggestion;
                if (inputElement.tagName === 'TEXTAREA') {
                  inputElement.style.height = 'auto';
                  inputElement.style.height = (inputElement.scrollHeight) + 'px';
                }
                inputElement.focus();
                closeModal();
              };

              suggestionDiv.onmouseenter = function() {
                suggestionDiv.style.background = 'rgba(30, 41, 59, 0.6)';
                suggestionDiv.style.borderColor = 'rgba(59, 130, 246, 0.3)';
              };
              suggestionDiv.onmouseleave = function() {
                suggestionDiv.style.background = 'rgba(15, 23, 42, 0.5)';
                suggestionDiv.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              };

              suggestionDiv.appendChild(suggestionText);
              suggestionDiv.appendChild(useBtn);
              suggestionsList.appendChild(suggestionDiv);
            });
          } else {
            const errorP = document.createElement('p');
            errorP.style.cssText = 'color: #f87171; margin: 0; padding: 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px;';
            errorP.textContent = 'Failed to generate suggestions. Please try again.';
            suggestionsList.textContent = '';
            suggestionsList.appendChild(errorP);
          }
        } catch (error) {
          console.error('AI suggestion error:', error);
          const errorP = document.createElement('p');
          errorP.style.cssText = 'color: #f87171; margin: 0; padding: 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px;';
          errorP.textContent = 'Error connecting to AI service. Please check your connection.';
          suggestionsList.textContent = '';
          suggestionsList.appendChild(errorP);
        } finally {
          generateBtn.innerHTML = '<span>🪄</span><span>Generate Suggestions</span>';
          generateBtn.disabled = false;
          generateBtn.style.opacity = '1';
        }
      };

      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          closeModal();
        }
      });
    }

    startPolling() {
      const self = this;
      setInterval(async function() {
        try {
          const endpoint = self.stagingMode
            ? RECOPYFAST_API + '/staging/content/' + SITE_ID +
              (self.editSessionToken
                ? '?rcf_edit_token=' + encodeURIComponent(self.editSessionToken)
                : '?rcf_token=' + encodeURIComponent(self.stagingToken))
            : RECOPYFAST_API + '/content/' + SITE_ID;

          const response = await fetch(endpoint, {
            headers: {
              'Authorization': 'Bearer ' + SITE_TOKEN,
            },
          });
          if (response.ok) {
            const data = await response.json();
            const updates = self.stagingMode ? data.content : data;
            updates.forEach(function(update) { self.handleContentUpdate(update); });
          }
        } catch (error) {
          console.error('ReCopyFast: Polling error:', error);
        }
      }, 5000);
    }

    updateContent(elementId, content) {
      this.handleContentUpdate({ elementId: elementId, content: content });
    }

    destroy() {
      if (this.socket) {
        this.socket.disconnect();
      }
      if (this.observer) {
        this.observer.disconnect();
      }
      this.elements.clear();

      const banner = document.querySelector('#rcf-staging-banner');
      if (banner) {
        document.body.removeChild(banner);
      }
    }
  }

  // Edit Board Panel Class
  class EditBoardPanel {
    constructor(rcf) {
      this.rcf = rcf;
      this.isOpen = false;
      this.activeTab = 'elements';
      this.panel = null;
      this.styles = [];
      this.languages = [];
      this.versions = [];
      this.themes = [];
      this.selectedElements = new Set();
    }

    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      this.createPanel();
      this.loadTabData();
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      if (this.panel && document.body.contains(this.panel)) {
        this.panel.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (this.panel && document.body.contains(this.panel)) {
            document.body.removeChild(this.panel);
          }
          this.panel = null;
        }, 300);
      }
    }

    createPanel() {
      const self = this;

      // Inject panel styles
      if (!document.querySelector('#rcf-edit-board-styles')) {
        const style = document.createElement('style');
        style.id = 'rcf-edit-board-styles';
        style.textContent = `
          .rcf-edit-board {
            position: fixed;
            top: 0;
            right: 0;
            width: 420px;
            height: 100vh;
            background: linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(10, 15, 30, 0.98) 100%);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-left: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: -20px 0 60px rgba(0, 0, 0, 0.5);
            z-index: 99998;
            display: flex;
            flex-direction: column;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e2e8f0;
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .rcf-edit-board.rcf-open {
            transform: translateX(0);
          }
          .rcf-eb-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(30, 41, 59, 0.5);
          }
          .rcf-eb-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 16px;
            font-weight: 600;
            color: #f1f5f9;
          }
          .rcf-eb-close {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #94a3b8;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 18px;
          }
          .rcf-eb-close:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #e2e8f0;
          }
          .rcf-eb-tabs {
            display: flex;
            gap: 2px;
            padding: 8px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(15, 23, 42, 0.3);
          }
          .rcf-eb-tab {
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 500;
            color: #64748b;
            background: transparent;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            white-space: nowrap;
            transition: color 0.15s, background 0.15s;
          }
          .rcf-eb-tab:hover {
            color: #94a3b8;
            background: rgba(255, 255, 255, 0.04);
          }
          .rcf-eb-tab.active {
            background: rgba(255, 255, 255, 0.08);
            color: #f1f5f9;
          }
          .rcf-eb-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
          }
          .rcf-eb-section {
            margin-bottom: 24px;
          }
          .rcf-eb-section-title {
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
          }
          .rcf-eb-card {
            background: rgba(30, 41, 59, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .rcf-eb-card:hover {
            background: rgba(30, 41, 59, 0.6);
          }
          .rcf-eb-card.selected {
            background: rgba(59, 130, 246, 0.1);
            border-color: rgba(59, 130, 246, 0.2);
          }
          .rcf-eb-card-title {
            font-size: 14px;
            font-weight: 500;
            color: #f1f5f9;
            margin-bottom: 4px;
          }
          .rcf-eb-card-desc {
            font-size: 12px;
            color: #64748b;
            line-height: 1.4;
          }
          .rcf-eb-card-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
            font-size: 11px;
            color: #64748b;
          }
          .rcf-eb-badge {
            padding: 2px 8px;
            background: rgba(59, 130, 246, 0.2);
            border-radius: 4px;
            font-size: 10px;
            color: #93c5fd;
          }
          .rcf-eb-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            font-size: 13px;
            font-weight: 500;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: opacity 0.15s;
          }
          .rcf-eb-btn:hover {
            opacity: 0.9;
          }
          .rcf-eb-btn-primary {
            background: #3b82f6;
            color: white;
          }
          .rcf-eb-btn-success {
            background: #10b981;
            color: white;
          }
          .rcf-eb-btn-ghost {
            background: rgba(255, 255, 255, 0.06);
            color: #94a3b8;
            border: 1px solid rgba(255, 255, 255, 0.08);
          }
          .rcf-eb-btn-ghost:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #e2e8f0;
          }
          .rcf-eb-empty {
            text-align: center;
            padding: 40px 20px;
            color: #64748b;
          }
          .rcf-eb-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 20px;
            color: #94a3b8;
          }
          .rcf-eb-checkbox {
            width: 16px;
            height: 16px;
            border-radius: 4px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            cursor: pointer;
            transition: all 0.2s;
          }
          .rcf-eb-checkbox:checked {
            background: #3b82f6;
            border-color: #3b82f6;
          }
          .rcf-eb-input {
            width: 100%;
            padding: 10px 12px;
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #f1f5f9;
            font-size: 13px;
          }
          .rcf-eb-input:focus {
            outline: none;
            border-color: rgba(255, 255, 255, 0.15);
          }
          .rcf-eb-input::placeholder {
            color: #64748b;
          }
          .rcf-eb-select {
            width: 100%;
            padding: 10px 12px;
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #f1f5f9;
            font-size: 13px;
            cursor: pointer;
          }
          .rcf-eb-select:focus {
            outline: none;
            border-color: rgba(255, 255, 255, 0.15);
          }
        `;
        document.head.appendChild(style);
      }

      // Create panel
      this.panel = document.createElement('div');
      this.panel.className = 'rcf-edit-board';
      this.panel.id = 'rcf-edit-board-panel';

      // Header
      const header = document.createElement('div');
      header.className = 'rcf-eb-header';

      const title = document.createElement('div');
      title.className = 'rcf-eb-title';
      title.innerHTML = '<span>📋</span><span>Edit Board</span>';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rcf-eb-close';
      closeBtn.textContent = '×';
      closeBtn.onclick = () => self.close();

      header.appendChild(title);
      header.appendChild(closeBtn);

      // Tabs
      const tabs = document.createElement('div');
      tabs.className = 'rcf-eb-tabs';

      const tabData = [
        { id: 'elements', label: 'Elements' },
        { id: 'styles', label: 'Styles' },
        { id: 'languages', label: 'Languages' },
        { id: 'history', label: 'History' },
        { id: 'themes', label: 'Themes' }
      ];

      tabData.forEach(tab => {
        const tabBtn = document.createElement('button');
        tabBtn.className = 'rcf-eb-tab' + (tab.id === self.activeTab ? ' active' : '');
        tabBtn.textContent = tab.label;
        tabBtn.onclick = () => self.switchTab(tab.id);
        tabs.appendChild(tabBtn);
      });

      // Content area
      const content = document.createElement('div');
      content.className = 'rcf-eb-content';
      content.id = 'rcf-eb-content';

      this.panel.appendChild(header);
      this.panel.appendChild(tabs);
      this.panel.appendChild(content);

      document.body.appendChild(this.panel);

      // Trigger open animation
      requestAnimationFrame(() => {
        self.panel.classList.add('rcf-open');
      });

      this.renderTab();
    }

    switchTab(tabId) {
      this.activeTab = tabId;

      // Update tab buttons
      const tabs = this.panel.querySelectorAll('.rcf-eb-tab');
      tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.textContent.toLowerCase().includes(tabId)) {
          tab.classList.add('active');
        }
      });

      this.loadTabData();
    }

    async loadTabData() {
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '<div class="rcf-eb-loading">Loading...</div>';

      try {
        switch (this.activeTab) {
          case 'elements':
            this.renderElementsTab();
            break;
          case 'styles':
            await this.loadStyles();
            this.renderStylesTab();
            break;
          case 'languages':
            await this.loadLanguages();
            this.renderLanguagesTab();
            break;
          case 'history':
            await this.loadHistory();
            this.renderHistoryTab();
            break;
          case 'themes':
            await this.loadThemes();
            this.renderThemesTab();
            break;
        }
      } catch (error) {
        console.error('Error loading tab data:', error);
        content.innerHTML = '<div class="rcf-eb-empty">Failed to load data</div>';
      }
    }

    renderTab() {
      this.loadTabData();
    }

    // Elements Tab
    renderElementsTab() {
      const self = this;
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '';

      const section = document.createElement('div');
      section.className = 'rcf-eb-section';

      const title = document.createElement('div');
      title.className = 'rcf-eb-section-title';
      title.textContent = 'Editable Elements (' + this.rcf.elements.size + ')';
      section.appendChild(title);

      // Filter out buttons and links - they are interactive, not content
      const contentElements = [];
      this.rcf.elements.forEach((data, elementId) => {
        const tagName = data.type.toLowerCase();
        if (tagName !== 'button' && tagName !== 'a') {
          contentElements.push({ data, elementId });
        }
      });

      title.textContent = 'Editable Elements (' + contentElements.length + ')';

      if (contentElements.length === 0) {
        section.innerHTML += '<div class="rcf-eb-empty">No editable elements found</div>';
      } else {
        contentElements.forEach(({ data, elementId }) => {
          const card = document.createElement('div');
          card.className = 'rcf-eb-card';
          if (self.selectedElements.has(elementId)) {
            card.classList.add('selected');
          }

          const cardHeader = document.createElement('div');
          cardHeader.style.cssText = 'display: flex; align-items: flex-start; gap: 10px;';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'rcf-eb-checkbox';
          checkbox.checked = self.selectedElements.has(elementId);
          checkbox.onclick = (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
              self.selectedElements.add(elementId);
            } else {
              self.selectedElements.delete(elementId);
            }
            card.classList.toggle('selected', checkbox.checked);
          };

          const cardContent = document.createElement('div');
          cardContent.style.flex = '1';

          const cardTitle = document.createElement('div');
          cardTitle.className = 'rcf-eb-card-title';
          cardTitle.textContent = data.type.toUpperCase();

          const cardDesc = document.createElement('div');
          cardDesc.className = 'rcf-eb-card-desc';
          const previewText = data.originalContent.substring(0, 100);
          cardDesc.textContent = previewText + (data.originalContent.length > 100 ? '...' : '');

          cardContent.appendChild(cardTitle);
          cardContent.appendChild(cardDesc);

          cardHeader.appendChild(checkbox);
          cardHeader.appendChild(cardContent);

          card.appendChild(cardHeader);

          card.onclick = () => {
            data.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            data.element.classList.add('rcf-hovering');
            setTimeout(() => data.element.classList.remove('rcf-hovering'), 2000);
          };

          section.appendChild(card);
        });
      }

      content.appendChild(section);

      // Actions
      if (this.selectedElements.size > 0) {
        const actions = document.createElement('div');
        actions.style.cssText = 'position: sticky; bottom: 0; padding: 16px 0; background: linear-gradient(transparent, rgba(15, 23, 42, 0.98) 20%);';

        const selectInfo = document.createElement('div');
        selectInfo.style.cssText = 'margin-bottom: 10px; font-size: 12px; color: #94a3b8;';
        selectInfo.textContent = this.selectedElements.size + ' element(s) selected';

        const actionBtns = document.createElement('div');
        actionBtns.style.cssText = 'display: flex; gap: 8px;';

        const applyStyleBtn = document.createElement('button');
        applyStyleBtn.className = 'rcf-eb-btn rcf-eb-btn-primary';
        applyStyleBtn.textContent = '🎨 Apply Style';
        applyStyleBtn.onclick = () => self.switchTab('styles');

        actionBtns.appendChild(applyStyleBtn);

        actions.appendChild(selectInfo);
        actions.appendChild(actionBtns);
        content.appendChild(actions);
      }
    }

    // Styles Tab
    async loadStyles() {
      try {
        const response = await fetch(RECOPYFAST_API + '/edit-board/styles?siteId=' + SITE_ID, {
          headers: { 'Authorization': 'Bearer ' + this.rcf.stagingToken }
        });
        const data = await response.json();
        this.styles = [...(data.presets || []), ...(data.custom || [])];
      } catch (error) {
        console.error('Error loading styles:', error);
        this.styles = [];
      }
    }

    renderStylesTab() {
      const self = this;
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '';

      // Section title
      const title = document.createElement('div');
      title.className = 'rcf-eb-section-title';
      title.textContent = 'Apply a writing style';
      title.style.marginBottom = '16px';
      content.appendChild(title);

      if (this.styles.length === 0) {
        content.innerHTML += '<div class="rcf-eb-empty">No styles available</div>';
        return;
      }

      // Style grid
      const grid = document.createElement('div');
      grid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px;';

      this.styles.forEach(style => {
        const card = document.createElement('button');
        card.className = 'rcf-eb-card';
        card.style.cssText = 'text-align: left; width: 100%; cursor: pointer;';

        const cardTitle = document.createElement('div');
        cardTitle.style.cssText = 'font-size: 13px; font-weight: 600; color: #f1f5f9; margin-bottom: 4px;';
        cardTitle.textContent = style.name;

        const cardDesc = document.createElement('div');
        cardDesc.style.cssText = 'font-size: 11px; color: #64748b; line-height: 1.3;';
        cardDesc.textContent = style.description || '';

        card.appendChild(cardTitle);
        card.appendChild(cardDesc);

        card.onclick = async () => {
          await self.applyStyle(style.id);
        };

        grid.appendChild(card);
      });

      content.appendChild(grid);

      // Info text
      const info = document.createElement('div');
      info.style.cssText = 'margin-top: 16px; padding: 12px; background: rgba(59, 130, 246, 0.1); border-radius: 6px; font-size: 12px; color: #94a3b8;';
      info.textContent = 'Click a style to transform all text on the page with AI.';
      content.appendChild(info);
    }

    async applyStyle(styleId) {
      const self = this;
      const elementIds = this.selectedElements.size > 0
        ? Array.from(this.selectedElements)
        : null;

      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '<div class="rcf-eb-loading">Applying style...</div>';

      try {
        const response = await fetch(RECOPYFAST_API + '/edit-board/styles/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + this.rcf.stagingToken
          },
          body: JSON.stringify({
            siteId: SITE_ID,
            styleId: styleId,
            elementIds: elementIds
          })
        });

        const result = await response.json();

        if (result.success) {
          content.innerHTML = '<div class="rcf-eb-empty">Applied ' + result.styleName + ' to ' + result.transformedCount + ' elements</div>';

          // Refresh the page content
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          content.innerHTML = '<div class="rcf-eb-empty">' + (result.error || 'Failed to apply style') + '</div>';
        }
      } catch (error) {
        console.error('Error applying style:', error);
        content.innerHTML = '<div class="rcf-eb-empty">Error applying style</div>';
      }
    }

    // Languages Tab
    async loadLanguages() {
      try {
        const response = await fetch(RECOPYFAST_API + '/edit-board/languages?siteId=' + SITE_ID, {
          headers: { 'Authorization': 'Bearer ' + this.rcf.stagingToken }
        });
        const data = await response.json();
        this.languages = data.languages || [];
        this.availableLanguages = data.availableLanguages || [];
      } catch (error) {
        console.error('Error loading languages:', error);
        this.languages = [];
      }
    }

    renderLanguagesTab() {
      const self = this;
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '';

      // Current languages
      const section = document.createElement('div');
      section.className = 'rcf-eb-section';

      const title = document.createElement('div');
      title.className = 'rcf-eb-section-title';
      title.textContent = 'Site Languages';
      section.appendChild(title);

      if (this.languages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rcf-eb-empty';
        empty.textContent = 'No languages configured';
        section.appendChild(empty);
      } else {
        this.languages.forEach(lang => {
          const card = document.createElement('div');
          card.className = 'rcf-eb-card';

          const cardTitle = document.createElement('div');
          cardTitle.className = 'rcf-eb-card-title';
          cardTitle.textContent = lang.language_name + ' (' + lang.language_code + ')';

          const cardMeta = document.createElement('div');
          cardMeta.className = 'rcf-eb-card-meta';

          if (lang.is_default) {
            const badge = document.createElement('span');
            badge.className = 'rcf-eb-badge';
            badge.textContent = 'Default';
            cardMeta.appendChild(badge);
          }

          const coverage = document.createElement('span');
          coverage.textContent = Math.round(lang.translation_coverage || 0) + '% translated';
          cardMeta.appendChild(coverage);

          card.appendChild(cardTitle);
          card.appendChild(cardMeta);
          section.appendChild(card);
        });
      }

      content.appendChild(section);

      // Add language section
      const addSection = document.createElement('div');
      addSection.className = 'rcf-eb-section';

      const addTitle = document.createElement('div');
      addTitle.className = 'rcf-eb-section-title';
      addTitle.textContent = 'Add Language';
      addSection.appendChild(addTitle);

      const select = document.createElement('select');
      select.className = 'rcf-eb-select';
      select.innerHTML = '<option value="">Select language...</option>';

      (this.availableLanguages || []).forEach(lang => {
        const exists = this.languages.some(l => l.language_code === lang.code);
        if (!exists) {
          const option = document.createElement('option');
          option.value = lang.code;
          option.textContent = lang.name;
          select.appendChild(option);
        }
      });

      const autoTranslateLabel = document.createElement('label');
      autoTranslateLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; margin: 10px 0; font-size: 13px; color: #94a3b8;';

      const autoTranslateCheck = document.createElement('input');
      autoTranslateCheck.type = 'checkbox';
      autoTranslateCheck.className = 'rcf-eb-checkbox';
      autoTranslateCheck.checked = true;
      autoTranslateLabel.appendChild(autoTranslateCheck);
      autoTranslateLabel.appendChild(document.createTextNode('Auto-translate with AI'));

      const addBtn = document.createElement('button');
      addBtn.className = 'rcf-eb-btn rcf-eb-btn-primary';
      addBtn.style.marginTop = '10px';
      addBtn.textContent = 'Add Language';
      addBtn.onclick = async () => {
        if (!select.value) return;

        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';

        try {
          await fetch(RECOPYFAST_API + '/edit-board/languages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + self.rcf.stagingToken
            },
            body: JSON.stringify({
              siteId: SITE_ID,
              languageCode: select.value,
              autoTranslate: autoTranslateCheck.checked
            })
          });

          self.loadTabData();
        } catch (error) {
          console.error('Error adding language:', error);
          addBtn.disabled = false;
          addBtn.textContent = 'Add Language';
        }
      };

      addSection.appendChild(select);
      addSection.appendChild(autoTranslateLabel);
      addSection.appendChild(addBtn);
      content.appendChild(addSection);
    }

    // History Tab
    async loadHistory() {
      try {
        const response = await fetch(RECOPYFAST_API + '/edit-board/history?siteId=' + SITE_ID, {
          headers: { 'Authorization': 'Bearer ' + this.rcf.stagingToken }
        });
        const data = await response.json();
        this.versions = data.versions || [];
      } catch (error) {
        console.error('Error loading history:', error);
        this.versions = [];
      }
    }

    renderHistoryTab() {
      const self = this;
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '';

      const section = document.createElement('div');
      section.className = 'rcf-eb-section';

      const title = document.createElement('div');
      title.className = 'rcf-eb-section-title';
      title.textContent = 'Version History';
      section.appendChild(title);

      if (this.versions.length === 0) {
        section.innerHTML += '<div class="rcf-eb-empty">No versions saved yet</div>';
      } else {
        this.versions.forEach(version => {
          const card = document.createElement('div');
          card.className = 'rcf-eb-card';

          const cardTitle = document.createElement('div');
          cardTitle.className = 'rcf-eb-card-title';
          cardTitle.textContent = 'Version ' + version.version_number;

          const cardDesc = document.createElement('div');
          cardDesc.className = 'rcf-eb-card-desc';
          cardDesc.textContent = version.description || version.change_type || 'Manual edit';

          const cardMeta = document.createElement('div');
          cardMeta.className = 'rcf-eb-card-meta';

          const date = new Date(version.created_at);
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          cardMeta.innerHTML = '<span>' + dateStr + '</span><span>by ' + (version.created_by || 'Unknown') + '</span>';

          const restoreBtn = document.createElement('button');
          restoreBtn.className = 'rcf-eb-btn rcf-eb-btn-ghost';
          restoreBtn.style.marginTop = '10px';
          restoreBtn.textContent = 'Restore';
          restoreBtn.onclick = async (e) => {
            e.stopPropagation();
            await self.restoreVersion(version.id);
          };

          card.appendChild(cardTitle);
          card.appendChild(cardDesc);
          card.appendChild(cardMeta);
          card.appendChild(restoreBtn);

          section.appendChild(card);
        });
      }

      content.appendChild(section);

      // Create snapshot button
      const createBtn = document.createElement('button');
      createBtn.className = 'rcf-eb-btn rcf-eb-btn-primary';
      createBtn.style.width = '100%';
      createBtn.textContent = 'Save Current Version';
      createBtn.onclick = async () => {
        createBtn.disabled = true;
        createBtn.textContent = 'Saving...';

        try {
          await fetch(RECOPYFAST_API + '/edit-board/history', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + self.rcf.stagingToken
            },
            body: JSON.stringify({
              siteId: SITE_ID,
              description: 'Manual snapshot'
            })
          });

          self.loadTabData();
        } catch (error) {
          console.error('Error creating version:', error);
          createBtn.disabled = false;
          createBtn.textContent = 'Save Current Version';
        }
      };

      content.appendChild(createBtn);
    }

    async restoreVersion(versionId) {
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '<div class="rcf-eb-loading">Restoring version...</div>';

      try {
        const response = await fetch(RECOPYFAST_API + '/edit-board/history/' + versionId, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + this.rcf.stagingToken
          }
        });

        const result = await response.json();

        if (result.success) {
          content.innerHTML = '<div class="rcf-eb-empty">Restored ' + result.elementsRestored + ' elements</div>';

          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          content.innerHTML = '<div class="rcf-eb-empty">' + (result.error || 'Failed to restore') + '</div>';
        }
      } catch (error) {
        console.error('Error restoring version:', error);
        content.innerHTML = '<div class="rcf-eb-empty">Error restoring version</div>';
      }
    }

    // Themes Tab
    async loadThemes() {
      try {
        const response = await fetch(RECOPYFAST_API + '/edit-board/themes?siteId=' + SITE_ID, {
          headers: { 'Authorization': 'Bearer ' + this.rcf.stagingToken }
        });
        const data = await response.json();
        this.themes = data.themes || [];
      } catch (error) {
        console.error('Error loading themes:', error);
        this.themes = [];
      }
    }

    renderThemesTab() {
      const self = this;
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '';

      const section = document.createElement('div');
      section.className = 'rcf-eb-section';

      const title = document.createElement('div');
      title.className = 'rcf-eb-section-title';
      title.textContent = 'Event Themes';
      section.appendChild(title);

      if (this.themes.length === 0) {
        section.innerHTML += '<div class="rcf-eb-empty">No themes created yet</div>';
      } else {
        this.themes.forEach(theme => {
          const card = document.createElement('div');
          card.className = 'rcf-eb-card';

          const cardTitle = document.createElement('div');
          cardTitle.className = 'rcf-eb-card-title';
          cardTitle.textContent = theme.name;

          const cardDesc = document.createElement('div');
          cardDesc.className = 'rcf-eb-card-desc';
          cardDesc.textContent = theme.description || theme.overrideCount + ' content overrides';

          const cardMeta = document.createElement('div');
          cardMeta.className = 'rcf-eb-card-meta';

          if (theme.is_active) {
            const badge = document.createElement('span');
            badge.className = 'rcf-eb-badge';
            badge.style.background = 'rgba(16, 185, 129, 0.2)';
            badge.style.color = '#6ee7b7';
            badge.textContent = 'Active';
            cardMeta.appendChild(badge);
          }

          if (theme.schedule_start) {
            const schedule = document.createElement('span');
            schedule.textContent = 'Scheduled';
            cardMeta.appendChild(schedule);
          }

          const toggleBtn = document.createElement('button');
          toggleBtn.className = theme.is_active ? 'rcf-eb-btn rcf-eb-btn-ghost' : 'rcf-eb-btn rcf-eb-btn-success';
          toggleBtn.style.marginTop = '10px';
          toggleBtn.textContent = theme.is_active ? 'Deactivate' : 'Activate';
          toggleBtn.onclick = async (e) => {
            e.stopPropagation();
            await self.toggleTheme(theme.id, !theme.is_active);
          };

          card.appendChild(cardTitle);
          card.appendChild(cardDesc);
          card.appendChild(cardMeta);
          card.appendChild(toggleBtn);

          section.appendChild(card);
        });
      }

      content.appendChild(section);

      // Create theme button
      const createSection = document.createElement('div');
      createSection.className = 'rcf-eb-section';

      const createTitle = document.createElement('div');
      createTitle.className = 'rcf-eb-section-title';
      createTitle.textContent = 'Create Theme';
      createSection.appendChild(createTitle);

      const nameInput = document.createElement('input');
      nameInput.className = 'rcf-eb-input';
      nameInput.placeholder = 'Theme name (e.g., Holiday Sale)';

      const createBtn = document.createElement('button');
      createBtn.className = 'rcf-eb-btn rcf-eb-btn-primary';
      createBtn.style.cssText = 'margin-top: 10px; width: 100%;';
      createBtn.textContent = 'Create Theme';
      createBtn.onclick = async () => {
        if (!nameInput.value.trim()) return;

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';

        try {
          await fetch(RECOPYFAST_API + '/edit-board/themes', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + self.rcf.stagingToken
            },
            body: JSON.stringify({
              siteId: SITE_ID,
              name: nameInput.value.trim()
            })
          });

          self.loadTabData();
        } catch (error) {
          console.error('Error creating theme:', error);
          createBtn.disabled = false;
          createBtn.textContent = 'Create Theme';
        }
      };

      createSection.appendChild(nameInput);
      createSection.appendChild(createBtn);
      content.appendChild(createSection);
    }

    async toggleTheme(themeId, activate) {
      const content = document.getElementById('rcf-eb-content');
      content.innerHTML = '<div class="rcf-eb-loading">' + (activate ? 'Activating...' : 'Deactivating...') + '</div>';

      try {
        await fetch(RECOPYFAST_API + '/edit-board/themes', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + this.rcf.stagingToken
          },
          body: JSON.stringify({
            siteId: SITE_ID,
            themeId: themeId,
            isActive: activate
          })
        });

        this.loadTabData();
      } catch (error) {
        console.error('Error toggling theme:', error);
        this.loadTabData();
      }
    }
  }

  window.ReCopyFast = new ReCopyFast();

  window.recopyfast = {
    update: function(elementId, content) { window.ReCopyFast.updateContent(elementId, content); },
    destroy: function() { window.ReCopyFast.destroy(); },
    rescan: function() {
      window.ReCopyFast.scanForContent();
      window.ReCopyFast.sendContentMap();
    },
    isStaging: function() { return window.ReCopyFast.stagingMode; },
    getStagingAccess: function() { return window.ReCopyFast.stagingAccess; },
    trackConversion: function(eventName, value) {
      window.ReCopyFast.trackConversion(eventName, value);
    }
  };

  // Also expose as window.rcf shorthand
  window.rcf = window.recopyfast;
})();
