"use client";

import React, { useEffect, useState } from "react";

export default function EdgesForNode({ nodeId }: { nodeId: string }) {
  const [edges, setEdges] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEdges = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/memory-graph/expand?nodeId=${encodeURIComponent(nodeId)}&limit=50`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load edges");
        setEdges(data.links || []);
      } catch (e: any) {
        setError(e.message || "Failed to load edges");
      } finally {
        setLoading(false);
      }
    };
    fetchEdges();
  }, [nodeId]);

  if (loading) return <div className="text-[11px] text-gray-500">Loading edges…</div>;
  if (error) return <div className="text-[11px] text-red-500">{error}</div>;
  if (edges.length === 0) return <div className="text-[11px] text-gray-500">No edges.</div>;

  return (
    <div className="space-y-1">
      {edges.map((e, idx) => (
        <div key={`${e.source}-${e.target}-${e.type}-${idx}`} className="text-[11px] text-gray-700">
          <span className="font-mono bg-gray-50 border border-gray-200 rounded px-1 py-0.5 mr-2">{e.type}</span>
          <span>{typeof e.source === 'object' ? e.source.id : e.source} → {typeof e.target === 'object' ? e.target.id : e.target}</span>
          {typeof e.score === 'number' && (<span className="ml-2 text-gray-500">{e.score.toFixed(2)}</span>)}
        </div>
      ))}
    </div>
  );
}
