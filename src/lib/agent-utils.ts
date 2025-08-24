import {
  AIMessage,
  ToolMessage,
  HumanMessage,
  BaseMessage,
} from "@langchain/core/messages";

export interface AgentExecutionConfig {
  maxIterations: number;
  maxToolCalls: number;
  streamToolCalls: boolean;
  streamToolResults: boolean;
  verboseLogging: boolean;
  enableParallelExecution: boolean;
  maxConcurrency: number;
  parallelTimeout: number;
  fallbackToSequential: boolean;
}

export interface AgentExecutionStats {
  iterationCount: number;
  toolCallCount: number;
  startTime: number;
  endTime?: number;
  isComplete: boolean;
  terminationReason?: "natural" | "max_iterations" | "max_tools" | "error";
}

export interface StreamChunk {
  type:
    | "ai_message"
    | "tool_call"
    | "tool_result"
    | "thinking"
    | "error"
    | "complete";
  content: string;
  metadata?: {
    toolName?: string;
    toolArgs?: any;
    iterationCount?: number;
    toolCallCount?: number;
  };
}

export class AgentExecutionManager {
  private config: AgentExecutionConfig;
  private stats: AgentExecutionStats;

  constructor(config: Partial<AgentExecutionConfig> = {}) {
    this.config = {
      maxIterations: 50,
      maxToolCalls: 100,
      streamToolCalls: true,
      streamToolResults: true,
      verboseLogging: true,
      enableParallelExecution: true,
      maxConcurrency: 10,
      parallelTimeout: 120000,
      fallbackToSequential: true,
      ...config,
    };

    this.stats = {
      iterationCount: 0,
      toolCallCount: 0,
      startTime: Date.now(),
      isComplete: false,
    };
  }

  startExecution(): void {
    this.stats.startTime = Date.now();
    this.stats.iterationCount = 0;
    this.stats.toolCallCount = 0;
    this.stats.isComplete = false;

    if (this.config.verboseLogging) {
      console.log("🚀 Starting agent execution with config:", this.config);
    }
  }

  incrementIteration(): boolean {
    this.stats.iterationCount++;

    if (this.stats.iterationCount > this.config.maxIterations) {
      this.completeExecution("max_iterations");
      return false;
    }

    if (this.config.verboseLogging) {
      console.log(`📍 Agent iteration ${this.stats.iterationCount}`);
    }

    return true;
  }

  incrementToolCalls(count: number = 1): boolean {
    this.stats.toolCallCount += count;

    if (this.stats.toolCallCount > this.config.maxToolCalls) {
      this.completeExecution("max_tools");
      return false;
    }

    if (this.config.verboseLogging) {
      console.log(
        `🛠️ Tool calls: ${this.stats.toolCallCount}/${this.config.maxToolCalls}`,
      );
    }

    return true;
  }

  completeExecution(
    reason: AgentExecutionStats["terminationReason"] = "natural",
  ): void {
    this.stats.endTime = Date.now();
    this.stats.isComplete = true;
    this.stats.terminationReason = reason;

    if (this.config.verboseLogging) {
      const duration = this.stats.endTime - this.stats.startTime;
      console.log("✅ Agent execution completed:", {
        duration: `${duration}ms`,
        iterations: this.stats.iterationCount,
        toolCalls: this.stats.toolCallCount,
        reason: reason,
      });
    }
  }

  getStats(): AgentExecutionStats {
    return { ...this.stats };
  }

  shouldContinue(): boolean {
    return (
      !this.stats.isComplete &&
      this.stats.iterationCount < this.config.maxIterations &&
      this.stats.toolCallCount < this.config.maxToolCalls
    );
  }
}

export class MessageFormatter {
  static formatStreamChunk(chunk: StreamChunk): string {
    switch (chunk.type) {
      case "ai_message":
        return chunk.content;

      case "tool_call":
        if (chunk.metadata?.toolName) {
          return `\n\n🛠️ *Calling ${chunk.metadata.toolName}...*\n`;
        }
        return "\n\n🛠️ *Calling tool...*\n";

      case "tool_result":
        if (chunk.metadata?.toolName) {
          return `✅ *${chunk.metadata.toolName} completed*\n`;
        }
        return "✅ *Tool completed*\n";

      case "thinking":
        return `\n💭 *${chunk.content}*\n`;

      case "error":
        return `\n❌ *Error: ${chunk.content}*\n`;

      case "complete":
        return "\n\n*[Task completed]*";

      default:
        return chunk.content;
    }
  }

  static createStreamChunk(
    type: StreamChunk["type"],
    content: string,
    metadata?: StreamChunk["metadata"],
  ): StreamChunk {
    return { type, content, metadata };
  }

  static formatToolCall(toolCall: any): StreamChunk {
    return this.createStreamChunk("tool_call", "", {
      toolName: toolCall.name,
      toolArgs: toolCall.args,
    });
  }

  static formatToolResult(
    toolMessage: ToolMessage,
    truncateLength: number = 500,
  ): StreamChunk {
    let content = "";
    if (typeof toolMessage.content === "string") {
      content =
        toolMessage.content.length > truncateLength
          ? toolMessage.content.substring(0, truncateLength) + "..."
          : toolMessage.content;
    } else {
      content = JSON.stringify(toolMessage.content).substring(
        0,
        truncateLength,
      );
    }

    return this.createStreamChunk("tool_result", content, {
      toolName: toolMessage.name,
    });
  }

  static formatAIMessage(message: AIMessage): StreamChunk {
    return this.createStreamChunk("ai_message", message.content as string);
  }
}

export class MessageProcessor {
  static processChunkMessages(
    chunk: any,
    executionManager: AgentExecutionManager,
  ): StreamChunk[] {
    const streamChunks: StreamChunk[] = [];

    if (!chunk.messages) {
      return streamChunks;
    }

    for (const message of chunk.messages) {
      const messageType = message.constructor.name;

      if (messageType === "AIMessage") {
        // Handle AI response
        if (message.content && typeof message.content === "string") {
          streamChunks.push(MessageFormatter.formatAIMessage(message));
        }

        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          if (!executionManager.incrementToolCalls(message.tool_calls.length)) {
            streamChunks.push(
              MessageFormatter.createStreamChunk(
                "error",
                "Maximum tool calls reached",
              ),
            );
            break;
          }

          for (const toolCall of message.tool_calls) {
            streamChunks.push(MessageFormatter.formatToolCall(toolCall));
          }
        }
      } else if (messageType === "ToolMessage") {
        // Handle tool results
        streamChunks.push(MessageFormatter.formatToolResult(message));
      }
    }

    return streamChunks;
  }

  static isNaturalCompletion(chunk: any): boolean {
    if (!chunk.messages) return false;

    const lastMessage = chunk.messages[chunk.messages.length - 1];
    return (
      lastMessage &&
      lastMessage.constructor.name === "AIMessage" &&
      (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0)
    );
  }

  static sanitizeHistoryMessage(
    item: any,
  ): { role: string; content: string } | null {
    // Filter out system messages - they should NEVER be in history
    if (item.role === "system") {
      return null;
    }

    let content = item.content;
    try {
      const parsedContent = JSON.parse(content);
      if (
        parsedContent.messages &&
        Array.isArray(parsedContent.messages) &&
        parsedContent.messages.length > 0
      ) {
        content = parsedContent.messages[0].content || " ";
      }
    } catch (e) {
      // Not a JSON string, so leave content as is
    }
    return {
      role: item.role,
      content: content,
    };
  }
}

export class AgentErrorHandler {
  static createErrorChunk(error: any): StreamChunk {
    let errorMessage = "An unknown error occurred";

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    }

    return MessageFormatter.createStreamChunk("error", errorMessage);
  }

  static createWarningChunk(warning: string): StreamChunk {
    return MessageFormatter.createStreamChunk(
      "thinking",
      `Warning: ${warning}`,
    );
  }

  static createInfoChunk(info: string): StreamChunk {
    return MessageFormatter.createStreamChunk("thinking", info);
  }
}

export const DEFAULT_AGENT_CONFIG: AgentExecutionConfig = {
  maxIterations: 50,
  maxToolCalls: 100,
  streamToolCalls: true,
  streamToolResults: true,
  verboseLogging: true,
  enableParallelExecution: true,
  maxConcurrency: 10,
  parallelTimeout: 120000,
  fallbackToSequential: true,
};

export const CONSERVATIVE_AGENT_CONFIG: AgentExecutionConfig = {
  maxIterations: 10,
  maxToolCalls: 20,
  streamToolCalls: true,
  streamToolResults: false,
  verboseLogging: false,
  enableParallelExecution: false,
  maxConcurrency: 3,
  parallelTimeout: 60000,
  fallbackToSequential: true,
};

export const EXTENDED_AGENT_CONFIG: AgentExecutionConfig = {
  maxIterations: 100,
  maxToolCalls: 200,
  streamToolCalls: true,
  streamToolResults: true,
  verboseLogging: true,
  enableParallelExecution: true,
  maxConcurrency: 20,
  parallelTimeout: 180000,
  fallbackToSequential: true,
};
