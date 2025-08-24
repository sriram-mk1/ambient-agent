export interface ToolCall {
  id: string;
  name: string;
  status:
    | "starting"
    | "running"
    | "completed"
    | "error"
    | "pending_approval"
    | "approved"
    | "rejected"
    | "parallel_executing"
    | "parallel_completed";
  message?: string;
  segment: number; // Segment index where this tool call should appear
  args?: any; // Tool arguments for approval
  interruptId?: string; // For resuming interrupted execution
  threadId?: string; // Thread ID for resuming execution
  canRunInParallel?: boolean; // Whether this tool can execute in parallel
  requiresApproval?: boolean; // Whether this tool requires human approval
  executionTime?: number; // Time taken to execute (ms)
  parallelGroup?: string; // ID of parallel execution group
}

export interface MessageContent {
  type: "text" | "tool_call";
  content: string;
  segment: number; // Segment index instead of character position
  toolCall?: ToolCall;
  conversationRound?: number; // Track which conversation round this content belongs to
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  structuredContent?: MessageContent[]; // For inline tool calls
  toolCalls?: ToolCall[]; // Track all tool calls for this message
  hidden?: boolean; // If true, keep in history but do not render in UI
  // Collected sources from tool outputs for this assistant message
  sources?: Array<{
    id: string;
    type: "web" | "doc" | "sheet" | "mail" | "other";
    title?: string;
    url?: string;
    label?: string;
    iconKey: "web" | "doc" | "sheet" | "gmail" | "other";
  }>;
  plan?: Plan;
  reflection?: Reflection;
}

export interface Plan {
  steps: Array<{
    step: number;
    description: string;
    tools?: string[];
  }>;
  status: "planning" | "complete";
}

export interface Reflection {
  content: string;
  status: "reflecting" | "complete";
}

export interface HumanApprovalRequest {
  interruptId: string;
  toolCall: {
    name: string;
    args: any;
  };
  message: string;
}

export interface HumanApprovalResponse {
  type: "approve" | "reject";
}

/**
 * Configuration for agent execution including parallel tools
 */
export interface AgentExecutionConfig {
  maxIterations?: number;
  maxToolCalls?: number;
  streamToolCalls?: boolean;
  enableParallelExecution?: boolean;
  maxConcurrency?: number;
  parallelTimeout?: number;
  fallbackToSequential?: boolean;
}

/**
 * Parallel tool execution request
 */
export interface ParallelToolRequest {
  tool_name: string;
  args: Record<string, any>;
  priority?: number;
}

/**
 * Parallel tool execution result
 */
export interface ParallelToolResult {
  toolName: string;
  status: "success" | "error" | "timeout" | "skipped";
  result?: string;
  error?: string;
  executionTime: number;
  requiresApproval?: boolean;
}

/**
 * Tool classification for parallel execution
 */
export type ToolCategory =
  | "SAFE_PARALLEL" // Can run in parallel with other tools
  | "REQUIRES_APPROVAL" // Must run sequentially with human approval
  | "SEQUENTIAL_ONLY"; // Safe but must run one at a time

/**
 * Tool classification result
 */
export interface ToolClassification {
  toolName: string;
  category: ToolCategory;
  reason: string;
  canRunInParallel: boolean;
  requiresApproval: boolean;
}

/**
 * Streaming events for parallel execution
 */
export interface ParallelExecutionEvent {
  type:
    | "parallel_execution_detected"
    | "parallel_execution_start"
    | "parallel_execution_complete"
    | "sequential_execution_required"
    | "tool_parallel_start"
    | "tool_parallel_complete";
  message: string;
  toolNames?: string[];
  blockedTools?: string[];
  canRunInParallel?: boolean;
  requiresApproval?: boolean;
  executionTime?: number;
}
