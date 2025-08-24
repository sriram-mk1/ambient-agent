# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is an **AI Agent System** built on Next.js that provides an agentic development environment with memory capabilities and third-party integrations. The system uses **LangChain** and **LangGraph** for AI orchestration, integrates with various services via **MCP (Model Context Protocol)**, and provides real-time streaming conversations with parallel tool execution.

## Development Commands

### Core Development
```bash
# Install dependencies
npm install

# Start development server with Turbopack
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint the code
npm run lint
```

### Development Server
- Local URL: http://localhost:3000
- Development uses Turbopack for faster builds
- Hot reloading enabled for all source files

### Testing
This project does not have explicit test scripts configured. To add testing:
- Consider adding `jest` or `vitest` for unit testing
- Add `cypress` or `playwright` for E2E testing
- Test API routes in `src/app/api/`

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 15.3.5 with App Router
- **AI/ML**: LangChain + LangGraph for agent workflows  
- **Database**: Supabase (PostgreSQL) with real-time subscriptions
- **Authentication**: NextAuth.js with Google OAuth
- **MCP Integration**: Model Context Protocol for third-party tool connections
- **Memory**: Zep for conversational memory and knowledge graphs
- **UI**: React 19, Tailwind CSS 4, Radix UI components
- **Type Safety**: TypeScript with strict configuration

### Core Systems

#### 1. Agent System (`src/lib/agent/`)
The heart of the application - orchestrates AI agent workflows:

- **Agent Manager** (`manager.ts`): Caches and manages LangGraph workflows, handles tool loading and memory initialization
- **Parallel Tool Executor** (`parallel-tool-executor.ts`): Meta-tool for executing multiple tools concurrently with safety classification
- **Conversation Handler** (`conversation.ts`): Manages chat conversations with streaming and human-in-the-loop capabilities
- **Enhanced Workflow** (`enhanced-workflow.ts`): Smart planning and reflection capabilities for complex tasks
- **Streaming System**: Real-time SSE streaming for tool calls and responses

Key Features:
- **Parallel Execution**: Safely runs multiple tools concurrently (read-only operations) while sequencing sensitive operations
- **Human-in-the-Loop**: Approval workflows for sensitive operations
- **Memory Integration**: Connects to Zep for persistent memory across conversations
- **Tool Safety**: Classifies tools as safe/sensitive for parallel execution

#### 2. MCP Integration (`src/lib/mcp-manager.ts`)
Model Context Protocol integration for third-party services:
- Google Workspace App connection for AI Agent
- User-specific tool caching and management
- Token refresh handling for authenticated services

#### 3. Database Layer (`src/lib/supabase/`)
- **Server Client** (`server.ts`): Server-side Supabase client for API routes
- **Client** (`client.ts`): Client-side Supabase client for UI components
- Authentication state management
- Real-time subscriptions for live updates

#### 4. Memory System
- **Zep Integration**: Conversational memory and knowledge graphs
- **Memory Manager UI**: Visual interface for managing memory entries
- **Knowledge Graph**: Relationship mapping between entities
- Memory types: facts, entities, documents, conversations

#### 5. API Routes (`src/app/api/`)
RESTful endpoints and streaming endpoints:
- `/api/chat` - Main conversation endpoint (POST for new, GET for resume)
- `/api/agent-config` - Agent configuration management  
- `/api/auth/*` - Authentication flows (NextAuth + Google OAuth)
- `/api/integrations/*` - Third-party app connections
- `/api/memory-*` - Memory management endpoints
- `/api/mcp/*` - MCP server management

### Data Flow

1. **User Input** → UI Components → API Route (`/api/chat`)
2. **Authentication** → Supabase Auth → Token Refresh → MCP Tools Loading
3. **Agent Creation** → Agent Manager → Tool Loading → Memory Setup
4. **Conversation** → LangGraph Workflow → Parallel Tool Execution → Streaming Response
5. **Memory** → Zep Integration → Knowledge Graph Updates

## Configuration Files

### Next.js Configuration (`next.config.ts`)
- **Webpack Customization**: Handles Node.js modules and MCP adapters
- **Externals**: Server-side module optimization
- **Fallbacks**: Browser compatibility for Node.js modules
- **Transpilation**: MCP and LangChain packages

### TypeScript (`tsconfig.json`)
- Strict mode enabled
- Path aliases: `@/*` → `./src/*`
- Next.js plugin integration
- ES2017 target for broad compatibility

### ESLint (`eslint.config.mjs`)
- Next.js Core Web Vitals rules
- TypeScript integration
- Relaxed rules for development flexibility
- Custom ignores for build artifacts

## Environment Variables

Required environment variables:
```bash
# Core AI
GOOGLE_API_KEY=          # Required for Gemini models
OPENAI_API_KEY=          # Optional for OpenAI models

# Database
SUPABASE_URL=           # Supabase project URL
SUPABASE_ANON_KEY=      # Supabase anonymous key
SUPABASE_SERVICE_ROLE_KEY=  # Supabase service role key

# Authentication
NEXTAUTH_SECRET=        # NextAuth secret key
NEXTAUTH_URL=           # Base URL for auth callbacks
GOOGLE_CLIENT_ID=       # Google OAuth client ID  
GOOGLE_CLIENT_SECRET=   # Google OAuth client secret

# Memory & Search
ZEP_API_URL=           # Zep memory service URL
ZEP_API_KEY=           # Zep API key
EXA_API_KEY=           # Optional: Exa search API

# Features
ENABLE_ENHANCED_AGENT=true   # Enable planning/reflection
```

## Development Practices

### File Organization
```
src/
├── app/                  # Next.js App Router
│   ├── api/             # API routes
│   ├── dashboard/       # Main dashboard page
│   ├── login/           # Authentication pages
│   └── globals.css      # Global styles
├── components/          # React components
│   ├── ui/             # Reusable UI components (Radix)
│   ├── memory/         # Memory management components
│   └── providers.tsx   # Context providers
├── lib/                # Core business logic
│   ├── agent/          # Agent system (LangGraph workflows)
│   ├── supabase/       # Database clients
│   ├── tools/          # Individual tool implementations
│   └── utils/          # Utility functions
└── hooks/              # Custom React hooks
```

### Code Style
- **TypeScript**: Strict mode with comprehensive type safety
- **Components**: Functional components with hooks
- **State Management**: React hooks + Supabase real-time subscriptions
- **Error Handling**: Comprehensive try-catch with logging
- **Async Operations**: Proper Promise handling with error boundaries

### Agent Configuration
The system supports three execution profiles:
- **DEFAULT_AGENT_CONFIG**: Balanced performance (50 iterations, 100 tools, parallel enabled)
- **CONSERVATIVE_AGENT_CONFIG**: Resource-limited (10 iterations, 20 tools, sequential only)  
- **EXTENDED_AGENT_CONFIG**: High-complexity tasks (100 iterations, 200 tools, high concurrency)

## Key Integrations

### MCP (Model Context Protocol)
- **Google Workspace** apps for connection, so AI Agent can automate them
- **Tool Discovery**: Automatic tool loading from connected services
- **Token Management**: Automatic refresh of authentication tokens

### Memory & Knowledge
- **Zep Memory**: Persistent conversational memory
- **Knowledge Graphs**: Entity and relationship mapping
- **Memory Types**: Support for facts, entities, documents, conversations
- **Graph Visualization**: React-based memory graph interface

### Authentication Flow
1. NextAuth.js handles OAuth with Google
2. Supabase manages user sessions and data
3. Token refresh system maintains third-party connections
4. MCP manager loads user-specific tools based on connections

## Security Considerations

### Tool Safety Classification
The parallel executor classifies tools as:
- **Safe for Parallel**: Read-only operations (search, get, fetch, list, query)
- **Sensitive**: Write operations requiring sequential execution (send, create, update, delete, modify)

### Authentication
- OAuth2 flow with Google
- Supabase Row Level Security (RLS) policies
- API route protection with session validation
- Token encryption and secure storage

### Data Protection
- User data isolation in Supabase
- Memory data segmentation per user
- Secure token refresh mechanisms
- Environment variable protection

## Common Development Patterns

### Adding New Tools
1. Create tool implementation in `src/lib/tools/`
2. Export from appropriate module
3. Add to agent manager tool loading
4. Classify safety level for parallel execution

### Adding API Routes
1. Create in `src/app/api/[name]/route.ts`
2. Implement GET/POST methods as needed
3. Add authentication checks
4. Include proper error handling and logging

### Memory Integration
```typescript
// Store contextual data
await add_contextual_data({
  fact: "User prefers morning meetings",
  source: "calendar_analysis",
  entity_id: userId
});

// Search memory
const facts = await search_user_facts({
  query: "meeting preferences"
});
```

### Streaming Responses
The system uses Server-Sent Events (SSE) for real-time streaming:
- Tool call notifications
- Streaming content delivery  
- Human-in-the-loop approval prompts
- Progress updates during parallel execution

## Deployment Notes

### Build Process
- Next.js static optimization where possible
- Server-side rendering for dynamic content
- Webpack bundling with MCP adapter handling
- TypeScript compilation with strict checks

### Production Considerations
- Environment variables must be configured
- Supabase database migrations
- MCP server availability (GitHub, Context7)
- Memory service (Zep) connectivity
- OAuth callback URL configuration

This architecture enables a sophisticated AI agent system that can safely execute multiple operations in parallel while maintaining security and providing real-time feedback to users through a modern web interface.
