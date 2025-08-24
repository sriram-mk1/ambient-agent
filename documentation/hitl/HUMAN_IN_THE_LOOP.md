# Human-in-the-Loop Implementation

This document explains how the human-in-the-loop functionality is implemented in the Ambient Agent system, following LangGraph patterns.

## Overview

The human-in-the-loop system provides two complementary capabilities:

1. **Human Input Tool**: Proactive clarification and information gathering from users
2. **Tool Approval System**: Reactive approval for sensitive operations before execution

This dual approach ensures both clarity and safety in automated workflows, allowing the agent to seek clarification when needed and obtain approval for sensitive actions.

## Architecture

### Components

1. **Human Input Tool** (`src/lib/tools/human-input.ts`)
   - Proactive clarification requests from the agent
   - Structured input collection with validation
   - Context-aware prompting with choices and defaults

2. **Human-in-the-Loop Wrapper** (`src/lib/human-in-the-loop.ts`)
   - Wraps tools with approval logic for sensitive operations
   - Uses LangGraph's `interrupt()` function to pause execution
   - Handles different approval response types

3. **Agent Workflow** (`src/lib/agent/workflow.ts`)
   - Integrates with checkpointer for state persistence
   - Supports resuming from interrupts
   - Maintains conversation context during approval flows

4. **Enhanced System Prompt** (`src/lib/agent/parallel-system-prompt.ts`)
   - Comprehensive guidance on when to use human_input
   - Integration patterns for combining clarification with execution
   - Best practices for user interaction

5. **Chat API Route** (`src/app/api/chat/route.ts`)
   - Handles streaming responses with interrupts
   - Manages both clarification requests and approval flows
   - Resumes execution after human input

## How It Works

### 1. Human Input Tool (Proactive Clarification)

The agent uses the `human_input` tool to proactively seek clarification:

```typescript
// Agent calls human_input when unclear about user intent
const response = await human_input({
  prompt: "Which dependencies should I update?",
  context: "Found both security vulnerabilities and outdated packages",
  expected: "choice",
  choices: ["Security only", "All outdated", "Let me choose manually"]
});
```

**When Agent Uses human_input:**
- User intent is ambiguous or unclear
- Multiple valid approaches exist
- Missing critical information needed to proceed
- Subjective decisions required
- Confirmation needed for potentially destructive actions

### 2. Tool Approval System (Reactive Safety)

Sensitive tools are automatically wrapped with human approval logic:

```typescript
import { addSensitiveToolApproval } from "@/lib/human-in-the-loop";

// Automatically adds approval to sensitive operations
const approvedTools = addSensitiveToolApproval(originalTools);
```

**Sensitive Operations Requiring Approval:**
- `send_email` / `gmail_send_message`
- `delete_file` / `gmail_delete_message`
- `create_calendar_event` / `calendar_create_event`
- `share_document` / `docs_create_document`
- `move_file` / `sheets_update_values`
- `update_spreadsheet`

### 3. Combined Workflow Patterns

**Pattern 1: Clarify → Execute**
1. **User Request**: "Clean up my files"
2. **Agent Clarification**: `human_input("What type of cleanup?")` 
3. **User Response**: "Delete log files older than 30 days"
4. **Agent Execution**: Find files → Request approval → Delete

**Pattern 2: Research → Confirm → Act**
1. **Agent Research**: Parallel search for information
2. **Agent Summary**: Present findings with `human_input`
3. **User Decision**: Choose preferred approach
4. **Agent Execution**: Execute chosen approach with approvals

### 4. Response Types

**For human_input tool:**
- **Text**: Open-ended responses
- **Choice**: Selection from provided options
- **Structured**: JSON, email, URL formats

**For approval system:**
- **Accept**: Execute the tool with original arguments
- **Edit**: Execute the tool with modified arguments
- **Reject**: Cancel the tool execution

## Implementation Details

### LangGraph Integration

The system follows LangGraph's official human-in-the-loop patterns:

```typescript
// In tool wrapper
const response = interrupt({
  action_request: {
    action: tool.name,
    args: input,
  },
  config: {
    allow_accept: true,
    allow_edit: true,
    allow_reject: true,
  },
  description: `Review and approve execution of ${tool.name}`,
  tool_name: tool.name,
  tool_args: input,
  message: `Do you want to execute ${tool.name}?`,
});
```

### State Persistence

The workflow uses `MemorySaver` for state persistence:

```typescript
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .compile({ checkpointer: new MemorySaver() });
```

### Resuming Execution

After human input, execution resumes with a `Command`:

```typescript
// Resume with user's decision
await workflow.stream(
  new Command({ resume: { type: "accept" } }),
  config
);
```

## Client-Side Integration

### Event Handling

The client receives approval requests via Server-Sent Events:

```javascript
// Listen for approval requests
if (event.type === "human_input_required") {
  showApprovalDialog(event.data);
}
```

### Approval Dialog

The UI should display:
- Tool name and description
- Tool arguments
- Action buttons (Accept, Edit, Reject)

### Sending Responses

Responses are sent back to the API:

```javascript
// Send approval response
fetch("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    threadId: currentThreadId,
    resumeData: {
      type: "approve", // or "edit" or "reject"
      args: modifiedArgs, // if edited
    },
  }),
});
```

## Configuration

### Custom Approval Rules

You can customize which tools require approval:

```typescript
import { addSelectiveHumanApproval } from "@/lib/human-in-the-loop";

const customApprovedTools = addSelectiveHumanApproval(
  tools,
  ["my_sensitive_tool"],
  {
    allowAccept: true,
    allowEdit: false, // Don't allow editing
    allowReject: true,
    customMessage: "This will modify important data. Approve?",
  }
);
```

### Disabling Approval

For testing or non-sensitive environments:

```typescript
// Disable human approval
const workflow = createAgentWorkflow(tools, false);
```

## Security Considerations

1. **Default Deny**: Sensitive operations are blocked by default
2. **Audit Trail**: All approval decisions should be logged
3. **Timeout**: Consider implementing timeouts for pending approvals
4. **Authentication**: Ensure only authorized users can approve actions

## Best Practices

### For Human Input Tool Usage

1. **Proactive Clarification**: Use human_input early when any ambiguity exists
2. **Clear Questions**: Ask specific, actionable questions
3. **Provide Context**: Explain why clarification is needed
4. **Offer Guidance**: Suggest recommended options when applicable
5. **Progressive Disclosure**: Break complex decisions into steps

### For Tool Approval System

1. **Clear Descriptions**: Provide clear, user-friendly descriptions for approval requests
2. **Context**: Include relevant context about what the tool will do
3. **Reversibility**: When possible, prefer operations that can be undone
4. **Batch Operations**: Consider grouping related operations for efficiency
5. **User Education**: Help users understand the implications of their approvals

### Integration Best Practices

1. **Clarity Before Action**: Always clarify before executing sensitive operations
2. **Acknowledge Responses**: Confirm understanding of user input
3. **Reference Previous Clarifications**: Remember and reference earlier decisions
4. **Explain Implications**: Help users understand consequences of choices
5. **Smooth Handoffs**: Seamlessly transition from clarification to execution

## Error Handling

The system gracefully handles:
- Rejected operations (returns error message)
- Invalid responses (falls back to rejection)
- Network issues (preserves state via checkpointer)
- Timeouts (can be implemented via custom logic)

## Future Enhancements

Potential improvements:
- Role-based approval (different users, different permissions)
- Bulk approval for similar operations
- Approval templates for common scenarios
- Integration with external approval systems
- Advanced audit logging and reporting

## Example Usage

### Complete Workflow Example

```typescript
// 1. Create workflow with both human_input and approval capabilities
const { workflow, tools } = await agentManager.getOrCreateAgent(userId);

// 2. Start conversation - agent may use human_input proactively
const result = await workflow.stream({ messages }, config);

// 3. Handle different types of interrupts
for await (const chunk of result) {
  if (chunk.__interrupt__) {
    const interruptType = chunk.__interrupt__.type;
    
    if (interruptType === "human_input") {
      // Agent is asking for clarification
      await sendClarificationRequest(chunk.__interrupt__);
    } else if (interruptType === "tool_approval") {
      // Agent needs approval for sensitive operation
      await sendApprovalRequest(chunk.__interrupt__);
    }
    break;
  }
}

// 4. Resume after user response
const resumeResult = await workflow.stream(
  new Command({ resume: userResponse }),
  config
);
```

### Real-World Scenario

**User:** "Help me organize my project files"

**Agent Flow:**
1. **Clarification**: `human_input("What type of organization do you need?")`
2. **User Response**: "Move old files to archive folder"
3. **Research**: Agent searches for files and analyzes structure
4. **Confirmation**: `human_input("Found 200 files older than 6 months. Create archive folder and move them?")`
5. **User Response**: "Yes, but keep anything modified this year"
6. **Execution**: Agent creates folder → Moves files (with approval for each batch)
7. **Completion**: Confirms results and offers additional help

This implementation provides a robust, secure way to incorporate both proactive clarification and reactive oversight into automated workflows while maintaining natural conversational flow.