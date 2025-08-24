# System Message Validation Fix

## Problem Description

The application was experiencing a runtime error:
```
Error: System message should be the first one
    at Array.reduce (<anonymous>)
    at _streamResponseChunks.next (<anonymous>) {
  pregelTaskId: '813ed9ff-7c33-5f89-bf78-de443e38a7d1'
}
```

This error was occurring during the streaming process when LangGraph internally validated message arrays and found that the system message was not positioned first in the messages array.

## Root Cause Analysis

1. **Missing Import**: The `SystemMessage` class was not imported in `conversation.ts` but was being used in the validation code
2. **Insufficient Message Validation**: The message ordering validation was not comprehensive enough to handle all edge cases
3. **Streaming Error Handling**: No specific error handling for system message validation errors during streaming

## Fixes Implemented

### 1. Fixed Missing Import (conversation.ts)

**File**: `src/lib/agent/conversation.ts`

Added missing `SystemMessage` import:
```typescript
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,  // ← Added this
} from "@langchain/core/messages";
```

### 2. Enhanced Message Validation (workflow.ts)

**File**: `src/lib/agent/workflow.ts`

Improved the `validateMessageOrder` function:
- Added defensive copying to avoid mutating original arrays
- Added filtering for invalid messages
- Enhanced system message detection and positioning logic

Improved the `callModel` function:
- Added comprehensive message validation before streaming
- Added double-checking to ensure system message is absolutely first
- Added emergency fallback system message injection

### 3. Added Streaming Error Handling (streaming.ts)

**File**: `src/lib/agent/streaming.ts`

Added specific error handling for system message validation errors:
- Wrapped chunk processing in try-catch blocks
- Added specific handling for "System message should be the first one" errors
- Added error recovery instead of breaking the entire stream
- Added client notification for validation errors

### 4. Pre-workflow Validation (conversation.ts)

**File**: `src/lib/agent/conversation.ts`

Added final validation before starting workflow:
- Validates system message position before streaming
- Provides detailed error logging for debugging
- Throws descriptive errors if validation fails

## Code Changes Summary

### Files Modified:
1. `src/lib/agent/conversation.ts` - Added import and validation
2. `src/lib/agent/workflow.ts` - Enhanced message validation
3. `src/lib/agent/streaming.ts` - Added error handling
4. `src/lib/agent/manager.ts` - Fixed ESLint errors

### Key Validation Logic:

```typescript
// Ensure system message is absolutely first
if (validatedMessages.length > 0) {
  const firstType = validatedMessages[0]?._getType?.();
  if (firstType !== "system") {
    // Emergency fix: inject system message if none exists or move existing one
    const systemIndex = validatedMessages.findIndex(
      (m) => m?._getType?.() === "system",
    );
    if (systemIndex > 0) {
      const systemMsg = validatedMessages.splice(systemIndex, 1)[0];
      validatedMessages.unshift(systemMsg);
    } else if (systemIndex === -1) {
      validatedMessages.unshift(new SystemMessage(systemPrompt));
    }
  }
}
```

## Testing

A test script was created and verified to ensure the validation logic works correctly:
- ✅ Empty messages array handling
- ✅ Correct order maintenance
- ✅ System message reordering
- ✅ System message injection
- ✅ Invalid message filtering
- ✅ Error handling simulation

## Prevention

To prevent this issue in the future:

1. **Always validate message order** before any LangGraph operations
2. **Include comprehensive imports** for all message types used
3. **Add error handling** for streaming operations
4. **Use defensive copying** when manipulating message arrays
5. **Log validation steps** for easier debugging

## Verification

To verify the fix is working:

1. Start the application
2. Send a message like "list my emails, docs, and sheets"
3. Monitor the console logs for:
   - No "System message should be the first one" errors
   - Successful message validation logs
   - Proper streaming operation

## Related Documentation

- [LangGraph Message Handling](https://langchain-ai.github.io/langgraph/)
- [LangChain Message Types](https://python.langchain.com/docs/concepts/#messages)
- [Debug Guide: Post-Tool Content Not Showing](./documentation/debug/DEBUG_POST_TOOL_CONTENT.md)