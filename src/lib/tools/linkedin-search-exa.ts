import axios from "axios";
import { tool } from "@langchain/core/tools";

const EXA_BASE_URL = "https://api.exa.ai" as const;
const EXA_SEARCH_ENDPOINT = "/search" as const;
const DEFAULT_NUM_RESULTS = 5;
const DEFAULT_MAX_CHARACTERS = 3000;

export const linkedinSearchExa = tool(
  async (rawInput: unknown) => {
    const input = ((rawInput as any) || {}) as {
      query?: string;
      searchType?: "profiles" | "companies" | "all";
      numResults?: number;
    };

    const query = typeof input.query === "string" ? input.query : undefined;
    const searchType = input.searchType || "all";
    const numResults = typeof input.numResults === "number" ? input.numResults : undefined;

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

      let searchQuery = query;
      if (searchType === "profiles") {
        searchQuery = `${query} LinkedIn profile`;
      } else if (searchType === "companies") {
        searchQuery = `${query} LinkedIn company`;
      } else {
        searchQuery = `${query} LinkedIn`;
      }

      const searchRequest = {
        query: searchQuery,
        type: "neural",
        numResults: numResults ?? DEFAULT_NUM_RESULTS,
        contents: {
          text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
          livecrawl: "preferred",
        },
        includeDomains: ["linkedin.com"],
      };

      const response = await axiosInstance.post(
        EXA_SEARCH_ENDPOINT,
        searchRequest,
        { timeout: 25000 },
      );

      if (!response.data || !response.data.results) {
        return "No LinkedIn content found. Please try a different query.";
      }

      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || "unknown";
        const errorMessage = (error.response?.data as any)?.message || error.message;
        return `LinkedIn search error (${statusCode}): ${errorMessage}`;
      }

      return `LinkedIn search error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "linkedin_search_exa",
    description:
      "Search LinkedIn profiles and company pages via Exa AI. Use searchType to bias toward profiles or companies. Returns raw JSON.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "LinkedIn search query (e.g., name, company, title)" },
        searchType: {
          type: "string",
          enum: ["profiles", "companies", "all"],
          description: "Type of LinkedIn content to search (default: all)",
        },
        numResults: { type: "number", description: "Number of results (default: 5)" },
      },
      required: ["query"],
    },
  },
);
