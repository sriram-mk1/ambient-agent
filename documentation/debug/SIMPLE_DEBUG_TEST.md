# Simple Debug Test - Post-Tool Content Not Showing

## Quick Test (5 minutes)

### Step 1: Test Message
Send this exact message:
```
Create a calendar event for tomorrow at 2 PM called "Debug Test"
```

### Step 2: Approve Tool
Click the green checkmark (✓) when it appears

### Step 3: Check These Logs

#### A. Backend Console - Look for this sequence:
```
✅ [HITL] Tool [tool_name] was approved by user
🤖 [AGENT] ===== AGENT NODE CALLED =====
📦 [AGENT] Chunk #1: {...}
📝 [AGENT] Streaming token: "..."
✅ [AGENT] ===== AGENT NODE COMPLETE =====
```

**If MISSING "AGENT NODE CALLED"**: The workflow isn't resuming to the agent after tool execution
**If MISSING "Streaming token"**: The agent isn't generating follow-up content
**If MISSING chunks**: The model isn't responding

#### B. Browser Console - Look for:
```
📡 [RESUME] SSE Event Received: {eventType: "content", ...}
📝 [RESUME] Updated aiContent: {...}
```

**If MISSING**: Content events aren't reaching the frontend

### Step 4: Quick Fix Test

If you see "AGENT NODE CALLED" but no content, try this temporary fix:

**File**: `ambient-agent/src/lib/agent/workflow.ts`

**Find this line** (around line 93):
```typescript
const stream = await modelWithTools.stream(state.messages);
```

**Replace with**:
```typescript
// Add a system message to encourage follow-up
const messagesWithPrompt = [
  ...state.messages,
  new AIMessage({
    content: "I need to provide a summary of what I just accomplished.",
    role: "assistant"
  })
];

const stream = await modelWithTools.stream(messagesWithPrompt);
```

This forces the agent to generate follow-up content.

## Results Analysis

### Scenario A: No Agent Node Called
**Problem**: Workflow ending after tool execution
**Solution**: Check LangGraph workflow edges in `workflow.ts`

### Scenario B: Agent Called, No Content
**Problem**: Model thinks conversation is complete
**Solution**: Add prompt encouraging follow-up (see Step 4)

### Scenario C: Content Generated, Not Received
**Problem**: Streaming/frontend issue
**Solution**: Check SSE events in Network tab

## Emergency Bypass

To test if the issue is in resume flow vs. regular flow:

**File**: `ambient-agent/src/lib/agent/manager.ts`

**Temporarily disable human approval**:
```typescript
// Comment out this line:
// return addSensitiveToolApproval(tools);

// Add this instead:
return tools; // No approval needed
```

If agent responses appear without approval, the issue is in the resume flow.
If they still don't appear, the issue is in general content streaming.

## Expected Output

After tool approval, you should see:
```
✅ create_calendar_event completed
I've successfully created your calendar event "Debug Test" for tomorrow at 2 PM.
```

If you only see the first line, that confirms the post-tool content issue.