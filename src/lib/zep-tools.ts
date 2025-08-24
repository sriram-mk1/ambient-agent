import { tool } from "@langchain/core/tools";
import { zepManager } from "./zep-manager";

// Simple type definitions instead of zod schemas to avoid TypeScript issues
interface SearchFactsInput {
  query: string;
  limit?: number;
}

interface AddContextualDataInput {
  context: string;
  source?: string;
}

interface SearchMemoryInput {
  query: string;
  limit?: number;
  scope?: "edges" | "nodes";
}

// Current user context - will be set by the chat handler
let currentUserId: string = "";

export const setCurrentUserId = (userId: string) => {
  currentUserId = userId;
};

// Streamlined Zep Memory Tools - only essential ones to avoid noise
export const searchUserFacts = tool(
  async (input: unknown) => {
    try {
      const { query, limit = 5 } = input as SearchFactsInput;

      if (!currentUserId) {
        return "Error: No user context available for memory search.";
      }

      const facts = await zepManager.searchUserFacts(
        currentUserId,
        query,
        limit,
      );

      if (facts.length === 0) {
        return `No facts found for query: "${query}"`;
      }

      return `Found ${facts.length} relevant facts:\n${facts.map((fact: string, i: number) => `${i + 1}. ${fact}`).join("\n")}`;
    } catch (error) {
      console.error("Error in searchUserFacts tool:", error);
      return `Error searching for facts: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "search_user_facts",
    description: "Search for facts about the current user from their memory.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 5 },
      },
      required: ["query"],
    },
  },
);

export const addContextualData = tool(
  async (input: unknown) => {
    try {
      const { context, source } = input as AddContextualDataInput;

      if (!currentUserId) {
        return "Error: No user context available for storing memory.";
      }

      const success = await zepManager.addContextualData(
        currentUserId,
        context,
        source,
      );

      if (success) {
        return `Successfully added contextual data${source ? ` from ${source}` : ""} to user's memory.`;
      } else {
        return "Failed to add contextual data to user's memory.";
      }
    } catch (error) {
      console.error("Error in addContextualData tool:", error);
      return `Error adding contextual data: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "add_contextual_data",
    description:
      "Store important facts about the current user for future conversations.",
    schema: {
      type: "object",
      properties: {
        context: { type: "string" },
        source: { type: "string" },
      },
      required: ["context"],
    },
  },
);

export const searchMemoryGraph = tool(
  async (input: unknown) => {
    try {
      const { query, limit = 10, scope = "edges" } = input as SearchMemoryInput;

      if (!currentUserId) {
        return "Error: No user context available for memory search.";
      }

      const results = await zepManager.searchMemory(
        currentUserId,
        query,
        limit,
        scope,
      );

      if (!results) {
        return `No results found for query: "${query}"`;
      }

      if (scope === "edges" && results.edges) {
        const facts = results.edges
          .filter((edge: any) => edge.fact)
          .map((edge: any, i: number) => `${i + 1}. ${edge.fact}`)
          .join("\n");

        return facts || `No facts found for query: "${query}"`;
      } else if (scope === "nodes" && results.nodes) {
        const entities = results.nodes
          .map(
            (node: any, i: number) =>
              `${i + 1}. ${node.name || node.id}: ${node.summary || "No summary"}`,
          )
          .join("\n");

        return entities || `No entities found for query: "${query}"`;
      }

      return `No results found for query: "${query}"`;
    } catch (error) {
      console.error("Error in searchMemoryGraph tool:", error);
      return `Error searching memory graph: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
  {
    name: "search_memory_graph",
    description:
      "Search the current user's memory graph for specific facts or entities.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 10 },
        scope: { type: "string", enum: ["edges", "nodes"], default: "edges" },
      },
      required: ["query"],
    },
  },
);

// Export streamlined tools array - removed bulk memory tools to prevent noise
export const zepMemoryTools = [
  searchUserFacts,
  addContextualData,
  searchMemoryGraph,
];

// Export individual tool names for reference - streamlined set
export const ZepToolNames = {
  SEARCH_USER_FACTS: "search_user_facts",
  ADD_CONTEXTUAL_DATA: "add_contextual_data",
  SEARCH_MEMORY_GRAPH: "search_memory_graph",
} as const;

// Helper function to get tool by name
export const getZepToolByName = (name: string) => {
  return zepMemoryTools.find((tool) => tool.name === name);
};

// Simple memory management helper functions
export class ZepMemoryHelper {
  static async initializeUserMemory(userId: string): Promise<string | null> {
    try {
      const sessionId = await zepManager.createSession(userId);
      return sessionId;
    } catch (error) {
      console.error("Failed to initialize user memory:", error);
      return null;
    }
  }

  // Simple method - don't auto-store conversations, let agent decide
  static isWorthStoringInMemory(): boolean {
    return false; // Agent will use tools manually
  }

  // Remove automatic conversation storage - agent uses tools manually
  static async addConversationToMemory(): Promise<boolean> {
    return true; // No-op, agent handles memory with tools
  }

  static async getContextForPrompt(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    try {
      const facts = await zepManager.searchUserFacts(
        userId,
        "user preferences",
        3,
      );

      if (facts.length > 0) {
        return `Previous context:\n${facts.map((fact: string, i: number) => `${i + 1}. ${fact}`).join("\n")}\n`;
      }
      return "";
    } catch (error) {
      console.error("Failed to get context for prompt:", error);
      return "";
    }
  }

  // Remove automatic fact extraction - agent handles this with tools
  static async extractAndStoreImportantFacts(): Promise<void> {
    // No-op, agent uses add_contextual_data tool manually
  }
}
