const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
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
    origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
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

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  const { siteId, editMode } = socket.handshake.query;
  
  if (!siteId) {
    socket.disconnect();
    return;
  }
  
  // Join site room
  socket.join(`site:${siteId}`);
  
  // Track connections
  if (!siteConnections.has(siteId)) {
    siteConnections.set(siteId, new Set());
  }
  siteConnections.get(siteId).add(socket.id);
  
  // Handle content map from embed script
  socket.on('content-map', async (data) => {
    console.log(`Received content map for site ${siteId}`);
    
    try {
      const { url, contentMap } = data;
      
      // Store content elements in database
      const contentElements = [];
      
      for (const [elementId, elementData] of Object.entries(contentMap)) {
        contentElements.push({
          site_id: siteId,
          element_id: elementId,
          selector: elementData.selector,
          original_content: elementData.content,
          current_content: elementData.content,
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
  
  // Handle content updates from dashboard
  socket.on('content-update', async (data) => {
    console.log(`Content update for site ${siteId}:`, data.elementId);
    
    try {
      const { elementId, content, language = 'en', variant = 'default' } = data;
      
      // Update database (if Supabase is enabled)
      if (supabaseEnabled) {
        const { error } = await supabase
          .from('content_elements')
          .update({ 
            current_content: content,
            updated_at: new Date().toISOString()
          })
          .eq('site_id', siteId)
          .eq('element_id', elementId)
          .eq('language', language)
          .eq('variant', variant);
        
        if (error) {
          console.error('Error updating content:', error);
          socket.emit('update-error', { error: 'Failed to save content' });
          return;
        }
      } else {
        console.log(`Content update for site ${siteId}, element ${elementId} - not persisted (Supabase disabled)`);
      }
      
      // Broadcast to all connected clients for this site
      socket.to(`site:${siteId}`).emit('content-update', {
        elementId,
        content,
        language,
        variant
      });
      
      // Notify other dashboard users
      socket.to(`dashboard:${siteId}`).emit('content-updated', {
        elementId,
        content,
        updatedBy: socket.id,
        timestamp: new Date().toISOString()
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
  
  // Handle bulk content updates
  socket.on('bulk-update', async (data) => {
    const { updates } = data;
    
    try {
      for (const update of updates) {
        const { elementId, content } = update;
        
        // Update database (if Supabase is enabled)
        if (supabaseEnabled) {
          await supabase
            .from('content_elements')
            .update({ current_content: content })
            .eq('site_id', siteId)
            .eq('element_id', elementId);
        }
        
        // Broadcast each update
        io.to(`site:${siteId}`).emit('content-update', {
          elementId,
          content
        });
      }
      
      const message = supabaseEnabled ? 
        `Processed ${updates.length} updates` :
        `Processed ${updates.length} updates (not persisted - Supabase disabled)`;
      
      socket.emit('bulk-update-success', { count: updates.length, message });
    } catch (error) {
      console.error('Error processing bulk update:', error);
      socket.emit('bulk-update-error', { error: 'Failed to process updates' });
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
const PORT = process.env.WS_PORT || 3001;

const startServer = (port) => {
  httpServer.listen(port, () => {
    console.log(`✓ WebSocket server running on port ${port}`);
    if (supabaseEnabled) {
      console.log('✓ Supabase client initialized successfully');
    } else {
      console.log('⚠ Running in development mode - set up Supabase for persistence');
    }
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠ Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
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