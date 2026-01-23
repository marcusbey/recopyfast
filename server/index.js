const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
require('dotenv').config({ path: '../.env.local' });

const app = express();
const httpServer = createServer(app);

// Validate environment variables
const requiredEnvVars = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
};

// Check for missing or invalid environment variables
const missingVars = [];
const invalidUrls = [];

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value || value.includes('your_') || value === 'undefined') {
    missingVars.push(key);
  } else if (key.includes('URL') && !isValidUrl(value)) {
    invalidUrls.push(key);
  }
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Initialize Supabase client (with error handling)
let supabase = null;
let supabaseEnabled = false;
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function sanitizeContent(content) {
  if (!content) return '';
  return DOMPurify.sanitize(String(content), {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}

function normalizeDomain(domain) {
  if (!domain) return null;
  try {
    const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    return url.hostname.toLowerCase();
  } catch (error) {
    return null;
  }
}

function parseHost(header) {
  if (!header) return null;
  try {
    return new URL(header).hostname.toLowerCase();
  } catch (error) {
    return null;
  }
}

function verifySiteToken(siteId, apiKey, token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [tokenSiteId, issuedAt, signature] = parts;
  if (tokenSiteId !== siteId) return false;
  if (!/^[0-9]+$/.test(issuedAt)) return false;

  const expectedSignature = crypto
    .createHmac('sha256', apiKey)
    .update(`${tokenSiteId}.${issuedAt}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (error) {
    return false;
  }
}

if (missingVars.length === 0 && invalidUrls.length === 0) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    supabaseEnabled = true;
    console.log('✓ Supabase client initialized successfully');
  } catch (error) {
    console.error('✗ Failed to initialize Supabase client:', error.message);
  }
} else {
  console.warn('⚠ Running in development mode without Supabase');
  if (missingVars.length > 0) {
    console.warn('  Missing environment variables:', missingVars.join(', '));
  }
  if (invalidUrls.length > 0) {
    console.warn('  Invalid URLs:', invalidUrls.join(', '));
  }
  console.warn('  Set up Supabase credentials in .env.local to enable persistence');
}

// Initialize Socket.io with CORS
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests without origin (e.g., mobile apps) for development
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connections: io.engine.clientsCount,
    supabase: supabaseEnabled ? 'connected' : 'disabled',
    message: supabaseEnabled ? 'All systems operational' : 'Running in development mode - set up Supabase for full functionality'
  });
});

// Store active connections by site
const siteConnections = new Map();
const userConnections = new Map();

// Validate staging access token
async function validateStagingAccess(stagingToken, siteId) {
  if (!supabaseEnabled || !stagingToken) {
    return { valid: false };
  }

  try {
    const { data: access, error } = await supabase
      .from('staging_access')
      .select('*')
      .eq('token', stagingToken)
      .eq('site_id', siteId)
      .eq('is_active', true)
      .gte('expires_at', new Date().toISOString())
      .single();

    if (error || !access) {
      return { valid: false, error: 'Invalid or expired staging token' };
    }

    if (!access.email_verified) {
      return { valid: false, error: 'Email verification required' };
    }

    return {
      valid: true,
      verified: true,
      email: access.email,
      permissions: access.permissions,
      accessId: access.id
    };
  } catch (error) {
    console.error('Staging token validation error:', error);
    return { valid: false, error: 'Validation failed' };
  }
}

// Socket.io connection handling
io.on('connection', async (socket) => {
  console.log('New connection:', socket.id);

  const { siteId, editMode, token, stagingMode, stagingToken } = socket.handshake.query;
  const originHeader = socket.handshake.headers.origin || socket.handshake.headers.referer;
  const isStaging = stagingMode === 'true' || stagingMode === true;

  if (!siteId) {
    socket.disconnect();
    return;
  }

  if (!token) {
    socket.emit('auth-error', { error: 'Missing site token' });
    socket.disconnect();
    return;
  }

  let siteRecord = null;

  if (supabaseEnabled) {
    try {
      const { data: site, error } = await supabase
        .from('sites')
        .select('id, domain, api_key')
        .eq('id', siteId)
        .single();

      if (error || !site) {
        socket.emit('auth-error', { error: 'Site not found' });
        socket.disconnect();
        return;
      }

      if (!verifySiteToken(siteId, site.api_key, token)) {
        socket.emit('auth-error', { error: 'Invalid site token' });
        socket.disconnect();
        return;
      }

      const allowedDomain = normalizeDomain(site.domain);
      const requestHost = parseHost(originHeader);

      if (allowedDomain && requestHost && requestHost !== allowedDomain) {
        socket.emit('auth-error', { error: 'Origin not allowed' });
        socket.disconnect();
        return;
      }

      siteRecord = site;
      socket.data.siteToken = token;

      // Validate staging access if in staging mode
      if (isStaging && stagingToken) {
        const stagingAccess = await validateStagingAccess(stagingToken, siteId);

        if (!stagingAccess.valid) {
          socket.emit('auth-error', { error: stagingAccess.error || 'Invalid staging access' });
          socket.disconnect();
          return;
        }

        socket.data.isStaging = true;
        socket.data.stagingToken = stagingToken;
        socket.data.stagingEmail = stagingAccess.email;
        socket.data.stagingPermissions = stagingAccess.permissions;
        socket.data.stagingAccessId = stagingAccess.accessId;

        console.log(`Staging connection for site ${siteId} by ${stagingAccess.email}`);
      }
    } catch (error) {
      console.error('Site verification failed:', error);
      socket.emit('auth-error', { error: 'Site verification failed' });
      socket.disconnect();
      return;
    }
  } else {
    console.warn('Supabase not configured - skipping site token verification');
    // In dev mode, allow staging connections
    if (isStaging) {
      socket.data.isStaging = true;
      socket.data.stagingToken = stagingToken;
    }
  }

  // Join appropriate room based on staging mode
  if (socket.data.isStaging) {
    socket.join(`site:${siteId}:staging`);
    console.log(`Client joined staging room: site:${siteId}:staging`);
  } else {
    socket.join(`site:${siteId}`);
  }
  
  // Track connections
  if (!siteConnections.has(siteId)) {
    siteConnections.set(siteId, new Set());
  }
  siteConnections.get(siteId).add(socket.id);
  
  // Handle content map from embed script
  socket.on('content-map', async (data) => {
    console.log(`Received content map for site ${siteId}`);
    
    try {
      const { url, contentMap, token: messageToken } = data;

      if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
        socket.emit('auth-error', { error: 'Invalid site token' });
        return;
      }
      
      // Store content elements in database
      const contentElements = [];
      
      for (const [elementId, elementData] of Object.entries(contentMap)) {
        const safeContent = sanitizeContent(elementData.content);
        contentElements.push({
          site_id: siteId,
          element_id: elementId,
          selector: elementData.selector,
          original_content: safeContent,
          current_content: safeContent,
          language: 'en',
          variant: 'default',
          metadata: { 
            type: elementData.type,
            url: url
          }
        });
      }
      
      // Batch upsert to database (if Supabase is enabled)
      if (contentElements.length > 0) {
        if (supabaseEnabled) {
          const { error } = await supabase
            .from('content_elements')
            .upsert(contentElements, {
              onConflict: 'site_id,element_id,language,variant'
            });
          
          if (error) {
            console.error('Error saving content elements:', error);
          } else {
            console.log(`Saved ${contentElements.length} content elements for site ${siteId}`);
          }
        } else {
          console.log(`Content map received for site ${siteId} (${contentElements.length} elements) - not persisted (Supabase disabled)`);
        }
      }
      
      // Notify dashboard clients about new content
      io.to(`dashboard:${siteId}`).emit('content-map-updated', {
        siteId,
        url,
        elementCount: Object.keys(contentMap).length
      });
      
    } catch (error) {
      console.error('Error processing content map:', error);
    }
  });
  
  // Handle content updates from dashboard or staging
  socket.on('content-update', async (data) => {
    const isStaging = socket.data.isStaging;
    console.log(`Content update for site ${siteId} (${isStaging ? 'staging' : 'live'}):`, data.elementId);

    try {
      const { elementId, content, language = 'en', variant = 'default', token: messageToken } = data;

      if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
        socket.emit('auth-error', { error: 'Invalid site token' });
        return;
      }

      // Check staging edit permission
      if (isStaging) {
        const permissions = socket.data.stagingPermissions || [];
        const hasEditPermission = permissions.includes('edit') ||
                                   permissions.includes('publish') ||
                                   permissions.includes('admin');
        if (!hasEditPermission) {
          socket.emit('update-error', { error: 'Edit permission required' });
          return;
        }
      }

      const sanitizedContent = sanitizeContent(content);
      const now = new Date().toISOString();

      // Update database (if Supabase is enabled)
      if (supabaseEnabled) {
        let updateData;

        if (isStaging) {
          // Staging mode: write to staging_content
          updateData = {
            staging_content: sanitizedContent,
            staging_updated_at: now,
            updated_at: now
          };
        } else {
          // Live mode: write to current_content (legacy support)
          updateData = {
            current_content: sanitizedContent,
            updated_at: now
          };
        }

        const { error } = await supabase
          .from('content_elements')
          .update(updateData)
          .eq('site_id', siteId)
          .eq('element_id', elementId)
          .eq('language', language)
          .eq('variant', variant);

        if (error) {
          console.error('Error updating content:', error);
          socket.emit('update-error', { error: 'Failed to save content' });
          return;
        }

        // Record staging history
        if (isStaging && socket.data.stagingAccessId) {
          const { data: element } = await supabase
            .from('content_elements')
            .select('id')
            .eq('site_id', siteId)
            .eq('element_id', elementId)
            .eq('language', language)
            .eq('variant', variant)
            .single();

          if (element) {
            await supabase.from('staging_history').insert({
              content_element_id: element.id,
              staging_access_id: socket.data.stagingAccessId,
              new_content: sanitizedContent,
              user_email: socket.data.stagingEmail || 'unknown',
              action: 'update'
            });
          }
        }
      } else {
        console.log(`Content update for site ${siteId}, element ${elementId} - not persisted (Supabase disabled)`);
      }

      // Broadcast to appropriate room
      if (isStaging) {
        // Staging: broadcast only to staging room
        socket.to(`site:${siteId}:staging`).emit('content-update', {
          elementId,
          content: sanitizedContent,
          language,
          variant,
          isStaging: true,
          updatedBy: socket.data.stagingEmail
        });
      } else {
        // Live: broadcast to live room
        socket.to(`site:${siteId}`).emit('content-update', {
          elementId,
          content: sanitizedContent,
          language,
          variant
        });
      }

      // Notify dashboard users
      socket.to(`dashboard:${siteId}`).emit('content-updated', {
        elementId,
        content: sanitizedContent,
        updatedBy: socket.id,
        timestamp: now,
        isStaging
      });

    } catch (error) {
      console.error('Error processing content update:', error);
      socket.emit('update-error', { error: 'Internal server error' });
    }
  });
  
  // Handle dashboard connections
  socket.on('join-dashboard', (data) => {
    const { siteId: dashboardSiteId, userId } = data;
    socket.join(`dashboard:${dashboardSiteId}`);
    
    if (userId) {
      userConnections.set(socket.id, userId);
    }
    
    console.log(`Dashboard user joined for site ${dashboardSiteId}`);
  });
  
  // Handle bulk content updates (for Edit Board: style apply, language switch, etc.)
  socket.on('bulk-update', async (data) => {
    const { updates, token: messageToken, description, changeType = 'bulk_edit', createVersion = true } = data;
    const isStaging = socket.data.isStaging;

    if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
      socket.emit('auth-error', { error: 'Invalid site token' });
      return;
    }

    // Check staging edit permission
    if (isStaging) {
      const permissions = socket.data.stagingPermissions || [];
      const hasEditPermission = permissions.includes('edit') ||
                                 permissions.includes('publish') ||
                                 permissions.includes('admin');
      if (!hasEditPermission) {
        socket.emit('bulk-update-error', { error: 'Edit permission required' });
        return;
      }
    }

    try {
      const now = new Date().toISOString();

      // Create version snapshot before bulk changes (if staging and Supabase enabled)
      let versionId = null;
      if (isStaging && supabaseEnabled && createVersion) {
        try {
          const { data: versionResult } = await supabase.rpc('create_content_version', {
            p_site_id: siteId,
            p_created_by: socket.data.stagingEmail || 'unknown',
            p_description: description || `Bulk update (${updates.length} elements)`,
            p_change_type: changeType
          });
          versionId = versionResult;
          console.log(`Created version snapshot ${versionId} for site ${siteId}`);
        } catch (versionError) {
          console.error('Error creating version snapshot:', versionError);
          // Continue with updates even if version creation fails
        }
      }

      for (const update of updates) {
        const { elementId, content } = update;
        const sanitizedContent = sanitizeContent(content);

        // Update database (if Supabase is enabled)
        if (supabaseEnabled) {
          let updateData;

          if (isStaging) {
            updateData = {
              staging_content: sanitizedContent,
              staging_updated_at: now,
              updated_at: now
            };
          } else {
            updateData = { current_content: sanitizedContent };
          }

          await supabase
            .from('content_elements')
            .update(updateData)
            .eq('site_id', siteId)
            .eq('element_id', elementId);
        }

        // Broadcast each update to appropriate room
        const targetRoom = isStaging ? `site:${siteId}:staging` : `site:${siteId}`;
        io.to(targetRoom).emit('content-update', {
          elementId,
          content: sanitizedContent,
          isStaging: isStaging || undefined,
          updatedBy: isStaging ? socket.data.stagingEmail : undefined
        });
      }

      const modeText = isStaging ? ' (staging)' : '';
      const message = supabaseEnabled ?
        `Processed ${updates.length} updates${modeText}` :
        `Processed ${updates.length} updates${modeText} (not persisted - Supabase disabled)`;

      socket.emit('bulk-update-success', {
        count: updates.length,
        message,
        versionId
      });
    } catch (error) {
      console.error('Error processing bulk update:', error);
      socket.emit('bulk-update-error', { error: 'Failed to process updates' });
    }
  });

  // Handle language switching (Edit Board feature)
  socket.on('switch-language', async (data) => {
    const { languageCode, token: messageToken } = data;
    const isStaging = socket.data.isStaging;

    if (!isStaging) {
      socket.emit('switch-language-error', { error: 'Language switching only available in staging mode' });
      return;
    }

    if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
      socket.emit('auth-error', { error: 'Invalid site token' });
      return;
    }

    // Check staging edit permission
    const permissions = socket.data.stagingPermissions || [];
    const hasEditPermission = permissions.includes('edit') ||
                               permissions.includes('publish') ||
                               permissions.includes('admin');
    if (!hasEditPermission) {
      socket.emit('switch-language-error', { error: 'Edit permission required' });
      return;
    }

    try {
      if (!supabaseEnabled) {
        socket.emit('switch-language-error', { error: 'Database not available' });
        return;
      }

      // Get the language translations
      const { data: language, error: langError } = await supabase
        .from('site_languages')
        .select('translations, language_name')
        .eq('site_id', siteId)
        .eq('language_code', languageCode)
        .single();

      if (langError || !language) {
        socket.emit('switch-language-error', { error: 'Language not found' });
        return;
      }

      const translations = language.translations || {};
      const translationEntries = Object.entries(translations);

      if (translationEntries.length === 0) {
        socket.emit('switch-language-error', { error: 'No translations available for this language' });
        return;
      }

      // Create version snapshot before language switch
      try {
        await supabase.rpc('create_content_version', {
          p_site_id: siteId,
          p_created_by: socket.data.stagingEmail || 'unknown',
          p_description: `Switched to ${language.language_name} (${languageCode})`,
          p_change_type: 'language_switch'
        });
      } catch (versionError) {
        console.error('Error creating version snapshot:', versionError);
      }

      const now = new Date().toISOString();

      // Apply translations to staging content
      for (const [elementId, translatedContent] of translationEntries) {
        const sanitizedContent = sanitizeContent(translatedContent);

        await supabase
          .from('content_elements')
          .update({
            staging_content: sanitizedContent,
            staging_updated_at: now,
            updated_at: now
          })
          .eq('site_id', siteId)
          .eq('element_id', elementId);

        // Broadcast to staging room
        io.to(`site:${siteId}:staging`).emit('content-update', {
          elementId,
          content: sanitizedContent,
          isStaging: true,
          updatedBy: socket.data.stagingEmail
        });
      }

      console.log(`Switched site ${siteId} to ${languageCode} (${translationEntries.length} elements)`);

      socket.emit('switch-language-success', {
        languageCode,
        languageName: language.language_name,
        elementsUpdated: translationEntries.length
      });

    } catch (error) {
      console.error('Error switching language:', error);
      socket.emit('switch-language-error', { error: 'Failed to switch language' });
    }
  });

  // Handle version restoration (Edit Board feature)
  socket.on('restore-version', async (data) => {
    const { versionId, token: messageToken } = data;
    const isStaging = socket.data.isStaging;

    if (!isStaging) {
      socket.emit('restore-version-error', { error: 'Version restore only available in staging mode' });
      return;
    }

    if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
      socket.emit('auth-error', { error: 'Invalid site token' });
      return;
    }

    // Check staging edit permission
    const permissions = socket.data.stagingPermissions || [];
    const hasEditPermission = permissions.includes('edit') ||
                               permissions.includes('publish') ||
                               permissions.includes('admin');
    if (!hasEditPermission) {
      socket.emit('restore-version-error', { error: 'Edit permission required' });
      return;
    }

    try {
      if (!supabaseEnabled) {
        socket.emit('restore-version-error', { error: 'Database not available' });
        return;
      }

      // Restore the version using database function
      const { data: restoreResult, error: restoreError } = await supabase.rpc('restore_content_version', {
        p_version_id: versionId,
        p_restored_by: socket.data.stagingEmail || 'unknown'
      });

      if (restoreError) {
        console.error('Error restoring version:', restoreError);
        socket.emit('restore-version-error', { error: 'Failed to restore version' });
        return;
      }

      // Get the restored content to broadcast
      const { data: elements } = await supabase
        .from('content_elements')
        .select('element_id, staging_content')
        .eq('site_id', siteId)
        .not('staging_content', 'is', null);

      // Broadcast all updates to staging room
      for (const element of (elements || [])) {
        io.to(`site:${siteId}:staging`).emit('content-update', {
          elementId: element.element_id,
          content: element.staging_content,
          isStaging: true,
          updatedBy: socket.data.stagingEmail
        });
      }

      console.log(`Restored version ${versionId} for site ${siteId}`);

      socket.emit('restore-version-success', {
        versionId,
        elementsRestored: (elements || []).length
      });

    } catch (error) {
      console.error('Error restoring version:', error);
      socket.emit('restore-version-error', { error: 'Failed to restore version' });
    }
  });

  // Handle theme activation (Edit Board feature)
  socket.on('activate-theme', async (data) => {
    const { themeId, token: messageToken } = data;
    const isStaging = socket.data.isStaging;

    if (!isStaging) {
      socket.emit('activate-theme-error', { error: 'Theme activation only available in staging mode' });
      return;
    }

    if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
      socket.emit('auth-error', { error: 'Invalid site token' });
      return;
    }

    // Check admin permission for theme activation
    const permissions = socket.data.stagingPermissions || [];
    if (!permissions.includes('admin')) {
      socket.emit('activate-theme-error', { error: 'Admin permission required' });
      return;
    }

    try {
      if (!supabaseEnabled) {
        socket.emit('activate-theme-error', { error: 'Database not available' });
        return;
      }

      // Get theme content overrides
      const { data: theme, error: themeError } = await supabase
        .from('site_themes')
        .select('name, content_overrides')
        .eq('id', themeId)
        .eq('site_id', siteId)
        .single();

      if (themeError || !theme) {
        socket.emit('activate-theme-error', { error: 'Theme not found' });
        return;
      }

      const overrides = theme.content_overrides || {};
      const overrideEntries = Object.entries(overrides);

      if (overrideEntries.length === 0) {
        socket.emit('activate-theme-error', { error: 'No content overrides in this theme' });
        return;
      }

      // Create version snapshot before theme application
      try {
        await supabase.rpc('create_content_version', {
          p_site_id: siteId,
          p_created_by: socket.data.stagingEmail || 'unknown',
          p_description: `Applied theme: ${theme.name}`,
          p_change_type: 'theme_apply'
        });
      } catch (versionError) {
        console.error('Error creating version snapshot:', versionError);
      }

      const now = new Date().toISOString();

      // Deactivate other themes
      await supabase
        .from('site_themes')
        .update({ is_active: false })
        .eq('site_id', siteId)
        .neq('id', themeId);

      // Activate this theme
      await supabase
        .from('site_themes')
        .update({ is_active: true })
        .eq('id', themeId);

      // Apply content overrides to staging
      for (const [elementId, overrideContent] of overrideEntries) {
        const sanitizedContent = sanitizeContent(overrideContent);

        await supabase
          .from('content_elements')
          .update({
            staging_content: sanitizedContent,
            staging_updated_at: now,
            updated_at: now
          })
          .eq('site_id', siteId)
          .eq('element_id', elementId);

        // Broadcast to staging room
        io.to(`site:${siteId}:staging`).emit('content-update', {
          elementId,
          content: sanitizedContent,
          isStaging: true,
          updatedBy: socket.data.stagingEmail
        });
      }

      console.log(`Activated theme "${theme.name}" for site ${siteId}`);

      socket.emit('activate-theme-success', {
        themeId,
        themeName: theme.name,
        elementsUpdated: overrideEntries.length
      });

    } catch (error) {
      console.error('Error activating theme:', error);
      socket.emit('activate-theme-error', { error: 'Failed to activate theme' });
    }
  });
  
  // Handle staging publish request
  socket.on('staging-publish', async (data) => {
    const { elementIds, token: messageToken } = data;

    if (!socket.data.isStaging) {
      socket.emit('publish-error', { error: 'Not in staging mode' });
      return;
    }

    if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
      socket.emit('auth-error', { error: 'Invalid site token' });
      return;
    }

    // Check publish permission
    const permissions = socket.data.stagingPermissions || [];
    const hasPublishPermission = permissions.includes('publish') ||
                                  permissions.includes('admin');
    if (!hasPublishPermission) {
      socket.emit('publish-error', { error: 'Publish permission required' });
      return;
    }

    try {
      if (!supabaseEnabled) {
        socket.emit('publish-error', { error: 'Database not available' });
        return;
      }

      const publishedAt = new Date().toISOString();

      // Get elements to publish
      let query = supabase
        .from('content_elements')
        .select('id, element_id, staging_content, published_content')
        .eq('site_id', siteId)
        .not('staging_content', 'is', null);

      if (elementIds && elementIds.length > 0) {
        query = query.in('element_id', elementIds);
      }

      const { data: elementsToPublish, error: fetchError } = await query;

      if (fetchError) {
        console.error('Error fetching elements to publish:', fetchError);
        socket.emit('publish-error', { error: 'Failed to fetch elements' });
        return;
      }

      // Filter to only changed elements
      const changedElements = (elementsToPublish || []).filter(
        el => el.staging_content !== el.published_content
      );

      if (changedElements.length === 0) {
        socket.emit('publish-success', {
          published: 0,
          message: 'No staging changes to publish'
        });
        return;
      }

      // Publish each element
      let successCount = 0;
      for (const element of changedElements) {
        // Record history
        await supabase.from('staging_history').insert({
          content_element_id: element.id,
          staging_access_id: socket.data.stagingAccessId || null,
          previous_content: element.published_content,
          new_content: element.staging_content,
          user_email: socket.data.stagingEmail || 'unknown',
          action: 'publish'
        });

        // Update published content
        const { error: updateError } = await supabase
          .from('content_elements')
          .update({
            published_content: element.staging_content,
            published_at: publishedAt,
            updated_at: publishedAt
          })
          .eq('id', element.id);

        if (!updateError) {
          successCount++;

          // Broadcast to live site viewers
          io.to(`site:${siteId}`).emit('content-update', {
            elementId: element.element_id,
            content: element.staging_content
          });
        }
      }

      console.log(`Published ${successCount}/${changedElements.length} elements for site ${siteId}`);

      socket.emit('publish-success', {
        published: successCount,
        total: changedElements.length,
        publishedAt,
        publishedBy: socket.data.stagingEmail
      });

      // Notify dashboard
      io.to(`dashboard:${siteId}`).emit('content-published', {
        siteId,
        count: successCount,
        publishedBy: socket.data.stagingEmail,
        publishedAt
      });

    } catch (error) {
      console.error('Error publishing content:', error);
      socket.emit('publish-error', { error: 'Internal server error' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove from site connections
    if (siteConnections.has(siteId)) {
      siteConnections.get(siteId).delete(socket.id);
      if (siteConnections.get(siteId).size === 0) {
        siteConnections.delete(siteId);
      }
    }
    
    // Remove from user connections
    userConnections.delete(socket.id);
  });
});

// Start server with port auto-detection
const PORT = process.env.WS_PORT || 4001;
const MAX_PORT_ATTEMPTS = 10;

const startServer = (port, attempt = 0) => {
  if (attempt >= MAX_PORT_ATTEMPTS) {
    console.error(`Failed to find available port after ${MAX_PORT_ATTEMPTS} attempts`);
    process.exit(1);
  }

  const server = httpServer.listen(port);

  server.on('listening', () => {
    console.log(`✓ WebSocket server running on port ${port}`);
    if (supabaseEnabled) {
      console.log('✓ Supabase client initialized successfully');
    } else {
      console.log('⚠ Running in development mode - set up Supabase for persistence');
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠ Port ${port} is in use, trying ${port + 1}...`);
      // Close the failed attempt before trying next port
      server.close();
      startServer(port + 1, attempt + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
};

startServer(PORT);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
