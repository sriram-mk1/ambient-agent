import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import {
  GoogleAIFileManager,
} from "@google/generative-ai/server";
import {
  createAgentWorkflow,
  CompiledWorkflow,
  AgentWorkflowConfig,
} from "./workflow";
import { agentLogger } from "./logger";
import { AgentExecutionConfig } from "../agent-utils";
import { createParallelExecutionSystem } from "./parallel-integration";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

// ================================================================================================
// 🎯 AGENT MANAGER - Orchestrates LangGraph Workflows
// ================================================================================================

interface CachedAgent {
  workflow: CompiledWorkflow;
  tools: any[];
  lastUpdated: number;
}

interface CachedMCPData {
  tools: any[];
  lastUpdated: number;
}

interface CachedZepData {
  tools: any[];
  sessionId: string | undefined;
  lastUpdated: number;
}

interface MessageHistory {
  role: string;
  content: string;
}

/**
 * Agent Manager - Orchestrates the creation and management of LangGraph workflows
 */
class AgentManager {
  private agentCache = new Map<string, CachedAgent>();
  private mcpCache = new Map<string, CachedMCPData>();
  private zepCache = new Map<string, CachedZepData>();
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly MCP_CACHE_TTL = 30 * 60 * 1000; // 30 minutes - MCP tools change less frequently
  private readonly ZEP_CACHE_TTL = 60 * 60 * 1000; // 1 hour - memory sessions are long-lived

  constructor() {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error(
        "GOOGLE_API_KEY must be set in your environment variables.",
      );
    }
  }

  static getInstance() {
    return agentManager;
  }

  /**
   * Get or create agent for a user with caching and tool loading
   */
  async getOrCreateAgent(
    userId: string,
    config?: Partial<AgentExecutionConfig>,
  ): Promise<{ workflow: CompiledWorkflow; tools: any[]; sessionId: string }> {
    // Check cache first
    const cached = this.agentCache.get(userId);
    const cacheAge = cached ? Date.now() - cached.lastUpdated : 0;

    if (cached && cacheAge < this.CACHE_TTL) {
      const { sessionId } = await this.getUserToolsAndMemory(userId);
      return {
        workflow: await cached.workflow,
        tools: cached.tools,
        sessionId,
      };
    }

    // Get tools and setup for user
    const { tools, sessionId } = await this.getUserToolsAndMemory(userId);

    // Create complete agent configuration
    const agentConfig: AgentExecutionConfig = {
      maxIterations: 10,
      maxToolCalls: 15,
      streamToolCalls: true,
      streamToolResults: true,
      verboseLogging: true,
      enableParallelExecution: config?.enableParallelExecution ?? true,
      maxConcurrency: config?.maxConcurrency ?? 5,
      parallelTimeout: config?.parallelTimeout ?? 30000,
      fallbackToSequential: config?.fallbackToSequential ?? true,
      ...config,
    };

    // Create parallel execution system
    const parallelSystem = await createParallelExecutionSystem(
      tools,
      agentConfig,
    );

    // Use enhanced tools and workflow from parallel system
    const workflow = parallelSystem.workflow;
    const enhancedTools = parallelSystem.enhancedTools;

    // Log system status
    const status = parallelSystem.systemStatus;
    agentLogger.info(
      `[Agent Manager] Created agent for ${userId} - Status: ${status.status}, Parallel: ${status.parallelExecutionEnabled}, Tools: ${enhancedTools.length}`,
    );

    if (status.details.warnings.length > 0) {
      status.details.warnings.forEach((warning: string) => {
        agentLogger.warn(`[Agent Manager] ${warning}`);
      });
    }

    // Cache the enhanced agent
    this.agentCache.set(userId, {
      workflow,
      tools: enhancedTools,
      lastUpdated: Date.now(),
    });

    // Create and cache the system prompt
    this.getOrCreateCachedSystemPrompt(enhancedTools);

    return { workflow, tools: enhancedTools, sessionId };
  }

  /**
   * Create and cache the system prompt
   */
  public async getOrCreateCachedSystemPrompt(
    _tools: any[],
    _memoryContext?: string,
  ) {
    // Disabled: do not create or use prompt cache on free tier
    agentLogger.info("[Agent Manager] Prompt caching disabled");
    return undefined;
  }

  /**
   * Get MCP tools with caching
   */
  private async getMCPTools(userId: string): Promise<any[]> {
    // Check MCP cache first
    const cached = this.mcpCache.get(userId);
    const cacheAge = cached ? Date.now() - cached.lastUpdated : 0;

    if (cached && cacheAge < this.MCP_CACHE_TTL) {
      return cached.tools;
    }

    try {
      const { mcpManager } = await import("@/lib/mcp-manager");
      const mcpData = await mcpManager.getOrCreateMCPData(userId);
      const mcpTools = mcpData?.tools || [];

      // Cache the MCP tools
      this.mcpCache.set(userId, {
        tools: mcpTools,
        lastUpdated: Date.now(),
      });

      return mcpTools;
    } catch (error) {
      agentLogger.error("MCP tools fetch failed", error);
      return [];
    }
  }

  /**
   * Get Zep tools and session with caching
   */
  private async getZepToolsAndSession(
    userId: string,
  ): Promise<{ tools: any[]; sessionId?: string }> {
    // Check Zep cache first
    const cached = this.zepCache.get(userId);
    const cacheAge = cached ? Date.now() - cached.lastUpdated : 0;

    if (cached && cacheAge < this.ZEP_CACHE_TTL) {
      return { tools: cached.tools, sessionId: cached.sessionId };
    }

    try {
      const { zepMemoryTools, ZepMemoryHelper, setCurrentUserId } =
        await import("@/lib/zep-tools");

      // Set current user for memory tools
      setCurrentUserId(userId);

      // Initialize memory session
      const sessionId =
        (await ZepMemoryHelper.initializeUserMemory(userId)) || undefined;

      // Cache the Zep data
      this.zepCache.set(userId, {
        tools: zepMemoryTools,
        sessionId,
        lastUpdated: Date.now(),
      });

      return { tools: zepMemoryTools, sessionId };
    } catch (error) {
      agentLogger.error("Zep tools setup failed", error);
      return { tools: [], sessionId: userId }; // Use userId as fallback sessionId
    }
  }

  /**
   * Get tools and setup memory for a user with comprehensive caching
   */
  private async getUserToolsAndMemory(
    userId: string,
  ): Promise<{ tools: any[]; sessionId: string }> {
    let tools: any[] = [];
    let sessionId: string | undefined;

    try {
      // For authenticated users, get MCP tools and setup memory
      if (userId !== "anonymous") {
        // Get MCP tools (cached)
        const mcpTools = await this.getMCPTools(userId);

        // Get Zep tools and session (cached)
        const zepData = await this.getZepToolsAndSession(userId);

        // Combine tools with deduplication to prevent duplicate function declarations
        const allTools = [...mcpTools, ...zepData.tools];

        // Optionally include Exa web tools if API key is configured
        try {
          if (process.env.EXA_API_KEY) {
            const [
              { fastWebSearchExa },
              { webSearchExa },
              { companyResearchExa },
              { linkedinSearchExa },
              { socialDiscussionSearchExa },
              { crawlingExa },
            ] = await Promise.all([
              import("@/lib/tools/web-search-exa"),
              import("@/lib/tools/web-search-exa-modes"),
              import("@/lib/tools/company-research-exa"),
              import("@/lib/tools/linkedin-search-exa"),
              import("@/lib/tools/social-discussion-search-exa"),
              import("@/lib/tools/crawling-exa"),
            ]);
            allTools.push(
              fastWebSearchExa,
              webSearchExa,
              companyResearchExa,
              linkedinSearchExa,
              socialDiscussionSearchExa,
              crawlingExa,
            );
          } else {
            agentLogger.info(
              "[Agent Manager] EXA_API_KEY not set; skipping Exa web tools",
            );
          }
        } catch (e) {
          agentLogger.warn("Failed to include Exa web tools", e as any);
        }
        const toolMap = new Map<string, any>();
        const duplicates: string[] = [];

        allTools.forEach((tool) => {
          if (!toolMap.has(tool.name)) {
            toolMap.set(tool.name, tool);
          } else {
            duplicates.push(tool.name);
            agentLogger.warn(
              `Duplicate tool found: ${tool.name}, keeping first instance`,
            );
          }
        });

        tools = Array.from(toolMap.values());
        sessionId = zepData.sessionId;

        if (duplicates.length > 0) {
          agentLogger.info(
            `[Agent Manager] Deduplicated ${duplicates.length} tools: ${duplicates.join(", ")}`,
          );
        }

        // Always include built-in human_input tool for HITL prompts
        try {
          const { createHumanInputTool } = await import(
            "@/lib/tools/human-input"
          );
          const humanInputTool = createHumanInputTool();
          // Avoid duplicates by name
          if (!tools.some((t) => t.name === humanInputTool.name)) {
            tools.push(humanInputTool);
          }
        } catch (e) {
          agentLogger.warn("Failed to include human_input tool", e as any);
        }

        agentLogger.info(
          `[Agent Manager] Final tool count: ${tools.length} (deduplicated from ${allTools.length})`,
        );
      }
    } catch (error) {
      agentLogger.error("User tools setup failed", error);
      // Continue with empty tools array
    }

    return { tools, sessionId: sessionId || userId }; // Use userId as fallback if sessionId is undefined
  }

  /**
   * Prepare messages for the agent workflow
   */
  prepareMessages(
    userMessage: string,
    history: MessageHistory[],
    tools: any[],
    memoryContext?: string,
  ): BaseMessage[] {
    const messages: BaseMessage[] = [];

    // 1. Build and add a single system message.
    // Custom rules (memoryContext) are only injected at the start of a new conversation.
    const systemMessage = this.buildSystemMessage(
      tools,
      history.length === 0 ? memoryContext : undefined,
    );
    messages.push(systemMessage);

    // 2. Add conversation history (sanitize and filter)
    const sanitizedHistory = history
      .map((msg) => this.sanitizeHistoryMessage(msg))
      .filter((msg) => msg !== null);

    for (const msg of sanitizedHistory) {
      const content = msg.content.trim();
      // Skip messages with empty content to prevent coercion failures
      if (!content) {
        console.warn(
          `⚠️ [MANAGER] Skipping empty message with role: ${msg.role}`,
        );
        continue;
      }

      if (msg.role === "user") {
        messages.push(new HumanMessage(content));
      } else if (msg.role === "assistant") {
        messages.push(new AIMessage(content));
      }
    }

    // 3. Add current user message (validate it's not empty)
    const trimmedUserMessage = userMessage.trim();
    if (trimmedUserMessage) {
      messages.push(new HumanMessage(trimmedUserMessage));
    } else {
      console.warn("⚠️ [MANAGER] User message is empty, adding placeholder");
      messages.push(new HumanMessage("Hello"));
    }

    return messages;
  }

  /**
   * Sanitize history message - filter out system messages and parse content
   */
  private sanitizeHistoryMessage(
    item: any,
  ): { role: string; content: string } | null {
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

    // Ensure content is a non-empty string
    const finalContent =
      content && typeof content === "string" ? content.trim() : "";

    // Return null for empty content to filter it out
    if (!finalContent) {
      return null;
    }

    return {
      role: item.role,
      content: finalContent,
    };
  }

  /**
   * Build system message with tool info and memory context
   */
  private buildSystemMessage(
    tools: any[],
    memoryContext?: string,
  ): SystemMessage {
    let systemContent = `You are a general-purpose AI agent with memory capabilities. You can reason, plan, and use tools to help the user achieve goals across domains (productivity, research, coding, data analysis, creative work, operations, and more). You are not limited to managing third-party apps; you orchestrate a toolkit of capabilities and coordinate them safely and effectively. Be concise, helpful, and use clear Markdown formatting.

## Persona Activation (if provided)
- If a section titled "Custom Rules (User-Selected)" is present, assume that persona/role immediately and carry it consistently through all responses.
- Apply the persona to: tone, vocabulary, structure/formatting, and decision-making priorities.
- Continue to follow all other guidance in this prompt (Style, Guidelines, Examples, Safety & Boundaries) and use tools as needed.
- If the rules are ambiguous or appear to conflict, ask 1 brief clarifying question before proceeding. Safety & Boundaries always take precedence.

## Style
- Be direct and avoid repeating yourself within the same message
- Use proper Markdown: headings, lists, code fences, and spacing where helpful
- Prefer short paragraphs and bullet lists for clarity
- Explain actions before using tools (briefly) and summarize after completion
- Maintain a friendly, focused tone

## Memory Tools
- \`search_user_facts\`: Search for previously stored user information (facts)
- \`search_memory_graph\`: Search the user's knowledge graph (facts/entities)
- \`add_contextual_data\`: Store only durable, useful facts (avoid raw content)

## Available Tools
${tools.map((tool: any) => tool.name).join(", ")}

## Guidelines
- If a section titled "Custom Rules (User-Selected)" is present in this prompt, you MUST adopt those rules as your primary role/persona and tone while still following all other guidance in this prompt (including Style, Guidelines, Examples, and Safety & Boundaries).
- Scope: Act as a general AI agent. You can plan, reason, draft, and execute tasks with tools when needed—not just app management.
- Before tool calls: briefly state what you'll do and why (the rationale for selecting the tool)
- After tool calls: always provide a confirmation and concise summary (and next steps if relevant)
- Do not repeat the same information within a single response
- Use structured Markdown (headings, bullets, code blocks) for clarity
- Be efficient and avoid unnecessary filler text
- Never end immediately after a tool call without a closing summary
- Prefer minimal, reversible actions first; escalate as needed
- If tool output is ambiguous or incomplete, ask targeted follow-up questions

## Memory Operating Principles (use sparingly and quickly)
- Retrieve first when needed: before significant actions, quickly query memory for relevant facts/entities via \`search_user_facts\` or \`search_memory_graph\` (e.g., titles, IDs, links, user prefs). Keep calls minimal.
- Store only durable facts: after impactful actions, consider a single \`add_contextual_data\` with a short, normalized fact (title — fact — link/ID — source). Do not store raw tool output, secrets, or transient data.
- Examples to store: canonical doc/sheet/event links and IDs, user preferences, confirmed decisions, recurring workflows, cross-links (email ↔ doc, event ↔ doc).
- Examples to avoid: temporary calculations, long bodies, token values, one-off logs.

## Safety & Boundaries
- Never fabricate results; if unknown, say so and propose how to find out
- Respect least-privilege: only invoke tools relevant to the task
- Avoid irreversible or long-running operations without explicit user approval

## Examples of Scope (non-exhaustive)
- Research and synthesis, planning, drafting documents or emails (for user review)
- Coding or refactoring, running diagnostics/tests with development tools
- Data analysis and creating reports/visualizations with appropriate tools
- Integrations with third-party services when appropriate and approved`;

    // Prepend custom rules to the system message if provided
    if (memoryContext && memoryContext.trim()) {
      const customRules =
        `## Custom Rules (User-Selected) — Highest Priority (after Safety)\n` +
        `Adopt the following persona/role immediately and carry it through all responses.\n` +
        `- Treat these rules as your primary operating persona and tone.\n` +
        `- Apply them to wording, structure/formatting, and decision-making priorities.\n` +
        `- Continue using tools and follow all other guidance (Style, Guidelines, Examples).\n` +
        `- If any rule is ambiguous or conflicts, ask ONE brief clarifying question and prioritize Safety & Boundaries.\n\n` +
        `${memoryContext.trim()}\n\n---\n\n`;
      systemContent = customRules + systemContent;
      agentLogger.info(
        "[Agent Manager] Injected custom rules into system message",
      );
    }

    return new SystemMessage(systemContent);
  }

  /**
   * Fetch the user's selected prompt content from the database
   */
  async getSelectedPromptContent(userId: string): Promise<string | undefined> {
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("app_prompts")
        .select("content")
        .eq("user_id", userId)
        .eq("is_selected", true)
        .limit(1)
        .maybeSingle();
      if (error) {
        agentLogger.warn(
          "[Agent Manager] Failed to fetch selected prompt",
          error as any,
        );
        return undefined;
      }
      return data?.content || undefined;
    } catch (e) {
      agentLogger.warn(
        "[Agent Manager] Error fetching selected prompt",
        e as any,
      );
      return undefined;
    }
  }

  /**
   * Clean up expired cache entries across all caches
   */
  cleanupCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean agent cache
    for (const [userId, cached] of this.agentCache.entries()) {
      const age = now - cached.lastUpdated;
      if (age > this.CACHE_TTL) {
        this.agentCache.delete(userId);
        cleanedCount++;
      }
    }

    // Clean MCP cache
    for (const [userId, cached] of this.mcpCache.entries()) {
      const age = now - cached.lastUpdated;
      if (age > this.MCP_CACHE_TTL) {
        this.mcpCache.delete(userId);
        cleanedCount++;
      }
    }

    // Clean Zep cache
    for (const [userId, cached] of this.zepCache.entries()) {
      const age = now - cached.lastUpdated;
      if (age > this.ZEP_CACHE_TTL) {
        this.zepCache.delete(userId);
        cleanedCount++;
      }
    }
  }

  /**
   * Invalidate all agent-related caches for a specific user
   * Use this when the user's connections/integrations change so the agent
   * re-initializes with fresh tools and memory session on next request.
   */
  invalidateUserCache(userId: string): void {
    try {
      if (this.agentCache.has(userId)) {
        this.agentCache.delete(userId);
      }
      if (this.mcpCache.has(userId)) {
        this.mcpCache.delete(userId);
      }
      if (this.zepCache.has(userId)) {
        this.zepCache.delete(userId);
      }
    } catch (error) {
      agentLogger.warn(
        `[Agent Manager] Failed to invalidate cache for user ${userId}`,
        error as any,
      );
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      agent: {
        size: this.agentCache.size,
        entries: Array.from(this.agentCache.keys()),
      },
      mcp: {
        size: this.mcpCache.size,
        entries: Array.from(this.mcpCache.keys()),
      },
      zep: {
        size: this.zepCache.size,
        entries: Array.from(this.zepCache.keys()),
      },
    };
  }

}

export const agentManager = new AgentManager();
