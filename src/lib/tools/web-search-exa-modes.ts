import axios from "axios";
import { tool } from "@langchain/core/tools";

const EXA_BASE_URL = "https://api.exa.ai" as const;
const EXA_SEARCH_ENDPOINT = "/search" as const;
const DEFAULT_NUM_RESULTS = 5;
const DEFAULT_MAX_CHARACTERS = 3000 as const;

type SearchMode = "auto" | "neural";

export const webSearchExa = tool(
  async (rawInput: unknown) => {
    const input = ((rawInput as any) || {}) as {
      query?: string;
      numResults?: number;
      mode?: SearchMode;
    };

    const query = typeof input.query === "string" ? input.query : undefined;
    const numResults = typeof input.numResults === "number" ? input.numResults : undefined;
    const mode: SearchMode = (input.mode as SearchMode) || "auto";

    if (!query) {
      return "Error: 'query' is required and must be a string.";
    }

    const apiKey = process.env.EXA_API_KEY || "";
    if (!apiKey) {
      return "Error: EXA_API_KEY is not configured on the server.";
    }

    try {
      const axiosInstance = axios.create({
        baseURL: EXA_BASE_URL,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        timeout: 25000,
      });

      const searchRequest = {
        query,
        type: mode,
        numResults: numResults ?? DEFAULT_NUM_RESULTS,
        contents: {
          text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
          livecrawl: "preferred",
        },
      };

      const response = await axiosInstance.post(
        EXA_SEARCH_ENDPOINT,
        searchRequest,
        { timeout: 25000 },
      );

      if (!response.data || !response.data.results) {
        return "No search results found. Please try a different query.";
      }

      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || "unknown";
        const errorMessage = (error.response?.data as any)?.message || error.message;
        return `Search error (${statusCode}): ${errorMessage}`;
      }

      return `Search error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "web_search_exa",
    description:
      "Search the web using Exa AI (auto or neural modes). Returns raw JSON with results and optional page text.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: { type: "number", description: "Number of results (default: 5)" },
        mode: {
          type: "string",
          enum: ["auto", "neural"],
          description: "Search mode: 'auto' (balanced) or 'neural' (higher recall)",
        },
      },
      required: ["query"],
    },
  },
);
