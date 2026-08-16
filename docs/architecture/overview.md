# ReCopyFast - Architecture Plan & Technology Stack

## System Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Client Websites                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │  Website A  │  │  Website B  │  │  Website C  │  │    ...    │ │
│  │  +Embed.js  │  │  +Embed.js  │  │  +Embed.js  │  │ +Embed.js │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘ │
└─────────┼────────────────┼────────────────┼───────────────┼────────┘
          │                │                │               │
          └────────────────┴────────────────┴───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │    CDN (Edge Network)    │
                    │   Static Asset Delivery  │
                    └──────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
        ┌───────────────────────┐    ┌───────────────────────┐
        │   WebSocket Server    │    │    API Gateway        │
        │  (Real-time Updates)  │    │   (REST/GraphQL)      │
        └───────────┬───────────┘    └───────────┬───────────┘
                    │                             │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Business Logic    │
                    │   Service Layer     │
                    └──────────┬──────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
      ┌─────────▼────────┐ ┌──▼───────┐ ┌───▼──────────┐
      │   PostgreSQL     │ │  Redis   │ │ File Storage │
      │   (Primary DB)   │ │ (Cache)  │ │   (S3/CDN)   │
      └──────────────────┘ └──────────┘ └──────────────┘
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend Layer                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Dashboard App   │  │ Editor UI    │  │ Admin Panel  │  │
│  │   (Next.js)     │  │ Components   │  │   Routes     │  │
│  └─────────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│                      Embed Script Layer                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Content Scanner │  │ DOM Observer │  │ Event Handler│  │
│  │    Module       │  │   Module     │  │   Module     │  │
│  └─────────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│                        API Layer                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Authentication  │  │ Content API  │  │ Site API     │  │
│  │    Service      │  │   Service    │  │  Service     │  │
│  └─────────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
┌─────────────────────────────────────────────────────────────┐
│                     Data Access Layer                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ ORM/Query       │  │ Cache Layer  │  │ Message Queue│  │
│  │   Builder       │  │              │  │              │  │
│  └─────────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend Technologies

#### Core Framework
- **Next.js 14** (App Router)
  - Server-side rendering for SEO
  - API routes for backend functionality
  - Built-in optimization features
  - TypeScript support

#### UI/UX Libraries
- **React 18**
  - Component-based architecture
  - Hooks for state management
  - Concurrent features
  
- **Tailwind CSS**
  - Utility-first styling
  - Responsive design system
  - Custom component library
  
- **Radix UI**
  - Accessible component primitives
  - Unstyled components
  - Keyboard navigation support

#### Editor & Content Management
- **TipTap**
  - Extensible rich-text editor
  - Real-time collaboration ready
  - Custom extensions support
  
- **Lexical** (Alternative)
  - Facebook's extensible editor
  - Better performance for large documents

#### State Management
- **Zustand**
  - Lightweight state management
  - TypeScript support
  - DevTools integration
  
- **React Query (TanStack Query)**
  - Server state synchronization
  - Caching and background updates
  - Optimistic updates

### Backend Technologies

#### Runtime & Framework
- **Node.js 20 LTS**
  - JavaScript runtime
  - Native TypeScript support
  - Performance improvements

- **Express.js** (WebSocket server)
  - Minimal web framework
  - Middleware ecosystem
  - WebSocket integration

#### Database & Storage
- **PostgreSQL 15** (via Supabase)
  - ACID compliance
  - JSON/JSONB support
  - Full-text search
  - Row-level security
  
- **Redis**
  - Session storage
  - Content caching
  - Pub/Sub for real-time events
  - Rate limiting

- **S3-Compatible Storage** (Cloudflare R2)
  - Static asset storage
  - Global distribution
  - Cost-effective pricing

#### Real-time Communication
- **Socket.io**
  - WebSocket abstraction
  - Automatic reconnection
  - Room-based broadcasting
  - Fallback mechanisms

- **WebRTC** (Future enhancement)
  - Peer-to-peer communication
  - Reduced latency
  - Bandwidth optimization

### Infrastructure & DevOps

#### Hosting & Deployment
- **Vercel**
  - Next.js optimized hosting
  - Edge functions
  - Automatic CI/CD
  - Preview deployments

- **Railway/Render** (WebSocket server)
  - Container-based deployment
  - Automatic scaling
  - WebSocket support

#### CDN & Edge Computing
- **Cloudflare**
  - Global CDN network
  - Edge Workers for script serving
  - DDoS protection
  - Analytics

#### Monitoring & Analytics
- **Sentry**
  - Error tracking
  - Performance monitoring
  - User session replay
  
- **PostHog**
  - Product analytics
  - Feature flags
  - A/B testing
  - Session recording

### Development Tools

#### Code Quality
- **TypeScript 5**
  - Type safety
  - Better IDE support
  - Refactoring confidence

- **ESLint**
  - Code linting
  - Custom rules
  - Auto-fixing

- **Prettier**
  - Code formatting
  - Consistent style
  - Git hooks integration

#### Testing
- **Vitest**
  - Fast unit testing
  - Jest compatible
  - Native ESM support

- **Playwright**
  - E2E testing
  - Cross-browser support
  - Visual regression testing

- **Mock Service Worker (MSW)**
  - API mocking
  - Network-level interception
  - Development and testing

### Security Stack

#### Authentication & Authorization
- **Supabase Auth**
  - JWT-based authentication
  - Social login providers
  - Row-level security
  - MFA support

#### API Security
- **Rate Limiting** (Redis-based)
  - Request throttling
  - DDoS protection
  - Per-user limits

- **CORS Configuration**
  - Origin validation
  - Preflight handling
  - Credential support

#### Data Security
- **Encryption**
  - TLS 1.3 for transport
  - AES-256 for data at rest
  - API key hashing

## Architecture Decisions & Rationale

### 1. Microservices vs Monolith
**Decision**: Modular Monolith with Service Separation
- Main application as monolith for simplicity
- WebSocket server as separate service for scaling
- Future migration path to microservices

### 2. Database Choice
**Decision**: PostgreSQL with Supabase
- Rich feature set (JSONB, full-text search)
- Row-level security for multi-tenancy
- Real-time subscriptions built-in
- Managed service reduces operational overhead

### 3. Real-time Architecture
**Decision**: Socket.io with Redis Pub/Sub
- Proven reliability at scale
- Automatic reconnection handling
- Room-based architecture for site isolation
- Redis for horizontal scaling

### 4. Content Delivery
**Decision**: Edge-based Script Serving
- Cloudflare Workers for dynamic script generation
- Minimal latency for global users
- A/B testing at the edge
- Version control for scripts

### 5. State Management
**Decision**: Hybrid Approach
- Zustand for client state
- React Query for server state
- Context for auth/theme
- Optimistic updates for better UX

## Scalability Considerations

### Horizontal Scaling Strategy
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Load      │────▶│ WebSocket   │────▶│ WebSocket   │
│  Balancer   │     │  Server 1   │     │  Server N   │
│  (Nginx)    │     └─────────────┘     └─────────────┘
└─────────────┘              │                   │
                             └─────────┬─────────┘
                                       │
                              ┌────────▼────────┐
                              │   Redis Cluster │
                              │   (Pub/Sub)     │
                              └─────────────────┘
```

### Performance Targets
- **Page Load**: < 1s for dashboard
- **Script Size**: < 30KB gzipped
- **Update Latency**: < 100ms for content changes
- **Concurrent Users**: 10,000+ per site
- **API Response**: < 200ms p95

### Caching Strategy
1. **CDN Layer**: Static assets, embed scripts
2. **Redis Cache**: Session data, frequent queries
3. **Application Cache**: Computed values, translations
4. **Browser Cache**: Static resources, API responses

## Security Architecture

### Defense in Depth
1. **Network Layer**: Cloudflare DDoS protection
2. **Application Layer**: Rate limiting, CORS
3. **Data Layer**: Encryption, access control
4. **Audit Layer**: Logging, monitoring

### Compliance Considerations
- GDPR compliance for EU users
- SOC 2 readiness
- Data residency options
- Audit trail for all changes

## Development Workflow

### CI/CD Pipeline
```
Git Push → GitHub Actions → Tests → Build → Deploy
    │                         │        │       │
    │                         │        │       ├── Preview (PR)
    │                         │        │       └── Production (main)
    │                         │        │
    │                         │        └── Docker Image
    │                         │
    │                         └── Unit/Integration/E2E Tests
    │
    └── Pre-commit Hooks (Lint, Format, Type Check)
```

### Environment Strategy
- **Development**: Local with Docker Compose
- **Staging**: Identical to production
- **Production**: Multi-region deployment
- **Preview**: Per-PR deployments

## Cost Optimization

### Infrastructure Costs
- **Vercel**: $20/month (Pro plan)
- **Supabase**: $25/month (Pro plan)
- **Redis**: $10/month (512MB)
- **Cloudflare**: $20/month (Pro plan)
- **Total**: ~$75/month for MVP

### Scaling Costs
- Pay-per-use model for most services
- Bandwidth optimization through caching
- Efficient database queries
- CDN for static assets

## Migration & Integration

### Integration Patterns
1. **Script Tag**: Universal compatibility
2. **NPM Package**: For modern frameworks
3. **WordPress Plugin**: For WP sites
4. **API Integration**: For custom implementations

### Data Migration
- Import/Export functionality
- API for bulk operations
- Versioning for rollback
- Incremental sync options