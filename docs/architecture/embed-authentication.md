# PRD: Secure Embed Script Authentication

**Version**: 1.0  
**Date**: 2025-01-16  
**Status**: In Development  
**Priority**: Critical  

## 🎯 Problem Statement

**Current Critical Vulnerability**: The embed script allows anyone visiting a website to edit content without authentication. This creates a massive security risk where malicious users can modify website content.

**Current Flawed Flow**:
1. User adds script: `<script src="..." data-edit-mode="true">`
2. Anyone visits website → sees edit buttons → can modify content
3. Changes are saved permanently without authorization

## 🎯 Solution Overview

Implement a secure authentication layer where only authorized users can edit content through dashboard-generated edit sessions with time-limited tokens.

## 📋 Requirements

### Functional Requirements

#### FR-1: Dashboard-Based Edit Sessions
- **Requirement**: Users must log into ReCopyFast dashboard to initiate edit sessions
- **Acceptance Criteria**:
  - Remove `data-edit-mode` from public embed script
  - Add "Edit Website" button in dashboard
  - Generate secure, time-limited edit tokens
  - Edit tokens expire after configurable duration (default: 2 hours)

#### FR-2: Secure Token-Based Authentication
- **Requirement**: Edit sessions use cryptographically secure tokens
- **Acceptance Criteria**:
  - 48-byte secure token generation using crypto.randomBytes
  - Token validation on all edit operations
  - IP address tracking for additional security
  - Session timeout and cleanup

#### FR-3: Multi-User Team Support
- **Requirement**: Team members can get edit permissions based on roles
- **Acceptance Criteria**:
  - Role-based edit permissions (Viewer, Editor, Manager, Owner)
  - Individual edit tokens per team member
  - Audit trail of who made what changes
  - Concurrent editing with conflict resolution

#### FR-4: Seamless User Experience
- **Requirement**: Smooth transition from dashboard to website editing
- **Acceptance Criteria**:
  - "Edit Website" button opens site with edit token
  - Clear visual indicators for edit mode
  - Session timeout warnings
  - Login prompt for unauthorized users

### Non-Functional Requirements

#### NFR-1: Security
- Cryptographically secure token generation
- Session token validation on all operations
- IP address validation (configurable)
- Automatic session cleanup and expiration
- Protection against token hijacking

#### NFR-2: Performance
- Minimal impact on website loading times
- Efficient token validation (<50ms)
- Optimized database queries for session lookup
- Cached session validation

#### NFR-3: Reliability
- Graceful handling of expired sessions
- Automatic session renewal options
- Fallback authentication methods
- Error recovery and user notifications

## 🏗️ Technical Architecture

### Database Schema
```sql
-- Edit sessions table
CREATE TABLE edit_sessions (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id),
  user_id UUID REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL,
  permissions TEXT[] DEFAULT ARRAY['edit'],
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### API Endpoints
- `POST /api/edit-sessions/create` - Create new edit session
- `POST /api/edit-sessions/validate` - Validate edit token
- `DELETE /api/edit-sessions/{id}` - Revoke edit session
- `GET /api/edit-sessions/active` - List active sessions

### Security Flow
1. User logs into dashboard
2. Clicks "Edit Website" for specific site
3. System validates user permissions for site
4. Generate secure edit token with expiration
5. Open website with `?rcf_edit_token=xxx` parameter
6. Embed script validates token before enabling edit mode
7. All edit operations require token validation

## 🔄 User Journey

### Site Owner (Secure Flow)
1. **Login to Dashboard**: Authenticate via Supabase Auth
2. **Select Site**: Choose website from site list
3. **Start Edit Session**: Click "Edit Website" button
4. **Token Generation**: System creates secure edit token
5. **Edit Website**: Opens website with edit capabilities
6. **Make Changes**: Edit content with visual feedback
7. **Auto-Save**: Changes saved with user attribution
8. **Session Management**: View/extend/revoke sessions

### Team Member (Secure Flow)
1. **Accept Invitation**: Join team via email invitation
2. **Login to Dashboard**: Access team workspace
3. **Select Authorized Site**: View sites based on permissions
4. **Request Edit Access**: Generate edit token for role
5. **Edit Content**: Modify content within role permissions
6. **Collaborative Editing**: See other team members' changes live
7. **Session Tracking**: All edits tracked by user identity

### Visitor (Secure Flow)
1. **Visit Website**: Load site with embed script
2. **No Edit Access**: See content without edit capabilities
3. **Login Prompt**: Optional "Login to Edit" button
4. **Redirect to Dashboard**: Link to ReCopyFast authentication
5. **Permission Check**: Validate user access to site
6. **Edit Session**: Generate token if authorized

## 🧪 Testing Strategy

### Security Testing
- Token validation with invalid/expired tokens
- IP address spoofing protection
- Session hijacking prevention
- SQL injection protection
- XSS prevention in edit operations

### Integration Testing
- Dashboard to website edit flow
- Multi-user concurrent editing
- Session timeout handling
- Permission-based editing restrictions
- WebSocket authentication

### Performance Testing
- Token validation response times
- Database query optimization
- Session cleanup efficiency
- Memory usage under high concurrent sessions

## 📊 Success Metrics

### Security Metrics
- Zero unauthorized edit attempts
- 100% token validation coverage
- Sub-50ms token validation time
- Zero security incidents post-implementation

### User Experience Metrics
- <5 second edit session initiation
- 95%+ successful edit session completion
- <2% user confusion about edit access
- Zero data loss incidents

### Technical Metrics
- 99.9% edit session uptime
- <1% session timeout errors
- Zero database performance degradation
- Complete audit trail coverage

## 🚀 Implementation Plan

### Phase 1: Database & Core Authentication (Day 1)
- [ ] Create edit_sessions table schema
- [ ] Implement EditSessionManager class
- [ ] Create edit session API endpoints
- [ ] Add session validation middleware

### Phase 2: Dashboard Integration (Day 2)
- [ ] Add "Edit Website" button to dashboard
- [ ] Implement edit session creation UI
- [ ] Add active session management
- [ ] Create session timeout warnings

### Phase 3: Embed Script Security (Day 3)
- [ ] Remove data-edit-mode attribute support
- [ ] Add token-based authentication
- [ ] Implement login prompts for unauthorized users
- [ ] Add session validation to all edit operations

### Phase 4: Testing & Validation (Day 4)
- [ ] Comprehensive security testing
- [ ] User experience validation
- [ ] Performance optimization
- [ ] Documentation and deployment

## 🔒 Security Considerations

### Token Security
- Use crypto.randomBytes(48) for token generation
- Base64URL encoding for URL safety
- Store only hashed versions in database
- Implement token rotation for long sessions

### Session Security
- IP address validation (configurable)
- User agent checking for additional verification
- Automatic cleanup of expired sessions
- Rate limiting on session creation

### Data Protection
- All edit operations require valid session
- User attribution on all content changes
- Comprehensive audit logging
- GDPR-compliant data handling

## 📝 Acceptance Criteria

### Must Have
- [x] No unauthorized editing possible
- [ ] Dashboard-initiated edit sessions only
- [ ] Secure token validation on all operations
- [ ] Team member role-based permissions
- [ ] Session timeout and cleanup
- [ ] Complete audit trail

### Should Have
- [ ] Session extension without re-authentication
- [ ] Mobile-responsive edit interface
- [ ] Real-time session status in dashboard
- [ ] Bulk session revocation

### Nice to Have
- [ ] Edit session analytics
- [ ] Session sharing with expirable links
- [ ] Advanced permission granularity
- [ ] SSO integration for enterprise teams

---

**Status**: Ready for implementation with MCP Supabase integration  
**Risk Level**: Critical - Security vulnerability  
**Estimated Effort**: 4 days  
**Dependencies**: Database schema, Authentication system