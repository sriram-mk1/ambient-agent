"use client";

import React, { useEffect, useState } from "react";
import EdgesForNode from "@/components/memory/EdgesForNode";

type MemoryNode = {
  id: string;
  type: string;
  name: string;
  summary: string | null;
  createdAt: string | null;
  metadata: Record<string, any>;
};

export default function MemoryManager() {
  const [items, setItems] = useState<MemoryNode[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/memory-manager?limit=50", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load memory");
      setItems(data.items || []);
    } catch (e: any) {
      setError(e.message || "Failed to load memory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const saveItem = async (id: string, payload: Partial<MemoryNode>) => {
    try {
      const res = await fetch("/api/memory-manager", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { id, ...payload } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save");
      await fetchItems();
    } catch (e) {
      console.error(e);
      alert("Failed to save");
    }
  };

  return (
    <div className="h-[calc(100%-48px)] overflow-hidden">
      <div className="h-full overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-xs text-gray-500">Loading...</div>}
        {error && <div className="text-xs text-red-500">{error}</div>}
        {!loading && items.length === 0 && (
          <div className="text-xs text-gray-500">No memory entries yet.</div>
        )}
        {items.map((it, idx) => {
          const colorForType = (t: string) => (
            t === 'memory' ? '#2563eb' :
            t === 'entity' ? '#059669' :
            t === 'tag' ? '#f59e0b' :
            t === 'document' ? '#7c3aed' :
            t === 'conversation' ? '#ef4444' : '#6b7280'
          );
          const dot = colorForType(it.type);
          const title = it.name || it.id;
          return (
            <details key={`${it.id || 'edge'}-${idx}`} className="group rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow transition">
              <summary className="list-none cursor-pointer select-none p-3 flex items-center justify-between bg-gray-50/60 rounded-t-lg border-b border-gray-100">
                <div className="text-sm text-gray-900 truncate max-w-[60%]">{title}</div>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} />
                    <span className="uppercase tracking-wide">{it.type}</span>
                  </div>
                </div>
              </summary>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500">Type
                    <input defaultValue={it.type} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-0 focus:border-gray-400" />
                  </label>
                  <label className="col-span-2 text-xs text-gray-500">Name
                    <input defaultValue={it.name} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-0 focus:border-gray-400" />
                  </label>
                  <label className="col-span-2 text-xs text-gray-500">Summary
                    <textarea defaultValue={it.summary ?? ''} className="mt-1 w-full min-h-[90px] rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-0 focus:border-gray-400 resize-none" />
                  </label>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Metadata (JSON)</div>
                  <textarea defaultValue={JSON.stringify(it.metadata || {}, null, 2)} className="mt-1 w-full min-h-[140px] rounded border border-gray-300 px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-0 focus:border-gray-400 resize-none" />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={async (e) => {
                      const root = (e.currentTarget.closest('details') as HTMLElement);
                      const inputs = root.querySelectorAll('input, textarea');
                      const [typeEl, nameEl, summaryEl, metaEl] = inputs as any;
                      let meta: any = {};
                      try { meta = JSON.parse(metaEl.value || '{}'); } catch {}
                      await saveItem(it.id, {
                        type: typeEl.value,
                        name: nameEl.value || it.id,
                        summary: summaryEl.value || null,
                        metadata: meta,
                      } as any);
                    }}
                    className="text-xs rounded border border-gray-300 px-2 py-1 bg-white hover:bg-gray-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => alert('Delete not implemented')}
                    className="text-xs rounded border border-red-300 text-red-600 px-2 py-1 bg-white hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
                <div className="pt-2 border-t border-gray-100">
                  <EdgesForNode nodeId={it.id} />
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
