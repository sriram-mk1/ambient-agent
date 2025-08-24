# Test Guide: Post-Tool Content Debug

## Quick Test Steps

### 1. Open Browser Console
- Open Chrome DevTools (F12)
- Go to Console tab
- Clear console logs

### 2. Send Test Message
Send this message in the chat:
```
Create a calendar event for tomorrow at 2 PM called "Test Meeting"
```

### 3. Approve Tool Call
- Wait for tool approval UI to appear
- Click the green checkmark (✓) to approve

### 4. Monitor Console Logs

#### Backend Logs (Terminal/Server Console)
Look for this sequence after approval:

```
✅ [HITL] Tool [tool_name] was approved by user
🤖 [STREAM] Handling agent response
📝 [STREAM] Streaming agent content: {...}
📤 [SSE] streamContent called: {...}
📤 [SSE] Sending content chunk 1: {...}
```

#### Frontend Logs (Browser Console)
Look for this sequence after approval:

```
📡 [RESUME] SSE Event Received: {eventType: "content", ...}
📝 [RESUME] Received content event: {...}
📝 [RESUME] Updated aiContent: {...}
📝 [RESUME] Updating target message with content: {...}
```

### 5. Check Network Tab
- Go to Network tab in DevTools
- Find the POST request to `/api/chat` (the resume request)
- Click on it and go to Response tab
- Look for:
```
event: tool_result
data: {...}

event: content
data: {"content":"I've successfully created...","segment":0}

event: done
data: {...}
```

## Diagnostic Scenarios

### Scenario A: No Backend Content Generation
**Symptoms**: No "🤖 [STREAM] Handling agent response" logs after tool approval

**Possible Causes**:
1. Workflow ending after tool execution
2. Agent not generating follow-up response
3. Stream processing stopping prematurely

**Debug Actions**:
1. Check if workflow has more chunks after tool execution
2. Verify `resumeWorkflow` continues properly
3. Check LangGraph workflow definition

### Scenario B: Backend Generates But Doesn't Send
**Symptoms**: "🤖 [STREAM] Handling agent response" but no "📤 [SSE] Sending content chunk"

**Possible Causes**:
1. Content being filtered out by sanitization
2. SSE controller closed prematurely
3. Content streaming disabled

**Debug Actions**:
1. Check `this.sseController.isClosed` status
2. Verify content passes sanitization
3. Check streaming configuration

### Scenario C: Events Sent But Not Received
**Symptoms**: Content events in Network tab but no frontend logs

**Possible Causes**:
1. Event parsing issues
2. Wrong event type matching
3. Buffer handling problems

**Debug Actions**:
1. Verify event format in Network tab
2. Check `currentEventType` parsing
3. Test with different content types

### Scenario D: Events Received But Not Applied
**Symptoms**: Frontend logs show events but no UI changes

**Possible Causes**:
1. Target message ID mismatch
2. React state update issues
3. Content being overwritten

**Debug Actions**:
1. Verify `targetMessageId` matches existing message
2. Check React DevTools for state changes
3. Ensure content accumulation logic is correct

## Manual Debug Test

Add this temporary debug code to `useAIChat.ts` in the approveToolCall function:

```typescript
// Add after the while loop in approveToolCall
console.log("🔍 [DEBUG] Final resume state:", {
  aiContentLength: aiContent.length,
  aiContentPreview: aiContent.substring(0, 200),
  targetMessageId,
  hasStartedContent,
  totalLinesProcessed: 'count them',
  messagesCount: messages.length
});

// Also add this to see what messages look like
setMessages(prev => {
  console.log("🔍 [DEBUG] Final messages:", prev.map(m => ({
    id: m.id,
    role: m.role,
    contentLength: typeof m.content === 'string' ? m.content.length : 0,
    content: typeof m.content === 'string' ? m.content : 'not string'
  })));
  return prev;
});
```

## Expected vs Actual

### Expected Behavior:
1. Tool call appears → User approves → Tool executes → "✅ [Tool] completed" → Agent says something like "I've successfully created your calendar event for tomorrow at 2 PM."

### What's Likely Happening:
1. Tool call appears → User approves → Tool executes → "✅ [Tool] completed" → **Nothing more appears**

## Immediate Action Items

1. **Run the test message above**
2. **Check which scenario matches your logs**
3. **Report back with**:
   - Backend console logs (especially after approval)
   - Frontend console logs (in browser)
   - Network tab content events (if any)

## Alternative Testing

If the calendar event doesn't work, try these simpler tests:

### Test 1: Email Tool
```
Send an email to test@example.com with subject "Test"
```

### Test 2: File Creation
```
Create a new file called test.txt with some content
```

### Test 3: Simple Request
```
What's the weather like? (if weather tool is available)
```

The goal is to trigger ANY tool that requires approval, then see if post-tool content appears.

## Emergency Fix

If you need to quickly test if the issue is in the resume flow vs the regular flow, try this:

1. Remove the human-in-the-loop approval temporarily
2. Send a message that would normally require approval
3. See if the agent response appears when tools execute without approval
4. This will tell us if the issue is specifically in the resume flow or in the content streaming generally

Add this to temporarily disable approval:
```typescript
// In agent setup, comment out the human approval wrapper
// return addSensitiveToolApproval(tools);
return tools; // Skip approval for testing
```
