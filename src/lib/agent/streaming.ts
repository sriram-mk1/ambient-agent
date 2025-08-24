import { AIMessage } from "@langchain/core/messages";
import { agentLogger } from "./logger";
import { extractSourcesFromTool } from "@/lib/sources";
import type { SourceItem } from "@/lib/sources";

/**
 * SSE Event types for streaming responses
 */
export type SSEEvent =
  | { type: "content"; data: { content: string; segment?: number } }
  | { type: "tool_call"; data: { id: string; name: string; args: any } }
  | { type: "tool_result"; data: { result: string; id?: string } }
  | { type: "done"; data: { message: string; sources?: SourceItem[] } }
  | {
      type: "human_input_required";
      data: {
        interruptId: string;
        threadId: string;
        data: any;
        type: string;
        kind?: string;
      };
    }
  | {
      type: "error";
      data: { message: string; details?: string; code?: string };
    };

/**
 * SSE Controller for managing server-sent events
 */
export class SSEController {
  private isControllerClosed = false;
  private controller: ReadableStreamDefaultController;
  private encoder = new TextEncoder();

  constructor(controller: ReadableStreamDefaultController) {
    this.controller = controller;
  }

  /**
   * Comprehensive content sanitizer to eliminate [object Object]
   */
  public sanitizeContent(content: unknown): string {
    if (typeof content !== "string") {
      return "";
    }

    // Strip only exact [object Object] occurrences, preserve all other formatting
    return content
      .replace(/\[object Object\]/g, "")
      .replace(/\[object\s+Object\]/g, "");
  }

  /**
   * Send an SSE event to the client
   */
  sendEvent(event: SSEEvent): void {
    // Check if controller is already closed
    if (this.isControllerClosed) {
      return;
    }

    // Check if controller is in invalid state
    if (this.controller.desiredSize === null) {
      this.isControllerClosed = true;
      return;
    }

    try {
      // Aggressively filter content events to eliminate [object Object]
      if (event.type === "content") {
        const c = (event.data as any)?.content;
        if (typeof c !== "string") {
          return;
        }

        const sanitized = this.sanitizeContent(c);
        if (sanitized === "") {
          return;
        }

        // Update event data with sanitized content
        event.data.content = sanitized;
      }

      // Format as proper SSE for EventSource compatibility
      let message = `event: ${event.type}\n`;
      message += `data: ${JSON.stringify(event.data)}\n\n`;

      try {
        this.controller.enqueue(this.encoder.encode(message));

        // Try to flush the controller immediately
        if (this.controller.desiredSize !== null) {
          try {
            // Force the underlying stream to flush by enqueuing empty buffer
            // This is a hack but it works to force Node.js to send the data
            this.controller.enqueue(new Uint8Array(0));
          } catch (flushError) {
            // Ignore flush errors
          }
        }
      } catch (enqueueError) {
        this.isControllerClosed = true;
        throw enqueueError;
      }
    } catch (error) {
      this.isControllerClosed = true;
      agentLogger.error("SSE send failed", error);
    }
  }

  /**
   * Send content in small chunks for better UX
   */
  async streamContent(content: string, chunkSize: number = 10): Promise<void> {
    if (!content.trim()) {
      return;
    }

    // Sanitize content before streaming
    const sanitized = this.sanitizeContent(content);
    if (sanitized === "") {
      return;
    }

    // Stream in larger chunks for better performance
    for (let i = 0; i < sanitized.length; i += chunkSize) {
      if (this.isControllerClosed) break;

      const chunk = sanitized.slice(i, i + chunkSize);
      const cleanChunk = this.sanitizeContent(chunk);

      if (cleanChunk === "") {
        continue;
      }

      // Send as proper SSE format for EventSource
      this.sendEvent({
        type: "content",
        data: { content: cleanChunk },
      });

      // Small delay between chunks for smooth streaming
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Close the SSE connection
   */
  close(): void {
    if (!this.isControllerClosed) {
      console.log("🏁 [SSE] Closing controller");
      this.isControllerClosed = true;

      try {
        // Send done event only if controller is still open
        if (this.controller.desiredSize !== null) {
          const message = `event: done\ndata: ${JSON.stringify({ message: "Stream completed" })}\n\n`;
          this.controller.enqueue(this.encoder.encode(message));
          console.log(`✅ [SSE] Done event sent`);
        }
      } catch (error) {
        console.log(
          "⚠️ [SSE] Could not send done event, controller already closed:",
          error,
        );
      }

      try {
        if (this.controller.desiredSize !== null) {
          this.controller.close();
        }
      } catch (error) {
        console.log("⚠️ [SSE] Controller was already closed");
      }
    }
  }

  /**
   * Send error and close connection
   */
  error(message: string, details?: string, code?: string): void {
    if (!this.isControllerClosed) {
      console.log("❌ [SSE] Sending error and closing controller");
      this.isControllerClosed = true;

      try {
        // Send error event directly without using sendEvent to avoid recursion
        if (this.controller.desiredSize !== null) {
          const errorMessage = `event: error\ndata: ${JSON.stringify({ message, details, code })}\n\n`;
          this.controller.enqueue(this.encoder.encode(errorMessage));
        }
      } catch (error) {
        console.log(
          "⚠️ [SSE] Could not send error event, controller already closed",
        );
      }

      try {
        if (this.controller.desiredSize !== null) {
          this.controller.close();
        }
      } catch (error) {
        console.log("⚠️ [SSE] Controller was already closed during error");
      }
    }
  }

  get isClosed(): boolean {
    return this.isControllerClosed;
  }

  get controllerState(): { isClosed: boolean; desiredSize: number | null } {
    return {
      isClosed: this.isControllerClosed,
      desiredSize: this.controller.desiredSize,
    };
  }
}

/**
 * Streaming configuration options
 */
export interface StreamingConfig {
  threadId: string;
  enableContentStreaming?: boolean;
  contentChunkSize?: number;
  enableToolStreaming?: boolean;
  enableHumanInTheLoop?: boolean;
}

/**
 * Stream processor for handling workflow execution and SSE events
 */
export class StreamProcessor {
  private sseController: SSEController;
  private config: StreamingConfig;
  private collectedSources: SourceItem[] = [];

  constructor(sseController: SSEController, config: StreamingConfig) {
    this.sseController = sseController;
    this.config = {
      enableContentStreaming: true,
      enableToolStreaming: true,
      enableHumanInTheLoop: true,
      contentChunkSize: 15,
      ...config,
    };
  }

  /**
   * Stream processor for handling workflow execution and SSE events
   */
  async processWorkflowStream(
    workflowPromise: Promise<any>,
    resumeData?: any,
  ): Promise<void> {
    const isResumeRequest = !!resumeData;

    try {
      const stream = await workflowPromise;
      let chunkCount = 0;
      let hasProcessedContent = false;
      let hasSeenToolExecution = false;

      agentLogger.streaming("start");

      for await (const chunk of stream) {
        chunkCount++;

        if (this.sseController.isClosed && !isResumeRequest) {
          break;
        }

        try {
          // Handle interrupts (human-in-the-loop)
          if (this.config.enableHumanInTheLoop && "__interrupt__" in chunk) {
            if (!isResumeRequest) {
              await this.handleInterrupts(chunk.__interrupt__);
            }
            continue;
          }

          // Handle tool execution results
          if (chunk.tools) {
            hasSeenToolExecution = true;
            await this.handleToolResults(chunk.tools);
          }

          // Handle agent responses (including post-tool-call responses)
          if (chunk.agent) {
            await this.handleAgentResponse(chunk.agent);
            hasProcessedContent = true;
          }

          // Handle any other workflow state changes
          if (chunk.messages && !chunk.agent && !chunk.tools) {
            await this.handleStandaloneMessages(chunk.messages);
            hasProcessedContent = true;
          }
        } catch (chunkError) {
          // Handle specific "System message should be the first one" errors
          if (
            chunkError instanceof Error &&
            chunkError.message.includes(
              "System message should be the first one",
            )
          ) {
            agentLogger.error(
              "[STREAM] System message validation error - attempting recovery",
              chunkError,
            );

            // Send error event to client
            await this.sseController.sendEvent({
              type: "error",
              data: {
                message: "Message validation error occurred. Please try again.",
                code: "SYSTEM_MESSAGE_ORDER_ERROR",
              },
            });

            // Continue processing instead of breaking the entire stream
            continue;
          } else {
            // Re-throw other errors
            throw chunkError;
          }
        }

        // Handle any other chunk properties that might contain relevant data
        const handledKeys = new Set([
          "agent",
          "tools",
          "messages",
          "__interrupt__",
        ]);
        const unhandledKeys = Object.keys(chunk).filter(
          (key) => !handledKeys.has(key),
        );
        if (unhandledKeys.length > 0) {
          // Try to extract messages from any unhandled properties
          for (const key of unhandledKeys) {
            const value = chunk[key];
            if (value && typeof value === "object" && value.messages) {
              await this.handleStandaloneMessages(value.messages);
              hasProcessedContent = true;
            }
          }
        }
      }

      agentLogger.streaming("done", `${chunkCount} chunks processed`);

      // Let the stream complete naturally for both initial and resume requests
      // Only close if we processed content or if this is the final completion
      if (hasProcessedContent && !this.sseController.isClosed) {
        // Add small delay to ensure all events are flushed
        await new Promise((resolve) => setTimeout(resolve, 100));

        this.sseController.sendEvent({
          type: "done",
          data: { message: "Stream completed", sources: this.collectedSources },
        });
        this.sseController.close();
      }
    } catch (error) {
      agentLogger.error("Stream processing failed", error);

      // Only close on actual errors, not on normal interrupt flows
      if (!this.sseController.isClosed && !isResumeRequest) {
        this.sseController.error(
          "Stream processing failed",
          error instanceof Error ? error.message : "Unknown error",
          error instanceof Error && "lc_error_code" in error
            ? (error as any).lc_error_code
            : "STREAM_ERROR",
        );
      }
    }
  }

  /**
   * Handle interrupt events for human-in-the-loop
   */
  private async handleInterrupts(interrupts: any): Promise<void> {
    const interruptArray = Array.isArray(interrupts)
      ? interrupts
      : [interrupts];

    for (const interruptData of interruptArray) {
      const kind =
        typeof interruptData?.value?.type === "string"
          ? interruptData.value.type
          : "unknown";

      this.sseController.sendEvent({
        type: "human_input_required",
        data: {
          interruptId: interruptData.id,
          threadId: this.config.threadId,
          data: interruptData.value,
          type: kind, // backward compatible key
          kind,
        },
      });
    }
  }

  /**
   * Handle agent response messages
   */
  private async handleAgentResponse(agentData: any): Promise<void> {
    if (!agentData.messages) {
      return;
    }

    const messages = Array.isArray(agentData.messages)
      ? agentData.messages
      : [agentData.messages];

    // Process all messages, not just the last one
    for (const message of messages) {
      if (message instanceof AIMessage) {
        // Stream content if enabled and available
        if (
          this.config.enableContentStreaming &&
          message.content &&
          typeof message.content === "string"
        ) {
          const sanitized = this.sseController.sanitizeContent(message.content);

          if (sanitized.trim() !== "") {
            agentLogger.streaming("content", `${sanitized.length} chars`);
            await this.sseController.streamContent(
              sanitized,
              this.config.contentChunkSize || 10,
            );

            // Add extra delay to ensure all events are sent
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Handle tool calls
        if (
          this.config.enableToolStreaming &&
          message.tool_calls &&
          message.tool_calls.length > 0
        ) {
          for (const toolCall of message.tool_calls) {
            this.sseController.sendEvent({
              type: "tool_call",
              data: {
                id: toolCall.id || "",
                name: toolCall.name,
                args: toolCall.args,
              },
            });
          }
        }
      }
    }
  }

  /**
   * Handle tool execution results
   */
  private async handleToolResults(toolsData: any): Promise<void> {
    if (!toolsData.messages) return;

    const messages = Array.isArray(toolsData.messages)
      ? toolsData.messages
      : [toolsData.messages];

    const toolMessages = messages.filter(
      (msg: any) =>
        msg &&
        typeof msg === "object" &&
        msg._getType &&
        msg._getType() === "tool",
    );

    console.log("🔧 [STREAM] Processing tool messages:", toolMessages.length);

    for (const toolMsg of toolMessages) {
      const content = (toolMsg as any).content;
      const id = (toolMsg as any).tool_call_id || (toolMsg as any).id || "";
      const toolName =
        (toolMsg as any)?.name || (toolMsg as any)?.toolName || "tool";

      let safeResult = "";
      if (typeof content === "string") {
        safeResult = this.sseController.sanitizeContent(content);
      } else if (content != null) {
        try {
          const s = JSON.stringify(content);
          if (s !== "[object Object]") {
            safeResult = this.sseController.sanitizeContent(s);
          }
        } catch {
          safeResult = "";
        }
      }

      // Always emit tool_result so the client can mark completion,
      // even if the tool produced no textual result.
      console.log("📊 [STREAM] Emitting tool result (full):", safeResult || "");
      this.sseController.sendEvent({
        type: "tool_result",
        data: {
          id,
          result: safeResult || "",
        },
      });

      // Collect sources for all tools (web, docs, sheets, emails)
      try {
        const sources = extractSourcesFromTool(
          toolName,
          (toolMsg as any)?.args || {},
          safeResult,
        );
        if (Array.isArray(sources) && sources.length > 0) {
          const byUrl = new Map<string, SourceItem>();
          for (const s of this.collectedSources)
            if (s.url) byUrl.set(s.url!, s);
          for (const s of sources)
            if (s.url && !byUrl.has(s.url)) byUrl.set(s.url, s);
          this.collectedSources = Array.from(byUrl.values());
          console.log(
            "🔗 [STREAM] Collected sources total:",
            this.collectedSources.length,
          );
        }
      } catch (e) {
        console.log("⚠️ [STREAM] Source extraction failed:", e);
      }
    }
  }

  /**
   * Handle standalone messages that aren't part of agent or tool chunks
   */
  private async handleStandaloneMessages(messages: any): Promise<void> {
    console.log("📨 [STREAM] handleStandaloneMessages called with:", {
      messages: !!messages,
      messagesType: typeof messages,
      isArray: Array.isArray(messages),
    });

    if (!messages) {
      console.log(
        "⚠️ [STREAM] No messages provided to handleStandaloneMessages",
      );
      return;
    }

    const messageArray = Array.isArray(messages) ? messages : [messages];
    console.log("📨 [STREAM] Processing standalone messages:", {
      count: messageArray.length,
      types: messageArray.map((m) => m?._getType?.() || typeof m),
      rawMessages: messageArray.map((m: any) => ({
        type: m?._getType?.(),
        content: typeof m?.content === "string" ? m.content : m?.content,
        hasToolCalls: !!(m?.tool_calls && m.tool_calls.length > 0),
      })),
    });

    for (const [index, message] of messageArray.entries()) {
      console.log(`📨 [STREAM] Processing standalone message ${index + 1}:`, {
        type: message?._getType?.(),
        hasContent: !!message?.content,
        contentType: typeof message?.content,
        contentLength:
          typeof message?.content === "string" ? message.content.length : 0,
        isAIMessage: message instanceof AIMessage,
        messageObject: Object.keys(message || {}),
      });

      if (message instanceof AIMessage && message.content) {
        if (typeof message.content === "string") {
          console.log(
            "📝 [STREAM] Found AIMessage with string content (full):",
            {
              originalLength: message.content.length,
              original: message.content,
            },
          );

          const sanitized = this.sseController.sanitizeContent(message.content);
          console.log("📝 [STREAM] Content sanitized (full):", {
            sanitizedLength: sanitized.length,
            sanitized: sanitized,
            isEmpty: sanitized.trim() === "",
          });

          if (sanitized.trim() !== "") {
            console.log("✅ [STREAM] About to stream standalone content");
            await this.sseController.streamContent(
              sanitized,
              this.config.contentChunkSize,
            );
            console.log("✅ [STREAM] Finished streaming standalone content");
          } else {
            console.log("⚠️ [STREAM] Sanitized content is empty, skipping");
          }
        } else {
          console.log(
            "⚠️ [STREAM] Message content is not a string:",
            typeof message.content,
            message.content,
          );
        }
      } else {
        console.log("⚠️ [STREAM] Message not suitable for streaming:", {
          isAIMessage: message instanceof AIMessage,
          hasContent: !!message?.content,
          messageType: message?._getType?.(),
        });
      }
    }

    console.log("✅ [STREAM] Finished processing all standalone messages");
  }
}

/**
 * Create a streaming response for workflow execution
 */
export function createStreamingResponse(
  workflowPromise: Promise<any>,
  config: StreamingConfig,
  resumeData?: any,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const sseController = new SSEController(controller);
      
      // Set stream controller for enhanced workflows
      try {
        // Import here to avoid circular dependencies
        const { setStreamController } = await import('./enhanced-workflow');
        setStreamController(sseController);
      } catch (error) {
        // Enhanced workflow may not be available, continue with basic streaming
        console.log("Enhanced workflow not available, using basic streaming");
      }
      
      const processor = new StreamProcessor(sseController, config);
      await processor.processWorkflowStream(workflowPromise, resumeData);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
}
