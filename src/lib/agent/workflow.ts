import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, SystemMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import {
  addSensitiveToolApproval,
  addSensitiveToolApprovalSafe,
  validateParallelExecution,
} from "../human-in-the-loop";
import { agentLogger } from "./logger";
import {
  createParallelToolExecutor,
  shouldUseParallelExecution,
} from "./parallel-tool-executor";
// Tool classifier removed - using prompt-based approach
import { getSystemPrompt } from "./system-prompt-parallel";
import { validateAndCorrectResponse } from "./response-validator";
import { operationCache } from "./operation-cache";
import { AgentState, Task } from "./state"; // Import new state types
import { v4 as uuidv4 } from 'uuid'; // For generating unique task IDs

// Global streaming controller - allows emitting tokens during execution
let streamController: ReadableStreamDefaultController | null = null;

export function setStreamController(
  controller: ReadableStreamDefaultController,
) {
  streamController = controller;
}

function emitToken(data: any) {
  if (streamController) {
    const encoder = new TextEncoder();
    // Format as proper SSE event
    let eventType = data.type || "content";
    let eventData = data.content ? { content: data.content } : data;
    
    // Remove type from data if it exists
    if (eventData.type) {
      delete eventData.type;
    }
    
    const message = `event: ${eventType}\ndata: ${JSON.stringify(eventData)}\n\n`;
    streamController.enqueue(encoder.encode(message));
  }
}

// ================================================================================================
// 🤖 NEW AGENTIC NODES: PLANNER AND REFLECTOR
// ================================================================================================

/**
 * Planner node - creates a plan to solve the user's request and updates the task list.
 * This runs only once at the beginning of the workflow.
 */
async function planStep(state: AgentState): Promise<Partial<AgentState>> {
  // The planner runs only if there are no existing tasks (initial run).
  if (state.tasks && state.tasks.length > 0) {
    agentLogger.info("[Workflow] Skipping planner step, tasks already exist.");
    return {};
  }

  const userMessage = state.messages[state.messages.length - 1].content;
  const planPrompt = `Based on the user's request, create a detailed, step-by-step plan to achieve the goal. The plan should be a numbered list of high-level tasks. Each task should be concise and actionable. Respond with a JSON object with a single key "tasks" that contains a list of strings.
User's request: "${userMessage}"`;

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0.0,
  });

  try {
    emitToken({ type: "tool_start", name: "planner", message: "Agent is planning..." });
    const response = await model.invoke(planPrompt);
    let planContent = response.content as string;

    // Clean the response to remove markdown and other formatting
    if (planContent.startsWith("```json")) {
      planContent = planContent.slice(7, -3).trim();
    }
    const planJson = JSON.parse(planContent);

    const newTasks: Task[] = planJson.tasks.map((task: string) => ({
      id: uuidv4(),
      description: task,
      status: "incomplete",
    }));

    const toolMessage = new ToolMessage({
      tool_call_id: "planner",
      name: "planner",
      content: planContent,
    });

    agentLogger.info(`[Workflow] Generated plan: ${planContent}`);
    emitToken({ type: "tool_result", name: "planner", result: { tasks: newTasks } });

    return { messages: [toolMessage], tasks: newTasks };
  } catch (error) {
    agentLogger.error(`[Workflow] Error in planner step: ${error}`);
    const errorMessage = new AIMessage({ content: "I encountered an error while creating a plan. I will proceed without one." });
    emitToken({ type: "error", content: "Error during planning. Proceeding without a plan." });
    return { messages: [errorMessage], tasks: [] };
  }
}

/**
 * Reflection node - reviews the last step, updates the task list, and decides what to do next.
 */
async function reflectionStep(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const reflectionPrompt = `You are a reflector agent. Your purpose is to analyze the work done so far and decide if the agent is on the right track.
Review the conversation history, especially the last tool execution result.
- Was the last action successful?
- Is the agent closer to achieving the user's goal?
- Does the current plan need to be updated (e.g., mark a task complete, add a subtask, re-prioritize)?
- What is the next step? Should the agent continue, or is the task complete?

If the task is complete, respond with "The task is complete.".
If a task was completed, respond with "Task completed: [Task Description]".
If a new subtask needs to be added, respond with "Add subtask: [Subtask Description]".
Otherwise, provide a short reflection and state the next action.

History:
${JSON.stringify(state.messages.slice(-5), null, 2)}
Current Tasks:
${JSON.stringify(state.tasks, null, 2)}`;

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0.0,
  });

  try {
    emitToken({ type: "tool_start", name: "reflector", message: "Agent is reflecting..." });
    const response = await model.invoke(reflectionPrompt);
    const reflectionContent = response.content as string;
    
    const toolMessage = new ToolMessage({
      tool_call_id: "reflector",
      name: "reflector",
      content: reflectionContent,
    });

    agentLogger.info(`[Workflow] Reflection: ${reflectionContent}`);
    emitToken({ type: "tool_result", name: "reflector", result: { reflection: reflectionContent } });

    const updatedTasks = [...state.tasks];
    let taskUpdateOccurred = false;

    if (reflectionContent.toLowerCase().includes("task completed:")) {
      const completedTaskDesc = reflectionContent.replace(/task completed:\s*/i, '').trim();
      const taskIndex = updatedTasks.findIndex(t => t.description.toLowerCase().includes(completedTaskDesc.toLowerCase()) && t.status === "incomplete");
      if (taskIndex !== -1) {
        updatedTasks[taskIndex].status = "completed";
        taskUpdateOccurred = true;
        emitToken({ type: "task_update", taskId: updatedTasks[taskIndex].id, status: "completed" });
        agentLogger.info(`[Workflow] Marked task as completed: ${updatedTasks[taskIndex].description}`);
      }
    } else if (reflectionContent.toLowerCase().includes("add subtask:")) {
      const newSubtaskDesc = reflectionContent.replace(/add subtask:\s*/i, '').trim();
      const newSubtask: Task = { id: uuidv4(), description: newSubtaskDesc, status: "incomplete" };
      updatedTasks.push(newSubtask);
      taskUpdateOccurred = true;
      emitToken({ type: "task_add", task: newSubtask });
      agentLogger.info(`[Workflow] Added new subtask: ${newSubtaskDesc}`);
    }

    return { messages: [toolMessage], tasks: taskUpdateOccurred ? updatedTasks : state.tasks };
  } catch (error) {
    agentLogger.error(`[Workflow] Error in reflection step: ${error}`);
    const errorMessage = new AIMessage({ content: "I encountered an error during reflection. I will continue with the next step." });
    emitToken({ type: "error", content: "Error during reflection. Continuing." });
    return { messages: [errorMessage] };
  }
}

// ================================================================================================
// 🏗️ LANGGRAPH WORKFLOW - Following Official Pattern
// ================================================================================================

/**
 * Configuration for agent workflow
 */
export interface AgentWorkflowConfig {
  enableHumanApproval?: boolean;
  enableParallelExecution?: boolean;
  maxConcurrency?: number;
  parallelTimeout?: number;
}

/**
 * Creates the LangGraph workflow following the official pattern with human-in-the-loop support
 * and parallel tool execution capabilities
 */
export async function createAgentWorkflow(
  tools: any[],
  config: AgentWorkflowConfig = {},
) {
  const { agentManager } = await import("./manager");
  const {
    enableHumanApproval = true,
    enableParallelExecution = true,
    maxConcurrency = 5,
    parallelTimeout = 30000,
  } = config;

  // Add human approval to sensitive tools if enabled (safe version to prevent double wrapping)
  const processedTools = enableHumanApproval
    ? addSensitiveToolApprovalSafe(tools)
    : tools;

  // Deduplicate tools by name to prevent "Duplicate function declaration" errors
  const toolMap = new Map<string, any>();
  const duplicates: string[] = [];

  agentLogger.info(
    `[Workflow] Processing ${processedTools.length} tools for deduplication`,
  );

  processedTools.forEach((tool) => {
    if (!toolMap.has(tool.name)) {
      toolMap.set(tool.name, tool);
    } else {
      duplicates.push(tool.name);
      agentLogger.warn(
        `Duplicate tool found: ${tool.name}, keeping first instance`,
      );
    }
  });

  if (duplicates.length > 0) {
    agentLogger.info(
      `[Workflow] Deduplicated ${duplicates.length} tools: ${duplicates.join(", ")}`,
    );
  } else {
    agentLogger.info(`[Workflow] No duplicate tools found`);
  }

  let finalTools = Array.from(toolMap.values());

  // Add parallel tool executor if enabled and not already present
  if (enableParallelExecution) {
    const hasParallelExecutor = finalTools.some(
      (tool) => tool.name === "parallel_tool_executor",
    );

    if (!hasParallelExecutor) {
      const parallelExecutor = createParallelToolExecutor(finalTools, {
        maxConcurrency,
        toolTimeout: parallelTimeout,
        enableLogging: true,
      });

      finalTools = [...finalTools, parallelExecutor];

      agentLogger.info(
        `[Workflow] Added parallel_tool_executor with max concurrency: ${maxConcurrency}`,
      );
    } else {
      agentLogger.info(
        `[Workflow] parallel_tool_executor already exists, skipping duplicate`,
      );
    }
  }

  agentLogger.info(
    `[Workflow] Final tool count: ${finalTools.length} (deduplicated from ${processedTools.length})`,
  );

  // Helper: filter out tools with schemas incompatible with Gemini tool format
  function isGeminiCompatibleSchema(schema: any): boolean {
    if (!schema || typeof schema !== "object") return true;

    // Disallow tuple validation (items as an array) and multi-dimensional arrays
    if (Array.isArray((schema as any).items)) {
      return false;
    }

    // Disallow arrays of arrays which Gemini does not support well in tool params
    if (
      (schema as any).type === "array" &&
      (schema as any).items &&
      typeof (schema as any).items === "object" &&
      (schema as any).items.type === "array"
    ) {
      return false;
    }

    // Recurse into nested schemas
    const nestedKeys = [
      "items",
      "properties",
      "anyOf",
      "oneOf",
      "allOf",
      "definitions",
      "patternProperties",
    ];

    for (const key of nestedKeys) {
      const value = (schema as any)[key];
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (!isGeminiCompatibleSchema(v)) return false;
        }
      } else if (key === "properties" && typeof value === "object") {
        for (const propSchema of Object.values(value)) {
          if (!isGeminiCompatibleSchema(propSchema)) return false;
        }
      } else if (typeof value === "object") {
        if (!isGeminiCompatibleSchema(value)) return false;
      }
    }

    return true;
  }

  function filterToolsForGemini(inputTools: any[]): any[] {
    const compatible: any[] = [];
    const excluded: string[] = [];
    for (const t of inputTools) {
      const schema = (t as any).schema;
      if (!schema || isGeminiCompatibleSchema(schema)) {
        compatible.push(t);
      } else {
        excluded.push(t.name || "<unnamed_tool>");
      }
    }
    if (excluded.length > 0) {
      agentLogger.warn(
        `[Workflow] Excluding ${excluded.length} tool(s) incompatible with Gemini schemas: ${excluded.join(", ")}`,
      );
    }
    return compatible;
  }

  // Reduce toolset to Gemini-compatible subset for binding
  const geminiCompatibleTools = filterToolsForGemini(finalTools);

  // Create model with tools bound directly and enhanced system prompt
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0.9,
    maxOutputTokens: 100000,
  });

  // Set system prompt with parallel execution guidance
  const systemPrompt = getSystemPrompt();

  // Use cached content if available

  // Bind tools to model - this is the key fix!
  const modelWithTools =
    geminiCompatibleTools.length > 0
      ? model.bindTools(geminiCompatibleTools)
      : model;

  // Create enhanced tool node with parallel execution support
  const toolNode = createEnhancedToolNode(finalTools, {
    enableParallelExecution,
    maxConcurrency,
  });

  /**
   * Validate and fix message ordering to ensure system message is first
   */
  function validateMessageOrder(messages: BaseMessage[]): BaseMessage[] {
    // Defensive copy to avoid mutating original array
    const messagesCopy = Array.isArray(messages) ? [...messages] : [];

    if (messagesCopy.length === 0) {
      // Add system prompt if no messages exist
      return [new SystemMessage(systemPrompt)];
    }

    // Filter out any invalid messages
    const validMessages = messagesCopy.filter(
      (m) => m && typeof m === "object" && typeof m._getType === "function",
    );

    // Find system message
    const systemMessageIndex = validMessages.findIndex(
      (m) => m._getType() === "system",
    );

    // If no system message, add one at the beginning
    if (systemMessageIndex === -1) {
      return [new SystemMessage(systemPrompt), ...validMessages];
    }

    // If system message exists but not first, move it to first position
    if (systemMessageIndex > 0) {
      const systemMessage = validMessages[systemMessageIndex];
      const otherMessages = validMessages.filter(
        (_, index) => index !== systemMessageIndex,
      );
      return [systemMessage, ...otherMessages];
    }

    // System message is already first
    return validMessages;
  }

  /**
   * Agent node - calls the model with tools already bound and streams tokens
   */
  async function callModel(state: AgentState): Promise<Partial<AgentState>> {
    // Validate and fix message ordering with comprehensive checks
    let validatedMessages = state.messages || [];

    // Ensure we have a valid messages array
    if (!Array.isArray(validatedMessages)) {
      validatedMessages = [];
    }

    // Apply strict message validation
    validatedMessages = validateMessageOrder(validatedMessages);

    // Double-check: ensure system message is absolutely first
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

    const stateWithValidatedMessages = {
      ...state,
      messages: validatedMessages,
    };

    // Check operation cache for model response
    const cacheKey = operationCache.generateKey('model_response', {
      messages: stateWithValidatedMessages.messages,
      model: 'gemini-2.5-flash',
      temperature: 0.9
    });

    const cachedResponse = await operationCache.get('model_response', {
      messages: stateWithValidatedMessages.messages,
      model: 'gemini-2.5-flash',
      temperature: 0.9
    });
    if (cachedResponse) {
      agentLogger.info('[Workflow] Using cached model response');
      emitToken({ type: "cache_hit", message: "Using cached response" });
      return { messages: [cachedResponse] };
    }

    // Stream the model response token by token
    const stream = await modelWithTools.stream(
      stateWithValidatedMessages.messages,
    );
    let fullContent = "";
    // eslint-disable-next-line prefer-const
    let toolCalls: any[] = [];
    let response: any = null;
    let chunkCount = 0;

    // Stream tokens as they come and build the complete response
    for await (const chunk of stream) {
      chunkCount++;

      if (chunk.content) {
        fullContent += chunk.content;
        emitToken({ type: "content", content: chunk.content });
      }
      if (chunk.tool_calls) {
        toolCalls.push(...chunk.tool_calls);

        // Check if parallel execution would be beneficial
        if (
          enableParallelExecution &&
          shouldUseParallelExecution(
            chunk.tool_calls.map((tc) => tc.name),
            finalTools,
          )
        ) {
          emitToken({
            type: "parallel_execution_detected",
            message: `Detected ${chunk.tool_calls.length} tools - evaluating for parallel execution`,
          });
        }

        // Emit tool calls immediately
        for (const toolCall of chunk.tool_calls) {
          // Simple pattern-based safety check
          const isSafeTool =
            !/(^send_|^delete_|^create_|^update_|^modify_|^remove_|^edit_|^write_)/.test(
              toolCall.name,
            );

          emitToken({
            type: "tool_start",
            name: toolCall.name,
            message: `Using ${toolCall.name}...`,
            canRunInParallel: isSafeTool,
            requiresApproval: !isSafeTool,
          });
        }
      }
      response = chunk; // Keep the latest chunk for metadata
    }

  // Validate and auto-correct email/document formatting
    const correctedContent = validateAndCorrectResponse(fullContent);

    // Create a proper AIMessage instance to avoid coercion issues
    const finalResponse = new AIMessage({
      content: correctedContent,
      tool_calls: toolCalls,
      response_metadata: response.response_metadata || {},
      usage_metadata: response.usage_metadata,
    });

    // Cache the model response
    await operationCache.set('model_response', {
      messages: stateWithValidatedMessages.messages,
      model: 'gemini-2.5-flash',
      temperature: 0.9
    }, finalResponse, 15 * 60 * 1000); // 15 minutes

    // Add parallel execution metadata to tool calls
    if (toolCalls.length > 0) {
      toolCalls.forEach((toolCall: any) => {
        const tool = finalTools.find((t) => t.name === toolCall.name);
        if (tool) {
          // Simple pattern-based safety check
          const isSafeTool =
            !/(^send_|^delete_|^create_|^update_|^modify_|^remove_|^edit_|^write_)/.test(
              tool.name,
            );
          toolCall.canRunInParallel = isSafeTool;
          toolCall.requiresApproval = !isSafeTool;
        }
      });
    }

    // Log agent activity
    const hasContent = !!fullContent && fullContent.trim() !== "";
    const hasToolCalls = toolCalls.length > 0;
    const toolNames = toolCalls.map((tc: any) => tc.name);

    agentLogger.agentNode(
      state.messages.length,
      hasContent,
      hasToolCalls,
      toolNames,
    );

    if (hasContent) {
      agentLogger.fullMessage("assistant", fullContent);
    }

    return { messages: [finalResponse] };
  }

  /**
   * Conditional edge function - decides whether to call tools or end
   */
  function shouldContinue(state: AgentState) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (
      lastMessage?._getType?.() === "ai" &&
      (lastMessage as AIMessage)?.tool_calls?.length
    ) {
      const toolCount = (lastMessage as AIMessage).tool_calls?.length || 0;
      agentLogger.decision("tools", toolCount);
      return "tools";
    }

    agentLogger.decision("end");
    return END;
  }

  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
      tasks: {
        value: (x: Task[], y: Task[]) => y,
        default: () => [],
      },
    },
  })
    .addNode("planner", planStep)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("reflector", reflectionStep)
    .addEdge(START, "planner")
    .addEdge("planner", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "reflector")
    .addConditionalEdges("reflector", (state: AgentState) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const content = (lastMessage?.content?.toString() || "").toLowerCase();
      
      if (content.includes("task is complete")) {
        agentLogger.decision("end");
        return END;
      }
      
      agentLogger.decision("tools");
      return "agent";
    });

  const checkpointer = new MemorySaver();
  const app = workflow.compile({ checkpointer });

  return app;
}

/**
 * Custom streaming function that enables token-level streaming
 */
export async function* streamWorkflowWithTokens(
  workflow: any,
  initialState: any,
) {
  for await (const chunk of await workflow.stream(initialState, {
    streamMode: "values",
  })) {
    yield chunk;
  }
}

/**
 * Enhanced Tool Node with parallel execution support
 */
function createEnhancedToolNode(
  tools: any[],
  config: { enableParallelExecution: boolean; maxConcurrency: number },
) {
  const standardToolNode = new ToolNode(tools);

  if (!config.enableParallelExecution) {
    return standardToolNode;
  }

  // Return enhanced tool node that can handle parallel execution detection
  return async (state: any) => {
    const beforeCount = Array.isArray(state?.messages)
      ? state.messages.length
      : 0;
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage?.tool_calls?.length > 1) {
      // Multiple tool calls detected - check if any can run in parallel
      const toolCalls = lastMessage.tool_calls;
      const parallelValidation = validateParallelExecution(
        toolCalls
          .map((tc: any) => tools.find((t) => t.name === tc.name))
          .filter(Boolean),
      );

      if (parallelValidation.canExecuteInParallel) {
        agentLogger.info(
          `[Enhanced Tool Node] 🚀 Parallel execution possible for ${toolCalls.length} tools`,
        );

        emitToken({
          type: "parallel_execution_start",
          message: `Starting parallel execution of ${toolCalls.length} tools`,
          toolNames: toolCalls.map((tc: any) => tc.name),
        });
      } else {
        agentLogger.info(
          `[Enhanced Tool Node] 🔒 Sequential execution required: ${parallelValidation.reason}`,
        );

        emitToken({
          type: "sequential_execution_required",
          message: parallelValidation.reason,
          blockedTools: parallelValidation.blockedTools,
        });
      }
    }

    // Delegate to standard tool node
    const resultState = await standardToolNode.invoke(state);

    try {
      const afterMsgs = Array.isArray(resultState?.messages)
        ? resultState.messages.slice(beforeCount)
        : [];
      for (const msg of afterMsgs) {
        const ctor = (msg && msg.constructor && msg.constructor.name) || "";
        const type = (msg && msg._getType && msg._getType()) || "";
        const isToolMsg = ctor === "ToolMessage" || type === "tool";
        if (!isToolMsg) continue;
        const name = (msg as any)?.name || (msg as any)?.toolName || "tool";
        let result: any = (msg as any)?.content;
        if (typeof result !== "string") {
          try {
            result = JSON.stringify(result);
          } catch {
            result = String(result);
          }
        }
        emitToken({
          type: "tool_result",
          name,
          message: `${name} completed`,
          result,
        });
      }
    } catch (e) {
      agentLogger.warn(
        `[Enhanced Tool Node] Failed to emit tool_result events: ${String(e)}`,
      );
    }

    return resultState;
  };
}

/**
 * Type for the compiled workflow
 */
export type CompiledWorkflow = Awaited<ReturnType<typeof createAgentWorkflow>>;

/**
 * Enhanced workflow configuration type
 */
export type WorkflowConfig = AgentWorkflowConfig;
