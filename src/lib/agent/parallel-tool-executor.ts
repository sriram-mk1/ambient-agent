import { Tool } from "@langchain/core/tools";
import { z } from "zod";
import { agentLogger } from "./logger";

/**
 * Configuration for parallel tool execution
 */
export interface ParallelExecutionConfig {
  /** Maximum number of tools to execute in parallel */
  maxConcurrency: number;
  /** Timeout for individual tool execution (ms) */
  toolTimeout: number;
  /** Whether to fail fast on first error or collect all results */
  failFast: boolean;
  /** Enable detailed logging */
  enableLogging: boolean;
  /** Fallback to sequential execution if parallel fails */
  fallbackToSequential: boolean;
}

/**
 * Default configuration for parallel execution
 */
const DEFAULT_CONFIG: ParallelExecutionConfig = {
  maxConcurrency: 5,
  toolTimeout: 30000, // 30 seconds
  failFast: false,
  enableLogging: true,
  fallbackToSequential: true,
};

/**
 * Result of a single tool execution
 */
export interface ToolExecutionResult {
  toolName: string;
  status: "success" | "error" | "timeout" | "skipped";
  result?: string;
  error?: string;
  executionTime: number;
}

/**
 * Input schema for the parallel tool executor - compatible with LangChain Tool
 */
const ParallelToolExecutorSchema = z
  .object({
    input: z
      .string()
      .optional()
      .describe("JSON string containing parallel tool execution parameters"),
  })
  .transform((data) => data.input);

/**
 * Parallel Tool Executor - Meta-tool for executing multiple tools efficiently
 */
export class ParallelToolExecutor extends Tool {
  name = "parallel_tool_executor";
  description = `Execute multiple tools in parallel for improved performance. Use this when you need to run 2+ independent operations simultaneously.

SAFE FOR PARALLEL (can use multiple times in parallel):
- search_* tools (search_gmail, search_calendar, search_docs, etc.)
- get_* tools (get_weather, get_news, get_user_info, etc.)
- fetch_* tools (fetch_url, fetch_data, etc.)
- list_* tools (list_files, list_emails, etc.)
- read_* tools (read_file, read_document, etc.)
- find_* tools
- query_* tools

NEVER USE IN PARALLEL (sensitive operations):
- send_* tools (send_email, send_message)
- delete_* tools (delete_file, delete_record)
- create_* tools (create_document, create_event)
- update_* tools (update_database, update_file)
- edit_* tools (edit_file, edit_document)
- write_* tools (write_file, write_data)
- modify_* tools
- remove_* tools
- deploy_* tools
- execute_* tools
- run_* tools (except read-only ones)
- install_* tools

Examples:
{
  "tools_to_execute": [
    {"tool_name": "search_gmail", "args": {"query": "urgent"}},
    {"tool_name": "search_calendar", "args": {"date": "today"}}
  ]
}

Same tool multiple times:
{
  "tools_to_execute": [
    {"tool_name": "search_gmail", "args": {"query": "urgent"}},
    {"tool_name": "search_gmail", "args": {"query": "deadline"}},
    {"tool_name": "search_gmail", "args": {"query": "meeting"}}
  ]
}`;

  // Schema removed to avoid Zod type conflicts - tool will work without explicit schema

  private config: ParallelExecutionConfig;
  private availableTools: Map<string, Tool> = new Map();

  constructor(tools: Tool[], config: Partial<ParallelExecutionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Index available tools by name
    tools.forEach((tool) => {
      this.availableTools.set(tool.name, tool);
    });

    if (this.config.enableLogging) {
      agentLogger.info(
        `[Parallel Executor] Initialized with ${tools.length} tools, max concurrency: ${this.config.maxConcurrency}`,
      );
    }
  }

  /**
   * Check if a tool is safe for parallel execution based on name patterns
   */
  private isSafeTool(toolName: string): boolean {
    // Sensitive tool patterns that should not run in parallel
    const sensitivePatterns = [
      /^send_/,
      /^delete_/,
      /^create_/,
      /^update_/,
      /^modify_/,
      /^remove_/,
      /^edit_/,
      /^write_/,
      /^post_/,
      /^put_/,
      /^deploy_/,
      /^execute_/,
      /^install_/,
      /^uninstall_/,
      /^drop_/,
      /^truncate_/,
      /^commit_/,
      /^push_/,
      /^merge_/,
      /^revert_/,
      /_file$/,
      /_database$/,
    ];

    // Check if tool matches any sensitive patterns
    return !sensitivePatterns.some((pattern) => pattern.test(toolName));
  }

  /**
   * Execute a single tool with timeout protection
   */
  private async executeToolWithTimeout(
    tool: Tool,
    args: any,
    toolName: string,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Tool execution timeout after ${this.config.toolTimeout}ms`,
            ),
          );
        }, this.config.toolTimeout);
      });

      // Race between tool execution and timeout
      const result = await Promise.race([tool.invoke(args), timeoutPromise]);

      const executionTime = Date.now() - startTime;

      if (this.config.enableLogging) {
        agentLogger.info(
          `[Parallel Executor] ✅ ${toolName} completed in ${executionTime}ms`,
        );
      }

      return {
        toolName,
        status: "success",
        result: typeof result === "string" ? result : JSON.stringify(result),
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const isTimeout =
        error instanceof Error && error.message.includes("timeout");

      if (this.config.enableLogging) {
        agentLogger.error(
          `[Parallel Executor] ❌ ${toolName} failed after ${executionTime}ms:`,
          error,
        );
      }

      return {
        toolName,
        status: isTimeout ? "timeout" : "error",
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      };
    }
  }

  /**
   * Execute tools in parallel with concurrency control
   */
  private async executeParallelTools(
    toolExecutions: Array<{ tool: Tool; args: any; toolName: string }>,
  ): Promise<ToolExecutionResult[]> {
    if (toolExecutions.length === 0) {
      return [];
    }

    const startTime = Date.now();
    const toolNames = toolExecutions.map((te) => te.toolName);

    if (this.config.enableLogging) {
      agentLogger.info(
        `[Parallel Executor] 🚀 Starting PARALLEL execution of ${toolExecutions.length} tools: ${toolNames.join(", ")}`,
      );
      agentLogger.info(
        `[Parallel Executor] ⏱️ Parallel start time: ${new Date().toISOString()}`,
      );
    }

    // Create execution promises with individual timing
    const promises = toolExecutions.map(async ({ tool, args, toolName }) => {
      const toolStart = Date.now();
      if (this.config.enableLogging) {
        agentLogger.info(
          `[Parallel Executor] 🔄 Starting ${toolName} at ${new Date().toISOString()}`,
        );
      }

      const result = await this.executeToolWithTimeout(tool, args, toolName);

      if (this.config.enableLogging) {
        agentLogger.info(
          `[Parallel Executor] ✅ Completed ${toolName} in ${Date.now() - toolStart}ms at ${new Date().toISOString()}`,
        );
      }

      return result;
    });

    // Execute with concurrency control using Promise.all
    let results: ToolExecutionResult[];

    if (promises.length <= this.config.maxConcurrency) {
      if (this.config.enableLogging) {
        agentLogger.info(
          `[Parallel Executor] 🎯 Executing ${promises.length} tools in SINGLE BATCH (within concurrency limit of ${this.config.maxConcurrency})`,
        );
      }
      results = await Promise.all(promises);
    } else {
      if (this.config.enableLogging) {
        agentLogger.info(
          `[Parallel Executor] 📦 Executing ${promises.length} tools in BATCHES (concurrency limit: ${this.config.maxConcurrency})`,
        );
      }

      // Execute in batches to respect concurrency limits
      results = [];
      for (let i = 0; i < promises.length; i += this.config.maxConcurrency) {
        const batchStart = Date.now();
        const batch = promises.slice(i, i + this.config.maxConcurrency);
        const batchNumber = Math.floor(i / this.config.maxConcurrency) + 1;

        if (this.config.enableLogging) {
          agentLogger.info(
            `[Parallel Executor] 📦 Starting batch ${batchNumber} with ${batch.length} tools at ${new Date().toISOString()}`,
          );
        }

        const batchResults = await Promise.all(batch);
        results.push(...batchResults);

        if (this.config.enableLogging) {
          agentLogger.info(
            `[Parallel Executor] ✅ Completed batch ${batchNumber} in ${Date.now() - batchStart}ms`,
          );
        }
      }
    }

    const totalTime = Date.now() - startTime;
    const sequentialEstimate = results.reduce(
      (sum, result) => sum + result.executionTime,
      0,
    );
    const parallelEfficiency =
      sequentialEstimate > 0
        ? ((sequentialEstimate - totalTime) / sequentialEstimate) * 100
        : 0;

    if (this.config.enableLogging) {
      agentLogger.info(
        `[Parallel Executor] 🏁 PARALLEL execution completed in ${totalTime}ms`,
      );
      agentLogger.info(
        `[Parallel Executor] 📊 Sequential estimate: ${sequentialEstimate}ms vs Parallel actual: ${totalTime}ms`,
      );
      agentLogger.info(
        `[Parallel Executor] ⚡ Parallel efficiency: ${parallelEfficiency.toFixed(1)}% time saved`,
      );

      if (parallelEfficiency > 0) {
        agentLogger.info(
          `[Parallel Executor] ✅ CONFIRMED: Tools executed in PARALLEL (saved ${Math.round(parallelEfficiency)}% time)`,
        );
      } else {
        agentLogger.warn(
          `[Parallel Executor] ⚠️ WARNING: No parallel efficiency detected - tools may be running sequentially`,
        );
      }
    }

    return results;
  }

  /**
   * Execute tools sequentially (for sensitive tools)
   */
  private async executeSequentialTools(
    toolExecutions: Array<{
      tool: Tool;
      args: any;
      toolName: string;
      requiresApproval: boolean;
    }>,
  ): Promise<ToolExecutionResult[]> {
    if (toolExecutions.length === 0) {
      return [];
    }

    const startTime = Date.now();
    const toolNames = toolExecutions.map((te) => te.toolName);

    if (this.config.enableLogging) {
      agentLogger.info(
        `[Parallel Executor] 🔒 Starting SEQUENTIAL execution of ${toolExecutions.length} tools: ${toolNames.join(", ")}`,
      );
      agentLogger.info(
        `[Parallel Executor] ⏱️ Sequential start time: ${new Date().toISOString()}`,
      );
    }

    const results: ToolExecutionResult[] = [];
    let toolIndex = 1;

    for (const { tool, args, toolName, requiresApproval } of toolExecutions) {
      const toolStart = Date.now();

      if (this.config.enableLogging) {
        agentLogger.info(
          `[Parallel Executor] 🔄 Starting tool ${toolIndex}/${toolExecutions.length}: ${toolName} at ${new Date().toISOString()}`,
        );
      }

      if (requiresApproval) {
        // For sensitive tools that require approval, execute them normally
        // The human approval wrapper will handle the approval flow
        if (this.config.enableLogging) {
          agentLogger.info(
            `[Parallel Executor] 🔐 Executing sensitive tool with approval: ${toolName}`,
          );
        }
        const result = await this.executeToolWithTimeout(tool, args, toolName);
        results.push(result);
      } else {
        const result = await this.executeToolWithTimeout(tool, args, toolName);
        results.push(result);
      }

      if (this.config.enableLogging) {
        agentLogger.info(
          `[Parallel Executor] ✅ Completed tool ${toolIndex}/${toolExecutions.length}: ${toolName} in ${Date.now() - toolStart}ms`,
        );
      }

      toolIndex++;
    }

    const totalTime = Date.now() - startTime;

    if (this.config.enableLogging) {
      agentLogger.info(
        `[Parallel Executor] 🏁 SEQUENTIAL execution completed in ${totalTime}ms`,
      );
      agentLogger.info(
        `[Parallel Executor] 🔒 Sequential execution reason: ${toolExecutions.some((t) => t.requiresApproval) ? "Contains sensitive tools requiring approval" : "Mixed tool types or configuration"}`,
      );
    }

    return results;
  }

  /**
   * Main execution method
   */
  async _call(input?: string): Promise<string> {
    try {
      // Parse the input JSON string
      const parsedInput = input ? JSON.parse(input) : {};

      // Validate the parsed input structure
      const ExecutionParamsSchema = z.object({
        tools_to_execute: z.array(
          z.object({
            tool_name: z.string(),
            args: z.record(z.any()),
            priority: z.number().optional(),
          }),
        ),
        execution_mode: z
          .enum(["auto", "parallel_only", "sequential_only"])
          .default("auto"),
        max_concurrency: z.number().optional(),
      });

      const validatedInput = ExecutionParamsSchema.parse(parsedInput);

      const {
        tools_to_execute,
        execution_mode = "auto",
        max_concurrency,
      } = validatedInput;

      // Override concurrency if specified
      if (max_concurrency) {
        this.config.maxConcurrency = max_concurrency;
      }

      // Validate tool execution array
      if (!tools_to_execute || tools_to_execute.length === 0) {
        return "No tools specified for execution.";
      }

      // Prepare tool executions with safety classification
      const toolExecutions: Array<{
        tool: Tool;
        args: any;
        toolName: string;
        priority: number;
        canRunInParallel: boolean;
        requiresApproval: boolean;
      }> = [];

      for (const toolExec of tools_to_execute) {
        const tool = this.availableTools.get(toolExec.tool_name);
        if (!tool) {
          if (this.config.enableLogging) {
            agentLogger.error(
              `[Parallel Executor] Tool not found: ${toolExec.tool_name}`,
            );
          }
          continue;
        }

        // Check if tool is safe for parallel execution
        const isSafe = this.isSafeTool(toolExec.tool_name);

        toolExecutions.push({
          tool,
          args: toolExec.args,
          toolName: toolExec.tool_name,
          priority: toolExec.priority || 0,
          canRunInParallel: isSafe,
          requiresApproval: !isSafe,
        });
      }

      if (toolExecutions.length === 0) {
        return "No valid tools found for execution.";
      }

      // Sort by priority if specified
      const sortedExecutions = toolExecutions.sort((a, b) => {
        return a.priority - b.priority;
      });

      // Group tools by execution strategy
      const parallelTools = sortedExecutions.filter(
        (exec) => exec.canRunInParallel && execution_mode !== "sequential_only",
      );

      const sequentialTools = sortedExecutions.filter(
        (exec) =>
          !exec.canRunInParallel || execution_mode === "sequential_only",
      );

      const allResults: ToolExecutionResult[] = [];

      try {
        // Execute parallel tools if any and mode allows
        if (parallelTools.length > 0 && execution_mode !== "sequential_only") {
          if (this.config.enableLogging) {
            agentLogger.info(
              `[Parallel Executor] 🔄 Executing ${parallelTools.length} tools in parallel`,
            );
          }

          const parallelResults = await this.executeParallelTools(
            parallelTools.map((exec) => ({
              tool: exec.tool,
              args: exec.args,
              toolName: exec.toolName,
            })),
          );
          allResults.push(...parallelResults);
        }

        // Execute sequential tools
        if (sequentialTools.length > 0) {
          if (this.config.enableLogging) {
            agentLogger.info(
              `[Parallel Executor] 🔒 Executing ${sequentialTools.length} tools sequentially`,
            );
          }

          const sequentialResults = await this.executeSequentialTools(
            sequentialTools.map((exec) => ({
              tool: exec.tool,
              args: exec.args,
              toolName: exec.toolName,
              requiresApproval: exec.requiresApproval,
            })),
          );
          allResults.push(...sequentialResults);
        }
      } catch (error) {
        if (this.config.failFast) {
          throw error;
        }

        // Log error but continue with fallback if enabled
        agentLogger.error("[Parallel Executor] Execution error:", error);

        // If fallback is enabled and this was a parallel execution, try sequential
        if (this.config.fallbackToSequential && parallelTools.length > 0) {
          if (this.config.enableLogging) {
            agentLogger.info(
              "[Parallel Executor] 🔄 Falling back to sequential execution",
            );
          }

          const fallbackResults = await this.executeSequentialTools(
            sortedExecutions.map((exec) => ({
              tool: exec.tool,
              args: exec.args,
              toolName: exec.toolName,
              requiresApproval: exec.requiresApproval,
            })),
          );
          allResults.push(...fallbackResults);
        }
      }

      // Format and return results
      return this.formatResults(allResults, {
        totalRequested: tools_to_execute.length,
        parallelCount: parallelTools.length,
        sequentialCount: sequentialTools.length,
        executionMode: execution_mode,
      });
    } catch (error) {
      if (this.config.enableLogging) {
        agentLogger.error("[Parallel Executor] Input parsing error:", error);
      }
      return `Error parsing input: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Format execution results into a readable response
   */
  private formatResults(
    results: ToolExecutionResult[],
    metadata: {
      totalRequested: number;
      parallelCount: number;
      sequentialCount: number;
      executionMode: string;
    },
  ): string {
    const { totalRequested, parallelCount, sequentialCount, executionMode } =
      metadata;

    let output = `🔧 **Parallel Tool Execution Results**\n\n`;
    output += `📊 **Execution Summary:**\n`;
    output += `- Requested: ${totalRequested}\n`;
    output += `- Parallel: ${parallelCount}\n`;
    output += `- Sequential: ${sequentialCount}\n`;
    output += `- Mode: ${executionMode}\n`;
    output += `- Completed: ${results.length}\n\n`;

    // Group results by status
    const successful = results.filter((r) => r.status === "success");
    const failed = results.filter((r) => r.status === "error");
    const timedOut = results.filter((r) => r.status === "timeout");
    const skipped = results.filter((r) => r.status === "skipped");

    if (successful.length > 0) {
      output += `✅ **Successful Executions (${successful.length}):**\n`;
      successful.forEach((result) => {
        output += `\n**${result.toolName}** (${result.executionTime}ms):\n`;
        output += `${result.result}\n`;
      });
      output += `\n`;
    }

    if (failed.length > 0) {
      output += `❌ **Failed Executions (${failed.length}):**\n`;
      failed.forEach((result) => {
        output += `\n**${result.toolName}** (${result.executionTime}ms):\n`;
        output += `Error: ${result.error}\n`;
      });
      output += `\n`;
    }

    if (timedOut.length > 0) {
      output += `⏰ **Timed Out Executions (${timedOut.length}):**\n`;
      timedOut.forEach((result) => {
        output += `- ${result.toolName}: ${result.error}\n`;
      });
      output += `\n`;
    }

    if (skipped.length > 0) {
      output += `⚠️ **Skipped Executions (${skipped.length}):**\n`;
      skipped.forEach((result) => {
        output += `- ${result.toolName}: ${result.error}\n`;
      });
      output += `\n`;
    }

    // Add performance metrics
    if (results.length > 0) {
      const totalTime = Math.max(...results.map((r) => r.executionTime));
      const avgTime =
        results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;

      output += `⚡ **Performance:**\n`;
      output += `- Total Execution Time: ${totalTime}ms\n`;
      output += `- Average Tool Time: ${Math.round(avgTime)}ms\n`;

      if (parallelCount > 1) {
        const sequentialEstimate = results.reduce(
          (sum, r) => sum + r.executionTime,
          0,
        );
        const timeSaved = sequentialEstimate - totalTime;
        output += `- Time Saved by Parallelization: ~${Math.round(timeSaved)}ms\n`;
      }
    }

    // Append a machine-readable JSON block to assist downstream parsers (e.g., sources extractor)
    // Contains raw tool names, statuses, and JSON-parsed results when possible
    const parseIfJson = (text?: string): any => {
      if (!text || typeof text !== "string") return text;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    };

    const structured: any = {
      execution: {
        totalRequested,
        parallelCount,
        sequentialCount,
        executionMode,
      },
      results: results.map((r) => ({
        toolName: r.toolName,
        status: r.status,
        executionTime: r.executionTime,
        result: parseIfJson(r.result),
      })),
    };

    output += `\n\n<parallel_results>${JSON.stringify(structured)}</parallel_results>\n`;

    return output;
  }

  /**
   * Update available tools (useful for dynamic tool loading)
   */
  updateAvailableTools(tools: Tool[]): void {
    this.availableTools.clear();
    tools.forEach((tool) => {
      this.availableTools.set(tool.name, tool);
    });

    if (this.config.enableLogging) {
      agentLogger.info(
        `[Parallel Executor] Updated with ${tools.length} available tools`,
      );
    }
  }

  /**
   * Get execution statistics for monitoring
   */
  getExecutionStats(): {
    totalExecutions: number;
    availableTools: number;
    parallelCapable: number;
    sensitiveTools: number;
  } {
    const tools = Array.from(this.availableTools.keys());
    const parallelCapable = tools.filter((name) => this.isSafeTool(name));
    const sensitiveTools = tools.filter((name) => !this.isSafeTool(name));

    return {
      totalExecutions: 0, // This would need to be tracked separately
      availableTools: tools.length,
      parallelCapable: parallelCapable.length,
      sensitiveTools: sensitiveTools.length,
    };
  }

  /**
   * Preview what would happen with given tool names
   */
  previewExecutionPlan(toolNames: string[]): {
    plan: string;
    parallelTools: string[];
    sequentialTools: string[];
    sensitiveTools: string[];
  } {
    const parallelTools: string[] = [];
    const sequentialTools: string[] = [];
    const sensitiveTools: string[] = [];

    toolNames.forEach((toolName) => {
      const tool = this.availableTools.get(toolName);
      if (tool) {
        if (this.isSafeTool(toolName)) {
          parallelTools.push(toolName);
        } else {
          sensitiveTools.push(toolName);
          sequentialTools.push(toolName);
        }
      }
    });

    const plan = `
Execution Plan Preview:
🚀 Parallel (${parallelTools.length}): ${parallelTools.join(", ") || "None"}
🔒 Sequential (${sequentialTools.length}): ${sequentialTools.join(", ") || "None"}
⚠️ Sensitive (${sensitiveTools.length}): ${sensitiveTools.join(", ") || "None"}
`;

    return { plan, parallelTools, sequentialTools, sensitiveTools };
  }
}

/**
 * Factory function to create a parallel tool executor
 */
export function createParallelToolExecutor(
  tools: Tool[],
  config: Partial<ParallelExecutionConfig> = {},
): ParallelToolExecutor {
  return new ParallelToolExecutor(tools, config);
}

/**
 * Helper to check if parallel execution would be beneficial
 */
export function shouldUseParallelExecution(
  toolNames: string[],
  availableTools: Tool[],
): boolean {
  if (toolNames.length < 2) {
    return false; // No benefit for single tool
  }

  // Create a temporary executor to check tool safety
  const executor = new ParallelToolExecutor(availableTools);
  const parallelCapable = toolNames.filter((name) =>
    executor["isSafeTool"](name),
  );

  return parallelCapable.length >= 2; // At least 2 tools can run in parallel
}
