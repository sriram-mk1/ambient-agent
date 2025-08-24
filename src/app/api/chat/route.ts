import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { conversationHandler } from "@/lib/agent/conversation";
import { createStreamingResponse } from "@/lib/agent/streaming";
import { agentLogger } from "@/lib/agent/logger";
import { AgentExecutionConfig, DEFAULT_AGENT_CONFIG } from "@/lib/agent-utils";
import { tokenRefreshManager } from "@/lib/token-refresh";
import { mcpManager } from "@/lib/mcp-manager";
import { agentManager } from "@/lib/agent/manager";

const dynamic = "force-dynamic";

type RequestBody = {
  message: string;
  history?: Array<{ role: string; content: string }>;
  user_id?: string;
  threadId?: string;
  resumeData?: {
    type: "approve" | "reject" | "edit";
    toolCallId?: string;
    data?: any;
    args?: any;
  };
  // Optional persona override from UI chip selection
  personaOverrideContent?: string;
  // Optional references selected in composer (e.g., docs, sheets)
  references?: Array<{ app: string; type?: string; id: string; name?: string }>;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const resumeWorkflow = url.searchParams.get("resumeWorkflow");
    const toolCallId = url.searchParams.get("toolCallId");
    const threadId = url.searchParams.get("threadId");
    const valueParam =
      url.searchParams.get("value") ?? url.searchParams.get("args");
    const action = url.searchParams.get("action") as
      | "approve"
      | "reject"
      | "edit"
      | "human_input"
      | null;

    if (!resumeWorkflow || !toolCallId || !threadId || !action) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 },
      );
    }

    // Authentication check
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    agentLogger.startConversation(
      {
        conversationId: threadId,
        messageNumber: 0,
        userMessage: `Resume tool ${toolCallId}`,
        userId: user.id,
      },
      true,
    );
    agentLogger.info(`[Chat Route][GET] Resume workflow: ${toolCallId}`);

    // Pre-message token refresh for authenticated users
    if (user.id !== "anonymous") {
      try {
        agentLogger.info(
          `[Chat Route][GET] Checking tokens for user: ${user.id}`,
        );
        const tokenRefreshResult =
          await tokenRefreshManager.ensureAllTokensFresh(user.id);

        if (tokenRefreshResult.refreshedApps.length > 0) {
          agentLogger.info(
            `[Chat Route][GET] Refreshed tokens for: ${tokenRefreshResult.refreshedApps.join(", ")}`,
          );
          mcpManager.clearUserCache(user.id); // Force MCP reinitialization
        }

        if (tokenRefreshResult.failedApps.length > 0) {
          agentLogger.warn(
            `[Chat Route][GET] Failed to refresh tokens for: ${tokenRefreshResult.failedApps.join(", ")}`,
          );
        }
      } catch (error) {
        agentLogger.error("[Chat Route][GET] Token refresh error", error);
        // Continue with workflow even if token refresh fails
      }
    }

    // Handle conversation using the conversation handler for resume
    const conversation = await conversationHandler.handleConversation({
      message: "",
      history: [],
      userId: user.id,
      threadId,
      resumeData: {
        type: action,
        toolCallId,
        // For human_input we pass the raw string value.
        // For approve/edit we allow optional JSON-encoded args to override tool inputs.
        args:
          action === "human_input"
            ? valueParam ?? undefined
            : action === "approve" || action === "edit"
              ? (() => {
                  if (!valueParam) return undefined;
                  try {
                    return JSON.parse(valueParam);
                  } catch {
                    return undefined;
                  }
                })()
              : undefined,
      },
    });

    // Create streaming response using the streaming module
    const streamingResponse = createStreamingResponse(
      conversation.workflowPromise,
      {
        threadId: conversation.threadId,
        enableContentStreaming: true,
        enableToolStreaming: true,
        enableHumanInTheLoop: true,
        contentChunkSize: 15,
      },
      {
        type: action,
        toolCallId,
      },
    );

    // Post-message background token refresh
    if (user.id !== "anonymous") {
      conversation.workflowPromise
        .then(() => {
          agentLogger.info(
            `[Chat Route][GET] Starting post-message token refresh for user: ${user.id}`,
          );
          return tokenRefreshManager.refreshExpiredTokensForUser(user.id);
        })
        .then((result) => {
          if (result.refreshedApps.length > 0) {
            agentLogger.info(
              `[Chat Route][GET] Post-message refresh: Updated tokens for ${result.refreshedApps.join(", ")}`,
            );
            mcpManager.clearUserCache(user.id); // Prepare for next request
          }
          if (result.failedApps.length > 0) {
            agentLogger.warn(
              `[Chat Route][GET] Post-message refresh: Failed for ${result.failedApps.join(", ")}`,
            );
          }
        })
        .catch((error) => {
          agentLogger.error(
            "[Chat Route][GET] Post-message token refresh error",
            error,
          );
        });
    }

    agentLogger.info("[Chat Route][GET] Streaming response started");
    return streamingResponse;
  } catch (error) {
    agentLogger.error("[Chat Route][GET] Internal error", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred. Please try again.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const {
      message,
      history = [],
      user_id,
      threadId,
      resumeData,
      config,
      personaOverrideContent,
      references,
    }: RequestBody & {
      config?: Partial<AgentExecutionConfig>;
    } = await request.json();

    // Authentication check
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user_id || user.id;

    // Get user's agent configuration for parallel execution
    const userConfig: AgentExecutionConfig = {
      ...DEFAULT_AGENT_CONFIG,
      ...config,
    };

    agentLogger.startConversation(
      {
        conversationId: threadId || `thread_${userId}_${Date.now()}`,
        messageNumber: history.length + 1,
        userMessage: resumeData ? "Resume" : message || "",
        userId,
      },
      !!resumeData,
    );

    agentLogger.info(
      `[Chat Route][POST] ${resumeData ? "Resume" : "New"} conversation: thread=${threadId || "generated"}, user=${userId}`,
    );

    // Pre-message token refresh for authenticated users
    if (userId !== "anonymous") {
      try {
        agentLogger.info(
          `[Chat Route][POST] Checking tokens for user: ${userId}`,
        );
        const tokenRefreshResult =
          await tokenRefreshManager.ensureAllTokensFresh(userId);

        if (tokenRefreshResult.refreshedApps.length > 0) {
          agentLogger.info(
            `[Chat Route][POST] Refreshed tokens for: ${tokenRefreshResult.refreshedApps.join(", ")}`,
          );
          // Force re-initialization
          mcpManager.clearUserCache(userId);
          agentManager.invalidateUserCache(userId);
        }

        if (tokenRefreshResult.failedApps.length > 0) {
          agentLogger.warn(
            `[Chat Route][POST] Failed to refresh tokens for: ${tokenRefreshResult.failedApps.join(", ")}`,
          );
        }
      } catch (error) {
        agentLogger.error("[Chat Route][POST] Token refresh error", error);
        // Continue with conversation even if token refresh fails
      }
    }

    // Handle conversation using the conversation handler with config
    // Build enriched message with references (if any)
    // Build enriched message with references (do NOT add at the beginning; system must be first later)
    const enrichedMessage = Array.isArray(references) && references.length > 0
      ? `${message}\n\n[attachments]\n${JSON.stringify(references)}\n[/attachments]`
      : message;

    const conversation = await conversationHandler.handleConversation({
      message: enrichedMessage,
      history,
      userId,
      threadId,
      resumeData,
      config: userConfig,
      selectedPromptOverride: personaOverrideContent,
    });

    // Check if user has any tools available
    if (conversation.tools.length === 0) {
      agentLogger.warn("[Chat Route][POST] No tools available");
      return new Response(conversationHandler.createNoToolsResponse(), {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Log parallel execution configuration
    if (userConfig.enableParallelExecution) {
      agentLogger.info(
        `[Chat Route][POST] Parallel execution enabled (max concurrency: ${userConfig.maxConcurrency})`,
      );
    }

    // Create streaming response using the streaming module
    const streamingResponse = createStreamingResponse(
      conversation.workflowPromise,
      {
        threadId: conversation.threadId,
        enableContentStreaming: true,
        enableToolStreaming: true,
        enableHumanInTheLoop: true,
        contentChunkSize: 15,
      },
      resumeData,
    );

    // Post-message background token refresh
    if (userId !== "anonymous") {
      conversation.workflowPromise
        .then(() => {
          agentLogger.info(
            `[Chat Route][POST] Starting post-message token refresh for user: ${userId}`,
          );
          return tokenRefreshManager.refreshExpiredTokensForUser(userId);
        })
        .then((result) => {
          if (result.refreshedApps.length > 0) {
            agentLogger.info(
              `[Chat Route][POST] Post-message refresh: Updated tokens for ${result.refreshedApps.join(", ")}`,
            );
            // Prepare for next request
            mcpManager.clearUserCache(userId);
            agentManager.invalidateUserCache(userId);
          }
          if (result.failedApps.length > 0) {
            agentLogger.warn(
              `[Chat Route][POST] Post-message refresh: Failed for ${result.failedApps.join(", ")}`,
            );
          }
        })
        .catch((error) => {
          agentLogger.error(
            "[Chat Route][POST] Post-message token refresh error",
            error,
          );
        });
    }

    agentLogger.info("[Chat Route][POST] Streaming response started");
    return streamingResponse;
  } catch (error) {
    agentLogger.error("[Chat Route][POST] Internal error", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred. Please try again.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}

export { dynamic };
