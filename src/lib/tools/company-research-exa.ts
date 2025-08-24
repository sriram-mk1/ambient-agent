import axios from "axios";
import { tool } from "@langchain/core/tools";

const EXA_BASE_URL = "https://api.exa.ai" as const;
const EXA_SEARCH_ENDPOINT = "/search" as const;
const DEFAULT_NUM_RESULTS = 5;
const DEFAULT_MAX_CHARACTERS = 3000;

interface ExaSearchRequest {
  query: string;
  type: "auto" | string;
  numResults: number;
  contents: {
    text: { maxCharacters: number };
    livecrawl?: "preferred" | "always" | "never" | string;
  };
  includeDomains?: string[];
}

interface ExaSearchResponse {
  results?: any[];
  [k: string]: any;
}

export const companyResearchExa = tool(
  async (rawInput: unknown) => {
    const input = ((rawInput as any) || {}) as { companyName?: string; numResults?: number };
    const companyName = typeof input.companyName === "string" ? input.companyName : undefined;
    const numResults = typeof input.numResults === "number" ? input.numResults : undefined;

    if (!companyName) {
      return "Error: 'companyName' is required and must be a string.";
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

      const searchRequest: ExaSearchRequest = {
        query: `${companyName} company business corporation information news financial`,
        type: "auto",
        numResults: numResults ?? DEFAULT_NUM_RESULTS,
        contents: {
          text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
          livecrawl: "preferred",
        },
        includeDomains: [
          // core
          "bloomberg.com",
          "reuters.com",
          "crunchbase.com",
          "sec.gov",
          "linkedin.com",
          "forbes.com",
          "businesswire.com",
          "prnewswire.com",
          // industry research + reputable news
          "ft.com",
          "wsj.com",
          "economist.com",
          "cnbc.com",
          "marketwatch.com",
          "barrons.com",
          "gartner.com",
          "idc.com",
          "forrester.com",
          "statista.com",
          // tech/startup
          "techcrunch.com",
          "theverge.com",
          "wired.com",
          "venturebeat.com",
          "sifted.eu",
          "geekwire.com",
        ],
      };

      const response = await axiosInstance.post<ExaSearchResponse>(
        EXA_SEARCH_ENDPOINT,
        searchRequest,
        { timeout: 25000 },
      );

      if (!response.data || !response.data.results) {
        return "No company information found. Please try a different company name.";
      }

      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || "unknown";
        const errorMessage = (error.response?.data as any)?.message || error.message;
        return `Company research error (${statusCode}): ${errorMessage}`;
      }
      return `Company research error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "company_research_exa",
    description:
      "Research companies using Exa AI across authoritative business and news sources. Returns raw JSON of results.",
    schema: {
      type: "object",
      properties: {
        companyName: { type: "string", description: "Name of the company to research" },
        numResults: { type: "number", description: "Number of results (default: 5)" },
      },
      required: ["companyName"],
    },
  },
);
