(function() {
  'use strict';
  
  // Configuration
  const RECOPYFAST_API = window.RECOPYFAST_API || 'http://localhost:3000/api';
  const RECOPYFAST_WS = window.RECOPYFAST_WS || 'http://localhost:3001';
  const SITE_ID = document.currentScript.getAttribute('data-site-id');
  const EDIT_MODE = document.currentScript.getAttribute('data-edit-mode') === 'true';
  
  if (!SITE_ID) {
    console.error('ReCopyFast: No site ID provided');
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
            editMode: this.editMode 
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
      
      // Add click handlers for editing
      document.addEventListener('click', (e) => {
        const element = e.target.closest('[data-rcf-id]');
        if (!element) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        this.openEditor(element);
      });
    }
    
    injectStyles() {
      const style = document.createElement('style');
      style.textContent = `
        .rcf-editable {
          cursor: pointer !important;
          transition: all 0.2s ease;
        }
        
        .rcf-editable:hover {
          outline: 2px dashed #3b82f6 !important;
          outline-offset: 2px;
        }
        
        .rcf-updated {
          animation: rcf-highlight 0.3s ease;
        }
        
        @keyframes rcf-highlight {
          0% { background-color: transparent; }
          50% { background-color: #fef3c7; }
          100% { background-color: transparent; }
        }
        
        .rcf-editor-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 999998;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .rcf-editor-modal {
          background: white;
          border-radius: 8px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
          z-index: 999999;
        }
      `;
      document.head.appendChild(style);
    }
    
    openEditor(element) {
      const elementId = element.getAttribute('data-rcf-id');
      const elementData = this.elements.get(elementId);
      if (!elementData) return;
      
      // Create editor overlay
      const overlay = document.createElement('div');
      overlay.className = 'rcf-editor-overlay';
      
      const modal = document.createElement('div');
      modal.className = 'rcf-editor-modal';
      
      modal.innerHTML = `
        <h3 style="margin-top: 0; margin-bottom: 16px;">Edit Content</h3>
        <textarea id="rcf-editor-textarea" style="width: 100%; min-height: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 12px;">${elementData.element.textContent}</textarea>
        
        <div style="margin-bottom: 16px;">
          <button id="rcf-ai-suggest" style="padding: 6px 12px; border: 1px solid #8b5cf6; background: #f3f4f6; color: #8b5cf6; border-radius: 4px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 16px;">🪄</span> AI Suggest
          </button>
        </div>
        
        <div id="rcf-ai-suggestions" style="display: none; margin-bottom: 16px; padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
          <div style="margin-bottom: 12px;">
            <select id="rcf-suggestion-goal" style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; margin-right: 8px;">
              <option value="improve">Improve clarity</option>
              <option value="shorten">Make shorter</option>
              <option value="expand">Add detail</option>
              <option value="optimize">Optimize for engagement</option>
            </select>
            <button id="rcf-generate-suggestions" style="padding: 4px 12px; background: #8b5cf6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
              Generate
            </button>
          </div>
          <div id="rcf-suggestions-list"></div>
        </div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="rcf-cancel" style="padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">Cancel</button>
          <button id="rcf-save" style="padding: 8px 16px; border: none; background: #3b82f6; color: white; border-radius: 4px; cursor: pointer;">Save</button>
        </div>
      `;
      
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      
      // Focus textarea
      const textarea = document.getElementById('rcf-editor-textarea');
      textarea.focus();
      textarea.select();
      
      // AI Suggestion functionality
      const aiSuggestBtn = document.getElementById('rcf-ai-suggest');
      const aiSuggestionsDiv = document.getElementById('rcf-ai-suggestions');
      const generateBtn = document.getElementById('rcf-generate-suggestions');
      const suggestionsList = document.getElementById('rcf-suggestions-list');
      const goalSelect = document.getElementById('rcf-suggestion-goal');
      
      aiSuggestBtn.onclick = () => {
        const isVisible = aiSuggestionsDiv.style.display !== 'none';
        aiSuggestionsDiv.style.display = isVisible ? 'none' : 'block';
      };
      
      generateBtn.onclick = async () => {
        const currentText = textarea.value;
        const goal = goalSelect.value;
        
        generateBtn.textContent = 'Generating...';
        generateBtn.disabled = true;
        
        try {
          const response = await fetch(`${RECOPYFAST_API}/ai/suggest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
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
              suggestionDiv.style.cssText = 'margin-bottom: 8px; padding: 8px; background: white; border: 1px solid #e5e7eb; border-radius: 4px;';
              suggestionDiv.innerHTML = `
                <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.4;">${suggestion}</p>
                <button onclick="document.getElementById('rcf-editor-textarea').value = '${suggestion.replace(/'/g, "\\'")}'" style="padding: 4px 8px; background: #8b5cf6; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
                  Use This
                </button>
              `;
              suggestionsList.appendChild(suggestionDiv);
            });
          } else {
            suggestionsList.innerHTML = '<p style="color: #ef4444; font-size: 14px; margin: 0;">Failed to generate suggestions. Please try again.</p>';
          }
        } catch (error) {
          console.error('AI suggestion error:', error);
          suggestionsList.innerHTML = '<p style="color: #ef4444; font-size: 14px; margin: 0;">Error connecting to AI service.</p>';
        } finally {
          generateBtn.textContent = 'Generate';
          generateBtn.disabled = false;
        }
      };
      
      // Handle save
      document.getElementById('rcf-save').onclick = () => {
        const newContent = textarea.value;
        
        // Update locally
        elementData.element.textContent = newContent;
        
        // Send update to server
        this.socket.emit('content-update', {
          siteId: SITE_ID,
          elementId: elementId,
          content: newContent
        });
        
        document.body.removeChild(overlay);
      };
      
      // Handle cancel
      document.getElementById('rcf-cancel').onclick = () => {
        document.body.removeChild(overlay);
      };
      
      // Handle escape key
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          document.body.removeChild(overlay);
        }
      });
    }
    
    // Fallback polling method
    startPolling() {
      setInterval(async () => {
        try {
          const response = await fetch(`${RECOPYFAST_API}/content/${SITE_ID}`);
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