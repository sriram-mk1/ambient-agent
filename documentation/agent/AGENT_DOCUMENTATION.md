# Enhanced Multi-Step AI Agent Documentation

## Overview

This AI agent has been enhanced to support **multi-step execution** with **streaming responses**, **multiple tool calls**, and **intelligent human interaction**. Unlike traditional single-shot agents, this implementation allows for complex reasoning chains where the agent can call multiple tools, seek clarification when needed, analyze results, and continue working until the task is complete with full user oversight.

## Key Features

### 🔄 Multi-Step Execution
- **Iterative Reasoning**: Agent can think, act, observe, and repeat until task completion
- **Tool Chaining**: Multiple tool calls in sequence to accomplish complex tasks
- **Natural Termination**: Agent decides when the task is complete
- **Safety Limits**: Configurable maximum iterations and tool calls to prevent infinite loops

### 🧑‍💻 Intelligent Human Interaction (NEW)
- **Proactive Clarification**: Agent asks for clarification when user intent is unclear
- **Context-Aware Prompting**: Provides relevant context and examples when requesting input
- **Multiple Input Types**: Support for text, choices, structured data, and validation
- **Seamless Integration**: Human input flows naturally within automated workflows
- **Smart Decision Making**: Agent knows when to ask vs. when to proceed autonomously

### 🚀 Parallel Tool Execution (NEW)
- **Concurrent Operations**: Execute multiple independent tools simultaneously
- **Smart Safety Rules**: Automatic separation of safe vs. sensitive operations
- **Token Efficiency**: Optimized parallel execution to manage costs
- **Intelligent Grouping**: Agent combines related operations for maximum efficiency

### 📡 Real-Time Streaming
- **Live Updates**: See the agent's thinking process in real-time
- **Tool Call Visibility**: Watch which tools are being called and their results
- **Progressive Responses**: Get partial results as the agent works
- **Interactive Interrupts**: Real-time clarification requests and approval flows

### 🛠️ Tool Integration
- **Gmail**: Email management and searching
- **Calendar**: Schedule management and event creation
- **Google Docs**: Document creation and editing
- **Google Sheets**: Spreadsheet operations and data analysis
- **Human Input**: Interactive clarification and approval tool

### ⚙️ Configurable Behavior
- **Multiple Presets**: Default, Conservative, and Extended configurations
- **Custom Settings**: Fine-tune iteration limits, tool call limits, and streaming options
- **Per-User Configuration**: Each user can have personalized agent settings
- **Human Interaction Controls**: Configure when and how agent seeks clarification

## Architecture

### Core Components

1. **Chat Route** (`/api/chat`): Main endpoint for agent interactions and human input handling
2. **MCP Manager**: Handles tool discovery and caching
3. **Agent Utils**: Execution management and message processing
4. **Agent Config** (`/api/agent-config`): Configuration management
5. **Enhanced System Prompt** (`/lib/agent/parallel-system-prompt.ts`): Comprehensive guidance for human interaction and parallel execution
6. **Human Input Tool** (`/lib/tools/human-input.ts`): Interactive clarification capabilities
7. **Parallel Tool Executor**: Concurrent execution engine with safety controls

### Execution Flow

```
User Message → Clarity Check → Agent Processing → Tool Strategy → Execution → Analysis → Response/Continue
     ↑             ↓               ↑                    ↓             ↓           ↓           ↓
     └─ human_input ─┘             └─── Parallel/Sequential ─────────┘           └─ Approval ─┘
                                                ↑
                                    ├─ Safe Tools (Parallel)
                                    └─ Sensitive Tools (Sequential + Approval)
```

**Key Decision Points:**
1. **Clarity Check**: Is user intent 100% clear? If not, use `human_input`
2. **Tool Strategy**: Can tools run in parallel safely? Group accordingly
3. **Execution**: Run safe tools concurrently, sensitive tools with approval
4. **Analysis**: Continue iterating or complete based on results

## Configuration Options

### Available Presets

#### Default Configuration
```json
{
  "maxIterations": 10,
  "maxToolCalls": 15,
  "streamToolCalls": true,
  "streamToolResults": true,
  "verboseLogging": true
}
```

#### Conservative Configuration
```json
{
  "maxIterations": 5,
  "maxToolCalls": 8,
  "streamToolCalls": true,
  "streamToolResults": false,
  "verboseLogging": false
}
```

#### Extended Configuration
```json
{
  "maxIterations": 20,
  "maxToolCalls": 30,
  "streamToolCalls": true,
  "streamToolResults": true,
  "verboseLogging": true
}
```

### Configuration Parameters

| Parameter | Type | Description | Range |
|-----------|------|-------------|-------|
| `maxIterations` | number | Maximum reasoning iterations | 1-50 |
| `maxToolCalls` | number | Maximum tool calls per session | 1-100 |
| `streamToolCalls` | boolean | Show tool calls in real-time | true/false |
| `streamToolResults` | boolean | Show tool results in stream | true/false |
| `verboseLogging` | boolean | Enable detailed console logging | true/false |

## API Endpoints

### Chat Endpoint
**POST** `/api/chat`

Send messages to the agent and receive streaming responses.

**Request Body:**
```json
{
  "message": "Create a meeting for tomorrow at 2 PM and send an email to john@example.com about it",
  "history": [
    {
      "role": "user",
      "content": "Previous message"
    },
    {
      "role": "assistant", 
      "content": "Previous response"
    }
  ],
  "user_id": "optional-user-id"
}
```

**Response:** Streaming text with real-time updates

### Configuration Endpoint
**GET/POST/PUT/DELETE** `/api/agent-config`

Manage agent configuration settings.

**GET** - Retrieve current configuration:
```json
{
  "success": true,
  "config": {
    "maxIterations": 10,
    "maxToolCalls": 15,
    "streamToolCalls": true,
    "streamToolResults": true,
    "verboseLogging": true
  },
  "presets": {
    "default": {...},
    "conservative": {...},
    "extended": {...}
  }
}
```

**POST** - Update configuration:
```json
{
  "preset": "extended"
}
```
or
```json
{
  "config": {
    "maxIterations": 15,
    "maxToolCalls": 20
  }
}
```

## Usage Examples

### Basic Interaction
```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Check my calendar for today and send a summary email to my team"
  })
});

// Handle streaming response
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const text = new TextDecoder().decode(value);
  console.log(text); // Real-time agent updates
}
```

### Configuration Management
```javascript
// Set to extended configuration
await fetch('/api/agent-config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ preset: 'extended' })
});

// Custom configuration
await fetch('/api/agent-config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    config: {
      maxIterations: 25,
      maxToolCalls: 35,
      streamToolResults: false
    }
  })
});
```

## Enhanced Execution Examples

### Example 1: Intelligent Email Management with Clarification
**User:** "Find all unread emails from last week, summarize them, and create a calendar event to review them tomorrow"

**Enhanced Agent Execution Flow:**
1. 🤔 *Analyzing request for clarity...*
2. 🧑‍💻 **human_input**: "What time would you prefer for the review meeting tomorrow?"
   - **Context**: "I found 15 unread emails from last week that need review"
   - **Choices**: ["9:00 AM", "2:00 PM", "4:00 PM", "Let me specify"]
3. 👤 **User Response**: "2:00 PM"
4. 🚀 **Parallel Execution**: *Executing gmail_search + gmail_get_messages + calendar_check_availability simultaneously...*
5. ✅ *All parallel operations completed* → Retrieved 15 emails and confirmed 2 PM availability
6. 💭 *Analyzing emails and creating summary...*
7. 🛠️ *Calling calendar_create_event...* → **[Requires Approval]**
8. ⚠️ **Approval Request**: "Create 1-hour meeting 'Email Review' tomorrow at 2:00 PM?"
9. ✅ **User Approved** → Meeting scheduled
10. **Final Response:** "I found 15 unread emails from last week covering project updates, meeting requests, and client feedback. I've created a summary and scheduled your review meeting for tomorrow at 2:00 PM as requested."

### Example 2: Proactive Document Creation with User Guidance
**User:** "Create a project status document"

**Enhanced Agent Execution Flow:**
1. 🤔 *Request is ambiguous - need clarification...*
2. 🧑‍💻 **human_input**: "What should I include in the project status document?"
   - **Context**: "I can gather data from various sources to create a comprehensive status report"
   - **Choices**: ["Recent calendar events", "Email summaries", "Document changes", "All of the above", "Let me specify"]
3. 👤 **User Response**: "All of the above"
4. 🧑‍💻 **human_input**: "Who should I share this with?"
   - **Context**: "I'll create the document and can share it via email"
   - **Expected**: "email"
5. 👤 **User Response**: "team@company.com"
6. 🚀 **Parallel Research**: *Executing calendar_list_events + gmail_search + docs_list_recent simultaneously...*
7. ✅ *Research completed* → Gathered comprehensive project data
8. 🛠️ *Calling docs_create_document...* → Document created: "Project Status Report"
9. 🛠️ *Calling docs_add_content...* → Comprehensive content added
10. 🛠️ *Calling gmail_send_message...* → **[Requires Approval]**
11. ⚠️ **Approval Request**: "Send project status document to team@company.com?"
12. ✅ **User Approved** → Email sent
13. **Final Response:** "I've created a comprehensive project status document including recent calendar events, email summaries, and document changes. The report has been shared with your team at team@company.com."

### Example 3: Smart File Management with Progressive Clarification
**User:** "Clean up my project files"

**Enhanced Agent Execution Flow:**
1. 🤔 *"Clean up" is ambiguous - need specific guidance...*
2. 🧑‍💻 **human_input**: "What type of cleanup do you need?"
   - **Context**: "I can help with various cleanup tasks for better organization"
   - **Choices**: ["Delete old files", "Organize into folders", "Remove duplicates", "Archive unused files"]
3. 👤 **User Response**: "Delete old files"
4. 🚀 **Parallel Analysis**: *Executing find_old_files + analyze_file_usage + check_git_status simultaneously...*
5. ✅ *Analysis completed* → Found 200 files older than 6 months
6. 🧑‍💻 **human_input**: "Found 200 files older than 6 months (2.5GB). Delete all or just specific types?"
   - **Context**: "Includes: 150 log files, 30 temp files, 20 backup files"
   - **Choices**: ["Delete all old files", "Only log and temp files", "Let me review the list first"]
7. 👤 **User Response**: "Only log and temp files"
8. 🛠️ *Sequential deletion with approval* → **[Each batch requires approval]**
9. ✅ **Cleanup completed** → Removed 180 files, saved 2.2GB
10. **Final Response:** "Successfully cleaned up your project files! Deleted 150 log files and 30 temp files, freeing up 2.2GB of space. Kept backup files and recent files as requested."

## Stream Response Format

The agent streams different types of content:

- **🤖 AI Responses**: Direct agent text responses
- **🧑‍💻 Human Input Requests**: Interactive clarification prompts
- **🚀 Parallel Execution**: `*Executing multiple tools simultaneously...*`
- **🛠️ Tool Calls**: `*Calling tool_name...*`
- **✅ Tool Results**: `*tool_name completed*`
- **💭 Thinking**: `*Agent reasoning process*`
- **⚠️ Approval Requests**: `*[Requires user approval]*`
- **🤔 Clarity Checks**: `*Analyzing request for clarity...*`
- **❌ Errors**: `*Error: description*`
- **⚠️ Warnings**: `*[Warning message]*`

## Error Handling

### Common Error Scenarios

1. **Maximum Iterations Reached**
   - Message: `*[Agent reached maximum iteration limit]*`
   - Solution: Increase `maxIterations` or break down the request

2. **Maximum Tool Calls Reached**
   - Message: `*[Maximum tool calls reached]*`
   - Solution: Increase `maxToolCalls` or simplify the request

3. **Tool Execution Failure**
   - Message: `*Error: Tool execution failed*`
   - Solution: Check tool availability and authentication

4. **Authentication Issues**
   - Check user session and MCP server tokens
   - Verify integration setup in database

## Monitoring and Debugging

### Console Logs
When `verboseLogging` is enabled, you'll see detailed logs:

```
🚀 Starting agent execution with config: {...}
📍 Agent iteration 1
🛠️ Tool calls: 1/15
🔧 Tool result from gmail_search: Found 15 messages...
🏁 Agent appears to have completed its task
⚡ Multi-step agent processing completed:
  - Total iterations: 3
  - Total tool calls: 5
  - Processing time: 2847ms
  - Termination reason: natural
```

### Performance Metrics
- **Iteration Count**: How many reasoning cycles the agent used
- **Tool Call Count**: Total number of tools called
- **Processing Time**: Time spent on agent execution
- **Termination Reason**: How the agent session ended

## Best Practices

### For Optimal Performance

1. **Clear Instructions**: Provide specific, actionable requests
2. **Context**: Include relevant context in conversation history
3. **Reasonable Limits**: Use appropriate configuration for task complexity
4. **Error Handling**: Implement proper error handling in your frontend

### Configuration Recommendations

- **Simple Tasks**: Use Conservative preset
- **Complex Workflows**: Use Extended preset
- **Development/Testing**: Enable verbose logging
- **Production**: Consider disabling tool result streaming for cleaner UX

## Troubleshooting

### Agent Stops Too Early
- Increase `maxIterations`
- Check if error occurred in console logs
- Verify tool authentication

### Agent Takes Too Long
- Decrease `maxIterations` and `maxToolCalls`
- Use Conservative preset
- Check for infinite reasoning loops in logs

### Tools Not Working
- Verify MCP server health in console
- Check user integration tokens
- Review MCP server configurations

### Performance Issues
- Enable caching (already implemented)
- Monitor token refresh background process
- Check database connection health

## Security Considerations

- **Rate Limiting**: Implement rate limiting on chat endpoint
- **Input Validation**: Sanitize user inputs
- **Token Management**: Secure storage and refresh of OAuth tokens
- **User Isolation**: Each user's configuration is isolated
- **Error Sanitization**: Don't expose sensitive information in error messages

## Future Enhancements

- **Persistent Configuration**: Store config in database instead of memory
- **Usage Analytics**: Track agent performance and usage patterns
- **Custom Tool Integration**: Support for additional MCP servers
- **Conversation Memory**: Long-term conversation context
- **Agent Templates**: Pre-configured agents for specific use cases
- **Advanced Human Input**: Voice input, image analysis, and multi-modal clarification
- **Intelligent Batching**: Smart grouping of related operations for efficiency
- **Learning from Interactions**: Agent learns user preferences for better clarification
- **Role-Based Permissions**: Different users with different approval and access levels
- **Workflow Templates**: Pre-built clarification and execution patterns for common tasks

## Prompt Enhancement Summary

### Major Updates to System Prompt (v2.0)

The system prompt has been significantly enhanced to better utilize the human input tool:

#### 🎯 New Human Input Guidance
- **Proactive Clarification**: Clear guidelines on when to seek user input
- **Context-Aware Prompting**: Best practices for providing helpful context
- **Decision Trees**: Structured approach to clarity vs. execution decisions
- **Integration Patterns**: How to combine human input with parallel execution

#### 🚀 Enhanced Parallel Execution
- **Safety Rules**: Comprehensive lists of safe vs. sensitive tools
- **Token Management**: Guidelines to prevent excessive parallel execution
- **Smart Grouping**: Strategies for efficient tool combinations
- **Error Handling**: Graceful degradation and recovery patterns

#### 🏆 Quality Standards
- **Excellence Markers**: Clear criteria for high-quality agent behavior
- **Best Practices**: Comprehensive guidelines for user interaction
- **Real-World Examples**: Practical scenarios and execution patterns
- **Quality Checklist**: Step-by-step validation for agent decisions

#### 🔄 Workflow Integration
- **Combined Patterns**: How to seamlessly blend clarification and execution
- **Progressive Disclosure**: Breaking complex decisions into manageable steps
- **Context Preservation**: Maintaining conversation context across interactions
- **Smooth Handoffs**: Natural transitions between human input and automation

This enhanced prompt ensures the agent:
1. **Always seeks clarification** when user intent is unclear
2. **Provides helpful context** in all human input requests
3. **Efficiently executes** safe operations in parallel
4. **Maintains safety** through approval flows for sensitive operations
5. **Delivers excellent user experience** through proactive communication

The result is an agent that is both more intelligent in its decision-making and more interactive in its user engagement, leading to better outcomes and higher user satisfaction.