import axios from "axios";
import { tool } from "@langchain/core/tools";

// Basic Exa API configuration
const EXA_API_CONFIG = {
  BASE_URL: "https://api.exa.ai",
  ENDPOINTS: {
    SEARCH: "/search",
  },
  DEFAULT_NUM_RESULTS: 5,
  DEFAULT_MAX_CHARACTERS: 2000,
} as const;

interface FastWebSearchInput {
  query: string;
  numResults?: number;
}

interface ExaSearchRequest {
  query: string;
  type: "fast";
  numResults: number;
  contents: {
    text: { maxCharacters: number };
    livecrawl: "never" | "always" | "fallback";
  };
}

interface ExaResultItem {
  id?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedDate?: string;
  score?: number;
  text?: string;
  // Allow additional fields without strict typing
  [key: string]: any;
}

interface ExaSearchResponse {
  results?: ExaResultItem[];
  // Allow other metadata fields
  [key: string]: any;
}

/**
 * Fast Web Search (Exa)
 * Performs a fast web search with optional inline page text content.
 * Returns raw JSON string of Exa's response for the model to parse/summarize.
 */
export const fastWebSearchExa = tool(
  async (rawInput: unknown) => {
    const input = ((rawInput as any) || {}) as Record<string, any>;
    const query: string | undefined = input.query;
    // Support multiple aliases for max results
    const requestedResultsRaw =
      input.numResults ??
      input.results ??
      input.k ??
      input.n ??
      input.mexresults ??
      input.mex_results;

    let requestedResults: number | undefined = undefined;
    if (requestedResultsRaw != null) {
      const parsed = Number(requestedResultsRaw);
      requestedResults = Number.isFinite(parsed) ? parsed : undefined;
    }

    if (!query || typeof query !== "string") {
      return "Error: 'query' is required and must be a string.";
    }

    const apiKey = process.env.EXA_API_KEY || "";
    if (!apiKey) {
      return "Error: EXA_API_KEY is not configured on the server.";
    }

    try {
      const axiosInstance = axios.create({
        baseURL: EXA_API_CONFIG.BASE_URL,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        timeout: 25000,
      });

      // Sanitize and clamp results count
      const DEFAULT = EXA_API_CONFIG.DEFAULT_NUM_RESULTS;
      const MAX_SAFE = 20;
      const MIN_SAFE = 1;
      const finalNumResults = Math.min(
        MAX_SAFE,
        Math.max(MIN_SAFE, requestedResults ?? DEFAULT),
      );

      const searchRequest: ExaSearchRequest = {
        query,
        type: "fast",
        numResults: finalNumResults,
        contents: {
          text: { maxCharacters: EXA_API_CONFIG.DEFAULT_MAX_CHARACTERS },
          livecrawl: "never",
        },
      };

      const response = await axiosInstance.post<ExaSearchResponse>(
        EXA_API_CONFIG.ENDPOINTS.SEARCH,
        searchRequest,
        { timeout: 25000 },
      );

      if (!response.data || !response.data.results || response.data.results.length === 0) {
        return `No search results found for query: "${query}"`;
      }

      // Return raw JSON string so the model can decide how to use it
      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status ?? "unknown";
        const errorMessage = (error.response?.data as any)?.message || error.message || "Unknown error";
        return `Search error (${statusCode}): ${errorMessage}`;
      }
      return `Search error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "fast_web_search",
    description:
      "Search the web using Exa AI (fast mode) and optionally include text content from results. Returns raw JSON string for the model to parse.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: {
          type: "number",
          description: "Number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
  },
);
