# Integration Tests for ReCopyFast

This directory contains comprehensive end-to-end integration tests for the ReCopyFast application. These tests verify complete user workflows and system interactions across components, APIs, and external services.

## Test Structure

### Files Overview

- **`setup.ts`** - MSW server configuration and test utilities
- **`site-registration.test.tsx`** - Site registration workflow tests
- **`content-management.test.tsx`** - Content CRUD operations tests  
- **`translation-workflow.test.tsx`** - AI translation feature tests
- **`ai-suggestions.test.tsx`** - AI content suggestion tests
- **`demo-page.test.tsx`** - Demo page and embed script tests
- **`error-handling.test.tsx`** - Error scenarios and recovery tests

## Test Scenarios Covered

### 1. Site Registration and Setup Flow
- ✅ New site registration via API
- ✅ Site data validation and error handling
- ✅ API key generation and uniqueness
- ✅ Embed script generation and format validation
- ✅ Duplicate domain prevention
- ✅ UI form validation and error states

### 2. Content Management Workflow
- ✅ Content element creation and storage
- ✅ Content retrieval with filtering (language/variant)
- ✅ Content updates and persistence
- ✅ UI state management during CRUD operations
- ✅ Language and variant switching
- ✅ Edit mode workflows with save/cancel

### 3. Translation Workflow
- ✅ AI translation API integration
- ✅ Batch translation of multiple elements
- ✅ Language selection and validation
- ✅ Translation result processing and display
- ✅ Error handling for translation failures
- ✅ UI interactions (element selection, language switching)
- ✅ Translation history and result management

### 4. AI Suggestion Workflow
- ✅ Content suggestion generation
- ✅ Different suggestion goals (improve, shorten, expand, optimize)
- ✅ Tone variation (professional, casual, marketing, technical)
- ✅ Suggestion selection and application
- ✅ Copy-to-clipboard functionality
- ✅ Modal workflow and state management
- ✅ Integration with content editors

### 5. Demo Page Integration
- ✅ ReCopyFast script loading and configuration
- ✅ Global configuration variable setup
- ✅ Script load success/error handling
- ✅ Component cleanup on unmount
- ✅ Real-time editing simulation
- ✅ WebSocket connection mocking
- ✅ Complete demo workflow from load to edit

### 6. Error Handling Integration
- ✅ API error responses (400, 404, 500)
- ✅ Network timeout and connectivity issues
- ✅ Malformed response handling
- ✅ Component error boundaries
- ✅ Form validation and error recovery
- ✅ Retry mechanisms and state recovery
- ✅ Graceful degradation for missing features

## Running Integration Tests

### All Integration Tests
```bash
npm run test:integration
```

### Specific Test Files
```bash
# Site registration tests
npm test site-registration.test.tsx

# Content management tests  
npm test content-management.test.tsx

# Translation workflow tests
npm test translation-workflow.test.tsx

# AI suggestions tests
npm test ai-suggestions.test.tsx

# Demo page tests
npm test demo-page.test.tsx

# Error handling tests
npm test error-handling.test.tsx
```

### Watch Mode
```bash
npm run test:integration -- --watch
```

### Coverage Report
```bash
npm run test:coverage -- --testPathPattern=integration
```

## Test Configuration

### MSW (Mock Service Worker) Setup

The tests use MSW to mock HTTP requests and responses. All API endpoints are mocked in `setup.ts`:

- `/api/sites/register` - Site registration
- `/api/content/:siteId` - Content management (GET, POST, PUT)
- `/api/ai/translate` - AI translation service
- `/api/ai/suggest` - AI content suggestions

### Mock Handlers

Mock handlers simulate realistic API responses including:
- Success responses with proper data structures
- Validation errors (400 status)
- Not found errors (404 status) 
- Server errors (500 status)
- Different response formats based on request parameters

### Test Utilities

Common utilities provided in `setup.ts`:
- `mockFetch()` - Simplified fetch wrapper
- `createMockSite()` - Generate mock site objects
- `createMockContentElement()` - Generate mock content objects
- `waitFor()` - Custom wait helper for async operations
- `MockWebSocket` - WebSocket simulation class

## Test Data and Scenarios

### Realistic Test Data
- Site domains and names that reflect real usage
- Content elements with proper selectors and text
- Language codes following ISO standards
- Error messages matching production API responses

### Edge Cases Covered
- Empty and invalid form submissions
- Network timeouts and connection failures
- Malformed JSON responses
- Missing browser APIs (clipboard, WebSocket)
- Component crashes and error recovery
- Race conditions in async operations

### User Journey Testing
Tests follow complete user workflows:
1. Register new site → Get API key → Generate embed script
2. Add content → Translate to multiple languages → View results
3. Edit content → Get AI suggestions → Apply changes
4. Handle errors → Retry operations → Recover state

## Error Simulation

### API Errors
- Domain already exists (400)
- Site not found (404) 
- Translation service unavailable (500)
- Invalid request parameters (400)

### Network Issues
- Request timeouts
- Connection failures
- Malformed responses
- Service unavailable

### Browser Compatibility
- Missing clipboard API
- WebSocket not supported
- JavaScript errors and crashes

## Assertions and Validation

### API Response Validation
- Correct HTTP status codes
- Response data structure and types
- Error message format and content
- Token usage and metadata

### UI State Validation  
- Loading states during async operations
- Error message display and clearing
- Form validation and submission states
- Component rendering and updates

### Integration Points
- Data flow between components
- State persistence across user actions
- Event handling and callbacks
- Component lifecycle management

## Best Practices

### Test Organization
- Each file focuses on a specific feature area
- Tests are grouped by functionality
- Setup and teardown are properly handled
- Mock data is realistic and consistent

### Async Testing
- Proper use of `waitFor()` for async operations
- Timeout handling for slow operations
- Race condition prevention
- Promise resolution/rejection testing

### Error Testing
- Comprehensive error scenario coverage
- Recovery mechanism validation
- User experience during errors
- State consistency after errors

### Maintenance
- Mock handlers match real API behavior
- Test data reflects production scenarios
- Regular updates for new features
- Documentation kept current

## Troubleshooting

### Common Issues
1. **MSW handlers not found** - Check setup.ts imports
2. **Timeout errors** - Increase wait timeout values
3. **State pollution** - Ensure proper cleanup in afterEach
4. **Mock conflicts** - Reset handlers between tests

### Debug Tips
- Use `screen.debug()` to inspect rendered output
- Add console.log to mock handlers for debugging
- Check network tab for actual vs mocked requests
- Verify test isolation with focused runs

### Performance
- Mock responses return quickly
- Large datasets are paginated in tests
- Heavy computations are mocked out
- Test timeouts are reasonable

## Future Enhancements

### Planned Additions
- Visual regression testing for UI components
- Performance testing for large datasets
- Cross-browser compatibility testing
- Mobile responsiveness validation

### Integration Points
- Database transaction testing
- File upload/download workflows
- Third-party API integration testing
- WebSocket real-time feature testing

This integration test suite ensures that ReCopyFast works correctly across all user workflows and handles edge cases gracefully. The tests provide confidence in deployments and help prevent regressions during development.