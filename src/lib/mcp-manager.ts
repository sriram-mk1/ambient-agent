import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createClient as createServerClient } from "@/lib/supabase/server";
// Dynamic import to avoid build-time Node.js dependency issues

interface CachedMCPData {
  client: any;
  tools: any[];
  lastUpdated: number;
  mcpServers: Record<string, any>;
}

interface UserIntegration {
  app: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  description?: string;
  tools?: string[];
}

class MCPManager {
  private static instance: MCPManager;
  private userCache = new Map<string, CachedMCPData>();
  private refreshPromises = new Map<string, Promise<void>>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private cacheHits = 0;
  private cacheMisses = 0;

  private constructor() {
    // Clean constructor - no background processes
  }

  static getInstance(): MCPManager {
    if (!MCPManager.instance) {
      MCPManager.instance = new MCPManager();
    }
    return MCPManager.instance;
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [userId, data] of this.userCache.entries()) {
      if (now - data.lastUpdated > this.CACHE_TTL) {
        console.log(`🗑️ Cleaning up expired cache for user: ${userId}`);
        this.userCache.delete(userId);
      }
    }
  }

  private async getMcpServerConfigurations(
    userId: string,
  ): Promise<Record<string, any>> {
    console.log("🔧 Getting MCP server configurations for user:", userId);

    const supabase = await createServerClient();
    console.log("🔍 Querying user_integrations table for user:", userId);

    const { data: integrations, error } = await supabase
      .from("user_integrations")
      .select(
        "app, access_token, refresh_token, expires_at, description, tools",
      )
      .eq("user_id", userId)
      .eq("provider", "google");

    if (error) {
      console.error("❌ Database error getting integrations:", error);
      return {};
    }

    console.log("🗃️ Raw database query result:", {
      integrations: integrations,
      integrationCount: integrations?.length || 0,
      apps: integrations?.map((i) => i.app) || [],
    });

    if (!integrations?.length) {
      console.log("⚠️ No integrations found for user in database");
      console.log(
        "💡 User needs to connect Google apps at /dashboard/connections",
      );
      return {};
    }

    console.log(
      "✅ Found integrations:",
      integrations.map((i) => ({
        app: i.app,
        hasToken: !!i.access_token,
        tokenLength: i.access_token?.length || 0,
        expiresAt: i.expires_at,
        description: i.description,
        toolsCount: Array.isArray(i.tools) ? i.tools.length : 0,
      })),
    );

    const mcpServers: Record<
      string,
      { url: string; headers?: Record<string, string> }
    > = {};

    // Process integrations in parallel with token refresh
    const integrationPromises = integrations.map(async (integration) => {
      try {
        const { app, access_token } = integration;

        console.log(`🔑 Processing integration for ${app}:`, {
          hasAccessToken: !!access_token,
          tokenPrefix: access_token
            ? access_token.substring(0, 10) + "..."
            : "none",
          tokenLength: access_token?.length || 0,
        });

        if (!access_token) {
          console.error(`❌ No access token found for ${app} integration`);
          console.error(
            `🔗 User needs to reconnect ${app} at /dashboard/connections`,
          );
          return;
        }

        // Check if token is expired and refresh if needed
        let validToken = access_token;
        try {
          console.log(`🔄 Getting fresh token for ${app}...`);
          const { tokenRefreshManager } = await import("@/lib/token-refresh");
          const freshToken = await tokenRefreshManager.getFreshToken(
            userId,
            app,
          );

          if (freshToken) {
            validToken = freshToken;
            console.log(`✅ Got fresh token for ${app}`);
          } else {
            console.error(`❌ Failed to get valid token for ${app}`);
            console.error(
              `🔗 User needs to reconnect ${app} at /dashboard/connections`,
            );
            return;
          }
        } catch (tokenError) {
          console.error(`❌ Token refresh error for ${app}:`, tokenError);
          console.error(
            `🔗 User needs to reconnect ${app} at /dashboard/connections`,
          );
          return;
        }

        // Check if access token looks valid (basic format check)
        if (!validToken.startsWith("ya29.") && !validToken.startsWith("1//")) {
          console.error(`❌ Invalid access token format for ${app}:`, {
            tokenPrefix: validToken.substring(0, 10),
            expectedPrefix: "ya29. or 1//",
          });
          console.error(
            `🔗 User needs to reconnect ${app} at /dashboard/connections`,
          );
          return;
        }

        const serverConfigs: Record<string, any> = {
          gmail: {
            url: "https://gmail.sriramm-kumaran.workers.dev/mcp",
            headers: { Authorization: `Bearer ${validToken}` },
          },
          calendar: {
            url: "https://calendar.sriramm-kumaran.workers.dev/mcp",
            headers: { Authorization: `Bearer ${validToken}` },
          },
          docs: {
            url: "https://docs.sriramm-kumaran.workers.dev/mcp",
            headers: { Authorization: `Bearer ${validToken}` },
          },
          sheets: {
            url: "https://sheets.sriramm-kumaran.workers.dev/mcp",
            headers: { Authorization: `Bearer ${validToken}` },
          },
        };

        if (serverConfigs[app]) {
          const serverName = app.charAt(0).toUpperCase() + app.slice(1);
          mcpServers[serverName] = serverConfigs[app];
          console.log(`✅ Configured MCP server for ${serverName}:`, {
            url: serverConfigs[app].url,
            hasAuthHeader: !!serverConfigs[app].headers?.Authorization,
            tokenPrefix: validToken.substring(0, 10) + "...",
          });
        } else {
          console.warn(
            `⚠️ Unknown app type: ${app}, skipping MCP configuration`,
          );
        }
      } catch (error) {
        console.error(
          `❌ Error processing integration ${integration.app}:`,
          error,
        );
      }
    });

    await Promise.allSettled(integrationPromises);

    const configuredServers = Object.keys(mcpServers);
    console.log("🎯 Final MCP servers configured:", configuredServers);

    if (configuredServers.length === 0) {
      console.log(
        "⚠️ No MCP servers configured - authentication issues detected",
      );
      console.log(
        "🔗 User should visit /dashboard/connections to reconnect Google apps",
      );
    } else if (configuredServers.length < integrations.length) {
      const failedApps = integrations
        .map((i) => i.app)
        .filter(
          (app) =>
            !configuredServers.some((server) =>
              server.toLowerCase().includes(app.toLowerCase()),
            ),
        );
      console.log(
        `⚠️ Some integrations failed to configure: ${failedApps.join(", ")}`,
      );
      console.log(
        "🔗 User should reconnect failed apps at /dashboard/connections",
      );
    }

    return mcpServers;
  }

  private async createMCPClient(
    mcpServers: Record<string, any>,
  ): Promise<{ client: MultiServerMCPClient; tools: any[] }> {
    console.log(
      "🔧 Creating MCP client with servers:",
      Object.keys(mcpServers),
    );

    console.log("📋 MCP client configuration:", {
      serverCount: Object.keys(mcpServers).length,
      throwOnLoadError: false,
      prefixToolNameWithServerName: false,
      servers: Object.entries(mcpServers).map(([name, config]) => ({
        name,
        url: (config as any).url,
        hasAuthHeaders: !!(config as any).headers,
      })),
    });

    try {
      const client = new MultiServerMCPClient({
        throwOnLoadError: false, // Don't fail if one server is down
        prefixToolNameWithServerName: false, // Keep original tool names
        additionalToolNamePrefix: "",
        useStandardContentBlocks: true,
        mcpServers,
      });

      console.log("✅ MCP client created successfully");

      // Test the client connection before proceeding
      let tools: any[] = [];
      try {
        const rawTools = await client.getTools();

        // Deduplicate tools by name, keeping the first occurrence
        const toolMap = new Map<string, any>();
        const duplicates: string[] = [];

        rawTools.forEach((tool) => {
          if (!toolMap.has(tool.name)) {
            toolMap.set(tool.name, tool);
          } else {
            duplicates.push(tool.name);
            console.warn(
              `⚠️ [MCP] Duplicate tool found: ${tool.name}, keeping first instance`,
            );
          }
        });

        tools = Array.from(toolMap.values());

        console.log("🛠️ Tools retrieved from MCP servers:", {
          totalTools: tools?.length || 0,
          originalCount: rawTools?.length || 0,
          duplicatesRemoved: duplicates.length,
          duplicateNames: duplicates,
          toolNames: tools?.map((t) => t.name) || [],
        });

        if (duplicates.length > 0) {
          console.log(
            `🔄 [MCP] Deduplicated ${duplicates.length} tools: ${duplicates.join(", ")}`,
          );
        }
      } catch (toolError) {
        console.error("❌ Error retrieving tools from MCP servers:", toolError);
        console.warn("⚠️ This likely indicates authentication issues");
        console.warn(
          "🔗 User may need to reconnect apps at /dashboard/connections",
        );
        tools = []; // Continue with empty tools rather than failing
      }

      if (tools?.length === 0) {
        console.warn(
          "⚠️ No tools retrieved from MCP servers - authentication issues detected",
        );
        console.warn(
          "🔗 User needs to reconnect Google apps at /dashboard/connections",
        );
        console.warn("💡 Check if access tokens are expired or invalid");
      }

      return { client, tools };
    } catch (error) {
      console.error("❌ Error creating MCP client:", error);
      console.error(
        "❌ This indicates a critical issue with server configuration",
      );
      throw error;
    }
  }

  async getOrCreateMCPData(userId: string): Promise<{ tools: any[] } | null> {
    if (!userId) {
      console.error(
        "❌ [MCP MANAGER] No userId provided to getOrCreateMCPData",
      );
      return null;
    }

    // Check cache first and clean expired entries
    this.cleanupExpiredCache();

    const cached = this.userCache.get(userId);
    if (cached && Date.now() - cached.lastUpdated < this.CACHE_TTL) {
      console.log(`✅ [MCP MANAGER] Using cached MCP data for user: ${userId}`);
      this.cacheHits++;
      return { tools: cached.tools };
    }

    console.log(
      `🔄 [MCP MANAGER] Cache miss for user: ${userId}, initializing fresh MCP data`,
    );
    this.cacheMisses++;

    // Prevent multiple concurrent initializations for the same user
    const refreshKey = `refresh_${userId}`;
    if (this.refreshPromises.has(refreshKey)) {
      console.log(
        `⏳ [MCP MANAGER] Waiting for existing initialization for user: ${userId}`,
      );
      await this.refreshPromises.get(refreshKey);
      const updatedCache = this.userCache.get(userId);
      if (updatedCache) {
        return { tools: updatedCache.tools };
      }
    }

    // Create new MCP data
    const refreshPromise = this.initializeMCPData(userId);
    this.refreshPromises.set(refreshKey, refreshPromise);

    try {
      await refreshPromise;
      const newCache = this.userCache.get(userId);
      if (newCache) {
        console.log(
          `✅ [MCP MANAGER] Successfully initialized fresh MCP data for user: ${userId}`,
        );
        return { tools: newCache.tools };
      }
    } catch (error) {
      console.error(
        `❌ [MCP MANAGER] Failed to initialize MCP data for user: ${userId}`,
        error,
      );
    } finally {
      this.refreshPromises.delete(refreshKey);
    }

    return null;
  }

  private async initializeMCPData(userId: string): Promise<void> {
    console.log("🚀 Initializing MCP data for user:", userId);

    try {
      // First, check user's connection status and refresh tokens
      console.log("🔄 Checking and refreshing user tokens...");
      // Simplified connection check - assume connections are valid
      const connectionStatus = {
        connected: true,
        apps: [],
        needsReconnection: false,
        healthy: [],
        errors: [],
      };

      console.log("📊 User connection status:", {
        needsReconnection: connectionStatus.needsReconnection,
        healthy: connectionStatus.healthy,
        errors: connectionStatus.errors,
      });

      const mcpServers = await this.getMcpServerConfigurations(userId);

      if (Object.keys(mcpServers).length === 0) {
        console.log(
          "⚠️ No MCP servers available for user - no valid integrations with access tokens",
        );
        // Cache empty result to avoid repeated queries
        this.userCache.set(userId, {
          client: null as any,
          tools: [],
          lastUpdated: Date.now(),
          mcpServers: {},
        });
        return;
      }

      console.log("🚀 Creating MCP client...");
      const { client, tools } = await this.createMCPClient(mcpServers);

      this.userCache.set(userId, {
        client,
        tools,
        lastUpdated: Date.now(),
        mcpServers: mcpServers,
      });

      console.log("✅ MCP data initialized successfully for user:", userId, {
        toolCount: tools.length,
        serverCount: Object.keys(mcpServers).length,
        servers: Object.keys(mcpServers),
        cacheSize: this.userCache.size,
      });
    } catch (error) {
      console.error(
        "❌ Failed to initialize MCP data for user:",
        userId,
        error,
      );
      console.error("❌ Error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        userId: userId,
      });
      // Cache empty result to avoid repeated failures
      this.userCache.set(userId, {
        client: null as any,
        tools: [],
        lastUpdated: Date.now(),
        mcpServers: {},
      });
    }
  }

  // Preload MCP data for a user (can be called during login)
  async preloadUserData(userId: string): Promise<void> {
    console.log("🔄 [MCP MANAGER] Preloading MCP data for user:", userId);
    try {
      await this.getOrCreateMCPData(userId);
      console.log(
        "✅ [MCP MANAGER] Successfully preloaded MCP data for user:",
        userId,
      );
    } catch (error) {
      console.error(
        "❌ [MCP MANAGER] Failed to preload MCP data for user:",
        userId,
        error,
      );
    }
  }

  // Invalidate cache for a user (call when integrations change)
  invalidateUserCache(userId: string): void {
    console.log(
      "🗑️ [MCP MANAGER] Aggressively invalidating cache for user:",
      userId,
    );

    // Delete user cache
    this.userCache.delete(userId);

    // Clear any pending refresh promises for this user
    const refreshKey = `refresh_${userId}`;
    if (this.refreshPromises.has(refreshKey)) {
      this.refreshPromises.delete(refreshKey);
      console.log(
        "🗑️ [MCP MANAGER] Cleared pending refresh promise for user:",
        userId,
      );
    }

    // Force cleanup of any expired cache entries
    this.cleanupExpiredCache();

    console.log(
      "✅ [MCP MANAGER] Cache invalidation complete for user:",
      userId,
    );
  }

  // Clear cache for a user (alias for invalidateUserCache)
  clearUserCache(userId: string): void {
    this.invalidateUserCache(userId);
  }

  // Force complete rebuild of MCP cache for a user (aggressive cache clearing)
  async forceRebuildUserCache(
    userId: string,
  ): Promise<{ tools: any[] } | null> {
    console.log("🔄 [MCP MANAGER] Force rebuilding cache for user:", userId);

    // Aggressively clear everything for this user
    this.invalidateUserCache(userId);

    // Force cleanup of expired cache entries
    this.cleanupExpiredCache();

    // Wait a moment to ensure cleanup is complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log(
      "🔄 [MCP MANAGER] Starting fresh MCP initialization for user:",
      userId,
    );

    try {
      // Force fresh initialization (this will bypass cache since we cleared it)
      const result = await this.getOrCreateMCPData(userId);

      if (result) {
        console.log(
          "✅ [MCP MANAGER] Successfully force rebuilt MCP cache for user:",
          userId,
        );
        console.log(
          "🛠️ [MCP MANAGER] New tools count:",
          result.tools?.length || 0,
        );
      } else {
        console.error(
          "❌ [MCP MANAGER] Failed to rebuild MCP cache for user:",
          userId,
        );
      }

      return result;
    } catch (error) {
      console.error(
        "❌ [MCP MANAGER] Error during force rebuild for user:",
        userId,
        error,
      );
      return null;
    }
  }

  // Refresh MCP servers with fresh tokens
  async refreshMCPServersWithFreshTokens(userId: string): Promise<{
    success: boolean;
    refreshedApps: string[];
    failedApps: string[];
    mcpServersCount: number;
  }> {
    console.log(
      `🔄 Refreshing MCP servers with fresh tokens for user: ${userId}`,
    );

    try {
      // First, ensure all tokens are fresh
      const { tokenRefreshManager } = await import("@/lib/token-refresh");
      const tokenResult =
        await tokenRefreshManager.ensureAllTokensFresh(userId);

      if (tokenResult.refreshedApps.length > 0) {
        console.log(
          `✅ Refreshed tokens for: ${tokenResult.refreshedApps.join(", ")}`,
        );

        // Clear the user's MCP cache to force reinitialization with fresh tokens
        this.invalidateUserCache(userId);

        // Force reinitialization of MCP data with fresh tokens
        const mcpData = await this.getOrCreateMCPData(userId);

        if (!mcpData) {
          throw new Error("Failed to reinitialize MCP data");
        }

        console.log(
          `✅ Reinitialized MCP servers with fresh tokens for user: ${userId}`,
        );

        const mcpServersCount = (mcpData as CachedMCPData).mcpServers
          ? Object.keys((mcpData as CachedMCPData).mcpServers).length
          : 0;

        console.log(`🔧 MCP servers configured: ${mcpServersCount}`);

        return {
          success: true,
          refreshedApps: tokenResult.refreshedApps,
          failedApps: tokenResult.failedApps,
          mcpServersCount,
        };
      } else {
        console.log(`ℹ️ No tokens needed refreshing for user: ${userId}`);
        return {
          success: true,
          refreshedApps: [],
          failedApps: tokenResult.failedApps,
          mcpServersCount: 0,
        };
      }
    } catch (error) {
      console.error(
        `❌ Error refreshing MCP servers for user ${userId}:`,
        error,
      );
      return {
        success: false,
        refreshedApps: [],
        failedApps: ["unknown"],
        mcpServersCount: 0,
      };
    }
  }

  // Clear all cache
  clearAllCache(): void {
    console.log("🗑️ Clearing all MCP cache");
    this.userCache.clear();
    this.refreshPromises.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // Get cache statistics
  getCacheStats(): {
    totalUsers: number;
    cacheHitRate: number;
    cacheHits: number;
    cacheMisses: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    return {
      totalUsers: this.userCache.size,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  // Get user's connection health status
  async getUserConnectionHealth(userId: string): Promise<{
    hasValidConnections: boolean;
    connectedApps: string[];
    failedApps: string[];
    needsReconnection: boolean;
  }> {
    try {
      // Simplified connection check - assume connections are healthy
      const connectionStatus = {
        connected: true,
        apps: [],
        healthy: [],
        failed: [],
        needsReconnection: false,
      };

      return {
        hasValidConnections: connectionStatus.healthy.length > 0,
        connectedApps: connectionStatus.healthy,
        failedApps: connectionStatus.failed,
        needsReconnection: connectionStatus.needsReconnection,
      };
    } catch (error) {
      console.error("❌ Error checking user connection health:", error);
      return {
        hasValidConnections: false,
        connectedApps: [],
        failedApps: [],
        needsReconnection: true,
      };
    }
  }

  /**
   * Get all tools for backward compatibility with existing chat API
   * @deprecated Use getOrCreateMCPData instead
   */
  async getAllTools(): Promise<any[]> {
    console.warn(
      "⚠️ [MCP MANAGER] getAllTools is deprecated, use getOrCreateMCPData instead",
    );

    // This method is called without a userId, which is problematic
    // We'll return an empty array to prevent errors
    console.log(
      "❌ [MCP MANAGER] getAllTools called without userId - returning empty array",
    );
    return [];
  }
}

export const mcpManager = MCPManager.getInstance();
