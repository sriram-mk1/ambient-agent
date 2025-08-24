"use client";

import React, { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import dynamic from "next/dynamic";
import * as d3 from "d3-force";
import type { GraphNode, GraphLink, GraphResponse } from "@/types/memory-graph";

// Use 2D force graph (no VR deps)
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export type MemoryGraphProps = {
  onSelectNode?: (node: GraphNode | null) => void;
  onGraphUpdate?: (nodes: GraphNode[], links: GraphLink[]) => void;
};

export type MemoryGraphHandle = {
  expandNode: (nodeId: string) => Promise<void>;
  focusNode: (nodeId: string) => void;
  recenterView: () => void;
};

const MemoryGraph = forwardRef<MemoryGraphHandle, MemoryGraphProps>(function MemoryGraph(
  { onSelectNode, onGraphUpdate }: MemoryGraphProps,
  ref,
) {
  const graphRef = useRef<any>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<any | null>(null);
  const [edgeTipPos, setEdgeTipPos] = useState<{ x: number; y: number } | null>(null);
  const [edgeTip, setEdgeTip] = useState<{ label: string; fact?: string } | null>(null);
  const [agentStatus, setAgentStatus] = useState<{ content: string; icon: string } | null>(null);
  // Run initial layout, then keep static unless dragging
  const [hasLaidOut, setHasLaidOut] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fetchGraph = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const url = `/api/memory-graph?${params.toString()}`;
      console.log("[MemoryGraph] fetching:", url);
      const res = await fetch(url, { cache: "no-store" });
      const data: GraphResponse = await res.json();
      if (!res.ok) throw new Error((data as any)?.error || "Failed to load graph");
      console.log("[MemoryGraph] loaded:", { nodes: data.nodes.length, links: data.links.length });
      setNodes(data.nodes);
      setLinks(data.links);
      onGraphUpdate?.(data.nodes, data.links);
    } catch (e: any) {
      console.error("[MemoryGraph] error:", e);
      setError(e.message || "Failed to load graph");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();

    const eventSource = new EventSource("/api/chat");
    eventSource.addEventListener("status", (event) => {
      const data = JSON.parse(event.data);
      setAgentStatus({ content: data.content, icon: data.icon });
    });

    return () => {
      eventSource.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  useEffect(() => {
    const fg = graphRef.current as any;
    if (!fg) return;

    fg.d3Force('link')?.distance(100);
    fg.d3Force('charge')?.strength(-100);
    fg.d3Force('center')?.strength(0.01);
    fg.d3Force('radial', d3.forceRadial(200, fg.width / 2, fg.height / 2).strength(0.01));

  }, []);

  const handleNodeClick = (node: any) => {
    const n = node as GraphNode & { x?: number; y?: number };
    if (onSelectNode) onSelectNode(n);
    setSelectedNodeId(n.id);
    // Center and zoom gently toward the clicked node
    try {
      const fg = graphRef.current as any;
      if (fg && Number.isFinite(n.x as number) && Number.isFinite(n.y as number)) {
        fg.centerAt(n.x, n.y, 400);
        fg.zoom(1.8, 400);
      }
    } catch {}
  };

  const expandNode = async (nodeId: string) => {
    try {
      const url = `/api/memory-graph/expand?nodeId=${encodeURIComponent(nodeId)}`;
      console.log("[MemoryGraph] expanding:", url);
      const res = await fetch(url);
      const data: GraphResponse = await res.json();
      if (!res.ok) throw new Error((data as any)?.error || "Failed to expand node");

      const existingIds = new Set(nodes.map((n) => n.id));
      const nextNodes = [...nodes];
      for (const n of data.nodes) {
        if (!existingIds.has(n.id)) {
          nextNodes.push(n);
          existingIds.add(n.id);
        }
      }

      const existingLinks = new Set(links.map((l) => `${l.source}->${l.target}->${l.type}`));
      const nextLinks = [...links];
      for (const l of data.links) {
        const key = `${l.source}->${l.target}->${l.type}`;
        if (!existingLinks.has(key)) {
          nextLinks.push(l);
          existingLinks.add(key);
        }
      }

      const allNodes = [...nodes, ...data.nodes.filter(n => !existingIds.has(n.id))];
      setNodes(allNodes);
      setLinks(nextLinks);
      onGraphUpdate?.(allNodes, nextLinks);
    } catch (e) {
      console.error(e);
    }
  };

  const focusNode = (nodeId: string) => {
    const n = (nodes as any[]).find((x) => x.id === nodeId);
    if (!n) return;
    handleNodeClick(n);
  };

  const recenterView = () => {
    try { graphRef.current?.zoomToFit(600, 80); } catch {}
  };

  useImperativeHandle(ref, () => ({ expandNode, focusNode, recenterView }));

  const handleNodeRightClick = async (node: any) => {
    await expandNode(node.id);
  };

  const handleNodeDragEnd = (node: any) => {
    node.fx = node.x;
    node.fy = node.y;
  // Stop simulation immediately after drag ends
  setIsDragging(false);
  };

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const typeToColor: Record<string, string> = {
    memory: "#2563eb",
    entity: "#059669",
    tag: "#f59e0b",
    document: "#7c3aed",
    conversation: "#ef4444",
  };
  const extraColors = ["#06b6d4", "#22c55e", "#e11d48", "#f97316", "#a855f7", "#84cc16", "#0ea5e9", "#14b8a6"];
  
  const pickColor = (node: any) => {
    const byType = typeToColor[node.type as string];
    if (byType) return byType;
    let h = 0;
    const id = String(node.id || "");
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return extraColors[h % extraColors.length];
  };

  const { neighborNodes, neighborLinks } = useMemo(() => {
    if (!hoveredNodeId) return { neighborNodes: new Set(), neighborLinks: new Set() };

    const neighborNodes = new Set<string>([hoveredNodeId]);
    const neighborLinks = new Set<any>();

    links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      if (sourceId === hoveredNodeId || targetId === hoveredNodeId) {
        neighborNodes.add(sourceId);
        neighborNodes.add(targetId);
        neighborLinks.add(link);
      }
    });
    return { neighborNodes, neighborLinks };
  }, [hoveredNodeId, links]);


  // Only render actual edges returned by API/Zep
  const combinedLinks = useMemo(() => links as any[], [links]);

  // Build node type palette for legend
  const nodeTypes = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes.filter(Boolean) as any[]) {
      const t = (n.type || "unknown").toString();
      s.add(t);
    }
    return Array.from(s).sort();
  }, [nodes]);

  const hexPalette = [
    "#2563eb", "#059669", "#f59e0b", "#7c3aed", "#ef4444",
    "#0ea5e9", "#14b8a6", "#84cc16", "#e11d48", "#a855f7",
  ];
  const colorForLabel = (label: string) => {
    if (!label) return "#374151";
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    return hexPalette[h % hexPalette.length];
  };
  const colorForNodeType = (type: string) => {
    const base = (typeToColor as any)[type];
    if (base) return base;
    return colorForLabel(type);
  };
  const rgba = (hex: string, alpha: number) => {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return (
    <div className="w-full h-full relative">
      {agentStatus && (
        <div className="absolute top-2 left-2 z-10 bg-white bg-opacity-80 rounded-lg p-2 flex items-center text-sm text-gray-700 shadow-md">
          <span className="mr-2">{agentStatus.icon === "pencil" ? "✏️" : "🧠"}</span>
          <span>{agentStatus.content}</span>
        </div>
      )}
      {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading memories…</div>}
      {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{error}</div>}
      <div
        className="absolute inset-0"
        // Clear hover UI on leave only
        onMouseLeave={() => {
          setHoveredEdge(null);
          setEdgeTipPos(null);
          setEdgeTip(null);
          setHoveredNodeId(null);
          setHoveredNode(null);
        }}
      >
      <ForceGraph2D
       ref={graphRef}
        graphData={{ nodes, links: combinedLinks } as any}
        nodeId="id"
        linkSource="source"
        linkTarget="target"
        onNodeDrag={() => {
          // Allow graph to reflow while dragging
          if (!isDragging) setIsDragging(true);
        }}
  // Initial layout ticks; after layout, freeze unless dragging
  cooldownTicks={isDragging ? 20 : hasLaidOut ? 0 : 120}
  onEngineStop={() => setHasLaidOut(true)}
        enableNodeDrag={true}
  onNodeDragEnd={handleNodeDragEnd}
        enableZoomInteraction={true}
        onZoom={transform => {
           // a-ok
        }}

        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
          if (!isFinite(node.x) || !isFinite(node.y)) return;
          const label = node.label || node.id;
          const baseSize = 4 + Math.sqrt(Math.max(0, Number(node.degree || 0)));
          const size = isFinite(baseSize) && baseSize > 0 ? baseSize : 4;

          let fill = pickColor(node);
          if (hoveredNodeId && !neighborNodes.has(node.id)) {
            fill = rgba(fill, 0.15);
          }

          ctx.beginPath();
          ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
          ctx.fillStyle = fill;
          ctx.fill();

          // Do not draw node labels on hover; HTML tooltips handle names/summary
        }}
        
        linkColor={(link: any) => {
          if (hoveredNodeId && !neighborLinks.has(link)) return 'rgba(55,65,81,0.05)';
          if (hoveredNodeId && neighborLinks.has(link)) return 'rgba(239, 68, 68, 0.8)'; // Highlighted link color
          return 'rgba(55,65,81,0.25)';
        }}
        linkWidth={(link: any) => hoveredNodeId && neighborLinks.has(link) ? 1.2 : 0.8}
        linkHoverPrecision={8}

        onNodeClick={handleNodeClick}
        onNodeHover={(n: any) => {
          setHoveredNodeId(n?.id || null);
          setHoveredNode(n || null);
          // No simulation changes on hover
        }}
        onLinkHover={(l: any) => {
          setHoveredEdge(l || null);
          if (l && graphRef.current) {
            const s = typeof l.source === 'object' ? l.source : null;
            const t = typeof l.target === 'object' ? l.target : null;
            if (s && t && isFinite(s.x) && isFinite(s.y) && isFinite(t.x) && isFinite(t.y)) {
              const mx = (s.x + t.x) / 2;
              const my = (s.y + t.y) / 2;
              const sc = graphRef.current.graph2ScreenCoords(mx, my);
              const label = (l.type || '').toString();
              const fact = (l.metadata && (l.metadata.fact as any)) || (l as any).fact || undefined;
              setEdgeTipPos({ x: sc.x, y: sc.y });
              setEdgeTip({ label, fact });
            }
          } else {
            setEdgeTipPos(null);
            setEdgeTip(null);
          }
        }}
        onNodeRightClick={handleNodeRightClick}
        backgroundColor="rgba(255,255,255,1)"
      />
      </div>
      {edgeTipPos && edgeTip && (
        <div
          className="pointer-events-none absolute z-20 max-w-sm rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 shadow-sm"
          style={{ left: edgeTipPos.x + 12, top: edgeTipPos.y + 12 }}
        >
          <div className="text-xs font-medium text-gray-900">{edgeTip.label}</div>
          {edgeTip.fact && (
            <div className="mt-0.5 line-clamp-3">{String(edgeTip.fact).slice(0, 200)}{String(edgeTip.fact).length > 200 ? '…' : ''}</div>
          )}
        </div>
      )}
      {/* Legend removed as requested */}
      {hoveredNode && graphRef.current && typeof hoveredNode.x === 'number' && typeof hoveredNode.y === 'number' && (() => {
        const c = graphRef.current!.graph2ScreenCoords(hoveredNode.x, hoveredNode.y);
        return (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 shadow-sm"
          style={{ left: (c.x || 0) + 12, top: (c.y || 0) + 12 }}
        >
          <div className="font-medium text-gray-900 text-xs">{hoveredNode.label || hoveredNode.id}</div>
          {hoveredNode.summary && (
            <div className="mt-0.5 line-clamp-3">{String(hoveredNode.summary).slice(0, 140)}{String(hoveredNode.summary).length > 140 ? '…' : ''}</div>
          )}
        </div>
        );
      })()}
    </div>
  );
});

export default MemoryGraph;
