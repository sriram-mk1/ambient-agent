import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage
} from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { agentManager } from "./manager";
import { CompiledWorkflow } from "./workflow";
import { agentLogger } from "./logger";
import { AgentExecutionConfig } from "../agent-utils";

/**
 * Message history format from chat API
 */
export interface MessageHistory {
  role: string;
  content: string;
}

/**
 * Resume data for human-in-the-loop interactions
 */
export interface ResumeData {
  // action for tool approvals
  type: "approve" | "reject" | "edit" | "human_input";
  toolCallId?: string;
  data?: any;
  args?: any;
}

/**
 * Conversation request parameters
 */
export interface ConversationRequest {
  message: string;
  history: MessageHistory[];
  userId: string;
  threadId?: string;
  resumeData?: ResumeData;
  config?: Partial<AgentExecutionConfig>;
  // Optional: override selected prompt content for this request
  selectedPromptOverride?: string;
}

/**
 * Conversation response containing workflow and execution promise
 */
export interface ConversationResponse {
  workflowPromise: Promise<any>;
  threadId: string;
  tools: any[];
  isResume: boolean;
}

/**
 * Message validation result
 */
export interface ValidationResult {
  isValid: boolean;
  messages?: BaseMessage[];
  error?: string;
}

/**
 * Conversation handler for orchestrating chat workflows
 */
export class ConversationHandler {
  private agentManager = agentManager;

  constructor() {}

  /**
   * Start or resume a conversation
   */
  async handleConversation(
    request: ConversationRequest,
  ): Promise<ConversationResponse> {
    // Set up conversation context for logging
    const conversationId = request.threadId || `conv_${Date.now()}`;
    const messageNumber = request.history?.length + 1 || 1;

    agentLogger.startConversation(
      {
        conversationId,
        messageNumber,
        userMessage: request.message || "Resume workflow",
        userId: request.userId,
      },
      !!request.resumeData,
    );

    // Get or create agent workflow (enhanced or regular based on request)
    const { workflow, tools, sessionId } = await this.agentManager.getOrCreateAgent(request.userId, request.config);

    // Generate thread ID
    const threadId =
      request.threadId || `thread_${request.userId}_${Date.now()}`;

    // Configuration for the workflow
    const config = {
      configurable: { thread_id: threadId },
    };

    let workflowPromise: Promise<any>;
    // Get selected prompt once per request
    let selectedPrompt: string | undefined;
    try {
      if (
        request.selectedPromptOverride &&
        request.selectedPromptOverride.trim()
      ) {
        selectedPrompt = request.selectedPromptOverride;
      } else {
        selectedPrompt = await this.agentManager.getSelectedPromptContent(
          request.userId,
        );
      }
    } catch {}
    if (selectedPrompt && selectedPrompt.trim()) {
      const preview =
        selectedPrompt.length > 300
          ? `${selectedPrompt.slice(0, 300)}…`
          : selectedPrompt;
      agentLogger.info(
        `[Conversation] Injecting selected prompt into system message (length=${selectedPrompt.length})`,
      );
      try {
        // Log using assistant channel to avoid type constraints while preserving visibility
        agentLogger.fullMessage(
          "assistant",
          `Custom Rules (User):\n${preview}`,
        );
      } catch {}
    }

    if (request.resumeData) {
      agentLogger.humanApproval(
        "Tool",
        request.resumeData.toolCallId || "unknown",
      );
      workflowPromise = this.resumeWorkflow(
        workflow,
        request.resumeData,
        config,
      );
    } else {
      agentLogger.fullMessage("user", request.message);
      workflowPromise = this.startNewConversation(
        workflow,
        request.message,
        request.history,
        tools,
        config,
        selectedPrompt,
      );
    }

    return {
      workflowPromise,
      threadId,
      tools,
      isResume: !!request.resumeData,
    };
  }

  /**
   * Resume workflow from human-in-the-loop interrupt
   */
  private resumeWorkflow(
    workflow: any, // CompiledWorkflow type is now generic
    resumeData: ResumeData,
    config: any,
  ): Promise<any> {
    // Format resume data according to LangGraph Command patterns
    let resumeValue;

    if (resumeData.type === "approve") {
      resumeValue = { type: "approve", args: resumeData.args };
      agentLogger.toolNode("Tool", "approved");
    } else if (resumeData.type === "edit") {
      resumeValue = {
        type: "approve",
        args: resumeData.args || resumeData.data,
      };
      agentLogger.toolNode("Tool", "approved");
    } else if (resumeData.type === "human_input") {
      // Pass back the value for the human_input tool to consume
      resumeValue = {
        type: "human_input",
        value: resumeData.args ?? resumeData.data,
      };
      agentLogger.humanApproval("HumanInput", "provided");
    } else {
      resumeValue = { type: "reject" };
      agentLogger.toolNode("Tool", "rejected");
    }

    // Resume the workflow using Command pattern
    const streamPromise = workflow.stream(
      new Command({ resume: resumeValue }),
      config,
    );

    streamPromise.catch((error: any) => {
      agentLogger.error("Stream promise rejected", error);
    });

    return streamPromise;
  }

  /**
   * Start a new conversation
   */
  private async startNewConversation(
    workflow: any, // CompiledWorkflow type is now generic
    message: string,
    history: MessageHistory[],
    tools: any[],
    config: any,
    selectedPrompt?: string,
  ): Promise<any> {
    // Prepare and validate messages
    const validation = this.validateAndPrepareMessages(
      message,
      history,
      tools,
      selectedPrompt,
    );

    if (!validation.isValid) {
      agentLogger.error("Message validation failed", validation.error);
      throw new Error(`Message validation failed: ${validation.error}`);
    }

    // Final validation: ensure system message is absolutely first before starting workflow
    const finalMessages = validation.messages;
    if (finalMessages && finalMessages.length > 0) {
      const firstType = finalMessages[0]?._getType?.();
      if (firstType !== "system") {
        agentLogger.error(
          `[Conversation] System message validation failed - first message type: ${firstType}`,
        );
        throw new Error(
          "Message validation failed: System message must be first",
        );
      }
    }

    // Start workflow with initial state
    const initialState = {
      messages: finalMessages || [],
      input: message,
      plan: [],
      past_steps: [],
      response: null,
    };
    return workflow.stream(initialState, config);
  }

  /**
   * Validate and prepare messages for the workflow
   */
  validateAndPrepareMessages(
    userMessage: string,
    history: MessageHistory[],
    tools: any[],
    selectedPrompt?: string,
  ): ValidationResult {
    let messages: any[] = [];
    try {
      // Prepare messages using agent manager
      messages = this.agentManager.prepareMessages(
        userMessage,
        history,
        tools,
        selectedPrompt,
      );

      // Hard guarantee: system message must be first
      if (Array.isArray(messages) && messages.length > 0) {
        const firstType =
          typeof messages[0]?._getType === "function"
            ? messages[0]._getType()
            : undefined;
        if (firstType !== "system") {
          const sysIndex = messages.findIndex(
            (m: any) =>
              typeof m?._getType === "function" && m._getType() === "system",
          );
          if (sysIndex > 0) {
            const [sysMsg] = (messages as any[]).splice(sysIndex, 1);
            (messages as any[]).unshift(sysMsg);
          } else if (sysIndex === -1) {
            // No system message found; inject a minimal one
            (messages as any[]).unshift(
              new SystemMessage("You are a helpful AI assistant."),
            );
          }
        }
      }

      // Validate messages array
      if (!Array.isArray(messages) || messages.length === 0) {
        return {
          isValid: false,
          error: "Invalid or empty messages array",
        };
      }

      // Validate each message has required properties
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg || typeof msg !== "object") {
          return {
            isValid: false,
            error: `Message at index ${i} is not an object`,
          };
        }

        if (!msg._getType || typeof msg._getType !== "function") {
          return {
            isValid: false,
            error: `Message at index ${i} missing _getType method`,
          };
        }

        if (!msg.content && msg.content !== "") {
          return {
            isValid: false,
            error: `Message at index ${i} missing content property`,
          };
        }

        // Check message type is valid
        const messageType = msg._getType();
        const validTypes = ["human", "ai", "system", "tool"];
        if (!validTypes.includes(messageType)) {
          return {
            isValid: false,
            error: `Message at index ${i} has invalid type: ${messageType}`,
          };
        }
      }

      return {
        isValid: true,
        messages,
      };
    } catch (error) {
      agentLogger.error("Message validation error", error);

      // Special handling for system message ordering errors
      const err = error as any;
      if (err instanceof Error && err.message.includes("System message")) {
        agentLogger.error(
          "[Conversation] System message ordering issue detected",
          {
            messageCount: Array.isArray(messages) ? messages.length : 0,
            firstMessageType:
              Array.isArray(messages) && messages[0]?._getType
                ? messages[0]._getType()
                : "unknown",
          },
        );
      }

      return {
        isValid: false,
        error:
          err instanceof Error ? err.message : "Unknown validation error",
      };
    }
  }

  /**
   * Create a no-tools response for unauthenticated users
   */
  createNoToolsResponse(): string {
    return "🔗 **No Connected Apps**\n\nI don't have access to any Google apps yet. Please visit the [Connections page](/dashboard/connections) to connect your Google account.";
  }

  /**
   * Get conversation statistics
   */
  getStats() {
    return {
      agentCacheStats: this.agentManager.getCacheStats(),
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Default conversation handler instance
 */
export const conversationHandler = new ConversationHandler();
