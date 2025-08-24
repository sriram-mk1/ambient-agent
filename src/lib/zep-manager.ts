import { ZepClient } from "@getzep/zep-cloud";
import { createClient as createServerClient } from "@/lib/supabase/server";

interface ZepUser {
  user_id: string;
  email?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  metadata?: Record<string, any> | undefined;
}

interface ZepSession {
  session_id: string;
  user_id: string;
  metadata?: Record<string, any>;
}

interface ZepMessage {
  role: "user" | "assistant" | "system";
  content: string;
  role_type?: "user" | "assistant" | "system";
  metadata?: Record<string, any>;
}

interface MemoryContext {
  context: string;
  facts: any[];
  messages: ZepMessage[];
  summary?: string;
}

interface GraphSearchResult {
  edges?: any[];
  nodes?: any[];
}

interface CachedZepData {
  client: ZepClient;
  user: ZepUser;
  currentSession: ZepSession | null;
  lastUpdated: number;
}

class ZepManager {
  private static instance: ZepManager;
  private userCache = new Map<string, CachedZepData>();
  private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  private zepApiKey: string;

  private constructor() {
    this.zepApiKey = process.env.ZEP_API_KEY || "";

    if (!this.zepApiKey) {
      console.warn("⚠️ ZEP_API_KEY not found in environment variables");
    }

    // Cleanup expired cache periodically
    setInterval(() => this.cleanupExpiredCache(), 5 * 60 * 1000); // Every 5 minutes
  }

  static getInstance(): ZepManager {
    if (!ZepManager.instance) {
      ZepManager.instance = new ZepManager();
    }
    return ZepManager.instance;
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [userId, data] of this.userCache.entries()) {
      if (now - data.lastUpdated > this.CACHE_TTL) {
        console.log(`🧹 Cleaning up expired Zep cache for user: ${userId}`);
        this.userCache.delete(userId);
      }
    }
  }

  private createZepClient(): ZepClient {
    return new ZepClient({
      apiKey: this.zepApiKey,
    });
  }

  async getOrCreateZepData(userId: string): Promise<CachedZepData | null> {
    if (!userId) {
      console.log("❌ No user ID provided for Zep");
      return null;
    }

    if (!this.zepApiKey) {
      console.log("❌ Zep API key not configured");
      return null;
    }

    // Check cache first
    const cached = this.userCache.get(userId);
    if (cached && Date.now() - cached.lastUpdated < this.CACHE_TTL) {
      console.log("✅ Using cached Zep data for user:", userId);
      return cached;
    }

    console.log("🚀 Initializing Zep data for user:", userId);

    try {
      const client = this.createZepClient();

      // Get user details from Supabase for Zep user creation
      const userDetails = await this.getUserDetails(userId);

      // Create or get Zep user
      const zepUser = await this.createOrGetZepUser(
        client,
        userId,
        userDetails,
      );

      const zepData: CachedZepData = {
        client,
        user: zepUser,
        currentSession: null,
        lastUpdated: Date.now(),
      };

      this.userCache.set(userId, zepData);
      console.log("✅ Zep data initialized successfully for user:", userId);

      return zepData;
    } catch (error) {
      console.error("❌ Failed to initialize Zep data:", error);
      return null;
    }
  }

  private async getUserDetails(userId: string): Promise<Partial<ZepUser>> {
    try {
      const supabase = await createServerClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        console.log("⚠️ Could not get user details from Supabase for Zep");
        return { user_id: userId };
      }

      // Extract name from user metadata or email
      let firstName = "";
      let lastName = "";

      if (user.user_metadata?.full_name) {
        const nameParts = user.user_metadata.full_name.split(" ");
        firstName = nameParts[0] || "";
        lastName = nameParts.slice(1).join(" ") || "";
      } else if (user.email) {
        // Use email username as first name if no full name available
        firstName = user.email.split("@")[0] || "";
      }

      return {
        user_id: userId,
        email: user.email,
        first_name: firstName,
        last_name: lastName,
        metadata: {
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          supabase_user_id: user.id,
        },
      };
    } catch (error) {
      console.error("❌ Error getting user details:", error);
      return { user_id: userId };
    }
  }

  private async createOrGetZepUser(
    client: ZepClient,
    userId: string,
    userDetails: Partial<ZepUser>,
  ): Promise<ZepUser> {
    try {
      // Try to get existing user first
      console.log(`🔍 Checking if Zep user exists: ${userId}`);
      const existingUser = await client.user.get(userId);

      if (existingUser) {
        console.log(`✅ Found existing Zep user: ${userId}`);
        return {
          user_id: userId,
          email: existingUser.email,
          first_name: existingUser.firstName,
          last_name: existingUser.lastName,
          metadata: existingUser.metadata,
        };
      }
    } catch (error) {
      // User doesn't exist, we'll create them
      console.log(`📝 Zep user doesn't exist, creating: ${userId}`);
    }

    try {
      // Create new Zep user
      const newUser = await client.user.add({
        userId: userId,
        email: userDetails.email,
        firstName: userDetails.first_name || "User",
        lastName: userDetails.last_name || "",
        metadata: userDetails.metadata || {},
      });

      console.log(`✅ Created new Zep user: ${userId}`);
      return {
        user_id: userId,
        email: newUser.email,
        first_name: newUser.firstName,
        last_name: newUser.lastName,
        metadata: newUser.metadata,
      };
    } catch (error) {
      console.error(`❌ Failed to create Zep user: ${userId}`, error);
      throw error;
    }
  }

  async createSession(
    userId: string,
    sessionId?: string,
  ): Promise<string | null> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return null;

    try {
      const finalSessionId = sessionId || `session_${userId}_${Date.now()}`;

      const session = await zepData.client.memory.addSession({
        sessionId: finalSessionId,
        userId: userId,
        metadata: {
          createdAt: new Date().toISOString(),
          source: "ai-agent-chat",
        },
      });

      zepData.currentSession = {
        session_id: finalSessionId,
        user_id: userId,
        metadata: session.metadata || {},
      };

      console.log(`✅ Created Zep session: ${finalSessionId}`);
      return finalSessionId;
    } catch (error) {
      console.error("❌ Failed to create Zep session:", error);
      return null;
    }
  }

  async addMessage(
    userId: string,
    sessionId: string,
    message: ZepMessage,
  ): Promise<boolean> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return false;

    try {
      await zepData.client.memory.add(sessionId, {
        messages: [
          {
            role: message.role,
            content: message.content,
            roleType: message.role_type || message.role,
            metadata: message.metadata || {},
          },
        ],
      });

      console.log(`✅ Added message to Zep session: ${sessionId}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to add message to Zep:", error);
      return false;
    }
  }

  async addMessages(
    userId: string,
    sessionId: string,
    messages: ZepMessage[],
  ): Promise<boolean> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return false;

    try {
      await zepData.client.memory.add(sessionId, {
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          roleType: msg.role_type || msg.role,
          metadata: msg.metadata || {},
        })),
      });

      console.log(
        `✅ Added ${messages.length} messages to Zep session: ${sessionId}`,
      );
      return true;
    } catch (error) {
      console.error("❌ Failed to add messages to Zep:", error);
      return false;
    }
  }

  async getMemoryContext(
    userId: string,
    sessionId: string,
    query?: string,
  ): Promise<MemoryContext | null> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return null;

    try {
      // Get session memory
      const memory = await zepData.client.memory.get(sessionId);

      const context: MemoryContext = {
        context: memory.context || "",
        facts: memory.facts || [],
        messages: (memory.messages || []).slice(-10).map((msg: any) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
          role_type: msg.roleType,
          metadata: msg.metadata,
        })),
        summary: memory.summary?.content,
      };

      console.log(`✅ Retrieved memory context for session: ${sessionId}`);
      return context;
    } catch (error) {
      console.error("❌ Failed to get memory context:", error);
      return null;
    }
  }

  async searchMemory(
    userId: string,
    query: string,
    limit: number = 10,
    scope: "edges" | "nodes" = "edges",
  ): Promise<GraphSearchResult | null> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return null;

    try {
      console.log("[ZepManager.searchMemory]", { userId, query, limit, scope });
      // Search across user's graph
      const results = await zepData.client.graph.search({
        query,
        userId: userId,
        limit,
        scope,
      });

      const count = scope === "edges" ? results.edges?.length : results.nodes?.length;
      console.log("[ZepManager.searchMemory] results count:", count);
      return results;
    } catch (error) {
      console.error("❌ Failed to search memory:", error);
      return null;
    }
  }

  async getGraph(graphId: string): Promise<any | null> {
    try {
      if (!this.zepApiKey) return null;
      const client = this.createZepClient();
      // Typing based on SDK: accept either string or object
      const graph = await (client as any).graph.get({ graphId });
      return graph || null;
    } catch (error) {
      console.error("❌ Failed to get graph:", error);
      return null;
    }
  }

  async addUserData(
    userId: string,
    data: string | Record<string, any>,
    type: "text" | "json" = "text",
  ): Promise<boolean> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return false;

    try {
      const dataToAdd = type === "json" ? JSON.stringify(data) : String(data);

      await zepData.client.graph.add({
        userId: userId,
        type,
        data: dataToAdd,
      });

      console.log(`✅ Added user data to Zep graph for user: ${userId}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to add user data to Zep:", error);
      return false;
    }
  }

  async addGroupData(
    groupId: string,
    data: string | Record<string, any>,
    type: "text" | "json" = "text",
  ): Promise<boolean> {
    if (!this.zepApiKey) return false;

    try {
      const client = this.createZepClient();
      const dataToAdd = type === "json" ? JSON.stringify(data) : String(data);

      await client.graph.add({
        groupId: groupId,
        type,
        data: dataToAdd,
      });

      console.log(`✅ Added group data to Zep graph for group: ${groupId}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to add group data to Zep:", error);
      return false;
    }
  }

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return false;

    try {
      // Use the correct method for deleting session memory
      await zepData.client.memory.delete(sessionId);

      // Clear current session if it matches
      if (zepData.currentSession?.session_id === sessionId) {
        zepData.currentSession = null;
      }

      console.log(`✅ Deleted Zep session: ${sessionId}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to delete Zep session:", error);
      return false;
    }
  }

  async getUserSessions(userId: string): Promise<ZepSession[]> {
    const zepData = await this.getOrCreateZepData(userId);
    if (!zepData) return [];

    try {
      const sessions = await zepData.client.user.getSessions(userId);

      return sessions.map((session: any) => ({
        session_id: session.sessionId,
        user_id: session.userId,
        metadata: session.metadata,
      }));
    } catch (error) {
      console.error("❌ Failed to get user sessions:", error);
      return [];
    }
  }

  // Memory Tools for AI Agent
  async searchUserFacts(
    userId: string,
    query: string,
    limit: number = 5,
  ): Promise<string[]> {
    try {
      const results = await this.searchMemory(userId, query, limit, "edges");
      if (!results?.edges) return [];

      return results.edges
        .filter((edge) => edge.fact)
        .map((edge) => edge.fact)
        .slice(0, limit);
    } catch (error) {
      console.error("❌ Failed to search user facts:", error);
      return [];
    }
  }

  async getRecentConversationContext(
    userId: string,
    sessionId: string,
    messageCount: number = 10,
  ): Promise<ZepMessage[]> {
    try {
      const context = await this.getMemoryContext(userId, sessionId);
      if (!context?.messages) return [];

      return context.messages.slice(-messageCount);
    } catch (error) {
      console.error("❌ Failed to get recent conversation context:", error);
      return [];
    }
  }

  async getMemoryContextString(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    try {
      const context = await this.getMemoryContext(userId, sessionId);
      if (!context) return "";

      return context.context || "";
    } catch (error) {
      console.error("❌ Failed to get memory context string:", error);
      return "";
    }
  }

  // Tool: Add business data or context
  async addContextualData(
    userId: string,
    context: string,
    source?: string,
  ): Promise<boolean> {
    try {
      return await this.addUserData(
        userId,
        `${source ? `[${source}] ` : ""}${context}`,
        "text",
      );
    } catch (error) {
      console.error("❌ Failed to add contextual data:", error);
      return false;
    }
  }

  // Cache management methods
  invalidateUserCache(userId: string): void {
    console.log("🗑️ Invalidating Zep cache for user:", userId);
    this.userCache.delete(userId);
  }

  clearAllCache(): void {
    console.log("🗑️ Clearing all Zep cache");
    this.userCache.clear();
  }

  getCacheStats(): { totalUsers: number; cacheHitRate: number } {
    return {
      totalUsers: this.userCache.size,
      cacheHitRate: 0, // Could implement hit/miss tracking
    };
  }
}

export const zepManager = ZepManager.getInstance();
export type {
  ZepUser,
  ZepSession,
  ZepMessage,
  MemoryContext,
  GraphSearchResult,
};
