export type GraphNodeType = "memory" | "entity" | "tag" | "document" | "conversation";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  summary?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  degree?: number;
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: "references" | "mentions" | "tagged_by" | "similar_to" | "temporal_next" | string;
  score?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  stats?: {
    nodeCount: number;
    linkCount: number;
    byType?: Record<string, number>;
  };
}
