import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { zepManager } from "@/lib/zep-manager";
import type { GraphResponse, GraphLink, GraphNode } from "@/types/memory-graph";

const QuerySchema = z.object({
  nodeId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  scoreMin: z.coerce.number().min(0).max(1).default(0),
});

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_params", details: parsed.error.flatten() }, { status: 400 });
    }

    const { nodeId, limit, scoreMin } = parsed.data;
    const perCallLimit = Math.min(Math.max(limit || 50, 1), 50);
    console.log("[GET /api/memory-graph/expand] params:", { nodeId, limit, perCallLimit, scoreMin });
    const user = await getUser();
    if (!user?.id) {
      console.warn("[GET /api/memory-graph/expand] Unauthorized: missing user");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    console.log("[GET /api/memory-graph/expand] userId:", user.id);

    // Use a query that finds neighbors of the specific node.
    // Depending on Zep graph.search capabilities, we can use a structured query or fallback to textual search including node id/name.
    const [edgesResult, nodesResult] = await Promise.all([
      zepManager.searchMemory(user.id, nodeId, perCallLimit, "edges"),
      zepManager.searchMemory(user.id, nodeId, perCallLimit, "nodes"),
    ]);

    const rawEdges: any[] = edgesResult?.edges || [];
    const rawNodes: any[] = nodesResult?.nodes || [];
    console.log("[GET /api/memory-graph/expand] results:", {
      edges: rawEdges.length,
      nodes: rawNodes.length,
    });

    const nodes: GraphNode[] = rawNodes.map((n: any) => ({
      id: String(n.id || n.name || n.nodeId || n.uuid),
      type: (n.type || n.kind || "entity") as any,
      label: String(n.name || n.title || n.id || "node"),
      summary: n.summary || n.description || undefined,
      createdAt: n.createdAt || n.metadata?.createdAt,
      metadata: n.metadata || {},
    }));

    const nodeIdSet = new Set(nodes.map((n) => n.id));

    const links: GraphLink[] = rawEdges
      .filter((e: any) => (e.score ?? 1) >= scoreMin)
      .map((e: any) => {
        const source = String(e.sourceId || e.source || e.from || e.src);
        const target = String(e.targetId || e.target || e.to || e.dst);
        return {
          source,
          target,
          type: String(e.type || e.relation || e.kind || "similar_to"),
          score: typeof e.score === "number" ? e.score : undefined,
          createdAt: e.createdAt || e.metadata?.createdAt,
          metadata: e.metadata || {},
        };
      });

    for (const l of links) {
      if (!nodeIdSet.has(l.source)) {
        nodes.push({ id: l.source, type: "entity", label: l.source });
        nodeIdSet.add(l.source);
      }
      if (!nodeIdSet.has(l.target)) {
        nodes.push({ id: l.target, type: "entity", label: l.target });
        nodeIdSet.add(l.target);
      }
    }

    const degreeMap = new Map<string, number>();
    for (const l of links) {
      degreeMap.set(l.source, (degreeMap.get(l.source) || 0) + 1);
      degreeMap.set(l.target, (degreeMap.get(l.target) || 0) + 1);
    }
    for (const n of nodes) n.degree = degreeMap.get(n.id) || 0;

    // Fallback: if no links returned for expansion, connect the expanded node to a few neighbors by id
    if (links.length === 0 && nodes.length > 1) {
      console.log("[GET /api/memory-graph/expand] No links. Generating fallback star links.");
      const center = nodeId;
      for (const n of nodes) {
        if (n.id !== center) {
          links.push({ source: center, target: n.id, type: "similar_to", score: 0.1 });
        }
      }
    }

    const payload: GraphResponse = {
      nodes,
      links,
      stats: { nodeCount: nodes.length, linkCount: links.length },
    };
    console.log("[GET /api/memory-graph/expand] payload counts:", payload.stats);

    return NextResponse.json(payload);
  } catch (err) {
    console.error("/api/memory-graph/expand failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
