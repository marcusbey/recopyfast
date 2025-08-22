(function() {
  'use strict';
  
  // Configuration
  const RECOPYFAST_API = window.RECOPYFAST_API || 'http://localhost:3000/api';
  const RECOPYFAST_WS = window.RECOPYFAST_WS || 'http://localhost:3001';
  const SITE_ID = document.currentScript.getAttribute('data-site-id');
  
  // Get edit token from URL or localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const EDIT_TOKEN = urlParams.get('rcf_edit_token') || localStorage.getItem(`rcf_edit_token_${SITE_ID}`);
  
  if (!SITE_ID) {
    console.error('ReCopyFast: No site ID provided');
    return;
  }

  class ReCopyFastSecure {
    constructor() {
      this.elements = new Map();
      this.socket = null;
      this.observer = null;
      this.isInitialized = false;
      this.editSession = null;
      this.isAuthenticated = false;
      this.selectedElement = null;
      this.sessionCheckInterval = null;
      
      this.init();
    }
    
    async init() {
      try {
        await this.waitForDOM();
        this.scanForContent();
        
        // Check for edit token and validate session
        if (EDIT_TOKEN) {
          await this.validateEditSession();
        }
        
        await this.establishConnection();
        this.setupMutationObserver();
        
        if (this.isAuthenticated) {
          this.setupEditMode();
          this.startSessionMonitoring();
        } else {
          this.setupLoginPrompt();
        }
        
        this.isInitialized = true;
        console.log('ReCopyFast initialized successfully', {
          authenticated: this.isAuthenticated,
          editMode: this.isAuthenticated
        });
      } catch (error) {
        console.error('ReCopyFast initialization error:', error);
      }
    }

    waitForDOM() {
      return new Promise((resolve) => {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', resolve);
        } else {
          resolve();
        }
      });
    }

    /**
     * Validate edit session with server
     */
    async validateEditSession() {
      if (!EDIT_TOKEN) {
        console.log('ReCopyFast: No edit token provided');
        return false;
      }

      try {
        const response = await fetch(`${RECOPYFAST_API}/edit-sessions/validate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token: EDIT_TOKEN,
            siteId: SITE_ID
          })
        });

        const data = await response.json();

        if (response.ok && data.valid) {
          this.editSession = data.session;
          this.isAuthenticated = true;
          
          // Store token in localStorage for session continuity
          localStorage.setItem(`rcf_edit_token_${SITE_ID}`, EDIT_TOKEN);
          
          console.log('ReCopyFast: Edit session validated', {
            permissions: this.editSession.permissions,
            expiresAt: this.editSession.expiresAt,
            timeRemaining: this.editSession.timeRemainingMinutes + ' minutes'
          });

          // Show session info to user
          this.showSessionInfo();
          
          return true;
        } else {
          console.log('ReCopyFast: Invalid edit session', data.error);
          this.clearStoredToken();
          return false;
        }
      } catch (error) {
        console.error('ReCopyFast: Session validation error:', error);
        return false;
      }
    }

    /**
     * Clear stored authentication token
     */
    clearStoredToken() {
      localStorage.removeItem(`rcf_edit_token_${SITE_ID}`);
      // Remove token from URL without page reload
      if (window.history && window.history.replaceState) {
        const url = new URL(window.location);
        url.searchParams.delete('rcf_edit_token');
        window.history.replaceState({}, document.title, url.toString());
      }
    }

    /**
     * Show edit session information
     */
    showSessionInfo() {
      if (!this.editSession) return;

      const banner = document.createElement('div');
      banner.id = 'rcf-session-banner';
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        color: white;
        padding: 12px 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        z-index: 9999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: transform 0.3s ease;
      `;

      const leftContent = document.createElement('div');
      leftContent.style.cssText = 'display: flex; align-items: center; gap: 16px;';
      
      const status = document.createElement('span');
      status.innerHTML = `
        ✏️ <strong>Edit Mode Active</strong> 
        • ${this.editSession.timeRemainingMinutes} minutes remaining
        • Permissions: ${this.editSession.permissions.join(', ')}
      `;
      
      const rightContent = document.createElement('div');
      rightContent.style.cssText = 'display: flex; align-items: center; gap: 12px;';
      
      const extendBtn = document.createElement('button');
      extendBtn.textContent = '⏱️ Extend Session';
      extendBtn.style.cssText = `
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s ease;
      `;
      extendBtn.onmouseover = () => extendBtn.style.background = 'rgba(255,255,255,0.3)';
      extendBtn.onmouseout = () => extendBtn.style.background = 'rgba(255,255,255,0.2)';
      extendBtn.onclick = () => this.extendSession();

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = `
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s ease;
      `;
      closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255,255,255,0.3)';
      closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255,255,255,0.2)';
      closeBtn.onclick = () => this.hideBanner();

      leftContent.appendChild(status);
      rightContent.appendChild(extendBtn);
      rightContent.appendChild(closeBtn);
      banner.appendChild(leftContent);
      banner.appendChild(rightContent);

      document.body.appendChild(banner);

      // Auto-hide after 10 seconds
      setTimeout(() => {
        if (document.getElementById('rcf-session-banner')) {
          this.hideBanner();
        }
      }, 10000);
    }

    hideBanner() {
      const banner = document.getElementById('rcf-session-banner');
      if (banner) {
        banner.style.transform = 'translateY(-100%)';
        setTimeout(() => {
          if (banner.parentNode) {
            banner.parentNode.removeChild(banner);
          }
        }, 300);
      }
    }

    /**
     * Setup login prompt for unauthenticated users
     */
    setupLoginPrompt() {
      // Add subtle login button
      const loginBtn = document.createElement('div');
      loginBtn.id = 'rcf-login-prompt';
      loginBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #3b82f6;
        color: white;
        padding: 12px 16px;
        border-radius: 50px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(59, 130, 246, 0.3);
        z-index: 9998;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      
      loginBtn.innerHTML = '✏️ Login to Edit';
      
      loginBtn.onmouseover = () => {
        loginBtn.style.transform = 'scale(1.05)';
        loginBtn.style.boxShadow = '0 6px 25px rgba(59, 130, 246, 0.4)';
      };
      
      loginBtn.onmouseout = () => {
        loginBtn.style.transform = 'scale(1)';
        loginBtn.style.boxShadow = '0 4px 20px rgba(59, 130, 246, 0.3)';
      };
      
      loginBtn.onclick = () => {
        this.redirectToLogin();
      };

      document.body.appendChild(loginBtn);
    }

    /**
     * Redirect to login/dashboard
     */
    redirectToLogin() {
      const dashboardUrl = `${RECOPYFAST_API.replace('/api', '')}/dashboard?site=${SITE_ID}&return_url=${encodeURIComponent(window.location.href)}`;
      window.open(dashboardUrl, '_blank');
    }

    /**
     * Start monitoring session expiration
     */
    startSessionMonitoring() {
      if (this.sessionCheckInterval) {
        clearInterval(this.sessionCheckInterval);
      }

      // Check session every minute
      this.sessionCheckInterval = setInterval(async () => {
        if (!this.editSession) return;

        const now = Date.now();
        const expiresAt = new Date(this.editSession.expiresAt).getTime();
        const timeRemaining = expiresAt - now;

        if (timeRemaining <= 0) {
          // Session expired
          this.handleSessionExpired();
        } else if (timeRemaining < (10 * 60 * 1000)) { // 10 minutes warning
          this.showExpirationWarning(Math.floor(timeRemaining / (60 * 1000)));
        }
      }, 60000); // Check every minute
    }

    /**
     * Handle session expiration
     */
    handleSessionExpired() {
      this.isAuthenticated = false;
      this.editSession = null;
      this.clearStoredToken();
      
      if (this.sessionCheckInterval) {
        clearInterval(this.sessionCheckInterval);
      }

      // Remove edit capabilities
      this.disableEditMode();

      // Show expiration notice
      this.showSessionExpiredNotice();
    }

    /**
     * Show session expiration warning
     */
    showExpirationWarning(minutesRemaining) {
      const existing = document.getElementById('rcf-expiration-warning');
      if (existing) return; // Already showing

      const warning = document.createElement('div');
      warning.id = 'rcf-expiration-warning';
      warning.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fbbf24;
        color: #92400e;
        padding: 20px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 10px 25px rgba(0,0,0,0.15);
        text-align: center;
        min-width: 300px;
      `;

      warning.innerHTML = `
        <div style="margin-bottom: 12px;">⚠️ <strong>Session Expiring Soon</strong></div>
        <div style="margin-bottom: 16px;">Your edit session will expire in ${minutesRemaining} minutes</div>
        <button id="rcf-extend-session" style="
          background: #92400e;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          margin-right: 8px;
        ">Extend Session</button>
        <button id="rcf-dismiss-warning" style="
          background: transparent;
          color: #92400e;
          border: 1px solid #92400e;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
        ">Dismiss</button>
      `;

      document.body.appendChild(warning);

      // Event handlers
      document.getElementById('rcf-extend-session').onclick = () => {
        this.extendSession();
        document.body.removeChild(warning);
      };

      document.getElementById('rcf-dismiss-warning').onclick = () => {
        document.body.removeChild(warning);
      };

      // Auto-dismiss after 30 seconds
      setTimeout(() => {
        if (document.getElementById('rcf-expiration-warning')) {
          document.body.removeChild(warning);
        }
      }, 30000);
    }

    /**
     * Extend edit session
     */
    async extendSession() {
      if (!EDIT_TOKEN) return;

      try {
        const response = await fetch(`${RECOPYFAST_API}/edit-sessions/extend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token: EDIT_TOKEN
          })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          this.editSession.expiresAt = data.session.expiresAt;
          this.editSession.timeRemainingMinutes = data.session.timeRemainingMinutes;
          
          this.showNotification('✅ Session extended successfully!', 'success');
        } else {
          this.showNotification('❌ Failed to extend session', 'error');
        }
      } catch (error) {
        console.error('Session extension error:', error);
        this.showNotification('❌ Network error extending session', 'error');
      }
    }

    /**
     * Show notification to user
     */
    showNotification(message, type = 'info') {
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        transform: translateX(100%);
        transition: transform 0.3s ease;
      `;
      
      notification.textContent = message;
      document.body.appendChild(notification);

      // Animate in
      setTimeout(() => {
        notification.style.transform = 'translateX(0)';
      }, 100);

      // Auto-remove
      setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }, 3000);
    }

    // [Rest of the methods remain the same as the original script]
    // Content scanning, WebSocket connection, editing functionality
    // These methods work identically but only activate when authenticated

    scanForContent() {
      // Same implementation as original
      const selector = 'h1, h2, h3, h4, h5, h6, p, span, button, a, li, td, th, label, div[data-rcf-content]';
      const textElements = document.querySelectorAll(selector);
      
      textElements.forEach((element, index) => {
        if (this.shouldSkipElement(element)) return;
        
        const text = this.getElementText(element);
        if (!text || text.trim().length < 2) return;
        
        const elementId = element.getAttribute('data-rcf-id') || `rcf-${SITE_ID}-${Date.now()}-${index}`;
        element.setAttribute('data-rcf-id', elementId);
        
        this.elements.set(elementId, {
          element: element,
          originalContent: text,
          selector: this.generateSelector(element),
          type: element.tagName.toLowerCase()
        });
        
        // Only add edit classes if authenticated
        if (this.isAuthenticated) {
          element.classList.add('rcf-editable');
        }
      });
      
      console.log(`ReCopyFast: Found ${this.elements.size} editable elements`);
    }

    shouldSkipElement(element) {
      const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'];
      if (skipTags.includes(element.tagName)) return true;
      if (element.hasAttribute('data-rcf-ignore')) return true;
      if (element.closest('[contenteditable="true"]')) return true;
      
      const hasOnlyElements = Array.from(element.childNodes).every(
        node => node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()
      );
      
      return hasOnlyElements && !element.hasAttribute('data-rcf-content');
    }

    getElementText(element) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return element.value;
      }
      return element.textContent;
    }

    generateSelector(element) {
      // Same implementation as original
      const path = [];
      let current = element;
      
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        
        if (current.id) {
          selector = `#${current.id}`;
          path.unshift(selector);
          break;
        }
        
        if (current.className && typeof current.className === 'string') {
          const classes = current.className.trim().split(/\s+/).filter(c => !c.startsWith('rcf-'));
          if (classes.length > 0) {
            selector += `.${classes.join('.')}`;
          }
        }
        
        const siblings = Array.from(current.parentNode?.children || []);
        const index = siblings.indexOf(current);
        if (siblings.length > 1) {
          selector += `:nth-child(${index + 1})`;
        }
        
        path.unshift(selector);
        current = current.parentNode;
      }
      
      return path.join(' > ');
    }

    async establishConnection() {
      // Same WebSocket connection logic
      try {
        await this.loadSocketIO();
        
        this.socket = io(RECOPYFAST_WS, {
          query: { 
            siteId: SITE_ID,
            editMode: this.isAuthenticated,
            editToken: EDIT_TOKEN || null
          },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5
        });
        
        this.socket.on('connect', () => {
          console.log('ReCopyFast: Connected to server');
          if (this.isAuthenticated) {
            this.sendContentMap();
          }
        });
        
        this.socket.on('content-update', (data) => {
          this.handleContentUpdate(data);
        });
        
        this.socket.on('session-expired', () => {
          this.handleSessionExpired();
        });
        
        this.socket.on('disconnect', () => {
          console.log('ReCopyFast: Disconnected from server');
        });
        
      } catch (error) {
        console.error('ReCopyFast: Failed to establish connection:', error);
      }
    }

    loadSocketIO() {
      return new Promise((resolve, reject) => {
        if (window.io) {
          resolve();
          return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    setupEditMode() {
      if (!this.isAuthenticated) return;
      
      this.injectStyles();
      
      document.addEventListener('click', (e) => {
        const element = e.target.closest('[data-rcf-id]');
        if (!element) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        this.startInlineEdit(element);
      });
      
      document.addEventListener('mouseover', (e) => {
        const element = e.target.closest('[data-rcf-id]');
        if (element && !element.getAttribute('data-rcf-editing')) {
          element.classList.add('rcf-hovering');
        }
      });
      
      document.addEventListener('mouseout', (e) => {
        const element = e.target.closest('[data-rcf-id]');
        if (element) {
          element.classList.remove('rcf-hovering');
        }
      });
    }

    disableEditMode() {
      // Remove all edit-related classes and event handlers
      document.querySelectorAll('[data-rcf-id]').forEach(element => {
        element.classList.remove('rcf-editable', 'rcf-hovering', 'rcf-editing');
        element.removeAttribute('data-rcf-editing');
      });

      // Remove edit-related UI elements
      document.querySelectorAll('.rcf-actions').forEach(el => el.remove());
      
      // Show login prompt instead
      this.setupLoginPrompt();
    }

    injectStyles() {
      if (document.getElementById('rcf-styles')) return;
      
      const style = document.createElement('style');
      style.id = 'rcf-styles';
      style.textContent = `
        /* Same styles as original but only applied when authenticated */
        [data-rcf-id] {
          position: relative;
          transition: all 0.2s ease;
        }
        
        .rcf-hovering {
          cursor: pointer !important;
          border: 2px dashed #3b82f6 !important;
          border-radius: 12px !important;
          padding: 12px !important;
          box-sizing: border-box !important;
        }
        
        .rcf-hovering::before {
          content: 'Click to edit';
          position: absolute;
          top: -48px;
          left: 50%;
          transform: translateX(-50%);
          background: #1f2937;
          color: white;
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 12px;
          white-space: nowrap;
          z-index: 10;
          opacity: 0;
          animation: rcf-fadeIn 0.2s ease forwards;
        }
        
        .rcf-hovering::after {
          content: '✏️';
          position: absolute;
          top: -12px;
          right: -12px;
          width: 32px;
          height: 32px;
          background: #3b82f6;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          opacity: 0;
          animation: rcf-fadeIn 0.2s ease forwards;
        }
        
        @keyframes rcf-fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    // Simplified edit functionality - same as original but requires authentication
    startInlineEdit(element) {
      if (!this.isAuthenticated) {
        this.redirectToLogin();
        return;
      }
      
      const elementId = element.getAttribute('data-rcf-id');
      const elementData = this.elements.get(elementId);
      if (!elementData || element.getAttribute('data-rcf-editing')) return;

      // Mark element as being edited
      element.setAttribute('data-rcf-editing', 'true');
      element.classList.add('rcf-editing');
      element.classList.remove('rcf-hovering');

      // Get full text content (fix issue #2)
      const originalText = this.getFullElementText(element);
      const computedStyle = window.getComputedStyle(element);
      let originalPadding = computedStyle.padding;
      if (originalPadding === '0px') {
        originalPadding = '8px';
      }

      // Create input element based on content type
      let inputElement;
      const isMultiline = originalText.includes('\n') || originalText.length > 60;
      
      if (isMultiline) {
        inputElement = document.createElement('textarea');
        inputElement.style.minHeight = Math.max(element.offsetHeight, 40) + 'px';
        inputElement.style.resize = 'vertical';
      } else {
        inputElement = document.createElement('input');
        inputElement.type = 'text';
      }

      // Calculate optimal text color based on background (fix issue #1)
      const optimalTextColor = this.getOptimalTextColor(element, computedStyle);

      // Apply inherited styles to maintain appearance
      inputElement.value = originalText;
      inputElement.style.cssText = `
        background: transparent !important;
        border: none !important;
        outline: none !important;
        padding: ${originalPadding} !important;
        margin: 0 !important;
        width: 100% !important;
        font-family: ${computedStyle.fontFamily} !important;
        font-size: ${computedStyle.fontSize} !important;
        font-weight: ${computedStyle.fontWeight} !important;
        font-style: ${computedStyle.fontStyle} !important;
        line-height: ${computedStyle.lineHeight} !important;
        letter-spacing: ${computedStyle.letterSpacing} !important;
        text-align: ${computedStyle.textAlign} !important;
        text-decoration: ${computedStyle.textDecoration} !important;
        text-transform: ${computedStyle.textTransform} !important;
        color: ${optimalTextColor} !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        box-sizing: border-box !important;
        text-shadow: ${this.getTextShadow(optimalTextColor)} !important;
      `;

      if (inputElement.tagName === 'TEXTAREA') {
        inputElement.style.cssText += `
          white-space: pre-wrap !important;
          overflow: visible !important;
          height: auto !important;
        `;
      }

      // Create action buttons
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'rcf-actions';
      actionsDiv.innerHTML = `
        <button class="rcf-btn-ai" type="button" title="AI Suggestions">
          🪄 AI
        </button>
        <button class="rcf-btn-save" type="button" title="Save changes (Ctrl+Enter)">
          ✓ Save
        </button>
        <button class="rcf-btn-cancel" type="button" title="Cancel editing (Esc)">
          ✕ Cancel
        </button>
      `;

      // Position actions relative to element
      const rect = element.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      actionsDiv.style.position = 'absolute';
      actionsDiv.style.left = '50%';
      actionsDiv.style.top = (rect.top + scrollTop - 64) + 'px';
      actionsDiv.style.zIndex = '10000';

      // Replace element content with input
      const originalContent = element.innerHTML;
      element.innerHTML = '';
      element.appendChild(inputElement);
      
      // Add actions to body
      document.body.appendChild(actionsDiv);

      // Focus and select input
      inputElement.focus();
      inputElement.select();

      // Auto-resize textarea
      if (inputElement.tagName === 'TEXTAREA') {
        const autoResize = () => {
          inputElement.style.height = 'auto';
          inputElement.style.height = (inputElement.scrollHeight) + 'px';
        };
        inputElement.addEventListener('input', autoResize);
        autoResize();
      }

      // Handle keyboard shortcuts
      inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
      });

      // Handle save
      const saveBtn = actionsDiv.querySelector('.rcf-btn-save');
      const cancelBtn = actionsDiv.querySelector('.rcf-btn-cancel');
      const aiBtn = actionsDiv.querySelector('.rcf-btn-ai');

      const cleanup = () => {
        element.removeAttribute('data-rcf-editing');
        element.classList.remove('rcf-editing');
        if (document.body.contains(actionsDiv)) {
          document.body.removeChild(actionsDiv);
        }
      };

      const save = () => {
        const newContent = inputElement.value;
        
        // Update element content
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          element.value = newContent;
          element.innerHTML = originalContent;
        } else {
          element.textContent = newContent;
        }
        
        // Update stored data
        elementData.originalContent = newContent;
        
        // Send update to server
        this.sendContentUpdate(elementId, newContent);
        
        // Show success feedback
        element.classList.add('rcf-updated');
        setTimeout(() => {
          element.classList.remove('rcf-updated');
        }, 1000);
        
        cleanup();
      };

      const cancel = () => {
        element.innerHTML = originalContent;
        cleanup();
      };

      saveBtn.onclick = save;
      cancelBtn.onclick = cancel;
      
      if (aiBtn) {
        aiBtn.onclick = () => {
          this.showAISuggestions(inputElement, element);
        };
      }

      // Auto-save on blur after delay
      let blurTimeout;
      inputElement.addEventListener('blur', () => {
        blurTimeout = setTimeout(() => {
          if (element.getAttribute('data-rcf-editing')) {
            save();
          }
        }, 2000);
      });

      inputElement.addEventListener('focus', () => {
        clearTimeout(blurTimeout);
      });
    }

    /**
     * Get full text content including hidden overflow text
     */
    getFullElementText(element) {
      // Try different methods to get full text
      let text = '';
      
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        text = element.value || element.placeholder || '';
      } else {
        // Get all text content, including hidden overflow
        text = element.textContent || element.innerText || '';
        
        // If text seems truncated (ends with ...), try to get original
        if (text.endsWith('...') || text.endsWith('…')) {
          // Look for title attribute or data attributes that might contain full text
          text = element.title || element.getAttribute('data-full-text') || text;
        }
      }
      
      return text.trim();
    }

    /**
     * Calculate optimal text color based on background contrast
     */
    getOptimalTextColor(element, computedStyle) {
      // Get background color from element and its parents
      const backgroundColor = this.getEffectiveBackgroundColor(element);
      
      // Calculate luminance
      const luminance = this.getLuminance(backgroundColor);
      
      // Use original color if it has good contrast, otherwise use optimal color
      const originalColor = computedStyle.color;
      const originalLuminance = this.getLuminance(this.parseColor(originalColor));
      
      // Calculate contrast ratio
      const originalContrast = this.getContrastRatio(luminance, originalLuminance);
      
      // If original has good contrast (4.5:1 for normal text), keep it
      if (originalContrast >= 4.5) {
        return originalColor;
      }
      
      // Otherwise, choose high contrast color
      return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    /**
     * Get effective background color by traversing parent elements
     */
    getEffectiveBackgroundColor(element) {
      let currentElement = element;
      const colors = [];
      
      while (currentElement && currentElement !== document.body) {
        const style = window.getComputedStyle(currentElement);
        const bgColor = style.backgroundColor;
        
        if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
          colors.push(this.parseColor(bgColor));
          
          // If we hit an opaque background, we can stop
          if (colors[colors.length - 1].a >= 1) {
            break;
          }
        }
        
        currentElement = currentElement.parentElement;
      }
      
      // If no background found, assume white
      if (colors.length === 0) {
        return { r: 255, g: 255, b: 255, a: 1 };
      }
      
      // Composite colors from top to bottom
      return colors.reduce((bottom, top) => {
        return this.compositeColors(bottom, top);
      });
    }

    /**
     * Parse CSS color to RGB object
     */
    parseColor(color) {
      const div = document.createElement('div');
      div.style.color = color;
      document.body.appendChild(div);
      
      const computedColor = window.getComputedStyle(div).color;
      document.body.removeChild(div);
      
      const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3]),
          a: match[4] ? parseFloat(match[4]) : 1
        };
      }
      
      // Fallback for hex colors
      if (color.startsWith('#')) {
        const hex = color.slice(1);
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 1
        };
      }
      
      return { r: 0, g: 0, b: 0, a: 1 };
    }

    /**
     * Calculate luminance of a color
     */
    getLuminance(color) {
      const { r, g, b } = color;
      
      const rs = r / 255;
      const gs = g / 255;
      const bs = b / 255;
      
      const rLin = rs <= 0.03928 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
      const gLin = gs <= 0.03928 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
      const bLin = bs <= 0.03928 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);
      
      return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    }

    /**
     * Calculate contrast ratio between two luminance values
     */
    getContrastRatio(lum1, lum2) {
      const brighter = Math.max(lum1, lum2);
      const darker = Math.min(lum1, lum2);
      return (brighter + 0.05) / (darker + 0.05);
    }

    /**
     * Composite two colors (alpha blending)
     */
    compositeColors(bottom, top) {
      const alpha = top.a;
      const invAlpha = 1 - alpha;
      
      return {
        r: Math.round(alpha * top.r + invAlpha * bottom.r),
        g: Math.round(alpha * top.g + invAlpha * bottom.g),
        b: Math.round(alpha * top.b + invAlpha * bottom.b),
        a: alpha + bottom.a * invAlpha
      };
    }

    /**
     * Get appropriate text shadow for better visibility
     */
    getTextShadow(textColor) {
      const isLight = textColor === '#ffffff' || textColor.toLowerCase() === 'white';
      
      if (isLight) {
        return '1px 1px 2px rgba(0, 0, 0, 0.7)';
      } else {
        return '1px 1px 2px rgba(255, 255, 255, 0.7)';
      }
    }

    /**
     * Send content update to server
     */
    sendContentUpdate(elementId, content) {
      if (!this.isAuthenticated || !this.socket) return;
      
      this.socket.emit('content-update', {
        siteId: SITE_ID,
        elementId: elementId,
        content: content,
        editToken: EDIT_TOKEN
      });
    }

    /**
     * Show AI suggestions for content
     */
    showAISuggestions(inputElement, element) {
      // Placeholder for AI suggestions functionality
      console.log('AI suggestions coming soon...');
    }

    sendContentMap() {
      if (!this.isAuthenticated || !this.socket) return;
      
      const contentMap = {};
      
      this.elements.forEach((data, elementId) => {
        contentMap[elementId] = {
          selector: data.selector,
          content: data.originalContent,
          type: data.type
        };
      });
      
      this.socket.emit('content-map', {
        siteId: SITE_ID,
        url: window.location.href,
        contentMap: contentMap,
        editToken: EDIT_TOKEN
      });
    }

    handleContentUpdate(data) {
      const { elementId, content } = data;
      const elementData = this.elements.get(elementId);
      if (!elementData) return;
      
      if (elementData.element.tagName === 'INPUT' || elementData.element.tagName === 'TEXTAREA') {
        elementData.element.value = content;
      } else {
        elementData.element.textContent = content;
      }
      
      elementData.element.classList.add('rcf-updated');
      setTimeout(() => {
        elementData.element.classList.remove('rcf-updated');
      }, 300);
    }

    setupMutationObserver() {
      this.observer = new MutationObserver((mutations) => {
        let shouldRescan = false;
        
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            shouldRescan = true;
          }
        });
        
        if (shouldRescan) {
          clearTimeout(this.rescanTimeout);
          this.rescanTimeout = setTimeout(() => {
            this.scanForContent();
            if (this.isAuthenticated) {
              this.sendContentMap();
            }
          }, 500);
        }
      });
      
      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    destroy() {
      if (this.socket) {
        this.socket.disconnect();
      }
      if (this.observer) {
        this.observer.disconnect();
      }
      if (this.sessionCheckInterval) {
        clearInterval(this.sessionCheckInterval);
      }
      this.elements.clear();
      this.clearStoredToken();
    }
  }
  
  // Initialize secure ReCopyFast
  window.ReCopyFast = new ReCopyFastSecure();
  
  // Expose limited API
  window.recopyfast = {
    isAuthenticated: () => window.ReCopyFast.isAuthenticated,
    getSession: () => window.ReCopyFast.editSession,
    login: () => window.ReCopyFast.redirectToLogin(),
    destroy: () => window.ReCopyFast.destroy()
  };
})();