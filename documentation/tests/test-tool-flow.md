# Tool Call Flow Test

This document outlines tests to verify that the tool call flow works correctly after the recent fixes.

## Issues Fixed

1. **Duplicate Tool Calls**: Only one tool call should show with approve/reject buttons
2. **Missing Post-Tool Messages**: Agent messages after tool execution should be properly streamed
3. **Workflow Continuation**: The workflow should continue seamlessly after tool approval

## Test Scenarios

### Test 1: Single Tool Call Display

**Objective**: Verify only one tool call component shows with approve/reject buttons

**Steps**:
1. Send a message that triggers a tool requiring approval (e.g., "Send an email to test@example.com")
2. Observe the UI during tool call processing

**Expected Result**:
- Only ONE tool call component should appear
- It should show "Approve [Tool Name]?" with ✓ and ✕ buttons
- No duplicate tool calls should be visible

**What to Watch For**:
- Check browser dev tools for console logs showing tool call events
- Ensure `tool_call` and `human_input_required` events don't create separate UI elements

### Test 2: Post-Tool Message Streaming

**Objective**: Verify agent messages after tool execution are properly displayed

**Steps**:
1. Send a message that triggers a tool (e.g., "Create a calendar event for tomorrow at 2pm")
2. Click "Approve" when prompted
3. Wait for tool execution to complete
4. Observe if additional agent messages appear

**Expected Result**:
- Tool call should transition from "pending_approval" → "approved" → "completed"
- Agent should provide follow-up message after tool completion
- Messages like "I've successfully created the calendar event..." should appear
- All content should stream properly to the frontend

**What to Watch For**:
- Check console logs for "📝 [STREAM] Streaming agent content"
- Verify streaming doesn't stop after tool approval
- Ensure "✅ [STREAM] Processed X chunks total" appears

### Test 3: Multiple Tool Workflow

**Objective**: Test workflows with multiple sequential tools

**Steps**:
1. Send a complex request requiring multiple tools (e.g., "Create a document, then email it to john@example.com")
2. Approve each tool when prompted
3. Verify the complete workflow

**Expected Result**:
- Each tool should appear individually for approval
- After each approval, the workflow should continue
- Final agent response should summarize all actions taken
- No tools should be duplicated or missed

### Test 4: Tool Rejection Handling

**Objective**: Verify rejection handling works correctly

**Steps**:
1. Send a message that triggers a tool
2. Click "Reject" (✕) when prompted
3. Observe the response

**Expected Result**:
- Tool should be marked as "rejected"
- Agent should acknowledge the rejection
- Workflow should continue with an appropriate response
- No errors should occur

## Debug Information to Monitor

### Console Logs to Watch

1. **Tool Call Processing**:
   ```
   🛠️ [STREAM] Processing tool calls: X
   🔒 [HITL] Requesting approval for [tool_name]
   ```

2. **Stream Processing**:
   ```
   🔄 [STREAM] Processing chunk #X: {...}
   📝 [STREAM] Streaming agent content: ...
   ✅ [STREAM] Processed X chunks total
   ```

3. **Human-in-the-Loop**:
   ```
   🛑 [STREAM] Handling interrupt for initial request
   🔄 [STREAM] Skipping interrupt in resume request, continuing stream
   ✅ [HITL] Tool [tool_name] was approved by user
   ```

4. **Tool Execution**:
   ```
   📊 [STREAM] Emitting tool result: ...
   ✅ Tool execution completed after approval
   ```

### Network Tab Verification

1. Check SSE stream in Network tab
2. Verify events are received in correct order:
   - `event: tool_call`
   - `event: human_input_required`
   - (after approval) `event: tool_result`
   - `event: content` (for post-tool messages)
   - `event: done`

### UI State Verification

1. **Tool Call Component States**:
   - `starting` → blue background, spinning icon
   - `pending_approval` → orange background, approve/reject buttons
   - `approved` → green background, "approved" text
   - `completed` → green background, "completed" text

2. **Message Flow**:
   - User message appears immediately
   - "thinking..." appears briefly
   - Tool call component appears
   - After approval, tool completes
   - Additional agent content streams in
   - Final message is complete and readable

## Common Issues to Check

### Issue: Duplicate Tool Calls
- **Symptom**: Two tool call components for the same tool
- **Fix**: Check that `activeToolCalls.get(toolCallId)` properly prevents duplicates
- **Log**: Look for multiple tool calls with same ID

### Issue: Missing Post-Tool Messages
- **Symptom**: No agent response after tool completion
- **Fix**: Verify streaming continues after `tool_result` event
- **Log**: Check for "📝 [STREAM] Streaming agent content" after tool completion

### Issue: Workflow Stops After Approval
- **Symptom**: Tool completes but no further processing
- **Fix**: Ensure `Command({ resume: value })` properly resumes workflow
- **Log**: Look for "🔄 [STREAM] Skipping interrupt in resume request"

## Success Criteria

✅ **Tool Call Display**: Only one tool call component per tool
✅ **Approval Flow**: Smooth transition from pending → approved → completed
✅ **Post-Tool Messages**: Agent responses after tool execution are visible
✅ **Stream Continuation**: Workflow continues properly after approval
✅ **Error Handling**: Rejection and errors are handled gracefully
✅ **User Experience**: No duplicate components, complete information flow

## Test Commands

Try these test messages to trigger different scenarios:

1. **Email Tool**: "Send an email to test@example.com with subject 'Test'"
2. **Calendar Tool**: "Create a meeting tomorrow at 3pm called 'Project Review'"
3. **Document Tool**: "Create a new document called 'Meeting Notes'"
4. **File Operations**: "Create a file called 'data.txt' with some content"
5. **Complex Workflow**: "Create a document about our project, then email it to the team"

Each should trigger the human-in-the-loop approval flow and allow testing of the complete workflow.