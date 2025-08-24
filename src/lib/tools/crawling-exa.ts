import axios from "axios";
import { tool } from "@langchain/core/tools";

const EXA_BASE_URL = "https://api.exa.ai" as const;
const EXA_CONTENTS_ENDPOINT = "/contents" as const;
const DEFAULT_MAX_CHARACTERS = 3000;

export const crawlingExa = tool(
  async (rawInput: unknown) => {
    const input = ((rawInput as any) || {}) as { url?: string; maxCharacters?: number };
    const url = typeof input.url === "string" ? input.url : undefined;
    const maxCharacters =
      typeof input.maxCharacters === "number" ? input.maxCharacters : undefined;

    if (!url) {
      return "Error: 'url' is required and must be a string.";
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

      const crawlRequest = {
        ids: [url],
        contents: {
          text: {
            maxCharacters: maxCharacters ?? DEFAULT_MAX_CHARACTERS,
          },
          livecrawl: "preferred",
        },
      };

      const response = await axiosInstance.post(
        EXA_CONTENTS_ENDPOINT,
        crawlRequest,
        { timeout: 25000 },
      );

      if (!response.data || !response.data.results) {
        return "No content found for the provided URL.";
      }

      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || "unknown";
        const errorMessage = (error.response?.data as any)?.message || error.message;
        return `Crawling error (${statusCode}): ${errorMessage}`;
      }

      return `Crawling error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "crawling_exa",
    description:
      "Crawl and extract full text content from a specific URL via Exa AI. Returns raw JSON including content and metadata.",
    schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to crawl and extract content from" },
        maxCharacters: {
          type: "number",
          description: "Maximum characters to extract (default: 3000)",
        },
      },
      required: ["url"],
    },
  },
);
