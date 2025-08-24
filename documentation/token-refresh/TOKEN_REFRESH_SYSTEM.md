# Token Refresh System Documentation

## Overview

The Token Refresh System ensures that all Google OAuth access tokens remain fresh and valid for seamless integration with Google services (Gmail, Calendar, Docs, Sheets, Drive). The system automatically checks token expiration, refreshes expired tokens, and reinitializes MCP servers with fresh tokens.

## Key Features

✅ **Automatic Token Refresh**: Checks and refreshes expired tokens before and after message processing  
✅ **MCP Server Reinitialization**: Automatically updates MCP servers with fresh tokens  
✅ **Background Processing**: Non-blocking token refresh after successful message completion  
✅ **Smart Caching**: Clears MCP cache when tokens are refreshed to ensure fresh connections  
✅ **Error Handling**: Graceful handling of refresh failures with detailed logging  
✅ **React Hook**: Client-side token management with `useTokenRefresh`  
✅ **API Endpoints**: RESTful endpoints for token status and refresh operations  

## System Architecture

### Core Components

1. **TokenRefreshManager** (`/src/lib/token-refresh.ts`)
2. **Chat API Integration** (`/src/app/api/chat/route.ts`)
3. **MCP Manager Integration** (`/src/lib/mcp-manager.ts`)
4. **Token API Endpoints** (`/src/app/api/tokens/refresh/route.ts`)
5. **React Hook** (`/src/hooks/useTokenRefresh.ts`)

### Token Refresh Flow

```
User Message → Pre-Message Token Check → MCP Initialization → Message Processing → Post-Message Token Refresh
     ↓               ↓                        ↓                      ↓                       ↓
   Received    Check Expiration          Fresh Tokens         AI Response            Background Refresh
     ↓               ↓                        ↓                      ↓                       ↓
  Authenticate   Refresh if Needed      Initialize MCP        Stream Response        Keep Tokens Fresh
     ↓               ↓                        ↓                      ↓                       ↓
   Proceed       Clear Cache if           Ready for Use         Complete             Ready for Next
                   Refreshed
```

## Implementation Details

### 1. TokenRefreshManager

**Location**: `/src/lib/token-refresh.ts`

**Key Methods**:
- `ensureAllTokensFresh(userId)` - Ensures all user tokens are valid
- `getFreshToken(userId, app)` - Gets a fresh token for a specific app
- `refreshTokenForApp(userId, app, refreshToken)` - Refreshes a single app's token
- `checkUserConnectionStatus(userId)` - Checks connection health for all apps

**Features**:
- 5-minute expiration buffer for proactive refresh
- Duplicate refresh prevention with promise caching
- Automatic database updates with fresh tokens
- Comprehensive error handling and logging

### 2. Chat API Integration

**Location**: `/src/app/api/chat/route.ts`

**Pre-Message Token Check**:
```typescript
// Added after user authentication, before MCP initialization
if (userId !== "anonymous") {
  const tokenRefreshResult = await tokenRefreshManager.ensureAllTokensFresh(userId);
  if (tokenRefreshResult.refreshedApps.length > 0) {
    mcpManager.clearUserCache(userId); // Force MCP reinitialization
  }
}
```

**Post-Message Token Refresh**:
```typescript
// Added after successful message completion
tokenRefreshManager.refreshExpiredTokensForUser(userId)
  .then((result) => {
    if (result.refreshedApps.length > 0) {
      mcpManager.clearUserCache(userId); // Prepare for next request
    }
  })
  .catch((error) => console.error("Post-message refresh error:", error));
```

### 3. MCP Manager Integration

**Location**: `/src/lib/mcp-manager.ts`

**Fresh Token Integration**:
```typescript
// Replaced token assumption with actual refresh
const freshToken = await tokenRefreshManager.getFreshToken(userId, app);
if (freshToken) {
  validToken = freshToken; // Use fresh token for MCP server
}
```

**New Methods**:
- `clearUserCache(userId)` - Clears user's MCP cache
- `refreshMCPServersWithFreshTokens(userId)` - Full refresh with token validation

### 4. API Endpoints

**Location**: `/src/app/api/tokens/refresh/route.ts`

#### GET `/api/tokens/refresh`
Check token status for the authenticated user.

**Response**:
```json
{
  "success": true,
  "userId": "user_123",
  "connectionStatus": {
    "userId": "user_123",
    "connectedApps": ["gmail", "calendar"],
    "expiredApps": ["docs"],
    "failedApps": ["sheets"],
    "needsReconnection": true,
    "lastChecked": "2024-01-01T12:00:00Z"
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

#### POST `/api/tokens/refresh`
Refresh expired tokens for the authenticated user.

**Request Body**:
```json
{
  "force": false  // Optional: force refresh even if not expired
}
```

**Response**:
```json
{
  "success": true,
  "userId": "user_123",
  "refreshedApps": ["docs"],
  "failedApps": ["sheets"],
  "connectionStatus": { /* updated status */ },
  "cacheCleared": true,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### 5. React Hook

**Location**: `/src/hooks/useTokenRefresh.ts`

**Usage Example**:
```typescript
import { useTokenRefresh } from '@/hooks/useTokenRefresh';

function MyComponent() {
  const {
    isRefreshing,
    refreshTokens,
    checkTokenStatus,
    needsReconnection,
    connectedApps,
    appsNeedingReconnection,
    error
  } = useTokenRefresh();

  const handleRefresh = async () => {
    try {
      const result = await refreshTokens();
      console.log('Refreshed apps:', result.refreshedApps);
    } catch (error) {
      console.error('Refresh failed:', error);
    }
  };

  const handleStatusCheck = async () => {
    try {
      const status = await checkTokenStatus();
      console.log('Connected apps:', status.connectionStatus.connectedApps);
    } catch (error) {
      console.error('Status check failed:', error);
    }
  };

  return (
    <div>
      <button onClick={handleRefresh} disabled={isRefreshing}>
        {isRefreshing ? 'Refreshing...' : 'Refresh Tokens'}
      </button>
      
      <button onClick={handleStatusCheck}>
        Check Token Status
      </button>

      {needsReconnection && (
        <div className="alert">
          Apps need reconnection: {appsNeedingReconnection.join(', ')}
        </div>
      )}

      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}
    </div>
  );
}
```

## Token Lifecycle

### 1. Initial Connection
User connects Google apps through OAuth flow → Tokens stored in database

### 2. Pre-Message Check
Before processing messages → Check token expiration → Refresh if needed → Clear MCP cache if refreshed

### 3. MCP Initialization
MCP servers get fresh tokens → Initialize with valid authentication

### 4. Message Processing
AI agent uses MCP tools with fresh tokens → Successful API calls

### 5. Post-Message Refresh
Background token refresh → Keep tokens fresh for next request → Clear cache if needed

### 6. Error Handling
Failed refreshes logged → User notified if reconnection needed → Graceful degradation

## Database Schema

The system works with the existing `user_integrations` table:

```sql
user_integrations (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  provider VARCHAR NOT NULL, -- 'google'
  app VARCHAR NOT NULL,      -- 'gmail', 'calendar', etc.
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  token_type VARCHAR,
  scope TEXT,
  created_at TIMESTAMP,
  last_updated TIMESTAMP
)
```

## Configuration

### Environment Variables Required
```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
NEXT_PUBLIC_GOOGLE_REDIRECT_URI=your_redirect_uri
```

### Token Expiration Buffer
- **Default**: 5 minutes before actual expiration
- **Configurable** in `TokenRefreshManager` constructor

## Monitoring & Logging

### Success Logs
```
✅ Successfully refreshed token for gmail
✅ Refreshed tokens for apps: gmail, calendar
✅ Post-message refresh: Updated tokens for docs
```

### Error Logs
```
❌ Failed to refresh token for sheets: invalid_grant
❌ Token refresh error for calendar: network timeout
⚠️ Post-message refresh: Failed for sheets
```

### Debug Information
```
🔄 Checking and refreshing expired tokens for user: user_123
🔍 Token for gmail is expired, refreshing...
🗑️ Clearing MCP cache due to token refresh...
```

## Best Practices

### 1. Error Handling
- Always handle refresh failures gracefully
- Don't block user requests due to token refresh issues
- Provide clear feedback about apps needing reconnection

### 2. Performance
- Use background refresh after message completion
- Cache management to avoid unnecessary reinitializations
- Prevent duplicate refresh operations

### 3. Security
- Never log full tokens (only prefixes)
- Secure refresh token storage
- Proper error messages without sensitive data

### 4. User Experience
- Transparent token management
- Clear reconnection instructions
- Minimal disruption to workflow

## Troubleshooting

### Common Issues

1. **"Token refresh failed: invalid_grant"**
   - User needs to reconnect the app
   - Refresh token may be revoked or expired

2. **"No refresh token available"**
   - OAuth flow didn't request offline access
   - Check `access_type: "offline"` in OAuth configuration

3. **"MCP servers not reinitializing"**
   - Check if cache clearing is working
   - Verify fresh tokens are being passed to MCP servers

### Debugging Steps

1. Check token status: `GET /api/tokens/refresh`
2. Force refresh: `POST /api/tokens/refresh` with `{"force": true}`
3. Check database for token expiration dates
4. Review server logs for specific error messages
5. Test individual app connections

## Future Enhancements

- [ ] Token refresh retry logic with exponential backoff
- [ ] Webhook support for token revocation notifications
- [ ] Metrics dashboard for token health monitoring
- [ ] Automatic reconnection prompts in UI
- [ ] Batch token refresh optimization
- [ ] Token refresh scheduling for idle users