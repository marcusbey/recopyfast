# RecopyFast - Claude Development Guidelines

## Core Rules

### Version Control
- **ALWAYS** commit changes with descriptive messages after completing each task
- Use conventional commit format: `feat:`, `fix:`, `refactor:`, `docs:`, etc.
- Run `git status` and `git diff` before committing to review changes

### Code Quality
- **ALWAYS** run IDE diagnostics after each task to check for linting and type errors
- Use strict TypeScript mode - no `any` types without justification
- Format code automatically with Prettier after every edit
- Fix all linting errors before considering a task complete

### Testing & Verification
- **ALWAYS** verify changes work before finalizing them
- Run builds to ensure no compilation errors
- Test critical functionality manually when automated tests aren't available
- Use the "Always Works" principle - every change should be verified

## Quick Commands
- **Lint**: `npm run lint`
- **Lint Fix**: `npm run lint:fix`
- **Type Check**: `npm run type-check`
- **Build**: `npm run build`
- **Test**: `npm test`
- **Dev**: `npm run dev`
- **Format**: `npm run format`
- **Setup**: `npm run setup`
- **Install Hooks**: `npm run hooks:install`

## Git Hooks Setup

### Pre-commit Hook
```bash
#!/bin/sh
# .git/hooks/pre-commit
npm run lint
npm run type-check
```

### Pre-push Hook
```bash
#!/bin/sh
# .git/hooks/pre-push
npm run build
npm test
```

## Development Best Practices

### Code Quality
- Always run linting before commits
- Use TypeScript strict mode
- Implement proper error handling
- Add JSDoc comments for complex functions
- Use consistent naming conventions

### Performance Optimization
- Lazy load components where possible
- Optimize images and assets
- Use React.memo for expensive components
- Implement proper caching strategies
- Monitor bundle size

### Security
- Never commit secrets or API keys
- Validate all user inputs
- Use environment variables for configuration
- Implement proper CORS settings
- Keep dependencies updated

### Testing
- Write unit tests for utilities
- Test API endpoints
- Use integration tests for critical flows
- Mock external dependencies
- Maintain test coverage above 80%

### Database
- Use transactions for multi-step operations
- Implement proper indexing
- Validate data before insertion
- Use parameterized queries
- Handle connection errors gracefully

## Tech Stack & Dependencies

### Core Framework
- **Next.js 15.4.6** with App Router
- **React 19.1.0** with TypeScript
- **Tailwind CSS 4** for styling

### Key Dependencies
- **Supabase** for database and authentication
- **Socket.io** for real-time communication
- **Zustand** for state management
- **TipTap** for rich text editing
- **Framer Motion** for animations
- **Radix UI** for accessible components

### Development Tools
- **ESLint** with Next.js config
- **Prettier** with Tailwind plugin
- **TypeScript** in strict mode
- **Concurrently** for running multiple processes

## Project Structure
```
src/
├── app/            # Next.js app router pages and API routes
│   ├── api/        # API endpoints
│   ├── dashboard/  # Dashboard pages
│   ├── demo/       # Demo page
│   └── embed/      # Embeddable widget
├── components/     # Reusable UI components
│   ├── dashboard/  # Dashboard-specific components
│   ├── demo/       # Demo components
│   ├── editor/     # Rich text editor components
│   ├── shared/     # Shared/common components
│   └── ui/         # Base UI components (buttons, etc.)
├── hooks/          # Custom React hooks
├── lib/            # Utilities and configurations
│   ├── supabase/   # Supabase client configuration
│   └── utils/      # Utility functions
├── store/          # Zustand state management
└── types/          # TypeScript type definitions
```

### Server Structure
```
server/
├── index.js        # Main server file
├── scripts/        # Server utility scripts
└── package.json    # Server dependencies
```

## Environment Variables
```bash
# Required for development
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Common Issues & Solutions

### TypeScript Errors
- Run `npm run type-check` to see all type errors
- Use proper typing for API responses
- Define interfaces for component props

### Build Failures
- Check for unused imports
- Verify all environment variables are set
- Ensure all dependencies are installed

### Performance Issues
- Use React DevTools Profiler
- Check for unnecessary re-renders
- Optimize database queries
- Implement proper caching

## Useful Scripts

### Setup Development Environment
```bash
npm install
cp .env.example .env.local
npm run dev
```

### Reset Database
```bash
npx supabase db reset
```

### Generate Types
```bash
npx supabase gen types typescript --local > src/types/supabase.ts
```

## Workflow Optimization

### Task Management
- Break complex features into smaller, manageable sub-tasks
- Use subagents for parallel processing of independent tasks
- Implement loops for repetitive tasks (e.g., build → fix errors → repeat)
- Clear context with `/clear` when switching to completely new tasks
- Resume interrupted sessions with `/resume`

### Development Efficiency
- Use thinking budget allocation ("think harder", "ultrathink") for complex problems
- Write detailed prompts in separate editor windows for complex requirements
- Leverage custom slash commands for frequently used operations
- Use images and visual context when explaining UI/UX requirements

### Self-Improvement Rules
- Suggest and create new rules based on recurring patterns
- Update documentation when discovering better practices
- Maintain a clear dependency list to prevent redundant installations
- Document project structure changes for better navigation

## Debugging Tips
- Use browser devtools for client-side issues
- Check server logs for API problems
- Use Supabase dashboard for database issues
- Monitor network requests for performance
- Use React DevTools for component debugging
- Run diagnostic checks after every significant change

## Custom Commands
Available in `.claude/commands/`:
- `/quick-build` - Run lint, type-check, and build sequence
- `/full-reset` - Complete environment reset
- `/deploy-check` - Pre-deployment verification