import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import type { GraphResponse, GraphLink, GraphNode } from "@/types/memory-graph";
import { zepManager } from "@/lib/zep-manager";

const QuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  scope: z.enum(["edges", "nodes"]).optional(),
  scoreMin: z.coerce.number().min(0).max(1).default(0),
  types: z.string().optional(),
  since: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsed = QuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_params", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { q, limit, scoreMin, scope } = parsed.data;
    const perCallLimit = Math.min(Math.max(limit || 50, 1), 50); // Zep cap 50
    console.log("[GET /api/memory-graph] params:", {
      q,
      limit,
      perCallLimit,
      scoreMin,
      scope,
    });

    const user = await getUser();
    if (!user?.id) {
      console.warn("[GET /api/memory-graph] Unauthorized: missing user");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    console.log("[GET /api/memory-graph] userId:", user.id);

    // Replace SDK approach with searchMemory-only flow and deep logging
    let rawNodes: any[] = [];
    let rawEdges: any[] = [];
    try {
      const queryText = "*";
      console.log("[SEARCH] calling zepManager.searchMemory for nodes", { userId: user.id, limit: perCallLimit });
      const nodesRes: any = await zepManager.searchMemory(user.id, queryText, perCallLimit, "nodes");
      rawNodes = nodesRes?.nodes || [];
      console.log("[SEARCH] nodes result:", rawNodes);
      try {
        console.log(`[NODES] total: ${rawNodes.length}`);
        (rawNodes || []).forEach((n: any, i: number) => {
          const id = n.uuid || n.id || n.nodeId || n.name;
          const name = n.name || n.title || id;
          const labels = Array.isArray(n.labels) ? n.labels.join(",") : (n.labels || "");
          console.log(`[NODE ${i}] id=${id} name=${name} labels=${labels}`);
        });
      } catch {}

      console.log("[SEARCH] calling zepManager.searchMemory for edges", { userId: user.id, limit: perCallLimit });
      const edgesRes: any = await zepManager.searchMemory(user.id, queryText, perCallLimit, "edges");
      rawEdges = edgesRes?.edges || [];
      console.log("[SEARCH] edges result:", rawEdges);
      try {
        console.log(`[EDGES] total: ${rawEdges.length}`);
        (rawEdges || []).forEach((e: any, i: number) => {
          const s = e.source_uuid || e.sourceId || e.source || e.from || e.src;
          const t = e.target_uuid || e.targetId || e.target || e.to || e.dst;
          const label = e.label || e.type || e.relation || "";
          const score = typeof e.score === "number" ? e.score : "";
          console.log(`[EDGE ${i}] ${s} -> ${t} label=${label} score=${score}`);
        });
      } catch {}

      if (rawEdges.length === 0 && rawNodes.length > 0) {
        console.log("[SEARCH] edges empty; expanding first few nodes for edges");
        const sample = rawNodes.slice(0, Math.min(25, rawNodes.length));
        const expansions = await Promise.all(
          sample.map((n: any) =>
            zepManager
              .searchMemory(
                user.id,
                String(n.id || n.name || n.nodeId || n.uuid),
                perCallLimit,
                "edges",
              )
              .catch((e: any) => {
                console.warn("[SEARCH] expand node failed", n?.id || n?.uuid || n?.name, e);
                return { edges: [] };
              }),
          ),
        );
        rawEdges = expansions.flatMap((r) => r?.edges || []);
        console.log("[SEARCH] expanded edges result:", rawEdges);
        try {
          console.log(`[EDGES-EXPANDED] total: ${rawEdges.length}`);
          (rawEdges || []).forEach((e: any, i: number) => {
            const s = e.source_uuid || e.sourceId || e.source || e.from || e.src;
            const t = e.target_uuid || e.targetId || e.target || e.to || e.dst;
            const label = e.label || e.type || e.relation || "";
            const score = typeof e.score === "number" ? e.score : "";
            console.log(`[EDGE-EXPANDED ${i}] ${s} -> ${t} label=${label} score=${score}`);
          });
        } catch {}
      }
    } catch (e) {
      console.error("[SEARCH] searchMemory flow failed", e);
    }

    // If SDK fetch produced nothing or SDK lacks methods, fallback to searchMemory
    if ((!Array.isArray(rawNodes) || rawNodes.length === 0) && (!Array.isArray(rawEdges) || rawEdges.length === 0)) {
      try {
        const queryText = "*";
        console.log("[FALLBACK] Using zepManager.searchMemory for nodes/edges", { userId: user.id, perCallLimit });
        const [edgesResult, nodesResult] = await Promise.all([
          zepManager.searchMemory(user.id, queryText, perCallLimit, "edges"),
          zepManager.searchMemory(user.id, queryText, perCallLimit, "nodes"),
        ]);
        rawEdges = edgesResult?.edges || [];
        rawNodes = nodesResult?.nodes || [];
        console.log("[FALLBACK] searchMemory counts", { nodes: rawNodes.length || 0, edges: rawEdges.length || 0 });
      } catch (e) {
        console.error("[FALLBACK] searchMemory failed", e);
      }
    }

    // Map Zep nodes to our GraphNode shape
    const nodes: GraphNode[] = rawNodes.map((n: any) => ({
      id: String(n.uuid || n.id || n.nodeId || n.name),
      type: (Array.isArray(n.labels) && n.labels.length
        ? n.labels.join("|")
        : (n.type || n.kind || "entity")) as any,
      label: String(n.name || n.title || n.uuid || n.id || "node"),
      summary: n.summary || n.description || undefined,
      createdAt: n.created_at || n.createdAt || n.metadata?.createdAt,
      metadata: { ...(n.attributes || n.metadata || {}), labels: n.labels || undefined },
    }));

    // Build a set for fast existence checks
    const nodeIdSet = new Set(nodes.map((n) => n.id));

    // Map Zep edges to our GraphLink shape
    const links: GraphLink[] = rawEdges
      .map((e: any) => {
        // Support multiple edge field shapes from Zep
        const source = String(
          e.sourceNodeUuid || e.source_uuid || e.sourceId || e.source || e.from || e.src || "",
        );
        const target = String(
          e.targetNodeUuid || e.target_uuid || e.targetId || e.target || e.to || e.dst || "",
        );
        const label = e.name || e.label || e.type || e.relation || "";
        const created = e.createdAt || e.created_at || e.validAt || e.metadata?.createdAt;
        const meta = e.attributes || e.metadata || {};
        return {
          source,
          target,
          type: String(label),
          score: typeof e.score === "number" ? e.score : undefined,
          createdAt: created,
          metadata: meta,
        };
      })
      .filter((l) => l.source && l.target);

    // Ensure nodes exist for link endpoints by creating minimal placeholders
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

    // Optionally compute simple degree
    const degreeMap = new Map<string, number>();
    for (const l of links) {
      degreeMap.set(l.source, (degreeMap.get(l.source) || 0) + 1);
      degreeMap.set(l.target, (degreeMap.get(l.target) || 0) + 1);
    }
    for (const n of nodes) {
      n.degree = degreeMap.get(n.id) || 0;
    }

    const byType: Record<string, number> = {};
    for (const n of nodes) byType[n.type] = (byType[n.type] || 0) + 1;

    // No backbone fallback; return only true edges

    const payload: GraphResponse = {
      nodes,
      links,
      stats: { nodeCount: nodes.length, linkCount: links.length, byType },
    };
    console.log("[GET /api/memory-graph] payload counts:", payload.stats);

    return NextResponse.json(payload);
  } catch (err) {
    console.error("/api/memory-graph failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
