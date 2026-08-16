# RecopyFast Testing Standards

## Overview

This document outlines the comprehensive testing standards and practices for the RecopyFast application. These standards ensure code quality, maintainability, and reliability across all testing initiatives.

## Testing Philosophy

### Core Principles

1. **Test-Driven Development (TDD)**: Write tests before implementing features when possible
2. **Comprehensive Coverage**: Aim for >80% code coverage across all modules
3. **Test Isolation**: Each test should be independent and not rely on other tests
4. **Fast Feedback**: Tests should execute quickly to enable rapid development cycles
5. **Meaningful Assertions**: Tests should verify actual business logic, not implementation details

### Testing Pyramid

```
           /\
          /  \
         / UI \      <- End-to-End Tests (10%)
        /______\
       /        \
      / Integration \   <- Integration Tests (20%)
     /____________\
    /              \
   /   Unit Tests   \   <- Unit Tests (70%)
  /________________\
```

## Test Categories

### 1. Unit Tests

**Purpose**: Test individual functions, components, or modules in isolation.

**Coverage Requirements**:
- All utility functions
- React components (props, state, events)
- API services
- Business logic functions
- Error handling paths

**Standards**:
- Use Jest as the primary testing framework
- Use React Testing Library for component tests
- Mock external dependencies
- Follow AAA pattern (Arrange, Act, Assert)
- Each test should have a descriptive name

**Example Structure**:
```typescript
describe('ComponentName', () => {
  describe('Feature/Behavior', () => {
    it('should do something specific when condition is met', () => {
      // Arrange
      const props = { ... };
      
      // Act
      render(<Component {...props} />);
      
      // Assert
      expect(screen.getByText('Expected Text')).toBeInTheDocument();
    });
  });
});
```

### 2. Integration Tests

**Purpose**: Test the interaction between different modules or systems.

**Coverage Areas**:
- API endpoints with database interactions
- Component integration workflows
- External service integrations
- Data flow between layers

**Standards**:
- Use MSW (Mock Service Worker) for HTTP mocking
- Test realistic user scenarios
- Verify data persistence and retrieval
- Test error propagation between layers

### 3. End-to-End Tests

**Purpose**: Test complete user workflows from the UI perspective.

**Coverage Areas**:
- Critical user journeys
- Cross-browser compatibility
- Mobile responsiveness
- Performance benchmarks

## File Organization

### Directory Structure
```
src/
├── __tests__/
│   ├── integration/
│   └── api/
├── components/
│   └── ComponentName/
│       ├── ComponentName.tsx
│       └── __tests__/
│           └── ComponentName.test.tsx
├── lib/
│   └── utils/
│       ├── utility.ts
│       └── __tests__/
│           └── utility.test.ts
└── hooks/
    ├── useCustomHook.ts
    └── __tests__/
        └── useCustomHook.test.ts
```

### Naming Conventions

- Test files: `*.test.tsx` or `*.test.ts`
- Test directories: `__tests__/`
- Integration tests: `*.integration.test.ts`
- E2E tests: `*.e2e.test.ts`

## Mocking Standards

### 1. Module Mocking

**External Dependencies**:
```typescript
// Mock at module level before imports
jest.mock('@/lib/external-service', () => ({
  externalFunction: jest.fn(),
}));
```

**Internal Services**:
```typescript
// Mock with proper type safety
jest.mock('@/lib/ai/openai-service', () => ({
  aiService: {
    translateText: jest.fn(),
    generateContentSuggestion: jest.fn(),
  },
}));
```

### 2. Component Mocking

**Third-party Components**:
```typescript
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
```

### 3. API Mocking

**Supabase Client**:
```typescript
const mockSupabase = {
  from: jest.fn(() => mockSupabase),
  select: jest.fn(() => mockSupabase),
  eq: jest.fn(() => mockSupabase),
  single: jest.fn(),
  insert: jest.fn(() => mockSupabase),
  update: jest.fn(() => mockSupabase),
  upsert: jest.fn(),
};
```

**HTTP Requests** (using MSW):
```typescript
import { rest } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  rest.get('/api/content/:siteId', (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  })
);
```

## Component Testing Standards

### React Testing Library Best Practices

1. **Query Priority**:
   1. `getByRole` - Most accessible
   2. `getByLabelText` - Form elements
   3. `getByPlaceholderText` - Form inputs
   4. `getByText` - Non-interactive elements
   5. `getByTestId` - Last resort

2. **User Interactions**:
```typescript
import userEvent from '@testing-library/user-event';

it('should handle user input', async () => {
  const user = userEvent.setup();
  render(<MyComponent />);
  
  const input = screen.getByRole('textbox');
  await user.type(input, 'Hello World');
  
  expect(input).toHaveValue('Hello World');
});
```

3. **Async Testing**:
```typescript
it('should load data asynchronously', async () => {
  render(<AsyncComponent />);
  
  expect(screen.getByText('Loading...')).toBeInTheDocument();
  
  await waitFor(() => {
    expect(screen.getByText('Data loaded')).toBeInTheDocument();
  });
});
```

### Component Test Coverage

**Required Tests**:
- Rendering with default props
- Rendering with various prop combinations
- User interaction handlers
- Conditional rendering logic
- Error states
- Loading states

**Example Component Test**:
```typescript
describe('Button', () => {
  describe('Rendering', () => {
    it('should render with default props', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should render with custom variant', () => {
      render(<Button variant="secondary">Click me</Button>);
      expect(screen.getByRole('button')).toHaveClass('variant-secondary');
    });
  });

  describe('Interactions', () => {
    it('should call onClick when clicked', async () => {
      const handleClick = jest.fn();
      const user = userEvent.setup();
      
      render(<Button onClick={handleClick}>Click me</Button>);
      
      await user.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('States', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Button disabled>Click me</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });
});
```

## API Testing Standards

### Route Handler Testing

**Structure**:
```typescript
describe('/api/endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup mocks
  });

  describe('GET', () => {
    it('should return data successfully', async () => {
      // Setup
      mockDatabase.mockResolvedValue({ data: mockData, error: null });
      
      // Execute
      const request = new NextRequest('http://localhost/api/endpoint');
      const response = await GET(request);
      const data = await response.json();
      
      // Assert
      expect(response.status).toBe(200);
      expect(data).toEqual(expectedData);
    });

    it('should handle errors gracefully', async () => {
      // Setup error condition
      mockDatabase.mockResolvedValue({ data: null, error: 'Database error' });
      
      // Execute
      const response = await GET(request);
      const data = await response.json();
      
      // Assert
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });
});
```

### Database Interaction Testing

**Supabase Method Chaining**:
```typescript
// For queries with multiple .eq() calls
mockSupabase.eq
  .mockReturnValueOnce(mockSupabase) // first eq()
  .mockReturnValueOnce(mockSupabase) // second eq()
  .mockResolvedValueOnce({ data: mockData, error: null }); // final eq()
```

### Error Handling

**Required Error Tests**:
- Database connection failures
- Invalid request data
- Authentication errors
- Rate limiting
- External service failures

## Performance Testing

### Metrics to Track

1. **Component Render Time**: <16ms for 60fps
2. **API Response Time**: <200ms for good UX
3. **Bundle Size**: Track growth over time
4. **Memory Usage**: Monitor for leaks

### Performance Test Examples

```typescript
// Component performance
it('should render within performance budget', () => {
  const start = performance.now();
  render(<ExpensiveComponent />);
  const end = performance.now();
  
  expect(end - start).toBeLessThan(16); // 60fps budget
});

// API performance
it('should respond within SLA', async () => {
  const start = Date.now();
  const response = await fetch('/api/endpoint');
  const end = Date.now();
  
  expect(end - start).toBeLessThan(200);
  expect(response.ok).toBe(true);
});
```

## Test Data Management

### Fixtures and Factories

**Mock Data**:
```typescript
// Create reusable mock data
export const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
};

export const createMockSite = (overrides = {}) => ({
  id: 'site-123',
  name: 'Test Site',
  url: 'https://example.com',
  ...overrides,
});
```

### Test Database

**Guidelines**:
- Use in-memory database for unit tests
- Use test database for integration tests
- Clean up data after each test
- Use transactions for isolation

## Error and Edge Case Testing

### Required Edge Cases

1. **Boundary Values**:
   - Empty strings
   - Maximum length inputs
   - Zero and negative numbers
   - Null and undefined values

2. **Network Conditions**:
   - Slow connections
   - Connection failures
   - Timeout scenarios

3. **User Behavior**:
   - Rapid clicking
   - Invalid inputs
   - Unexpected navigation

### Error Testing Examples

```typescript
describe('Error Handling', () => {
  it('should handle empty input gracefully', () => {
    render(<SearchComponent />);
    const input = screen.getByRole('textbox');
    
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.submit(input.closest('form'));
    
    expect(screen.getByText('Please enter a search term')).toBeInTheDocument();
  });

  it('should handle network errors', async () => {
    // Mock network failure
    server.use(
      rest.get('/api/data', (req, res, ctx) => {
        return res.networkError('Failed to connect');
      })
    );

    render(<DataComponent />);
    
    await waitFor(() => {
      expect(screen.getByText('Failed to load data')).toBeInTheDocument();
    });
  });
});
```

## Test Environment Setup

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

### Setup Files

```typescript
// jest.setup.js
import '@testing-library/jest-dom';
import { server } from './src/__tests__/mocks/server';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Mock console methods in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};
```

## Continuous Integration

### Pre-commit Hooks

```bash
#!/bin/sh
# .git/hooks/pre-commit
npm run lint
npm run type-check
npm test -- --watchAll=false --coverage
```

### GitHub Actions

```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm test -- --coverage --watchAll=false
      - uses: codecov/codecov-action@v3
```

## Testing Tools and Libraries

### Required Dependencies

```json
{
  "devDependencies": {
    "@testing-library/react": "^13.4.0",
    "@testing-library/jest-dom": "^5.16.5",
    "@testing-library/user-event": "^14.4.3",
    "jest": "^29.5.0",
    "jest-environment-jsdom": "^29.5.0",
    "msw": "^1.2.1"
  }
}
```

### Recommended Tools

- **Jest**: Test runner and assertion library
- **React Testing Library**: React component testing
- **MSW**: API mocking for integration tests
- **Playwright**: End-to-end testing
- **Istanbul**: Code coverage reporting

## Common Testing Anti-patterns

### What NOT to Do

1. **Testing Implementation Details**:
```typescript
// ❌ Bad - tests implementation
expect(wrapper.find('.internal-class')).toHaveLength(1);

// ✅ Good - tests behavior
expect(screen.getByRole('button')).toBeInTheDocument();
```

2. **Shared Test State**:
```typescript
// ❌ Bad - shared state
let sharedData;
beforeAll(() => { sharedData = {}; });

// ✅ Good - isolated state
beforeEach(() => {
  const testData = createFreshData();
});
```

3. **Over-mocking**:
```typescript
// ❌ Bad - mocking everything
jest.mock('./utils'); // entire module
jest.mock('./constants');

// ✅ Good - minimal mocking
jest.mock('./expensiveOperation');
```

## Best Practices Summary

### Do's

- ✅ Write descriptive test names
- ✅ Test user behavior, not implementation
- ✅ Use proper async/await handling
- ✅ Mock external dependencies
- ✅ Maintain test independence
- ✅ Keep tests focused and simple
- ✅ Use meaningful assertions
- ✅ Test error conditions

### Don'ts

- ❌ Test implementation details
- ❌ Write tests that depend on each other
- ❌ Mock what you're testing
- ❌ Ignore async operations
- ❌ Write overly complex tests
- ❌ Skip edge cases
- ❌ Forget to clean up

## Maintenance and Review

### Regular Tasks

1. **Weekly**: Review test coverage reports
2. **Monthly**: Update test dependencies
3. **Quarterly**: Review and refactor slow tests
4. **Per PR**: Ensure new code includes tests

### Code Review Checklist

- [ ] Tests cover new functionality
- [ ] Tests are properly isolated
- [ ] Mock setup is correct
- [ ] Error cases are tested
- [ ] Tests are readable and maintainable
- [ ] No test anti-patterns present

## Resources

### Documentation
- [Jest Documentation](https://jestjs.io/docs)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [MSW Documentation](https://mswjs.io/docs/)

### Internal Resources
- [API Testing Guide](./API_TESTING.md)
- [Component Testing Examples](../src/components/__tests__/examples/)
- [Integration Test Setup](../src/__tests__/integration/README.md)

---

*This document should be updated as testing practices evolve and new patterns emerge.*