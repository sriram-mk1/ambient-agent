import { interrupt } from "@langchain/langgraph";
import { Tool } from "@langchain/core/tools";

// ================================================================================================
// 🔒 HUMAN-IN-THE-LOOP TOOL WRAPPER - Following Official LangGraph Patterns
// ================================================================================================

/**
 * Configuration options for human approval
 */
export interface HumanApprovalConfig {
  allowAccept?: boolean;
  allowEdit?: boolean;
  allowReject?: boolean;
  customMessage?: string;
}

/**
 * Default sensitive tool patterns that require human approval
 * These tools CANNOT run in parallel and must be executed sequentially with approval
 */
const SENSITIVE_TOOL_PATTERNS = [
  "createDocument",
  "deleteDocument",
  "sendEmail",
  "deleteEmail",
  "createSpreadsheet",
  "deleteSpreadsheet",
];

/**
 * Check if a tool name matches sensitive patterns
 */
export function isSensitiveTool(toolName: string): boolean {
  const lowerName = toolName.toLowerCase();
  return SENSITIVE_TOOL_PATTERNS.some((pattern) =>
    lowerName.includes(pattern.toLowerCase()),
  );
}

/**
 * Create a human-approved version of a tool following LangGraph patterns
 *
 * Based on official docs: interrupt() throws GraphInterrupt first time (pauses workflow),
 * then returns resume value second time (when workflow resumes)
 */
function createApprovedTool(
  tool: Tool,
  config: HumanApprovalConfig = {},
): Tool {
  const {
    allowAccept = true,
    allowEdit = true,
    allowReject = true,
    customMessage,
  } = config;

  class ApprovedTool extends Tool {
    name = tool.name;
    description = tool.description;
    schema = tool.schema;
    __isApprovalWrapper = true; // Mark this as an approval wrapper

    async _call(input: any): Promise<string> {
      console.log(`🔒 [HITL] Requesting approval for ${tool.name}`);

      // Create approval request payload
      const approvalRequest = {
        // Prefer 'name' to align with UI expectations; keep 'action'/'toolName' for backward compatibility
        name: tool.name,
        action: tool.name,
        toolName: tool.name,
        args: input,
        message: customMessage || `Do you want to execute ${tool.name}?`,
        allowAccept,
        allowEdit,
        allowReject,
        type: "tool_approval",
      };

      // This follows the official LangGraph pattern:
      // 1. First call: interrupt() throws GraphInterrupt to pause workflow
      // 2. Resume call: interrupt() returns the resume value provided by Command(resume=...)
      const response = interrupt(approvalRequest);

      console.log(`✅ [HITL] Received approval response:`, response);

      // Handle the approval response
      if (!response || response.type === "reject") {
        console.log(`❌ [HITL] Tool ${tool.name} was rejected by user`);
        return `Tool execution was rejected by user.`;
      }

      if (response.type === "approve") {
        console.log(`✅ [HITL] Tool ${tool.name} was approved by user`);
        // Use modified args if provided, otherwise use original
        const argsToUse = response.args || input;
        const result = await tool.invoke(argsToUse);
        console.log(`🎯 [HITL] Tool ${tool.name} executed successfully`);
        return result;
      }

      // Default to rejection if response is unclear
      console.log(
        `⚠️ [HITL] Unclear response for ${tool.name}, defaulting to reject`,
      );
      return `Tool execution was rejected due to unclear approval response.`;
    }
  }

  return new ApprovedTool();
}

/**
 * Automatically add human approval to sensitive tools
 */
export function addSensitiveToolApproval(
  tools: Tool[],
  config: HumanApprovalConfig = {},
): Tool[] {
  console.log(
    `🔍 [HITL] Scanning ${tools.length} tools for sensitive operations`,
  );

  const processedTools = tools.map((tool) => {
    if (isSensitiveTool(tool.name)) {
      console.log(
        `🔒 [HITL] Adding approval wrapper to sensitive tool: ${tool.name}`,
      );
      return createApprovedTool(tool, config);
    }
    return tool;
  });

  const sensitiveCount = processedTools.filter((_, i) =>
    isSensitiveTool(tools[i].name),
  ).length;

  console.log(`✅ [HITL] Added approval to ${sensitiveCount} sensitive tools`);
  return processedTools;
}

/**
 * Add human approval to specific tools by name
 */
export function addSelectiveHumanApproval(
  tools: Tool[],
  toolNames: string[],
  config: HumanApprovalConfig = {},
): Tool[] {
  console.log(
    `🎯 [HITL] Adding selective approval to tools: ${toolNames.join(", ")}`,
  );

  const targetNames = new Set(toolNames.map((name) => name.toLowerCase()));

  const processedTools = tools.map((tool) => {
    if (targetNames.has(tool.name.toLowerCase())) {
      console.log(
        `🔒 [HITL] Adding approval wrapper to specified tool: ${tool.name}`,
      );
      return createApprovedTool(tool, config);
    }
    return tool;
  });

  const approvedCount = processedTools.filter((_, i) =>
    targetNames.has(tools[i].name.toLowerCase()),
  ).length;

  console.log(`✅ [HITL] Added approval to ${approvedCount} specified tools`);
  return processedTools;
}

/**
 * Add human approval to all tools (for high-security environments)
 */
export function addUniversalHumanApproval(
  tools: Tool[],
  config: HumanApprovalConfig = {},
): Tool[] {
  console.log(
    `🛡️ [HITL] Adding universal approval to all ${tools.length} tools`,
  );

  const processedTools = tools.map((tool) => {
    console.log(`🔒 [HITL] Adding approval wrapper to tool: ${tool.name}`);
    return createApprovedTool(tool, config);
  });

  console.log(`✅ [HITL] Added approval to all ${tools.length} tools`);
  return processedTools;
}

/**
 * Check if a tool requires human approval
 */
export function requiresApproval(tool: Tool): boolean {
  return isSensitiveTool(tool.name);
}

/**
 * Get list of sensitive tool patterns
 */
export function getSensitiveToolPatterns(): string[] {
  return [...SENSITIVE_TOOL_PATTERNS];
}

/**
 * Add custom sensitive tool patterns
 */
export function addSensitiveToolPattern(pattern: string): void {
  if (!SENSITIVE_TOOL_PATTERNS.includes(pattern)) {
    SENSITIVE_TOOL_PATTERNS.push(pattern);
    console.log(`📝 [HITL] Added custom sensitive pattern: ${pattern}`);
  }
}

/**
 * Validation helper for approval responses
 */
export function validateApprovalResponse(response: any): {
  isValid: boolean;
  type: "approve" | "reject" | "invalid";
  args?: any;
} {
  if (!response || typeof response !== "object") {
    return { isValid: false, type: "invalid" };
  }

  const { type, args } = response;

  if (type === "approve") {
    return { isValid: true, type: "approve", args };
  }

  if (type === "reject") {
    return { isValid: true, type: "reject" };
  }

  return { isValid: false, type: "invalid" };
}

/**
 * Create approval request data structure
 */
export function createApprovalRequest(
  toolName: string,
  args: any,
  config: HumanApprovalConfig = {},
) {
  return {
    id: `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    toolName,
    args,
    message: config.customMessage || `Do you want to execute ${toolName}?`,
    allowAccept: config.allowAccept ?? true,
    allowEdit: config.allowEdit ?? true,
    allowReject: config.allowReject ?? true,
    timestamp: new Date().toISOString(),
    type: "tool_approval",
  };
}

/**
 * Check if a tool can safely run in parallel with others
 */
export function canRunInParallel(tool: Tool): boolean {
  // Sensitive tools cannot run in parallel
  if (isSensitiveTool(tool.name)) {
    return false;
  }

  // Add additional checks for tools that shouldn't run in parallel
  const sequentialOnlyPatterns = [
    "update_",
    "modify_",
    "edit_",
    "write_",
    "create_file",
    "deploy_",
    "migrate_",
    "backup_",
    "restore_",
    "human_input", // never run human_input in parallel
  ];

  const toolName = tool.name.toLowerCase();
  const isSequentialOnly = sequentialOnlyPatterns.some((pattern) =>
    toolName.includes(pattern),
  );

  return !isSequentialOnly;
}

/**
 * Prevent parallel execution of sensitive tools
 */
export function validateParallelExecution(tools: Tool[]): {
  canExecuteInParallel: boolean;
  blockedTools: string[];
  reason?: string;
} {
  const sensitiveTools = tools.filter((tool) => isSensitiveTool(tool.name));

  if (sensitiveTools.length > 0) {
    return {
      canExecuteInParallel: false,
      blockedTools: sensitiveTools.map((tool) => tool.name),
      reason: "Sensitive tools detected - these require individual approval",
    };
  }

  const sequentialTools = tools.filter((tool) => !canRunInParallel(tool));

  if (sequentialTools.length > 1) {
    return {
      canExecuteInParallel: false,
      blockedTools: sequentialTools.map((tool) => tool.name),
      reason: "Multiple sequential-only tools detected",
    };
  }

  return {
    canExecuteInParallel: true,
    blockedTools: [],
  };
}

/**
 * Check if a tool already has an approval wrapper
 */
export function hasApprovalWrapper(tool: Tool): boolean {
  // Check if this is an ApprovedTool instance
  // We can detect this by checking for specific properties or methods
  // that only exist on wrapped tools
  return (
    tool.constructor.name === "ApprovedTool" ||
    (tool as any).__isApprovalWrapper === true ||
    tool.description.includes("approval") ||
    tool.name.includes("_approved")
  );
}

/**
 * Add human approval to sensitive tools, but skip if already wrapped
 */
export function addSensitiveToolApprovalSafe(
  tools: Tool[],
  config: HumanApprovalConfig = {},
): Tool[] {
  console.log(
    `🔍 [HITL] Safely scanning ${tools.length} tools for sensitive operations`,
  );

  const processedTools = tools.map((tool) => {
    // Skip if tool already has approval wrapper
    if (hasApprovalWrapper(tool)) {
      console.log(
        `⏭️ [HITL] Tool ${tool.name} already has approval wrapper, skipping`,
      );
      return tool;
    }

    if (isSensitiveTool(tool.name)) {
      console.log(
        `🔒 [HITL] Adding approval wrapper to sensitive tool: ${tool.name}`,
      );
      return createApprovedTool(tool, config);
    }
    return tool;
  });

  const newlyWrappedCount = processedTools.filter(
    (_, i) => !hasApprovalWrapper(tools[i]) && isSensitiveTool(tools[i].name),
  ).length;

  console.log(
    `✅ [HITL] Added approval to ${newlyWrappedCount} new sensitive tools`,
  );
  return processedTools;
}

/**
 * Utility to format tool arguments for display
 */
export function formatToolArgsForDisplay(args: any): string {
  try {
    if (typeof args === "string") {
      return args;
    }

    if (typeof args === "object" && args !== null) {
      // Pretty format common argument structures
      const formatted = Object.entries(args)
        .map(
          ([key, value]) =>
            `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
        )
        .join("\n");

      return formatted;
    }

    return JSON.stringify(args, null, 2);
  } catch (error) {
    return "Unable to format arguments";
  }
}
