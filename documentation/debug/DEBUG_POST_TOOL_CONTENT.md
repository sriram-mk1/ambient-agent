# Debug Guide: Post-Tool Content Not Showing

This guide helps diagnose why agent messages after tool execution aren't appearing in the UI.

## Problem Description
After a tool is approved and executed successfully, the agent's follow-up message (like "I've successfully created the calendar event...") is not showing up in the chat interface.

## Debugging Steps

### Step 1: Backend Stream Generation
Check if the backend is generating content events after tool execution.

**Location**: Server console logs
**What to look for**:
```
🤖 [STREAM] Handling agent response
📝 [STREAM] Streaming agent content: {...}
📤 [SSE] streamContent called: {...}
📤 [SSE] Sending content event: {...}
```

**If missing**: The backend isn't generating post-tool agent responses
**If present**: Move to Step 2

### Step 2: SSE Event Transmission
Check if content events are being sent over SSE.

**Location**: Browser Network tab → Find the `/api/chat` request → Response tab
**What to look for**:
```
event: tool_result
data: {"result":"..."}

event: content
data: {"content":"I've successfully...","segment":0}

event: done
data: {"message":"Stream completed"}
```

**If missing content events**: Backend isn't sending them (check streaming processor)
**If present**: Move to Step 3

### Step 3: Frontend Event Reception
Check if the frontend is receiving content events.

**Location**: Browser console
**What to look for**:
```
📝 [RESUME] Received content event: {...}
📝 [RESUME] Updated aiContent: {...}
📝 [RESUME] Updating target message with content: {...}
```

**If missing**: Frontend isn't parsing events correctly
**If present**: Move to Step 4

### Step 4: Message State Updates
Check if messages are being updated in React state.

**Location**: Browser console
**What to look for**:
```
📝 [RESUME] Message update result: {targetFound: true, ...}
```

**Add this debug code to useAIChat.ts after setMessages**:
```typescript
// Debug: log message state after update
console.log("🔍 [DEBUG] Current messages state:", 
  messages.map(m => ({
    id: m.id,
    role: m.role,
    contentLength: typeof m.content === 'string' ? m.content.length : 0,
    contentPreview: typeof m.content === 'string' ? m.content.substring(0, 100) : 'not string'
  }))
);
```

### Step 5: UI Rendering
Check if the updated content is reaching the UI components.

**Location**: Chat component
**Add this debug code to ChatPage component**:
```typescript
// Add this inside the ChatPage component
useEffect(() => {
  console.log("🎨 [UI] Messages changed:", 
    aiMessages.map(m => ({
      id: m.id,
      role: m.role,
      contentLength: typeof m.content === 'string' ? m.content.length : 0,
      hasStructuredContent: !!(m.structuredContent && m.structuredContent.length > 0)
    }))
  );
}, [aiMessages]);
```

## Common Issues & Solutions

### Issue 1: Backend Not Generating Post-Tool Content
**Symptoms**: No "🤖 [STREAM] Handling agent response" logs after tool completion
**Cause**: Agent workflow not continuing after tool execution
**Solution**: Check if `resumeWorkflow` is properly configured and workflow isn't ending prematurely

### Issue 2: Content Events Not Being Sent
**Symptoms**: "📤 [SSE] streamContent called" but no actual events in Network tab
**Cause**: SSE controller might be closed or content is being filtered out
**Solution**: Check `this.sseController.isClosed` and content sanitization

### Issue 3: Frontend Not Processing Content Events
**Symptoms**: Events visible in Network tab but no "📝 [RESUME] Received content event" logs
**Cause**: Event parsing issues or wrong event type
**Solution**: Check if `currentEventType === "content"` condition is being met

### Issue 4: Target Message Not Found
**Symptoms**: "📝 [RESUME] Message update result: {targetFound: false}"
**Cause**: `targetMessageId` doesn't match any existing message
**Solution**: Check message ID generation and matching logic

### Issue 5: Content Being Sanitized Away
**Symptoms**: Content events received but aiContent length doesn't increase
**Cause**: Content being filtered out by sanitization
**Solution**: Check `sanitizeContent` function and [object Object] filtering

## Quick Test Commands

### Test in Browser Console
```javascript
// Check current message state
console.log('Current messages:', window.__REACT_DEVTOOLS_GLOBAL_HOOK__);

// Monitor SSE events manually
const eventSource = new EventSource('/api/chat');
eventSource.onmessage = (event) => console.log('SSE:', event);
```

### Test Tool Approval Flow
1. Send message: "Create a calendar event for tomorrow at 2pm"
2. Approve the tool call
3. Monitor all console logs from both browser and server
4. Check if content appears after "✅ Tool execution completed"

## Expected Flow Sequence

### Normal Successful Flow:
1. **Tool Call**: `event: tool_call` → UI shows tool starting
2. **Approval Request**: `event: human_input_required` → UI shows approve/reject buttons
3. **User Approves**: Frontend sends resume request
4. **Tool Execution**: `event: tool_result` → Tool marked as completed
5. **Agent Response**: `event: content` → Follow-up message streams in
6. **Completion**: `event: done` → Stream ends

### Debug Each Step:
- [ ] Step 1: Tool call received and displayed
- [ ] Step 2: Approval UI appears correctly  
- [ ] Step 3: Approval request sent successfully
- [ ] Step 4: Tool result received and processed
- [ ] Step 5: **Content events generated and received** ← Most likely issue
- [ ] Step 6: Stream completes properly

## Investigation Priority

1. **High Priority**: Check if content events are being generated at all
2. **Medium Priority**: Verify event parsing and state updates
3. **Low Priority**: UI rendering issues (less likely)

## Log Analysis

### Successful Post-Tool Content Flow Should Show:
```
Backend:
🤖 [STREAM] Handling agent response
📝 [STREAM] Streaming agent content: {...}
📤 [SSE] streamContent called: {...}
📤 [SSE] Sending content chunk 1: {...}

Frontend:
📝 [RESUME] Received content event: {...}
📝 [RESUME] Updated aiContent: {...}
📝 [RESUME] Updating target message with content: {...}
📝 [RESUME] Message update result: {targetFound: true}
```

### If Any of These Are Missing, That's Where the Issue Is

Start debugging from the first missing log and work your way down the chain.