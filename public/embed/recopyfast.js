(function() {
  'use strict';
  
  // Configuration
  const RECOPYFAST_API = window.RECOPYFAST_API || 'http://localhost:3000/api';
  const RECOPYFAST_WS = window.RECOPYFAST_WS || 'http://localhost:3001';
  const SITE_ID = document.currentScript.getAttribute('data-site-id');
  const SITE_TOKEN = document.currentScript.getAttribute('data-site-token');
  const EDIT_MODE = document.currentScript.getAttribute('data-edit-mode') === 'true';
  
  if (!SITE_ID) {
    console.error('ReCopyFast: No site ID provided');
    return;
  }

  if (!SITE_TOKEN) {
    console.error('ReCopyFast: No site token provided');
    return;
  }

  class ReCopyFast {
    constructor() {
      this.elements = new Map();
      this.socket = null;
      this.observer = null;
      this.isInitialized = false;
      this.editMode = EDIT_MODE;
      this.selectedElement = null;
      
      this.init();
    }
    
    async init() {
      try {
        await this.waitForDOM();
        this.scanForContent();
        await this.establishConnection();
        this.setupMutationObserver();
        this.setupEditMode();
        this.isInitialized = true;
        console.log('ReCopyFast initialized successfully');
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
    
    scanForContent() {
      // Select all text-containing elements
      const selector = 'h1, h2, h3, h4, h5, h6, p, span, button, a, li, td, th, label, div[data-rcf-content]';
      const textElements = document.querySelectorAll(selector);
      
      textElements.forEach((element, index) => {
        // Skip elements that are scripts, styles, or already processed
        if (this.shouldSkipElement(element)) return;
        
        const text = this.getElementText(element);
        if (!text || text.trim().length < 2) return;
        
        // Generate unique ID
        const elementId = element.getAttribute('data-rcf-id') || `rcf-${SITE_ID}-${Date.now()}-${index}`;
        element.setAttribute('data-rcf-id', elementId);
        
        // Store element data
        this.elements.set(elementId, {
          element: element,
          originalContent: text,
          selector: this.generateSelector(element),
          type: element.tagName.toLowerCase()
        });
        
        // Add hover effect in edit mode
        if (this.editMode) {
          element.classList.add('rcf-editable');
        }
      });
      
      console.log(`ReCopyFast: Found ${this.elements.size} editable elements`);
    }
    
    shouldSkipElement(element) {
      // Skip if element or parent is script/style
      const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'];
      if (skipTags.includes(element.tagName)) return true;
      
      // Skip if element has rcf-ignore attribute
      if (element.hasAttribute('data-rcf-ignore')) return true;
      
      // Skip if element is inside a content editable area
      if (element.closest('[contenteditable="true"]')) return true;
      
      // Skip if element only contains other elements (no direct text)
      const hasOnlyElements = Array.from(element.childNodes).every(
        node => node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()
      );
      
      return hasOnlyElements && !element.hasAttribute('data-rcf-content');
    }
    
    getElementText(element) {
      // For inputs and textareas, get the value
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return element.value;
      }
      
      // For other elements, get text content
      return element.textContent;
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
    
    generateSelector(element) {
      const path = [];
      let current = element;
      
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        
        // Add ID if exists
        if (current.id) {
          selector = `#${current.id}`;
          path.unshift(selector);
          break;
        }
        
        // Add classes
        if (current.className && typeof current.className === 'string') {
          const classes = current.className.trim().split(/\s+/).filter(c => !c.startsWith('rcf-'));
          if (classes.length > 0) {
            selector += `.${classes.join('.')}`;
          }
        }
        
        // Add index if needed
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
      try {
        // Load Socket.io dynamically
        await this.loadSocketIO();
        
        // Connect to WebSocket server
        this.socket = io(RECOPYFAST_WS, {
          query: { 
            siteId: SITE_ID,
            editMode: this.editMode,
            token: SITE_TOKEN
          },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5
        });
        
        // Socket event handlers
        this.socket.on('connect', () => {
          console.log('ReCopyFast: Connected to server');
          this.sendContentMap();
        });
        
        this.socket.on('content-update', (data) => {
          this.handleContentUpdate(data);
        });
        
        this.socket.on('disconnect', () => {
          console.log('ReCopyFast: Disconnected from server');
        });
        
        this.socket.on('error', (error) => {
          console.error('ReCopyFast: Socket error:', error);
        });
        
      } catch (error) {
        console.error('ReCopyFast: Failed to establish connection:', error);
        // Fallback to polling if WebSocket fails
        this.startPolling();
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
    
    sendContentMap() {
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
        token: SITE_TOKEN,
        contentMap: contentMap
      });
    }
    
    handleContentUpdate(data) {
      const { elementId, content, language, variant } = data;
      
      // Handle language/variant switching if needed
      if ((language && language !== 'en') || (variant && variant !== 'default')) {
        // Store for later use or implement language switching
        return;
      }
      
      const elementData = this.elements.get(elementId);
      if (!elementData) return;
      
      // Update content
      if (elementData.element.tagName === 'INPUT' || elementData.element.tagName === 'TEXTAREA') {
        elementData.element.value = content;
      } else {
        elementData.element.textContent = content;
      }
      
      // Add update animation
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
          // Debounce rescan
          clearTimeout(this.rescanTimeout);
          this.rescanTimeout = setTimeout(() => {
            this.scanForContent();
            this.sendContentMap();
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
      
      // Add styles for edit mode
      this.injectStyles();
      
      // Add click handlers for inline editing
      document.addEventListener('click', (e) => {
        const element = e.target.closest('[data-rcf-id]');
        if (!element) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        this.startInlineEdit(element);
      });
      
      // Add hover effects
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
    
    injectStyles() {
      const style = document.createElement('style');
      style.textContent = `
        /* Consistent with demo styling */
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
        
        /* Inline editing styles - preserve exact formatting */
        .rcf-editing {
          border: 2px solid #3b82f6 !important;
          border-radius: 12px !important;
          outline: none !important;
        }
        
        .rcf-editing input,
        .rcf-editing textarea {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
          margin: 0 !important;
          outline: none !important;
          resize: none !important;
          width: 100% !important;
          font-family: inherit !important;
          font-size: inherit !important;
          font-weight: inherit !important;
          font-style: inherit !important;
          line-height: inherit !important;
          letter-spacing: inherit !important;
          text-align: inherit !important;
          text-decoration: inherit !important;
          text-transform: inherit !important;
          color: inherit !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
        }
        
        .rcf-editing textarea {
          white-space: pre-wrap !important;
          overflow: visible !important;
          min-height: auto !important;
          height: auto !important;
        }
        
        /* Action buttons */
        .rcf-actions {
          position: absolute;
          top: -64px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 8px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 8px 12px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          z-index: 1000;
        }
        
        .rcf-actions button {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          font-size: 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        
        .rcf-btn-save {
          background: #10b981;
          color: white;
        }
        
        .rcf-btn-save:hover {
          background: #059669;
        }
        
        .rcf-btn-cancel {
          background: #f3f4f6;
          color: #6b7280;
        }
        
        .rcf-btn-cancel:hover {
          background: #e5e7eb;
        }
        
        .rcf-btn-ai {
          background: #f3f4f6;
          color: #8b5cf6;
        }
        
        .rcf-btn-ai:hover {
          background: #ede9fe;
        }
        
        /* Success animation */
        .rcf-updated {
          animation: rcf-highlight 0.5s ease;
        }
        
        @keyframes rcf-fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        
        @keyframes rcf-highlight {
          0% { background-color: transparent; }
          50% { background-color: #dcfce7; }
          100% { background-color: transparent; }
        }
      `;
      document.head.appendChild(style);
    }
    
    startInlineEdit(element) {
      const elementId = element.getAttribute('data-rcf-id');
      const elementData = this.elements.get(elementId);
      if (!elementData || element.getAttribute('data-rcf-editing')) return;

      // Mark element as being edited
      element.setAttribute('data-rcf-editing', 'true');
      element.classList.add('rcf-editing');
      element.classList.remove('rcf-hovering');

      // Store original content and styles (fix issue #2 - get full text)
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

      // CONSISTENT RULE: Always preserve original text color and formatting
      const originalTextColor = computedStyle.color;

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
        color: ${originalTextColor} !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        box-sizing: border-box !important;
        text-shadow: inherit !important;
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
        <button class="rcf-btn-save" type="button" title="Save changes">
          ✓ Save
        </button>
        <button class="rcf-btn-cancel" type="button" title="Cancel editing">
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
          element.innerHTML = originalContent; // Restore original structure
        } else {
          element.textContent = newContent;
        }

        // Update stored data
        elementData.originalContent = newContent;

        // Send update to server if connected
        if (this.socket && this.socket.connected) {
          this.socket.emit('content-update', {
            siteId: SITE_ID,
            elementId: elementId,
            content: newContent,
            token: SITE_TOKEN
          });
        }

        // Add success animation
        element.classList.add('rcf-updated');
        setTimeout(() => {
          element.classList.remove('rcf-updated');
        }, 500);

        cleanup();
      };

      const cancel = () => {
        // Restore original content
        element.innerHTML = originalContent;
        cleanup();
      };

      // Button event handlers
      saveBtn.onclick = save;
      cancelBtn.onclick = cancel;

      // AI suggestions handler
      aiBtn.onclick = () => {
        this.showAISuggestions(inputElement, elementId);
      };

      // Keyboard handlers
      inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          cancel();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          save();
        }
      });

      // Click outside to save (optional behavior)
      const outsideClickHandler = (e) => {
        if (!element.contains(e.target) && !actionsDiv.contains(e.target)) {
          save();
          document.removeEventListener('click', outsideClickHandler);
        }
      };
      
      // Delay adding the outside click handler to prevent immediate trigger
      setTimeout(() => {
        document.addEventListener('click', outsideClickHandler);
      }, 100);
    }

    showAISuggestions(inputElement, elementId) {
      // Create AI suggestions modal
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 500px;
        width: 90%;
        max-height: 80%;
        overflow-y: auto;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      `;

      modal.innerHTML = `
        <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; color: #1f2937;">✨ AI Content Suggestions</h3>
          <button id="rcf-ai-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #6b7280;">×</button>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">Goal:</label>
          <select id="rcf-suggestion-goal" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: white;">
            <option value="improve">Improve clarity and readability</option>
            <option value="shorten">Make more concise</option>
            <option value="expand">Add more detail</option>
            <option value="engage">Optimize for engagement</option>
            <option value="professional">Make more professional</option>
            <option value="casual">Make more casual</option>
          </select>
        </div>
        
        <div style="margin-bottom: 16px;">
          <button id="rcf-generate-suggestions" style="width: 100%; padding: 12px; background: #8b5cf6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
            🪄 Generate Suggestions
          </button>
        </div>
        
        <div id="rcf-suggestions-list" style="margin-bottom: 16px;"></div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="rcf-ai-cancel" style="padding: 8px 16px; border: 1px solid #d1d5db; background: white; border-radius: 6px; cursor: pointer; color: #6b7280;">Close</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // Event handlers
      const closeBtn = modal.querySelector('#rcf-ai-close');
      const cancelBtn = modal.querySelector('#rcf-ai-cancel');
      const generateBtn = modal.querySelector('#rcf-generate-suggestions');
      const goalSelect = modal.querySelector('#rcf-suggestion-goal');
      const suggestionsList = modal.querySelector('#rcf-suggestions-list');

      const closeModal = () => {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
      };

      closeBtn.onclick = closeModal;
      cancelBtn.onclick = closeModal;
      overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
      };

      generateBtn.onclick = async () => {
        const currentText = inputElement.value;
        const goal = goalSelect.value;
        
        if (!currentText.trim()) {
          suggestionsList.innerHTML = '<p style="color: #ef4444; margin: 0;">Please enter some text first.</p>';
          return;
        }

        generateBtn.textContent = '🔄 Generating...';
        generateBtn.disabled = true;

        try {
          const response = await fetch(`${RECOPYFAST_API}/ai/suggest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SITE_TOKEN}`,
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
            suggestionsList.innerHTML = '';
            data.suggestions.forEach((suggestion, index) => {
              const suggestionDiv = document.createElement('div');
              suggestionDiv.style.cssText = `
                margin-bottom: 12px; 
                padding: 12px; 
                background: #f9fafb; 
                border: 1px solid #e5e7eb; 
                border-radius: 8px;
                transition: all 0.2s ease;
              `;
              
              suggestionDiv.innerHTML = `
                <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #374151;">${suggestion}</p>
                <button style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">
                  Use This Suggestion
                </button>
              `;

              const useBtn = suggestionDiv.querySelector('button');
              useBtn.onclick = () => {
                inputElement.value = suggestion;
                if (inputElement.tagName === 'TEXTAREA') {
                  inputElement.style.height = 'auto';
                  inputElement.style.height = (inputElement.scrollHeight) + 'px';
                }
                inputElement.focus();
                closeModal();
              };

              // Hover effects
              suggestionDiv.onmouseenter = () => {
                suggestionDiv.style.background = '#f3f4f6';
                suggestionDiv.style.borderColor = '#d1d5db';
              };
              suggestionDiv.onmouseleave = () => {
                suggestionDiv.style.background = '#f9fafb';
                suggestionDiv.style.borderColor = '#e5e7eb';
              };

              suggestionsList.appendChild(suggestionDiv);
            });
          } else {
            suggestionsList.innerHTML = '<p style="color: #ef4444; margin: 0;">Failed to generate suggestions. Please try again.</p>';
          }
        } catch (error) {
          console.error('AI suggestion error:', error);
          suggestionsList.innerHTML = '<p style="color: #ef4444; margin: 0;">Error connecting to AI service. Please check your connection.</p>';
        } finally {
          generateBtn.textContent = '🪄 Generate Suggestions';
          generateBtn.disabled = false;
        }
      };

      // Handle escape key
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeModal();
        }
      });
    }
    
    // Fallback polling method
    startPolling() {
      setInterval(async () => {
        try {
          const response = await fetch(`${RECOPYFAST_API}/content/${SITE_ID}`, {
            headers: {
              Authorization: `Bearer ${SITE_TOKEN}`,
            },
          });
          if (response.ok) {
            const updates = await response.json();
            updates.forEach(update => this.handleContentUpdate(update));
          }
        } catch (error) {
          console.error('ReCopyFast: Polling error:', error);
        }
      }, 5000);
    }
    
    // Public API
    updateContent(elementId, content) {
      this.handleContentUpdate({ elementId, content });
    }
    
    destroy() {
      if (this.socket) {
        this.socket.disconnect();
      }
      if (this.observer) {
        this.observer.disconnect();
      }
      this.elements.clear();
    }
  }
  
  // Initialize ReCopyFast
  window.ReCopyFast = new ReCopyFast();
  
  // Expose API
  window.recopyfast = {
    update: (elementId, content) => window.ReCopyFast.updateContent(elementId, content),
    destroy: () => window.ReCopyFast.destroy(),
    rescan: () => {
      window.ReCopyFast.scanForContent();
      window.ReCopyFast.sendContentMap();
    }
  };
})();
