# ReCopyFast - Universal CMS Layer

Transform any website into an editable platform with a simple script tag. ReCopyFast provides real-time content management capabilities without requiring backend modifications.

## Quick Start

### 1. Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account (for database)

### 2. Setup

1. Clone the repository and install dependencies:

```bash
# Install main dependencies
npm install

# Install WebSocket server dependencies
npm run ws:install
```

2. Set up environment variables:

Create `.env.local` file and update with your Supabase credentials:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# WebSocket Server
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

3. Set up the database:

Run the SQL schema in `supabase/schema.sql` in your Supabase SQL editor.

### 3. Running the Development Server

```bash
npm run dev
```

This will start:
- Next.js app on http://localhost:3000
- WebSocket server on http://localhost:3001

### 4. Testing the Demo

1. Open http://localhost:3000/demo.html in your browser
2. Click on any text element to edit it (edit mode is enabled)
3. Changes will be saved automatically

## How to Integrate ReCopyFast

Add this script tag before the closing `</body>` tag on any website:

```html
<script src="https://your-domain.com/embed/recopyfast.js" 
        data-site-id="your-site-id"
        data-site-token="your-signed-token"></script>
```

For edit mode (allows clicking elements to edit):

```html
<script src="https://your-domain.com/embed/recopyfast.js" 
        data-site-id="your-site-id"
        data-site-token="your-signed-token"
        data-edit-mode="true"></script>
```

## Project Structure

```
recopyfast/
├── src/
│   ├── app/              # Next.js app directory
│   │   ├── api/          # API routes
│   │   ├── dashboard/    # Dashboard pages
│   │   └── page.tsx      # Homepage
│   ├── components/       # React components
│   ├── lib/              # Utilities and configs
│   └── types/            # TypeScript types
├── server/               # WebSocket server
├── public/
│   └── embed/            # Embed script
└── supabase/             # Database schema
```

## Features

- 🚀 **Instant Setup** - Single script tag integration
- ✏️ **Real-time Editing** - Changes reflect immediately
- 🌍 **Multi-language Support** - Manage content in multiple languages
- 📱 **Responsive** - Works on all devices
- 🔒 **Secure** - Role-based permissions
- 📊 **Version Control** - Track all content changes

## API Documentation

### Sites API

#### Register a new site
```
POST /api/sites/register
Body: { domain: string, name: string }
Response: { site: Site, apiKey: string, siteToken: string, embedScript: string }
```

### Content API

#### Get content elements
```
GET /api/content/:siteId?language=en&variant=default
Response: ContentElement[]
```

#### Update content
```
PUT /api/content/:siteId
Body: { elementId: string, content: string }
Response: { success: boolean }
```

## WebSocket Events

### Client → Server

- `content-map` - Send initial content mapping
- `content-update` - Update specific content element
- `join-dashboard` - Join dashboard room

### Server → Client

- `content-update` - Receive content updates
- `content-map-updated` - Notification of new content
- `update-error` - Error notifications

## Development Commands

```bash
# Run development server
npm run dev

# Run only Next.js
npm run dev:next

# Run only WebSocket server
npm run dev:ws

# Build for production
npm run build

# Run linter
npm run lint
```

## Deployment

### Vercel (Next.js App)
1. Connect your GitHub repository to Vercel
2. Set environment variables
3. Deploy

### Railway/Render (WebSocket Server)
1. Deploy the `server` directory
2. Set environment variables
3. Update NEXT_PUBLIC_WS_URL in your app

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details
