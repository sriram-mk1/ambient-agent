import axios from "axios";
import { tool } from "@langchain/core/tools";

const EXA_BASE_URL = "https://api.exa.ai" as const;
const EXA_SEARCH_ENDPOINT = "/search" as const;
const DEFAULT_NUM_RESULTS = 10;
const DEFAULT_MAX_CHARACTERS = 4000;

function platformsToDomains(platforms?: string[]): string[] {
  if (!platforms || platforms.length === 0) {
    return [
      "reddit.com",
      "news.ycombinator.com",
      "x.com",
      "twitter.com",
      "producthunt.com",
      "indiehackers.com",
      "quora.com",
      "youtube.com",
      "medium.com",
      "substack.com",
    ];
  }
  const set = new Set<string>();
  for (const p of platforms) {
    switch (p) {
      case "reddit":
        set.add("reddit.com");
        break;
      case "hackernews":
        set.add("news.ycombinator.com");
        break;
      case "twitter":
      case "x":
        set.add("x.com");
        set.add("twitter.com");
        break;
      case "producthunt":
        set.add("producthunt.com");
        break;
      case "indiehackers":
        set.add("indiehackers.com");
        break;
      case "quora":
        set.add("quora.com");
        break;
      case "youtube":
        set.add("youtube.com");
        break;
      case "medium":
        set.add("medium.com");
        break;
      case "substack":
        set.add("substack.com");
        break;
    }
  }
  return Array.from(set);
}

function buildQuery(topic: string, intent?: string) {
  const base = topic.trim();
  const map: Record<string, string[]> = {
    idea_gen: ["ideas", "brainstorm", "what if", "new features", "breakthrough"],
    validation: [
      "is this worth it",
      "does anyone want",
      "looking for",
      "recommend",
      "buy",
      "pay for",
    ],
    pain_points: ["pain points", "frustrations", "hate", "struggle", "problem", "why is it so hard"],
    sentiment: ["reviews", "opinions", "discussion", "feedback", "experience"],
    feature_ideas: ["feature requests", "wishlist", "missing features", "roadmap"],
    market_map: ["alternatives", "competitors", "comparison", "vs", "landscape"],
  };
  const hints = map[intent || "validation"] || map.validation;
  return `${base} ${hints.join(" ")}`;
}

export const socialDiscussionSearchExa = tool(
  async (rawInput: unknown) => {
    const input = ((rawInput as any) || {}) as {
      topic?: string;
      intent?: "idea_gen" | "validation" | "pain_points" | "sentiment" | "feature_ideas" | "market_map";
      platforms?: string[];
      numResults?: number;
    };

    const topic = typeof input.topic === "string" ? input.topic : undefined;
    const intent = input.intent;
    const platforms = Array.isArray(input.platforms) ? (input.platforms as string[]) : undefined;
    const numResults = typeof input.numResults === "number" ? input.numResults : undefined;

    if (!topic) {
      return "Error: 'topic' is required and must be a string.";
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

      const includeDomains = platformsToDomains(platforms);
      const searchQuery = buildQuery(topic, intent);

      const searchRequest = {
        query: searchQuery,
        type: "neural",
        numResults: numResults ?? DEFAULT_NUM_RESULTS,
        contents: {
          text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
          livecrawl: "preferred",
        },
        includeDomains,
      };

      const response = await axiosInstance.post(
        EXA_SEARCH_ENDPOINT,
        searchRequest,
        { timeout: 25000 },
      );

      if (!response.data || !response.data.results) {
        return "No relevant discussions found. Try broadening the topic or changing intent/platforms.";
      }

      return JSON.stringify(response.data, null, 2);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || "unknown";
        const errorMessage = (error.response?.data as any)?.message || error.message;
        return `Social discussion search error (${statusCode}): ${errorMessage}`;
      }
      return `Social discussion search error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "social_discussion_search_exa",
    description:
      "Search social/community discussions (Reddit, Hacker News, X/Twitter, Product Hunt, etc.) via Exa AI. Returns raw JSON.",
    schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic or idea to analyze" },
        intent: {
          type: "string",
          enum: [
            "idea_gen",
            "validation",
            "pain_points",
            "sentiment",
            "feature_ideas",
            "market_map",
          ],
          description: "Analysis intent to bias the search (default: validation)",
        },
        platforms: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "reddit",
              "hackernews",
              "twitter",
              "x",
              "producthunt",
              "indiehackers",
              "quora",
              "youtube",
              "medium",
              "substack",
            ],
          },
          description: "Platforms to search (default: common discussion sites)",
        },
        numResults: { type: "number", description: "Number of results (default: 10)" },
      },
      required: ["topic"],
    },
  },
);
