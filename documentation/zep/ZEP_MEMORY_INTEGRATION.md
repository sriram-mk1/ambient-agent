# Zep Memory Integration Documentation

## Overview

This AI Agent integrates with [Zep](https://www.getzep.com), a powerful memory service that provides long-term conversational memory and knowledge graph capabilities. Zep enables the AI Agent to:

- **Remember conversations** across sessions
- **Build knowledge graphs** from user interactions
- **Extract and store facts** automatically
- **Provide contextual responses** based on historical data
- **Search memory** for relevant information

## Table of Contents

- [Setup & Configuration](#setup--configuration)
- [Architecture Overview](#architecture-overview)
- [Memory Tools](#memory-tools)
- [Usage Examples](#usage-examples)
- [Integration Details](#integration-details)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)

## Setup & Configuration

### 1. Environment Variables

Add the following to your `.env.local` file:

```bash
# Zep Memory Configuration
ZEP_API_KEY=your_zep_api_key_here
```

### 2. Get Zep API Key

1. Sign up for a free account at [Zep Cloud](https://app.getzep.com/)
2. Create a new project
3. Copy your API key from the dashboard
4. Add it to your environment variables

### 3. Install Dependencies

The Zep Cloud client is already installed:

```bash
npm install @getzep/zep-cloud
```

## Architecture Overview

### Components

1. **ZepManager** (`src/lib/zep-manager.ts`)
   - Manages Zep client connections
   - Handles user and session management
   - Provides caching for performance
   - Manages memory operations

2. **Zep Memory Tools** (`src/lib/zep-tools.ts`)
   - LangChain tools for AI Agent integration
   - Provides memory search, storage, and retrieval
   - Handles contextual data management

3. **Memory Helper** (`src/lib/zep-tools.ts`)
   - Utility functions for common memory operations
   - Conversation storage and retrieval
   - Context generation for prompts

### Data Flow

```
User Message → AI Agent → Memory Tools → Zep Cloud → Knowledge Graph
                ↓
         Response with Context ← Memory Context ← Fact Retrieval
```

## Memory Tools

The AI Agent has access to the following memory tools:

### Core Memory Tools

#### `search_user_facts`
Searches for facts and information from the user's memory across all conversations.

**Parameters:**
- `userId`: User ID to search facts for
- `query`: Search query to find relevant facts
- `limit`: Maximum number of facts to return (default: 5)

#### `get_memory_context`
Retrieves the memory context string for a session, including relevant facts and summaries.

**Parameters:**
- `userId`: User ID
- `sessionId`: Session ID to get context for

#### `get_recent_messages`
Gets recent messages from the conversation history for context.

**Parameters:**
- `userId`: User ID
- `sessionId`: Session ID

### Data Management Tools

#### `add_contextual_data`
Adds important contextual information to the user's memory graph.

**Parameters:**
- `userId`: User ID
- `context`: The contextual data to add
- `source`: Optional source identifier for the data

#### `add_user_data`
Adds structured or unstructured data to the user's memory graph.

**Parameters:**
- `userId`: User ID
- `data`: The data to add to user's graph
- `type`: Data type ("text" or "json")

### Advanced Tools

#### `search_memory_graph`
Searches the user's memory graph for specific information.

**Parameters:**
- `userId`: User ID
- `query`: Search query
- `limit`: Maximum number of results (default: 10)
- `scope`: Search scope - "edges" (facts) or "nodes" (entities)

#### `create_memory_session`
Creates a new memory session for the user.

**Parameters:**
- `userId`: User ID
- `sessionId`: Optional custom session ID

#### `add_memory_message`
Adds a message to the user's memory session.

**Parameters:**
- `userId`: User ID
- `sessionId`: Session ID
- `content`: Message content
- `role`: Message role ("user", "assistant", or "system")

## Usage Examples

### Automatic Memory Integration

Memory is automatically integrated into conversations:

```typescript
// When a user sends a message, the system:
// 1. Initializes memory session
// 2. Retrieves memory context
// 3. Includes context in AI prompt
// 4. Stores conversation after completion
```

### Manual Memory Operations

The AI Agent can use memory tools directly:

```
User: "Remember that I work at Acme Corp as a Software Engineer"

Agent: I'll remember that important information about you.
*Uses add_contextual_data tool*
✅ Successfully stored: "User works at Acme Corp as a Software Engineer"
```

### Memory Search

```
User: "What do you know about my job?"

Agent: Let me search my memory about your job.
*Uses search_user_facts tool with query "job work employment"*
Found relevant facts:
1. User works at Acme Corp as a Software Engineer
2. User mentioned working on Project Alpha
3. User prefers remote work setup
```

### Cross-Session Memory

```
Session 1:
User: "I'm planning a trip to Japan next month"
Agent: *Stores travel information*

Session 2 (later):
User: "Any updates on travel requirements?"
Agent: *Retrieves context about Japan trip*
"I remember you're planning a trip to Japan next month. Let me check current travel requirements..."
```

## Integration Details

### User Management

```typescript
// Users are automatically created in Zep when they interact with the agent
const zepUser = await zepManager.createOrGetZepUser(client, userId, userDetails);
```

User details include:
- Supabase user ID as Zep user ID
- Email address
- First and last name (if available)
- Metadata (creation date, last sign-in)

### Session Management

```typescript
// Sessions are created automatically for conversations
const sessionId = await zepManager.createSession(userId);
```

Sessions include:
- Unique session ID
- Associated user ID
- Creation timestamp
- Source identifier ("ai-agent-chat")

### Conversation Storage

```typescript
// Conversations are automatically stored after completion
await ZepMemoryHelper.addConversationToMemory(
  userId,
  sessionId,
  userMessage,
  assistantResponse
);
```

### Memory Context Retrieval

```typescript
// Context is automatically included in prompts
const memoryContext = await ZepMemoryHelper.getContextForPrompt(
  userId,
  sessionId
);
```

## Best Practices

### 1. Data Privacy
- User data is stored securely in Zep Cloud
- Each user has isolated memory spaces
- Sensitive information should be handled carefully

### 2. Performance Optimization
- Memory operations are cached for 10 minutes
- Use appropriate limits when searching
- Background cleanup prevents memory leaks

### 3. Memory Hygiene
- Store meaningful, factual information
- Avoid storing temporary or irrelevant data
- Use appropriate data types (text vs JSON)

### 4. Error Handling
- Memory failures don't break conversations
- Graceful degradation when Zep is unavailable
- Proper logging for debugging

### 5. Context Management
- Include relevant memory context in prompts
- Balance context length with relevance
- Use search to find specific information

## Troubleshooting

### Common Issues

#### "No Zep API key configured"
- Ensure `ZEP_API_KEY` is set in environment variables
- Verify the key is valid and active
- Check Zep dashboard for key status

#### "Failed to create Zep user"
- Check API key permissions
- Verify user data format
- Check network connectivity

#### "Memory context not loading"
- Verify session exists
- Check user ID format
- Review Zep dashboard for session data

#### "Tools not working"
- Ensure proper tool integration
- Check agent configuration
- Verify tool schema compliance

### Debug Mode

Enable verbose logging:

```bash
NODE_ENV=development
AGENT_VERBOSE_LOGGING=true
```

### Health Checks

Monitor memory system health:

```typescript
const stats = zepManager.getCacheStats();
console.log('Memory cache stats:', stats);
```

## API Reference

### ZepManager Methods

#### Core Operations
- `getOrCreateZepData(userId)`: Initialize user data
- `createSession(userId, sessionId?)`: Create memory session
- `addMessage(userId, sessionId, message)`: Add single message
- `addMessages(userId, sessionId, messages)`: Add multiple messages
- `getMemoryContext(userId, sessionId)`: Get session context

#### Search Operations
- `searchMemory(userId, query, limit, scope)`: Search memory graph
- `searchUserFacts(userId, query, limit)`: Search for facts

#### Data Management
- `addUserData(userId, data, type)`: Add data to user graph
- `addGroupData(groupId, data, type)`: Add data to group graph
- `addContextualData(userId, context, source)`: Add contextual information

#### Session Management
- `deleteSession(userId, sessionId)`: Delete session
- `getUserSessions(userId)`: Get user's sessions

#### Cache Management
- `invalidateUserCache(userId)`: Clear user cache
- `clearAllCache()`: Clear all cache
- `getCacheStats()`: Get cache statistics

### ZepMemoryHelper Methods

#### Initialization
- `initializeUserMemory(userId)`: Initialize user memory
- `addConversationToMemory(userId, sessionId, userMsg, assistantMsg)`: Store conversation
- `getContextForPrompt(userId, sessionId)`: Get formatted context

### Memory Tools Schema

All tools follow LangChain tool schema with proper input validation using Zod schemas.

## Future Enhancements

### Planned Features
- Group memory for shared context
- Fact rating and relevance scoring
- Memory analytics and insights
- Advanced search capabilities
- Memory export/import functionality

### Integration Opportunities
- Integration with calendar for temporal context
- Document memory for file-based context
- Email memory for communication history
- Custom entity recognition

## Support

For issues related to:
- **Zep Cloud**: Visit [Zep Documentation](https://help.getzep.com) or [Discord](https://discord.com/invite/W8Kw6bsgXQ)
- **Integration**: Check the troubleshooting section or create an issue
- **Feature Requests**: Submit enhancement requests with detailed use cases

---

*Last updated: January 2025*
*Version: 1.0.0*