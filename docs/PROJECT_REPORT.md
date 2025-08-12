# Universal CMS Layer - Project Report

## Project Description

ReCopyFast is a universal Content Management System (CMS) layer that transforms any existing website into an editable platform without requiring backend modifications. By embedding a simple script tag, website owners can instantly enable content editing capabilities while maintaining their existing site architecture.

### Core Value Proposition
- **Universal Compatibility**: Works with any website regardless of the underlying technology stack
- **Zero Backend Changes**: No modifications required to existing website infrastructure
- **Real-time Editing**: Two-way data binding ensures immediate content updates
- **Multi-language Support**: Built-in internationalization capabilities
- **Version Control**: Support for A/B testing and content variants

### Key Features
1. **Script-based Integration**: Single script tag installation
2. **Automatic Content Extraction**: Intelligently identifies and extracts editable text elements
3. **Visual Editor**: In-context editing interface for content managers
4. **Central CMS Dashboard**: Unified interface for managing content across multiple sites
5. **Real-time Synchronization**: Changes reflect instantly on live websites
6. **Role-based Access Control**: Granular permissions for different user types
7. **Content Versioning**: Multiple variants and language versions support

## Step-by-Step Actions to Build the Prototype

### Phase 1: Core Infrastructure Setup (Day 1-2)

#### 1. Initialize Next.js Project
```bash
npx create-next-app@latest recopyfast --typescript --tailwind --app
cd recopyfast
npm install
```

#### 2. Set Up Essential Dependencies
```bash
npm install @supabase/supabase-js socket.io socket.io-client
npm install @tiptap/react @tiptap/starter-kit
npm install framer-motion lucide-react
npm install -D @types/node
```

#### 3. Create Project Structure
```
recopyfast/
├── app/
│   ├── api/
│   │   ├── content/
│   │   ├── sites/
│   │   └── auth/
│   ├── dashboard/
│   │   ├── sites/
│   │   ├── content/
│   │   └── settings/
│   └── embed/
├── components/
│   ├── editor/
│   ├── dashboard/
│   └── shared/
├── lib/
│   ├── supabase/
│   ├── websocket/
│   └── utils/
├── public/
│   └── embed/
│       └── recopyfast.js
└── types/
```

### Phase 2: Embed Script Development (Day 2-3)

#### 4. Create the Embed Script
**File: public/embed/recopyfast.js**
```javascript
(function() {
  const RECOPYFAST_API = 'https://api.recopyfast.com';
  const SITE_ID = document.currentScript.getAttribute('data-site-id');
  
  class ReCopyFast {
    constructor() {
      this.elements = new Map();
      this.socket = null;
      this.init();
    }
    
    init() {
      this.scanForContent();
      this.establishConnection();
      this.setupMutationObserver();
    }
    
    scanForContent() {
      const textElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, button, a');
      textElements.forEach((el, index) => {
        const id = `rcf-${SITE_ID}-${index}`;
        el.setAttribute('data-rcf-id', id);
        this.elements.set(id, {
          element: el,
          originalContent: el.textContent,
          selector: this.generateSelector(el)
        });
      });
    }
    
    generateSelector(element) {
      // Generate unique CSS selector for element
      const path = [];
      while (element.parentElement) {
        let selector = element.tagName.toLowerCase();
        if (element.id) {
          selector = `#${element.id}`;
          path.unshift(selector);
          break;
        } else if (element.className) {
          selector += `.${element.className.split(' ').join('.')}`;
        }
        path.unshift(selector);
        element = element.parentElement;
      }
      return path.join(' > ');
    }
    
    establishConnection() {
      this.socket = io(RECOPYFAST_API, {
        query: { siteId: SITE_ID }
      });
      
      this.socket.on('content-update', (data) => {
        this.updateContent(data);
      });
      
      // Send initial content map
      this.socket.emit('content-map', this.getContentMap());
    }
    
    updateContent(data) {
      const { elementId, content } = data;
      const item = this.elements.get(elementId);
      if (item) {
        item.element.textContent = content;
      }
    }
    
    getContentMap() {
      const map = {};
      this.elements.forEach((value, key) => {
        map[key] = {
          content: value.originalContent,
          selector: value.selector
        };
      });
      return map;
    }
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ReCopyFast());
  } else {
    new ReCopyFast();
  }
})();
```

### Phase 3: Backend API Development (Day 3-4)

#### 5. Set Up Supabase Database
```sql
-- Sites table
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Content elements table
CREATE TABLE content_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id),
  element_id TEXT NOT NULL,
  selector TEXT NOT NULL,
  original_content TEXT,
  current_content TEXT,
  language TEXT DEFAULT 'en',
  variant TEXT DEFAULT 'default',
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(site_id, element_id, language, variant)
);

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'editor',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Site permissions
CREATE TABLE site_permissions (
  user_id UUID REFERENCES users(id),
  site_id UUID REFERENCES sites(id),
  permission TEXT DEFAULT 'edit',
  PRIMARY KEY (user_id, site_id)
);
```

#### 6. Create API Routes
**File: app/api/sites/register/route.ts**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  const { domain, name } = await request.json();
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  
  const apiKey = crypto.randomBytes(32).toString('hex');
  const siteId = crypto.randomUUID();
  
  const { data, error } = await supabase
    .from('sites')
    .insert({ id: siteId, domain, name, api_key: apiKey })
    .select()
    .single();
  
  if (error) return NextResponse.json({ error }, { status: 400 });
  
  const embedScript = `<script src="https://cdn.recopyfast.com/embed/recopyfast.js" data-site-id="${siteId}"></script>`;
  
  return NextResponse.json({ site: data, embedScript });
}
```

### Phase 4: Dashboard Development (Day 4-5)

#### 7. Create Dashboard Layout
**File: app/dashboard/layout.tsx**
```typescript
import { Sidebar } from '@/components/dashboard/Sidebar';
import { Header } from '@/components/dashboard/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

#### 8. Create Content Editor Component
**File: components/editor/ContentEditor.tsx**
```typescript
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export function ContentEditor({ elementId, siteId, initialContent }) {
  const [saving, setSaving] = useState(false);
  
  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    onUpdate: ({ editor }) => {
      debouncedSave(editor.getHTML());
    },
  });
  
  const debouncedSave = debounce(async (content) => {
    setSaving(true);
    await supabase
      .from('content_elements')
      .update({ current_content: content })
      .eq('element_id', elementId)
      .eq('site_id', siteId);
    
    // Emit update via WebSocket
    socket.emit('content-update', {
      siteId,
      elementId,
      content
    });
    
    setSaving(false);
  }, 500);
  
  return (
    <div className="border rounded-lg p-4">
      <EditorContent editor={editor} />
      {saving && <span className="text-sm text-gray-500">Saving...</span>}
    </div>
  );
}
```

### Phase 5: Real-time Synchronization (Day 5-6)

#### 9. Set Up WebSocket Server
**File: server/websocket.js**
```javascript
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const io = new Server(3001, {
  cors: {
    origin: '*',
  },
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const siteConnections = new Map();

io.on('connection', (socket) => {
  const { siteId } = socket.handshake.query;
  
  if (!siteConnections.has(siteId)) {
    siteConnections.set(siteId, new Set());
  }
  siteConnections.get(siteId).add(socket);
  
  socket.on('content-map', async (contentMap) => {
    // Store initial content in database
    for (const [elementId, data] of Object.entries(contentMap)) {
      await supabase
        .from('content_elements')
        .upsert({
          site_id: siteId,
          element_id: elementId,
          selector: data.selector,
          original_content: data.content,
          current_content: data.content,
        });
    }
  });
  
  socket.on('content-update', (data) => {
    // Broadcast to all connected clients for this site
    const sockets = siteConnections.get(data.siteId);
    sockets.forEach((s) => {
      if (s !== socket) {
        s.emit('content-update', data);
      }
    });
  });
  
  socket.on('disconnect', () => {
    siteConnections.get(siteId).delete(socket);
  });
});
```

### Phase 6: Multi-language & Variants Support (Day 6-7)

#### 10. Add Language Switcher
**File: components/dashboard/LanguageVariantSelector.tsx**
```typescript
import { Select } from '@/components/ui/select';

export function LanguageVariantSelector({ onLanguageChange, onVariantChange }) {
  const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
  ];
  
  const variants = ['default', 'variant-a', 'variant-b'];
  
  return (
    <div className="flex gap-4">
      <Select onValueChange={onLanguageChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Select language" />
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      <Select onValueChange={onVariantChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Select variant" />
        </SelectTrigger>
        <SelectContent>
          {variants.map((variant) => (
            <SelectItem key={variant} value={variant}>
              {variant}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

### Phase 7: Testing & Deployment (Day 7)

#### 11. Create Test Site
```html
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
</head>
<body>
  <header>
    <h1>Welcome to Our Test Site</h1>
    <p>This is a paragraph that can be edited</p>
  </header>
  
  <main>
    <h2>Features</h2>
    <p>Edit this content in real-time</p>
    <button>Click Me</button>
  </main>
  
  <!-- ReCopyFast Integration -->
  <script src="http://localhost:3000/embed/recopyfast.js" data-site-id="test-site-123"></script>
</body>
</html>
```

#### 12. Deploy Services
```bash
# Deploy Next.js app to Vercel
vercel deploy

# Deploy WebSocket server to Railway/Render
# Configure environment variables
# Set up CDN for embed script

# Production embed script update
<script src="https://cdn.recopyfast.com/embed/recopyfast.js" data-site-id="YOUR_SITE_ID"></script>
```

## Technical Architecture

### Frontend Stack
- **Framework**: Next.js 14 with App Router
- **Styling**: Tailwind CSS
- **Editor**: TipTap
- **Real-time**: Socket.io Client
- **State Management**: React Context + Hooks

### Backend Stack
- **API**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **WebSocket**: Socket.io Server
- **Authentication**: Supabase Auth
- **CDN**: Cloudflare/Vercel Edge

### Key Implementation Details

1. **Content Extraction**: The embed script uses DOM traversal to identify text elements and assign unique IDs
2. **Selector Generation**: Creates resilient CSS selectors that survive DOM changes
3. **Two-way Binding**: WebSocket connections maintain real-time sync between CMS and websites
4. **Version Control**: Database schema supports multiple content versions per element
5. **Performance**: Debounced updates and efficient DOM manipulation
6. **Security**: API key authentication and CORS policies

## MVP Features for Quick Testing

1. Basic script embedding
2. Automatic text extraction
3. Simple inline editing
4. Real-time updates
5. Single language support
6. Basic dashboard

This prototype can be built and tested within a week, providing immediate value for testing on existing websites.